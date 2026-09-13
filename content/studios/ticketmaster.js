export default {
  blocks: [
    { t: 'prose',
      md: `Ticketmaster checkout is inventory under flash crowds: 50,000 people hit buy for 800 seats,
payment takes eight seconds, webhooks arrive late, and your database must never sell seat 14-A twice.
The interview is not "add Redis." It is **short-lived holds**, **commit on payment confirmation**,
and **constraints that make oversell impossible** even when application code bugs.` },

    { t: 'h', text: 'Seat hold TTL -- reserve without locking the row for ten minutes' },
    { t: 'prose',
      md: `Never \`SELECT ... FOR UPDATE\` a seat row for the duration of a human typing a card number.
That serializes checkout and guarantees deadlock under concurrency. Instead:

1. **Available** -- seat can be held.
2. **Held** -- tied to \`cart_id\` / \`user_id\` with \`hold_expires_at\`.
3. **Sold** -- payment captured; immutable.

Hold transition is a conditional update: \`UPDATE seats SET status='HELD', cart_id=$c,
hold_expires_at=now()+interval '5 minutes' WHERE event_id=$e AND seat_id=$s AND status='AVAILABLE'\`.
Zero rows means someone else got it -- show pick another seat, not a spinner.

TTL is enforced by **lazy expiry on read** (reject hold if \`now > hold_expires_at\`) plus a
**sweeper job** that returns expired holds to AVAILABLE. Five to ten minutes is typical; longer
holds inflate perceived sold-out and invite bot hoarding.` },
    { t: 'diagram',
      code: `stateDiagram-v2
  [*] --> Available
  Available --> Held: CAS hold plus TTL
  Held --> Sold: payment confirmed
  Held --> Available: TTL expired or release
  Sold --> [*]
  note right of Held
    No row lock for minutes.
    hold_expires_at enforced
    on read and by sweeper.
  end note`,
      caption: 'Held is a lease, not a long lock -- expiry returns inventory automatically.' },

    { t: 'h', text: 'Unique constraint on seat plus event' },
    { t: 'prose',
      md: `Application-level checks race. The database must enforce **at most one Sold row per
(event_id, seat_id)** via a unique constraint or composite primary key. Holds can use the same key
with status in the row, or a separate \`holds\` table with unique \`(event_id, seat_id)\` where only
one active hold exists.

On insert-to-sold path: \`INSERT INTO sales (event_id, seat_id, order_id) VALUES ...\` with unique
violation mapped to "already sold." Even if two payment webhooks fire, one wins, one gets a clean
error path for refund.

Staff line: "Unique constraint is the last line of defense when the webhook handler runs twice or
two workers process the same queue message."` },

    { t: 'h', text: 'Payment flow and late webhooks' },
    { t: 'prose',
      md: `Checkout creates an **order in PENDING_PAYMENT** with held seats. Client redirects to
Stripe or similar; confirmation arrives asynchronously via **webhook** -- often seconds later,
sometimes retried for hours.

The failure mode: user completes payment, closes browser, webhook is slow. If hold TTL expires
before webhook, seats return to AVAILABLE and another fan buys them -- **double sell** when the
late webhook finally commits.

Fix bundle:
- Extend hold on \`payment_intent.processing\` or when client beacons "payment submitted."
- Commit seat to Sold in the **webhook handler idempotently** keyed by \`payment_intent_id\`.
- If hold expired but payment succeeded, **auto-refund or manual reconcile** -- never silently
assign a seat already sold; detect unique violation and trigger refund workflow.

Never mark Sold on client redirect alone -- redirects lie, webhooks retry, and tabs duplicate.` },
    { t: 'diagram',
      code: `sequenceDiagram
  participant U as User
  participant API as Checkout API
  participant P as Payment provider
  participant W as Webhook worker
  U->>API: Hold seats CAS
  API-->>U: cart_id plus expires_at
  U->>P: Pay
  P->>W: payment_intent.succeeded
  W->>API: Idempotent commit Sold
  API-->>W: 200 or unique violation`,
      caption: 'Sold transition happens in webhook idempotency path, not on browser return.' },

    { t: 'h', text: 'Oversell prevention under retries' },
    { t: 'prose',
      md: `Oversell happens when: (1) hold expires but payment succeeds, (2) webhook delivered twice,
(3) two tabs complete checkout for the same cart, (4) admin manual comp plus normal sale. Code
paths multiply; **constraints plus idempotency** stay correct when code does not.

Pattern:
- \`idempotency_keys\` table: \`(payment_intent_id) -> order_id, status\`.
- Webhook processing: begin transaction, insert idempotency record, conditional update seats to
Sold only if Held by this cart OR already Sold by this order (replay), commit.
- Unique on \`(event_id, seat_id)\` where status=Sold or partial unique index.

If second buyer captured the seat during expiry window, webhook hits unique violation -- trigger
refund and apology email, not a second Sold row.` },

    { t: 'table',
      title: 'Hold and commit mechanisms compared',
      cols: ['Approach', 'Pros', 'Cons', 'Verdict'],
      rows: [
        ['Row lock until payment', 'Simple mental model', 'Serializes all checkout; kills throughput', 'Reject in interview'],
        ['Held with TTL plus CAS', 'High concurrency; auto release', 'Expiry vs late webhook race', 'Standard answer'],
        ['Optimistic LWW on seat status', 'Easy to code', 'Lost updates oversell', 'Reject'],
        ['Queue per seat FIFO', 'Fair', 'Hot seat bottleneck; slow for multi-seat carts', 'Special cases only'],
        ['Unique (event, seat) at Sold', 'Hard oversell guard', 'Does not alone fix payment/hold timing', 'Required layer']
      ] },

    { t: 'h', text: 'Queue-it waiting room as load shed' },
    { t: 'prose',
      md: `When on-sale starts, protect origin with a **virtual waiting room**: edge assigns a queue
token, admits N users per second to the actual buy flow, everyone else sees position ETA. This is
**load shedding at the edge** -- not fairness in seat allocation, but keeping the origin alive so
when you admit someone, checkout actually works.

Queue-it class products sit on CDN edge; your API validates admission token before allowing hold
CAS. Without admission control, hold CAS storms still hit DB; with it, you shape traffic to what
hold/commit path can serve.

Do not confuse waiting room with seat fairness -- bots in queue are still bots; mitigations are
hold TTL, per-account limits, and device attestation, separate topic.` },

    { t: 'h', text: 'What not to do' },
    { t: 'note',
      tone: 'danger',
      title: 'Anti-patterns that fail on sale day',
      md: `Locking seat rows for the full checkout duration. Selling on redirect without webhook
idempotency. Relying on "check available" in app code without unique constraint. Infinite hold TTL
so bots clog inventory. Running hold expiry sweeper only nightly.` },

    { t: 'h', text: 'Trade-offs' },
    { t: 'tradeoffs',
      title: 'Short TTL holds vs long reservations',
      gains: [
        'CAS hold scales to thousands of concurrent seat picks.',
        'TTL returns abandoned carts to inventory within minutes.',
        'Unique constraint makes double-sell a handled error, not a lawsuit.',
        'Waiting room sheds flash crowd before it hits checkout DB.',
        'Webhook idempotency survives duplicate delivery and worker retries.'
      ],
      costs: [
        'Hold vs payment race requires extend-on-processing and refund path.',
        'Users lose seats if they slow-pay past TTL -- UX tension.',
        'Sweeper lag briefly shows false availability until expired holds clear.',
        'Refund storms when many late webhooks lose race to other buyers.',
        'Edge queue adds vendor dependency and token validation complexity.'
      ] },

    { t: 'failures',
      items: [
        { mode: 'Long row lock through checkout', blast: 'Throughput collapses; one slow card blocks a seat for minutes; deadlocks under load.', fix: 'Held status with short TTL; CAS on Available->Held; no minutes-long FOR UPDATE.' },
        { mode: 'Hold expires before late webhook', blast: 'Payment succeeds but seat resold; double sell or manual firefight.', fix: 'Extend hold on payment processing; idempotent webhook commit; refund on unique violation if seat gone.' },
        { mode: 'Sold on browser redirect only', blast: 'Duplicate tabs and lost webhooks create ghost orders or missed Sales.', fix: 'Commit Sold only in webhook handler with payment_intent idempotency key.' },
        { mode: 'No unique (event_id, seat_id)', blast: 'Two webhook workers both insert Sold; two fans same seat.', fix: 'Database unique constraint; map violation to refund workflow, not retry loop.' },
        { mode: 'Flash sale without admission control', blast: 'Origin 503; holds fail open; users refresh-storm makes outage worse.', fix: 'Edge waiting room admits tokenized traffic at sustainable RPS to hold API.' },
        { mode: 'Webhook processed without idempotency', blast: 'Duplicate charges or duplicate ticket emails; inventory math drift.', fix: 'Store payment_intent_id -> outcome; replay returns same 200 without re-commit.' }
      ] },

    { t: 'staff',
      md: `Strong candidates draw the state machine before mentioning Stripe.

- "Hold is \`UPDATE ... WHERE status=AVAILABLE\` with five-minute \`hold_expires_at\` -- I never lock
the row for ten minutes while someone finds their CVV."
- "Sold happens in the webhook with idempotency on \`payment_intent_id\`. Redirect is UX only."
- "Unique on (event_id, seat_id) for sold state is non-negotiable -- app bugs will happen."
- "If webhook arrives after TTL and seat is gone, I refund automatically -- oversell is worse than
an angry refund."
- "Queue-it or homegrown edge queue admits RPS the hold path can actually serve -- shedding before
CAS storm hits Postgres."

Signal: you have thought about payment async, not just CRUD.` },

    { t: 'quiz',
      items: [
        {
          q: 'Why not SELECT FOR UPDATE on a seat for the entire checkout form?',
          options: [
            'Postgres does not support row locks.',
            'It serializes seat access for minutes, collapsing throughput and risking deadlocks under flash sale load.',
            'FOR UPDATE prevents unique constraints.',
            'Stripe requires unlocked rows.'
          ],
          answer: 1,
          why: 'Checkout takes human-scale time; long locks turn concurrency into a single-lane road. Short TTL holds with CAS achieve mutual exclusion without holding database locks while users type card numbers.'
        },
        {
          q: 'Payment webhook arrives 90 seconds after hold TTL expired; seat was resold. Payment succeeded. Correct action?',
          options: [
            'Force Sold on original buyer -- evict second buyer.',
            'Sell two tickets for one seat quietly.',
            'Detect unique violation or missing hold; auto-refund first payment and notify support -- never double-sell.',
            'Extend TTL retroactively and replay hold.'
          ],
          answer: 2,
          why: 'Retroactive hold breaks the second buyer\'s valid purchase. Oversell creates legal and operational catastrophe. The system must prefer refund plus apology when late payment loses the race, and metrics should track expiry-vs-webhook timing to tune TTL and extend-on-processing.'
        },
        {
          q: 'What does Queue-it style waiting room primarily protect?',
          options: [
            'Fair seat allocation order among fans.',
            'Origin and checkout API from unbounded flash RPS -- admission control as load shed.',
            'Payment provider from fraud.',
            'Database from needing unique constraints.'
          ],
          answer: 1,
          why: 'Waiting room shapes traffic to sustainable admission rate so hold CAS and payment paths stay up. It is edge load shedding, not seat fairness. Seat integrity still comes from hold TTL, CAS, webhook idempotency, and unique sold constraint.'
        },
        {
          q: 'Where should seat status transition to Sold?',
          options: [
            'On client return from Stripe redirect URL.',
            'In idempotent payment webhook handler after verifying intent matches cart.',
            'When user clicks Buy before payment.',
            'When hold is created.'
          ],
          answer: 1,
          why: 'Redirect is unreliable -- tabs duplicate, browsers close, networks drop. Webhooks retry and are the payment provider\'s commitment signal. Idempotent handler ties Sold to payment_intent once, with unique constraint as guard.'
        }
      ] },

    { t: 'details',
      title: 'Related topics',
      blocks: [{
        t: 'prose',
        md: `Hold leases and compare-and-set mirror **Transactions & Isolation**. Webhook idempotency
is **API Design & Contracts**. Edge admission control connects to **Rate Limiting & Multi-Tenancy**
and **CDN & Edge**. Payment timeout races are a classic **Resilience Patterns** failure mode.`
      }] }
  ],

  flashcards: [
    { q: 'Why short TTL seat holds instead of long row locks?', a: 'Row locks through checkout serialize seats for minutes and deadlock under flash crowds. CAS hold with hold_expires_at gives mutual exclusion for human payment time then auto-releases abandoned carts without holding DB locks.' },
    { q: 'What enforces no double-sell at the database layer?', a: 'Unique constraint on (event_id, seat_id) for sold inventory -- or equivalent composite key. Application checks race; constraint turns duplicate webhook or worker retry into a handled violation, not two fans in one seat.' },
    { q: 'Why commit Sold in webhook not redirect?', a: 'Browser redirect is unreliable and duplicated; webhooks retry with provider authority. Idempotent webhook keyed on payment_intent_id commits once; redirect is display-only confirmation UX.' },
    { q: 'Hold expired but payment succeeded -- what now?', a: 'Do not oversell or evict the second buyer. Detect lost race via missing hold or unique violation; auto-refund late payment and alert. Tune TTL extend-on-processing to reduce incidence.' },
    { q: 'What is Queue-it waiting room doing architecturally?', a: 'Edge load shedding: tokenized admission at sustainable RPS before hold API. Protects origin during on-sale spike; separate from seat fairness which still needs hold CAS and constraints.' },
    { q: 'How prevent webhook double processing oversell?', a: 'Idempotency table on payment_intent_id; transactional commit updates seats only if held by this cart or already sold to this order on replay. Unique seat constraint catches any remaining duplicate path.' },
    { q: 'Lazy expiry vs sweeper for holds?', a: 'Lazy check on read rejects expired holds immediately for new buyers; background sweeper returns stale Held rows to Available so inventory counts stay honest without waiting for next access attempt.' }
  ],

  drills: [
    {
      prompt: 'On-sale at noon: 40k RPS hits /hold; p95 hold latency goes to 8s; users double-click Buy; support reports duplicate charges but one seat. Trace failure modes and redesign.',
      probes: [
        'Is there edge admission before /hold?',
        'Is hold CAS or read-modify-write?',
        'Duplicate payment intents from double-click?',
        'Unique constraint present?',
        'Hold TTL vs user retry behavior?'
      ],
      strong: [
        'Adds waiting room or token bucket at edge before origin.',
        'Hold is single CAS UPDATE with cart idempotency on client Buy.',
        'Payment idempotency keys prevent duplicate intents.',
        'Unique (event, seat) catches any double Sold.',
        'Metrics: hold latency, expiry rate, webhook-after-expiry count.',
        '503 fast-fail instead of queue-unbounded retry storm.'
      ],
      weak: [
        'Scale Postgres vertically only.',
        'Longer locks to "prevent" double buy.',
        'Disable webhooks; trust redirect.'
      ]
    },
    {
      prompt: 'Webhook worker lag spikes to 6 minutes during sale. Holds are 5 minutes. Design changes so paying customers rarely lose seats while keeping bots from hoarding.',
      probes: [
        'Extend hold when?',
        'Max extension cap?',
        'Sweeper interaction?',
        'Refund path when seat gone?',
        'How to test before sale day?'
      ],
      strong: [
        'Extend hold on payment_intent.processing or client payment_started beacon.',
        'Cap total hold at e.g. 15 minutes to limit hoarding.',
        'Webhook consumer scales on queue depth; idempotent commits.',
        'Refund automation on unique violation with user messaging.',
        'Load test hold+webhook with artificial lag; game day before on-sale.'
      ],
      weak: [
        'Infinite hold until webhook.',
        'Ignore lag -- users should pay faster.',
        'Manual support for all conflicts.'
      ]
    }
  ]
};
