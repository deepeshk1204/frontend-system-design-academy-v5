# Backend & Distributed Systems — Staff cheatsheet

Spoken-answer fragments from each topic. Generated; the full argument is in the topic.

## Anatomy of a Backend Request

Most candidates draw a box labelled "load balancer" and move on. The signal is in the
sentences that show you have debugged this layer at 3am:

- "Before I tune any query I want the **connection acquisition wait time**, because if that is
40 ms then no amount of index work will move p99 and the database dashboard will look innocent."
- "We are behind an NLB with gRPC, so balancing happens once per channel and not per request. I
would expect exactly the imbalance you are describing, and I would fix it with Envoy or with
`MaxConnectionAge` of 30 minutes on the server side rather than by adding instances."
- "I would use least-connections over round robin because our request cost is bimodal, but I would
pair it with outlier ejection -- otherwise the instance failing in 1 ms looks like the idlest node
in the fleet and receives the most traffic."
- "Little's Law gives us about 10 busy connections for 1,200 rps at 4 ms, so a per-instance pool of
10 and 40 instances is 400 server connections against a `max_connections` of 100. That is an
argument for pgBouncer, not for raising the limit -- Postgres throughput degrades with connection
count because it is a process per connection."
- "A 1-second timeout inside a 250 ms budget is not a timeout, it is a promise to violate the SLO.
The per-attempt timeout has to be derived from the remaining budget."

The pattern in all five: name the specific queue, give the number that would confirm it, and name
the mechanism that fixes it. Saying "we would monitor it" is the weak version of every one of
these sentences.

## API Design & Contracts

Junior answers describe an endpoint. Staff answers describe a *contract under failure*.
The sentences that do the work:

- "A `POST /payments` that times out is ambiguous to the client, so it needs an
`Idempotency-Key`. I would write the key and the charge in one transaction, hash the body so a
reused key with different arguments returns `422` rather than replaying, and return `409` if a
sibling attempt is still in flight so we never execute twice concurrently."
- "If the side effect is an external processor call, it cannot be in my transaction. I'd insert
`in_flight`, commit, pass my key as the processor's idempotency key, then record the result -- and
I'd own a reconciliation job for keys stuck `in_flight`, because that is the only state a crash
can leave behind."
- "I would not expose offset pagination on a public list. `OFFSET 100000` reads 100,020 rows, and
the callers who go that deep are the ones hitting every page. Keyset on `(created_at, id)` with
an opaque cursor is constant cost and stable under concurrent inserts."
- "Per-hop timeouts multiply. I want an absolute deadline on the request, each hop subtracting its
own overhead and a reserve, and the remainder pushed into `SET LOCAL statement_timeout` -- so we
stop paying for work no one is waiting for."
- "`500` and `504` are different instructions to the client. I want `503` for load shedding
with a `Retry-After`, `504` for an upstream deadline, and an explicit `retryable` flag, so a
client's retry policy is driven by my semantics rather than by guessing."
- "For internal services I would rather have no version and enforce additive-only protobuf changes
in CI with Buf. Versioning is a promise to maintain two code paths, and date-pinned versioning is a
promise to maintain sixty."

What each signals: the first three show you have debugged duplicate writes and slow list
endpoints in production. The deadline point shows you understand that abandoned work is a capacity
problem. The error-taxonomy point shows you think about the client's control flow, not just your
own. Naming `reserved` tags and `UNSPECIFIED = 0` unprompted is a small detail that reliably
separates people who have shipped protobuf from people who have read about it.

## Databases, Indexes & Query Plans

The tell of a strong candidate here is that they ask for the plan before proposing a
fix, and that they are willing to say the planner is right.

