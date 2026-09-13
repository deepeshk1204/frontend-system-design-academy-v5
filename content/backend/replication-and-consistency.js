export default {
  blocks: [
    { t: 'prose',
      md: `Replication is keeping more than one copy of your data on more than one machine. You do it for three different
reasons that people constantly conflate: to survive a machine dying (durability), to serve more reads than one
machine can (throughput), and to put data near users (latency).

The moment a second copy exists, a new question exists with it: **if I write to one copy and read from another, what
am I allowed to see?** Consistency models are the vocabulary for answering that precisely, instead of with the word
"eventually".` },

    { t: 'h', text: 'Why it exists' },
    { t: 'prose',
      md: `Disks fail, kernels panic, availability zones lose power, and someone eventually runs \`DROP TABLE\` on the wrong
host. A single copy of your data means your durability is exactly the durability of one machine, and your
availability is exactly its uptime. Nobody accepts that, so every serious system has replicas.

But replication is not free, and it is not transparent. A follower in another region is at least one network round
trip behind -- roughly 70 ms between Virginia and Ireland, 200 ms between Virginia and Singapore. You now have a
choice nobody wants to make: wait for the remote copy on every write and pay that latency, or do not wait and accept
that the remote copy is sometimes behind. Every consistency model in this topic is a different answer to that one
question, and there is no answer that avoids it.` },

    { t: 'h', text: 'The three topologies' },
    { t: 'diagram',
      code: `flowchart TB
  subgraph SL["Single leader"]
    L["Leader<br/>all writes"] --> F1["Follower"]
    L --> F2["Follower"]
  end
  subgraph ML["Multi leader"]
    LA["Leader US"] <--> LB["Leader EU"]
  end
  subgraph LL["Leaderless"]
    C["Coordinator"] --> N1["Node 1"]
    C --> N2["Node 2"]
    C --> N3["Node 3"]
  end`,
      caption: 'Single-leader avoids write conflicts by construction. The other two accept conflicts in exchange for write availability or locality.' },
    { t: 'table',
      cols: ['Topology', 'How writes work', 'Conflict handling', 'Real systems', 'Choose when'],
      rows: [
        ['**Single leader**', 'One node accepts all writes; followers stream the log', 'None possible -- the leader serialises everything', 'Postgres streaming replication, MySQL binlog, MongoDB replica sets, Kafka per partition', 'Almost always. This is the default and the correct default.'],
        ['**Multi leader**', 'Several nodes accept writes and replicate to each other', 'Unavoidable. Needs LWW, CRDTs or application merge logic', 'MySQL circular replication, CouchDB, BDR for Postgres, Cosmos DB multi-region write', 'Multi-region write locality, or offline-capable clients. Rare and expensive.'],
        ['**Leaderless / quorum**', 'Client or coordinator writes to W nodes directly', 'Version vectors, LWW with timestamps, read repair', 'Cassandra, DynamoDB, Riak, ScyllaDB', 'High write availability and tunable consistency matter more than transactions.']
      ] },
    { t: 'note',
      tone: 'warn',
      title: 'Multi-leader is the trap answer',
      md: `"Two regions, both writable" sounds like the obvious way to get low write latency everywhere. What you have actually
bought is a permanent conflict-resolution problem, and last-write-wins on wall-clock timestamps means *silent data
loss* whenever two regions touch the same row within the clock-skew window. Most teams who reach for multi-leader
would be better served by a single leader plus regional read replicas, or by partitioning ownership so each row has
exactly one home region.` },

    { t: 'h', text: 'Synchronous, asynchronous, and the semi-sync compromise' },
    { t: 'prose',
      md: `The knob that matters most is when the leader tells the client "committed".

**Asynchronous**: the leader writes locally, fsyncs its WAL, and acknowledges. Replication happens in the
background. Write latency is local-disk latency. If the leader dies before its log reaches a follower, those
acknowledged writes are gone -- this is the *data loss window*, and it is exactly the current replication lag.

**Synchronous**: the leader waits for at least one follower to confirm the log record is durable before
acknowledging. No acknowledged write is ever lost to a single machine failure. But your write latency now includes a
network round trip, and -- worse -- if the synchronous follower is slow or down, writes *block*. One sick replica
takes down your write path.

**Semi-synchronous** is the standard production compromise: require acknowledgement from *any one* of several
candidate followers, so a single slow replica does not stall writes. Postgres expresses this as
\`synchronous_standby_names = 'ANY 1 (s1, s2, s3)'\`; MySQL as \`rpl_semi_sync_master_wait_for_slave_count\`.` },
    { t: 'code',
      lang: 'ini',
      title: 'Postgres: the settings that decide your durability story',
      code: `# Asynchronous -- fastest writes, loses up to <lag> on leader loss
synchronous_commit = on          # fsync local WAL, do not wait for standby
synchronous_standby_names = ''

# Semi-synchronous -- any one of three standbys must have it durably
synchronous_commit = on
synchronous_standby_names = 'ANY 1 (standby_a, standby_b, standby_c)'

# Strictest -- standby must have applied it, so replica reads are current.
# Adds a round trip AND standby replay time to every commit.
synchronous_commit = remote_apply
synchronous_standby_names = 'FIRST 1 (standby_a)'

# The dangerous one. Commits are acknowledged before the local WAL is flushed,
# trading up to wal_writer_delay of data for throughput. Only for data you
# are genuinely willing to lose.
synchronous_commit = off` },
    { t: 'numbers',
      title: 'What each choice costs on a write',
      items: [
        { v: '~0.5-2 ms', k: 'Async commit', note: 'Local NVMe fsync only' },
        { v: '~2-4 ms', k: 'Sync to same-AZ standby', note: 'Sub-millisecond network hop' },
        { v: '~3-6 ms', k: 'Sync to cross-AZ standby', note: 'The standard production default' },
        { v: '~70-140 ms', k: 'Sync to cross-region standby', note: 'Usually unacceptable for OLTP' }
      ] },

    { t: 'h', text: 'Replication lag, and what users actually see' },
    { t: 'prose',
      md: `Lag is usually milliseconds and occasionally minutes. It blows out during bulk imports, long-running vacuum or index
builds, large transactions replayed serially on the follower, and network saturation. Because it is normally
invisible, teams build read-from-replica paths that work in staging and produce baffling bug reports in production.

The symptoms have names, and naming them is a strong interview signal.` },
    { t: 'grid',
      cols: 3,
      items: [
        { b: 'Read-your-writes violated', md: 'The user edits their profile, the app redirects to the profile page, the read hits a lagging replica, and the old name comes back. The user concludes the save failed and saves again.' },
        { b: 'Monotonic reads violated', md: 'Two successive reads hit different replicas with different lag, so the user sees a comment appear and then vanish. Time appears to run backwards.' },
        { b: 'Consistent prefix violated', md: 'A reply is replicated before the message it replies to, because they travelled through different partitions. The conversation reads as an answer to nothing.' }
      ] },
    { t: 'prose',
      md: `These three are **client-centric guarantees**: they are promises about what *one session* observes, not about global
ordering. That distinction matters because they are much cheaper to provide than linearisability, and they are what
users actually notice.

Implementing them is concrete work, not a configuration flag:

**Read-your-writes** -- simplest version is sticky routing: for N seconds after a write, route that session's reads
to the leader. Crude but effective, and the cost is bounded leader load. The better version is **token-based**: the
write returns the leader's log position (Postgres \`pg_current_wal_lsn()\`, MySQL GTID, MongoDB \`operationTime\`),
the client carries it, and a replica either waits until it has replayed that position or forwards the read to the
leader. MongoDB exposes exactly this as causal consistency with \`afterClusterTime\`.

**Monotonic reads** -- pin a session to one replica, usually by hashing the session ID to a replica rather than
round-robining. A session never goes backwards because it never changes its view of the log. Failover to a different
replica breaks it, so re-pin forward-only.

**Consistent prefix** -- ensure causally related writes share a partition, or use a store that tracks causality with
version vectors. This is the one people forget, and it is why "shard by \`conversation_id\`" beats "shard by
\`message_id\`".` },

    { t: 'h', text: 'Quorums: R + W > N' },
    { t: 'prose',
      md: `In a leaderless system you choose how many replicas must respond. With N replicas, a write that reaches W nodes and
a read that consults R nodes are guaranteed to overlap on at least one node whenever \`R + W > N\`. That overlapping
node has the latest value, so the read can see it -- given a way to tell which version is newest.

Worked example with N = 3. Set W = 2 and R = 2: \`2 + 2 = 4 > 3\`, so reads see the latest write and you tolerate
one node down on either path. Set W = 3, R = 1 and reads become fast and cheap but any single node being down blocks
all writes -- good for read-heavy immutable data. Set W = 1, R = 1 and you get the lowest latency and no overlap
guarantee at all; this is \`ONE/ONE\` in Cassandra and it is eventual consistency in the plain sense.` },
    { t: 'table',
      title: 'Quorum configurations with N = 3',
      cols: ['W', 'R', 'R+W>N?', 'Write availability', 'Read latency', 'Use for'],
      rows: [
        ['3', '1', 'Yes (4>3)', 'Fragile -- one node down blocks writes', 'Lowest', 'Read-mostly reference data'],
        ['2', '2', 'Yes (4>3)', 'Tolerates 1 failure', 'Medium', 'The sensible default for important data'],
        ['1', '3', 'Yes (4>3)', 'Highest', 'Highest', 'Write-heavy ingestion with rare reads'],
        ['1', '1', 'No (2<3)', 'Highest', 'Lowest', 'Metrics, logs, anything where a stale read is harmless'],
        ['2', '2 with `LOCAL_QUORUM`', 'Per-DC only', 'Survives a whole DC loss', 'No cross-region hop', 'Multi-region Cassandra -- and note it gives up global quorum']
      ] },
    { t: 'note',
      tone: 'danger',
      title: 'Quorum is not linearisability',
      md: `\`R + W > N\` guarantees *overlap*, not *ordering*. Concurrent writes to the same key can still produce divergent
versions that a read must reconcile, and an interrupted write that reached only one of two required nodes leaves
that value visible to some reads and not others with no rollback. Cassandra needs lightweight transactions (Paxos
per key, roughly 4x the latency) for genuine compare-and-set. Dynamo-style quorums give you good availability and a
useful staleness bound -- they do not give you a register you can safely increment.` },

    { t: 'h', text: 'CAP, stated precisely' },
    { t: 'prose',
      md: `The popular version of CAP -- "pick two of consistency, availability, partition tolerance" -- is wrong in a way that
matters, because it implies partition tolerance is optional. It is not. Networks partition whether or not your
design acknowledges it.

The precise statement is narrower: **when a network partition occurs, a system must choose between remaining
available and remaining linearisable.** Consistency here means specifically *linearisability* -- every operation
appears to take effect at a single instant, and reads always return the most recent completed write. Availability
means *every* non-failing node answers *every* request. Both definitions are stricter than the everyday words.

So CAP describes behaviour during a partition, which is a rare event, and says nothing about the 99.9% of the time
when the network is fine. That is why it is a poor design tool.` },
    { t: 'prose',
      md: `**PACELC** is the more useful framing. It reads: *if there is a Partition, choose between Availability and
Consistency; Else, choose between Latency and Consistency.* The second clause is the one that governs your daily
life. Every synchronous replication decision, every "can I read from the replica" decision, is an else-branch
latency-versus-consistency trade, and no partition is required for it to bite you.` },
    { t: 'table',
      title: 'PACELC classification of systems you will actually use',
      cols: ['System', 'On partition', 'Otherwise', 'Reading'],
      rows: [
        ['DynamoDB, Cassandra (default)', 'Availability', 'Latency', 'PA/EL -- fast and available, stale reads possible'],
        ['Spanner, CockroachDB', 'Consistency', 'Consistency', 'PC/EC -- pays commit latency for strict guarantees'],
        ['MongoDB (majority write, primary read)', 'Consistency', 'Consistency', 'PC/EC -- primary-only reads, majority acks'],
        ['Postgres with async replicas', 'Consistency at the leader', 'Latency at the replicas', 'PC/EL -- depends entirely on which node you read'],
        ['Riak, Cassandra with `ONE`', 'Availability', 'Latency', 'PA/EL taken to its conclusion']
      ] },

    { t: 'h', text: 'Failover, split-brain and fencing' },
    { t: 'prose',
      md: `Leader failure is where the theory becomes an incident. Trace it properly.` },
    { t: 'diagram',
      code: `sequenceDiagram
  participant A as App
  participant L as Leader (old)
  participant F as Follower
  participant O as Orchestrator
  A->>L: write X=5, ack (async)
  Note over L: WAL position 1200<br/>not yet shipped
  L--xF: network stalls
  O->>O: health checks fail 3 times
  O->>F: promote (has WAL to 1100)
  Note over F: X=5 never arrived.<br/>Lost write window = 100 bytes of WAL
  A->>F: read X, gets old value
  L->>A: old leader returns, still believes it is leader
  Note over O: Split brain unless old leader<br/>is fenced by epoch number`,
      caption: 'Two independent hazards: acknowledged writes lost on async promotion, and two nodes both accepting writes.' },
    { t: 'prose',
      md: `The lost-write window equals the replication lag at the instant of failure. If your follower was 400 ms behind at
5,000 writes per second, promotion silently discards roughly 2,000 acknowledged writes. There is no recovery --
those clients were told "committed". The only mitigation is semi-synchronous replication, which converts the
data-loss risk into a write-availability risk. That is the trade and you should state it as a trade, not a fix.

**Split-brain** is the second hazard. A partitioned old leader may still be accepting writes from clients that can
reach it. Two mechanisms prevent damage. **Quorum-based promotion**: a node may only become leader with a majority
vote, so a minority-side node cannot self-promote. And **fencing**: every leadership term carries a monotonically
increasing epoch, storage and downstream services record the highest epoch they have seen, and anything arriving
with a lower epoch is rejected. Postgres uses timelines in WAL history; Kafka uses the leader epoch; STONITH in
classic HA literally power-cycles the old node.

The key insight is that fencing must be enforced by the *resource*, not by the coordinator. If the storage layer
does not check the epoch, a paused old leader waking from a 30-second GC pause will happily write stale data over
new data.` },

    { t: 'h', text: 'Trade-offs' },
    { t: 'tradeoffs',
      gains: [
        'Survives machine, rack and AZ failure without data loss when replication is synchronous.',
        'Read throughput scales with replica count for read-heavy workloads.',
        'Regional read replicas cut read latency from ~150 ms to ~10 ms for distant users.',
        'Replicas absorb analytics, backups and index builds without touching the write path.',
        'Failover turns a multi-hour restore into a sub-minute promotion.'
      ],
      costs: [
        'Synchronous replication puts a network round trip on every commit and couples write availability to replica health.',
        'Asynchronous replication has an unbounded data-loss window equal to current lag.',
        'Any read-from-replica path introduces the three client-centric anomalies and the bugs they cause.',
        'Failover is itself a source of outages -- flapping, split-brain, and false positives from health checks.',
        'Multi-leader adds permanent conflict resolution that application code must own.',
        'Cost: 3x storage and write amplification across replicas.'
      ] },
    { t: 'failures',
      items: [
        { mode: 'Async promotion discards acknowledged writes', blast: 'Orders confirmed to customers vanish; support has receipts your database does not.', fix: 'Semi-sync with `ANY 1 (a,b,c)`; alert on lag in bytes not seconds; refuse automatic promotion beyond a configured lag threshold.' },
        { mode: 'Split-brain -- two leaders accept writes', blast: 'Divergent histories requiring manual reconciliation; unique constraints violated on merge.', fix: 'Majority-quorum promotion plus epoch fencing enforced at the storage layer, not at the coordinator.' },
        { mode: 'Read-after-write on a lagging replica', blast: 'Users see saves fail and re-submit, creating duplicates; "the app lost my edit" tickets.', fix: 'LSN/GTID token carried by the client with replica wait-or-forward, or leader-sticky reads for N seconds after any write.' },
        { mode: 'Replica lag spike from a long transaction or index build', blast: 'All replica-backed reads go minutes stale simultaneously; stale-read bugs appear across the product at once.', fix: 'Cap `max_standby_streaming_delay`, run migrations with `CONCURRENTLY`, and take replicas out of rotation automatically above a lag threshold.' },
        { mode: 'Failover flapping on transient network blips', blast: 'Repeated promotions, each with its own lost-write window and connection storm.', fix: 'Require 3 consecutive failed checks from multiple observers, add a cooldown, and never promote without quorum agreement.' },
        { mode: 'Multi-leader last-write-wins on skewed clocks', blast: 'Silent overwrite -- the newer edit loses because that node\'s clock was 200 ms behind.', fix: 'Version vectors or CRDTs, or partition write ownership so each row has exactly one home region.' },
        { mode: 'Connection pools still pointed at the old primary DNS', blast: 'Write errors continue for minutes after a successful failover.', fix: 'Route through a proxy (PgBouncer, ProxySQL, RDS Proxy) or a virtual IP, with a short TTL and aggressive pool invalidation.' }
      ] },

    { t: 'staff',
      md: `The gap between a senior and a Staff answer here is almost entirely precision. Senior candidates say "eventually
consistent" and "CAP theorem". Staff candidates say things like:

- "When you say the replica is eventually consistent, what is the lag at p99, in bytes of WAL?
  I care about bytes rather than seconds because that number *is* my data-loss window on
  failover, and it is the number I would alert on."
- "I would run semi-synchronous with \`ANY 1 (a, b, c)\`. That means no acknowledged write is
  lost to a single node failure, and a single slow replica cannot stall my write path. I am
  paying about 2 ms of cross-AZ round trip per commit for that, which is a trade I would make
  for payments and would not make for view counters."
- "The user-visible bug is read-your-writes, and I would fix it with the write's LSN rather
  than sticky sessions. The write returns \`pg_current_wal_lsn()\`, the client sends it back,
  and the replica either waits until it has replayed past it or forwards to the leader. Sticky
  routing works but it silently concentrates load on the primary."
- "CAP only tells you what happens during a partition, which is rare. PACELC is the useful
  version, because the else-branch -- latency versus consistency with a healthy network -- is
  the trade I am making every day when I decide whether this read can go to a replica."
- "\`R + W > N\` guarantees the read set overlaps the write set. It does not give me
  linearisability, so I cannot implement a decrement-the-inventory operation on it. For that I
  need a lightweight transaction, which is Paxos per key and roughly four times the latency."
- "Any lock or leadership without a monotonically increasing fencing token is unsafe, because a
  30-second GC pause is indistinguishable from a dead node. The storage layer has to reject the
  stale epoch -- the coordinator cannot enforce it for you."

The pattern to copy: turn every consistency word into an observable number, and name which component enforces the
guarantee. Saying "the replica enforces the LSN wait" is worth more than three paragraphs about CAP.` },

    { t: 'quiz',
      items: [
        {
          q: 'A user updates their display name, is redirected, and sees the old name. Replication lag is 300 ms. Cheapest correct fix?',
          options: ['Switch all replication to synchronous.', 'Route this session\'s reads to the leader for a few seconds, or carry the write\'s LSN and have the replica wait for it.', 'Add a 500 ms delay after the write before redirecting.', 'Increase the replica count.'],
          answer: 1,
          why: 'This is a read-your-writes violation, which is a *client-centric* guarantee -- you only need this one session to see its own write, not the whole system to be linearisable. Sticky-to-leader is the crude version; carrying the log position (LSN, GTID, `afterClusterTime`) and having the replica wait or forward is the precise one. Making all replication synchronous solves a session-scoped problem with a global latency tax, and more replicas makes staleness more likely, not less.' },
        {
          q: 'Cassandra with N=3, W=2, R=2. Can you safely implement "decrement inventory if greater than zero"?',
          options: ['Yes -- R+W>N guarantees you read the latest value.', 'No -- quorum overlap gives recency, not atomicity, so two concurrent decrements can both read 1 and both succeed.', 'Yes, if you use `LOCAL_QUORUM`.', 'Only with a read repair configured.'],
          answer: 1,
          why: 'Quorum overlap means your read set intersects the write set, so you can *see* the latest committed value. It says nothing about serialising two concurrent read-modify-write cycles: both can read 1, both write 0, and one decrement disappears. You need a compare-and-set, which in Cassandra means a lightweight transaction (Paxos per partition, roughly 4x latency) or moving the counter to a store with real transactions.' },
        {
          q: 'Your leader dies. The chosen follower was 800 ms behind at 4,000 writes/sec. What happened?',
          options: ['Nothing -- replication catches up after promotion.', 'Roughly 3,200 acknowledged writes were permanently lost.', 'The writes are recoverable from the old leader once it returns.', 'Clients get errors for those writes and will retry.'],
          answer: 1,
          why: 'Async replication acknowledges before shipping the log, so everything in the lag window was confirmed to clients but never left the leader. Promotion discards it. The old leader\'s WAL may physically contain those records, but merging a diverged timeline back into a promoted leader is a manual forensic exercise, not a recovery procedure -- and clients never got an error, so they will not retry. Semi-sync converts this data-loss risk into a write-availability risk.' },
        {
          q: 'Which statement about CAP is accurate?',
          options: ['You choose two of the three properties at design time.', 'During a network partition, you must choose between availability and linearisability; partition tolerance is not optional.', 'CAP proves eventual consistency is the only scalable option.', 'A single-node database is CP.'],
          answer: 1,
          why: 'CAP is a statement about behaviour *during* a partition, with linearisability and total availability as its strict definitions. Partitions happen regardless of your design, so "choosing CA" is not a choice, it is a system that misbehaves when the network does. This is why PACELC is more useful: it adds the else-branch, where you trade latency against consistency on a perfectly healthy network -- which is the decision you actually make every day.'
        }
      ] },

    { t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{ t: 'prose',
        md: `Every shard from **Sharding & Partitioning** has its own replication topology, so these two compound. Quorum-based
leader election and fencing tokens are covered properly in **Consensus, Leases & Distributed Locks**. Kafka's ISR
and \`acks=all\` are the same quorum ideas applied to a log -- see **Queues & Event Streaming**. Isolation levels
within a single node are a different axis entirely and live in **Transactions & Isolation Levels**. Alerting on lag
in bytes belongs to **Observability, SLOs & Error Budgets**.`
      }]
    }
  ],

  flashcards: [
    { q: 'What exactly is the data-loss window on asynchronous failover?', a: 'The current replication lag at the instant the leader dies, measured in log bytes. Every write acknowledged but not yet shipped is permanently gone, and the client was told it committed. Alert on lag in bytes, not seconds.' },
    { q: 'Why prefer semi-synchronous over fully synchronous replication?', a: 'Fully sync couples write availability to one specific replica -- if it is slow, writes block. Semi-sync (`ANY 1 (a,b,c)`) requires any one of several, so a single sick replica cannot stall the write path while still guaranteeing no single-node data loss.' },
    { q: 'State CAP precisely.', a: 'During a network partition, a system must choose between remaining available (every non-failing node answers every request) and remaining linearisable. Partition tolerance is not a choice. CAP says nothing about the healthy case, which is why PACELC is more useful.' },
    { q: 'What does PACELC add?', a: 'The else-branch: when there is no Partition, you still trade Latency against Consistency. That is the decision behind every "can this read go to a replica" call, and it applies on a perfectly healthy network.' },
    { q: 'What does `R + W > N` guarantee, and what does it not?', a: 'It guarantees the read set overlaps the write set, so a read can observe the latest committed write. It does not give ordering or atomicity -- concurrent read-modify-writes can still lose updates, so compare-and-set needs a lightweight transaction.' },
    { q: 'How do you implement read-your-writes properly?', a: 'Return the leader\'s log position (LSN/GTID/`operationTime`) from the write, have the client carry it, and make the replica either wait until it has replayed past that position or forward the read to the leader. Sticky-to-leader routing works but concentrates load.' },
    { q: 'What is monotonic reads and how do you get it?', a: 'A guarantee that a session never sees time run backwards. Achieve it by pinning the session to one replica (hash the session ID) rather than round-robining, and only ever re-pin forward on failover.' },
    { q: 'Why is a fencing token required for safe failover?', a: 'A paused old leader cannot distinguish itself from a dead one. Each leadership term gets a monotonically increasing epoch; the storage layer rejects anything with a lower epoch. Without that, a node waking from a GC pause overwrites newer data.' },
    { q: 'Why is multi-leader replication usually the wrong answer?', a: 'It makes write conflicts permanent and structural. Last-write-wins on wall clocks silently loses data within the clock-skew window. Single leader plus regional read replicas, or partitioning write ownership by region, solves most of the motivating cases.' }
  ],

  drills: [
    {
      prompt: 'A payments service runs on Postgres with one primary in us-east-1 and async replicas in us-east-1 and eu-west-1. Peak is 3,000 writes/sec. During a recent AZ event, automatic failover promoted a replica that was 1.2 seconds behind, and finance found 3,600 confirmed charges with no database record. Design the fix and state what it costs.',
      probes: [
        'What is the specific mechanism that lost those writes, and could the client have known?',
        'What would you change, and what new failure mode does that introduce?',
        'How do you make the lost-write window observable before the next incident?',
        'Should the eu-west-1 replica ever be a promotion candidate?',
        'What do you do about the 3,600 charges that already happened?'
      ],
      strong: [
        'Names async acknowledgement as the mechanism and states that the client received a success it can never reconcile -- there is no retry path.',
        'Proposes semi-sync with `ANY 1` across two same-region AZs, quantifies the added commit latency at roughly 2-4 ms, and explicitly frames it as trading data loss for write availability.',
        'Excludes the cross-region replica from synchronous acknowledgement and from automatic promotion, because ~70 ms per commit and a large lag window make it a bad candidate.',
        'Adds a lag alert measured in WAL bytes plus a promotion guard that refuses automatic failover above a lag threshold, preferring a paged human to silent loss.',
        'Reconciles from an upstream source of truth -- the payment processor\'s ledger -- and proposes an outbox or idempotency-key record written in the same transaction so replay is possible.',
        'Notes that the connection pool and DNS/proxy layer must also be handled or writes keep failing after promotion.'
      ],
      weak: [
        'Says "use synchronous replication" without mentioning that writes now block when the standby is unhealthy.',
        'Includes the cross-region replica in the synchronous set and does not notice the ~70 ms commit cost.',
        'Treats the incident as a monitoring gap only, with no change to the durability configuration.',
        'No plan for the already-lost charges, or assumes clients will retry.',
        'Quotes CAP without connecting it to any specific configuration setting.'
      ] },
    {
      prompt: 'A social product moved 80% of reads to replicas to relieve the primary. Support tickets now report: comments disappearing after posting, a counter that goes 42 then 41 then 43, and replies appearing above the message they reply to. Diagnose each and propose targeted fixes.',
      probes: [
        'Which named guarantee does each symptom violate?',
        'Which fixes are session-scoped and which are global?',
        'What is the cost of sticky routing at your read volume?',
        'How would you detect these in production rather than through support?'
      ],
      strong: [
        'Maps the three symptoms to read-your-writes, monotonic reads and consistent prefix respectively, using those names.',
        'Fixes read-your-writes with an LSN token or bounded leader-sticky window; fixes monotonic reads by hashing the session to a single replica; fixes consistent prefix by co-locating causally related writes on one partition or ordering by a logical clock rather than wall time.',
        'Quantifies the load returned to the primary by any sticky-read approach and proposes scoping it to sessions with a recent write only.',
        'Proposes taking replicas out of rotation automatically above a lag threshold, and monitoring lag per replica rather than as a fleet average.',
        'Notes that a synthetic write-then-read canary per replica would have caught all three before support did.'
      ],
      weak: [
        'Answers "it is eventually consistent, that is expected" without naming the specific guarantees or proposing fixes.',
        'Proposes making everything synchronous or moving all reads back to the primary.',
        'Treats the three symptoms as one bug with one fix.',
        'No detection strategy beyond "add more monitoring".'
      ]
    }
  ]
};
