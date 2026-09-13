export default {
  blocks: [
    {
      t: 'prose',
      md: `An API is a promise about behaviour that you cannot take back. Once a client depends on
a field name, a status code, or the fact that calling something twice was safe, that detail is
load-bearing -- and you will find out which details those were only when you break one.

Good API design is therefore mostly about two questions. What are you promising, stated precisely
enough that both sides can build against it? And how will you change it later without a
coordinated deploy across teams you do not control?`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `Inside a process, a function call either happens or does not, returns or throws, and
completes in nanoseconds. Across a network none of that holds. The call may have executed while
the response was lost. It may still be executing after you gave up. The caller may be an old
version of a mobile app that will never be upgraded. The callee may be three services deep with a
budget of 80 ms that nobody told you about.

Every convention in this topic exists to restore one of the guarantees the network took away.
Idempotency keys restore "exactly once". Deadline propagation restores "the caller is still
listening". Schema evolution rules restore "the types match". Error taxonomies restore "I know
whether retrying will help".`
    },

    {
      t: 'numbers',
      title: 'Figures that shape the contract',
      items: [
        { v: '24 h', k: 'Typical idempotency key TTL', note: 'Stripe\'s window; long enough for any client retry' },
        { v: '100,020', k: 'Rows read by `LIMIT 20 OFFSET 100000`', note: 'Keyset reads 20' },
        { v: '30-60%', k: 'Protobuf wire saving versus JSON', note: 'Plus much cheaper parsing' },
        { v: 'months', k: 'Calendar time for a mobile client to upgrade', note: 'The real cost of a breaking change' }
      ]
    },

    { t: 'h', text: 'Resource modelling in REST' },
    {
      t: 'prose',
      md: `REST's useful core is small: model *nouns* as URLs, use the HTTP method to say what you
are doing to them, and let the status code carry the outcome. \`POST /orders\` creates, \`GET
/orders/42\` reads, \`PATCH /orders/42\` partially updates, \`DELETE /orders/42\` removes. The
payoff is that every intermediary -- browsers, CDNs, proxies, API gateways -- already understands
those semantics, so \`GET\` is cacheable and retryable without you writing any code.

Where it goes wrong is verbs that are not CRUD. Cancelling an order, refunding a payment, or
replaying a webhook are not updates to a field; they are state transitions with their own
authorisation, side effects and failure modes. The pragmatic answer is to model the *action* as a
subresource: \`POST /orders/42/cancellations\` rather than \`PATCH /orders/42 {"status":
"cancelled"}\`. The first is naturally idempotency-keyed, auditable, and cannot be confused with
an unrelated field update; the second invites a client to "cancel" by writing a string and skips
every invariant you wanted to enforce.

The second common mistake is exposing your table layout. If \`GET /users/42\` returns exactly your
\`users\` row, then every column rename is a breaking API change and you have coupled your storage
migration schedule to your customers' release schedule.`
    },
    {
      t: 'table',
      title: 'Method semantics you are promising whether you meant to or not',
      cols: ['Method', 'Safe (no side effects)', 'Idempotent', 'Cacheable', 'Practical note'],
      rows: [
        ['`GET`', 'Yes', 'Yes', 'Yes', 'Proxies and clients *will* retry it. Never mutate in a GET.'],
        ['`HEAD`', 'Yes', 'Yes', 'Yes', 'Useful for existence and size checks without the body.'],
        ['`PUT`', 'No', 'Yes -- full replacement', 'No', 'Replaying it converges to the same state. Requires the full representation.'],
        ['`DELETE`', 'No', 'Yes', 'No', 'Second call returns `404` or `204`; pick one and document it.'],
        ['`PATCH`', 'No', 'Not inherently', 'No', 'Idempotent only if the body is absolute (`{"qty": 5}`), not relative (`{"qty": "+1"}`).'],
        ['`POST`', 'No', 'No', 'Only with explicit headers', 'The one that needs an idempotency key.']
      ]
    },

    { t: 'h', text: 'REST, gRPC or GraphQL' },
    {
      t: 'table',
      cols: ['Dimension', 'REST + JSON', 'gRPC + protobuf', 'GraphQL'],
      rows: [
        ['Wire size', 'Baseline', '30-60% smaller, binary', 'Similar to REST, often smaller per screen'],
        ['Parse cost', 'JSON parse dominates on large payloads', 'Fast, zero-copy-ish, generated code', 'JSON plus server-side query planning'],
        ['Schema enforcement', 'OpenAPI, advisory unless validated', 'Compile-time from `.proto`', 'Compile-time from SDL'],
        ['Streaming', 'SSE or WebSockets, bolted on', 'First class: server, client, bidirectional', 'Subscriptions, transport-dependent'],
        ['Deadlines', 'Manual header convention', 'Built in and propagated by the runtime', 'Manual'],
        ['Browser support', 'Native', 'Needs grpc-web plus a proxy', 'Native'],
        ['Caching by intermediaries', 'Works -- URL is the key', 'None; opaque POST bodies', 'Poor; one URL, POST bodies'],
        ['Multi-client field needs', 'Overfetch or proliferate endpoints', 'Same problem', 'Solved -- the client selects fields'],
        ['Operational debuggability', 'curl, logs, any proxy', 'Needs `grpcurl` and reflection', 'Needs the schema and a client'],
        ['Best fit', 'Public APIs, webhooks, anything cached', 'Internal service-to-service, high fan-out, strict contracts', 'Aggregation for diverse UI clients']
      ]
    },
    {
      t: 'prose',
      md: `The honest summary: use REST at the edge because the ecosystem is free, gRPC between
your own services because the schema and deadline propagation are worth the tooling cost, and
GraphQL only when you genuinely have many clients wanting different shapes of the same graph and
are prepared to own query-cost limiting, persisted queries and the N+1 resolver problem. GraphQL
without a dataloader layer and a complexity budget is a self-service denial-of-service endpoint
pointed at your database.`
    },

    { t: 'h', text: 'Idempotency keys' },
    {
      t: 'prose',
      md: `A client sends \`POST /payments\` for $400. The response is lost to a timeout. The client
cannot distinguish "did not execute" from "executed, reply lost", and both are common. If it
retries you may charge twice; if it does not, you may have lost a payment. This is the single most
important pattern in transactional API design, and Stripe's \`Idempotency-Key\` header is the
reference design worth copying.

The contract: the client generates a UUID per *logical operation* -- not per attempt -- and sends
it on every retry of that operation. The server stores the key with the outcome, and on seeing it
again replays the original response byte for byte instead of re-executing.

Three details separate a real implementation from a naive one. First, the key must be recorded
*in the same transaction* as the side effect, or a crash between them leaves you with a charge and
no key. Second, you must handle the concurrent in-flight case: two retries can arrive 5 ms apart,
so the key insert needs a uniqueness constraint that the second request loses, and it should then
return \`409\` and let the client retry rather than executing. Third, you must hash the request
body -- if the same key arrives with a different amount, that is a client bug, and returning the
old response silently would hide it. Return \`422\`.`
    },
    {
      t: 'code',
      lang: 'sql',
      title: 'Storage for idempotency keys',
      code: `CREATE TABLE idempotency_keys (
  key            text        PRIMARY KEY,
  tenant_id      uuid        NOT NULL,
  endpoint       text        NOT NULL,
  request_hash   text        NOT NULL,     -- sha256 of the canonical body
  state          text        NOT NULL,     -- 'in_flight' | 'completed'
  response_code  int,
  response_body  jsonb,
  resource_id    uuid,                     -- the thing we created
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL      -- created_at + 24 hours
);

-- Reap expired rows; without this the table grows without bound.
CREATE INDEX idx_idem_expiry ON idempotency_keys (expires_at)
  WHERE state = 'completed';`
    },
    {
      t: 'code',
      lang: 'javascript',
      title: 'The handler, including the in-flight race',
      code: `async function createPayment(req, res) {
  const key = req.header('Idempotency-Key');
  if (!key) return problem(res, 400, 'idempotency-key-required');

  const hash = sha256(canonicalJson(req.body));

  // One statement claims the key. The unique index is the lock.
  const claim = await db.query(
    \`INSERT INTO idempotency_keys
       (key, tenant_id, endpoint, request_hash, state, expires_at)
     VALUES ($1, $2, $3, $4, 'in_flight', now() + interval '24 hours')
     ON CONFLICT (key) DO NOTHING
     RETURNING key\`,
    [key, req.tenant.id, 'POST /payments', hash]
  );

  if (claim.rowCount === 0) {
    const prior = await db.one(
      'SELECT * FROM idempotency_keys WHERE key = $1', [key]
    );
    if (prior.request_hash !== hash) {
      // Same key, different body: a client bug we must surface.
      return problem(res, 422, 'idempotency-key-reused');
    }
    if (prior.state === 'in_flight') {
      // A sibling attempt is mid-flight. Do not execute concurrently.
      res.set('Retry-After', '1');
      return problem(res, 409, 'request-in-progress');
    }
    return res.status(prior.response_code).json(prior.response_body); // replay
  }

  // We own the key. Side effect and record must commit together.
  const result = await db.tx(async tx => {
    const payment = await chargeAndInsert(tx, req.body);
    await tx.query(
      \`UPDATE idempotency_keys
          SET state='completed', response_code=201,
              response_body=$2, resource_id=$3
        WHERE key=$1\`,
      [key, JSON.stringify(payment), payment.id]
    );
    return payment;
  });

  return res.status(201).json(result);
}`
    },
    {
      t: 'note',
      tone: 'warn',
      title: 'The part that is genuinely hard',
      md: `If the side effect is a call to an *external* payment processor rather than a database
write, you cannot put it in your transaction. The honest design is to insert the \`in_flight\` key
first, commit, then call the processor passing *your* key as its idempotency key, then record the
outcome. A crash in the middle leaves an \`in_flight\` row of unknown status, which is why you
also need a reconciliation job that asks the processor about stale \`in_flight\` keys. Candidates
who mention that reconciliation loop unprompted have built this before.`
    },

    { t: 'h', text: 'Pagination' },
    {
      t: 'prose',
      md: `Offset pagination is the default everywhere and it degrades in a way that is invisible
in development. \`LIMIT 20 OFFSET 100000\` does not skip to row 100,000 -- the database must read
and discard 100,000 rows to find where page 5,001 starts. Cost grows linearly with page number, so
page 1 is 0.4 ms and page 5,000 is 900 ms, and the users who reach page 5,000 are your crawlers
and your data-export scripts, which hit every page.

It is also *incorrect* under concurrent writes. If a row is inserted before your offset between
requests, everything shifts by one and the reader silently skips an item. Keyset (cursor)
pagination fixes both by remembering *where you were* rather than *how many you skipped*.`
    },
    {
      t: 'code',
      lang: 'sql',
      title: 'Offset versus keyset, with the index that makes keyset work',
      code: `-- OFFSET: reads and throws away 100,000 rows.
SELECT id, created_at, title
  FROM posts
 WHERE feed_id = 7
 ORDER BY created_at DESC, id DESC
 LIMIT 20 OFFSET 100000;
-- Postgres: "Limit ... rows=20 loops=1" but actual rows read = 100,020.

-- KEYSET: reads exactly 20 rows regardless of depth.
SELECT id, created_at, title
  FROM posts
 WHERE feed_id = 7
   AND (created_at, id) < ($1, $2)      -- the decoded cursor, a tuple
 ORDER BY created_at DESC, id DESC
 LIMIT 20;

-- Both need this; only keyset can actually use it as a seek.
CREATE INDEX idx_posts_feed_time ON posts (feed_id, created_at DESC, id DESC);`
    },
    {
      t: 'prose',
      md: `Two details make keyset pagination production-grade. The sort key must be **unique**, so
you append a tiebreaker like \`id\` and compare tuples -- ordering by \`created_at\` alone with
duplicate timestamps will either repeat or skip rows at page boundaries. And the cursor should be
**opaque**: base64-encode it, ideally with a signature, so that clients cannot construct one and
you remain free to change the sort key later without breaking anyone.

The cost is real: you lose "jump to page 37" and you lose a total count, because counting requires
scanning. Offer an approximate count from \`pg_class.reltuples\` or a materialised counter if the
product genuinely needs it, and reserve offset pagination for small, bounded, admin-facing lists.`
    },
    {
      t: 'table',
      cols: ['Property', 'Offset / limit', 'Keyset / cursor'],
      rows: [
        ['Cost at page N', 'O(N × page size) rows read', 'O(page size), constant'],
        ['Stable under concurrent inserts', 'No -- rows skipped or repeated', 'Yes'],
        ['Random page access', 'Yes', 'No -- sequential only'],
        ['Total count available', 'Usually, at scan cost', 'Not without extra work'],
        ['Index requirement', 'Helps but cannot avoid the scan', 'Mandatory, and must match sort order exactly'],
        ['Good for', 'Admin tables under a few thousand rows', 'Feeds, exports, any public list API']
      ]
    },

    { t: 'h', text: 'Errors clients can act on' },
    {
      t: 'prose',
      md: `The question a client is really asking when it gets an error is: *should I retry, fix my
request, or tell the user?* A bare \`500 {"error": "something went wrong"}\` answers none of them,
so every client ends up string-matching your error messages, and your next log-message tidy-up
becomes a breaking change.

**RFC 9457** (which supersedes RFC 7807) standardises the shape: content type
\`application/problem+json\`, with \`type\` as a stable URI that is the real machine-readable
identifier, plus \`title\`, \`status\`, \`detail\` and \`instance\`. You extend it with your own
members -- an error code enum, field-level violations, a retryability hint, a trace id.`
    },
    {
      t: 'code',
      lang: 'http',
      title: 'A problem response worth building clients against',
      code: `HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json
Retry-After: 0

{
  "type": "https://api.example.com/problems/insufficient-funds",
  "title": "Insufficient funds",
  "status": 422,
  "detail": "Wallet 9f3c has 1250 cents available; 40000 requested.",
  "instance": "/payments/01HQ8Z",
  "code": "WALLET_INSUFFICIENT_FUNDS",
  "retryable": false,
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "errors": [
    { "field": "amount", "code": "EXCEEDS_BALANCE", "max": 1250 }
  ]
}`
    },
    {
      t: 'table',
      title: 'Error taxonomy: what each class tells a client to do',
      cols: ['Status', 'Meaning', 'Client action', 'Common misuse'],
      rows: [
        ['`400`', 'Malformed syntax', 'Fix and do not retry', 'Used for every validation and auth failure alike'],
        ['`401`', 'No or invalid credentials', 'Refresh token, retry once', 'Confused with `403`'],
        ['`403`', 'Authenticated but not permitted', 'Do not retry; show a message', 'Returned where `404` would avoid leaking existence'],
        ['`404`', 'Not found (or hidden)', 'Do not retry', 'Returned for a valid id the caller cannot see -- correct, but document it'],
        ['`409`', 'State conflict', 'Re-read and re-decide', 'Used as a generic dumping ground'],
        ['`422`', 'Syntactically valid, semantically wrong', 'Fix input; never retry unchanged', 'Collapsed into `400`, so clients cannot distinguish'],
        ['`429`', 'Rate limited', 'Back off per `Retry-After`', 'Sent without `Retry-After`, forcing clients to guess'],
        ['`499` / client cancel', 'Caller gave up', 'Nothing -- stop work server-side', 'Logged as a server error, polluting your SLO'],
        ['`500`', 'Unexpected server bug', 'Retry only if the operation is idempotent', 'Used for downstream timeouts, which are `503`/`504`'],
        ['`503`', 'Temporarily unavailable, shed or unhealthy', 'Retry with backoff and jitter', 'Not distinguished from `500`, so clients cannot retry safely'],
        ['`504`', 'Upstream deadline exceeded', 'Retry only if idempotent; consider it slow, not broken', 'Retried aggressively, amplifying the original overload']
      ]
    },

    { t: 'h', text: 'Deadline propagation' },
    {
      t: 'prose',
      md: `A timeout is a per-hop number; a **deadline** is an absolute instant shared by the whole
call tree. The difference matters because per-hop timeouts multiply. If the gateway allows 2 s and
each of four services allows 2 s to its dependency, a request can consume 8 s while the user left
after 2 -- and every one of those services is still burning CPU and holding a database connection
for work whose result nobody will read. That is how a latency problem becomes a capacity problem.

The fix is to send the remaining budget with the request and have each hop subtract its own
overhead. gRPC does this natively: a client deadline becomes the \`grpc-timeout\` header, the
server exposes it on the context, and any outbound call from that context inherits what is left.
In HTTP you implement the same idea by convention.`
    },
    {
      t: 'diagram',
      code: `flowchart LR
  C["Client<br/>budget 800 ms"] --> G["Gateway<br/>remaining 760 ms"]
  G --> A["Orders<br/>remaining 700 ms"]
  A --> B["Pricing<br/>remaining 250 ms"]
  A --> D["Inventory<br/>remaining 250 ms"]
  B --> E[("Cache")]
  D --> F[("Postgres<br/>statement_timeout 200 ms")]
  A -.->|"budget exhausted<br/>return partial"| G`,
      caption: 'Each hop subtracts network overhead and reserves time to serialise a response. The database statement timeout is the last link in the chain -- if it is longer than the remaining budget, you have a query nobody is waiting for.'
    },
    {
      t: 'code',
      lang: 'javascript',
      title: 'Deadline propagation over HTTP by convention',
      code: `// Inbound: trust an internal header, clamp it to a maximum.
const MAX_BUDGET_MS = 5000;
function deadlineFrom(req) {
  const hinted = Number(req.header('X-Request-Deadline-Ms'));
  const budget = Number.isFinite(hinted)
    ? Math.min(hinted, MAX_BUDGET_MS)
    : MAX_BUDGET_MS;
  return Date.now() + budget;
}

// Outbound: spend what is left, minus a reserve for our own response.
async function callDownstream(deadline, url, body) {
  const RESERVE_MS = 30;               // serialise + write the response
  const remaining = deadline - Date.now() - RESERVE_MS;
  if (remaining <= 0) throw new DeadlineExceeded();

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), remaining);
  try {
    return await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'content-type': 'application/json',
        'X-Request-Deadline-Ms': String(remaining)
      },
      body: JSON.stringify(body)
    });
  } finally { clearTimeout(t); }
}

// And push it all the way down: per-request statement timeout.
await client.query('SET LOCAL statement_timeout = $1', [remaining]);`
    },

    { t: 'h', text: 'Versioning and schema evolution' },
    {
      t: 'prose',
      md: `Versioning strategy is a question about *who is forced to act*. A URL version
(\`/v2/orders\`) is explicit and trivially routable, but it fragments your codebase and every
client must do work to move. A header or media-type version keeps URLs stable and lets you route
per request, at the cost of being invisible in logs and easy to forget. Stripe's date-pinned
versioning (\`Stripe-Version: 2024-06-20\`) pins each account to the version it integrated against
and translates old shapes forward in a chain of transformation functions -- excellent for clients,
and it means someone maintains 60 compatibility shims forever.

For internal services the better answer is usually **no version at all**, because you keep the
schema additively compatible. Protobuf is designed for exactly this, and the rules are mechanical
enough to enforce in CI with a tool like Buf.`
    },
    {
      t: 'table',
      title: 'Protobuf changes: safe, unsafe, and why',
      cols: ['Change', 'Verdict', 'Reason'],
      rows: [
        ['Add a new field with a fresh tag number', 'Safe', 'Old readers skip unknown fields; the field reads as its default.'],
        ['Remove a field', 'Safe *only* if you `reserved` the tag and name', 'Reuse of the tag would silently reinterpret old bytes as a new type.'],
        ['Rename a field, same tag', 'Safe on the wire, breaks JSON mapping', 'Protobuf keys on the tag number; `grpc-gateway` and JSON keys on the name.'],
        ['Change the tag number', 'Breaking', 'The tag *is* the identity of the field.'],
        ['`int32` to `int64`', 'Safe', 'Both varint; old readers may truncate large values.'],
        ['`int32` to `string`', 'Breaking', 'Different wire type; the parser misreads the field.'],
        ['`optional` to `repeated`', 'Breaking for most languages', 'Cardinality is part of the generated type.'],
        ['Add a value to an `enum`', 'Risky', 'Old readers see the unknown value as the zero value -- always define a `*_UNSPECIFIED = 0`.'],
        ['Move a field into a `oneof`', 'Breaking', 'Changes the generated accessor and mutual-exclusion semantics.']
      ]
    },
    {
      t: 'note',
      tone: 'info',
      title: 'The expand-migrate-contract loop',
      md: `Any field change becomes two safe deploys plus a wait. **Expand**: add the new field,
write both, read the old one preferentially. **Migrate**: backfill, flip readers to prefer the new
field, keep writing both. **Contract**: stop writing the old field, \`reserved\` the tag, remove
it. The wait between steps is however long the slowest client takes to upgrade -- which for a
mobile app is *months*, and for a partner integration may be *never*. Budget the calendar time,
not the engineering time.`
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      title: 'Strict contracts, idempotency and deadline propagation',
      gains: [
        'Retries become safe, so clients can be aggressive without double-charging.',
        'Clients can branch on machine-readable error codes instead of parsing prose.',
        'Work is abandoned when nobody is listening, returning capacity during overload.',
        'Additive schema rules let services deploy independently with no version negotiation.',
        'Keyset pagination keeps page-5000 as cheap as page-1, so exports stop hurting.'
      ],
      costs: [
        'Idempotency adds a table, a TTL reaper, a request hash and a reconciliation job.',
        'Deadline plumbing must reach every client library or it silently does nothing.',
        'Cursors remove "jump to page N" and cheap total counts.',
        'Protobuf needs codegen in CI and `grpcurl` for humans to debug anything.',
        'Date-pinned versioning means maintaining compatibility shims indefinitely.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'Idempotency key generated per attempt rather than per operation', blast: 'Every retry is a new key, so a network timeout becomes a duplicate charge.', fix: 'Generate the key where the user intent originates, persist it with the attempt, reuse across retries.' },
        { mode: 'Key recorded outside the transaction that has the side effect', blast: 'Crash between the two leaves a charge with no key; the next retry charges again.', fix: 'Single transaction for local writes; for external calls, write `in_flight` first and reconcile stale rows.' },
        { mode: 'Per-hop timeouts instead of a shared deadline', blast: '4 hops of 2 s means 8 s of work for a user who left after 2 s; overload feeds on itself.', fix: 'Propagate an absolute deadline, subtract at each hop, push down to `statement_timeout`.' },
        { mode: 'Downstream timeout returned as `500`', blast: 'Clients cannot tell retryable from permanent, so they either never retry or retry everything.', fix: '`503` for shed or unhealthy, `504` for upstream deadline, `500` only for genuine bugs; add an explicit `retryable` field.' },
        { mode: 'Offset pagination on a public list endpoint', blast: 'Crawlers walking to page 5,000 execute 900 ms queries and saturate the read replica.', fix: 'Keyset cursors with a unique tiebreaker; cap or forbid deep offsets.' },
        { mode: 'Enum value added without an `UNSPECIFIED = 0`', blast: 'Old clients silently map the new value to the first enum member and mis-handle it.', fix: 'Always reserve 0 as unspecified; treat unknown values as unspecified and log them.' },
        { mode: 'Tag number reused after a field was deleted', blast: 'Old serialised bytes are reinterpreted as a different type -- data corruption, not an error.', fix: '`reserved 7, 9;` plus `reserved "old_name";` and a CI breaking-change check.' },
        { mode: 'Error bodies without a stable code', blast: 'Clients regex the `detail` string; a log-message tidy-up breaks production integrations.', fix: 'Stable `type` URI and `code` enum treated as public API and covered by tests.' }
      ]
    },

    {
      t: 'staff',
      md: `Junior answers describe an endpoint. Staff answers describe a *contract under failure*.
The sentences that do the work:

- "A \`POST /payments\` that times out is ambiguous to the client, so it needs an
\`Idempotency-Key\`. I would write the key and the charge in one transaction, hash the body so a
reused key with different arguments returns \`422\` rather than replaying, and return \`409\` if a
sibling attempt is still in flight so we never execute twice concurrently."
- "If the side effect is an external processor call, it cannot be in my transaction. I'd insert
\`in_flight\`, commit, pass my key as the processor's idempotency key, then record the result -- and
I'd own a reconciliation job for keys stuck \`in_flight\`, because that is the only state a crash
can leave behind."
- "I would not expose offset pagination on a public list. \`OFFSET 100000\` reads 100,020 rows, and
the callers who go that deep are the ones hitting every page. Keyset on \`(created_at, id)\` with
an opaque cursor is constant cost and stable under concurrent inserts."
- "Per-hop timeouts multiply. I want an absolute deadline on the request, each hop subtracting its
own overhead and a reserve, and the remainder pushed into \`SET LOCAL statement_timeout\` -- so we
stop paying for work no one is waiting for."
- "\`500\` and \`504\` are different instructions to the client. I want \`503\` for load shedding
with a \`Retry-After\`, \`504\` for an upstream deadline, and an explicit \`retryable\` flag, so a
client's retry policy is driven by my semantics rather than by guessing."
- "For internal services I would rather have no version and enforce additive-only protobuf changes
in CI with Buf. Versioning is a promise to maintain two code paths, and date-pinned versioning is a
promise to maintain sixty."

What each signals: the first three show you have debugged duplicate writes and slow list
endpoints in production. The deadline point shows you understand that abandoned work is a capacity
problem. The error-taxonomy point shows you think about the client's control flow, not just your
own. Naming \`reserved\` tags and \`UNSPECIFIED = 0\` unprompted is a small detail that reliably
separates people who have shipped protobuf from people who have read about it.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'A mobile client retries `POST /orders` after a timeout, generating a fresh `Idempotency-Key` for each attempt. What happens and why?',
          options: [
            'Nothing -- the server deduplicates on request body.',
            'Duplicate orders, because the key identifies the attempt rather than the operation.',
            'The server returns `409` for the second attempt.',
            'The first key expires and the retry replays the original response.'
          ],
          answer: 1,
          why: 'The key must be minted once where the user intent originates and reused across every retry of that intent, including retries after an app restart -- which means persisting it locally with the pending request. A per-attempt key makes the mechanism a no-op while looking correct in code review. Body hashing does not save you either: two identical orders are legitimately different operations, so the server cannot deduplicate on content alone.'
        },
        {
          q: 'Your API gateway allows 3 s, and each of three internal hops independently allows 3 s to its dependency. A user abandons after 3 s. What is the worst case, and why does it matter beyond latency?',
          options: [
            '3 s total; the gateway cancels everything downstream.',
            'Up to 9 s of work continues for a request no one is waiting for, consuming threads and DB connections.',
            '9 s, but harmless because the response is discarded.',
            'The innermost service times out first, so the total is 3 s.'
          ],
          answer: 1,
          why: 'Per-hop timeouts add up down the chain, and without cancellation the abandoned work keeps holding a worker, a pooled connection and a running query. Under load that turns a latency incident into a capacity incident, because the system spends an increasing share of its resources on results nobody will read. An absolute deadline propagated per hop -- and pushed into `statement_timeout` -- lets each layer stop as soon as the budget is gone.'
        },
        {
          q: 'A protobuf field `int32 quantity = 7;` is deleted in a release. Six months later someone adds `string sku = 7;`. What is the consequence?',
          options: [
            'A compile error in every client.',
            'Old encoded messages are misparsed, because the tag number is the field identity.',
            'Nothing -- field names are what matter.',
            'The new field is ignored by all readers.'
          ],
          answer: 1,
          why: 'Protobuf encodes the tag number, not the name, so tag 7 in an old message body is now decoded as a `string` when it holds varint bytes -- a parse error at best and silent corruption at worst. `reserved 7;` plus `reserved "quantity";` makes reuse a compile-time error, and a CI breaking-change detector catches it before merge. This is why removing a field is only "safe" when paired with reservation.'
        },
        {
          q: 'Which pagination design is correct for a public feed API where clients also run nightly full exports?',
          options: [
            '`LIMIT/OFFSET` with a hard cap of 1,000 pages.',
            'Keyset pagination on `(created_at, id)` with an opaque base64 cursor.',
            'Keyset pagination on `created_at` alone.',
            '`LIMIT/OFFSET` plus a covering index to keep it fast.'
          ],
          answer: 1,
          why: 'Keyset is constant cost at any depth and stable while rows are being inserted, which matters most for exactly the export use case. The tiebreaker is not optional: ordering on `created_at` alone with duplicate timestamps will repeat or drop rows across page boundaries. An index cannot rescue offset, because the database still has to traverse and discard every skipped entry before it reaches the requested window.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `The retry safety that idempotency keys enable is only half the story -- the backoff,
jitter and retry-budget half lives in **Resilience: Timeouts, Retries & Backpressure**. Keyset
pagination depends entirely on an index matching the sort order, which is **Databases, Indexes &
Query Plans**. Writing the key and the side effect atomically is a transaction-boundary question,
covered in **Transactions & Isolation Levels**; when the side effect is remote, the outbox pattern
in **Event-Driven Architecture, Sagas & CQRS** is the general form. \`429\` semantics and
\`RateLimit-*\` headers are specified in **Rate Limiting & Multi-Tenancy**.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why must an idempotency key be per-operation rather than per-attempt?', a: 'The whole point is that the server recognises a retry of the same intent. A new key per attempt makes every retry a distinct operation, so a lost response becomes a duplicate write while the code looks correct.' },
    { q: 'How do you handle two concurrent retries with the same idempotency key?', a: 'Claim the key with a unique-constrained insert. The loser sees state `in_flight` and returns `409` with `Retry-After` rather than executing; once the winner commits `completed`, subsequent calls replay the stored response.' },
    { q: 'Why hash the request body alongside the idempotency key?', a: 'Same key with a different body is a client bug. Replaying the old response would hide it, so return `422 idempotency-key-reused` instead.' },
    { q: 'Why does `LIMIT 20 OFFSET 100000` get slow?', a: 'The database reads and discards 100,000 rows to locate the window, so cost grows linearly with page depth. It is also unstable: concurrent inserts shift the offset and rows get skipped.' },
    { q: 'What two details make keyset pagination correct?', a: 'A unique sort key -- compare a tuple like `(created_at, id)` so duplicate timestamps cannot repeat or drop rows -- and an opaque, ideally signed cursor so clients cannot construct one and you can change the sort key later.' },
    { q: 'Difference between a timeout and a deadline?', a: 'A timeout is a per-hop duration and therefore multiplies down a call chain. A deadline is an absolute instant shared by the whole tree; each hop spends what remains minus its own reserve, so total time stays bounded.' },
    { q: 'What should `500` versus `503` versus `504` tell a client?', a: '`500` is an unexpected bug -- retry only if idempotent. `503` is temporary unavailability or shedding -- retry with backoff, honouring `Retry-After`. `504` is an upstream deadline -- the work may still be running, so retry cautiously.' },
    { q: 'Which protobuf changes are safe?', a: 'Adding a field with a fresh tag, widening `int32` to `int64`, and removing a field *if* you `reserved` its tag and name. Changing a tag number, changing wire type, altering cardinality, or moving a field into a `oneof` are breaking.' },
    { q: 'Why does every protobuf enum need a zero value named `UNSPECIFIED`?', a: 'Unknown enum values decode to the zero value in old readers. If zero is a real business meaning, a newly added value silently becomes that meaning; if zero is `UNSPECIFIED`, the client can detect and log it.' }
  ],

  drills: [
    {
      prompt: 'You own a payments API. Mobile clients are on flaky networks: roughly 2% of requests time out client-side, and support sees around 30 duplicate charges a week on 400,000 payments. Design the fix end to end, including what happens when your own process crashes mid-charge and the charge goes to an external processor you do not control.',
      probes: [
        'Where exactly is the key generated, and does it survive an app restart?',
        'Two retries arrive 5 ms apart. What does each one do?',
        'You crash after calling the processor and before recording the outcome. What state exists, and who cleans it up?',
        'How long do you keep keys, and what does the client see after that?',
        'Same key, different amount. What do you return?'
      ],
      strong: [
        'Key minted per user intent and persisted client-side so it survives restarts.',
        'Unique-constrained insert as the claim; loser returns `409` with `Retry-After` rather than executing.',
        'Recognises the external call cannot be inside the DB transaction; writes `in_flight`, commits, then calls the processor with the same key.',
        'Names a reconciliation job that queries the processor for stale `in_flight` keys.',
        'Stores the response body and replays it byte-for-byte, including the original status code.',
        'Body hash producing `422` on key reuse with different arguments.',
        'Explicit TTL (24h-7d) with a reaper, and a documented behaviour once the key expires.'
      ],
      weak: [
        'Deduplicates on request body alone, so two legitimate identical payments collapse into one.',
        'Checks for an existing key with a `SELECT` then inserts, leaving a race between the two statements.',
        'Puts the external processor call inside the database transaction.',
        'Has no answer for keys left `in_flight` by a crash.',
        'Stores only "already processed" and returns a different response shape on the replay.',
        'Keeps keys forever, or never mentions TTL at all.'
      ]
    },
    {
      prompt: 'An internal gRPC service has 14 client teams. You need to change `int32 amount_cents` to a `Money` message with currency, because a new market needs non-USD. You cannot coordinate a simultaneous deploy, and two clients are on a quarterly release train. Plan the migration.',
      probes: [
        'What is the first deploy, and what does it break?',
        'How do writers and readers behave while both fields exist?',
        'How do you know when it is safe to remove the old field?',
        'What stops someone reusing the old tag number in 2027?',
        'What would you do differently if one client were an unupgradable mobile app?'
      ],
      strong: [
        'Expand-migrate-contract with the old and new field coexisting and both written.',
        'Adds `Money money = 12;` with a fresh tag rather than changing tag on the existing field.',
        'Defines precedence clearly: read new field if set, else fall back, and treats absent as USD during migration.',
        'Instruments per-client-version usage of the old field so removal is data-driven, not calendar-driven.',
        '`reserved 4; reserved "amount_cents";` on contract, plus a Buf breaking-change check in CI.',
        'States that calendar time is bounded by the slowest client, not by engineering effort.'
      ],
      weak: [
        'Changes the field type in place and calls it a minor release.',
        'Creates `v2` of the whole service for one field change without considering additive evolution.',
        'Assumes all clients upgrade on merge.',
        'Removes the old field on a fixed date with no usage telemetry.',
        'Never mentions tag reservation or a CI compatibility gate.'
      ]
    }
  ]
};
