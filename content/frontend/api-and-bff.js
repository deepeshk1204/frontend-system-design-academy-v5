export default {
  blocks: [
    {
      t: 'prose',
      md: `An API contract is a promise about what a client may send and what it will get back. A
Backend-for-Frontend is a service owned by the client team that sits between that client and the
services behind it, translating a domain-shaped world into a screen-shaped one.

The reason both belong in one topic is that they answer the same question from opposite sides.
The contract asks "what should this API look like?" The BFF asks "who gets to decide?" Most of
the pain in large frontends comes from the second question being unanswered -- the client ends up
orchestrating eleven backend calls because nobody owns the aggregation, or the BFF quietly grows
into a second monolith because nobody defined what it is *not* allowed to contain.`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `When there was one web client and one backend, they could share a data model and it
mostly worked. Then there were three clients -- web, iOS, Android -- and a dozen backend services,
and the mismatch became structural.

Backend services are organised around *domains*: a users service, an orders service, a pricing
service, an inventory service. That is the right decomposition for the people who own them,
because it matches the transactional boundaries and the on-call rotations. But a screen is not a
domain. An order-confirmation screen needs one field from users, three from orders, one from
pricing, and a shipping estimate. So somebody has to do the joining.

If the client does it, you get a waterfall of round trips over the worst network in the system,
plus business logic spread across three platforms that must be released independently. If a
shared backend does it, every screen change needs a backend team's roadmap slot, and the
"generic" API accumulates \`?include=\` parameters and view-specific flags until nobody can change
it safely. The BFF is the third option: a thin, client-team-owned layer that does the joining in
the datacentre where the round trips are 0.5 ms instead of 200 ms, and that can change as fast as
the screen it serves.`
    },
    {
      t: 'diagram',
      code: `flowchart LR
  W["Web app"] --> BW["Web BFF"]
  M["Mobile app"] --> BM["Mobile BFF"]
  P["Partner API"] --> G["Public gateway"]
  BW --> U["Users service"]
  BW --> O["Orders service"]
  BW --> PR["Pricing service"]
  BM --> U
  BM --> O
  G --> O
  PR --> DB[("Pricing DB")]`,
      caption: 'Each client team owns its own BFF and can change it at the speed of its UI. The domain services stay domain-shaped and are never reshaped for one screen.'
    },

    { t: 'h', text: 'REST, and what "maturity" actually means' },
    {
      t: 'prose',
      md: `The Richardson Maturity Model is the standard framing and it is worth knowing because
it gives you vocabulary for what most "REST" APIs actually are.

Level 0 is a single endpoint taking RPC-ish payloads -- \`POST /api\` with an \`action\` field.
Level 1 introduces resources, so you have \`/orders/42\` instead of one endpoint. Level 2 uses HTTP
methods and status codes as intended: \`GET\` is safe and cacheable, \`DELETE\` is idempotent, and a
validation failure is a \`422\` rather than a \`200\` with \`{"success": false}\`. Level 3 adds
hypermedia -- the response tells the client what transitions are available via links.

In practice almost every production API is Level 2, and that is fine. Level 3 is genuinely
valuable in one specific situation -- when clients are third parties you cannot coordinate
deploys with, so you want the server to be able to change available actions without a client
release. Inside a company where the client and server ship together, hypermedia usually adds
ceremony without adding capability, and it is honest to say so.

What matters more than the level is whether the API is **resource-shaped or screen-shaped**. A
resource-shaped API is stable and reusable and requires the client to make several calls. A
screen-shaped API is one call per screen and has to change every time the design changes. That
tension is precisely what the BFF resolves: keep the domain services resource-shaped, and let the
BFF be screen-shaped.`
    },

    { t: 'h', text: 'GraphQL: what it solves and what it costs' },
    {
      t: 'prose',
      md: `GraphQL lets the client specify exactly which fields it wants across a graph of related
types, in one request. That genuinely eliminates both over-fetching and under-fetching, and it is
transformative when you have many clients with different data needs against one large domain
graph -- which is why it came out of Facebook's mobile problem.

The costs are specific and you should be able to name all four.

**The N+1 problem.** A resolver for \`posts { author { name } }\` runs the author resolver once per
post, so 50 posts means 51 database queries. The fix is **DataLoader**, which batches all
resolver calls made within one tick of the event loop into a single \`WHERE id IN (...)\` query and
caches per request. This is not optional at scale; a GraphQL API without batched loaders will
melt its database.

**Unbounded query cost.** Because the client writes the query, the client controls your server's
workload. A deeply nested query -- \`user { friends { friends { friends { posts } } } }\` -- can be
exponentially expensive, and it is a trivially available denial of service. Three defences, used
together: a **depth limit**, a **complexity budget** where each field has a cost and the total is
capped, and **persisted queries**, where clients register queries at build time and send only a
hash at runtime. Persisted queries turn an open query language into a closed allowlist, which is
the single highest-value control.

**The caching problem.** This is the one people underrate. GraphQL conventionally uses \`POST\` to
a single \`/graphql\` endpoint, which means every request has the same URL and a body that varies.
HTTP caching -- browser cache, CDN, \`304\` revalidation -- is keyed on URL and method, so *none of
it works*. You have thrown away a decade of free infrastructure. You get it back partially with
persisted queries sent as \`GET /graphql?id=<hash>&variables=...\`, which restores a cacheable URL,
and otherwise you are building caching in the client (Apollo's normalised store, Relay) and in
the server (a Redis layer per resolver). Compare that to REST, where \`GET /products/42\` is
cacheable at seven layers for free.

**Error semantics.** GraphQL returns \`200 OK\` with an \`errors\` array, including for partial
failures. That is a reasonable design -- partial data is often useful -- but it means HTTP status
codes stop being a correctness signal, so every dashboard, alert and load-balancer health check
built on status codes silently stops working.`
    },
    {
      t: 'code',
      lang: 'js',
      title: 'The three GraphQL controls, concretely',
      code: `// 1. DataLoader: 51 queries become 2.
const authorLoader = new DataLoader(async ids => {
  const rows = await db.users.whereIn('id', ids);   // one query
  const byId = new Map(rows.map(r => [r.id, r]));
  return ids.map(id => byId.get(id) ?? null);       // order must match
});
// Resolver stays naive; batching happens per event-loop tick.
const resolvers = { Post: { author: p => authorLoader.load(p.authorId) } };

// 2. Complexity budget, rejected before execution.
// { posts(first: 100) { comments(first: 100) { author { name } } } }
// = 100 * 100 * 1 = 10,000 -> rejected against a 5,000 cap.
createComplexityRule({ maximumComplexity: 5000, onCost: c => log(c) });

// 3. Persisted queries: closed allowlist AND a cacheable URL.
// Build step extracts every query and uploads the manifest.
// Runtime sends only the hash:
//   GET /graphql?id=a91f3c&variables={"id":"42"}
//   Cache-Control: public, s-maxage=30
// Unknown hash -> 400. An attacker cannot author a query at all.`
    },
    {
      t: 'table',
      title: 'Choosing a protocol',
      cols: ['Approach', 'Wins when', 'Real cost', 'HTTP caching', 'Browser support'],
      rows: [
        ['REST (Level 2)', 'Resources map cleanly to entities; you want free caching at every layer.', 'Multiple round trips per screen; over-fetching.', '**Free and complete**', 'Native'],
        ['GraphQL', 'Many clients with divergent needs over one large domain graph.', 'N+1, complexity DoS surface, you rebuild caching yourself, `200`-with-errors.', 'Only with persisted `GET` queries', 'Via a client library'],
        ['gRPC-web', 'Strong typing and codegen; you already run gRPC internally.', 'Needs an Envoy/proxy translation layer; binary payloads are hard to debug; no browser streaming both ways.', 'Effectively none', 'Proxy required'],
        ['tRPC', 'TypeScript monorepo, one team owns client and server.', 'TypeScript-only; no schema artefact for other consumers; not a public API.', 'Manual', 'Native (it is HTTP)'],
        ['BFF with plain JSON', 'One client, one team, screen-shaped responses.', 'A service to own, deploy and page for.', 'Full control', 'Native']
      ]
    },
    {
      t: 'note',
      tone: 'info',
      title: 'tRPC is not a protocol, it is a type bridge',
      md: `tRPC's value is that a server function's TypeScript signature *is* the client contract --
no schema file, no codegen step, and a breaking change is a compile error in your editor. That
is a genuinely excellent developer experience and the right tool for a TypeScript monorepo where
one team owns both sides.

Its limits follow from the same property. There is no language-agnostic schema artefact, so a
Swift or Kotlin client cannot consume it, and there is nothing to hand a partner. It is not
versioned by design, because it assumes client and server deploy together. The moment you have
a second consumer you cannot deploy in lockstep, you need an actual schema -- OpenAPI, GraphQL
SDL or protobuf.`
    },

    { t: 'h', text: 'The BFF as an ownership boundary' },
    {
      t: 'prose',
      md: `The most valuable thing about a BFF is not technical, it is that it moves a decision
boundary. Before it, "add a field to this screen" is a cross-team negotiation. After it, the
client team changes its own service and ships. That is the entire point, and it is why a BFF
owned by the backend platform team is a contradiction -- it recreates the queue it was meant to
remove.

The failure mode is equally organisational. A BFF with no stated limits becomes a second
monolith: business rules leak into it, it acquires its own database, other services start
calling it, and now you have a critical system owned by a team whose expertise is UI. The
boundary has to be written down and enforced in review.`
    },
    {
      t: 'grid',
      cols: 2,
      title: 'What belongs in a BFF, and what must not',
      items: [
        { b: 'Belongs in it', md: `- **Aggregation** -- fan out to 6 services in parallel over 0.5 ms links instead of 200 ms ones.\n- **Response shaping** -- flatten, rename and drop fields so the client parses less and ships less code.\n- **Session and token exchange** -- hold the refresh token server-side, hand the browser an \`HttpOnly\` cookie.\n- **Client-specific caching** -- short TTLs on shareable fragments, keyed per auth scope.\n- **View-specific error mapping** -- turn five upstream failure shapes into one contract the UI can render.\n- **Backwards compatibility for old app versions** -- this is exactly where a mobile version shim belongs.` },
        { b: 'Must not live in it', md: `- **Business rules** -- pricing, entitlement, tax, eligibility. If two clients could disagree on the answer, it is domain logic.\n- **Its own primary database** -- once it owns data it is a domain service pretending to be glue.\n- **Being called by other backend services** -- the moment it has server-side consumers it is no longer a BFF.\n- **Cross-client shared logic** -- if web and mobile need the same rule, it belongs one layer down.\n- **Long-running work** -- queue it in a real service; the BFF is in a request path with a browser timeout.` }
      ]
    },
    {
      t: 'prose',
      md: `**One BFF per client or one shared?** The honest answer is that it depends on whether the
clients' needs actually diverge. Separate BFFs per client give each team full autonomy and let
the mobile BFF return small payloads while the web BFF returns rich ones. They cost you duplicated
auth, tracing, resilience and deployment machinery, multiplied per BFF.

A shared BFF avoids that duplication but reintroduces coordination -- the thing you were escaping.
The pragmatic middle, and what most mature organisations land on, is **one BFF per client plus a
shared library** for the cross-cutting concerns: auth middleware, upstream clients with timeouts
and circuit breakers, tracing, and the error contract. Divergence where it matters, shared where
it is pure infrastructure.

Where a BFF is genuinely the wrong answer: when you have one client and one backend team who
already ship together, because you have added a network hop, a deployment, and an on-call
rotation to solve a coordination problem you do not have.`
    },

    { t: 'h', text: 'Pagination, error contracts, and evolution' },
    {
      t: 'prose',
      md: `**Offset pagination** (\`?offset=40&limit=20\`) is simple and gives you random access to
page N, which is what a numbered page-picker needs. It has two real problems. Correctness: if a
row is inserted or deleted between page requests, items shift across the boundary, so a user sees
a duplicate or misses an item entirely. And performance: \`OFFSET 100000\` requires the database to
scan and discard 100,000 rows, so deep pages get linearly slower.

**Cursor pagination** (\`?after=<opaque-cursor>&limit=20\`) encodes a position in the sort order --
typically \`(sort_key, id)\` to break ties -- so the query becomes \`WHERE (created_at, id) < (?, ?)\`
which uses an index and is O(limit) at any depth. Inserts and deletes elsewhere do not shift your
window. The trade is that you cannot jump to page 47 and you cannot show a total count cheaply.
For infinite scroll and for any API where deep pagination is plausible, cursors are the correct
default; keep offset only where a numbered pager is a product requirement over small datasets.

Keep the cursor **opaque** -- base64 an internal structure -- so you can change the sort key later
without breaking clients who saved one.`
    },
    {
      t: 'code',
      lang: 'json',
      title: 'An error contract worth copying (RFC 9457 problem details)',
      code: `{
  "type": "https://errors.example.com/insufficient-funds",
  "title": "Insufficient funds",
  "status": 422,
  "detail": "Account balance 1250 is below the requested 4999.",
  "instance": "/v1/charges/ch_1P2q3r",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "code": "INSUFFICIENT_FUNDS",
  "retryable": false,
  "errors": [
    { "field": "amount", "code": "EXCEEDS_BALANCE", "max": 1250 }
  ]
}

// The three fields that matter operationally:
//   code       - stable, machine-readable. Clients branch on this,
//                never on the human-readable message.
//   retryable  - the client should not have to infer this from a
//                status code it may not fully understand.
//   traceId    - the same ID in your logs, so a support ticket
//                becomes a query instead of an investigation.`
    },
    {
      t: 'prose',
      md: `On **evolution**: the only reliable technique is additive change plus the
expand-migrate-contract cycle. Add the new field alongside the old one, dual-write and dual-read,
migrate consumers, measure that the old field is no longer read, then remove it. The measurement
step is the one teams skip and the reason deprecations stall for years -- you need per-field usage
telemetry keyed by client version, or you are guessing about who breaks.

**Contract testing** is what makes this safe without a shared integration environment. In
consumer-driven contract testing (Pact is the canonical implementation), each consumer publishes
the subset of the API it actually depends on, and the provider's CI verifies every published
contract before deploying. The provider then knows precisely whether a change breaks a real
consumer, instead of relying on a changelog nobody read. This is strictly more useful than
OpenAPI schema validation alone, because it tests the fields that are *used* rather than the
fields that are *declared*.`
    },
    {
      t: 'table',
      title: 'Pagination, compared honestly',
      cols: ['Property', 'Offset / limit', 'Cursor / keyset'],
      rows: [
        ['Jump to page N', 'Yes', 'No'],
        ['Total count', 'Cheap-ish', 'Expensive or unavailable'],
        ['Deep page performance', 'Degrades linearly -- `OFFSET 100000` scans 100,000 rows', 'Constant -- index seek at any depth'],
        ['Stable under concurrent writes', 'No -- items duplicate or vanish across boundaries', 'Yes -- the window is anchored to a sort position'],
        ['Client complexity', 'Trivial', 'Must store and forward an opaque token'],
        ['Right for', 'Numbered pagers over small, stable datasets', 'Infinite scroll, feeds, any large or mutating collection']
      ]
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      gains: [
        'A BFF collapses N client round trips into one, replacing 200 ms hops with 0.5 ms ones.',
        'Client teams ship screen changes without a backend roadmap slot.',
        'Tokens stay server-side; the browser only holds an `HttpOnly` cookie.',
        'Domain services stay domain-shaped instead of accumulating view-specific flags.',
        'Contract testing turns "will this break someone" from a guess into a CI result.'
      ],
      costs: [
        'A new service to deploy, monitor, secure and be paged for.',
        'One more network hop and one more place a request can fail.',
        'BFFs drift into second monoliths unless the boundary is written down and enforced.',
        'Per-client BFFs duplicate auth, tracing and resilience machinery.',
        'GraphQL trades free HTTP caching for query flexibility, and you rebuild the caching yourself.',
        'Every aggregation makes the BFF only as available as the product of its upstreams, unless you design partial responses.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'GraphQL resolver without DataLoader', blast: 'A 50-item list issues 51 queries; the database saturates at a fraction of expected traffic and the cause is invisible in API metrics.', fix: 'Batched loaders per request as a default, plus a CI check that flags resolvers doing direct data access, plus per-request query-count telemetry.' },
        { mode: 'Public GraphQL endpoint with no depth or complexity limit', blast: 'One nested query consumes a whole database; trivial and unauthenticated denial of service.', fix: 'Persisted queries as an allowlist in production, plus depth and complexity caps as defence in depth, plus per-client rate limits weighted by cost.' },
        { mode: 'BFF fans out to 6 services and fails if any fails', blast: 'Availability becomes the product of the upstreams -- six services at 99.9% gives 99.4%, roughly 4 hours of downtime a month.', fix: 'Per-upstream timeouts and circuit breakers; return partial responses with a per-section error so the page degrades instead of failing.' },
        { mode: 'Business logic accumulates in the BFF', blast: 'Web and mobile compute different prices or entitlements; the bug is real money and nobody owns the rule.', fix: 'Written boundary enforced in review: if two clients could disagree about the answer, it is domain logic and moves down a layer.' },
        { mode: 'Offset pagination on a live feed', blast: 'Users see duplicated and skipped items while scrolling, and page 500 times out.', fix: 'Opaque keyset cursors over `(sort_key, id)`; keep offset only where a numbered pager is a product requirement over small data.' },
        { mode: 'Clients branching on error message text', blast: 'A copy edit to an error string breaks retry logic in a shipped mobile app you cannot update.', fix: 'Stable machine-readable `code` and an explicit `retryable` flag in the contract; treat human-readable text as unversioned.' },
        { mode: 'GraphQL returning `200` with an `errors` array', blast: 'Status-code dashboards, alerts and load-balancer health checks report a healthy service during an outage.', fix: 'Alert on the GraphQL error rate and on per-field resolver errors, not on HTTP status; assert this explicitly when onboarding the service to monitoring.' },
        { mode: 'Field removed because "nobody uses it"', blast: 'An 18-month-old mobile build crashes on a missing field; you cannot roll the clients forward.', fix: 'Expand-migrate-contract with per-field usage telemetry keyed by client version, and consumer-driven contract tests in the provider CI.' }
      ]
    },

    {
      t: 'staff',
      md: `The signal here is treating the API question as an *ownership* question, and being able
to argue against the fashionable choice on specifics. Sentences that land:

- "The reason this screen makes eleven requests is that nobody owns the aggregation. I do not
  want a new field on the orders service -- that reshapes a domain API for one screen. I want a
  BFF that our team owns, so the join happens on a 0.5 ms link instead of a 200 ms one and we
  ship UI changes without a backend roadmap slot."
- "I would write down what the BFF may not contain before we build it. No business rules, no
  database, and no other backend service calls it. If two clients could disagree about the
  answer, it is domain logic and it belongs one layer down."
- "GraphQL would solve our over-fetching, and it would cost us HTTP caching entirely, because
  every request is a \`POST\` to one URL. Today \`GET /products/42\` is cacheable at the browser, the
  CDN, and the BFF for free. I would want persisted queries over \`GET\` from day one so we keep a
  cacheable URL and an allowlist instead of an open query language."
- "A GraphQL endpoint without DataLoader and a complexity cap is an unauthenticated denial of
  service, because the client is writing our database queries. Persisted queries are the real
  control; depth limits are defence in depth."
- "This BFF calls six services and fails if any of them fails, so our availability is the product
  of theirs -- six nines-and-a-bit services gives us about 99.4%, which is four hours a month.
  I want per-upstream circuit breakers and a partial response contract so a recommendations
  outage greys out one panel."
- "Offset pagination on the feed is why users report seeing the same post twice. Items shift
  across the page boundary when something is inserted above. Keyset cursors on
  \`(created_at, id)\`, kept opaque so we can change the sort later."
- "Before we delete that field, I want per-field usage telemetry keyed by client version. We
  have app builds from eighteen months ago in the field and 'nobody uses it' is currently a
  guess. Then consumer contract tests in our CI so the next one is not a guess."
- "tRPC is the right call for this internal tool -- one team, one monorepo, breaking changes show
  up as compile errors. It is the wrong call the moment a Kotlin client or a partner needs it,
  because there is no language-agnostic schema to hand them."

The pattern: name who owns the decision, name what the choice costs you that the alternative
gave you free, and name the control that keeps it from rotting.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'A team migrates a REST API to GraphQL and reports that origin load went up and CDN hit rate fell to nearly zero. What is the mechanical cause?',
          options: [
            'GraphQL responses are larger, so they exceed the CDN object size limit.',
            'Every query is a `POST` to one `/graphql` URL, and HTTP caches key on URL and method, so nothing is cacheable.',
            'GraphQL sets `Cache-Control: no-store` by default.',
            'DataLoader bypasses the CDN.'
          ],
          answer: 1,
          why: 'HTTP caching is built entirely on the request URL and method. `GET /products/42` is a stable cache key that the browser cache, service worker, CDN and any reverse proxy all understand for free, with `304` revalidation on top. A `POST /graphql` with the query in the body has one key for every possible query, and `POST` is not cacheable by default anyway, so seven layers of infrastructure stop working at once. The recovery is persisted queries issued as `GET /graphql?id=<hash>&variables=...`, which restores a cacheable URL and simultaneously gives you an allowlist. This is the cost people most consistently omit when advocating GraphQL.'
        },
        {
          q: 'Your BFF aggregates six upstream services, each with a genuine 99.9% availability, and returns an error if any call fails. What is the BFF\'s availability and what is the fix?',
          options: [
            '99.9% -- the BFF adds no risk of its own.',
            'About 99.4%, roughly four hours of downtime a month; fix it with per-upstream timeouts, circuit breakers and a partial-response contract.',
            '99.99% -- aggregation provides redundancy.',
            'Undefined, since availability does not compose.'
          ],
          answer: 1,
          why: 'Serial dependencies multiply: 0.999^6 is about 0.994, which is roughly 4.3 hours a month -- considerably worse than any single upstream, and a number most teams never compute. The design fix is to stop treating every upstream as required. Classify each as critical or optional, give each a timeout well inside the client budget and a circuit breaker so a slow dependency does not consume your request capacity, and define a response contract that carries per-section errors so the page renders with one panel greyed out instead of failing entirely. The corollary is that your monitoring must alert on partial-failure rate, since these requests will return `200`.'
        },
        {
          q: 'Users of an infinite-scroll feed report seeing the same post twice and occasionally missing posts. Pagination is `?offset=N&limit=20`, sorted by `created_at DESC`. Why?',
          options: [
            'The `limit` is too small, so pages overlap.',
            'New posts inserted above the current offset shift every subsequent item by one, so the next page re-serves an item already shown or skips one.',
            '`created_at` has second-level granularity, which breaks sorting.',
            'The client is caching pages incorrectly.'
          ],
          answer: 1,
          why: 'Offset addresses a *position in a result set*, not a position in the data. If two posts are created while the user is reading page 1, the items that were at offsets 20-39 are now at 22-41, so requesting offset 20 returns two rows the user already saw; a deletion has the mirror effect and skips items. Keyset pagination fixes it by anchoring to the data instead: the cursor encodes the last `(created_at, id)` seen and the query asks for rows strictly before it, which is stable under concurrent writes and also removes the `OFFSET 100000` scan cost. Keep the cursor opaque so changing the sort key later does not break clients holding an old token.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `Method semantics, status codes and idempotency keys underpin every contract decision
here -- see **HTTP, HTTP/2 & HTTP/3**. The BFF is a cache layer too, covered in **The Caching
Stack**. Client-side consumption of these contracts, including normalisation and invalidation, is
**State: What Belongs Where**. BFF ownership is the same organisational argument as
**Microfrontends**, and expand-migrate-contract is **Deployment, Rollout & Migration**.`
      }]
    }
  ],

  flashcards: [
    { q: 'What problem does a BFF actually solve?', a: 'An ownership problem. Screens need data joined across domain services, and a BFF lets the client team do that joining in a service it owns -- on 0.5 ms internal links rather than 200 ms client ones -- without negotiating a backend roadmap slot or reshaping a domain API for one view.' },
    { q: 'What must never live in a BFF?', a: 'Business rules, its own primary database, cross-client shared logic, long-running work, and any server-side consumers. The test: if two clients could disagree about the answer, it is domain logic and belongs one layer down.' },
    { q: 'What is the GraphQL N+1 problem and its fix?', a: 'A nested field resolver runs once per parent item, so 50 posts requesting an author means 51 queries. DataLoader batches all loads made within one event-loop tick into a single `WHERE id IN (...)` and caches per request. Without it a GraphQL API will saturate its database well below expected traffic.' },
    { q: 'Why does GraphQL break HTTP caching?', a: 'Every query is a `POST` to a single `/graphql` URL, and every HTTP cache keys on URL plus method. Browser cache, service worker, CDN and reverse proxies all stop working at once. Persisted queries sent as `GET /graphql?id=<hash>` restore a cacheable URL.' },
    { q: 'What do persisted queries give you beyond caching?', a: 'A closed allowlist. Clients register queries at build time and send only a hash, so an attacker cannot author a query at all -- which addresses the complexity-based denial of service more completely than depth or cost limits alone.' },
    { q: 'Offset vs cursor pagination -- the two real problems with offset?', a: 'Correctness and cost. Concurrent inserts or deletes shift items across page boundaries, so users see duplicates or miss rows. And `OFFSET 100000` makes the database scan and discard 100,000 rows, so deep pages degrade linearly. Keyset cursors on `(sort_key, id)` are stable and O(limit) at any depth.' },
    { q: 'What three fields make an error contract operationally useful?', a: 'A stable machine-readable `code` (clients must never branch on message text), an explicit `retryable` flag so the client does not infer it from a status code, and a `traceId` that appears in your logs so a support ticket becomes a query rather than an investigation.' },
    { q: 'What does consumer-driven contract testing add over an OpenAPI schema?', a: 'It tests the fields consumers actually *use*, not the fields you *declare*. Each consumer publishes its expectations and the provider CI verifies all of them before deploy, so "does this change break anyone" becomes a build result instead of a changelog nobody read.' },
    { q: 'When is tRPC the wrong choice?', a: 'As soon as you have a consumer you cannot deploy in lockstep with, or one that is not TypeScript. There is no language-agnostic schema artefact and no versioning story by design, so a Swift client, a Kotlin client or a partner integration needs OpenAPI, GraphQL SDL or protobuf instead.' }
  ],

  drills: [
    {
      prompt: 'An order-details screen currently makes eleven API calls: orders, user, addresses, payment method, three item lookups, shipping estimate, loyalty points, recommendations, and a feature-flag fetch. p75 load time is 2.8 s and mobile is worse. The backend is seven domain services owned by four teams. Design the fix.',
      probes: [
        'Why is it eleven calls, organisationally rather than technically?',
        'What is the failure behaviour of your aggregate, and is that acceptable?',
        'Which of those eleven are actually required for the screen to be useful?',
        'Who owns the new thing, and what stops it becoming a monolith?',
        'What do you measure to know it worked?'
      ],
      strong: [
        'Diagnoses the root cause as a missing ownership boundary, not a missing endpoint, and rejects adding view-specific fields to the orders service.',
        'Proposes a BFF owned by the client team, fanning out in parallel over internal links, and quantifies the win as replacing serial 200 ms hops with parallel 0.5 ms ones.',
        'Computes the availability composition -- seven upstreams at 99.9% is roughly 99.3% -- and refuses an all-or-nothing aggregate.',
        'Classifies upstreams as critical (order, items) versus optional (recommendations, loyalty), with per-upstream timeouts inside the client budget and circuit breakers, returning a partial response with per-section errors.',
        'Notes that partial responses return `200`, so monitoring must alert on partial-failure rate rather than status codes.',
        'Writes the boundary down: no business rules, no database, no server-side consumers, and names the review gate that enforces it.',
        'Moves feature flags out of the request path entirely rather than aggregating them.',
        'Defines success as p75 screen latency plus per-section availability, measured in RUM segmented by device and region.'
      ],
      weak: [
        'Adds an `?include=user,items,shipping` parameter to the orders service.',
        'Proposes GraphQL as the answer with no mention of N+1, complexity limits or the caching loss.',
        'Builds an aggregate that fails entirely if any upstream fails.',
        'Cannot say who owns the BFF or what it is forbidden to contain.',
        'Never computes the composed availability.'
      ]
    },
    {
      prompt: 'You must deprecate the `legacy_price` field from a public API. There are three internal clients, roughly 40 partner integrations, and mobile app builds in the field going back 18 months that you cannot force-update. Plan the removal.',
      probes: [
        'How do you find out who actually reads it?',
        'What is your sequence, and what gates each step?',
        'What do you do about the clients you cannot update?',
        'How do you stop the next deprecation taking two years?'
      ],
      strong: [
        'Refuses to act on assumptions and instruments per-field read telemetry keyed by client identifier and app version before anything else.',
        'Sequences it as expand-migrate-contract: ship `price` alongside `legacy_price`, dual-write and dual-read, migrate consumers, then gate removal on observed zero reads for a defined window.',
        'Gates each stage on measurement rather than a calendar date, and states the window explicitly.',
        'Handles unupdatable mobile builds by keeping the field served from a compatibility shim in the BFF or gateway keyed on client version -- which is precisely what that layer is for -- rather than in the domain service forever.',
        'Communicates with partners via a versioned deprecation header (`Sunset`, `Deprecation`) and a changelog, plus direct contact for the heaviest readers identified by telemetry.',
        'Introduces consumer-driven contract tests in provider CI so the next change surfaces breakage as a failing build.',
        'Considers a deliberate brownout -- removing the field for a short, announced window -- to surface hidden consumers before permanent removal.'
      ],
      weak: [
        'Announces a date and removes the field, treating communication as the whole plan.',
        'Bumps to `/v2` and assumes clients migrate, with no telemetry on who is still on v1.',
        'Has no answer for 18-month-old mobile builds.',
        'Relies on grep across internal repos to establish usage, missing partners entirely.',
        'Does not add any mechanism to make the next deprecation cheaper.'
      ]
    }
  ]
};