- "Before I add an index I want `EXPLAIN (ANALYZE, BUFFERS)`. If `Rows Removed by Filter` is
1.4 million on a 2 million row table, the sequential scan is the *correct* choice and an index on
that column will not be used -- the crossover is around 5-10% selectivity."
- "The biggest estimate-versus-actual ratio in the plan is where I start. An estimate of 1 row that
is actually 8,000 turns a nested loop into 8,000 probes, and that is a statistics problem, not an
index problem -- `ANALYZE`, or `CREATE STATISTICS` if the columns are correlated."
- "For `tenant_id = ? AND type = ? AND created_at > ?` I want `(tenant_id, type, created_at
DESC)`. Equality first, range last, and the range column doubles as the `ORDER BY` so we skip
the sort node. If the range column is in the middle, everything after it degrades to a filter."
- "`Heap Fetches` being non-zero on an index-only scan means the visibility map is stale, so this
is an autovacuum problem showing up as a query regression. I'd check `n_dead_tup` and look for a
long-running transaction pinning the snapshot."
- "We have twelve indexes on that table and `pg_stat_user_indexes` says four have never been
scanned. Each one is an extra B+tree write per insert and extra WAL to every replica -- I would
drop them before I add a thirteenth."
- "That endpoint is 0.8 ms per query and 100 queries per request. The query is not the problem; the
round trips are. I'd batch with `id = ANY($1)` and add queries-per-request to the trace so it
cannot regress silently."

Each of these does the same three things: names the specific evidence, interprets a number rather
than an adjective, and states what the fix costs. Volunteering that over-indexing has a write cost,
or that a seq scan can be optimal, is the clearest signal that someone has owned a database rather
than queried one.

## Transactions & Isolation Levels

The distinguishing move is naming the specific anomaly and the specific defence, rather
than saying "we'd use a transaction".

- "Read Committed does not stop lost updates. If we read the balance in application code and write
it back, two concurrent debits produce one -- silently. I'd either do it in place with
`SET balance = balance - $1`, or take `FOR UPDATE`, or use a version column."
- "This is **write skew**: both transactions read the same set and write different rows, so
snapshot isolation sees no conflict. Three defences -- Serializable with a retry loop, materialise
the conflict by locking the shift row itself, or make it a unique constraint so the database
refuses it regardless of isolation level. I'd pick the constraint where the invariant fits one,
because it survives every future code path."
- "If we run Serializable we must handle `40001` and retry the *whole* transaction with jitter.
Aborts are the mechanism, not a bug. And I'd check for sequential scans inside those
transactions -- SSI escalates to relation-level predicate locks, so a missing index turns one
conflict into a fleet-wide abort storm."
- "Postgres and MySQL both call it Repeatable Read and they are not the same thing. Postgres gives
me a `40001`; MySQL lets a locking read see the latest committed row instead of my snapshot. The
same code is a retryable error on one and a silent wrong answer on the other."
- "The deadlocks are a lock-ordering problem, not a volume problem. Both paths touch the same two
rows in opposite orders. `SELECT ... WHERE id IN (...) ORDER BY id FOR UPDATE` imposes a total
order and removes the class."
- "The bloat is on tables that transaction never touched, which means something is holding an old
snapshot. I'd look for `idle in transaction` sessions before I look at autovacuum settings, and I
would set `idle_in_transaction_session_timeout` regardless."

What these signal: that you have debugged a silent data-integrity bug, that you know isolation
levels are named the same and behave differently, and that you treat transaction *duration* as an
operational property of the whole cluster rather than a local concern. Volunteering the constraint
option as preferable to the clever locking option is a particularly good sign -- it shows you
optimise for the code you have not written yet.

## Data Modelling: SQL, NoSQL & Access Patterns

The signal here is direction of reasoning. Weak answers start from a technology; strong
answers start from a table of access patterns and arrive at a technology.

- "Before I pick a store I want the access patterns with rates. If profile reads are 40,000 rps and
posts are 600 rps, that is a 66:1 ratio and it licenses fan-out-on-write for timelines -- I can
afford substantial write-path work to make the read a single key lookup."
- "`PROJ#42` as a partition key means one busy project is capped at roughly 3,000 RCU. I would
write-shard it as `PROJ#42#0..9` and scatter-gather, and I would rather take that complexity now
than discover the ceiling during a launch."
- "Encoding status in the sort key makes 'list open tasks' a range query instead of a filter, and I
want to be explicit that the cost is a delete-and-insert on every status change, because keys are
immutable. That is the trade, and it is a good one at this read ratio."
- "The price on an order line is not denormalisation, it is a temporal snapshot -- the price at
purchase is a different fact from the current price, and we must *not* update it. The display name
on a post is real denormalisation, and it needs a fan-out job and a reconciler."
- "If `custom->>'industry'` appears in a `WHERE` clause, it wanted to be a column. `jsonb` is
right for tenant-defined attributes we never query across tenants; it is wrong the moment the
planner needs a selectivity estimate for it."
- "I would not add Elasticsearch without the CDC pipeline in the same project. Dual writes from app
code have a crash window that silently corrupts the index, and there is no monitoring that detects
it. Outbox plus a nightly reconciler, or we do not add the store."
- "The migration is five deploys, not one -- add, dual-write, backfill in batches, flip reads, drop.
And `lock_timeout` of two seconds on the DDL, because an `ALTER TABLE` waiting on a lock blocks
every query behind it."

