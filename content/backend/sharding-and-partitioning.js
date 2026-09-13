export default {
  blocks: [
    { t: 'prose',
      md: `Sharding is splitting one logical dataset across several independent databases so that no single machine has to hold
all of it or serve all of the traffic. Each machine -- each *shard* -- owns a disjoint slice of the rows and knows
nothing about the others.

Everything difficult about sharding comes from one decision: **which column decides where a row lives?** That column
is the shard key, and once production data is spread according to it, changing it is a migration measured in
quarters, not sprints.` },

    { t: 'h', text: 'Why it exists' },
    { t: 'prose',
      md: `A single Postgres instance on modern hardware is far more capable than folklore suggests. A 64-core box with 512 GB
of RAM and NVMe storage will comfortably serve tens of thousands of simple transactions per second and hold several
terabytes. Vertical scaling plus read replicas plus a cache is the correct answer for the overwhelming majority of
systems.

Sharding exists because three specific walls are real and vertical scaling cannot climb them. The first is **write
throughput**: replicas do not help you, because every write still lands on the single leader. The second is
**working-set size**: once the hot index pages no longer fit in RAM, every lookup becomes a disk seek and p99
latency falls off a cliff. The third is **operational blast radius**: at some size a single instance means a single
\`VACUUM\` storm, a single failover, and a single schema migration that locks everyone at once.

Notice what is *not* on that list: total storage (cheap), read throughput (replicas), or "we're a big company now"
(not a reason).` },
    { t: 'numbers',
      title: 'Rough thresholds where people actually shard',
      items: [
        { v: '~10 TB', k: 'Single-instance data size', note: 'Backup/restore time becomes the pain, not queries' },
        { v: '~20-50k', k: 'Sustained writes/sec on one leader', note: 'Hardware-dependent; measure, do not guess' },
        { v: '>1 hr', k: 'Time to restore from backup', note: 'A recovery-time problem forces splitting' },
        { v: '2-4x', k: 'Engineering cost multiplier', note: 'Every feature now considers shard locality' }
      ] },
    { t: 'note',
      tone: 'warn',
      title: 'Cheaper things to try first, in order',
      md: `Add the missing index. Move the analytics queries off the primary onto a replica or a warehouse. Move append-only
high-volume tables (events, audit logs, sessions) into their own store -- this is *functional partitioning* and it
often buys a year. Archive cold rows out of the hot table. Add a cache with request collapsing. Upgrade the instance
class. Only then shard.` },

    { t: 'h', text: 'Vertical vs horizontal partitioning' },
    { t: 'prose',
      md: `Two different axes get called "partitioning" and conflating them causes confusion in interviews.

**Vertical partitioning** splits by *column* or by *table*. You move the rarely-read 40 KB \`profile_bio\` and
\`avatar_blob\` columns out of the \`users\` row so the hot row stays narrow and more rows fit per 8 KB page. Or you
move the whole \`events\` table onto its own cluster. This requires no distributed query planning and is usually the
first real scaling move.

**Horizontal partitioning** splits by *row*. Users 1-1,000,000 live here, 1,000,001-2,000,000 live there. This is
what people mean by sharding. Within a single database engine the same technique applied to one table is called
*declarative partitioning* (Postgres) -- same mechanics, one machine, and it gets you partition pruning and cheap
\`DROP PARTITION\` for time-series retention without any of the distributed-systems cost.` },

    { t: 'h', text: 'How rows get assigned to shards' },
    { t: 'diagram',
      code: `flowchart TB
  A["Write: user_id = 91473"] --> R{Routing layer}
  R -->|"Range: 90000-99999"| S2["Shard 2"]
  R -->|"Hash: h mod 4 = 1"| S1["Shard 1"]
  R -->|"Lookup table"| M[("Shard map<br/>in etcd")]
  M --> S3["Shard 3"]
  S1 --> RP1["Replicas"]
  S2 --> RP2["Replicas"]
  S3 --> RP3["Replicas"]`,
      caption: 'The routing layer can be a proxy (Vitess, Citus coordinator), a library in the app, or a shard map the app reads from etcd.' },
    { t: 'table',
      title: 'The three assignment strategies',
      cols: ['Strategy', 'How it maps', 'Range scans', 'Hot-spot risk', 'Rebalancing', 'Real users'],
      rows: [
        ['**Range**', 'Ordered key intervals per shard', 'Cheap -- one shard answers', 'High: monotonic keys (timestamps, auto-increment IDs) send all writes to the last shard', 'Split a range in two; needs a range map', 'HBase, Bigtable, CockroachDB, MongoDB ranged'],
        ['**Hash**', '`hash(key) mod N` or a hash ring', 'Expensive -- scatter-gather to all shards', 'Low for distinct keys, still high for a single hot key', 'Plain modulo reshuffles almost everything; consistent hashing does not', 'Cassandra, DynamoDB, Vitess default'],
        ['**Directory / lookup**', 'Explicit `tenant -> shard` table', 'Depends on placement', 'Controllable -- you can pin a whale tenant alone', 'Easiest: change one row, then move the data', 'Most multi-tenant SaaS, Slack, Notion'],
        ['**Geo / jurisdiction**', 'Region column decides shard', 'Within-region only', 'Uneven by population', 'Rare -- placement is a legal constraint', 'Anything with GDPR or data-residency terms']
      ] },
    { t: 'prose',
      md: `For B2B SaaS the directory approach is usually right and underrated. It is a small table, it caches trivially, and
it gives you something no hash function will: the ability to say "this one customer is 30% of our load, put them on
their own hardware" without changing any application code.` },

    { t: 'h', text: 'Why plain modulo is a trap, and what consistent hashing fixes' },
    { t: 'prose',
      md: `Suppose you shard with \`shard = hash(user_id) mod 4\` and you add a fifth shard. A key now maps to \`hash mod 5\`.
A key stays put only when \`h mod 4 == h mod 5\`, which happens for roughly 1 in 5 keys. **About 80% of your data
has to physically move**, and until the move completes every read is ambiguous. That is not a resharding operation,
that is a rewrite of the whole dataset under load.

Consistent hashing changes the question from "which of N buckets" to "which point on a ring". Hash each shard's
identifier to a position on a 2^32 ring; hash each key to a position too; the key belongs to the first shard found
walking clockwise. Adding a shard inserts one new point on the ring, which steals only the arc between itself and
its predecessor. The expected fraction of keys that move is \`1/(N+1)\` -- going from 4 shards to 5 moves about
**20%** of the data, and only from one neighbour.` },
    { t: 'prose',
      md: `The naive ring has a second problem: with only 4 random points on a ring, the arcs are wildly unequal. The standard
deviation of load is large enough that one shard routinely owns double its fair share. The fix is **virtual nodes**:
each physical shard claims many ring positions (typically 128-256, Cassandra's \`num_tokens\` defaults to 16 in
newer versions with better placement algorithms). With 256 vnodes per shard the arcs average out and load variance
drops to a few percent. Vnodes also make removal graceful -- a dead shard's 256 arcs are inherited by 256 different
neighbours rather than dumping its entire load on one machine.` },
    { t: 'code',
      lang: 'js',
      title: 'Consistent hash ring with virtual nodes -- the whole idea in 20 lines',
      code: `// Ring is a sorted array of { pos, shard }. Built once, rebuilt on topology change.
function buildRing(shards, vnodesPerShard = 256) {
  const ring = [];
  for (const shard of shards) {
    for (let i = 0; i < vnodesPerShard; i++) {
      ring.push({ pos: hash32(\`\${shard}#\${i}\`), shard });
    }
  }
  return ring.sort((a, b) => a.pos - b.pos);
}

// Walk clockwise to the first vnode at or after the key's position.
function locate(ring, key) {
  const h = hash32(key);
  let lo = 0, hi = ring.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ring[mid].pos < h) lo = mid + 1; else hi = mid;
  }
  return ring[ring[lo].pos >= h ? lo : 0].shard;   // wrap past the end
}

// Replication factor 3: keep walking, skipping vnodes of shards already chosen.
// This is exactly how Cassandra picks its replica set for a token.` },
    { t: 'note',
      tone: 'info',
      title: 'What production systems actually do',
      md: `Most mature systems do not hash directly onto shards. They hash onto a fixed, large number of **logical partitions**
-- Kafka does this with partitions, Elasticsearch with primary shards, Vitess with keyspace ID ranges, Citus with 32
shards per node by default. The partition count is chosen once and frozen (say 4096); rebalancing then means
*reassigning whole partitions* between machines, which is bookkeeping rather than rehashing. This is sometimes
called "fixed partitioning" or "hash-then-assign", and it is simpler to reason about than a live ring.` },

    { t: 'h', text: 'Shard key selection: the one irreversible decision' },
    { t: 'prose',
      md: `A shard key is good when it satisfies four properties at once, and they fight each other. It must have **high
cardinality** so the space divides finely. It must be **uniformly accessed** so no single value becomes a hot spot.
It must be **present in the vast majority of your queries**, because a query without the shard key becomes a
scatter-gather across every shard. And it must align with your **transaction boundary** -- rows that must be written
atomically together should land on the same shard.

For B2B SaaS, \`tenant_id\` (or \`org_id\`) satisfies all four almost perfectly: queries are naturally
tenant-scoped, transactions are tenant-scoped, and cardinality equals your customer count. For consumer social,
\`user_id\` works for the user's own data but fails for the timeline, which is why those systems end up with several
differently-sharded stores. For messaging, \`channel_id\` or \`conversation_id\` beats \`user_id\`, because the unit
of read is the conversation.` },
    { t: 'table',
      title: 'Shard key candidates, honestly assessed',
      cols: ['Key', 'Works because', 'Breaks when'],
      rows: [
        ['`tenant_id`', 'Queries and transactions are already tenant-scoped', 'One tenant is 100x the median -- you need per-tenant placement'],
        ['`user_id`', 'High cardinality, uniform, owns most personal data', 'Any feed, search or leaderboard that spans users'],
        ['`created_at`', 'Perfect for retention -- drop the old partition', 'All writes hit the newest partition; write hot spot by construction'],
        ['`hash(entity_id)`', 'Uniform by construction', 'No range scans at all; "last 100 orders" becomes scatter-gather'],
        ['Composite `(tenant_id, entity_id)`', 'Tenant locality plus intra-tenant spread', 'Only if you can afford splitting a large tenant across shards'],
        ['Auto-increment PK', 'Nothing', 'Immediately -- monotonic keys concentrate every write on one shard']
      ] },

    { t: 'h', text: 'Hot and celebrity partitions' },
    { t: 'prose',
      md: `Uniform key distribution does not give you uniform *traffic*. When a celebrity with 40 million followers posts, or
when one enterprise customer runs a bulk import, a single key receives orders of magnitude more requests than the
average. No hash function helps: the key is one key, and it lives on one shard. DynamoDB makes this visible as a
per-partition throughput ceiling (roughly 3,000 read units and 1,000 write units per physical partition); exceed it
on one key and you get throttled while the table as a whole sits idle.

There are four mitigations and they are not interchangeable.` },
    { t: 'grid',
      cols: 2,
      items: [
        { b: 'Key salting / write sharding', md: 'Append a bucket suffix: `post:9931#0` through `post:9931#15`. Writes spread across 16 keys on up to 16 shards. Reads must now fan out to all 16 and merge, so this trades write hot-spotting for read amplification. Use it for counters and append-heavy data.' },
        { b: 'Read-path caching', md: 'A celebrity row is read millions of times and written rarely, which is the ideal cache shape. Redis in front of the shard with request collapsing turns a hot partition into a hot cache key, which is a much easier problem to throw replicas at.' },
        { b: 'Dedicated shard placement', md: 'Only possible with a directory scheme. Move the whale tenant to its own cluster and record it in the shard map. This is how multi-tenant SaaS survives its largest customer, and it is the strongest argument for lookup-based sharding.' },
        { b: 'Adaptive splitting', md: 'DynamoDB and Bigtable split a hot partition automatically on access patterns, not just size. You get this for free from the managed store, but only when the heat is spread across a key *range*, not concentrated on one key.' }
      ] },

    { t: 'h', text: 'What you lose: cross-shard operations' },
    { t: 'prose',
      md: `The moment data spans shards you lose three things the database used to give you free.

**Joins.** A join between two tables sharded on different keys cannot execute in one engine. Your options are to
co-locate (shard both on the same key so the join is always local -- this is Citus's \`create_distributed_table ...
colocate_with\`), to replicate the small side to every shard as a *reference table*, or to join in the application
layer, which means N+1 round trips and no query planner.

**Transactions.** \`BEGIN; UPDATE shard_a; UPDATE shard_b; COMMIT;\` requires two-phase commit. 2PC gives you
atomicity but it is a blocking protocol: if the coordinator dies after PREPARE, participants hold locks until it
returns. Most teams choose sagas with compensating actions instead and accept intermediate states -- see the
event-driven architecture topic.

**Unique constraints and auto-increment.** A \`UNIQUE(email)\` index is only unique per shard. You need a separate
global uniqueness service, or you shard *by* email hash so all rows for one email are co-located. IDs come from
Snowflake-style generators (timestamp + machine + counter) or UUIDv7, which is time-ordered enough to keep index
locality without a central allocator.` },
    { t: 'h', text: 'Scatter-gather and tail latency amplification' },
    { t: 'prose',
      md: `A query without the shard key must ask every shard. This is the single most underappreciated cost of sharding,
because it does not degrade throughput -- it degrades the tail, disproportionately.

Suppose each shard answers in under 10 ms 99% of the time. A query that touches one shard has a p99 of 10 ms. A
query that fans out to 50 shards must wait for the slowest response, so it is fast only if *all 50* are fast:
\`0.99^50 = 0.605\`. **Forty percent of your scatter-gather queries now exceed 10 ms**, and the effective p99 of the
fan-out is near the p99.98 of an individual shard. Add more shards and it gets worse, not better.` },
    { t: 'numbers',
      title: 'Fan-out tail maths, per-shard p99 = 10 ms',
      items: [
        { v: '10 ms', k: 'p99 with 1 shard', note: 'Baseline' },
        { v: '~60%', k: 'Under 10 ms with 50 shards', note: '0.99^50 -- so p99 is far worse' },
        { v: '~37%', k: 'Under 10 ms with 100 shards', note: 'Fan-out width is the enemy' },
        { v: '2 of 3', k: 'Hedged request threshold', note: 'Send a duplicate after p95 elapses' }
      ] },
    { t: 'prose',
      md: `Mitigations: keep the fan-out narrow by including the shard key in hot queries; push a **secondary index into a
different store** shaped for that access pattern (Elasticsearch or a global DynamoDB GSI) so the query hits one
place; use **hedged requests** -- after p95 elapses, send a duplicate to a replica and take the first answer, which
costs a few percent extra load and collapses the tail; and enforce partial results with deadlines so one sick shard
degrades the result rather than hanging the request.` },

    { t: 'h', text: 'Secondary indexes: local vs global' },
    { t: 'table',
      cols: ['', 'Local index (per shard)', 'Global index (separately sharded)'],
      rows: [
        ['Structure', 'Each shard indexes only its own rows', 'Index is its own table sharded on the *index* key'],
        ['Write cost', 'Local, transactional, same commit', 'Cross-shard write -- async or 2PC'],
        ['Read cost', 'Scatter-gather across all shards', 'Single shard lookup, then fetch rows'],
        ['Consistency', 'Strong with the base row', 'Eventually consistent in practice'],
        ['Real name', 'DynamoDB LSI, Cassandra secondary index, Postgres per-partition index', 'DynamoDB GSI, Vitess lookup vindex, Elasticsearch'],
        ['Use when', 'Query always includes the shard key too', 'Query pattern is high-volume and shard-key-free (login by email)']
      ] },

    { t: 'h', text: 'Resharding a live system' },
    { t: 'prose',
      md: `You will get the shard count wrong, so the migration procedure matters more than the initial layout. The safe
pattern is the same one used for schema changes: never flip, always overlap.` },
    { t: 'steps',
      ordered: true,
      title: 'Splitting shard 3 into 3a and 3b with zero downtime',
      items: [
        'Provision the new shards and put the routing layer behind a **shard map** it reads at runtime, so topology changes do not require a deploy.',
        'Turn on **double-writes**: every write to shard 3 is also applied to 3a/3b according to the new mapping. Make these writes idempotent -- use the row version or an upsert -- because you will replay them.',
        'Run a **backfill** that copies historical rows in primary-key order, in bounded batches, throttled to a fixed fraction of shard capacity. Record a high-water mark so it is resumable.',
        'Run a **continuous verifier** comparing checksums of row ranges between old and new. Do not proceed while the diff is non-zero for anything other than in-flight rows.',
        'Shift **reads** first, gradually: 1% of traffic, then 10%, then 50%, comparing results against the old shard in shadow mode. Reads are reversible; writes are not.',
        'Flip the shard map so writes go only to 3a/3b. Keep double-writing *back* to shard 3 for a cooling-off period so rollback stays available.',
        'Stop the backwards write, then leave shard 3 read-only and untouched for at least one backup cycle before decommissioning.'
      ] },
    { t: 'note',
      tone: 'good',
      md: `Vitess automates most of this as \`MoveTables\`/\`Reshard\` with \`VDiff\` for verification, and it is worth knowing
by name even if you never use it: it tells an interviewer you know the shape of the problem well enough to recognise
a tool that solves it.` },

    { t: 'h', text: 'Trade-offs' },
    { t: 'tradeoffs',
      gains: [
        'Write throughput and storage scale roughly linearly with shard count.',
        'The working set per machine shrinks, so hot indexes fit in RAM again and p99 improves.',
        'Blast radius shrinks -- one shard failing degrades a fraction of users instead of all of them.',
        'Per-shard maintenance: migrations, `VACUUM` and failovers happen on a slice at a time.',
        'Placement becomes a lever: data residency and whale-tenant isolation become configuration.'
      ],
      costs: [
        'The shard key is effectively irreversible, and you choose it with the least information you will ever have.',
        'Cross-shard joins, unique constraints and transactions leave the database and become your code.',
        'Any shard-key-free query becomes scatter-gather with amplified tail latency.',
        'Operational surface multiplies: N backup chains, N replication topologies, N failovers, N connection pools.',
        'A rebalance is a multi-week project with double-writes, backfill and verification.',
        'Local development and test fixtures get significantly more complicated.'
      ] },
    { t: 'failures',
      items: [
        { mode: 'Monotonic shard key (timestamp or auto-increment ID)', blast: '100% of writes land on the newest shard; the rest of the fleet idles while one machine saturates.', fix: 'Hash the key, or prefix with a high-cardinality bucket. Reserve range-on-time for read-mostly archival tables.' },
        { mode: 'Celebrity key exceeds one partition ceiling', blast: 'Throttling and timeouts on one key while the table shows 5% utilisation.', fix: 'Cache with request collapsing, salt writes into N sub-keys, or pin the key to a dedicated shard.' },
        { mode: 'Uneven tenant sizes on hash sharding', blast: 'One shard at 90% disk and CPU, others at 15%; you cannot fix it without moving the tenant.', fix: 'Switch to a directory/lookup map so placement is explicit and a whale can be relocated by changing one row.' },
        { mode: 'Stale shard map cached in an app instance', blast: 'Writes land on the old shard after a reshard; rows silently disappear from reads.', fix: 'Version the map, fence writes with the version, and reject writes carrying a stale version rather than accepting them.' },
        { mode: 'Cross-shard transaction abandoned mid-flight', blast: 'Money debited on shard A, never credited on shard B; no error anywhere.', fix: 'Saga with an explicit compensating action, an outbox for durability, and a reconciliation job that alerts on non-zero drift.' },
        { mode: 'Fan-out query added to a hot path', blast: 'p99 collapses as shard count grows -- the system gets *slower* when you scale out.', fix: 'Budget fan-out width per endpoint, add a global index or search store, use hedged requests and deadline-bounded partial results.' },
        { mode: 'Backfill unthrottled', blast: 'Copy job saturates shard IO and takes production latency with it during the migration.', fix: 'Bounded batches keyed on the PK, explicit rate limit tied to a replication-lag or latency signal, and a kill switch.' }
      ] },

    { t: 'staff',
      md: `Most candidates answer "how would you scale this database?" with "shard it". The Staff signal is in the sequencing,
the irreversibility, and the migration plan. Sentences that land:

- "Before I shard I want to know the write rate on the leader and whether the hot index still
  fits in RAM. If it is a read problem, replicas and a cache are two orders of magnitude
  cheaper than sharding, and if it is a single hot table I would functionally partition that
  table out first."
- "The shard key is the most expensive decision on this page, because it is the one I cannot
  undo. I would pick \`tenant_id\` here: queries are already tenant-scoped, so are transactions,
  and it lets me physically isolate the largest customer later without an application change."
- "I would hash into 4096 fixed logical partitions and assign partitions to machines, rather
  than hashing onto machines. Then growing the fleet is reassigning partitions, not rehashing
  data. Plain \`mod N\` would move about 80% of rows when I go from 4 shards to 5."
- "Fan-out queries are the thing that surprises people. If a shard is 10 ms at p99, a 50-shard
  scatter-gather is fast only when all 50 are fast -- that is 0.99 to the 50th, about 60%. So
  I budget fan-out width per endpoint and push shard-key-free lookups into a global index."
- "Resharding is double-write, backfill, verify with checksums, shift reads at 1% then 10%,
  then flip writes -- and I keep writing back to the old shard for a week so rollback is still
  real."
- "The honest answer is that this dataset is 400 GB with 3,000 writes a second. I would not
  shard it. I would put that on my own roadmap as the thing to revisit at 5 TB, and I would
  make sure every table already carries \`tenant_id\` so the future migration is mechanical."

That last one is the strongest answer in the set. Declining to shard, with the specific threshold and the cheap
preparatory step, is what separates someone who has done this from someone who has read about it.` },

    { t: 'quiz',
      items: [
        {
          q: 'You shard with `hash(user_id) mod 4` and need to add a fifth shard. Roughly how much data must move?',
          options: ['About 20% -- one shard\'s worth', 'About 80%', 'None -- hashing is stable', 'About 50%'],
          answer: 1,
          why: 'A key stays put only when `h mod 4 == h mod 5`, which is roughly 1 key in 5, so about 80% relocates. This is precisely the problem consistent hashing solves: adding one node to a ring of N moves only `1/(N+1)` of keys, about 20% here, and only from adjacent arcs. Better still, hash into a fixed large partition count and move whole partitions.' },
        {
          q: 'Each shard answers in under 10 ms 99% of the time. A dashboard query fans out to 50 shards. What is the practical effect?',
          options: ['p99 stays 10 ms because the calls are parallel.', 'Only ~60% of these queries finish within 10 ms, so the tail degrades sharply.', 'Throughput drops but latency is unaffected.', 'The coordinator caches results so it is faster after warm-up.'],
          answer: 1,
          why: 'The fan-out is only as fast as its slowest leg, so you need all 50 to be fast: 0.99^50 = 0.605. Parallelism bounds the *sum* of work, not the *maximum* latency. The effective p99 of the fan-out sits around the p99.98 of a single shard. Fix it with narrower fan-out, a global secondary index, hedged requests, or deadline-bounded partial results.' },
        {
          q: 'A B2B analytics product has 4,000 tenants; the largest is 35% of total load. Which sharding scheme fits best?',
          options: ['Range sharding on `created_at`', 'Hash sharding on `tenant_id`', 'A directory/lookup map keyed by `tenant_id`', 'No shard key -- replicate everything everywhere'],
          answer: 2,
          why: 'Hash on `tenant_id` gives good average distribution but no control: the 35% tenant lands wherever the hash puts it and will permanently overload that shard with no remedy short of resharding. A lookup table is a tiny, cacheable indirection that lets you pin that tenant to dedicated hardware by updating one row. Explicit placement is the whole reason multi-tenant SaaS prefers directory sharding.' },
        {
          q: 'Users log in by email, but the table is sharded on `user_id`. What is the right fix?',
          options: ['Scatter-gather the login query across all shards.', 'Add a local secondary index on `email` to every shard.', 'Maintain a global `email -> user_id` lookup index, sharded on `email`.', 'Reshard the whole table on `email`.'],
          answer: 2,
          why: 'Login is high-volume and never carries the shard key, so scatter-gather puts your most critical path on the widest fan-out you have. A local index does not help -- you still must ask every shard which one holds the email. A global lookup index (Vitess calls this a lookup vindex, DynamoDB a GSI) turns it into two single-shard reads. Resharding on `email` would just break every other query.'
        }
      ] },

    { t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{ t: 'prose',
        md: `Sharding multiplies the number of independent replication topologies you operate, so read **Replication &
Consistency Models** next. The shard map itself is coordination state and usually lives in etcd, which is
**Consensus, Leases & Distributed Locks**. Cross-shard writes without 2PC are the subject of **Event-Driven
Architecture, Sagas & CQRS**. Deciding whether you need to shard at all is capacity work -- see **Scalability &
Capacity Planning** -- and the hot-key mitigations depend heavily on **Server-Side Caching & Redis Patterns**.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why does adding one shard to a `mod N` scheme move most of the data?', a: 'A key only stays put when `h mod N == h mod (N+1)`, true for roughly 1 in N+1 keys. Going 4 to 5 shards relocates ~80% of rows. Consistent hashing moves only `1/(N+1)`, about 20%, and only from neighbouring arcs.' },
    { q: 'What problem do virtual nodes solve?', a: 'With one ring position per shard, random arcs are very uneven and one shard can own double its share. Giving each shard 128-256 positions averages the arcs out, and on failure the dead shard\'s load spreads across many neighbours instead of one.' },
    { q: 'What are the four properties of a good shard key?', a: 'High cardinality, uniform access (no hot values), present in most queries, and aligned with your transaction boundary so atomic writes stay on one shard.' },
    { q: 'Why is a fan-out query worse at p99 than a single-shard query?', a: 'It completes only when the slowest shard responds. With per-shard p99 of 10 ms and 50 shards, the chance all are fast is 0.99^50 = ~60%, so the fan-out p99 approaches a single shard\'s p99.98. Widening the fleet makes it worse.' },
    { q: 'Local vs global secondary index?', a: 'A local index covers only the rows on its own shard, so a lookup without the shard key must scatter-gather. A global index is its own table sharded on the index key -- one lookup, but the write is cross-shard and therefore eventually consistent.' },
    { q: 'How do you handle a celebrity key that exceeds one partition\'s throughput?', a: 'Cache reads with request collapsing; salt writes across N sub-keys and merge on read; or, with a directory scheme, pin the key to a dedicated shard. Hashing does not help -- one key is one key.' },
    { q: 'Safe order of operations for a live reshard?', a: 'Runtime shard map, then idempotent double-writes, throttled resumable backfill, checksum verification, gradual read shift (1% -> 10% -> 50%), then flip writes while still writing back to the old shard so rollback remains possible.' },
    { q: 'What should you try before sharding?', a: 'Missing indexes, moving analytics to a replica or warehouse, functionally partitioning the largest append-only table into its own store, archiving cold rows, caching with collapsing, and a bigger instance. Sharding is a 2-4x engineering cost multiplier.' }
  ],

  drills: [
    {
      prompt: 'A B2B workflow product on a single Postgres primary has 8 TB of data, 18,000 writes per second at peak, and 6,000 tenants. The largest tenant is 30% of write volume; the median tenant is under 1 GB. p99 on the hot `tasks` table has gone from 12 ms to 140 ms over six months. Design the path forward.',
      probes: [
        'What evidence would convince you this is a write-throughput problem rather than an index or working-set problem?',
        'What is your shard key, and which existing queries stop working the day you adopt it?',
        'Where does the 30% tenant go, and what happens when it doubles?',
        'Walk me through the cutover for one tenant, including how you would roll back at 2 a.m.',
        'How do you keep cross-tenant admin reporting working afterwards?'
      ],
      strong: [
        'Separates the diagnosis from the fix: checks buffer cache hit ratio and index size vs RAM, and whether p99 regressed because the working set stopped fitting rather than because of write volume.',
        'Proposes functional partitioning of the highest-volume append-only table first, and states the specific signal that would make that insufficient.',
        'Chooses `tenant_id` with a directory/lookup map rather than a hash, and justifies it explicitly by the need to place the 30% tenant on dedicated hardware.',
        'Names the queries that break: cross-tenant admin reports, `UNIQUE(email)` across tenants, any global aggregate -- and routes them to a warehouse or a read-only replica rather than scatter-gathering.',
        'Cutover plan includes idempotent double-writes, a throttled resumable backfill, checksum verification, gradual read shift, and continued reverse writes for a rollback window.',
        'Mentions that every table must already carry `tenant_id` and that adding it is a cheap prerequisite done before any sharding work.'
      ],
      weak: [
        'Jumps straight to "shard on hash of tenant_id" without noticing the 30% tenant makes hashing unmanageable.',
        'Picks `created_at` or the auto-increment primary key and does not recognise the write hot spot.',
        'No migration plan, or a plan that involves a maintenance window and a single flip.',
        'Assumes cross-shard joins and unique constraints keep working.',
        'Never asks whether a bigger instance, a missing index or a warehouse would solve it for a fraction of the cost.'
      ] },
    {
      prompt: 'Your DynamoDB table is partitioned on `post_id`. A post from a large account is being read 80,000 times per second and receiving 4,000 likes per second. The table shows 6% provisioned-capacity utilisation, yet these requests are being throttled. Explain and fix.',
      probes: [
        'Why does aggregate utilisation look fine while these calls fail?',
        'Which of the read path and the write path needs a different fix, and why?',
        'What does salting cost you on the read side?',
        'How would you detect the next celebrity key before users do?'
      ],
      strong: [
        'Identifies the per-partition throughput ceiling (~3,000 RCU / 1,000 WCU) and that a single key cannot be spread by hashing.',
        'Splits the diagnosis: reads are cacheable with collapsing (DAX or Redis), writes are not, so likes need salting into N sub-keys with a periodic rollup.',
        'States the read amplification cost of salting explicitly -- a count read now fans out to all N buckets -- and proposes a materialised total updated asynchronously.',
        'Proposes detection: per-key request-rate metrics with a top-K sketch, alerting on key skew rather than only on aggregate utilisation.'
      ],
      weak: [
        'Suggests raising provisioned capacity, which does not lift a per-partition ceiling.',
        'Proposes a different hash function or more partitions, without noticing the heat is on one key.',
        'Caches the like counter with a write-through pattern and does not mention lost updates or the need for atomic increments.',
        'No detection story -- treats it as a one-off rather than a recurring class of incident.'
      ]
    }
  ]
};
