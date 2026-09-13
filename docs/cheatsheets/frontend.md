# Frontend Systems — Staff cheatsheet

Spoken-answer fragments from each topic. Generated; the full argument is in the topic.

## Web Foundations: URL to Pixels

The tell at this level is whether you reason in *round trips* rather than milliseconds.
Sentences that land:

- "Before we optimise the server we should split TTFB with `PerformanceNavigationTiming` --
  `domainLookupEnd - domainLookupStart`, `connectEnd - connectStart`, and
  `responseStart - requestStart`. If connect and TLS are 400 ms of an 800 ms TTFB, the backend
  is not the problem and terminating TLS at an edge is."
- "We are on TLS 1.3, so a cold connection is two round trips before the request. At our p75
  RTT of 140 ms that is 280 ms we can only remove by moving termination closer, not by making
  the origin faster."
- "I would enable 0-RTT for `GET` only. Early data is replayable by design, so allowing it on
  `POST` means an attacker can re-run a mutation, and the server has no handshake context to
  reject it with."
- "Our DNS TTL is 60 seconds, but Chrome pins its own cache to about a minute independently, so
  DNS alone is not a failover mechanism. Real failover has to happen behind a health-checked
  Anycast address."
- "That homepage talks to nine origins. Each one is a fresh handshake on a cold mobile
  connection. Self-hosting the two font origins removes four round trips from first paint."

What each of these signals: you have looked at a real waterfall, you know which costs are
physics and which are choices, and you understand that a security property (replay) can be the
reason a performance feature is off.

## Browser & Rendering Pipeline

The signal here is mechanical precision -- naming the stage, not the symptom. Sentences
that read as operated experience:

- "That is not slow, it is *janky*. We are dropping frames, and the trace shows a purple Layout
  bar in every frame, which means we are animating a geometric property. Moving it to
  `transform` takes it off the main thread entirely."
- "The 320 ms long task on mount is a forced synchronous layout -- each card's effect calls
  `getBoundingClientRect()` after the previous one wrote a style, so we run one layout per card.
  I would measure once in the parent and pass the result down."
- "Our budget is about 10 ms of the 16.7 ms frame, and on the Moto G we are targeting the CPU is
  roughly five times slower than this laptop. So a 4 ms task here is over budget there. I do not
  accept a profile taken on a MacBook as evidence."
- "I would not add `will-change` to the card class. A layer costs GPU memory proportional to its
  area and we render two hundred cards. The browser already promotes elements that are actually
  animating; `will-change` is for the first frame of a known-imminent animation, set in JS and
  cleared afterwards."
- "`content-visibility: auto` on the feed sections would remove most of the initial layout cost,
  but it breaks intrinsic height, so we need `contain-intrinsic-size` and we need to check that
  deep links to a section still scroll correctly."
- "INP is a long-task metric. Before we micro-optimise the handler we should look at what else is
  occupying the main thread in the 200 ms after the click -- usually it is a re-render or an
  analytics flush, not the handler itself."

What these signal: you read traces rather than guess, you know which stage each property
invalidates, and you treat an optimisation's cost (GPU memory, broken scroll height) as part of
the proposal rather than a detail.

## HTTP, HTTP/2 & HTTP/3

The differentiator is connecting a protocol property to a business consequence, and
knowing which claims about HTTP/2 are actually false. Lines that land:

- "The client retries after a 3-second timeout, which means a slow-but-successful charge gets
  submitted twice. This is not a timeout tuning problem, it is a missing `Idempotency-Key`. The
  server should claim the key before doing the work and replay the stored response for a repeat."
- "HTTP/2 fixes head-of-line blocking at the application layer, not at the transport layer. TCP
  still delivers one ordered byte stream, so one lost packet stalls every multiplexed stream. On
  our Indonesian traffic at around 2% loss, that is why a single connection underperforms six."
- "`PATCH` is not idempotent, so we cannot let the gateway retry it. Either we make the patch
  bodies absolute rather than relative, or we require an idempotency key on `PATCH` too."
- "Exponential backoff without jitter just synchronises everyone into waves. We need full jitter
  plus a circuit breaker, and the server should be sending `Retry-After` so clients are not
  guessing."