What each signals: quantified reasoning rather than preference, awareness of physical limits,
honesty about what a design cannot do, and -- most tellingly -- the instinct to cost the
operational burden of a second store and to insist on a reconciler. Anyone who volunteers "and a
job that diffs and repairs" has maintained a derived store in production.

## Server-Side Caching & Redis Patterns

Most candidates say "add Redis". The distinguishing content is the transitions -- expiry,
cold start, hot key, and disagreement with the database.

- "At 8,000 rps on that key with a 60-second TTL, the moment of expiry is 8,000 concurrent identical
queries. I want a soft TTL for freshness and a longer hard TTL so there is always a stale copy to
serve, one rebuild behind `SET NX`, and in-process coalescing so a single instance's 200 concurrent
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
- "I would not hold locks and cache in the same instance. They want opposite `maxmemory-policy`
settings, and an evicted lock means two workers doing the same job. Separately -- Redis replication
is asynchronous, so a failover can hand the same lock to two clients. If that matters, the lock
needs a fencing token the resource checks."
- "We are not negative caching, so every request for a missing id is a database query. That is why
the hit rate drops whenever someone scans us."

The common thread: each sentence names a number, a mechanism and a failure. The two that most
reliably separate people who have operated a cache are volunteering the cold-start question before
being asked, and knowing that Redis-based locking is not authoritative.

## Sharding & Partitioning

Most candidates answer "how would you scale this database?" with "shard it". The Staff signal is in the sequencing,
the irreversibility, and the migration plan. Sentences that land:

- "Before I shard I want to know the write rate on the leader and whether the hot index still
  fits in RAM. If it is a read problem, replicas and a cache are two orders of magnitude
  cheaper than sharding, and if it is a single hot table I would functionally partition that
  table out first."
- "The shard key is the most expensive decision on this page, because it is the one I cannot
  undo. I would pick `tenant_id` here: queries are already tenant-scoped, so are transactions,
  and it lets me physically isolate the largest customer later without an application change."
- "I would hash into 4096 fixed logical partitions and assign partitions to machines, rather
  than hashing onto machines. Then growing the fleet is reassigning partitions, not rehashing
  data. Plain `mod N` would move about 80% of rows when I go from 4 shards to 5."
- "Fan-out queries are the thing that surprises people. If a shard is 10 ms at p99, a 50-shard
  scatter-gather is fast only when all 50 are fast -- that is 0.99 to the 50th, about 60%. So
  I budget fan-out width per endpoint and push shard-key-free lookups into a global index."
- "Resharding is double-write, backfill, verify with checksums, shift reads at 1% then 10%,
  then flip writes -- and I keep writing back to the old shard for a week so rollback is still
  real."
- "The honest answer is that this dataset is 400 GB with 3,000 writes a second. I would not
  shard it. I would put that on my own roadmap as the thing to revisit at 5 TB, and I would
  make sure every table already carries `tenant_id` so the future migration is mechanical."

