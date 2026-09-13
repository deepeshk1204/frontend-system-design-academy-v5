export default {
  blocks: [
    {
      t: 'prose',
      md: `A server-side cache is a second, faster, less trustworthy copy of your data that you put
in front of the first one. The speedup is real -- a Redis lookup is roughly 0.2 ms against a
Postgres query's 5-20 ms -- and it is almost never the interesting part.

The interesting part is that you have created a second source of truth with no constraints, no
transactions and its own failure modes, and the moments that hurt are the transitions: what happens
the instant a key expires, the instant the cache is empty, the instant one key becomes 40% of your
traffic, and the instant the cached value and the database disagree.`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `Two independent pressures. The first is latency: some values are expensive to produce --
a query with four joins, a permission set assembled from three services, a rendered template -- and
producing them per request is wasteful when the answer is identical for thousands of requests.

The second, and the one that actually forces the decision, is capacity. A database has a hard
concurrency ceiling: a machine with 16 cores and an SSD executes a few dozen queries at once, no
matter how many connections you offer it. At 50,000 rps with a 95% hit rate the database sees 2,500
rps; at a 90% hit rate it sees 5,000. Halving your miss rate halves the database load, which is why
hit rate is not a vanity metric -- it is the ratio that decides whether your primary survives.

That arithmetic also contains the warning. A cache at 95% hit rate is not making the database 20x
faster; it is hiding the fact that your database cannot serve the traffic at all. Lose the cache
and you do not degrade, you fall over.`
    },
    {
      t: 'numbers',
      title: 'The figures that drive cache design',
      items: [
        { v: '~0.2 ms', k: 'Redis GET, same AZ', note: 'Dominated by the network round trip' },
        { v: '~100k ops/s', k: 'Single Redis core, simple commands', note: 'One thread for command execution' },
        { v: '95% to 90%', k: 'Doubles origin load', note: '2,500 rps becomes 5,000 rps at 50k total' },
        { v: '1 ms', k: 'O(N) command on 100k elements', note: 'A `KEYS` or big `HGETALL` blocks everything' },
        { v: '16,384', k: 'Redis Cluster hash slots', note: 'Fixed; keys map to slots by CRC16' }
      ]
    },

    { t: 'h', text: 'The five patterns' },
    {
      t: 'table',
      cols: ['Pattern', 'Read path', 'Write path', 'Right when', 'Cost'],
      rows: [
        ['**Cache-aside** (lazy)', 'App checks cache, on miss loads DB and populates', 'App writes DB and invalidates the key', 'Default for almost everything; read-heavy, unpredictable keys', 'Every miss pays full latency; stampede risk at expiry'],
        ['**Read-through**', 'Cache library or proxy loads on miss', 'Same as cache-aside', 'You want one place to own loading and coalescing', 'Less control; the loader is now infrastructure'],
        ['**Write-through**', 'Always a hit for written keys', 'Write cache and DB synchronously', 'Values read immediately after write; read-your-writes needed', 'Write latency is the sum of both; caches data never read'],
        ['**Write-behind** (write-back)', 'Serves from cache', 'Write cache, flush to DB asynchronously', 'Extreme write rates that tolerate loss -- counters, view tallies', 'Acknowledged writes can be lost; ordering and conflicts are yours'],
        ['**Refresh-ahead**', 'Always a hit', 'Background job refreshes before expiry', 'Small, hot, predictable key set -- config, feature flags, rates', 'Refreshes keys nobody wants; wasted work if the set is large']
      ]
    },
    {
      t: 'prose',
      md: `Cache-aside is the default because it is the only pattern that is cheap when your key
space is large and access is unpredictable -- you populate exactly what is asked for. Its two
weaknesses are that every miss pays the full uncached latency, and that all misses for a hot key
happen at the same moment when the TTL fires.

Write-through is the right answer more often than people think, specifically when a user writes
something and immediately reads it back. Cache-aside with invalidate-on-write means that read is a
guaranteed miss at the worst possible moment, right after you told the user "saved". Write-behind
is the one to treat with suspicion: it is genuinely useful for counters where losing thirty seconds
of increments is acceptable, and it is wrong for anything a user believes is durable, because you
acknowledged a write that exists only in memory.`
    },

    { t: 'h', text: 'Redis data structures mapped to real problems' },
    {
      t: 'prose',
      md: `Treating Redis as a string-to-string map wastes most of what makes it useful. The data
structures are not conveniences; each one turns a multi-round-trip application algorithm into a
single atomic server-side operation.`
    },
    {
      t: 'code',
      lang: 'text',
      title: 'Structure, command, and the problem it removes',
      code: `# Sorted set: leaderboards. Rank and range are O(log N), not a sort.
ZADD  game:1138:scores 48210 user:7
ZREVRANGE game:1138:scores 0 9 WITHSCORES     # top 10
ZREVRANK  game:1138:scores user:7             # "you are #418" without reading 418 rows

# Sorted set again: a sliding-window rate limiter, score = timestamp.
ZREMRANGEBYSCORE rl:user:7 0 <now_ms - 60000> # drop everything older than 60s
ZCARD            rl:user:7                    # exact count in the window
ZADD             rl:user:7 <now_ms> <uuid>
EXPIRE           rl:user:7 60

# Hash: an object with independently updatable fields. One key, partial writes.
HSET  session:abc user_id 7 last_seen 1772... cart_count 3
HINCRBY session:abc cart_count 1              # no read-modify-write race
HGETALL session:abc                           # O(N) -- fine at 10 fields, not 10,000

# Stream: a durable log with consumer groups, acks and replay.
XADD   orders:events '*' type created id 01HQ8Z
XREADGROUP GROUP fulfil worker-3 COUNT 10 BLOCK 2000 STREAMS orders:events '>'
XACK   orders:events fulfil 1772000000-0
XAUTOCLAIM orders:events fulfil worker-4 30000 0-0   # steal a dead worker's messages

# HyperLogLog: cardinality in 12 KB with ~0.81% error, at any scale.
PFADD  dau:2026-03-13 user:7 user:99 user:412
PFCOUNT dau:2026-03-13                        # unique visitors
PFMERGE dau:2026-W11 dau:2026-03-09 dau:2026-03-10   # weekly uniques, still 12 KB

# Set: membership and set algebra server-side.
SINTERCARD 2 followers:7 followers:99         # mutual follower count, no data transfer

# Bitmap: one bit per user id. 10 million users = 1.25 MB.
SETBIT feature:newui 7 1
BITCOUNT feature:newui                        # how many users are in the rollout`
    },
    {
      t: 'prose',
      md: `The HyperLogLog case is the most striking economically. Counting distinct daily visitors
exactly requires storing every id you have seen -- 10 million 8-byte ids is 80 MB per day per
metric. A HyperLogLog holds the same answer in 12 KB with about 0.81% standard error, and merges
across days without re-reading anything. When the product question is "roughly how many unique
users", trading 0.81% accuracy for a factor of 6,000 in memory is not a compromise, it is the
correct answer.

The operational rule across all of these is to respect command complexity. Redis executes commands
on a single thread, so any O(N) command on a large collection blocks *every other client* for its
duration. \`KEYS *\` on a million-key instance is a multi-second full stop -- use \`SCAN\`.
\`HGETALL\` on a 50,000-field hash is the same mistake wearing a different hat. \`SMEMBERS\` on a
large set, \`ZRANGE 0 -1\`, and \`DEL\` of a huge collection (use \`UNLINK\`) all belong on the
same list.`
    },

    { t: 'h', text: 'Stampede protection' },
    {
      t: 'prose',
      md: `A key with 8,000 rps of traffic and a 60-second TTL has a specific, predictable
catastrophe built into it. At the moment of expiry, all 8,000 concurrent requests miss, and all
8,000 execute the expensive query. The database receives 8,000 concurrent queries instead of the
one it needed, and if that query takes 200 ms you now also have 8,000 held connections. Latency
spikes, some requests time out and retry, and the retries arrive while the stampede is still
running. This is cache stampede, or thundering herd, and it is the single most common way a cache
takes down the thing it was protecting.

Three defences, and they compose.`
    },
    {
      t: 'diagram',
      code: `sequenceDiagram
  participant R1 as Request 1
  participant R2 as Requests 2-8000
  participant C as Redis
  participant DB as Postgres
  R1->>C: GET feed:home
  C-->>R1: miss
  R1->>C: SET NX lock:feed:home ttl 10s
  C-->>R1: acquired
  R1->>DB: expensive query
  R2->>C: GET feed:home
  C-->>R2: miss
  R2->>C: SET NX lock:feed:home
  C-->>R2: not acquired
  Note over R2: serve stale copy<br/>or wait and re-read
  R1->>C: SET feed:home value ttl 60s
  R1->>C: DEL lock:feed:home`,
      caption: 'One request rebuilds, the rest serve the stale copy. The stale copy is the important half -- without it, 7,999 requests either block or fail.'
    },
    {
      t: 'code',
      lang: 'javascript',
      title: 'Locking plus stale-while-revalidate, the production shape',
      code: `const HARD_TTL = 600;   // Redis key lifetime -- the stale copy lives this long
const SOFT_TTL = 60;    // logical freshness -- after this we want a rebuild

async function getCached(key, loader) {
  const raw = await redis.get(key);

  if (raw) {
    const { value, freshUntil } = JSON.parse(raw);
    if (Date.now() < freshUntil) return value;          // fresh: done

    // Stale. Exactly one caller rebuilds; everyone else keeps serving stale.
    const gotLock = await redis.set(\`lock:\${key}\`, '1', 'NX', 'EX', 10);
    if (!gotLock) return value;                          // 7,999 requests end here
    rebuild(key, loader).catch(err => log.warn({ err, key }, 'rebuild failed'));
    return value;                                        // do not make this caller wait
  }

  // Cold key: nothing to serve stale. Now we must coalesce in-process too,
  // or 200 concurrent requests on one instance each hit Redis and the DB.
  return inflight(key, async () => {
    const gotLock = await redis.set(\`lock:\${key}\`, '1', 'NX', 'EX', 10);
    if (!gotLock) {
      await sleep(50 + Math.random() * 100);
      const retry = await redis.get(key);
      if (retry) return JSON.parse(retry).value;
    }
    return rebuild(key, loader);
  });
}

async function rebuild(key, loader) {
  try {
    const value = await loader();
    await redis.set(key, JSON.stringify({
      value,
      // Jitter the soft TTL so keys written together do not expire together.
      freshUntil: Date.now() + (SOFT_TTL * 1000 * (0.8 + Math.random() * 0.4))
    }), 'EX', HARD_TTL);
    return value;
  } finally {
    await redis.del(\`lock:\${key}\`);
  }
}

// Per-process request coalescing. Cheap, and it removes 99% of the pressure
// before any of it reaches Redis.
const pending = new Map();
function inflight(key, fn) {
  if (pending.has(key)) return pending.get(key);
  const p = fn().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}`
    },
    {
      t: 'prose',
      md: `The third technique is **probabilistic early expiry**, from the XFetch paper, and it is
elegant enough to be worth knowing. Instead of a hard expiry instant, each reader independently
decides whether to refresh with a probability that rises as the key approaches expiry, weighted by
how expensive the key was to compute. The test is
\`now - delta * beta * ln(random()) >= expiry\`, where \`delta\` is the measured recompute time.
Expensive keys get refreshed earlier and by fewer readers; cheap keys refresh lazily. No locks, no
coordination, and the refresh load is spread smoothly across the window rather than concentrated at
one instant.

Notice that the three mechanisms address different scopes and you generally want all of them:
in-process coalescing removes duplicate work within one instance, the Redis lock removes duplicates
across instances, and serving stale removes the user-visible latency spike entirely.`
    },

    { t: 'h', text: 'Hot keys' },
    {
      t: 'prose',
      md: `Redis Cluster shards by hashing the key to one of 16,384 slots, so a single key lives on
exactly one node and its throughput ceiling is that node's single command-execution thread --
roughly 100,000 simple operations per second. A celebrity profile, a global feature-flag document
or a homepage feed can genuinely exceed that, and when it does, the symptom is one cluster node
pinned at 100% CPU while the rest idle. Adding nodes does nothing, because the key cannot move to
two places.

Three mitigations, in order of how often they are the right answer. **A local in-process cache in
front of Redis** with a 1-5 second TTL: if 200 application instances each cache the hot value
locally for 2 seconds, Redis sees 100 requests per second instead of 200,000. The cost is up to 2
seconds of extra staleness and no way to invalidate promptly, which is acceptable for exactly the
kind of value that becomes hot. **Key replication**: store \`feed:home:0..9\` and have each reader
pick one at random, spreading load across ten slots at the cost of ten copies to invalidate.
**Client-side caching** via Redis 6's tracking mode, where the server invalidates client caches
when a key changes -- the right answer in principle, but it requires client support and careful
handling of the invalidation stream.

Finding hot keys is its own problem, because per-key metrics at that cardinality are expensive.
\`redis-cli --hotkeys\` samples, \`MONITOR\` is a debugging tool you must never leave running, and
the honest answer in most shops is a sampled counter in the client library.`
    },

    { t: 'h', text: 'Eviction and memory pressure' },
    {
      t: 'prose',
      md: `When Redis reaches \`maxmemory\` it consults \`maxmemory-policy\`, and the default in
many distributions -- \`noeviction\` -- means write commands start returning
\`OOM command not allowed\`. For a pure cache that is exactly wrong: you want it to discard
something rather than fail. But it is exactly *right* if the same instance also holds sessions,
queues or locks, because silently evicting a distributed lock is much worse than an error.

Which is the real lesson: do not put a cache and a data store in the same Redis instance. They want
opposite eviction policies, and no single setting serves both.`
    },
    {
      t: 'table',
      cols: ['`maxmemory-policy`', 'Behaviour', 'Use for'],
      rows: [
        ['`noeviction`', 'Writes fail with an OOM error; reads still work', 'Instances holding queues, locks or sessions -- anything whose loss is a bug'],
        ['`allkeys-lru`', 'Approximated LRU across all keys', 'A pure cache where every key is disposable'],
        ['`allkeys-lfu`', 'Approximated least-frequently-used, with decay', 'Pure cache with a stable hot set -- usually better than LRU; resists one-off scans polluting the cache'],
        ['`volatile-lru` / `volatile-lfu`', 'Evicts only keys that have a TTL', 'Mixed instances -- but *only* if every cache key reliably has a TTL'],
        ['`volatile-ttl`', 'Evicts the keys expiring soonest', 'Rarely optimal; soonest-expiring is not least-valuable'],
        ['`allkeys-random`', 'Uniform random', 'Very high churn where tracking recency costs more than it saves']
      ]
    },
    {
      t: 'note',
      tone: 'warn',
      title: 'The `volatile-*` trap',
      md: `With \`volatile-lru\`, keys without a TTL are never evicted. One code path that writes a
cache key without \`EX\` slowly fills the instance with immortal keys until the evictable pool is
too small to satisfy allocations, at which point writes start failing even though the policy says
evict. The signature is \`evicted_keys\` flat while \`used_memory\` sits at \`maxmemory\` and errors
climb. Enforce TTLs in a wrapper rather than trusting every call site.`
    },

    { t: 'h', text: 'Persistence, failover, and what you lose' },
    {
      t: 'prose',
      md: `Redis offers RDB snapshots, an append-only file, or both. **RDB** forks the process and
writes a point-in-time dump; the fork is copy-on-write, so a 20 GB instance under heavy writes can
briefly approach double its memory as pages diverge -- which is how a snapshot causes an OOM kill.
Recovery is fast, but you lose everything since the last snapshot, typically minutes. **AOF**
appends every write command; with \`appendfsync everysec\` you lose at most a second, at the cost
of continuous disk I/O and a rewrite process that periodically compacts the log. Recovery replays
the log and is slower.

The point worth being clear about: replication to a Redis replica is **asynchronous**, so a
failover promotes a replica that may be missing the last writes the primary acknowledged. Redis
Sentinel and managed offerings do not change this -- the \`WAIT\` command can block until N replicas
acknowledge, but it is not a consensus protocol and does not make the system linearisable. This is
the technical core of the Redlock critique: a lock manager built on asynchronous replication can
hand the same lock to two clients after a failover, so any correctness-critical lock needs a fencing
token that the protected resource validates. If your design says "we take a Redis lock so only one
worker processes this", you have a correctness assumption that a failover will violate.

For a pure cache, the honest configuration is often *no persistence at all*. Loading a cold cache
from an RDB restores a snapshot of stale data, and you have a cold-start problem either way. What
you need instead is a warm-up path and the ability to survive an empty cache.`
    },

    { t: 'h', text: 'Cluster: slots and multi-key limits' },
    {
      t: 'prose',
      md: `In Redis Cluster every key hashes via CRC16 to one of 16,384 slots, and each slot is owned
by one node. Consequently any command touching multiple keys only works if those keys are on the
same node -- \`MGET a b c\` fails with \`CROSSSLOT\` unless all three landed together, and so do
transactions (\`MULTI\`), Lua scripts declaring multiple keys, and \`SINTER\`.

The escape hatch is **hash tags**: only the substring inside \`{...}\` is hashed, so
\`user:{7}:profile\` and \`user:{7}:prefs\` map to the same slot and can be read or scripted
together. This is powerful and is also how you accidentally build a hot slot, because deliberately
co-locating all of a large tenant's keys concentrates their entire load on one node. Use hash tags
for small, genuinely-atomic groups -- and remember that resharding moves slots, so a single-key Lua
script is always safe while a multi-key one is a constraint you must maintain forever.`
    },
    {
      t: 'code',
      lang: 'text',
      title: 'What works and what does not',
      code: `# Fails: keys hash to different slots.
MGET user:7:profile user:99:profile
  (error) CROSSSLOT Keys in request don't hash to the same slot

# Works: the hash tag forces co-location.
MGET user:{7}:profile user:{7}:prefs

# Works everywhere -- one key, so any Lua script is reshard-safe.
EVAL "return redis.call('INCR', KEYS[1])" 1 counter:{tenant42}

# Pipelining is not a transaction, but it is the throughput fix:
# 100 GETs in one round trip instead of 100 round trips.
# Cluster-aware clients split a pipeline per node automatically.`
    },

    { t: 'h', text: 'Cache consistency, and the delete-versus-update debate' },
    {
      t: 'prose',
      md: `On a write, you can update the cache with the new value or delete the key and let the next
read repopulate it. **Delete wins**, for three reasons, and it is worth being able to state them.

First, updating is a second write that can fail independently, leaving the cache wrong with no error
path. Second, the update races: two concurrent writers can apply their cache updates in the opposite
order to their database commits, leaving the cache holding the older value permanently -- and unlike
a stale-until-TTL value, this one never self-corrects. Third, updating caches keys nobody will read,
which is wasted work and wasted memory.

Even delete has a race, and you should know its shape: reader misses, reads the old value from the
database, writer commits, writer deletes the key, reader writes its stale value into the cache. Now
the cache is wrong until the TTL. This window is narrow but real. The mitigations are a short TTL so
it self-heals (usually sufficient), delayed double-delete -- delete again after a few hundred
milliseconds -- or driving invalidation from the database's change log with CDC so the ordering
follows commit order rather than application-code order.

The ordering of the two operations also matters. Write the database *then* invalidate: if
invalidation fails you have a stale cache that expires. Invalidate *then* write and a concurrent
read can repopulate the old value in between, after which the write commits and the cache is stale
with nothing to fix it. And for a write-then-invalidate, do the invalidation *after* the commit, not
inside the transaction -- otherwise a reader can repopulate from the pre-commit state.`
    },
    {
      t: 'prose',
      md: `**Negative caching** is the other half of consistency people forget. If \`GET
/users/does-not-exist\` returns a miss and you cache nothing, every request for that key hits the
database -- and a scanner probing random ids gives you a 0% hit rate on an endpoint you thought was
cached. Cache the absence with a short TTL (30-60 seconds, much shorter than positive entries) and
a sentinel value distinguishable from "no entry". For very large key spaces where most lookups are
misses, a Bloom filter in front answers "definitely not present" in microseconds without a lookup
at all.`
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      title: 'Introducing a Redis cache in front of your database',
      gains: [
        'Reads drop from 5-20 ms to about 0.2 ms.',
        'Origin load falls by the hit rate -- 95% means one twentieth of the queries.',
        'Data structures move multi-round-trip algorithms server-side and make them atomic.',
        'Absorbs read spikes the database could not physically serve.',
        'Rate limiters, leaderboards, sessions and queues all become cheap.'
      ],
      costs: [
        'A second source of truth with no constraints and its own consistency bugs.',
        'You now depend on it: the database cannot serve the traffic the cache was hiding.',
        'Every key needs a TTL, an invalidation story and a stampede defence.',
        'Hot keys are capped by one node\'s single thread and cannot be scaled away.',
        'Cluster forbids multi-key operations across slots, constraining your key design permanently.',
        'A failover loses recent writes, so locks and counters built on it are not authoritative.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'Stampede at TTL expiry on a hot key', blast: '8,000 concurrent identical queries hit the database; latency spike, connection exhaustion, retry amplification.', fix: 'Soft/hard TTL with stale-while-revalidate, `SET NX` rebuild lock, in-process coalescing, and jittered TTLs.' },
        { mode: 'Synchronised TTLs from a bulk warm-up', blast: 'Thousands of keys written in one batch all expire in the same second; periodic origin load spikes.', fix: 'Randomise each TTL by ±20% at write time.' },
        { mode: 'Hot key exceeding one node\'s throughput', blast: 'One cluster node at 100% CPU, cluster-wide latency rise, adding nodes has no effect.', fix: 'Short-TTL local cache in front of Redis, key replication across suffixes, or client-side caching with tracking.' },
        { mode: 'Cache and locks in the same instance under `allkeys-lru`', blast: 'A distributed lock is silently evicted; two workers process the same job.', fix: 'Separate instances. `noeviction` for correctness data, `allkeys-lfu` for the cache, and fencing tokens regardless.' },
        { mode: 'Cache-fill race writing a stale value', blast: 'A reader\'s pre-write value lands after the invalidation and persists until the TTL.', fix: 'Short TTL so it self-heals, delayed double-delete, or CDC-driven invalidation ordered by commit.' },
        { mode: 'No negative caching', blast: 'Requests for non-existent keys bypass the cache entirely; a scanner drives hit rate to zero.', fix: 'Cache absence with a 30-60 s TTL and a sentinel; Bloom filter for very sparse key spaces.' },
        { mode: 'Cold cache after a restart or flush', blast: 'Origin receives 100% of traffic it was never sized for and collapses; the cache cannot refill because everything times out.', fix: 'Load shedding and concurrency limits on the origin path, staged warm-up, and never flush the whole cache as a remedy.' },
        { mode: 'O(N) command on a large collection', blast: '`KEYS *` or `HGETALL` on 100k fields blocks the single command thread; every client sees a multi-second stall.', fix: '`SCAN` and `HSCAN`, `UNLINK` instead of `DEL`, and a lint rule banning `KEYS` and `FLUSHALL` in application code.' },
        { mode: 'Cached value used for authorisation', blast: 'Revoked permissions remain effective for the TTL -- a security incident, not a staleness bug.', fix: 'Short TTL plus explicit invalidation on revoke, or never cache the decision, only the inputs.' }
      ]
    },

    {
      t: 'staff',
      md: `Most candidates say "add Redis". The distinguishing content is the transitions -- expiry,
cold start, hot key, and disagreement with the database.

- "At 8,000 rps on that key with a 60-second TTL, the moment of expiry is 8,000 concurrent identical
queries. I want a soft TTL for freshness and a longer hard TTL so there is always a stale copy to
serve, one rebuild behind \`SET NX\`, and in-process coalescing so a single instance's 200 concurrent
requests become one Redis call."
- "The 95% hit rate means the database is sized for 2,500 rps and the real traffic is 50,000. So the
cache is not an optimisation, it is load-bearing -- and I want a documented answer for what happens
when it is empty, including admission control on the origin path so it can refill rather than
timing out forever."
- "Delete rather than update on write. Updating is a second write that can fail independently, and
two concurrent writers can apply cache updates in the opposite order to their commits, which leaves
a permanently wrong value that never self-heals. And invalidate *after* the commit, or a reader can
repopulate from the pre-commit state."
- "A single key is one slot on one node, so its ceiling is about 100,000 ops/s on one thread. If the
homepage feed exceeds that, I would put a 2-second in-process cache in front of Redis -- 200
instances at 2 seconds turns 200,000 rps into 100. The cost is 2 seconds of staleness, which for a
value that hot is fine."
- "I would not hold locks and cache in the same instance. They want opposite \`maxmemory-policy\`
settings, and an evicted lock means two workers doing the same job. Separately -- Redis replication
is asynchronous, so a failover can hand the same lock to two clients. If that matters, the lock
needs a fencing token the resource checks."
- "We are not negative caching, so every request for a missing id is a database query. That is why
the hit rate drops whenever someone scans us."

The common thread: each sentence names a number, a mechanism and a failure. The two that most
reliably separate people who have operated a cache are volunteering the cold-start question before
being asked, and knowing that Redis-based locking is not authoritative.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'A key serving 8,000 rps with a 60-second TTL causes a database latency spike every minute. Which single change removes the user-visible spike?',
          options: [
            'Increase the TTL to 600 seconds.',
            'Keep the value in Redis beyond its logical freshness and serve it stale while one request rebuilds.',
            'Add more Redis nodes.',
            'Move the query to a read replica.'
          ],
          answer: 1,
          why: 'Separating a soft TTL (when we want fresh data) from a hard TTL (when the key is removed) means there is always something to return, so no user waits for the rebuild -- and a `SET NX` lock ensures only one request performs it. A longer TTL only makes the spike less frequent and staler when it happens; extra Redis nodes do not help because the bottleneck is the database; a replica moves the spike rather than removing it.'
        },
        {
          q: 'On a write, is it better to update the cache with the new value or delete the key?',
          options: [
            'Update -- it avoids a miss on the next read.',
            'Delete -- updating can be applied out of order relative to commits, leaving a permanently stale value.',
            'Both are equivalent given a TTL.',
            'Update, but only inside the database transaction.'
          ],
          answer: 1,
          why: 'Two writers can commit in one order and apply their cache updates in the other, so the cache ends up holding the older value with no TTL-driven self-correction, because it was just written. Deleting makes the next read authoritative and also avoids caching keys nobody requests. Doing either inside the transaction is worse still: a concurrent reader can repopulate from the uncommitted state.'
        },
        {
          q: 'Your Redis instance holds cache entries, user sessions and distributed locks, with `maxmemory-policy allkeys-lru`. What is the specific risk?',
          options: [
            'Sessions will be evicted, logging users out.',
            'A lock can be evicted under memory pressure, so two workers process the same job.',
            'LRU tracking consumes too much memory.',
            'Locks will never be evicted because they have TTLs.'
          ],
          answer: 1,
          why: '`allkeys-lru` treats every key as disposable, including a lock key that has not been read recently -- and a lock silently disappearing breaks mutual exclusion with no error. Losing sessions is bad but recoverable; losing a lock is a correctness failure. Split the instances so cache data can use `allkeys-lfu` while correctness data uses `noeviction`, and add a fencing token, because asynchronous replication means a failover can duplicate a lock even without eviction.'
        },
        {
          q: 'In Redis Cluster, `MGET user:7:profile user:99:profile` returns `CROSSSLOT`. Why, and what is the fix if these must be fetched together atomically?',
          options: [
            'The client is misconfigured; enable cluster mode.',
            'The keys hash to different slots on different nodes; use a hash tag such as `user:{7}:profile` to co-locate related keys -- accepting that co-location concentrates load.',
            'Use `MULTI` instead of `MGET`.',
            'Increase the number of hash slots.'
          ],
          answer: 1,
          why: 'Keys map by CRC16 to one of 16,384 slots owned by a single node, so any multi-key command requires all keys in the same slot. Hash tags hash only the `{...}` substring, which lets you deliberately co-locate a group -- and that is exactly how hot slots are created, since all of one tenant\'s keys then share a node. Pipelining is the usual answer for throughput without atomicity, and cluster-aware clients split it per node automatically.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `Sliding-window and token-bucket limiters built on sorted sets and Lua are developed in
**Rate Limiting & Multi-Tenancy**. Why Redis-based locking is not authoritative, and what fencing
tokens fix, is **Consensus, Leases & Distributed Locks**. The cold-cache collapse is a metastable
failure and the admission control that prevents it is **Resilience: Timeouts, Retries &
Backpressure**. CDC-driven invalidation shares its pipeline with **Event-Driven Architecture, Sagas
& CQRS**, and the database-side costs the cache is hiding are in **Databases, Indexes & Query
Plans**.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why is the difference between a 95% and 90% hit rate so significant?', a: 'It doubles origin load. At 50,000 rps total, 95% leaves 2,500 rps on the database and 90% leaves 5,000. The cache is sized to make the database survivable, so hit rate directly determines whether it does.' },
    { q: 'Describe cache stampede and the three composable defences.', a: 'At TTL expiry every concurrent request for a hot key misses and runs the expensive load at once. Defend with in-process request coalescing, a `SET NX` rebuild lock across instances, and a soft/hard TTL so a stale copy is served while one caller rebuilds. Jitter TTLs so keys do not expire together.' },
    { q: 'What is probabilistic early expiry?', a: 'Each reader refreshes with a probability rising near expiry, weighted by measured recompute cost -- `now - delta * beta * ln(random()) >= expiry`. It spreads refreshes across the window with no locks or coordination, and refreshes expensive keys earlier.' },
    { q: 'Why can you not scale a hot Redis key by adding nodes?', a: 'A key hashes to exactly one of 16,384 slots, owned by one node, executing commands on one thread -- roughly 100,000 ops/s. Mitigate with a short-TTL local cache in front, key replication across suffixes, or client-side caching.' },
    { q: 'Why should cache data and locks live in different Redis instances?', a: 'They need opposite `maxmemory-policy` values. A cache wants `allkeys-lfu` so it discards under pressure; locks and queues want `noeviction` so they error instead, because silently evicting a lock breaks mutual exclusion.' },
    { q: 'What do you lose on a Redis failover?', a: 'Replication is asynchronous, so a promoted replica may be missing writes the primary already acknowledged. RDB loses everything since the last snapshot; AOF with `appendfsync everysec` loses up to a second. This is why Redis locks need fencing tokens.' },
    { q: 'Delete or update the cache on write, and why?', a: 'Delete. An update is a second write that can fail independently, and concurrent writers can apply updates in the opposite order to their commits, leaving a permanently stale value. Delete also avoids caching keys nobody reads. Invalidate after the commit, never inside the transaction.' },
    { q: 'What is negative caching and when do you need it?', a: 'Caching the absence of a value with a short TTL and a sentinel. Without it, every request for a missing key reaches the database, so a scanner probing random ids drives your hit rate to zero. A Bloom filter handles very sparse key spaces.' },
    { q: 'Why is `KEYS *` dangerous, and what else is on that list?', a: 'Redis executes commands on one thread, so an O(N) command on a large collection blocks every client. Also avoid `HGETALL` on huge hashes, `SMEMBERS` on large sets, `ZRANGE 0 -1`, and `DEL` of big collections -- use `SCAN`, `HSCAN` and `UNLINK`.' }
  ],

  drills: [
    {
      prompt: 'A product feed endpoint serves 30,000 rps with a 92% Redis hit rate. Someone runs `FLUSHALL` on the wrong instance. The database, sized for 2,400 rps, receives everything, all requests begin timing out at 3 seconds, and the cache does not refill even after twenty minutes. Explain the dynamics and how you would recover and then prevent it.',
      probes: [
        'Why does the cache fail to refill on its own?',
        'What are retries doing to the situation?',
        'What is your first action in the incident, and what does it cost users?',
        'What would have bounded the damage automatically?',
        'How would you make the cache non-load-bearing, or accept that it is?'
      ],
      strong: [
        'Identifies a metastable failure: every request needs a DB query, all queries queue, all time out, so nothing ever populates the cache.',
        'Notes retries multiply offered load precisely when capacity is lowest.',
        'Recovers by shedding a large fraction of traffic so the surviving fraction completes and warms the cache, then ramps back.',
        'Proposes a concurrency limit or semaphore on the DB-load path so at most N misses execute at once and the rest serve stale, degraded or 503.',
        'Adds request coalescing so duplicate misses do not multiply.',
        'Names guardrails: `FLUSHALL` disabled via `rename-command`, separate credentials, and no shared instance across environments.',
        'States the capacity truth plainly -- the DB cannot serve this traffic, so the plan is graceful degradation, not full-fidelity survival.'
      ],
      weak: [
        'Proposes scaling the database up as the primary answer with no load shedding.',
        'Suggests raising timeouts, which extends queueing and worsens it.',
        'Assumes the cache naturally refills once traffic stabilises.',
        'Does not distinguish shedding load from adding capacity.',
        'Never mentions retries as an amplifier.'
      ]
    },
    {
      prompt: 'You must cache a user\'s permission set, currently assembled from three services in 180 ms and read on every request at 12,000 rps. Security requires that a revoked permission stops working within 60 seconds. Design it, including what happens during a Redis outage and how you avoid a stampede on a hot admin account.',
      probes: [
        'What exactly do you cache -- the decision or the inputs?',
        'How do you guarantee the 60-second revocation bound?',
        'What do you do on a Redis outage: fail open, fail closed, or fall back?',
        'The company\'s shared service account makes 4,000 rps of the traffic. What breaks?',
        'How do you verify the revocation bound actually holds in production?'
      ],
      strong: [
        'Caches the assembled permission set with a TTL at or below 60 s, plus explicit invalidation on revoke for fast propagation.',
        'Treats the TTL as the security guarantee and invalidation as the optimisation, since invalidation can fail.',
        'Fails closed for privileged operations and considers a signed short-lived token as an alternative to a cache read per request.',
        'Local in-process cache with a few seconds of TTL to handle the 4,000 rps hot key, and states the added staleness explicitly.',
        'Stampede protection: soft/hard TTL with stale serving is unacceptable past 60 s, so uses lock plus coalescing and a bounded wait instead.',
        'Notes the tension: serving stale is the usual answer and here it is forbidden, so the design must absorb the rebuild instead.',
        'Proposes a canary that revokes a test permission and measures observed propagation time continuously.'
      ],
      weak: [
        'Caches for an hour and hopes invalidation always works.',
        'Serves stale permissions indefinitely during a Redis outage without stating it is a security decision.',
        'Fails open on cache errors with no discussion.',
        'Ignores the hot shared account.',
        'Relies on invalidation alone with no TTL as a backstop.'
      ]
    }
  ]
};
