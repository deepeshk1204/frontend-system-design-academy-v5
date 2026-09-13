export default {
  blocks: [
    { t: 'prose',
      md: `Consensus is a group of machines agreeing on a single value -- or, more usefully, on a single *ordered sequence* of
values -- despite some of them crashing, some messages being lost, and none of them sharing a clock.

You almost never implement it. You almost always depend on it: every leader election, every distributed lock, every
"who owns this shard" answer, and every Kubernetes object you create is consensus somewhere underneath. This topic
is about knowing when you genuinely need it, what the algorithms guarantee, and why the lock you wrote with Redis
last year is probably unsafe.` },

    { t: 'h', text: 'Why it exists' },
    { t: 'prose',
      md: `Suppose three nodes need to know which one is the leader. Node A cannot simply ask B and C, because in an
asynchronous network you cannot distinguish "B has crashed" from "B is slow" from "the message to B was dropped".
There is no timeout value that resolves this: the FLP result says no deterministic protocol can guarantee both
safety and liveness in a fully asynchronous system with even one faulty node. Practical systems dodge it by giving
up bounded liveness -- they use timeouts and randomisation, so they *usually* make progress quickly and *always*
stay safe.

Without agreement, you get the two failure modes that define distributed systems pain. Two nodes both believe they
are leader and both accept writes -- split-brain, divergent histories, manual reconciliation. Or no node believes it
is leader and the system stalls. Consensus buys you: at most one leader per term, and an agreed log order that
survives any minority failing.` },
    { t: 'note',
      tone: 'warn',
      title: 'The most useful thing you can know about consensus',
      md: `It is expensive and it is often unnecessary. A majority-quorum round trip per decision means every write costs at
least one network round trip to a majority, and the cluster stops accepting writes when it cannot reach a majority
-- so a 3-node etcd cluster is *less* available than a single node for reads and deliberately so for writes. If your
problem can be solved by making the operation idempotent, by partitioning ownership, or by a single-writer database
transaction, do that instead. Most "we need a distributed lock" problems are really "we need this operation to be
safe to run twice".` },

    { t: 'h', text: 'Raft, with actual intuition' },
    { t: 'prose',
      md: `Raft splits the problem into three pieces that can be understood separately: leader election, log replication, and
safety. Every node is in one of three states -- follower, candidate, leader -- and time is divided into **terms**, a
monotonically increasing integer that acts as a logical clock. At most one leader exists per term, which is the
property everything else rests on.` },
    { t: 'diagram',
      code: `stateDiagram-v2
  [*] --> Follower
  Follower --> Candidate: election timeout<br/>150-300ms randomised
  Candidate --> Leader: majority of votes<br/>in this term
  Candidate --> Follower: another leader<br/>with higher term
  Candidate --> Candidate: split vote,<br/>new randomised timeout
  Leader --> Follower: sees higher term<br/>in any message
  Leader --> Leader: heartbeat every 50ms` },
    { t: 'prose',
      md: `**Election.** A follower that hears no heartbeat within its election timeout increments the term, votes for itself,
and asks everyone else for a vote. A node grants at most one vote per term, and only to a candidate whose log is at
least as up to date as its own. A candidate that collects a majority becomes leader. The timeout is *randomised* --
typically 150-300 ms -- which is the whole trick for avoiding perpetual split votes: the node that wakes first
usually wins before the others start.

**Log replication.** Clients send commands only to the leader. The leader appends the entry to its own log, then
sends \`AppendEntries\` to all followers. Once a majority have *durably* written the entry, the leader advances its
**commit index** and applies the entry to the state machine, then tells clients it is done. Followers learn the
commit index from subsequent heartbeats and apply in the same order. The log is the source of truth; the state
machine is just a fold over the log.

**Why a majority is enough.** Any two majorities of the same cluster must share at least one node. So a new leader,
elected by a majority, is guaranteed to have talked to at least one node that saw every committed entry. Combine
that with the rule that a voter only supports a candidate whose log is at least as current as its own, and it
follows that a committed entry can never be absent from a future leader's log. That is the safety argument in one
paragraph, and it is the thing to be able to reconstruct in an interview.` },
    { t: 'numbers',
      title: 'Raft cluster arithmetic',
      items: [
        { v: '3 nodes', k: 'Tolerates 1 failure', note: 'Majority is 2' },
        { v: '5 nodes', k: 'Tolerates 2 failures', note: 'Majority is 3 -- the etcd recommendation' },
        { v: '4 nodes', k: 'Still tolerates only 1', note: 'Even counts buy nothing -- majority is 3' },
        { v: '~1-5 ms', k: 'Commit latency, same-region', note: 'One round trip to a majority plus fsync' },
        { v: '~150-300 ms', k: 'Typical election timeout', note: 'Randomised; leader loss costs roughly this' }
      ] },
    { t: 'note',
      tone: 'info',
      title: 'Paxos, Multi-Paxos, Raft, ZAB',
      md: `Paxos agrees on one value; Multi-Paxos runs it repeatedly with a stable leader to agree on a log. Raft is
Multi-Paxos with the ambiguities removed and a strong leader by design -- same guarantees, dramatically easier to
implement and to reason about. ZAB is ZooKeeper's variant. None of these tolerate *malicious* nodes; Byzantine fault
tolerance is a different and much more expensive family, and outside blockchains you will not need it.` },

    { t: 'h', text: 'When you need consensus, and when you are cargo-culting it' },
    { t: 'table',
      cols: ['Situation', 'Do you need consensus?', 'What to do'],
      rows: [
        ['Elect one cron runner across 5 replicas', 'Yes, but use a library', 'etcd or ZooKeeper lease with a TTL, plus a fencing token in the job itself'],
        ['Make sure a webhook is processed once', 'No', 'Idempotency key with a unique constraint in your existing database'],
        ['Assign shards to nodes and publish the map', 'Yes', 'etcd with a watch; nodes react to map changes, writes are fenced by map version'],
        ['Prevent double-charging a card', 'No', 'Unique idempotency key in the payments table; the transaction is the lock'],
        ['Two services must both commit or neither', 'No -- and 2PC is worse', 'Saga with compensating actions plus a transactional outbox'],
        ['Feature flag / config distribution', 'No', 'Eventually consistent config service with a version number; strong consistency is not required'],
        ['Guarantee only one node runs a migration', 'Yes, lightly', 'Postgres advisory lock in the same database you are migrating -- single writer, no extra system']
      ] },
    { t: 'prose',
      md: `That last row is worth internalising. If the resource you are protecting is a single database, that database *is*
your consensus system. \`SELECT pg_try_advisory_lock(42)\` is safe, free, and dies with the connection. Reaching for
etcd to protect a Postgres table is adding a second failure domain to solve a problem the first one already solved.` },

    { t: 'h', text: 'Leases: leadership with an expiry' },
    { t: 'prose',
      md: `A lock held forever is a liability, because the holder can die without releasing it. A **lease** is a lock with a
TTL: the holder must keep renewing it or it expires automatically. This is how etcd and ZooKeeper express
leadership, and how Kubernetes controllers elect a single active instance -- the \`coordination.k8s.io/Lease\`
object with a 15-second duration and a 2-second renewal period is exactly this pattern.

The subtlety is that the lease TTL is measured on the *server*, while the holder's belief about its own lease is
measured on the *client*. If the client is paused -- a 20-second stop-the-world GC pause, a hypervisor
live-migration, a blocked syscall -- the lease can expire, a new holder can be granted it, and then the old holder
resumes execution still believing it is the leader. It has no way to know time passed. This is not a hypothetical;
it is the single most common cause of "impossible" duplicate-processing bugs.

Two defences. The holder should **self-check before acting**: compare its own monotonic clock against its lease
expiry and refuse to act if it is within a safety margin. And -- crucially -- the *resource* must enforce a fencing
token.` },

    { t: 'h', text: 'The fencing token argument' },
    { t: 'diagram',
      code: `sequenceDiagram
  participant C1 as Client 1
  participant L as Lease service
  participant C2 as Client 2
  participant S as Storage
  C1->>L: acquire lease, get token 33
  Note over C1: GC pause, 25 seconds
  L->>L: lease expires
  C2->>L: acquire lease, get token 34
  C2->>S: write with token 34
  S->>S: record highest token = 34
  C1->>S: resumes, writes with token 33
  S--xC1: REJECT, 33 < 34`,
      caption: 'Without the token check at the storage layer, Client 1 overwrites Client 2 and neither ever sees an error.' },
    { t: 'prose',
      md: `**Any lock that does not hand out a monotonically increasing token, and whose protected resource does not reject
stale tokens, is unsafe.** That is a strong claim and it holds, because no amount of care on the client side can
detect an arbitrary pause. The only place the stale write can be stopped is at the thing being written to.

etcd gives you this as the lease's revision number; ZooKeeper as the \`zxid\` or the sequential znode number; Kafka
as the leader epoch; Postgres as a version column you can put in a \`WHERE version = $1\` clause. The important part
is not which system provides the number -- it is that the *write path* compares it. If your storage is S3 with no
conditional-write support, or a filesystem, or an API that does not accept a version, then you do not have a safe
lock and you should design for idempotency instead.` },
    { t: 'code',
      lang: 'sql',
      title: 'Fencing with nothing more exotic than a version column',
      code: `-- The lease holder learns its token when it acquires leadership.
-- Every write it performs carries that token.

UPDATE shard_assignments
   SET owner = $1,
       fence_token = $2,           -- monotonically increasing, from etcd revision
       updated_at = now()
 WHERE shard_id = $3
   AND fence_token < $2;           -- the entire safety property lives here

-- 0 rows affected means you are a zombie leader. Do not retry.
-- Log it, stop processing, and exit so the orchestrator restarts you clean.

-- Same shape for optimistic concurrency without a lease at all:
UPDATE orders SET status = 'shipped', version = version + 1
 WHERE id = $1 AND version = $2;` },

    { t: 'h', text: 'Redlock, fairly presented' },
    { t: 'prose',
      md: `Redlock is an algorithm for distributed locking across N independent Redis instances: acquire the lock on a majority
within a bounded time, and you hold it. It is widely deployed and the argument about it is worth knowing because it
is really an argument about what locks are *for*.

Martin Kleppmann's critique is that Redlock relies on bounded clock drift and bounded process pauses for its safety,
and neither is guaranteed. A GC pause or a clock jump from an NTP step can cause two clients to believe they hold
the lock simultaneously, and because Redlock issues no fencing token, the protected resource cannot reject the
loser. So for *correctness* -- cases where two holders cause data corruption or double-spend -- Redlock is not
sufficient.

Salvatore Sanfilippo's response is that Redlock's assumptions are explicit and reasonable for the use case it
targets: efficiency locks, where the lock exists to avoid doing duplicate work, not to prevent corruption. If two
workers occasionally rebuild the same cache entry, you have wasted CPU, not corrupted data. He also notes that any
algorithm layered on a system without conditional writes has the same limitation.

Both are right about different things, and the honest resolution is a question rather than a verdict: **what happens
if two holders run at once?** If the answer is "wasted work", a Redis lock with a TTL is pragmatic and fine. If the
answer is "duplicate charge" or "corrupted file", you need a consensus system for the lease *and* a fencing check at
the resource -- or better, you need to remove the requirement for mutual exclusion entirely by making the operation
idempotent.` },

    { t: 'h', text: 'Idempotency: the cheaper alternative' },
    { t: 'prose',
      md: `Most distributed-locking requirements dissolve under the question "why does running twice hurt?" If you can make the
operation safe to run any number of times, you do not need mutual exclusion, which means you do not need consensus,
which means you have removed a failure domain rather than added one.

The mechanism is a client-supplied idempotency key with a uniqueness constraint enforced by the one store that can
serialise it. Stripe's API is the canonical example: you send \`Idempotency-Key: idem_9f3ac1\`, and a retry with the
same key returns the original response rather than charging again.` },
    { t: 'code',
      lang: 'sql',
      title: 'An idempotency table that replaces a distributed lock',
      code: `CREATE TABLE idempotency_keys (
  key            text PRIMARY KEY,
  request_hash   text NOT NULL,      -- detect key reuse with a different body
  status         text NOT NULL,      -- 'in_progress' | 'completed'
  response_body  jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  locked_until   timestamptz         -- so a crashed in-flight request is retryable
);

-- Claim the key and do the work in ONE transaction with the side effect.
BEGIN;
  INSERT INTO idempotency_keys (key, request_hash, status, locked_until)
  VALUES ($1, $2, 'in_progress', now() + interval '30 seconds')
  ON CONFLICT (key) DO NOTHING;
  -- 0 rows inserted: someone else owns it. Either return their stored response
  -- or reply 409 and let the client retry -- never proceed.

  INSERT INTO charges (...) VALUES (...);    -- the actual effect

  UPDATE idempotency_keys
     SET status = 'completed', response_body = $3
   WHERE key = $1;
COMMIT;

-- Retention matters: keep keys for at least as long as your longest client
-- retry window, typically 24h, then expire them.` },

    { t: 'h', text: 'Clocks, and why "just use timestamps" loses data' },
    { t: 'prose',
      md: `Every distributed-systems bug involving time comes from one of two mistakes: treating wall-clock time as ordered
across machines, or measuring elapsed time with a clock that can jump.

**Wall clock** (\`CLOCK_REALTIME\`, \`Date.now()\`) tracks civil time and is corrected by NTP. Typical
NTP-synchronised drift within a datacentre is single-digit milliseconds, but NTP can *step* the clock backwards, and
a misconfigured or unreachable NTP server can leave a host hundreds of milliseconds or even seconds off. It is
correct for "when did this happen" and wrong for everything else.

**Monotonic clock** (\`CLOCK_MONOTONIC\`, \`performance.now()\`) only ever moves forward and is immune to NTP
adjustments, but is meaningless across machines and resets on reboot. It is the only correct choice for timeouts,
lease self-checks, and duration measurement.

Now the data-loss argument. In a last-write-wins multi-leader or leaderless store, the surviving version is the one
with the larger timestamp. If node A's clock is 250 ms ahead, a write made on A *before* a write made on B can still
carry a larger timestamp, so B's genuinely newer write is silently discarded. There is no error, no conflict, no log
line. Cassandra's LWW behaves exactly this way, which is why concurrent updates to the same column from different
coordinators are hazardous.` },
    { t: 'table',
      title: 'Clock mechanisms and what they buy',
      cols: ['Mechanism', 'What it orders', 'Cost / requirement', 'Used by'],
      rows: [
        ['NTP wall clock', 'Nothing reliably -- skew is unbounded in practice', 'Free', 'LWW conflict resolution (badly)'],
        ['Lamport clock', 'Causally related events only; concurrent events are ordered arbitrarily but consistently', 'A counter per node, piggybacked on messages', 'Logical ordering, version numbers'],
        ['Version vector', 'Detects concurrency instead of hiding it -- can say "these two conflict"', 'O(nodes) metadata per key', 'Riak, DynamoDB sibling detection'],
        ['Hybrid Logical Clock', 'Causality, with values close to real time so they are human-readable', 'A few bytes per event, no special hardware', 'CockroachDB, YugabyteDB, MongoDB'],
        ['TrueTime', 'Real-time order with a bounded uncertainty interval (~1-7 ms)', 'GPS and atomic clocks in every datacentre', 'Google Spanner -- it *waits out* the uncertainty before committing']
      ] },
    { t: 'prose',
      md: `Spanner is instructive because it shows the price of real external consistency: it does not eliminate clock
uncertainty, it *measures* it and then deliberately sleeps for the width of the uncertainty interval before
acknowledging a commit. Correct global ordering costs a few milliseconds of intentional waiting plus atomic clocks
in every datacentre. If you do not have that hardware, HLCs give you causal ordering with timestamps that are still
roughly meaningful to a human reading a log, which is the practical sweet spot.` },

    { t: 'h', text: 'etcd, ZooKeeper and Consul in practice' },
    { t: 'table',
      cols: ['System', 'Protocol', 'Primitive you actually use', 'Typical role'],
      rows: [
        ['**etcd**', 'Raft', 'Key-value with leases, `Txn` compare-and-swap, `Watch` streams', 'Kubernetes control plane, shard maps, leader election'],
        ['**ZooKeeper**', 'ZAB', 'Ephemeral + sequential znodes, watches', 'Kafka (pre-KRaft), HBase, legacy Hadoop stacks'],
        ['**Consul**', 'Raft', 'Sessions with health checks, KV, service catalog', 'Service discovery plus locking in HashiCorp shops'],
        ['**Postgres advisory lock**', 'None -- single writer', '`pg_try_advisory_lock(key)`', 'Anything already protected by one database. Usually the right answer.']
      ] },
    { t: 'note',
      tone: 'danger',
      title: 'These clusters are your most dangerous dependency',
      md: `A Raft cluster stops accepting writes the moment it cannot reach a majority. Put a 3-node etcd cluster in one AZ and
that AZ's failure freezes every controller depending on it. Spread it across three AZs and every write pays inter-AZ
latency. Keep the data small -- etcd's default database limit is 2 GB and it is not a general-purpose store -- and
never put it on the request path of user traffic. Kubernetes puts etcd behind the API server for exactly this
reason: the control plane can be down while the data plane keeps serving.` },

    { t: 'h', text: 'Trade-offs' },
    { t: 'tradeoffs',
      gains: [
        'At most one leader per term, provably, so split-brain becomes impossible rather than unlikely.',
        'An agreed total order for a log, which makes state machine replication straightforward.',
        'Survives any minority failing with no data loss and no human intervention.',
        'Leases give you automatic recovery from a dead holder without a human deciding it is dead.',
        'A watch-based shard or config map lets topology change without a deploy.'
      ],
      costs: [
        'Every write costs a majority round trip plus fsync -- roughly 1-5 ms same-region, far worse cross-region.',
        'Write availability *decreases*: losing a majority freezes the cluster by design.',
        'You have added a new operational system with its own upgrades, backups and failure modes.',
        'Correct usage requires fencing tokens enforced at the resource, which most teams omit.',
        'Throughput ceiling is one leader, so it does not scale by adding nodes -- more nodes is slower.',
        'Debugging is hard: terms, epochs and log indices are not intuitive during an incident.'
      ] },
    { t: 'failures',
      items: [
        { mode: 'Zombie leader after a long GC pause', blast: 'Two workers process the same queue or write the same rows; duplicate side effects with no error anywhere.', fix: 'Monotonically increasing fencing token rejected at the storage layer, plus a holder-side monotonic-clock check with a safety margin before acting.' },
        { mode: 'Redis `SETNX` lock without a TTL', blast: 'Holder crashes, lock is held forever, the protected job never runs again until someone deletes a key by hand.', fix: 'Always a TTL, renewed by the holder; treat expiry as the normal path and make the work idempotent.' },
        { mode: 'Redis lock TTL shorter than the work', blast: 'Lock expires mid-job, a second worker starts, both run concurrently -- the exact thing the lock existed to prevent.', fix: 'Renew from a watchdog while working, and fence at the resource so the slow first worker cannot commit.' },
        { mode: 'etcd cluster loses quorum', blast: 'All leader elections and config updates freeze; controllers stop reconciling; no new deploys.', fix: 'Spread members across 3 AZs, use 5 members, alert on quorum health and Raft leader changes, and keep etcd off the user request path.' },
        { mode: 'Even-numbered cluster size', blast: 'A 4-node cluster still tolerates only one failure, and a 2-2 partition means no side can make progress.', fix: 'Always odd -- 3 or 5. Use a learner/non-voting member if you need a fourth copy for reads.' },
        { mode: 'NTP step causes LWW to discard a newer write', blast: 'Silent data loss with no conflict recorded; the user\'s edit simply does not exist.', fix: 'Hybrid logical clocks or version vectors so concurrency is detected rather than resolved by a skewed number.' },
        { mode: 'Timeout measured with wall-clock time', blast: 'An NTP correction makes a 30-second timeout fire instantly or never; retry logic behaves randomly.', fix: 'Use the monotonic clock for every duration; reserve wall clock for display and audit timestamps.' }
      ] },

    { t: 'staff',
      md: `This topic separates candidates faster than almost any other, because the naive answer -- "use a distributed lock"
-- is both extremely common and usually wrong. What a strong candidate says:

- "Before I add a lock, what breaks if this runs twice? If the answer is duplicated work, a
  Redis lease with a TTL is fine. If the answer is a double charge, a lock is the wrong tool and
  I want an idempotency key with a unique constraint in the payments database."
- "Any lock without a monotonically increasing fencing token is unsafe, and the check has to
  happen at the resource. A 25-second GC pause is indistinguishable from death, so the paused
  holder will wake up and write. No amount of client-side care fixes that -- only the storage
  layer rejecting a stale token does."
- "The resource here is a single Postgres database, so Postgres is already my consensus system.
  \`pg_try_advisory_lock\` plus a \`WHERE version = $1\` is safer than etcd, because it does not
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
- "\`Date.now()\` for a timeout is a bug waiting for an NTP step. Monotonic clock for durations,
  wall clock only for display. And last-write-wins on wall clocks means a 250 ms skew silently
  eats a genuinely newer write."

The meta-signal: a strong candidate spends the first thirty seconds trying to *remove* the need for coordination,
and only then discusses how to do it safely. Reaching for etcd immediately reads as pattern-matching rather than
engineering.` },

    { t: 'quiz',
      items: [
        {
          q: 'A worker acquires a 30-second Redis lock, pauses for 40 seconds in GC, then writes to S3. A second worker acquired the lock and already wrote. What prevents corruption?',
          options: ['A longer lock TTL.', 'Nothing in this design -- the write needs to carry a fencing token that the storage layer rejects if stale.', 'Checking the lock is still held just before writing.', 'Redlock across five Redis instances.'],
          answer: 1,
          why: 'A longer TTL moves the window without closing it, and checking the lock before writing does not help because the pause can happen between the check and the write. Redlock has the same gap -- it issues no token. The only place the stale write can be stopped is at the resource: hand out a monotonically increasing token with the lease and have the destination reject anything lower than the highest it has seen. If your destination cannot do conditional writes, design for idempotency rather than mutual exclusion.' },
        {
          q: 'Why does growing a Raft cluster from 3 nodes to 4 not improve fault tolerance?',
          options: ['It does -- 4 nodes tolerate 2 failures.', 'A majority of 4 is 3, so you still only tolerate one failure, and a 2-2 split stalls both halves.', 'Raft only supports 3 or 5 nodes.', 'The fourth node becomes a read-only learner automatically.'],
          answer: 1,
          why: 'Fault tolerance is `floor((N-1)/2)`: 1 for both N=3 and N=4, 2 for N=5. The fourth node adds replication cost and one more thing to fail while adding no tolerance, and it makes an even split possible where neither side has a majority. Always use odd counts; if you want an extra copy for reads or geographic coverage, add a non-voting learner so it does not affect quorum arithmetic.' },
        {
          q: 'You need exactly one of five API replicas to run a nightly reconciliation job against your Postgres database. Simplest safe design?',
          options: ['A 3-node etcd cluster with a lease and a watch.', '`pg_try_advisory_lock` in the same Postgres database, with the job doing idempotent upserts.', 'A Redis `SETNX` lock with a 24-hour TTL.', 'Have all five run it and deduplicate afterwards.'],
          answer: 1,
          why: 'The resource you are protecting is the database itself, so the database can serialise access -- an advisory lock is free, requires no new system, and releases automatically when the connection drops. etcd works but adds an operational dependency and a second failure domain for no benefit. A 24-hour Redis TTL means one crash blocks the job for a day. Making the job idempotent on top means even a double-run is harmless, which is the belt-and-braces a Staff answer includes.' },
        {
          q: 'In a last-write-wins store, node A\'s clock is 250 ms ahead of node B\'s. What is the practical consequence?',
          options: ['Writes are delayed by 250 ms.', 'A write made on A before a later write on B can win, silently discarding the newer data.', 'The cluster refuses writes until NTP resynchronises.', 'Only read latency is affected.'],
          answer: 1,
          why: 'LWW compares timestamps generated on different machines, so clock skew directly reorders causally later writes behind earlier ones. There is no conflict recorded and no error surfaced -- the losing write simply never existed. This is why version vectors (detect concurrency, surface siblings) or hybrid logical clocks (preserve causality) exist, and why Spanner needs atomic clocks plus a deliberate commit-wait to offer real external consistency.'
        }
      ] },

    { t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{ t: 'prose',
        md: `Leader election and fencing are what make the failover story in **Replication & Consistency Models** safe. The shard
map from **Sharding & Partitioning** typically lives in etcd and must be fenced by version. Idempotency keys as a
lock replacement connect directly to **API Design & Contracts** and to the consumer-side dedupe store in
**Event-Driven Architecture, Sagas & CQRS**. Kafka's leader epoch is the same fencing idea applied to partitions --
see **Queues & Event Streaming**.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why does a majority quorum make Raft safe?', a: 'Any two majorities of the same cluster share at least one node, and a voter only supports a candidate whose log is at least as current as its own. So any future leader has spoken to a node that saw every committed entry -- a committed entry can never be lost.' },
    { q: 'How many failures does an N-node Raft cluster tolerate?', a: '`floor((N-1)/2)`. Three nodes tolerate one, five tolerate two, and four still tolerate only one -- even counts add cost and an even-split risk without adding tolerance.' },
    { q: 'What is a fencing token and why is it mandatory?', a: 'A monotonically increasing number issued with each lease, carried on every write, and compared by the *resource*, which rejects anything lower than the highest it has seen. It is the only defence against a holder that was paused long enough for its lease to expire.' },
    { q: 'Why is Redlock contested?', a: 'It depends on bounded clock drift and bounded process pauses for safety, and it issues no fencing token, so a paused client can write after losing the lock. It is reasonable for efficiency locks (avoid duplicate work) and insufficient for correctness locks (prevent corruption).' },
    { q: 'When should you use an idempotency key instead of a distributed lock?', a: 'Whenever you can make the operation safe to repeat. A unique constraint on a client-supplied key in the database that already owns the data is cheaper, has no extra failure domain, and stays correct under arbitrary retries and pauses.' },
    { q: 'Monotonic clock vs wall clock -- when to use each?', a: 'Monotonic (`CLOCK_MONOTONIC`) for all durations, timeouts and lease self-checks, because it never jumps. Wall clock (`CLOCK_REALTIME`) only for display and audit timestamps, because NTP can step it forwards or backwards.' },
    { q: 'What does a Hybrid Logical Clock give you over a Lamport clock?', a: 'The same causal-ordering guarantee, but with values that stay close to physical time, so timestamps are meaningful to a human reading a log and comparable to wall-clock events. Used by CockroachDB and YugabyteDB.' },
    { q: 'What does Spanner do about clock uncertainty?', a: 'It measures it rather than ignoring it: TrueTime returns an interval with bounded error (~1-7 ms), and a commit deliberately waits out that interval before acknowledging, which is what buys external consistency. The cost is GPS and atomic clocks in every datacentre.' },
    { q: 'Why keep etcd off the user request path?', a: 'A Raft cluster stops accepting writes when it cannot reach a majority, so its availability is deliberately lower than a single node\'s. Kubernetes puts it behind the API server so the control plane can be down while the data plane keeps serving traffic.' }
  ],

  drills: [
    {
      prompt: 'Your platform runs a fleet of 40 stateless workers that each poll for batch jobs. A job must be executed by exactly one worker; jobs take 2-30 minutes and write results to S3 and to Postgres. The current design uses a Redis `SETNX` lock with a 5-minute TTL, and you are seeing roughly two duplicate executions per week. Redesign it.',
      probes: [
        'Which specific mechanism produces the duplicates you are seeing?',
        'What happens to your design when a worker pauses for 40 seconds in GC?',
        'S3 and Postgres have very different capabilities here -- does that change your answer?',
        'Would you reach for etcd, and what would it cost you?',
        'How do you make a duplicate execution harmless rather than merely rare?'
      ],
      strong: [
        'Identifies the immediate cause as jobs outliving the 5-minute TTL, so the lock expires mid-execution and a second worker legitimately acquires it.',
        'States that extending the TTL only moves the window, and that a watchdog renewal plus an arbitrary pause still leaves the zombie-writer case open.',
        'Proposes a lease with a fencing token and enforces it where it can be enforced: a `WHERE fence_token < $1` guard on the Postgres write, and versioned/keyed S3 object names so a stale writer cannot clobber the winner.',
        'Notes that plain S3 has no compare-and-set, so the design must make the S3 write idempotent by key rather than mutually exclusive.',
        'Reframes toward a claim-based design: a `jobs` table with `UPDATE ... SET owner, attempt = attempt + 1 WHERE status = \'pending\' RETURNING` so the database is the lock, plus a visibility timeout and an attempt counter.',
        'Makes the result write idempotent so a duplicate execution is wasted CPU rather than corrupted output, and says explicitly that this is the real fix.'
      ],
      weak: [
        'Raises the TTL to 30 minutes and considers the problem solved.',
        'Proposes Redlock across five Redis nodes without mentioning that it still issues no fencing token.',
        'Adds etcd without discussing the new quorum dependency or what happens when it loses majority.',
        'Never asks what a duplicate execution actually damages.',
        'Assumes a lock can guarantee mutual exclusion against a process that can be paused arbitrarily.'
      ] },
    {
      prompt: 'A team proposes storing per-user session state in a 5-node etcd cluster because "it is strongly consistent and we already run it for Kubernetes". Traffic is 12,000 requests per second, each needing a session read and occasionally a write. Evaluate.',
      probes: [
        'What is the throughput model of a Raft cluster, and does it scale with node count?',
        'What happens to your API when etcd loses quorum during an AZ event?',
        'Does this workload need linearisability at all?',
        'What would you use instead, and what do you give up?'
      ],
      strong: [
        'Explains that all writes funnel through a single leader and cost a majority round trip plus fsync, so adding nodes makes it slower, not faster.',
        'Notes etcd\'s small intended data size (default 2 GB backend limit) and that it is a coordination store, not a session store.',
        'Points out that sharing the Kubernetes etcd cluster couples the data plane to the control plane -- exactly the coupling Kubernetes is designed to avoid.',
        'Argues session state does not need linearisability: a stale session read for a few milliseconds is harmless, so Redis with a TTL or a signed cookie is the right tool.',
        'Quantifies the availability argument: a quorum loss makes the API hard-down, whereas a Redis outage with signed-cookie fallback degrades instead.'
      ],
      weak: [
        'Agrees because "strong consistency is better".',
        'Objects only on the grounds of cost, with no mention of quorum availability or single-leader throughput.',
        'Suggests scaling etcd horizontally by adding members.',
        'Does not question whether the workload needs strong consistency at all.'
      ]
    }
  ]
};