That last one is the strongest answer in the set. Declining to shard, with the specific threshold and the cheap
preparatory step, is what separates someone who has done this from someone who has read about it.

## Replication & Consistency Models

The gap between a senior and a Staff answer here is almost entirely precision. Senior candidates say "eventually
consistent" and "CAP theorem". Staff candidates say things like:

- "When you say the replica is eventually consistent, what is the lag at p99, in bytes of WAL?
  I care about bytes rather than seconds because that number *is* my data-loss window on
  failover, and it is the number I would alert on."
- "I would run semi-synchronous with `ANY 1 (a, b, c)`. That means no acknowledged write is
  lost to a single node failure, and a single slow replica cannot stall my write path. I am
  paying about 2 ms of cross-AZ round trip per commit for that, which is a trade I would make
  for payments and would not make for view counters."
- "The user-visible bug is read-your-writes, and I would fix it with the write's LSN rather
  than sticky sessions. The write returns `pg_current_wal_lsn()`, the client sends it back,
  and the replica either waits until it has replayed past it or forwards to the leader. Sticky
  routing works but it silently concentrates load on the primary."
- "CAP only tells you what happens during a partition, which is rare. PACELC is the useful
  version, because the else-branch -- latency versus consistency with a healthy network -- is
  the trade I am making every day when I decide whether this read can go to a replica."
- "`R + W > N` guarantees the read set overlaps the write set. It does not give me
  linearisability, so I cannot implement a decrement-the-inventory operation on it. For that I
  need a lightweight transaction, which is Paxos per key and roughly four times the latency."
- "Any lock or leadership without a monotonically increasing fencing token is unsafe, because a
  30-second GC pause is indistinguishable from a dead node. The storage layer has to reject the
  stale epoch -- the coordinator cannot enforce it for you."

The pattern to copy: turn every consistency word into an observable number, and name which component enforces the
guarantee. Saying "the replica enforces the LSN wait" is worth more than three paragraphs about CAP.

## Consensus, Leases & Distributed Locks

This topic separates candidates faster than almost any other, because the naive answer -- "use a distributed lock"
-- is both extremely common and usually wrong. What a strong candidate says:

- "Before I add a lock, what breaks if this runs twice? If the answer is duplicated work, a
  Redis lease with a TTL is fine. If the answer is a double charge, a lock is the wrong tool and
  I want an idempotency key with a unique constraint in the payments database."
- "Any lock without a monotonically increasing fencing token is unsafe, and the check has to
  happen at the resource. A 25-second GC pause is indistinguishable from death, so the paused
  holder will wake up and write. No amount of client-side care fixes that -- only the storage
  layer rejecting a stale token does."
- "The resource here is a single Postgres database, so Postgres is already my consensus system.
  `pg_try_advisory_lock` plus a `WHERE version = $1` is safer than etcd, because it does not
  add a second failure domain, and the lock dies with the connection."
- "Raft is safe because any two majorities intersect, and a voter only backs a candidate whose
  log is at least as current as its own. So a committed entry is guaranteed to be in the log of
  every future leader. That is why 3 nodes tolerate one failure and 4 nodes still only tolerate
  one."
- "I would not put etcd on the user request path. Kubernetes deliberately keeps it behind the
  API server so the control plane can be down while the data plane keeps serving -- I want the
  same property."
- "On the Redlock debate: both sides are right about different questions. Redlock is adequate
  for efficiency locks and inadequate for correctness locks, because it issues no fencing token
  and assumes bounded pauses. The design question is which kind of lock I need, not which blog
  post is correct."
- "`Date.now()` for a timeout is a bug waiting for an NTP step. Monotonic clock for durations,
  wall clock only for display. And last-write-wins on wall clocks means a 250 ms skew silently
  eats a genuinely newer write."

The meta-signal: a strong candidate spends the first thirty seconds trying to *remove* the need for coordination,
and only then discusses how to do it safely. Reaching for etcd immediately reads as pattern-matching rather than
engineering.

## Queues & Event Streaming

The tell for a Staff-level answer is that delivery semantics and ordering are discussed as consequences of specific
configuration and key choices, not as adjectives. Sentences that carry weight:

