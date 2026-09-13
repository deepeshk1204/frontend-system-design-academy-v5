export default {
  blocks: [
    { t: 'prose',
      md: `A queue or a stream sits between a producer and a consumer so that the producer does not have to wait for the
consumer, and does not have to know who the consumers are. That decoupling is the whole value proposition, and
everything hard about messaging comes from the consequences of it: messages arrive out of order, arrive twice,
arrive much later than you expected, or sit in a backlog while your dashboards look fine.

The first real decision is not which broker. It is whether you want a **queue** -- where a message is consumed and
gone -- or a **log** -- where messages are retained and every consumer tracks its own position independently.` },

    { t: 'h', text: 'Why it exists' },
    { t: 'prose',
      md: `Consider a checkout endpoint that must charge a card, send a receipt, update inventory, notify the warehouse, and
index the order for search. Done synchronously, the user waits for the sum of five latencies and the request fails
if any one of the five is down. Your p99 is the p99 of your worst dependency, and your availability is the product
of five availabilities -- five services at 99.9% gives you 99.5%, which is about three and a half hours of downtime
a month you did not budget for.

Put a broker in the middle and the endpoint does one durable write and returns in 20 ms. The four downstream effects
happen when they happen, and a downstream outage becomes a growing backlog rather than a user-visible failure. You
have traded *immediate consistency* for *availability and latency*, and you have acquired a new job: knowing how far
behind you are.

The second reason is **buffering against bursts**. A traffic spike that would knock over a synchronous consumer
instead becomes queue depth, which is a number you can watch and a resource you can scale into. The queue converts a
reliability problem into a capacity problem, which is a much better kind of problem.` },

    { t: 'h', text: 'Queue vs log -- the decision that shapes everything else' },
    { t: 'diagram',
      code: `flowchart LR
  subgraph Q["Queue: RabbitMQ, SQS"]
    P1["Producer"] --> EX["Exchange /<br/>queue"]
    EX --> W1["Worker 1"]
    EX --> W2["Worker 2"]
    W1 -.->|ack, message gone| EX
  end
  subgraph L["Log: Kafka, Kinesis"]
    P2["Producer"] --> PA["Partition<br/>append-only"]
    PA --> CA["Group A<br/>offset 9120"]
    PA --> CB["Group B<br/>offset 4400"]
  end`,
      caption: 'In a queue the broker tracks which messages are outstanding. In a log the consumer tracks its own offset, so replay is free and a second consumer costs nothing.' },
    { t: 'prose',
      md: `That difference cascades into almost every operational property.

In a **queue**, the broker holds per-message state: delivered, acknowledged, redelivered. That gives you powerful
per-message control -- selective retry, per-message TTL, priority queues, and delayed delivery -- at the cost of the
broker doing bookkeeping proportional to message count. Consumers can scale to any number because work is
dispatched, not partitioned. But once a message is acknowledged, it is gone: if your consumer had a bug, the data is
unrecoverable.

In a **log**, the broker appends to an immutable sequence and each consumer group stores a single integer per
partition. Adding a new consumer group is free and does not affect existing ones, which is why Kafka became the
backbone for analytics, CDC and event sourcing. Replaying last Tuesday is \`seek(offset)\`. The price is that
parallelism is capped by partition count, ordering exists only within a partition, and one slow message blocks
everything behind it in that partition.` },
    { t: 'table',
      title: 'Brokers, honestly compared',
      cols: ['', 'Kafka', 'RabbitMQ', 'SQS (standard)', 'SNS + SQS', 'Google Pub/Sub', 'NATS JetStream'],
      rows: [
        ['Model', 'Partitioned log', 'Queue with routing', 'Queue', 'Fan-out to queues', 'Queue with log-ish replay', 'Log + queue hybrid'],
        ['Retention after consume', 'Yes -- time or size based', 'No', 'No (14 days max in-queue)', 'No', '7 days replay window', 'Configurable'],
        ['Ordering', 'Per partition', 'Per queue, lost on redelivery', '**None**', 'None', 'Per ordering key', 'Per subject/stream'],
        ['Throughput ceiling', 'Millions/sec, scales with partitions', '~10-50k/sec per queue', 'Effectively unlimited', 'Unlimited', 'Very high', 'Very high, low latency'],
        ['Replay', 'Native, cheap', 'Only via a DLQ dance', 'No', 'No', 'Within window', 'Native'],
        ['Per-message delay / priority', 'No', 'Yes', 'Delay yes, priority no', 'Delay yes', 'No', 'Limited'],
        ['Ops burden', 'High (or Confluent/MSK)', 'Medium', 'Zero', 'Zero', 'Zero', 'Low'],
        ['Reach for it when', 'Multiple consumers, replay, high volume, event sourcing', 'Complex routing, per-message control, RPC-ish work queues', 'You want a queue and no operational work', 'Fan-out to several independent teams', 'GCP-native fan-out with replay', 'Low latency, small footprint, edge']
      ] },
    { t: 'note',
      tone: 'info',
      title: 'SQS FIFO deserves its own line',
      md: `Standard SQS has *no* ordering and *at-least-once* delivery, which surprises people who assume "queue" implies
order. SQS FIFO gives ordering and deduplication within a \`MessageGroupId\` -- effectively a partition -- but caps
out around 300 API calls per second per group (3,000 with batching), which is a real constraint you must design the
group key around.` },

    { t: 'h', text: 'Kafka mechanics you are expected to know' },
    { t: 'prose',
      md: `A **topic** is a named stream, split into **partitions**. Each partition is an append-only file with a monotonically
increasing **offset** per message. The producer picks the partition -- by hashing the message key, or round-robin
when there is no key. That single choice determines your ordering and your hot-spotting, and it is the Kafka
equivalent of a shard key.

Each partition has one leader broker and \`replication.factor - 1\` followers. The **ISR** (in-sync replica set) is
the subset of replicas currently caught up within \`replica.lag.time.max.ms\`. A producer with \`acks=all\` waits
for every ISR member to persist the record -- and this is the crucial subtlety -- **which means \`acks=all\` alone
is not durable** if the ISR has shrunk to just the leader. You must also set \`min.insync.replicas=2\`, which makes
the broker reject the write rather than silently accepting a single-copy one.

A **consumer group** is a set of consumers sharing a group id. The broker assigns each partition to exactly one
consumer in the group, so the maximum useful parallelism of a group equals the partition count. Extra consumers sit
idle. When membership changes, a **rebalance** reassigns partitions.` },
    { t: 'code',
      lang: 'properties',
      title: 'The Kafka configuration that determines whether you lose data',
      code: `# --- Producer: durable, ordered, deduplicated at the broker ---
acks=all                          # wait for all in-sync replicas
enable.idempotence=true           # broker dedupes producer retries by (pid, seq)
max.in.flight.requests.per.connection=5   # safe up to 5 WITH idempotence on
retries=2147483647                # retry forever; delivery.timeout.ms is the real bound
delivery.timeout.ms=120000        # total budget including retries
compression.type=zstd             # 3-5x on JSON; cuts network and disk, costs CPU
linger.ms=10                      # batch for 10ms -- large throughput win, tiny latency cost

# --- Topic: without min.insync.replicas, acks=all can mean "one copy" ---
replication.factor=3
min.insync.replicas=2             # reject writes if fewer than 2 replicas are in sync
unclean.leader.election.enable=false   # never promote an out-of-sync replica; data loss

# --- Consumer: commit AFTER the side effect, never before ---
enable.auto.commit=false
isolation.level=read_committed    # skip records from aborted transactions
max.poll.records=100
max.poll.interval.ms=300000       # exceed this and you are kicked out mid-batch
session.timeout.ms=45000
heartbeat.interval.ms=3000
partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor` },
    { t: 'note',
      tone: 'danger',
      title: 'The two settings that cause real data loss',
      md: `\`unclean.leader.election.enable=true\` allows a replica that was *not* in the ISR to become leader when all ISR
members are down. It restores availability by throwing away every record the out-of-sync replica never received. And
\`acks=all\` without \`min.insync.replicas=2\` means that when the ISR shrinks to one, "all replicas acknowledged"
is satisfied by the leader alone -- and losing that broker loses the data. Both are defaults people never revisit.` },

    { t: 'h', text: 'Ordering is per partition, and that is the entire story' },
    { t: 'prose',
      md: `Kafka guarantees that messages within a partition are delivered in offset order. It guarantees *nothing* about order
across partitions. If you publish \`OrderCreated\` and \`OrderCancelled\` for the same order with no key, they land
on different partitions, get consumed by different threads, and the cancellation can be processed first.

So your key choice is a direct statement about what must stay ordered. Key by \`order_id\` and every event for one
order is ordered, while different orders proceed in parallel -- this is almost always the right granularity. Key by
\`user_id\` when per-user sequence matters. Use no key when order is genuinely irrelevant (metrics, click events)
and you want maximum spread.

The cost of a narrow key is skew. If 5% of your traffic is one tenant and you key by \`tenant_id\`, one partition
gets 5% of all traffic while others get a fraction, and you cannot fix it by adding partitions -- the hash still
sends that tenant to one place. This is the same celebrity-key problem as database sharding, with the same
mitigations: a composite key that adds a bucket suffix, at the cost of losing ordering within the tenant.` },
    { t: 'numbers',
      title: 'Partition-count arithmetic',
      items: [
        { v: '= partitions', k: 'Max consumers per group', note: 'Extra consumers idle; this is your parallelism ceiling' },
        { v: '~10 MB/s', k: 'Reasonable per-partition throughput', note: 'Plan partitions from target throughput, not vibes' },
        { v: '2-3x', k: 'Headroom multiplier on partition count', note: 'Increasing partitions later breaks key-to-partition mapping' },
        { v: '~4,000', k: 'Practical partition ceiling per broker', note: 'Each partition is open file handles plus controller metadata' }
      ] },
    { t: 'note',
      tone: 'warn',
      md: `You can add partitions to a topic but you can never remove them, and adding them **changes the key-to-partition
mapping** for all future messages. Records for key \`k\` that used to land on partition 3 now land on partition 7,
while the historical ones stay on 3. Any consumer relying on per-key ordering across that boundary is now wrong.
Over-provision partitions modestly at creation time instead -- it is the cheapest decision you will make.` },

    { t: 'h', text: 'Delivery semantics, without the marketing' },
    { t: 'table',
      cols: ['Semantic', 'Mechanism', 'What you risk', 'When it is correct'],
      rows: [
        ['**At most once**', 'Commit the offset before doing the work', 'Silent message loss on a crash mid-processing', 'Metrics, telemetry, anything where a gap is cheaper than a duplicate'],
        ['**At least once**', 'Do the work, then commit the offset', 'Duplicates on any crash between the two', '**The default you should design for.** Everything else is a refinement.'],
        ['**Effectively once**', 'At-least-once delivery plus an idempotent consumer', 'Nothing structural -- you own the dedupe store', 'Payments, inventory, anything with an external side effect'],
        ['**Exactly once (Kafka EOS)**', 'Idempotent producer plus transactional read-process-write within Kafka', 'Only holds when the side effect *is* a Kafka write plus an offset commit', 'Stream processing: Kafka in, Kafka out, e.g. Kafka Streams']
      ] },
    { t: 'prose',
      md: `Kafka's transactions are real and they do what they claim, but the claim is narrower than the phrase "exactly once"
suggests. A transaction atomically commits *a set of writes to Kafka topics and the consumer offsets*, so a
read-process-write loop entirely inside Kafka is atomic. The moment your side effect leaves Kafka -- an HTTP call, a
row in Postgres, an email -- the transaction cannot cover it. There is no two-phase commit between Kafka and Stripe.

Therefore: **consumer-side idempotency is not optional**, it is the actual mechanism, and Kafka transactions are an
optimisation for the special case where everything stays inside Kafka. The cheapest general implementation is a
dedupe table keyed on a stable message identity, written in the same database transaction as the effect.` },
    { t: 'code',
      lang: 'sql',
      title: 'Effectively-once consumer -- the dedupe and the effect in one transaction',
      code: `CREATE TABLE processed_messages (
  message_id   text PRIMARY KEY,      -- producer-supplied, stable across retries
  topic        text NOT NULL,
  partition    int  NOT NULL,
  offset_val   bigint NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON processed_messages (processed_at);   -- for the retention sweeper

-- Per message:
BEGIN;
  INSERT INTO processed_messages (message_id, topic, partition, offset_val)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (message_id) DO NOTHING;
  -- 0 rows: already handled. COMMIT and move on -- do NOT reprocess.

  UPDATE inventory SET qty = qty - $5 WHERE sku = $6;   -- the real effect
COMMIT;
-- Only now commit the Kafka offset. A crash before this replays the message,
-- which the ON CONFLICT makes harmless.

-- Retention: the table grows forever otherwise. Delete rows older than
-- your maximum replay window, typically topic retention + a safety margin.` },
    { t: 'prose',
      md: `Note the ordering: the effect and the dedupe record commit together, and the offset commits *after*. Any crash point
leaves you with either "nothing happened, message will replay" or "everything happened, replay is a no-op". Commit
the offset first and you have built at-most-once by accident.` },

    { t: 'h', text: 'Consumer lag: the one metric that matters' },
    { t: 'prose',
      md: `Lag is the difference between the partition's log-end offset and the consumer group's committed offset -- how many
messages you have not processed yet. It is the primary health signal for any streaming system, because it is the
only metric that directly reflects "are we keeping up".

Measure it two ways and use both. **Message lag** tells you the size of the backlog. **Time lag** -- the age of the
oldest unprocessed message -- tells you how stale your downstream state is, which is what a product owner actually
cares about. A lag of 2 million messages is fine if you drain 200,000 a second; a lag of 500 messages is an
emergency if each takes 30 seconds.

Alert on the *derivative*, not the absolute value. Lag that rises steadily for 10 minutes means your consumer
throughput is below your producer throughput, and the backlog will grow without bound until something changes. A lag
spike that drains on its own is a burst you absorbed successfully -- exactly what the queue is for -- and paging
someone for it trains them to ignore the alert.` },
    { t: 'numbers',
      title: 'Drain-time maths worth doing out loud',
      items: [
        { v: '4M msgs', k: 'Backlog after a 20-min outage', note: 'At a 3,300/sec produce rate' },
        { v: '1.7x', k: 'Consumer capacity needed to catch up', note: 'Drain in 30 min while still taking new traffic' },
        { v: '= partitions', k: 'Hard ceiling on catch-up scaling', note: 'You cannot add consumers past this' },
        { v: '~15 min', k: 'Typical time-lag alert threshold', note: 'Tune to what downstream staleness actually breaks' }
      ] },

    { t: 'h', text: 'Poison messages, DLQs and head-of-line blocking' },
    { t: 'prose',
      md: `A **poison message** is one your consumer cannot process -- malformed payload, a deserialisation failure against a
schema change, a referenced entity that was deleted. In a queue, a poison message is redelivered, fails, is
redelivered, and consumes your workers forever. In a partitioned log it is worse: if you retry it in place, **the
partition stops**. Every message behind it waits, lag on that one partition climbs while the other nineteen look
healthy, and your dashboards average it away. This is head-of-line blocking and it is the distinctive Kafka failure
mode.

You have three options and they are not equivalent. You can **retry in place** with backoff, which is correct only
when the failure is transient and ordering is essential -- and you must bound it. You can **skip and record**, which
preserves throughput and abandons the message. Or you can **divert to a dead-letter topic** after N attempts, which
preserves both throughput and the data.` },
    { t: 'diagram',
      code: `flowchart LR
  T["orders topic"] --> C["Consumer"]
  C -->|transient error| R1["orders.retry.5s"]
  R1 --> C
  C -->|still failing after 3| R2["orders.retry.5m"]
  R2 --> C
  C -->|permanent error| DLQ["orders.DLQ<br/>+ error, stack, headers"]
  DLQ --> I["Triage UI"]
  I -->|fixed code deployed| T
  C -->|success| DB[("State store")]`,
      caption: 'Tiered retry topics keep the main partition moving. The replay path back into the source topic is the part teams forget to build.' },
    { t: 'prose',
      md: `A dead-letter queue is only useful if you can get messages *out* of it, and this is where most implementations stop.
A DLQ needs: the original payload byte-for-byte, the original headers and key, the exception and stack trace, the
attempt count, the consumer version, and a replay tool that can push a selected subset back to the source topic with
the original key preserved. Without the replay tool, your DLQ is a graveyard with good documentation -- and the
first time you need it, during an incident, you will be writing a script under pressure.

Also alert on DLQ arrival *rate*. A DLQ with 40,000 messages that nobody noticed is a worse outcome than the
original failure, because you have now silently dropped a day of orders.` },

    { t: 'h', text: 'Rebalance storms and backpressure' },
    { t: 'prose',
      md: `When a consumer joins or leaves a group, partitions are reassigned. The classic "eager" protocol does this with a
**stop-the-world** step: every consumer revokes every partition, then the group re-forms. During that window nothing
is consumed, and if your processing takes a while the revocation itself takes a while. A **rebalance storm** is the
feedback loop where slow processing causes a member to miss \`max.poll.interval.ms\`, which triggers a rebalance,
which pauses everyone, which makes them slower, which triggers another. A group can spend more time rebalancing than
consuming.

Three fixes, in order of leverage. Use \`CooperativeStickyAssignor\`, which moves only the partitions that need to
move and leaves the rest running. Set \`max.poll.records\` low enough that a batch always completes well within
\`max.poll.interval.ms\` -- if each message takes 2 seconds and the interval is 300 seconds, 100 records is already
cutting it fine. And use static group membership (\`group.instance.id\`) so a rolling restart or a pod reschedule
does not trigger a reassignment at all during the configured session timeout.

**Backpressure** is the related question of what the producer does when consumers cannot keep up. In Kafka the
producer does not notice -- the log simply grows and the consumer falls behind, which is a deliberate design choice
and why retention is your real safety valve: hit the retention limit and unconsumed data is deleted, silently. In
RabbitMQ, queue length limits and publisher confirms can propagate pressure back to the producer, which is sometimes
what you want. The system-level answer is usually to shed or throttle at the edge rather than to let an unbounded
backlog build, because a backlog you cannot drain before retention expiry is equivalent to data loss with extra
steps.` },

    { t: 'h', text: 'Retention and compaction' },
    { t: 'prose',
      md: `Kafka offers two cleanup policies and they serve genuinely different purposes. \`cleanup.policy=delete\` with
\`retention.ms\` keeps a time or size window -- seven days is a common default -- and is right for event streams
where old events stop mattering. \`cleanup.policy=compact\` instead keeps, forever, the *most recent* value for each
key and garbage-collects the older ones. The result is a topic that is simultaneously a change stream and a full
snapshot of current state, which is how Kafka Connect stores offsets, how KRaft stores metadata, and how a CDC topic
can bootstrap a brand-new consumer to correct state without a separate backfill. A null value is a **tombstone**,
marking the key deleted, retained for \`delete.retention.ms\` so consumers have a chance to see it.

The operational trap is retention interacting with lag. If retention is 7 days and a consumer is 8 days behind, the
broker has deleted records the consumer never read, and on the next poll it gets an \`OffsetOutOfRange\` error.
Depending on \`auto.offset.reset\` it then silently jumps to the latest offset -- skipping everything -- or to the
earliest. Both are surprising, and the right answer is an alert well before that point, not a config choice.` },

    { t: 'h', text: 'Trade-offs' },
    { t: 'tradeoffs',
      gains: [
        'Producer latency and availability decouple from every consumer, so p99 stops being the worst dependency\'s p99.',
        'Bursts become queue depth -- a measurable, scalable resource instead of a cascade of 5xx responses.',
        'New consumers are free on a log: analytics, search indexing and audit can be added without touching the producer.',
        'Replay turns a consumer bug into "fix and reprocess" instead of "the data is gone".',
        'Natural fan-out to independent teams with independent failure and deployment cadence.'
      ],
      costs: [
        'Eventual consistency becomes a product concern -- the UI must show state that has not happened yet.',
        'Every consumer needs idempotency and a dedupe store, which is real code and real retention management.',
        'Debugging spans producer, broker and N consumers; without trace propagation through message headers it is guesswork.',
        'Ordering is partition-scoped, so your key choice is an irreversible design decision.',
        'A whole new operational surface: partitions, ISR, lag, rebalances, retention, DLQ triage.',
        'Kafka self-hosted is a genuine commitment -- ZooKeeper or KRaft, broker upgrades, rack awareness, disk planning.'
      ] },
    { t: 'failures',
      items: [
        { mode: 'Poison message retried in place forever', blast: 'One partition halts; lag climbs on 1 of 20 partitions while averaged dashboards look healthy.', fix: 'Bounded attempts, then tiered retry topics and a DLQ. Alert on per-partition lag, never on the group average.' },
        { mode: 'Consumer commits offsets before processing', blast: 'Silent message loss on every crash or deploy; nobody notices until a reconciliation months later.', fix: '`enable.auto.commit=false`; commit only after the effect and its dedupe row have committed together.' },
        { mode: 'Rebalance storm', blast: 'Group spends more time rebalancing than consuming; throughput collapses under a rolling restart.', fix: '`CooperativeStickyAssignor`, lower `max.poll.records`, raise `max.poll.interval.ms` to fit real batch time, and static `group.instance.id`.' },
        { mode: 'Retention expires before a lagging consumer catches up', blast: 'Permanent data loss plus an `OffsetOutOfRange` that silently skips to latest.', fix: 'Alert on lag against the retention horizon -- not just on absolute lag -- and set `auto.offset.reset=none` so it fails loudly.' },
        { mode: '`acks=all` with ISR shrunk to one replica', blast: 'Acknowledged writes lost when that single broker dies, with no error to the producer.', fix: '`min.insync.replicas=2` and `unclean.leader.election.enable=false`; alert when ISR size drops below the configured minimum.' },
        { mode: 'Hot partition from a skewed key', blast: 'One consumer saturated while the rest idle; adding consumers changes nothing.', fix: 'Composite key with a bucket suffix where per-key order can be relaxed, or route the whale tenant to its own topic.' },
        { mode: 'DLQ with no replay tooling or alert', blast: '40,000 orders sitting in a topic nobody watches; a day of revenue silently dropped.', fix: 'Alert on DLQ arrival rate, retain original key and headers, and build the replay tool before you need it at 3 a.m.' }
      ] },

    { t: 'staff',
      md: `The tell for a Staff-level answer is that delivery semantics and ordering are discussed as consequences of specific
configuration and key choices, not as adjectives. Sentences that carry weight:

- "I would key by \`order_id\`. Kafka only orders within a partition, so that gives me a strict
  sequence per order while different orders parallelise. Keying by \`tenant_id\` would be wrong
  here because one tenant is 5% of traffic and I cannot fix that partition by adding more."
- "I design for at-least-once and make the consumer idempotent. Kafka transactions are genuinely
  exactly-once, but only when the side effect is a Kafka write plus an offset commit -- there is
  no two-phase commit between Kafka and Stripe, so the dedupe table is the real mechanism."
- "\`acks=all\` is not sufficient on its own. If the ISR has shrunk to the leader, all in-sync
  replicas have acknowledged and you still have one copy. I want \`min.insync.replicas=2\` and
  \`unclean.leader.election.enable=false\`, and an alert on ISR shrink."
- "The order of operations is: effect and dedupe row in one database transaction, then commit the
  offset. Any crash leaves either a clean replay or a no-op. Committing the offset first is
  at-most-once by accident."
- "I alert on the slope of lag per partition, not on absolute lag for the group. A spike that
  drains is the queue doing its job. A steady climb for ten minutes means throughput is below
  produce rate and the backlog is unbounded. Group averages hide a single stalled partition."
- "Retention is 7 days, so my real alert is 'lag is within 24 hours of the retention horizon',
  because past that point the broker deletes data my consumer never saw and
  \`auto.offset.reset\` silently skips it."
- "A DLQ without a replay tool is a graveyard. I want the original key and headers preserved, the
  exception recorded, an alert on arrival rate, and a tool I have tested before the incident."
- "I would not use Kafka for this. It is 200 messages a second, one consumer, no replay
  requirement, and we are on AWS -- SQS with a DLQ is a config change instead of a cluster."

That last sentence matters as much as the others. Kafka is a significant operational commitment, and correctly
declining it is a senior judgement call.` },

    { t: 'quiz',
      items: [
        {
          q: 'Your consumer group has 4 members reading a topic with 3 partitions. Lag keeps growing. What happens if you scale to 8 consumers?',
          options: ['Throughput roughly doubles.', 'Nothing -- 3 consumers work and 5 sit idle, because a partition is assigned to at most one consumer per group.', 'Kafka splits partitions automatically to match.', 'The group rebalances into a round-robin across all 8.'],
          answer: 1,
          why: 'Partition count is a hard parallelism ceiling per consumer group: each partition goes to exactly one member, so members beyond the partition count consume nothing. Your options are to add partitions (which changes the key-to-partition mapping for new messages and can break per-key ordering across the boundary), make each message cheaper to process, or move to an internal work-distribution pattern where one consumer fans a partition out to a local worker pool -- at the cost of losing ordering.' },
        {
          q: 'A consumer does an HTTP call to a payment provider, then commits the offset. It crashes after the call but before the commit. What happens and what is the correct design?',
          options: ['Kafka rolls back the HTTP call.', 'The message replays and the payment is duplicated unless the consumer is idempotent, typically via a dedupe key committed with the effect.', 'The message is lost.', 'Enabling `enable.idempotence=true` on the producer prevents it.'],
          answer: 1,
          why: 'This is at-least-once delivery working exactly as designed, and no broker feature can undo an external side effect. Producer idempotence deduplicates *producer retries* at the broker; it says nothing about consumer replays. The fix is a stable message id recorded in your own database in the same transaction as the effect -- or an idempotency key passed to the payment provider so the duplicate call returns the original charge. Kafka transactions do not help because the side effect is outside Kafka.' },
        {
          q: 'One of 20 partitions has a message that throws on every attempt. Your consumer retries it indefinitely. What does the monitoring show?',
          options: ['Nothing unusual -- the other 19 partitions compensate.', 'Total group lag rises slowly while one partition stalls completely, so an averaged dashboard looks close to normal.', 'The broker automatically moves the message to a DLQ.', 'The consumer group rebalances to route around it.'],
          answer: 1,
          why: 'Retrying in place halts that partition entirely -- classic head-of-line blocking -- and 5% of your keys stop being processed. Group-level or averaged lag dilutes it by a factor of 20, which is why per-partition lag is the metric you alert on. The fix is bounded attempts, then a tiered retry topic or a DLQ, so the partition keeps moving and the problem message is preserved with enough context to replay.' },
        {
          q: 'What does `cleanup.policy=compact` give you that `delete` does not?',
          options: ['Better compression of message bodies.', 'The topic retains the latest value per key indefinitely, so it is both a change stream and a full current-state snapshot.', 'Automatic deduplication of identical messages.', 'Lower disk usage for all workloads.'],
          answer: 1,
          why: 'Compaction garbage-collects superseded values per key while keeping the newest one forever. That makes the topic self-bootstrapping: a brand-new consumer can read from the beginning and arrive at correct current state without a separate backfill, which is why Connect offsets, KRaft metadata and CDC topics use it. A null value is a tombstone marking deletion, retained for `delete.retention.ms` so consumers get a chance to observe it.'
        }
      ] },

    { t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{ t: 'prose',
        md: `The dual-write problem that makes you reach for a broker in the first place, and the outbox pattern that fixes it,
are in **Event-Driven Architecture, Sagas & CQRS**. Kafka's partition key is the same decision as a shard key -- see
**Sharding & Partitioning** -- and ISR plus \`min.insync.replicas\` are the quorum ideas from **Replication &
Consistency Models** applied to a log. The leader epoch is the fencing token from **Consensus, Leases & Distributed
Locks**. Consumer lag alerting and burn rates belong to **Observability, SLOs & Error Budgets**, and bounded queues
as a load-shedding mechanism are covered in **Resilience: Timeouts, Retries & Backpressure**.`
      }]
    }
  ],

  flashcards: [
    { q: 'Queue vs log, in one sentence each?', a: 'A queue has the broker track per-message delivery state and the message disappears on ack, enabling priority, delay and unbounded consumer scaling. A log is an immutable append-only sequence where each consumer group stores only an offset, making replay free and extra consumer groups cost nothing.' },
    { q: 'Why is `acks=all` insufficient for durability?', a: 'It waits for all *in-sync* replicas, and the ISR can shrink to just the leader. Then one acknowledgement equals one copy. You also need `min.insync.replicas=2` so the broker rejects the write, plus `unclean.leader.election.enable=false`.' },
    { q: 'What is the maximum useful parallelism of a Kafka consumer group?', a: 'The partition count. Each partition is assigned to exactly one consumer in the group, so additional consumers idle. Partition count is therefore a capacity decision made at topic creation, and adding partitions later changes key-to-partition mapping.' },
    { q: 'Why is consumer-side idempotency required even with Kafka transactions?', a: 'Kafka transactions atomically commit writes to Kafka topics plus the offsets. Any side effect outside Kafka -- an HTTP call, a Postgres row, an email -- is not covered, and there is no two-phase commit with an external system. So a dedupe store keyed on message identity is the actual mechanism.' },
    { q: 'Correct order of operations in an at-least-once consumer?', a: 'Write the effect and the dedupe row in one database transaction, then commit the Kafka offset. Any crash leaves either a harmless replay or a no-op. Committing the offset first silently builds at-most-once.' },
    { q: 'Why alert on the slope of consumer lag rather than its absolute value?', a: 'A lag spike that drains on its own is the queue absorbing a burst -- exactly its purpose -- and paging for it trains people to ignore the alert. Sustained growth means consumer throughput is below produce rate, so the backlog is unbounded and will eventually hit retention.' },
    { q: 'What is head-of-line blocking in a partition?', a: 'Retrying a failing message in place halts that partition, so every message behind it waits. With 20 partitions, 5% of keys stop being processed while group-averaged lag looks nearly normal. Fix with bounded attempts, tiered retry topics and a DLQ, and alert per partition.' },
    { q: 'What does log compaction give you?', a: 'The latest value per key retained indefinitely, with older values garbage-collected. The topic is simultaneously a change stream and a current-state snapshot, so new consumers bootstrap by reading from the beginning. Null values are tombstones marking deletion.' },
    { q: 'What causes a rebalance storm and how do you stop it?', a: 'Slow processing makes a member miss `max.poll.interval.ms`, triggering a rebalance that pauses the group and makes everyone slower. Fix with `CooperativeStickyAssignor`, a lower `max.poll.records`, an interval that fits real batch time, and static `group.instance.id`.' }
  ],

  drills: [
    {
      prompt: 'You own an order-processing pipeline: 3,000 orders/sec at peak into a Kafka topic with 24 partitions, consumed by a service that charges a card, writes to Postgres and calls a warehouse API. A bad deploy last week caused a 20-minute outage; afterwards some customers were charged twice and some orders were never fulfilled. Design the pipeline so neither can recur.',
      probes: [
        'Which specific consumer behaviour produced the double charges, and which produced the missing orders?',
        'What is your partition key, and what breaks if you pick the wrong one?',
        'How long does it take to drain the 3.6M-message backlog, and what is your ceiling?',
        'A message fails permanently because of a schema change -- trace exactly what happens.',
        'How would you have detected this before customer support did?'
      ],
      strong: [
        'Attributes double charges to at-least-once replay without consumer idempotency, and missing orders to either offset-commit-before-processing or in-place retries stalling a partition.',
        'Specifies a dedupe table keyed on a stable producer-supplied message id, inserted in the same Postgres transaction as the order row, with the offset committed only afterwards.',
        'Passes an idempotency key to the payment provider so the external effect is also deduplicated, and notes the dedupe table cannot protect a call made before the transaction commits.',
        'Chooses `order_id` as the partition key with an explicit reason -- per-order ordering, parallelism across orders -- and notes the skew risk of a tenant-level key.',
        'Does the drain arithmetic: 3.6M backlog at 3,000/sec produce rate needs roughly 1.7x capacity to clear in 30 minutes, and states that 24 partitions is the hard ceiling on consumers.',
        'Designs tiered retry topics plus a DLQ carrying original key, headers, exception and attempt count, with an alert on DLQ arrival rate and a pre-built replay tool.',
        'Alerts on per-partition lag slope and on lag relative to the retention horizon, not on group-average lag.'
      ],
      weak: [
        'Says "use exactly-once semantics" and treats Kafka transactions as covering the payment call.',
        'No dedupe store, or a dedupe check that runs outside the transaction that performs the effect.',
        'Ignores partition key choice entirely, or keys by something that destroys per-order ordering.',
        'Retries the poison message indefinitely in place and does not recognise head-of-line blocking.',
        'Monitors only group-level lag and misses that one stalled partition is invisible in the average.',
        'No drain-time estimate, so no idea whether the backlog will outlive retention.'
      ] },
    {
      prompt: 'A team wants to replace their SQS-based job queue with Kafka because "Kafka is the standard". The workload is 400 messages/sec, one consumer service, jobs take 1-90 seconds, some jobs must run 10 minutes after enqueue, and priority matters for paid customers. Evaluate the proposal.',
      probes: [
        'Which of their requirements does Kafka not natively support?',
        'What does the 90-second job duration do to their consumer configuration?',
        'Is there any requirement that genuinely argues for Kafka?',
        'What would you actually recommend?'
      ],
      strong: [
        'Identifies that delayed delivery and per-message priority are queue features Kafka does not provide, and that emulating them means delay topics and separate priority topics with their own starvation problems.',
        'Notes that 90-second jobs interact badly with `max.poll.interval.ms` and `max.poll.records`, risking rebalance storms unless tuned carefully.',
        'Points out that with one consumer and no replay requirement, the log model buys nothing while costing a cluster to operate.',
        'Recommends staying on SQS with a DLQ and visibility timeouts matched to job duration, or SQS FIFO if ordering is needed, and names the FIFO throughput cap per message group.',
        'States the condition that *would* justify Kafka -- several independent consumer groups, or a need to replay history -- so the decision has a documented revisit trigger.'
      ],
      weak: [
        'Agrees on the basis of scalability without checking the actual message rate.',
        'Does not notice that delay and priority are unsupported.',
        'Proposes Kafka plus a scheduler plus a priority router and calls it simple.',
        'Rejects Kafka on vague grounds without naming which requirements decide it.'
      ]
    }
  ]
};