- "We are returning `500` for validation failures, which means on-call gets paged for user typos
  and our error budget is meaningless. `422` for semantic failures, and alerts on 5xx only."
- "Before we optimise the API itself, set `Access-Control-Max-Age: 7200`. Every JSON call is
  paying a preflight round trip because `application/json` is not a simple content type. And
  `Vary: Origin`, or the CDN will cross-serve CORS headers between tenants."
- "I would not enable server push. It cannot know what the client already has cached, so it
  wastes bandwidth. `103 Early Hints` gives us the same benefit and lets the browser decide."

Each of these pairs a mechanism with a blast radius and a specific control. The strongest single
signal in this area is volunteering the TCP head-of-line caveat about HTTP/2 -- almost everyone
says "HTTP/2 solves head-of-line blocking" and stops there.

## CDN & Edge Delivery

A senior candidate says "put a CDN in front of it". A Staff candidate is expected to
own the *policy*, and that means saying things like:

- "Static assets are content-hashed and immutable. HTML gets `s-maxage=60` with
  `stale-while-revalidate`, so a bad deploy is 60 seconds of exposure, not 24 hours."
- "Anything authenticated is `private, no-store` by default, and caching is opt-in per route
  with a header check in CI, because the failure mode here is a data leak, not slowness."
- "We keep the previous two asset versions live, because during a rollout a user can hold old
  HTML that references chunks the new deploy no longer has."
- "I would not put the personalised dashboard at the edge. I would cache the shell and fetch
  the personalised strip client-side, so the cacheable and non-cacheable parts have different
  policies."

The pattern: name the policy, name the blast radius of getting it wrong, and name the
automated control that stops it. Mentioning `stale-if-error` and origin shields unprompted
is a strong signal you have operated a CDN rather than read about one.

## The Caching Stack

Senior candidates add caches. Staff candidates own the staleness budget and can say who
gets paged when it is wrong. Sentences that land:

- "Our advertised freshness is the *sum* of the layers, not the minimum. Query cache 30 s, CDN
  `s-maxage` 60 s, Redis 300 s -- worst case a user sees data six and a half minutes old. If
  product needs 60 seconds, I need to fix Redis, not the frontend."
- "I would not cache that at the edge. It is personalised, and the failure mode of a wrong cache
  key here is serving one customer's balance to another. I would cache the shell and fetch the
  personalised strip separately so the two have different policies."
- "That key has a 60-second TTL and takes 5,000 rps. Every minute we send 5,000 identical queries
  to Postgres in the same millisecond. We need single-flight plus jitter -- and jitter matters
  because all these keys were populated by the same deploy, so they expire together."
- "Put a version prefix in the key. `product:v4:42`. Then the schema change ships with the deploy
  and every old-shape entry is abandoned atomically -- no purge script, no window where clients
  see two shapes."
- "Delete the key on write, never update it. Updating races with an in-flight read that already
  has the old row, and the loser writes stale data back with a fresh TTL. That inconsistency
  never expires."
- "Our 96% hit rate is also hiding something: nobody knows how the database behaves at 25x its
  current read load. I want a game day that cold-starts the cache in staging so we find out
  deliberately rather than during an incident."
- "The browser HTTP cache is the one layer with no operator lever. Whatever `max-age` we ship on
  HTML is a commitment we cannot revoke, so it gets `max-age=0` with `s-maxage` at the edge."

The pattern in all of these: name the layer, name the staleness it contributes, name who can
invalidate it, and name the blast radius of the key being wrong.

## CSR, SSR, SSG, ISR & Streaming

The differentiator is refusing to answer "which rendering strategy?" as a single
question, and being honest that SSR has costs rather than treating it as strictly better.
Sentences that land:

- "There is no app-level answer. Marketing is SSG, the product catalogue is ISR because the
  build would take half an hour, search is streaming SSR because nothing is cacheable, and the
  dashboard is CSR because there is no crawler and no shareable cache. Four routes, four
  strategies."
- "SSR would improve our LCP and probably make our INP worse. Right now a skeleton tells the
  user honestly that the page is not ready; with SSR we paint something that looks interactive
  and ignores taps for 900 ms. I want TBT and INP in the success criteria before we start, not
  just LCP."