- "I would key by `order_id`. Kafka only orders within a partition, so that gives me a strict
  sequence per order while different orders parallelise. Keying by `tenant_id` would be wrong
  here because one tenant is 5% of traffic and I cannot fix that partition by adding more."
- "I design for at-least-once and make the consumer idempotent. Kafka transactions are genuinely
  exactly-once, but only when the side effect is a Kafka write plus an offset commit -- there is
  no two-phase commit between Kafka and Stripe, so the dedupe table is the real mechanism."
- "`acks=all` is not sufficient on its own. If the ISR has shrunk to the leader, all in-sync
  replicas have acknowledged and you still have one copy. I want `min.insync.replicas=2` and
  `unclean.leader.election.enable=false`, and an alert on ISR shrink."
- "The order of operations is: effect and dedupe row in one database transaction, then commit the
  offset. Any crash leaves either a clean replay or a no-op. Committing the offset first is
  at-most-once by accident."
- "I alert on the slope of lag per partition, not on absolute lag for the group. A spike that
  drains is the queue doing its job. A steady climb for ten minutes means throughput is below
  produce rate and the backlog is unbounded. Group averages hide a single stalled partition."
- "Retention is 7 days, so my real alert is 'lag is within 24 hours of the retention horizon',
  because past that point the broker deletes data my consumer never saw and
  `auto.offset.reset` silently skips it."
- "A DLQ without a replay tool is a graveyard. I want the original key and headers preserved, the
  exception recorded, an alert on arrival rate, and a tool I have tested before the incident."
- "I would not use Kafka for this. It is 200 messages a second, one consumer, no replay
  requirement, and we are on AWS -- SQS with a DLQ is a config change instead of a cluster."

That last sentence matters as much as the others. Kafka is a significant operational commitment, and correctly
declining it is a senior judgement call.

## Event-Driven Architecture, Sagas & CQRS

Almost every candidate can describe pub/sub. The Staff signal is naming the dual-write problem unprompted and
treating eventual consistency as a product decision with an owner. Sentences that land:

- "The bug in that design is the dual write. The database commit and the Kafka publish are two
  independent writes with no shared transaction, so a crash between them loses the event
  silently -- no error, no retry. I would write the event to an outbox table in the same
  transaction and drain it with CDC."
- "I would point Debezium at the outbox table rather than the business tables, so my event
  schema is a deliberate contract instead of an accidental leak of column names I will want to
  rename."
- "Outbox plus CDC gives me at-least-once, not exactly-once, so every consumer needs a dedupe
  table keyed on `eventId`, inserted in the same transaction as the effect, with the offset
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
  `max_slot_wal_keep_size` and accept re-snapshotting over an outage."

The pattern: name the atomic boundary, name who enforces idempotency, and name the user-visible consequence of the
lag. Candidates who only draw boxes and arrows are describing the happy path.

## Scalability & Capacity Planning

The estimation itself is table stakes. The Staff signal is which numbers you choose to
compute, and what conclusion you draw from each.

- "Before sizing anything I want the read/write ratio. At 400:1 I can afford heavy work on the write
path, so fan-out-on-write for timelines is clearly right -- and that conclusion is driven by the
ratio, not by preference."
- "Image traffic is 75,000 rps at 400 KB, which is 240 Gbit/s. That is not something you serve from
an origin, so the CDN is a requirement, not an optimisation. And 78 PB a month of egress makes
image format a business decision rather than a polish task."
- "I would not plan to 90% CPU. `W = S/(1-ρ)` means 90% utilisation is already 10x service time in
the system, and the next 10% of traffic triples it. I plan to about 65%, and the 35% idle is what
buys deploys, an AZ loss and arrival variance."
- "Lag of 400,000 messages is not a number I can act on. At 5,000 per second that is 80 seconds of
delay by Little's Law, and 80 seconds is something I can write an SLO against."
- "We autoscale on CPU and the service is I/O bound, so during the incident CPU was at 30% and the
autoscaler did nothing. I would scale on in-flight concurrency, with immediate scale-up and a
ten-minute stabilisation window on scale-down so it cannot oscillate."
- "One account with 40 million followers is 33 minutes of fan-out at 20,000 writes a second. So the
design has to be hybrid -- push below about 50,000 followers, pull-at-read above it, merged at
query time."
- "Adding shards will not help here, because every request takes the same global lock. USL says the
coherency term grows quadratically, so past some point more nodes make it slower. The lock has to
go first."
- "I would scale the stateless tier out and the database up, for as long as vertical works. A 192-core
machine is one restart with no new failure modes; sharding is the whole distributed-systems syllabus."

