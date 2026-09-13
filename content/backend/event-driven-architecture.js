export default {
  blocks: [
    { t: 'prose',
      md: `Event-driven architecture means services communicate by publishing facts about things that already happened, rather
than by calling each other and waiting. \`OrderPlaced\` is a fact; \`placeOrder()\` is a request. The producer does
not know or care who consumes it.

That sounds like a small change in direction and it is not. It moves the hard part of your system from "how do I
call the right service" to "how do I guarantee that the database write and the event publish either both happen or
neither does". Almost every inconsistency bug in an event-driven system traces back to that one question.` },

    { t: 'h', text: 'Why it exists: the dual-write problem' },
    { t: 'prose',
      md: `Here is the code every team writes first, and it is broken.` },
    { t: 'code',
      lang: 'js',
      title: 'The broken version -- two writes, no shared transaction',
      code: `await db.orders.insert(order);              // write 1: durable
await kafka.publish('OrderPlaced', order); // write 2: separate system

// Crash between them and the order exists with nobody informed.
// Swap the lines and you announce an order that may never commit.` },
    { t: 'prose',
      md: `Two independent systems, two independent writes, no shared transaction. Four outcomes exist and two of them are
bugs. If the process crashes between the lines, the order exists but no downstream service ever hears about it -- no
receipt, no inventory decrement, no warehouse pickup. If you swap the order and publish first, a rollback or
constraint violation leaves you having announced an order that does not exist, and consumers build state on a
fiction.

Wrapping it in a database transaction does not help, because the Kafka publish is not part of that transaction.
Publishing first and inserting second does not help. Retrying does not help. There is no ordering of two
non-transactional writes that is safe, and this is the **dual-write problem**. It cannot be solved by being careful;
it has to be designed away.` },
    { t: 'note',
      tone: 'danger',
      md: `Do not be reassured by how rarely you see it. At 1,000 orders per second, a crash window of 5 ms means roughly 5
lost events per crash -- and deploys, OOM kills and node drains are crashes. Those events are gone silently: no
error, no retry, no log. You discover them weeks later as a reconciliation discrepancy that nobody can explain.` },

    { t: 'h', text: 'The transactional outbox' },
    { t: 'prose',
      md: `The fix is to make the event part of the same transaction as the state change, by writing it to a table in the same
database. One transaction, one atomic commit, no dual write. A separate process then reads that table and publishes
to the broker, retrying until it succeeds. Because the event is already durably committed, the publisher can crash
arbitrarily and lose nothing -- it will just publish again, which is why consumers must be idempotent.` },
    { t: 'diagram',
      code: `flowchart LR
  A["Order service"] -->|one transaction| DB[("orders<br/>+ outbox")]
  DB -->|WAL / CDC| DBZ["Debezium<br/>connector"]
  DBZ --> K["Kafka topic"]
  K --> C1["Email service"]
  K --> C2["Inventory service"]
  K --> C3["Search indexer"]
  C1 --> D1[("dedupe store")]
  C2 --> D2[("dedupe store")]`,
      caption: 'The atomic boundary is the database commit. Everything after it is at-least-once, which is why each consumer owns a dedupe store.' },
    { t: 'code',
      lang: 'sql',
      title: 'Outbox schema and the one transaction that makes it work',
      code: `CREATE TABLE outbox (
  id             bigserial PRIMARY KEY,      -- also the publish order
  aggregate_type text        NOT NULL,       -- 'Order'
  aggregate_id   text        NOT NULL,       -- becomes the Kafka message key
  event_type     text        NOT NULL,       -- 'OrderPlaced'
  event_version  int         NOT NULL DEFAULT 1,
  payload        jsonb       NOT NULL,
  trace_id       text,                       -- carry the trace across the async hop
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz                 -- NULL until the relay confirms
);
CREATE INDEX outbox_unpublished ON outbox (id) WHERE published_at IS NULL;

-- The entire correctness argument is that these two statements share a commit.
BEGIN;
  INSERT INTO orders (id, user_id, total_cents, status)
  VALUES ('ord_8891', 'usr_44', 4299, 'placed');

  INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload, trace_id)
  VALUES ('Order', 'ord_8891', 'OrderPlaced',
          '{"orderId":"ord_8891","totalCents":4299,"items":[...]}', $1);
COMMIT;

-- Polling relay, if you are not using CDC. SKIP LOCKED lets N relays run safely.
SELECT id, aggregate_id, event_type, payload
  FROM outbox
 WHERE published_at IS NULL
 ORDER BY id
   FOR UPDATE SKIP LOCKED
 LIMIT 100;` },
    { t: 'prose',
      md: `You have two ways to drain the outbox. **Polling** is simple, needs no extra infrastructure, and its latency is your
poll interval -- typically 100-500 ms, which is fine for most things. It costs a repeated index scan and you must
remember to prune published rows or the table grows without bound.

**Change data capture** reads the database's replication log directly -- the Postgres WAL via logical decoding, or
the MySQL binlog -- and turns committed row changes into a stream. Debezium is the standard implementation. Latency
drops to a few milliseconds, the database sees no extra query load, and because the WAL is the commit record, you
cannot miss an event. The costs are real: a replication slot that will fill your disk if the consumer stalls (this
has taken down many production databases), schema-change handling, and a Kafka Connect cluster to operate.

A useful CDC-with-outbox subtlety: capture the *outbox table* rather than the business tables. Your event schema
then stays a deliberate published contract instead of an accidental leak of your internal column names, which you
will want to rename someday.` },
    { t: 'note',
      tone: 'warn',
      title: 'The replication slot is the CDC failure mode to know',
      md: `A Postgres logical replication slot pins WAL until the consumer confirms it. If Debezium is down for six hours on a
busy database, the WAL cannot be recycled and your primary's disk fills -- which is a full outage caused by a
pipeline component. Monitor \`pg_replication_slots.confirmed_flush_lsn\` lag, set \`max_slot_wal_keep_size\` so
Postgres invalidates the slot rather than dying, and have a documented plan for re-snapshotting when it does.` },

    { t: 'h', text: 'Three patterns people call "events", with different costs' },
    { t: 'table',
      cols: ['Pattern', 'Payload', 'Consumer must', 'Coupling', 'Cost'],
      rows: [
        ['**Event notification**', 'Just an id: `{orderId: "ord_8891"}`', 'Call back to the producer for details', 'Runtime -- producer must be up, and you have re-created a synchronous dependency', 'Cheapest to design, worst availability; N consumers means N callbacks per event'],
        ['**Event-carried state transfer**', 'The full relevant state of the aggregate', 'Nothing -- keep a local read model', 'Schema coupling only', 'Larger messages, duplicated state, schema evolution discipline. **Usually the right default.**'],
        ['**Event sourcing**', 'Every state change, forever, as the system of record', 'Fold events to derive state', 'Deep -- the event log *is* your database', 'Very high: snapshots, versioning, replay tooling, a team that understands it']
      ] },
    { t: 'prose',
      md: `These get conflated constantly, and the distinction is worth being precise about because the middle one is what most
teams should build and the last one is what most teams accidentally sign up for.

Event notification feels clean -- small messages, no duplicated data -- but the consumer must immediately call \`GET
/orders/ord_8891\`, so you have reintroduced the synchronous coupling the broker was supposed to remove, plus a race
where the callback arrives before the producer's read replica has the row.

Event-carried state transfer puts enough state in the message that the consumer can act alone. The email service
never needs to call you back. Consumers survive your outage entirely. The price is that the event payload is now a
published contract you must evolve carefully, and each consumer keeps its own partial copy of your data.

Event sourcing is a different thing altogether: you stop storing current state and store only the ordered sequence
of changes, deriving state by replaying. It is genuinely powerful -- perfect audit history, time travel, the ability
to build a new projection over three years of history -- and it is a large commitment. You need snapshots so
rebuilds are not O(all history), a versioning strategy that lets 2021 events be read by 2026 code, and a team fluent
enough that a routine bugfix does not require a design discussion. The payoff is specific: adopt it where the
*history is the product* -- ledgers, trading, compliance, anything where "how did we get here" is a first-class
requirement. Adopt it for a CRUD service and you have bought a research project.` },

    { t: 'h', text: 'Sagas: distributed transactions without 2PC' },
    { t: 'prose',
      md: `A booking spans three services: payment, inventory and notification. You need all three or none. Two-phase commit
would give you atomicity, but it is a blocking protocol -- if the coordinator dies after PREPARE, every participant
holds locks until it comes back -- and most modern stores and all third-party APIs do not support it anyway. Stripe
has no PREPARE.

A **saga** replaces atomicity with a sequence of local transactions, each with a defined **compensating action**
that semantically undoes it. There is no rollback, because the earlier steps really did commit. There is only "do
the opposite, and record that you did".` },
    { t: 'diagram',
      code: `sequenceDiagram
  participant O as Booking orchestrator
  participant P as Payment
  participant I as Inventory
  participant N as Notify
  O->>P: authorise 129.00
  P-->>O: auth_id abc
  O->>I: reserve seat 14C
  I-->>O: reserved
  O->>N: send confirmation
  N--xO: fails permanently
  Note over O: compensate in reverse
  O->>I: release seat 14C
  O->>P: void authorisation abc
  Note over O: state = FAILED_COMPENSATED`,
      caption: 'Compensation is semantic, not transactional. A voided authorisation still leaves a trace on the customer statement.' },
    { t: 'prose',
      md: `Compensating actions are where the design work actually is, and they are rarely symmetric with the forward action.
Voiding a card authorisation before capture is clean; refunding after capture is a new financial event with fees.
Releasing a seat is clean; un-sending an email is impossible, which is why notification belongs *last* in the
sequence -- **order your steps so the hardest-to-compensate action happens last.** That single heuristic prevents
most saga pain.

You also must accept that intermediate states are *visible*. Between step two and step three the seat is reserved
but unconfirmed, and a user refreshing the page will see it. There is no isolation level here, so the UI needs a
\`PENDING\` state and your domain model needs to allow it.` },
    { t: 'table',
      title: 'Orchestration vs choreography',
      cols: ['', 'Orchestration', 'Choreography'],
      rows: [
        ['Control flow', 'A coordinator holds the state machine and issues commands', 'Each service reacts to events and emits its own'],
        ['Visibility', 'One place to query "where is booking 8891"', 'Requires distributed tracing to reconstruct'],
        ['Coupling', 'Coordinator knows every participant', 'Participants know only event schemas'],
        ['Adding a step', 'Change the coordinator only', 'New service subscribes; nobody changes'],
        ['Failure handling', 'Explicit, centralised, testable compensation logic', 'Each service owns its own compensation; easy to miss one'],
        ['Debugging a stuck flow', 'Read the saga state row', 'Search logs across N services'],
        ['Fits', 'Money, bookings, anything with real compensation and audit needs', 'Loosely-coupled reactions: analytics, notifications, search indexing'],
        ['Real tooling', 'Temporal, AWS Step Functions, Camunda, a hand-rolled state table', 'Plain Kafka topics']
      ] },
    { t: 'prose',
      md: `The honest recommendation: orchestrate anything involving money or a compensation you would have to explain to a
customer, and choreograph the fan-out reactions. A hand-rolled orchestrator is a \`saga_instances\` table with a
state column, a step index, and a timer for stuck instances -- and if you find yourself building retries, timers and
versioned state machines, that is the point at which Temporal earns its keep.` },

    { t: 'h', text: 'CQRS and the projection lag the UI has to survive' },
    { t: 'prose',
      md: `CQRS separates the write model from the read model. Writes go to a normalised store optimised for invariants; a
projector consumes the event stream and maintains denormalised read models shaped exactly for each query --
Elasticsearch for search, a wide Postgres table for the dashboard, Redis for counters. Reads never touch the write
model, so each side scales and evolves independently.

The consequence is unavoidable and it is a *product* problem, not a technical one: **there is a window during which
a user's own write is not yet visible in the read model.** Typically tens to hundreds of milliseconds, occasionally
minutes when the projector is behind. A user who clicks "Save" and is redirected to a list built from the projection
will not see their change, will conclude it failed, and will do it again.

There are four ways to cope and you should know all four, because different screens want different ones:` },
    { t: 'grid',
      cols: 2,
      items: [
        { b: 'Optimistic UI', md: 'Render the expected result immediately from what the client just submitted, and reconcile when the projection catches up. Best UX, and you must design the failure path -- what the screen does when the write is rejected after you already showed success.' },
        { b: 'Read-your-writes token', md: 'The write returns a projection position; the client passes it on the next read; the read waits until the projection has caught up to it or falls back to the write model. Precise, and it needs support on both sides.' },
        { b: 'Return the projected entity', md: 'The command handler returns the full post-write representation, so the UI does not need to re-read at all. Simplest fix, and it only covers the screen you just came from.' },
        { b: 'Explicit pending state', md: 'Show the item as `Processing` with a real affordance. Honest, sometimes the only truthful option for genuinely long flows, and users accept it when the state is named.' }
      ] },
    { t: 'numbers',
      title: 'Projection lag budget',
      items: [
        { v: '<100 ms', k: 'Healthy projector', note: 'Unnoticeable with optimistic UI' },
        { v: '1-5 s', k: 'Under moderate load', note: 'Users notice on a redirect-after-save' },
        { v: 'minutes', k: 'During a rebuild or backlog', note: 'Needs an explicit UI state, not a spinner' },
        { v: '~2 hrs', k: 'Full rebuild of 500M events', note: 'At 70k events/sec with batched writes' }
      ] },

    { t: 'h', text: 'Schema evolution: events are a forever contract' },
    { t: 'prose',
      md: `An HTTP API version can be deprecated because you can see who calls it. An event in a retained log will be read by
code you have not written yet, possibly years from now, possibly during a replay. That makes event schemas the most
durable contract in your system.

The rules that keep you out of trouble are boring and non-negotiable. **Only ever add optional fields.** Never
remove or rename a field, never change a type, never repurpose a field's meaning -- the last one is the most
dangerous because nothing detects it. Never change the semantic meaning of an existing event type; emit a new type
instead. Use a schema registry (Confluent Schema Registry with Avro or Protobuf) with compatibility checks enforced
in CI, so a backwards-incompatible change fails the build rather than a consumer at 2 a.m.

When you genuinely must break compatibility, version the event *type* -- \`OrderPlaced.v2\` as a separate type --
and run both in parallel while consumers migrate. An upcaster that reads v1 and returns a v2 object keeps all your
downstream logic on one shape and is the standard trick in event-sourced systems.` },
    { t: 'code',
      lang: 'json',
      title: 'Envelope worth standardising on day one',
      code: `{
  "eventId":       "evt_01HQ8...",        // stable, unique -- the consumer dedupe key
  "eventType":     "OrderPlaced",
  "eventVersion":  2,
  "aggregateType": "Order",
  "aggregateId":   "ord_8891",            // partition key; preserves per-order order
  "sequence":      7,                     // position within this aggregate
  "occurredAt":    "2026-03-04T11:02:07.412Z",
  "traceId":       "4bf92f3577b34da6a3ce929d0e0e4736",
  "producer":      "order-service@2.14.1",
  "data": {
    "totalCents": 4299,
    "currency":   "USD",
    "couponCode": null
  }
}` },
    { t: 'prose',
      md: `Four fields there do disproportionate work. \`eventId\` is what the consumer dedupes on. \`sequence\` lets a
consumer detect a gap or an out-of-order delivery within one aggregate rather than trusting arrival order.
\`traceId\` is what makes the async hop visible in your tracing tool, and without it debugging a five-service flow
is reading logs by timestamp. And \`producer\` with a version tells you which deploy emitted the malformed event you
are now looking at in the DLQ.` },

    { t: 'h', text: 'Ordering across aggregates, and replay' },
    { t: 'prose',
      md: `Within one aggregate, partitioning by \`aggregateId\` gives you total order, and that is almost always the right
granularity -- it is the transactional boundary anyway. Across aggregates there is no global order and you should
not try to build one, because a single global partition means a single consumer and no parallelism at all.

So design consumers to be **order-tolerant** rather than assuming order. Carry the aggregate sequence number and
ignore anything you have already superseded: \`UPDATE ... WHERE sequence < $new\` makes a late-arriving old event a
no-op, which is the same optimistic-concurrency trick as a version column. Where a genuine cross-aggregate
dependency exists -- an \`OrderPlaced\` referencing a \`customerId\` you have never seen -- park the event in a
small waiting buffer and retry, rather than failing it into the DLQ.

**Replay** is the capability that makes event-driven systems worth the trouble, and it only works if you build for
it. A projector must be rebuildable from scratch: write to a *new* projection table or index while the old one
continues serving, then atomically switch a pointer or alias when the rebuild catches up. Never rebuild in place,
because you will have no read model for however long it takes. And be very clear about which consumers are safe to
replay -- replaying into the email service sends three years of receipts, which is a genuine incident that has
happened to real companies. Tag consumers as replay-safe or not, and enforce it in the tooling.` },

    { t: 'h', text: 'Trade-offs' },
    { t: 'tradeoffs',
      gains: [
        'The producer\'s availability and latency stop depending on any consumer; a downstream outage becomes a backlog.',
        'New consumers can be added with zero changes to the producer -- search, analytics and audit are subscriptions.',
        'An immutable event log is a natural audit trail, and with CDC you get it without writing audit code.',
        'Read models can be shaped per query, so each read path is fast without compromising the write model.',
        'Replay turns consumer bugs into "fix and reprocess" instead of permanent data loss.',
        'Bursts are absorbed as queue depth rather than propagating as failures.'
      ],
      costs: [
        'Eventual consistency leaks into the product: pending states, projection lag and optimistic-UI reconciliation are now design work.',
        'Every consumer needs an idempotency store with its own retention policy.',
        'Event schemas are a forever contract -- a schema registry plus CI compatibility checks become mandatory.',
        'Debugging spans N services and requires trace propagation through message headers to be survivable.',
        'Saga compensation logic is bespoke per flow and is the least-tested code you own.',
        'Event sourcing specifically adds snapshots, upcasters, replay tooling and a real learning curve.',
        'Local development and integration testing get materially harder.'
      ] },
    { t: 'failures',
      items: [
        { mode: 'Dual write -- DB commit then publish, with a crash between', blast: 'Orders exist that no downstream service knows about; discovered weeks later as a reconciliation gap with no audit trail.', fix: 'Transactional outbox in the same commit, drained by a polling relay or CDC. This is the whole reason the pattern exists.' },
        { mode: 'Publish-then-commit with a rolled-back transaction', blast: 'Consumers act on an order that does not exist; downstream state is built on a fiction and cannot be repaired automatically.', fix: 'Same fix. There is no safe ordering of two non-transactional writes.' },
        { mode: 'Non-idempotent consumer with at-least-once delivery', blast: 'Duplicate charges, double inventory decrements, two emails for one order.', fix: 'Dedupe on `eventId` in the same transaction as the effect; commit the offset only afterwards.' },
        { mode: 'Debezium down, replication slot pinning WAL', blast: 'Primary database disk fills and the whole application goes down -- caused by a pipeline component, not the database.', fix: 'Alert on slot lag, set `max_slot_wal_keep_size` so the slot is invalidated instead of the disk filling, and document the re-snapshot procedure.' },
        { mode: 'Breaking schema change to a live event type', blast: 'Every consumer starts failing deserialisation at once; messages pile into DLQs across several teams.', fix: 'Schema registry with backwards-compatibility enforced in CI; additive-only changes; a new event type when the meaning changes.' },
        { mode: 'Saga step fails and compensation is itself unreliable', blast: 'Money captured, seat never reserved, no compensation recorded -- permanently inconsistent state requiring manual repair.', fix: 'Persist saga state per step, make compensations idempotent and retriable with their own outbox, and alert on instances stuck beyond a timeout.' },
        { mode: 'Replay into a consumer with external side effects', blast: 'Three years of receipt emails sent in ten minutes; a customer-trust incident and possibly a blocked sending domain.', fix: 'Explicitly tag consumers replay-safe or not, enforce it in the replay tool, and route replays to a dedicated consumer group with side effects disabled.' },
        { mode: 'Projection rebuilt in place', blast: 'Search or dashboard returns empty results for the hours the rebuild takes.', fix: 'Build into a new table or index and switch an alias atomically when it catches up.' }
      ] },

    { t: 'staff',
      md: `Almost every candidate can describe pub/sub. The Staff signal is naming the dual-write problem unprompted and
treating eventual consistency as a product decision with an owner. Sentences that land:

- "The bug in that design is the dual write. The database commit and the Kafka publish are two
  independent writes with no shared transaction, so a crash between them loses the event
  silently -- no error, no retry. I would write the event to an outbox table in the same
  transaction and drain it with CDC."
- "I would point Debezium at the outbox table rather than the business tables, so my event
  schema is a deliberate contract instead of an accidental leak of column names I will want to
  rename."
- "Outbox plus CDC gives me at-least-once, not exactly-once, so every consumer needs a dedupe
  table keyed on \`eventId\`, inserted in the same transaction as the effect, with the offset
  committed after. The interesting question is the retention policy on that dedupe table."
- "I would send the full order state in the event rather than just the id. Notification-style
  events force every consumer to call me back, which re-creates the synchronous coupling the
  broker was meant to remove and adds a race with my read replica."
- "Event sourcing is a much bigger commitment than event-driven, and they get conflated. I would
  event-source the ledger, because the history *is* the product there, and I would keep the CRUD
  services on plain state with an outbox."
- "I would orchestrate the payment saga and choreograph the notifications. Anything where I would
  have to explain the compensation to a customer gets a state machine I can query; anything
  that is just a reaction gets a topic subscription."
- "Order the saga steps so the hardest thing to compensate goes last. Voiding an authorisation is
  clean, refunding a capture costs fees, and you cannot un-send an email -- so notification is
  always the final step."
- "Projection lag is a product decision, not a technical one. This screen redirects after save,
  so either the command returns the projected entity or we render optimistically. Otherwise the
  user concludes the save failed and submits twice."
- "The replication slot is my sharpest operational risk. If the CDC consumer is down for hours on
  a busy database, WAL accumulates and the primary's disk fills -- so I would cap
  \`max_slot_wal_keep_size\` and accept re-snapshotting over an outage."

The pattern: name the atomic boundary, name who enforces idempotency, and name the user-visible consequence of the
lag. Candidates who only draw boxes and arrows are describing the happy path.` },

    { t: 'quiz',
      items: [
        {
          q: 'A service inserts an order then publishes `OrderPlaced` to Kafka. It crashes between the two. What is the correct fix?',
          options: ['Publish to Kafka first, then insert the order.', 'Wrap both in a database transaction.', 'Insert the event into an outbox table in the same transaction, and publish from there via polling or CDC.', 'Retry the publish with exponential backoff.'],
          answer: 2,
          why: 'This is the dual-write problem and no ordering of two non-transactional writes is safe -- publishing first just swaps a missing event for a phantom one. A database transaction cannot enrol the Kafka publish. Retries only help if the process survives, and a crash is exactly the case that defeats them. The outbox makes the event durable in the same atomic commit as the state change; the relay can then crash freely and only ever cause duplicates, which idempotent consumers absorb.' },
        {
          q: 'Your booking saga captures payment, then reserves inventory, then emails confirmation. Inventory fails. What is the design problem?',
          options: ['Sagas cannot handle failures; you need 2PC.', 'Payment was captured rather than authorised, so compensation is a refund with fees rather than a clean void -- the hardest-to-reverse step ran first.', 'The email should have been sent before inventory.', 'Nothing -- compensating transactions handle this transparently.'],
          answer: 1,
          why: 'Compensation is semantic, not transactional, and its cost varies enormously by step. Authorise-then-capture-at-the-end means a failure is a void, which is invisible to the customer; capturing up front turns the same failure into a refund with fees, a statement entry and a support conversation. The heuristic is to order steps so the most expensive-to-compensate action happens last -- which is also why sending email is always the final step, since it cannot be compensated at all.' },
        {
          q: 'After adopting CQRS, users report their newly created item is missing from the list they are redirected to. Best first fix?',
          options: ['Make the projection synchronous with the write.', 'Have the command return the projected representation, or render optimistically from what the client submitted.', 'Add a 2-second delay before redirecting.', 'Read the list from the write model instead.'],
          answer: 1,
          why: 'This is projection lag, and it is a product problem with several valid answers depending on the screen. Making the projection synchronous destroys the independence that justified CQRS. A fixed delay is a guess that is both too long and too short. Reading the list from the write model works occasionally but the write model is normalised for invariants, not for that query, which is why the projection exists. Returning the entity from the command, or optimistic rendering with reconciliation, fixes the user-visible symptom without giving up the architecture.' },
        {
          q: 'Which change to a live, retained event schema is safe?',
          options: ['Renaming `total` to `totalCents` for clarity.', 'Adding an optional `couponCode` field with a default.', 'Changing `quantity` from string to integer.', 'Reusing the unused `notes` field to carry a status code.'],
          answer: 1,
          why: 'Only additive, optional changes are backwards compatible: old consumers ignore the new field and new consumers handle its absence. A rename is a delete plus an add, so every existing consumer breaks. A type change breaks deserialisation. Repurposing a field is the most dangerous of the four because it passes every schema check and silently corrupts the meaning of the data -- including for replays of historical events. When semantics change, emit a new event type and run both in parallel.'
        }
      ] },

    { t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{ t: 'prose',
        md: `The broker mechanics underneath all of this -- partitions, delivery semantics, DLQs, consumer lag -- are in **Queues
& Event Streaming**. The dedupe store is the same idea as the idempotency key in **API Design & Contracts** and the
lock-avoidance argument in **Consensus, Leases & Distributed Locks**. Sagas exist because cross-shard transactions
are impractical -- see **Sharding & Partitioning**. Projection lag is a specific instance of the client-centric
guarantees in **Replication & Consistency Models**, and trace propagation through message headers is covered in
**Observability, SLOs & Error Budgets**.`
      }]
    }
  ],

  flashcards: [
    { q: 'What is the dual-write problem?', a: 'Writing to your database and publishing to a broker are two independent non-transactional writes. A crash between them either loses the event silently or announces a state change that was rolled back. No ordering of the two is safe, so it must be designed away rather than handled carefully.' },
    { q: 'How does the transactional outbox fix it?', a: 'The event is inserted into a table in the same database transaction as the state change, so one atomic commit covers both. A separate relay reads the table and publishes, retrying freely -- it can only ever cause duplicates, which idempotent consumers absorb.' },
    { q: 'Why capture the outbox table with CDC rather than the business tables?', a: 'Because the event payload then stays a deliberately designed published contract. Capturing business tables makes your internal column names part of a forever contract, so you can never rename them.' },
    { q: 'What is the main operational risk of Debezium on Postgres?', a: 'The logical replication slot pins WAL until the consumer confirms it. A stalled connector on a busy database fills the primary\'s disk and causes a full outage. Cap `max_slot_wal_keep_size` so the slot is invalidated instead, and monitor slot lag.' },
    { q: 'Event notification vs event-carried state transfer?', a: 'Notification sends only an id, so consumers must call back -- re-creating the synchronous coupling the broker removed, plus a read-replica race. State transfer sends enough state to act independently, at the cost of larger messages and stricter schema discipline. State transfer is usually the right default.' },
    { q: 'Orchestration vs choreography -- when to use each?', a: 'Orchestrate anything with money or a compensation you would have to explain to a customer, because you get one queryable place for saga state and centralised, testable compensation. Choreograph loosely-coupled reactions like search indexing and notifications.' },
    { q: 'What is the key heuristic for ordering saga steps?', a: 'Put the hardest-to-compensate action last. Voiding an authorisation is clean, refunding a capture costs fees, and an email cannot be un-sent -- so notification is always the final step.' },
    { q: 'Four ways to handle projection lag in the UI?', a: 'Render optimistically from the submitted data and reconcile; carry a read-your-writes token so the read waits for the projection; return the projected entity directly from the command; or show an explicit pending state. Different screens want different ones.' },
    { q: 'Which event schema changes are safe on a retained log?', a: 'Only adding optional fields. Never rename, never change a type, and never repurpose a field -- the last passes every compatibility check while silently corrupting meaning, including for replays. When semantics change, emit a new event type and run both.' },
    { q: 'How do you rebuild a projection safely?', a: 'Build into a new table or index while the old one keeps serving, then switch a pointer or alias atomically once it has caught up. Never rebuild in place, and never replay into a consumer with external side effects like email.' }
  ],

  drills: [
    {
      prompt: 'A monolith is being split. The order service owns Postgres; inventory, email and a search index need to react to orders. The first implementation inserts the order and then publishes to Kafka. Finance has found 214 orders over three months with no corresponding inventory decrement. Design the correct architecture.',
      probes: [
        'What exactly caused the 214, and why was there no error to investigate?',
        'What do you put in the event payload, and why?',
        'Polling relay or CDC -- what decides it, and what is CDC\'s worst failure mode?',
        'A consumer has a bug and processes 50,000 events wrongly. What is your recovery?',
        'How do you evolve the event schema in a year when a new field is needed?'
      ],
      strong: [
        'Names the dual write specifically and explains that the lost events produce no error, retry or log line, which is why it took three months to surface.',
        'Specifies an outbox table written in the same transaction as the order, with `aggregate_id` as the Kafka key so per-order ordering is preserved.',
        'Chooses event-carried state transfer with a justification -- consumers act without calling back, and the callback pattern re-introduces synchronous coupling plus a read-replica race.',
        'Weighs polling (simple, ~200 ms latency, needs pruning) against CDC (millisecond latency, no query load) and names the replication-slot disk-fill risk with `max_slot_wal_keep_size` as the mitigation.',
        'Requires a dedupe table keyed on `eventId` in each consumer, written in the same transaction as the effect, with the offset committed afterwards and a stated retention policy.',
        'Recovery plan is a replay into a fresh consumer group with a rebuilt projection switched by alias, and explicitly flags that the email consumer must not be replayed.',
        'Commits to a schema registry with backwards-compatibility checks in CI and additive-only evolution, plus a standard envelope carrying `eventId`, `sequence` and `traceId`.'
      ],
      weak: [
        'Proposes publishing to Kafka before the insert, or wrapping both in a transaction.',
        'Relies on retries and a circuit breaker to make the publish reliable.',
        'Sends only the order id and does not notice consumers must now call back.',
        'No consumer-side idempotency, or a dedupe check outside the effect\'s transaction.',
        'Proposes replaying everything without distinguishing replay-safe consumers from email.',
        'Treats schema evolution as a later problem.'
      ] },
    {
      prompt: 'A team proposes full event sourcing for a new B2B project-management product: tasks, comments, assignments, boards. They cite audit history and the ability to build new read models later. You have three backend engineers, none of whom has run an event-sourced system. Give your recommendation.',
      probes: [
        'Which of their stated benefits can be had more cheaply?',
        'What specific machinery does event sourcing require that they have not mentioned?',
        'Is there any part of this product where event sourcing is genuinely right?',
        'What would you build instead, and what keeps the door open?'
      ],
      strong: [
        'Separates event-driven from event-sourced and notes the team is conflating them.',
        'Points out that audit history is available far more cheaply via CDC into an append-only audit table, or an outbox-fed event log alongside normal state.',
        'Names the machinery they omitted: snapshots so rebuilds are not O(all history), upcasters so old events stay readable, replay tooling, and a versioning discipline for every event type.',
        'Identifies where it might genuinely pay -- an audit or activity log where history is the product -- and scopes it there rather than across all aggregates.',
        'Recommends state-based services with a transactional outbox, which preserves the ability to add read models later, and states the concrete signal that would justify revisiting.',
        'Raises team capability as a legitimate engineering input rather than a soft concern: a routine bugfix should not require a design discussion.'
      ],
      weak: [
        'Rejects event sourcing as over-engineering without engaging with the benefits they cited.',
        'Approves it because auditability is a real requirement, with no mention of snapshots or versioning.',
        'Does not distinguish event-driven from event-sourced.',
        'Offers no incremental path that keeps the option open.'
      ]
    }
  ]
};