- "Our bundle is 480 KB, so on the mid-tier Android that is p75 of our traffic we are looking at
  roughly half a second of parse and compile before React does anything, and hydration on top. I
  would rather delete JavaScript with server components than reschedule it with lazy hydration."
- "Streaming means the status code is committed at the first flush. So auth, the 404 check and
  any `Set-Cookie` have to resolve before the shell goes out, and everything after that needs an
  error boundary because a failed query can no longer become a 500."
- "Keep the meta tags and the primary copy in the shell. Googlebot renders JavaScript, but Slack
  and LinkedIn scrapers take the first HTML they get, and I am not willing to test that in
  production."
- "`renderToString` blocks the event loop, so throughput is cores divided by render time. At 60 ms
  a core does about sixteen renders a second, which means our 5,000 rps needs roughly 300 cores.
  That is a real infrastructure line item and it belongs in this decision."
- "The product page is 98% shareable and 2% personalised. I would cache the shareable part at the
  edge with `s-maxage` and fetch the price and stock badge client-side, rather than making the
  whole page per-request for one component."

The pattern: per-route reasoning, an explicit admission of what the strategy costs, and a metric
that would catch it going wrong.

## API Contracts & the BFF

The signal here is treating the API question as an *ownership* question, and being able
to argue against the fashionable choice on specifics. Sentences that land:

- "The reason this screen makes eleven requests is that nobody owns the aggregation. I do not
  want a new field on the orders service -- that reshapes a domain API for one screen. I want a
  BFF that our team owns, so the join happens on a 0.5 ms link instead of a 200 ms one and we
  ship UI changes without a backend roadmap slot."
- "I would write down what the BFF may not contain before we build it. No business rules, no
  database, and no other backend service calls it. If two clients could disagree about the
  answer, it is domain logic and it belongs one layer down."
- "GraphQL would solve our over-fetching, and it would cost us HTTP caching entirely, because
  every request is a `POST` to one URL. Today `GET /products/42` is cacheable at the browser, the
  CDN, and the BFF for free. I would want persisted queries over `GET` from day one so we keep a
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
  `(created_at, id)`, kept opaque so we can change the sort later."
- "Before we delete that field, I want per-field usage telemetry keyed by client version. We
  have app builds from eighteen months ago in the field and 'nobody uses it' is currently a
  guess. Then consumer contract tests in our CI so the next one is not a guess."
- "tRPC is the right call for this internal tool -- one team, one monorepo, breaking changes show
  up as compile errors. It is the wrong call the moment a Kotlin client or a partner needs it,
  because there is no language-agnostic schema to hand them."

The pattern: name who owns the decision, name what the choice costs you that the alternative
gave you free, and name the control that keeps it from rotting.

## State: What Belongs Where

The signal is answering a state question by categorising before naming a tool, and being
able to describe what breaks in each wrong placement. Sentences that land:

- "Before we pick a library, let us sort what we have. My test is: can another tab, user or
  device change this value? If yes it is server state and it belongs in a query cache with a
  staleness policy, not in a store. I would expect that to empty most of the Redux store we
  have."
- "React Query is a cache, so let us talk about it as a cache policy. What is `staleTime` for
  this key, what invalidates it, and what is the worst-case staleness a user can observe? For the
  country list that is a day; for the order status it is five seconds."
- "Those filters are in component state, which means a user cannot share a filtered report and
  loses their filters on back navigation. That is a product bug. They go in `searchParams`, with
  `replaceState` on the search input so we do not create thirty history entries."
- "Optimistic update is right for the like button and wrong for the payment. The test is whether
  the user would make a different decision if they knew it failed -- and if we do it optimistically
  we snapshot in `onMutate`, restore in `onError`, and tell them it was undone. A silent revert is
  worse than a spinner."
- "Do not store `filteredItems`. That is a second source of truth that can disagree with the
  filter, and nothing enforces that it agrees. Compute it; add `useMemo` only if a profile says
  to."
- "The same order lives under three query keys, which is why editing the title does not update
  the list. Either we normalise by entity ID, or we design the key hierarchy so one mutation can
  invalidate the right prefix. I would pick based on whether this entity really appears
  everywhere."