What these signal: that you reason from ratios to decisions, that you know the queueing curve well
enough to refuse a plan, that you convert operational metrics into user-facing time, and that you
are willing to say "adding machines will not help". The last one is the rarest and the most
valuable.

## Resilience: Timeouts, Retries & Backpressure

Almost every candidate lists these patterns. The signal is in the numbers, the ordering,
and the willingness to say a pattern is the wrong choice.

- "Retries are the dangerous part. Full jitter is necessary but not sufficient -- the missing piece
is usually a retry *budget*: cap retries at about 10% of successful traffic in a token bucket, so we
retry hard for an isolated blip and not at all for a systemic failure. And we retry at exactly one
layer, or a single user request becomes 27 database queries."
- "A timeout is an unknown outcome, not a failure. So we can only retry that write if it carries an
idempotency key -- otherwise the retry is how we double-charge someone."
- "I would not put a circuit breaker on auth. It has no fallback, so opening the breaker turns 30%
failures into 100% failures. For a hard dependency I want a concurrency limit instead -- it bounds
how much of our capacity the dependency can consume without refusing requests that would have
succeeded."
- "The right shed signal is not latency, it is **queue wait time at dequeue**. If a request has been
queued for 4 seconds and its deadline was 2, processing it is pure capacity theft. And under
overload I would rather run the queue LIFO, because FIFO guarantees we serve the stalest requests
first and satisfy nobody."
- "Recommendations gets a semaphore of 10 out of 200 workers. Deliberately small -- I never want the
least important dependency able to consume more than 5% of our capacity, and I accept that it cannot
burst into idle capacity."
- "This is a metastable failure: the trigger is gone and the retry traffic is now the load, so there
is no self-recovery path. Getting out requires shedding a large fraction at the edge, letting the
survivors complete and warm the caches, then ramping back."
- "The liveness probe must not touch the database. If it does, a database blip restarts the entire
fleet at once and we have turned a recoverable problem into an outage plus a cold-start storm. And
I want a minimum-healthy override in the load balancer, because 'everything is unhealthy' and 'this
instance is unhealthy' need opposite responses."
- "The degradation ladder has to be agreed with product before the incident. Rung three is
inventory from a 60-second cache, which accepts a small oversell risk -- that is a business
decision, and I do not want to be making it at 3am."

What these signal: retry budgets and queue-wait shedding are strong indicators of real operational
experience, because they are the two pieces most commonly missing. Saying "a breaker is wrong here"
shows you understand the mechanism rather than the vocabulary. And treating degradation as a
negotiated product ladder is the clearest sign of someone who has actually run an incident.

## Rate Limiting & Multi-Tenancy

The weak version of this answer is "token bucket in Redis". The strong version separates
the three problems, names the key, and is explicit about what the limiter does *not* solve.

