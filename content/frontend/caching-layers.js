export default {
  blocks: [
    {
      t: 'prose',
      md: `A cache is a copy of an answer, kept somewhere cheaper to reach than the place that
produced it. There is rarely just one. Between a number on screen and the disk page it came
from there are typically seven independent caches, each with its own lifetime, its own key, and
its own owner.

The hard part is not adding caches. It is that each one can serve a stale answer, and *nobody
owns staleness end to end*. When a user says "I updated it and it still shows the old value",
the real question is which of the seven layers is lying, and that is answerable only if you
designed the layers deliberately rather than accumulating them.`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `Every layer of a stack is roughly an order of magnitude slower than the one above it,
and that gradient is what makes caching the highest-leverage technique in computing. An L1 cache
reference is about 1 ns, main memory about 100 ns, an SSD read about 100 µs, a same-region
network round trip about 500 µs, and an intercontinental round trip about 200 ms. That is eight
orders of magnitude between the top and the bottom.

So caching is not an optimisation you sprinkle on at the end. It is the reason the system is
affordable at all: a read-heavy application with a 95% cache hit rate does one twentieth of the
database work, which is frequently the difference between three database replicas and sixty.

The corresponding cost is stated in one sentence and it is worth memorising: **a cache is a
second source of truth that you cannot transactionally update alongside the first.** Everything
difficult downstream follows from that.`
    },
    {
      t: 'numbers',
      title: 'The latency gradient that justifies each layer',
      items: [
        { v: '~1 ns', k: 'CPU L1 reference', note: 'Component memory territory' },
        { v: '~100 ns', k: 'Main memory reference', note: 'In-process JS object' },
        { v: '~0.5 ms', k: 'Same-region network RTT', note: 'App to Redis' },
        { v: '~5-15 ms', k: 'CDN edge hit', note: 'vs 200 ms to origin' },
        { v: '~1-10 ms', k: 'Indexed Postgres query, warm buffer pool', note: '~50-200 ms cold on disk' },
        { v: '~200 ms', k: 'Intercontinental RTT', note: 'The cost a CDN removes' }
      ]
    },

    { t: 'h', text: 'The seven layers' },
    {
      t: 'diagram',
      code: `flowchart TB
  U["User interaction"] --> M["1 Component memory<br/>useMemo, module scope"]
  M --> Q["2 Query cache<br/>React Query, Apollo"]
  Q --> B["3 HTTP browser cache<br/>Cache-Control"]
  B --> SW["4 Service worker<br/>Cache Storage"]
  SW --> CDN["5 CDN edge + shield"]
  CDN --> BFF["6 BFF / API response cache"]
  BFF --> R["7 Redis / Memcached"]
  R --> DB["8 DB buffer pool"]
  DB --> D[("Disk")]`,
      caption: 'A read can be answered at any layer. Each hop skipped is roughly an order of magnitude of latency and cost removed.'
    },
    {
      t: 'table',
      title: 'Who owns correctness at each layer',
      cols: ['Layer', 'Keyed by', 'Typical lifetime', 'Who can invalidate it', 'The specific risk'],
      rows: [
        ['1. Component memory', 'Dependency array / closure identity', 'Until unmount', 'Only the component', 'Stale closure capturing an old prop; nothing external can fix it.'],
        ['2. Query cache', 'Query key tuple', 'Seconds to minutes', 'Client code, on mutation', 'Two keys for the same entity drifting apart -- the normalisation problem.'],
        ['3. HTTP browser cache', 'URL + `Vary`', '`max-age`, often hours', '**Nobody** -- it is on the user\'s disk', 'Unreachable. A long `max-age` on HTML is unfixable for that TTL.'],
        ['4. Service worker', 'Whatever your code decides', 'Until your SW updates it', 'Your SW, on activation', 'A buggy SW can pin a broken app version permanently; needs a kill switch.'],
        ['5. CDN edge', 'Host + path + query + `Vary`', '`s-maxage`, minutes to a year', 'Purge API, eventually consistent', 'Over-broad key leaks personalised data; over-narrow key collapses hit rate.'],
        ['6. BFF response cache', 'Route + auth scope + params', 'Seconds', 'Your deploy or your code', 'Caching per-user data under a shared key -- same leak class as the CDN.'],
        ['7. Redis', 'Explicit application key', 'Explicit TTL', 'Your application code', 'Stampede on expiry; hot keys saturating one shard.'],
        ['8. DB buffer pool', 'Physical page', 'LRU eviction', 'The database', 'Not a correctness risk, but it is why cold queries look pathological.']
      ]
    },
    {
      t: 'note',
      tone: 'warn',
      title: 'Layer 3 is the one you cannot take back',
      md: `Every other layer has some operator with a lever. The HTTP browser cache has none: once
you have served \`Cache-Control: public, max-age=86400\` on a URL, that response lives on the
user's disk for a day and there is no API, no purge, and no deploy that reaches it. The only
recovery is a *different URL*.

This asymmetry should drive your defaults. Content-hashed assets get \`max-age=31536000,
immutable\` because the URL changes when the bytes do. Everything else that browsers cache gets
a TTL you would be comfortable being wrong for.`
    },

    { t: 'h', text: 'The four read/write patterns' },
    {
      t: 'prose',
      md: `There are only a handful of ways to wire a cache to its backing store, and the choice
determines your consistency and durability properties.

**Cache-aside** (lazy loading) is what almost everyone runs. The application checks the cache,
and on a miss reads the database, populates the cache, and returns. It is simple and resilient --
a cache outage degrades to slow rather than broken -- and the cache only ever holds data someone
actually asked for. The costs are that every first read is a miss, and the application owns
invalidation, which is where the bugs live.

**Read-through** moves that logic into the cache layer or client library, so the application
just reads and the library handles population. Same performance profile, fewer places to get it
wrong, at the price of a fatter dependency and less visibility.

**Write-through** writes to cache and database synchronously on every mutation. The cache is
never stale, which is genuinely valuable, but every write pays both latencies and you fill the
cache with data nobody reads.

**Write-back** (write-behind) writes to cache and acknowledges immediately, flushing to the
database asynchronously. Write latency collapses and write throughput multiplies, which is why
it shows up in metrics ingestion and counters. The cost is blunt: **if the cache dies before the
flush, that data is gone.** Only choose it when losing a few seconds of writes is genuinely
acceptable, and say that out loud when you propose it.`
    },
    {
      t: 'table',
      title: 'Choosing a pattern',
      cols: ['Pattern', 'Write latency', 'Staleness window', 'Data loss on cache failure', 'Use when'],
      rows: [
        ['Cache-aside', 'DB latency', 'Until TTL or explicit invalidation', 'None', 'Default. Read-heavy, tolerant of brief staleness.'],
        ['Read-through', 'DB latency', 'Until TTL', 'None', 'Same as cache-aside but you want the logic centralised.'],
        ['Write-through', 'DB + cache', 'None', 'None', 'Reads must never be stale and write volume is modest.'],
        ['Write-back', 'Cache only', 'None for readers', '**Yes -- unflushed writes**', 'Counters, metrics, session activity. Never orders or payments.']
      ]
    },

    { t: 'h', text: 'Stampede, hot keys, and the failure modes that matter' },
    {
      t: 'prose',
      md: `A **cache stampede** (or thundering herd) is what happens the instant a popular key
expires. Suppose a key serving 5,000 requests per second has a 60-second TTL. At the moment it
expires, every in-flight request misses simultaneously, and all 5,000 go to the database for the
same value. The database, sized for 250 rps of misses, falls over -- and because it is now slow,
the recompute takes longer, so more requests pile in. That is the herd.

Three defences, and you want more than one. **Request collapsing** -- also called single-flight
or dogpile prevention -- lets exactly one request recompute while the others wait on its result;
Redis-side this is a short-lived lock, and in-process it is a promise map keyed by cache key.
**Early recompute**, where a probabilistic check refreshes the value slightly before expiry so
no request ever meets a cold key, is the idea behind XFetch. And **TTL jitter**: set the TTL to
\`base + random(0, base * 0.1)\` so a thousand keys populated in the same deploy do not all expire
in the same second.

A **hot key** is a different problem with a similar shape. Redis Cluster shards by key hash, so
one extremely popular key -- a celebrity's profile, a flash-sale item's inventory -- lands
entirely on one node, and that node saturates while the rest of the cluster idles. Adding shards
does nothing. The fixes are to replicate the key under N suffixed variants and read a random one,
or to add a small in-process cache in front of Redis with a 1-2 second TTL, which collapses
thousands of reads per second per host into one.

**Negative caching** is the defence against the inverse problem. If a lookup for a non-existent
ID returns nothing and you only cache positive results, an attacker (or a broken retry loop)
hammering random IDs passes straight through every cache layer to the database. Cache the "not
found" too, with a shorter TTL -- 30 seconds rather than 300 -- because a 404 becoming a 200 is a
much more likely transition than the reverse.`
    },
    {
      t: 'diagram',
      code: `sequenceDiagram
  participant R1 as Request 1
  participant R2 as Requests 2-5000
  participant C as Cache
  participant L as Lock
  participant DB as Database
  R1->>C: GET product:42
  C-->>R1: miss
  R1->>L: SET lock:42 NX EX 10
  L-->>R1: acquired
  R1->>DB: SELECT
  R2->>C: GET product:42
  C-->>R2: miss
  R2->>L: SET lock:42 NX EX 10
  L-->>R2: denied, wait or serve stale
  DB-->>R1: row
  R1->>C: SET product:42 ttl 60+jitter
  C-->>R2: value`,
      caption: 'Request collapsing: one recompute, and the rest either wait briefly or serve the previous value. Without it, all 5,000 hit the database.'
    },
    {
      t: 'code',
      lang: 'js',
      title: 'Single-flight plus jitter plus negative caching',
      code: `const inflight = new Map(); // collapses concurrent misses per process

const BASE_TTL = 60;
const jitter = ttl => ttl + Math.floor(Math.random() * ttl * 0.1);

async function getProduct(id) {
  const key = 'product:v3:' + id;          // version in the key: see below
  const hit = await redis.get(key);
  if (hit !== null) {
    return hit === '__MISSING__' ? null : JSON.parse(hit); // negative cache
  }

  if (inflight.has(key)) return inflight.get(key); // same-process collapse

  const p = (async () => {
    const row = await db.product(id);
    if (row === null) {
      // Shorter TTL: not-found -> found is the likely transition.
      await redis.set(key, '__MISSING__', 'EX', jitter(30));
      return null;
    }
    await redis.set(key, JSON.stringify(row), 'EX', jitter(BASE_TTL));
    return row;
  })().finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}`
    },

    { t: 'h', text: 'Cache key design and invalidation' },
    {
      t: 'prose',
      md: `A cache key is a claim that two requests deserve the same answer. Get it too broad and
you serve user A's data to user B. Get it too narrow and your hit rate collapses and the origin
sees full traffic. Both are outages; one is also a security incident.

Three rules that survive contact with production. First, **put everything that changes the
response in the key, and nothing else.** Tracking query parameters like \`utm_source\` change
nothing and must be stripped before lookup, or one page fragments into thousands of keys.
Authentication scope *does* change the response, so it belongs in the key -- or, better, the
response should not be shared at all.

Second, **put a version prefix in the key**. \`product:v3:42\` rather than \`product:42\` means a
schema change is deployed by bumping the prefix, which atomically abandons every old entry with
no purge, no scan, and no window where old and new shapes are mixed. The old entries just expire.
This one habit removes most invalidation emergencies.

Third, **prefer expiry to invalidation where you can afford it.** Invalidation is a distributed
systems problem: you must find every copy in every layer and remove it, with no transaction
spanning them. A short TTL is a correctness bound you get for free. Reach for explicit
invalidation when the freshness requirement is genuinely tighter than any TTL you can afford,
and then use **tag-based purge** so one product update can invalidate the product page, the
category listing, and the search result set together.`
    },
    {
      t: 'table',
      title: 'Invalidation strategies, in the order you should try them',
      cols: ['Strategy', 'Propagation', 'Cost', 'Where it applies'],
      rows: [
        ['Change the URL (content hash)', 'Instant', 'Free', 'Static assets. Always do this.'],
        ['Version prefix in the cache key', 'Instant on deploy', 'Old entries occupy memory until TTL', 'Redis and BFF caches after a schema change.'],
        ['Short TTL + `stale-while-revalidate`', 'Bounded by TTL', 'Slightly higher origin load', 'HTML, config, listings. The workhorse.'],
        ['Write-through on mutation', 'Immediate', 'Every write pays both latencies', 'Small, hot, must-be-fresh entities.'],
        ['Delete-on-write (cache-aside invalidate)', 'Immediate, per layer', 'Race with concurrent reads repopulating stale', 'Redis. Prefer delete over update to avoid ordering bugs.'],
        ['Tag / surrogate-key purge', 'Seconds', 'Rate-limited vendor API', 'CDN, when one entity appears on many pages.'],
        ['Purge everything', 'Seconds to minutes', 'Full cold-cache traffic spike on origin', 'Incidents only. Not a deploy strategy.']
      ]
    },
    {
      t: 'note',
      tone: 'danger',
      title: 'Delete, do not update, on write',
      md: `The classic cache-aside race: request A reads from the DB (getting value v1), then
request B writes v2 and updates the cache to v2, then A finally writes its stale v1 into the
cache. The cache now holds v1 with a fresh TTL, and the database holds v2 -- indefinitely
inconsistent with no error anywhere.

**Deleting** the key on write instead of updating it shrinks the race to the window between
delete and the next read, and the next read repopulates from the current database state. It is
not a proof of correctness -- you can still construct an interleaving -- but it turns a permanent
inconsistency into a millisecond one. If you need an actual guarantee, you need versioned writes
(compare-and-set on a monotonic version) or you need to accept the TTL as your bound.`
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      gains: [
        'A 95% hit rate turns 20x the database capacity into 1x.',
        'Each layer skipped removes roughly an order of magnitude of latency.',
        'Caches absorb traffic spikes that would otherwise require provisioning for peak.',
        '`stale-if-error` lets a backend outage degrade to slightly-old data rather than a blank page.',
        'Negative caching protects the database from enumeration and broken retry loops.'
      ],
      costs: [
        'Every layer is a second source of truth with no transaction linking it to the first.',
        '"I changed it and it did not update" becomes a multi-team debugging exercise.',
        'Cache key design becomes security-relevant the moment responses are personalised.',
        'The browser HTTP cache is unreachable -- a bad TTL cannot be recalled.',
        'High hit rates hide database regressions until a cold-cache event exposes them all at once.',
        'Memory is finite, so eviction can silently turn your 95% hit rate into 60% as the dataset grows.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'Stampede at TTL expiry on a hot key', blast: 'Thousands of simultaneous identical DB queries; database saturates and the miss becomes self-sustaining.', fix: 'Request collapsing (single-flight lock), TTL jitter, early probabilistic recompute, and serve-stale-while-revalidating.' },
        { mode: 'Hot key on one Redis shard', blast: 'One node at 100% CPU while the cluster idles; adding shards changes nothing.', fix: 'Replicate the key under N suffixes and read a random one, plus a 1-2 s in-process cache in front of Redis.' },
        { mode: 'Personalised response cached under a shared key', blast: 'User A\'s name, email or balance served to user B -- a reportable data incident, not a bug.', fix: 'Default `private, no-store`; caching opt-in per route; CI check that no response with `Set-Cookie`/`Authorization` context is `public`.' },
        { mode: 'No negative caching', blast: 'Random-ID traffic passes every layer straight to the database; trivial to weaponise.', fix: 'Cache not-found sentinels with a shorter TTL (~30 s). Consider a Bloom filter for very large key spaces.' },
        { mode: 'Schema change with live old-shape entries', blast: 'Mixed response shapes crash clients for the length of the longest TTL.', fix: 'Version prefix in the key so a deploy abandons every old entry atomically. Never mutate a shape in place.' },
        { mode: 'Cache-aside update race', blast: 'Cache holds v1 while the DB holds v2, with a fresh TTL -- permanently inconsistent and invisible.', fix: 'Delete on write rather than update. For a real guarantee, compare-and-set on a monotonic version.' },
        { mode: 'Redis outage with cache-aside', blast: '100% miss rate instantly; the database receives traffic it was never sized for.', fix: 'Circuit-break to a degraded read path, load-shed non-essential queries, and keep an in-process L1 so a Redis blip is not a 20x DB multiplier.' },
        { mode: 'Uncoordinated TTLs across layers', blast: 'A value expires in Redis but the CDN holds it for 5 more minutes; freshness is the *longest* TTL, not the shortest.', fix: 'Document the effective staleness budget as the sum of the layers and make TTLs decrease as you move outward.' }
      ]
    },

    {
      t: 'staff',
      md: `Senior candidates add caches. Staff candidates own the staleness budget and can say who
gets paged when it is wrong. Sentences that land:

- "Our advertised freshness is the *sum* of the layers, not the minimum. Query cache 30 s, CDN
  \`s-maxage\` 60 s, Redis 300 s -- worst case a user sees data six and a half minutes old. If
  product needs 60 seconds, I need to fix Redis, not the frontend."
- "I would not cache that at the edge. It is personalised, and the failure mode of a wrong cache
  key here is serving one customer's balance to another. I would cache the shell and fetch the
  personalised strip separately so the two have different policies."
- "That key has a 60-second TTL and takes 5,000 rps. Every minute we send 5,000 identical queries
  to Postgres in the same millisecond. We need single-flight plus jitter -- and jitter matters
  because all these keys were populated by the same deploy, so they expire together."
- "Put a version prefix in the key. \`product:v4:42\`. Then the schema change ships with the deploy
  and every old-shape entry is abandoned atomically -- no purge script, no window where clients
  see two shapes."
- "Delete the key on write, never update it. Updating races with an in-flight read that already
  has the old row, and the loser writes stale data back with a fresh TTL. That inconsistency
  never expires."
- "Our 96% hit rate is also hiding something: nobody knows how the database behaves at 25x its
  current read load. I want a game day that cold-starts the cache in staging so we find out
  deliberately rather than during an incident."
- "The browser HTTP cache is the one layer with no operator lever. Whatever \`max-age\` we ship on
  HTML is a commitment we cannot revoke, so it gets \`max-age=0\` with \`s-maxage\` at the edge."

The pattern in all of these: name the layer, name the staleness it contributes, name who can
invalidate it, and name the blast radius of the key being wrong.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'A product page shows an old price. Query cache staleTime is 30 s, CDN `s-maxage` is 60 s, the BFF caches for 10 s, and Redis holds the price for 300 s. What is the worst-case staleness a user can observe?',
          options: [
            '30 seconds -- the shortest TTL wins.',
            '300 seconds -- the longest single TTL.',
            'About 400 seconds -- the layers compose, since each can be populated from an already-stale layer below.',
            'Unbounded, because the browser cache has no TTL.'
          ],
          answer: 2,
          why: 'Staleness composes downward. Redis can hand a 299-second-old price to the BFF, which caches that for 10 s, which the CDN then caches for 60 s, which the query cache then holds for 30 s. The user\'s worst case is roughly the sum, not the max and definitely not the min. This is why a freshness requirement has to be allocated as a budget across layers -- and why the fix for "the price is stale" is almost always at the *innermost* long-TTL layer, not the one closest to the user.'
        },
        {
          q: 'You switch from `DELETE key` to `SET key <new value>` on every write, reasoning that it saves the next reader a cache miss. What did you introduce?',
          options: [
            'Nothing -- writing through is strictly better than deleting.',
            'A race where a concurrent slow read writes its older value after your update, leaving the cache permanently inconsistent with the database.',
            'A stampede, because every write now expires the key.',
            'Higher memory use only.'
          ],
          answer: 1,
          why: 'The interleaving is: reader R reads v1 from the database and stalls; writer W commits v2 and sets the cache to v2; R resumes and sets the cache to v1 with a fresh TTL. The cache now serves v1 while the database holds v2, and nothing corrects it until the TTL elapses -- there is no error, no log line, and no alert. Deleting on write does not eliminate the race but collapses it to the gap between delete and the next read, after which the cache repopulates from current state. A real guarantee needs compare-and-set against a monotonic version.'
        },
        {
          q: 'One Redis node is at 100% CPU while the other eleven are near idle. Traffic is dominated by reads of a single trending item. What actually helps?',
          options: [
            'Add more shards to the cluster.',
            'Increase the TTL on that key.',
            'Replicate the value under N suffixed keys and read a random one, and add a 1-2 s in-process cache in front of Redis.',
            'Switch the cluster to write-back.'
          ],
          answer: 2,
          why: 'Redis Cluster assigns a key to a slot by hashing the key, so a single key is always on exactly one node no matter how many shards exist -- adding capacity cannot spread a single key. You either spread the key artificially (`item:42:0` through `item:42:9`, read one at random, invalidate all on write) or you stop the requests reaching Redis at all, which is what a very short in-process L1 does: at 5,000 rps across 20 hosts, a 1-second local TTL turns 5,000 Redis reads per second into 20. A longer TTL does not reduce read rate, and write-back is about write durability, which is not the problem here.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `Layer 5 gets full treatment in **CDN & Edge Delivery**, including the personalisation
leak. Layers 1 and 2 -- and the normalisation problem -- are **State: What Belongs Where**. The
conditional-request and \`Cache-Control\` mechanics are in **HTTP, HTTP/2 & HTTP/3**. The service
worker kill switch is a **Deployment, Rollout & Migration** concern, and detecting which layer is
stale in production needs **Frontend Observability**.`
      }]
    }
  ],

  flashcards: [
    { q: 'Which cache layer can you never invalidate?', a: 'The HTTP browser cache. Once a response is stored with a `max-age`, it lives on the user\'s disk for that duration and no purge, deploy or API reaches it. The only recovery is serving from a different URL -- which is why content-hashed filenames exist.' },
    { q: 'What is a cache stampede and what are the three defences?', a: 'When a hot key expires, every concurrent request misses at once and all hit the origin for the same value. Defences: request collapsing (single-flight lock so one recomputes), TTL jitter so keys do not expire together, and early probabilistic recompute or serve-stale-while-revalidating so nobody meets a cold key.' },
    { q: 'Why does adding Redis shards not fix a hot key?', a: 'Cluster mode maps a key to a slot by hashing the key, so one key always lives on one node regardless of cluster size. You must either spread the value across N suffixed keys or prevent the reads reaching Redis at all with a very short in-process cache.' },
    { q: 'Cache-aside vs write-back -- what is the real difference?', a: 'Cache-aside populates on miss and writes go to the database, so a cache failure means slow, not lost. Write-back acknowledges the write from the cache and flushes asynchronously, so writes are fast but unflushed data is permanently lost if the cache dies. Acceptable for counters and metrics, never for orders.' },
    { q: 'Why delete a cache key on write rather than update it?', a: 'Updating races with an in-flight read that already holds the old row: the slow reader writes its stale value after your update, with a fresh TTL, leaving a silent inconsistency that never resolves. Deleting shrinks the window to the gap before the next read, which repopulates from current state.' },
    { q: 'What does a version prefix in a cache key buy you?', a: '`product:v3:42` means a schema change is deployed by bumping the prefix. Every old-shape entry is abandoned atomically with no purge and no window where clients receive two different shapes; the orphans simply expire.' },
    { q: 'What is negative caching and why is the TTL shorter?', a: 'Storing a "not found" sentinel so repeated lookups of a non-existent ID do not pass through to the database -- the defence against enumeration and broken retry loops. The TTL is shorter (say 30 s vs 300 s) because not-found becoming found is a far likelier transition than the reverse.' },
    { q: 'How do you calculate the staleness a user can actually observe?', a: 'Roughly the sum of the TTLs along the path, not the minimum -- each layer can be populated from an already-stale layer beneath it. Allocate freshness as a budget across layers, and make TTLs shorten as you move outward toward the user.' },
    { q: 'Why is a very high hit rate a risk as well as a win?', a: 'It hides how the origin behaves under real load. A 96% hit rate means the database has never seen 25x its current read volume, so a cache outage or cold start is an untested capacity event. Find out deliberately with a cold-start game day rather than during an incident.' }
  ],

  drills: [
    {
      prompt: 'A merchant updates a product price in your admin tool. Support tickets say customers still see the old price up to eight minutes later, inconsistently -- sometimes the listing is new and the detail page is old. The stack is React Query, a CDN, a Node BFF, Redis, and Postgres. Find it and fix it.',
      probes: [
        'How do you determine which layer is serving the stale value, without guessing?',
        'Why is the listing fresh while the detail page is stale?',
        'What is your freshness target, and how do you allocate it across layers?',
        'How do you make this class of bug diagnosable in ten minutes next time?'
      ],
      strong: [
        'Proposes a deterministic isolation procedure: query Redis directly for the key, curl the BFF bypassing the CDN, curl through the CDN reading the cache-status header, then check the client query cache -- narrowing layer by layer rather than theorising.',
        'Explains that staleness composes, so eight minutes is consistent with a ~300 s Redis TTL plus a BFF and CDN TTL layered on top.',
        'Identifies the listing/detail divergence as an invalidation-coverage problem: the write path invalidates one key but the same entity appears under several keys, which is the argument for tag-based purge or normalised keys.',
        'Sets an explicit freshness budget (e.g. 60 s end to end) and allocates it, shortening the innermost TTL because outer layers cannot be fresher than what they are given.',
        'Prefers delete-on-write plus a version prefix over an update, and names the read-repopulation race as the reason.',
        'Adds observability: emit cache-layer and age on every response (`X-Cache`, `Age`), and expose a per-entity "where is this cached" debug endpoint.'
      ],
      weak: [
        'Suggests "purge the CDN" as the fix without establishing which layer is stale.',
        'Believes the shortest TTL determines observable freshness.',
        'Lowers every TTL to 5 seconds and does not mention the resulting origin load or stampede risk.',
        'Does not notice that one entity is cached under multiple keys.',
        'Has no plan for diagnosing it faster next time.'
      ]
    },
    {
      prompt: 'Your Redis cluster fails over during peak traffic. The 30-second gap produces a 100% miss rate, Postgres hits connection-pool exhaustion, and the site is down for eleven minutes -- eight of them after Redis was already healthy. Design the resilience story.',
      probes: [
        'Why did it stay down after Redis recovered?',
        'What should the app do when the cache is unavailable?',
        'How do you avoid every process recomputing the same values on recovery?',
        'How would you validate the fix without waiting for the next failover?'
      ],
      strong: [
        'Names the amplification explicitly: a 95% hit rate means a cache outage is a 20x instantaneous read multiplier on the database.',
        'Explains the long tail as a cold-cache stampede plus pool exhaustion -- slow queries hold connections, so throughput collapses further and the system cannot recover on its own.',
        'Adds a small in-process L1 with a 1-2 s TTL so a Redis blip does not become a full multiplier, and accepts the per-host staleness that implies.',
        'Adds single-flight on recompute so N processes issue one query per key, plus jitter so the repopulating keys do not all expire together later.',
        'Adds load shedding and a bounded queue in front of Postgres, plus a circuit breaker that serves a degraded read path or cached-stale rather than queuing indefinitely.',
        'Distinguishes must-be-fresh reads from nice-to-have ones and sheds the latter first, naming which product surfaces degrade.',
        'Validates with a deliberate game day: cold-start the cache in staging at production read volume and measure where the pool saturates.'
      ],
      weak: [
        'Answers "add a Redis replica" and stops, addressing availability but not amplification.',
        'Does not explain the eight minutes after recovery.',
        'Proposes retries on the database without a circuit breaker or shedding.',
        'Claims the fix is a bigger Postgres instance, with no estimate of the 20x multiplier.',
        'Has no way to test it other than waiting for the next incident.'
      ]
    }
  ]
};