- "The token should not be in `localStorage`. One XSS from any transitive dependency reads it and
  we cannot revoke it. An `HttpOnly` cookie from the BFF means a script cannot read the token at
  all, and we accept the CSRF work that comes with it."
- "Refetch on refocus is going to eat in-progress edits on this form. We disable it while dirty,
  and we send `If-Match` on save so a concurrent edit is a `412` the user can act on rather than
  a silent overwrite."

The pattern: categorise, name the invalidation or staleness policy explicitly, and name the
user-visible failure that the wrong placement produces.

## React at Scale

The differentiator at this level is measuring before optimising, and preferring
structural changes to memoisation. Also: being willing to say that a popular optimisation is
making things worse. Sentences that land:

- "Before adding memos I would open the React Profiler and find what is actually expensive. A
  re-render that produces identical output commits nothing -- it costs the function call and the
  diff. The goal is to stop *expensive* renders, not all renders."
- "That context holds the theme and the websocket status. A heartbeat every two seconds
  re-renders every consumer, including everything that only wanted the theme. And `React.memo`
  will not help, because context propagation bypasses the memo comparison. Split the providers by
  how often each value changes."
- "I would move the state down rather than memoise up. If only the filter input needs the draft
  text, put it there and the 300 rows are not downstream of it at all. That removes the render
  instead of making it cheaper, and there is no dependency array to get wrong later."
- "`useMemo` on a filter over twenty items costs more than it saves. The comparison and retention
  are roughly the work of the filter, and we have added a dependency array that will be wrong
  after the next refactor."
- "Index keys in a sortable list are a correctness bug, not a performance one. React matches
  siblings by key, so state follows position -- the checked row changes when you sort."
- "`useTransition` makes the render interruptible, not faster. There is still one thread, and it
  cannot interrupt inside a single component's render. If one component does 200 ms of
  synchronous work, the fix is in that component."
- "Our route splitting is not working because a barrel file pulls the date library into every
  chunk. I want a per-chunk gzipped budget failing CI, not a quarterly audit -- a regression
  caught in the pull request costs ten minutes and the same one found later costs a week."
- "This component has nineteen boolean props, which means nineteen callers each added one and no
  team can change it safely now. That is a boundary problem. I would split it by job and replace
  configuration with composition."
- "We should profile with a 4x CPU throttle, because p75 of our users are on hardware roughly
  four to six times slower than this laptop. A 4 ms render here is over the frame budget there."

The pattern: name the mechanism, cite the measurement you would take, prefer restructuring to
memoising, and state the cost of your own proposal.

## Microfrontends

The interviewer is usually testing whether you will reach for microfrontends because they
are interesting. The highest-signal answer starts by declining.

- "Before I split anything, I want to know what is actually slowing you down. If the complaint is a
  25-minute CI run and a weekly release train, I can often fix that with affected-project builds
  and per-directory code ownership for a fraction of the cost of a runtime split."
- "Microfrontends buy deploy independence. They do not buy performance -- four remotes duplicating
  React and a styling runtime is roughly 180 kB brotli and about 400 ms of extra parse and execute
  on a mid-tier Android device. I want to be honest that we are spending performance to buy
  autonomy."
- "I would default to a modular monolith: one deployable, strict module boundaries, code owners per
  directory, and affected-only CI. That gets most of the ownership benefit and keeps a compile-time
  contract, which is the cheapest place to catch breakage."
- "I would change that recommendation under specific conditions: more than roughly eight teams
  shipping to one URL, or a genuinely heterogeneous stack we are strangling incrementally, or a
  compliance boundary where one team's code must not share a runtime with another's."
- "If we do split, the split follows the org chart, not the component tree. Two teams co-owning
  checkout stays one deployable, because splitting it moves their coordination from a reviewable
  pull request into an invisible runtime contract."
- "The shell contract is the product. Versioned, semver'd, N-1 compatible, with contract fixtures in
  every remote's CI. Without that, 'independent deploys' means 'nobody can deploy safely'."

What each of those signals: that you optimise for organisational throughput rather than novelty,
that you can quantify a cost instead of gesturing at one, and that you have felt the difference
between a contract enforced by a compiler and a contract enforced by hope.

## Module Federation & Runtime Integration