- "There are three different limits here and they need different designs. Rate bounds arrival,
concurrency bounds resources held -- which is what actually causes outages -- and quota is a
commercial construct that must be accurate and auditable. I would run all three."
- "A rate limit does not solve noisy neighbours. A tenant can sit inside 1,000 rpm and consume most
of our capacity if their requests are 200x the average cost. That needs per-endpoint weights
debited from the bucket, plus a per-tenant concurrency semaphore at the database pool."
- "The read-decide-write has to be atomic or the limiter simply does not work at 40 instances. One
Lua script, one key, so it survives Redis Cluster resharding, and the timestamp passed in by the
caller rather than read inside the script."
- "I would not limit on IP for authenticated traffic. A mobile carrier can put hundreds of thousands
of subscribers behind one address, so an IP limit blocks a region because of one script. And on
IPv6 a household has a /64, so per-address limiting is trivially evaded -- limit the prefix."
- "Fail-open versus fail-closed is a per-limiter decision. Abuse protection fails open, because I
will not let the limiter cause the outage it exists to prevent. Login attempts and billing quotas
fail closed. Better still, degrade to a local limiter at global-limit-over-instance-count while
Redis is unavailable."
- "Rate limiting caps demand; it does not allocate supply. When every tenant is legal and the sum
exceeds capacity, I want weighted fair queueing -- deficit round robin per tenant -- so a 10,000-item
backlog cannot delay someone's three items, and idle weight is redistributed rather than reserved."
- "For 50,000 small tenants, row-level with Postgres RLS and `SET LOCAL` -- the database enforces
scoping so a forgotten `WHERE` returns zero rows rather than everyone's data. Dedicated databases
for the handful of large or regulated tenants, which also makes isolation a SKU. 50,000 databases is
50,000 backups and 50,000 migrations, and that is an operational tax with no end date."
- "`429` and `503` are different statements. One says the client did too much, the other says we
cannot cope. Clients should react differently, so I want both, both with `Retry-After`."

The two sentences that most reliably mark experience: "a rate limit does not solve noisy
neighbours", and treating fail-open as a per-limiter policy decision with a local fallback. Both
come from having watched a limiter either fail to protect or become the outage.

## Observability, SLOs & Error Budgets

Observability is where interviewers most often find out whether someone has actually carried a pager. The
statistical point and the cost point are the two strongest signals.

- "I would not average those p99s -- a percentile is an order statistic and the mean of two
  percentiles is not a percentile of anything. Nine pods at 20 ms and one at 5 seconds averages
  to 518 ms, which reads as a general slowdown instead of one dead pod. Export buckets and run
  `histogram_quantile` over the summed rates."
- "Before I add `customer_id` as a label, that multiplies my series count by 5,000. Cardinality
  is the product of label values, not the sum. High-cardinality identity belongs in traces and
  logs; if we need per-tenant latency I would emit it for the top 50 and bucket the rest."
- "Head sampling at 1% throws away the traces I actually need, because errors are rare by
  construction. I want tail sampling in the Collector: everything that errored, everything over
  a second, and 1% of the boring successes."
- "I would page on burn rate, not on threshold. 14.4x over a one-hour window with a five-minute
  short window as confirmation -- the long window gives sensitivity, the short one makes the
  alert clear once we have recovered."
- "My SLI is the fraction of `POST /checkout` requests returning non-5xx under 300 ms, over 28
  rolling days, excluding synthetic load -- a ratio of good events to valid events, and I want to
  agree what counts as valid before we agree the target. The SLO is only real if a policy is
  attached: budget exhausted means we stop feature work, agreed with the product owner in writing
  before the first incident rather than during it."
- "That alert is not actionable, so it is training the on-call to ignore pages. I would make it a
  ticket. My target is under two pages per shift, and anything above that gets engineering time
  like any other bug."
- "The trace has to survive the Kafka hop, so `traceparent` goes in the message headers and
  `trace_id` goes in every log line. Otherwise half the system is invisible and we are back to
  correlating timestamps."

The meta-signal: a strong candidate talks about telemetry *cost* and *actionability* without prompting, because both
are things you only learn by owning the bill and the pager.

## Backend Security & Identity

Security answers separate candidates fast, because the vocabulary is easy to acquire and the mechanisms are not.
What a strong candidate says:

- "Which of authentication and authorisation are we actually discussing? The token tells me who
  the caller is. It does not tell me they are allowed to touch *this* row, and that second check
  is where the breaches are."
- "I would never read `tenant_id` from the request body. It comes from the verified token, and I
  would back it with Postgres row-level security and `SET LOCAL app.tenant_id` inside the
  transaction -- so the day someone adds an endpoint and forgets the filter, the database returns
  nothing instead of everything."
- "Authorization code with PKCE, for every client including the server-rendered one. Implicit and
  the password grant were removed in OAuth 2.1, not just discouraged."
- "The ID token establishes my session; the access token calls the API. Sending an ID token as a
  bearer token is a real bug, and the resource server's `aud` check is what catches it."
- "I would not use a JWT as a browser session. The property I need most is immediate logout and
  immediate permission change, and a self-contained token cannot give me either. Opaque id in an
  `HttpOnly` cookie, a sub-millisecond Redis lookup, and I can revoke it."
- "Refresh tokens rotate on every use, and if a rotated token is presented again I burn the whole
  family. I cannot tell whether the attacker or the user got there first, and I do not need to --
  the cost of being wrong is one login prompt."
- "This webhook-validation endpoint is an SSRF. I would enforce IMDSv2 so the metadata endpoint
  needs a PUT and a hop limit, resolve the hostname myself, reject private and link-local ranges,
  and connect to the resolved IP so DNS rebinding cannot switch the target after validation."
- "RBAC will hold for about a year. The moment a customer asks for per-project permissions you
  get `editor_project_8891` roles, and the honest question becomes whether to adopt a
  Zanzibar-style relationship model now or pay a migration later."
- "I want denials in the audit log, not just successes. A spike in denials for one principal is
  the best early signal of an attack that I get for free."

The pattern: name the enforcement point, name the failure mode of forgetting it, and name the control that makes
forgetting harmless. "We validate the JWT" is not a security design.

## Containers, Kubernetes & Safe Deploys

Deployment questions are where interviewers find out whether someone has been paged during a rollout. The probe
answer and the migration answer are the two highest-signal moments.

- "Whose liveness probe checks the database? That is the outage. A database blip fails liveness on
  every pod, Kubernetes kills the whole fleet, and the cold-start stampede makes the database worse.
  Restarting my app does not fix the database, so restarting cannot be the right response -- that
  check belongs in readiness."
- "I would remove the CPU limit and keep the memory limit. CPU requests already give me
  proportional-share fairness, and a limit just adds CFS throttling: eight threads with a 1-core
  limit burn the 100 ms quota in 12 ms and then freeze for 88, which puts a floor under my p99
  while average CPU reads 40%. Memory cannot be reclaimed by throttling, so that limit stays."
- "You cannot rename that column. Rolling deploys mean both versions run at once, so it is four
  deploys: add nullable columns, dual-write, backfill in batches, switch reads, stop writing the
  old one, then drop it days later. Each step has to be independently reversible."
- "The backfill is the risky part, not the DDL. A single `UPDATE` over 40 million rows bloats
  WAL and pushes replication lag into minutes, which breaks every replica-backed read in the
  product. Bounded batches in primary-key order, a resumable high-water mark, and a throttle
  gated on replication lag."
- "I would set `lock_timeout` before any DDL. An `ALTER TABLE` waiting for
  `ACCESS EXCLUSIVE` queues every subsequent `SELECT` behind it, so one long analytics query
  turns a metadata change into a full table outage."
- "The 502s on deploy are not normal. Endpoint removal and SIGTERM happen concurrently, so I need
  a preStop sleep of about 10 seconds to let the removal propagate, readiness returning 503
  immediately on SIGTERM, and a grace period that exceeds preStop plus my longest request."
- "Canary, not blue-green, because the regression I actually expect is a 40% p99 increase that
  crashes nothing and passes every probe -- and I compare against the stable version running
  concurrently so time-of-day effects cancel. This service is also IO-bound, so a CPU-based HPA
  would never fire; I would scale on requests per second per pod, and check whether the real
  bottleneck is the database, because scaling the stateless tier into a saturated database just
  makes the incident arrive faster."

The pattern: name the mechanism, name the metric that reveals it, and name the specific configuration value you
would change. "Add monitoring" is not an answer; "`container_cpu_cfs_throttled_seconds_total`" is.