Senior candidates describe the config. Staff candidates describe the *operational* model
and are specific about what goes wrong. Sentences that land:

- "The negotiation picks the highest version that satisfies the requesting side's range, so the host
  does not automatically win. If a remote carries React 18.3 and we accept caret 18.2, our shell
  ends up running the remote's React. That is why I want `requiredVersion` declared explicitly and
  snapshot-tested rather than inherited from `package.json`."
- "React, `react-dom`, the router and the styling runtime are `singleton: true` and
  `strictVersion: true`. I would rather fail loudly at load than debug a context consumer that
  silently returned its default value."
- "Remote URLs come from a runtime manifest with a 30-second TTL, not from the webpack config. That
  makes rollback a pointer flip an on-call engineer can do in a minute without a build."
- "Error boundaries do not catch chunk-load failures or rejected dynamic imports, so every remote
  load is a `try/catch` with an 8-second timeout *and* a boundary around the mounted tree.
  `ChunkLoadError` gets its own alert, because it spikes right after a deploy that pruned old
  chunks."
- "Production runs a combination, not a version. Shell 41 with billing 12 and settings 7 is a
  configuration I have never tested, so the shell contract is additive-only within a major, remotes
  declare the contract version they built against, and I keep N-1 and N-2 chunks live."
- "If a single-version policy is acceptable across teams, I would seriously consider import maps
  instead. Deduping by URL identity and no bundler runtime is a real simplification -- I just lose
  per-remote version negotiation, so it only works if we enforce one React org-wide."

The signal in all of these is the same: you have debugged a shared-scope mismatch in production at
least once, and you design so the next one is loud, attributable, and revertible without a build.

## Design Systems & Frontend Platform

Most candidates describe a component library. The Staff-level answer treats the design
system as an adoption and migration problem and comes with numbers.

- "The metric I would put on a dashboard is adoption -- library component instances over all
  rendered interactive elements, computed from a static scan -- plus the local reimplementation
  rate. If reimplementation is climbing, our path is more expensive than going around us, and that
  is our bug, not theirs."
- "Product code references semantic tokens only, never primitives, and a lint rule fails the build
  otherwise. That indirection is what makes dark mode a token remapping instead of a 400-file
  refactor."
- "We ship tokens as CSS custom properties, not just a JS object, so a token fix reaches a surface
  that bundled our components six months ago. That is what keeps independently deployed frontends
  visually coherent."
- "If I make a breaking change, my team writes the codemod and opens the pull requests against every
  consuming repository. Publishing v5 with release notes just distributes unplanned work to eight
  teams and guarantees we support v4 for six more quarters."
- "Changing a default value is a major even though nothing type-checks. That is the most
  under-estimated break in a component library -- behaviour changes under every call site at once."
- "Axe covers roughly a third of WCAG criteria. I run it on every component in CI, and I also keep
  a keyboard and screen-reader checklist per interactive component, because axe cannot tell me
  whether focus returns to the trigger when a modal closes."
- "I would say no to a component with one consumer and no second use case. It is a product
  component. We can promote it when a second team needs it."

The signal is that you understand the platform team's product is other engineers' velocity, that
you measure it, and that you treat your own migrations as work you own rather than work you
announce.

## Realtime: Polling, SSE & WebSockets

The tell for a Staff-level answer is that the transport choice takes thirty seconds and
the failure behaviour takes the rest of the conversation.

- "First, does this need to be realtime? If a 30-second delay is acceptable, polling with
  `ETag` and a 304 is dramatically cheaper to operate and cannot have a reconnect storm."
- "It is one-way, so I would use SSE rather than WebSocket. The browser handles reconnection and
  replays `Last-Event-ID` for free, which is the exact code I would otherwise have to write and
  test. The condition is HTTP/2 end to end, because on HTTP/1.1 each stream eats one of six
  connections per origin."
- "Reconnection uses full jitter -- uniform between zero and `min(30 s, 500 ms × 2^n)`. Delay plus
  a small random offset still leaves the fleet clumped, and the failure I am designing against is
  40,000 clients hitting auth in the same second after a gateway redeploy."
- "Every message carries a monotonic sequence number. On reconnect the client sends
  `since=lastSeq` and the server replays the gap. Without that, a mass reconnect turns into 40,000
  full snapshots, which is a bigger outage than the one that caused it."
- "Messages are facts with versions, not deltas, so applying one twice is harmless. That is what
  makes at-least-once delivery survivable on the client."
- "Heartbeat at 20 seconds and I want the ALB idle timeout raised to 300. Both -- the heartbeat
  proves liveness end to end and the timeout stops the infrastructure reaping a healthy connection.
  I would alert on the close-code distribution, because a spike in 1006 is a proxy problem, not an
  application problem."
- "Authorisation gets revalidated on the live connection. A user who loses access at 10:03 must
  stop receiving updates at 10:03, which means a revocation event on the bus that drops their
  subscriptions."

Naming full jitter, resume tokens, the backgrounded-tab timer throttle, and the close-code
distribution as a signal all say the same thing: you have run one of these in production.

## Offline-First & Sync

This topic separates candidates fast, because the naive answer -- "cache it in IndexedDB
and replay when online" -- is only about a fifth of the design. Sentences that demonstrate the rest:

- "The optimistic local write and the outbox append go in one IndexedDB transaction. If they are
  separate, a crash between them means the UI shows a change that will never sync, and that bug is
  unreproducible in the office."
- "Entity ids are client-generated UUIDs. That makes creates idempotent by construction and means
  a child record created offline can already reference its parent, instead of needing a temporary
  id and a rewrite pass."
- "Every mutation carries an `Idempotency-Key` -- the outbox record id -- because the failure I am
  designing for is the server committing and the response being lost. The client cannot tell that
  apart from a request that never arrived."
- "Conflict detection is server versions with `If-Match`, never client timestamps. Clock skew of
  minutes is normal, so timestamp-based last-write-wins means the user with the worst clock wins."
- "I merge by field first, because most 409s are two people editing different fields of the same
  row -- that is a coarse detector, not a real conflict. I only escalate to the user when both sides
  changed the same field of content they authored."
- "The queue needs error classification and a parking lot. A 403 retried on a 30-minute ceiling for
  three days blocks every mutation behind it and reads to the user as 'it stopped saving'."
- "Storage is evictable. I call `navigator.storage.persist()` and check whether it was granted,
  because Safari will clear script-writable storage after seven days without interaction, and an
  enterprise tool opened fortnightly is exactly that case."
- "I sync a working set, not the corpus. A 400 MB initial sync on a warehouse tablet is a product
  failure however correct the algorithm is."

Each of those names a specific failure and a specific mechanism. That is the difference between
having read about offline-first and having shipped it.

## Collaborative Editing: OT & CRDT

The trap in this question is enthusiasm. Candidates who have read about CRDTs describe
them as a solved problem; the strong answer is more precise about what is solved.

- "I would use Yjs behind a server-authoritative WebSocket relay. I would not implement a sequence
  CRDT -- a correct one is hard, and a correct one that is fast on a 200-page document with a
  ProseMirror binding is engineer-years."
- "CRDTs guarantee convergence, not intent. If Alice rewrites a paragraph while Bob deletes it, the
  merge is mathematically perfect and the result is a fragment of Alice's new sentence in a
  paragraph that was meant to be gone. No merge function recovers that, so some conflicts belong in
  product design -- section locking, or a review step -- rather than in the algorithm."
- "Peer-to-peer is technically possible and operationally worse. I need a point that can reject an
  unauthorised update, durable storage when nobody is online, and something debuggable. I would use
  peer-to-peer only for awareness, which nobody needs persisted."
- "Tombstones and history grow monotonically, so I need a snapshot every few hundred updates and an
  explicit horizon. A client more than one snapshot behind gets told to discard and reload rather
  than merged. That turns an unsolvable garbage-collection problem into a bounded policy."
- "Awareness is a separate ephemeral channel, throttled to one update per frame and expired on a
  30-second lease, because a crashed tab never says goodbye."
- "Undo has to be scoped by origin. Ctrl-Z reverting a collaborator's sentence gets reported as data
  loss, and the user is right."
- "I would test convergence with property-based tests over random interleavings, asserting both
  replicas end byte-identical. Example-based tests pass while a broken tie-break diverges under
  specific timing."

The signal is knowing the boundary of the guarantee. Anyone can say "use a CRDT". Being specific
about intent, authorisation, tombstone growth, rich-text semantics and undo is what shows you have
shipped one.

## Performance Engineering

The signal is measurement discipline plus honest reasoning about causality, and refusing
to celebrate a metric movement that does not correspond to experience. Sentences that land:

- "Our aggregate p75 LCP is 2.6 seconds, which is nearly passing and completely misleading.
  Segmented, mid-tier Android in India is at 4.6 s and that is 19% of sessions. I want to review
  the worst segment, not the average, because the average is dominated by users on the same
  hardware we develop on."
- "INP is 480 ms and attribution says 340 ms of that is input delay, not processing. So the
  handler is not the problem -- the main thread was already busy when the click arrived. I would
  go looking for the long task, which on this page is almost certainly hydration."
- "The LCP breakdown says most of the time is resource load *delay*, which means we discovered
  the image late. That is a preload and `fetchpriority` fix, not a compression fix. Right now it
  is lazy-loaded, which is the worst possible setting for the LCP element."
- "I will use Lighthouse in CI as a regression gate and RUM to decide what to work on. Lighthouse
  cannot measure INP, because it never clicks anything -- TBT is the lab proxy and I would gate on
  that instead."
- "The budget has to fail the build or it is a dashboard. Bundle size on every pull request
  because it is deterministic, Lighthouse against the preview deploy on the median of five runs
  because a single run is too noisy, and a named approver for the override so it does not get
  deleted during the first incident."
- "I can cite Deloitte's figure of 8.4% retail conversion per 0.1 s, but that is their audience
  and their sites. For our case I would segment our own funnel by LCP bucket, acknowledge that is
  correlational since slow sessions also mean older devices and poorer users, and then run a 10%
  holdback so we get a causal number."
- "Careful with that win. The LQIP is now the LCP element, so the metric improved and the user
  still waits the same time for the real image. I do not want to report that as a success."
- "Third-party scripts are the largest single cost here and none of it is code we own. I want
  long-task attribution by script URL so we can say the chat widget costs 180 ms at p75, and a
  budget with an owner who can say no -- otherwise every individual request gets approved and
  nobody owns the sum."

The pattern: segment before concluding, use attribution instead of intuition, distinguish
correlation from causation without hiding behind it, and build a mechanism rather than doing a
project.

## Frontend Security

Most candidates list vulnerabilities. The Staff-level answer talks about controls,
rollout, and what remains true after the control fails.

- "The premise is that nothing in the browser can be trusted. Client-side validation is a UX
  feature; the server validates independently, including on requests my own code sent."
- "I would rank the work by blast radius. XSS is first, because with XSS every other frontend
  control is irrelevant -- the attacker is my origin. So: strict nonce CSP with `strict-dynamic`,
  then Trusted Types, then `HttpOnly` cookies."
- "Trusted Types is the highest-leverage control I know of, because it changes the shape of the
  problem. Instead of auditing 400 sink usages forever, there are three registered policies and
  those are the review surface."
- "CSP goes out report-only for two weeks first. I have never seen a first policy that was correct
  -- there is always a tag manager or a session-replay agent nobody mentioned."
- "On token storage: the real difference is exfiltration, not exploitation. With XSS an attacker can
  make requests either way, but a token from `localStorage` gets replayed from their machine for
  hours after the user closes the tab. `HttpOnly` confines them to the live page, which is worse
  for them and more detectable for us."
- "CORS is not protecting our API -- it is us granting read access to another origin.
  `curl` ignores it. The dangerous configuration is reflecting the `Origin` header with
  `Allow-Credentials: true`, which is a data breach in two lines of middleware."
- "Supply chain is the surface I would actually worry about: `npm ci` with a committed lockfile,
  `@acme/*` mapped to the internal registry so dependency confusion is impossible, install scripts
  off with an allowlist, and provenance where publishers support it."
- "Third-party script on a payment page is a deployment pipeline with no review. I would sandbox it
  on a separate origin behind `postMessage`, which is exactly why Stripe Elements can make claims
  our own form cannot."

The pattern: name the control, name what it does *not* cover, and name how you roll it out without
breaking production. Mentioning report-only rollout, dependency confusion by name, and the
exfiltration framing of token storage are all strong signals.

## Frontend Observability

Most candidates name tools. The Staff-level answer knows the cost model, the privacy
obligations, and what makes a signal actionable rather than merely present.

- "Every event carries the build SHA, so the query I care about is error rate and p75 vitals per
  release. That is what turns a rollback from an argument into a decision, and it is the signal an
  automated canary reads."
- "I report at `visibilitychange` to hidden with `sendBeacon`, not on `unload`. On mobile a tab
  can be discarded without `unload` ever firing, and CLS and INP are only final at page hide
  anyway -- reporting CLS on load gives you a number that is wrong in a flattering direction."
- "On sampling I would work the arithmetic. Ten million sessions at 8 kB is 80 GB a month, which is
  six figures a year at typical pricing. I need p75 per route per device class, and a few thousand
  samples per bucket gets that within about a point, so 10% session sampling is plenty. Errors stay
  at 100% and get deduplicated by fingerprint, because a rare error is the one I need."
- "Route patterns, not raw URLs. Cardinality is the usual reason a telemetry bill triples when
  nothing shipped."
- "Alerts are on percentiles per cohort -- route, device class, region, browser major, release --
  against a trailing baseline with a minimum sample size. A global average hides a tripling for 8%
  of users, and an absolute threshold either pages nightly or never fires."
- "Session replay is masked default-deny with an explicit unmask allowlist, because a denylist does
  not survive the next feature. Credential fields are excluded entirely, retention is 30 days, and
  replay access is logged."
- "For frontend-versus-backend latency arguments I propagate `traceparent` and make the sampling
  decision in the browser. And I add `traceparent` to `Access-Control-Allow-Headers`, because
  otherwise the preflight fails in production while everything works locally on one origin."
- "The dashboard test is whether someone answers four questions in a minute at 3 a.m.: is it broken,
  when did it start, who is affected, what changed? That means deploy markers on every chart and
  error groups ranked by affected sessions, not by event count."

Doing the sampling arithmetic unprompted, naming cardinality as a cost driver, and treating replay
masking as default-deny are the three things that most reliably separate someone who has operated
this from someone who has configured it.

## Deployment, Rollout & Migration

The signal here is whether you think in terms of a fleet or a version. Sentences that
demonstrate the first:

- "There is no such thing as deploying the frontend. Users hold builds in memory, so production is
  always running several versions at once. I would measure our p99 session duration, because that
  number *is* our compatibility window."
- "Assets are content-hashed and immutable, and the pipeline never deletes. Retention is 30 days.
  The failure I am preventing is a user on old HTML requesting a chunk we pruned, and that is a
  white screen, not a degraded experience."
- "HTML gets `max-age=0, s-maxage=60` with `stale-while-revalidate`. That makes our bad-deploy
  exposure 60 seconds instead of however long we set the browser TTL to."
- "Canary bucketing has to be deterministic on a hashed user id, set as a cookie at the edge. Random
  per-request assignment means a user's HTML and their cached chunks disagree, which manufactures
  the skew we are trying to avoid."
- "I want automated rollback, with a lower bar than paging a human. Error rate per session and
  chunk-load error rate move within a minute, and I compare the canary against concurrent baseline
  traffic rather than yesterday so time-of-day effects cancel. Plus one funnel metric, because the
  worst deploys throw no errors and just stop converting."
- "Any contract change is expand, migrate, contract, and I contract on evidence rather than on a
  date -- a read counter on the deprecated field, dimensioned by client version, that has to be zero
  for longer than our session p99."
- "Before removing an endpoint I brownout: return 410 for one minute at a quiet hour and see who
  complains. That turns an unknown blast radius into a measured one."
- "Flags are typed and expire. A release flag gets 90 days and then CI fails, because the real cost
  of flags is not the code path -- it is the untested off-path nobody remembers in November."
- "With microfrontends I resolve remote versions from a manifest with a 30-second TTL, so rolling
  back one team's feature is a pointer flip that does not involve the shell team at 2 a.m."

Naming the session-duration p99 as the compatibility window, contracting on evidence rather than on
a calendar, and preferring automated revert to a page are the three moves that most reliably read as
having operated this rather than designed it.
