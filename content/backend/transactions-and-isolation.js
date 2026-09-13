export default {
  blocks: [
    {
      t: 'prose',
      md: `A transaction is a promise that a group of reads and writes behaves as though nothing
else were running at the same time, and as though the machine never crashes halfway. Both halves
of that promise are expensive, so databases offer it in grades. You pick a grade by choosing an
isolation level, and what you are really choosing is *which specific wrong answers you are willing
to receive*.

Almost nobody chooses deliberately. The default in Postgres and MySQL is not serialisable, which
means your application is already living with anomalies -- and the interesting question is whether
you know which ones.`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `Two things go wrong the moment more than one thing happens at once. Concurrent
transactions can observe each other's half-finished work, and a crash can leave a multi-step
change partly applied.

The naive fix for the first is a single global lock: one transaction at a time, perfect isolation,
and throughput of one. Every isolation level is an attempt to allow more concurrency than that
while still hiding the interleaving well enough for application code to be correct. The fix for
the second is the write-ahead log: record the intent durably before touching the data pages, so
recovery can either finish or undo whatever was in flight.

The reason this topic is worth real study is that the failures are *silent*. A lost update does
not raise an error. Write skew does not raise an error. You discover them when the accounting does
not balance, or when two people are on call for the same shift.`
    },

    {
      t: 'numbers',
      title: 'Numbers to keep in mind',
      items: [
        { v: '1 s', k: 'Postgres `deadlock_timeout` default', note: 'How long before the cycle is detected' },
        { v: '40001', k: 'SQLSTATE for serialization failure', note: '`40P01` is deadlock -- both retryable' },
        { v: '~200 M', k: 'Transaction ids left before wraparound protection', note: 'At which point writes are refused' },
        { v: '~2.5x', k: 'Scan cost on a 60%-dead-tuple table', note: 'You read past every dead version' },
        { v: 'milliseconds', k: 'Target transaction duration', note: 'Not seconds, and never a network call' }
      ]
    },

    { t: 'h', text: 'ACID, precisely' },
    {
      t: 'table',
      cols: ['Property', 'What it actually guarantees', 'What it does not', 'Mechanism'],
      rows: [
        ['**Atomicity**', 'All writes in the transaction apply, or none do -- including after a crash', 'Nothing about concurrent visibility', 'Undo log or MVCC versions plus WAL'],
        ['**Consistency**', 'Declared constraints hold at commit: keys, checks, foreign keys', 'Your business invariants, unless you declared them', 'Constraint checking at statement or commit time'],
        ['**Isolation**', 'Only what the chosen level promises -- usually *not* full serialisability', 'That concurrent transactions cannot interfere', 'Locks, MVCC snapshots, or SSI conflict tracking'],
        ['**Durability**', 'A committed transaction survives process and OS crash', 'Survival of disk loss, or that replicas have it', 'WAL flushed with `fsync` before acknowledging commit']
      ]
    },
    {
      t: 'prose',
      md: `The two words people over-read are Consistency and Durability. **Consistency** in ACID is
narrow: it means the database will not let you violate constraints *you declared*. "A user's
balance never goes negative" is a consistency property only if it is a \`CHECK\` constraint;
otherwise it is a hope that lives in application code and has no protection at all.

**Durability** is exactly as strong as your \`fsync\` configuration. Postgres with
\`synchronous_commit = off\` acknowledges commits before the WAL reaches disk, which buys real
throughput and loses up to \`wal_writer_delay\` worth of committed transactions in a crash. That is
a legitimate choice for analytics ingest and an indefensible one for payments. And durability on
the primary says nothing about replicas: with asynchronous replication a committed transaction can
vanish when a failover promotes a follower that never received it. \`synchronous_commit =
remote_apply\` with a synchronous standby closes that gap and costs you a network round trip on
every commit.`
    },

    { t: 'h', text: 'MVCC: how Postgres avoids readers blocking writers' },
    {
      t: 'prose',
      md: `Postgres never overwrites a row in place. Every tuple carries \`xmin\` -- the transaction
id that created it -- and \`xmax\` -- the transaction id that deleted or superseded it. An
\`UPDATE\` is physically an insert of a new tuple plus setting \`xmax\` on the old one. A
\`DELETE\` just sets \`xmax\`.

When a transaction starts (or, at Read Committed, when each statement starts) it takes a
**snapshot**: the current transaction id plus the set of transaction ids currently in progress. A
tuple is visible to that snapshot if its \`xmin\` committed before the snapshot was taken and its
\`xmax\` is either unset or belongs to a transaction that had not committed. That single rule is
why readers never block writers and writers never block readers in Postgres -- they are simply
looking at different versions of the same row.`
    },
    {
      t: 'diagram',
      code: `sequenceDiagram
  participant A as Session A
  participant D as Heap plus WAL
  participant B as Session B
  A->>D: BEGIN then UPDATE accounts id=1
  Note over D: old tuple xmax=A<br/>new tuple xmin=A
  B->>D: SELECT balance WHERE id=1
  D-->>B: old version, 5000
  Note over B: not blocked<br/>A is uncommitted
  A->>D: COMMIT
  B->>D: SELECT again, fresh snapshot
  D-->>B: new version, 4900
  Note over D: old tuple now dead<br/>autovacuum must reclaim it`,
      caption: 'Readers and writers never block each other because they read different versions. The dead tuple left behind is the cost, and vacuum can only remove it once no snapshot could still need it.'
    },
    {
      t: 'code',
      lang: 'sql',
      title: 'Watching MVCC happen',
      code: `-- Session A
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
-- Nothing committed yet. Two physical tuples now exist for id=1.

-- Session B, meanwhile:
SELECT xmin, xmax, balance FROM accounts WHERE id = 1;
--  xmin  | xmax  | balance
-- -------+-------+---------
--  48120 | 48177 |    5000      <- old version, still visible to B
-- B sees 5000 and is not blocked for a microsecond.

-- Session A
COMMIT;
-- B's next statement (at Read Committed) takes a fresh snapshot and sees 4900.
-- The 5000 tuple is now dead: invisible to everyone, still occupying space.

-- The cost, made visible:
SELECT relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) AS pct_dead
  FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 5;`
    },
    {
      t: 'prose',
      md: `Dead tuples are the bill for this design. They occupy pages, they are still referenced by
every index, and they must be read past during scans -- so a table that is 60% dead tuples has
scans roughly 2.5x more expensive than they should be. **Autovacuum** reclaims them, but it can
only remove a version once *no snapshot in the system could still need it*.

That last clause is the one that causes production incidents. A single idle transaction that ran
\`BEGIN; SELECT 1;\` two hours ago and never committed holds a snapshot, and autovacuum cannot
remove any tuple version newer than it -- on *any* table. Your bloat grows monotonically, index-only
scans degrade as the visibility map goes stale, and query plans change with no deploy. The
signature in monitoring is rising \`n_dead_tup\` across unrelated tables at once, and the fix is to
find the offending session and set \`idle_in_transaction_session_timeout\`.

In the extreme this becomes a wraparound emergency: Postgres transaction ids are 32-bit, so if the
oldest unfrozen transaction gets within about 200 million of wrapping, the database refuses new
writes to protect itself. That is one of the very few ways a healthy-looking Postgres goes
read-only without warning, and long-running transactions are the usual cause.`
    },
    {
      t: 'note',
      tone: 'danger',
      title: 'The most damaging habit in application code',
      md: `Opening a transaction, then making an HTTP call, then writing. A 3-second downstream call
inside \`BEGIN\` holds a snapshot, holds any locks already taken, holds a pooled connection, and
blocks vacuum for the entire fleet -- and at 200 rps that is 600 concurrent open transactions. The
rule worth stating in a design review: **no network I/O inside a transaction**. Gather your inputs
first, then open the transaction, write, and commit. Transactions should be milliseconds long.`
    },

    { t: 'h', text: 'The anomalies, and which level permits them' },
    {
      t: 'table',
      title: 'What each isolation level actually allows',
      cols: ['Anomaly', 'Read Uncommitted', 'Read Committed', 'Repeatable Read (snapshot)', 'Serializable'],
      rows: [
        ['**Dirty read** -- see another transaction\'s uncommitted write', 'Possible', 'Prevented', 'Prevented', 'Prevented'],
        ['**Lost update** -- read-modify-write clobbers a concurrent write', 'Possible', 'Possible', 'Prevented in Postgres (error); prevented in MySQL by row locks', 'Prevented'],
        ['**Non-repeatable read** -- same row read twice, different values', 'Possible', 'Possible', 'Prevented', 'Prevented'],
        ['**Phantom read** -- same range query returns new rows', 'Possible', 'Possible', 'Prevented for reads; MySQL uses gap locks for writes', 'Prevented'],
        ['**Read skew** -- two rows read at inconsistent points in time', 'Possible', 'Possible', 'Prevented', 'Prevented'],
        ['**Write skew** -- two transactions read the same set, write disjoint rows, jointly break an invariant', 'Possible', 'Possible', '**Possible** -- the important gap', 'Prevented'],
        ['Performance cost', 'None (Postgres does not implement it)', 'Baseline', 'Slightly higher; snapshot held longer', 'Serialization failures you must retry']
      ]
    },
    {
      t: 'prose',
      md: `**Write skew** is the anomaly that matters at Staff level, because it is the one snapshot
isolation does not stop and the one that looks safe in code review. The canonical example: a
hospital requires at least one doctor on call. Two doctors both open the app, both run
\`SELECT count(*) FROM on_call WHERE shift = 'sat'\` and both see 2, both conclude that removing
themselves is fine, and both commit \`DELETE\`. Neither transaction wrote a row the other read, so
no version conflict exists, and snapshot isolation permits both. The shift now has zero doctors.

The same shape appears everywhere once you recognise it: two transfers each checking that the
balance stays positive, two bookings each checking a meeting room is free, two processes each
claiming the last unit of inventory. The defining feature is a **read-then-write on different
rows, where the decision depends on the read**.

Your three options are all legitimate. Promote to Serializable and retry on failure. Materialise
the conflict -- take an explicit lock on a row that represents the invariant, such as the shift
row itself, so the two transactions now do conflict. Or express the invariant as a database
constraint, which is the most robust answer when it is possible (a unique index on
\`(room_id, time_slot)\` makes double-booking physically impossible regardless of isolation level).`
    },

    { t: 'h', text: 'Why "Repeatable Read" means different things' },
    {
      t: 'prose',
      md: `The SQL standard defines isolation levels by which anomalies they forbid, which means two
engines can both be "compliant" and behave differently. Repeatable Read is the worst offender.

**Postgres Repeatable Read** is snapshot isolation: one snapshot taken at the first statement,
held for the whole transaction. If you try to update a row that another transaction modified and
committed after your snapshot, you get \`ERROR: could not serialize access due to concurrent
update\` (SQLSTATE 40001) and the transaction aborts. So lost updates are impossible, but you must
handle the error. Write skew remains possible.

**MySQL InnoDB Repeatable Read** also takes a consistent snapshot for plain reads, but locking
reads -- \`SELECT ... FOR UPDATE\`, and the reads performed internally by \`UPDATE\` and
\`DELETE\` -- read the *latest committed* version, not your snapshot. This is sometimes called a
"half-consistent read". The consequence is bizarre the first time you see it: \`SELECT balance\`
returns 5000 from your snapshot, and then \`UPDATE accounts SET balance = balance - 100\` computes
from 4900, the current value. It does not raise an error; it silently mixes two points in time.
InnoDB also uses **gap locks** at this level to prevent phantoms for locking reads, which is why
MySQL deadlocks often involve ranges nobody thought they had locked.

The practical consequence: \`UPDATE ... SET x = x - 1\` is safe from lost updates on both engines
because the database re-reads the row under lock. But *read in application code, compute, write
back* is unsafe on MySQL RR (silently) and produces a retryable error on Postgres RR. Different
bugs, same code.`
    },
    {
      t: 'table',
      cols: ['Behaviour', 'Postgres Repeatable Read', 'MySQL InnoDB Repeatable Read'],
      rows: [
        ['Snapshot for plain `SELECT`', 'Transaction-wide, taken at first statement', 'Transaction-wide, taken at first statement'],
        ['`SELECT ... FOR UPDATE` sees', 'The snapshot; errors if the row changed', 'The latest committed row, not the snapshot'],
        ['Concurrent update to the same row', '`40001` serialization failure -- you retry', 'Blocks, then proceeds against current data'],
        ['Phantom prevention for writes', 'Via snapshot; predicate conflicts only at Serializable', 'Gap and next-key locks'],
        ['Write skew', 'Possible', 'Possible (gap locks help in some shapes)'],
        ['What you must code for', 'Retry on `40001`', 'Awareness that locking reads break snapshot semantics']
      ]
    },

    { t: 'h', text: 'Serializable Snapshot Isolation and the retry loop' },
    {
      t: 'prose',
      md: `Postgres implements \`SERIALIZABLE\` as **Serializable Snapshot Isolation**: optimistic
rather than lock-based. Transactions run on snapshots as usual, but the database tracks read and
write dependencies between them using predicate locks (SIREAD locks, which do not block anything)
and looks for a dangerous structure in the dependency graph -- specifically a transaction that
both read data another wrote and had its own reads made stale. When it finds one, one transaction
is aborted with \`40001\`.

The important consequences for application design. Nothing blocks, so throughput under low
conflict is close to Repeatable Read. Aborts are *not* bugs -- they are the mechanism, and any
application using Serializable must have a retry loop or it is simply broken under load. Because
detection is conservative, you get false positives: transactions that would have been fine are
aborted anyway, and the rate rises with conflict density. And a sequential scan escalates to a
relation-level predicate lock, so a missing index can turn an isolated conflict into a fleet-wide
abort storm.

CockroachDB runs Serializable by default for related reasons, and its documentation makes the same
demand: handle \`40001\` and retry.`
    },
    {
      t: 'code',
      lang: 'javascript',
      title: 'The retry loop Serializable requires',
      code: `const RETRYABLE = new Set([
  '40001',  // serialization_failure
  '40P01'   // deadlock_detected
]);

async function inSerializableTx(fn, { attempts = 5 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const out = await fn(client);           // no network I/O in here
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (!RETRYABLE.has(err.code) || i === attempts - 1) throw err;
      // Full jitter: without it, conflicting transactions retry in lockstep
      // and collide again at the same instant.
      const backoff = Math.random() * Math.min(200, 10 * 2 ** i);
      await sleep(backoff);
      metrics.increment('tx.serialization_retry', { attempt: i });
    } finally {
      client.release();
    }
  }
}`
    },
    {
      t: 'note',
      tone: 'warn',
      md: `The retry must re-run the *whole* transaction including the reads, because the aborted
transaction's reads are exactly what turned out to be stale. Retrying only the failed statement
inside the same transaction is a no-op -- the transaction is already aborted -- and retrying with
cached values reintroduces the anomaly you were paying Serializable to avoid.

Also: if the work is not idempotent from the caller's perspective (it sends an email, it charges a
card), the retry loop must not span that side effect. Keep external effects outside the
transaction and drive them from a committed outbox row.`
    },

    { t: 'h', text: 'Pessimistic versus optimistic concurrency' },
    {
      t: 'prose',
      md: `When two requests genuinely contend for the same row, you either take a lock and make one
wait, or let both proceed and detect the collision at write time.

**Pessimistic** means \`SELECT ... FOR UPDATE\`: the row is locked for the rest of the
transaction, the second transaction blocks, and correctness is easy to reason about. The price is
that you now hold a lock while doing whatever comes next, so any slowness inside that window --
a slow query, a GC pause, a downstream call you promised not to make -- converts directly into a
queue of blocked transactions. Always pair it with \`NOWAIT\` or \`SKIP LOCKED\` or a
\`lock_timeout\` so the wait is bounded.

**Optimistic** means a version column: read the row with its version, compute, then write with
\`WHERE version = <the one I read>\`. If zero rows are updated, someone beat you, and you re-read
and retry. No locks are held while you think, so it is ideal when conflict is rare and the thinking
time is long -- editing a document, a form submission with a user in the loop. It degrades badly
under high contention, because everyone retries and most retries fail.

\`SKIP LOCKED\` deserves a special mention: it makes Postgres a perfectly reasonable job queue.
Each worker locks the next N unlocked rows and skips anything another worker holds, so workers never
block each other and no row is processed twice.`
    },
    {
      t: 'code',
      lang: 'sql',
      title: 'Three patterns, three contention profiles',
      code: `-- Pessimistic: bounded wait, explicit lock.
BEGIN;
SET LOCAL lock_timeout = '2s';
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;   -- blocks others
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
COMMIT;

-- Optimistic: no lock held while deciding; retry on zero rows affected.
SELECT id, content, version FROM documents WHERE id = 9;   -- version = 14
UPDATE documents
   SET content = $1, version = 15
 WHERE id = 9 AND version = 14;
-- rowCount = 0  =>  someone else committed version 15; re-read and merge.

-- Queue consumption: workers never block each other.
BEGIN;
SELECT id, payload FROM jobs
 WHERE state = 'ready' AND run_after <= now()
 ORDER BY run_after
 LIMIT 10
 FOR UPDATE SKIP LOCKED;
UPDATE jobs SET state = 'running' WHERE id = ANY($1);
COMMIT;

-- Best of all when it applies: let the database enforce the invariant.
ALTER TABLE accounts ADD CONSTRAINT balance_non_negative CHECK (balance >= 0);
CREATE UNIQUE INDEX ON bookings (room_id, slot);   -- double-booking impossible`
    },

    { t: 'h', text: 'Deadlocks' },
    {
      t: 'prose',
      md: `A deadlock needs nothing exotic: two transactions each holding a lock the other wants.
The database detects the cycle -- Postgres after \`deadlock_timeout\`, one second by default --
picks a victim, and aborts it with \`40P01\`. Detection is cheap and correct; the problem is that
one user's request failed.`
    },
    {
      t: 'code',
      lang: 'sql',
      title: 'A deadlock in eight statements',
      code: `-- T1: transfer 100 from account 1 to account 2
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;   -- holds lock on 1

                    -- T2: transfer 50 from account 2 to account 1
                    BEGIN;
                    UPDATE accounts SET balance = balance - 50 WHERE id = 2;  -- holds 2

UPDATE accounts SET balance = balance + 100 WHERE id = 2;   -- waits for T2
                    UPDATE accounts SET balance = balance + 50 WHERE id = 1;  -- waits for T1
-- Cycle. Postgres aborts one:
-- ERROR: deadlock detected
-- DETAIL: Process 1421 waits for ShareLock on transaction 48233; blocked by 1436.

-- The fix is consistent lock ordering. Always touch rows in a total order:
BEGIN;
SELECT id FROM accounts
 WHERE id IN (1, 2) ORDER BY id FOR UPDATE;     -- both transactions lock 1 then 2
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;`
      },
    {
      t: 'prose',
      md: `Ordering by a deterministic key -- sort the account ids, always lock the lower first --
eliminates this entire class, and it is the fix that scales to N rows. The other common sources are
less obvious. \`UPDATE ... WHERE status = 'x'\` acquires locks in whatever order the plan produces,
so two identical statements can take them in different orders. Foreign keys take locks on the
parent row, so inserting children of two parents in different orders deadlocks. And in MySQL RR,
gap locks mean two inserts into the same range can deadlock even though they touch different rows.

Operationally: log every deadlock with both statements (Postgres \`log_lock_waits = on\` plus the
deadlock detail is enough), treat a rising deadlock rate as a design signal rather than noise, and
retry \`40P01\` with the same jittered loop you use for \`40001\`.`
    },

    { t: 'h', text: 'Transaction boundaries in application code' },
    {
      t: 'prose',
      md: `Most transaction bugs are boundary bugs, not isolation bugs. Four rules cover the
majority of them.

Open the transaction as late as possible and commit as early as possible -- validate input, fetch
what you need, *then* \`BEGIN\`. Do no network I/O inside it, because you are holding a snapshot, a
connection and possibly locks. Do not wrap a whole HTTP request in a transaction by framework
default, which some ORMs will happily do for you. And make the boundary explicit in the code so a
reviewer can see it: a \`withTransaction(fn)\` helper that takes the connection as an argument is
much harder to misuse than an implicit ambient transaction, because it makes it obvious when
someone passes a different client inside.

The related trap is the transaction that spans a user's thinking time -- "lock the record while the
form is open". That is a lock held for minutes, and the answer is always optimistic concurrency
with a version column instead.`
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      title: 'Running Serializable instead of Read Committed',
      gains: [
        'Application code can assume no anomalies at all -- a large reduction in reasoning load.',
        'Write skew, lost updates and phantoms are all handled by the engine, not by convention.',
        'Invariants that span rows no longer need hand-rolled locking schemes.',
        'Under low conflict, throughput is close to snapshot isolation because SSI does not block.'
      ],
      costs: [
        'Every transaction needs a retry loop; without one the application is broken under load.',
        'False-positive aborts, and the rate grows with conflict density.',
        'Sequential scans escalate predicate locks to whole relations, so a missing index causes abort storms.',
        'Side effects must move outside the transaction, since it may run more than once.',
        'Latency becomes bimodal -- a retried transaction is at least twice the cost.',
        'Harder to reason about capacity: throughput can fall as offered load rises.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'Read-modify-write at Read Committed', blast: 'Lost updates. Two concurrent increments produce one; no error is raised and totals silently drift.', fix: 'In-place arithmetic (`SET x = x - 1`), `SELECT FOR UPDATE`, a version column, or Serializable with retry.' },
        { mode: 'Write skew on a cross-row invariant', blast: 'Zero doctors on call, double-booked room, inventory oversold. Snapshot isolation permits it by design.', fix: 'Serializable, or materialise the conflict by locking a row representing the invariant, or express it as a unique/check constraint.' },
        { mode: 'Serializable without a retry loop', blast: 'Random `40001` errors surfacing as 500s, worsening exactly as traffic rises.', fix: 'Wrap every transaction in a retry with full jitter; alert on retry rate, not just on error rate.' },
        { mode: 'Long-running or idle-in-transaction session', blast: 'Autovacuum blocked fleet-wide, bloat on unrelated tables, plan regressions, ultimately xid wraparound read-only mode.', fix: '`idle_in_transaction_session_timeout`, `statement_timeout`, and an alert on the oldest transaction age.' },
        { mode: 'Network call inside a transaction', blast: 'Locks and connections held for seconds; at 200 rps hundreds of open transactions and a pool exhaustion cascade.', fix: 'Fetch first, then `BEGIN`. Drive external effects from a committed outbox row.' },
        { mode: 'Inconsistent lock ordering across code paths', blast: 'Deadlock rate that grows superlinearly with traffic; failures concentrated on the hottest rows.', fix: '`ORDER BY id FOR UPDATE` to impose a total order; log both statements and treat the rate as a design defect.' },
        { mode: 'Relying on MySQL RR snapshot semantics for a locking read', blast: 'Silently mixes two points in time -- the `SELECT` shows 5000 while the `UPDATE` computes from 4900.', fix: 'Understand that locking reads bypass the snapshot; use in-place arithmetic or explicit `FOR UPDATE` before deciding.' },
        { mode: 'Lock held across user think time', blast: 'A single open form blocks other users for minutes; timeouts cascade into retries.', fix: 'Optimistic concurrency with a version column and a conflict-resolution UI.' }
      ]
    },

    {
      t: 'staff',
      md: `The distinguishing move is naming the specific anomaly and the specific defence, rather
than saying "we'd use a transaction".

- "Read Committed does not stop lost updates. If we read the balance in application code and write
it back, two concurrent debits produce one -- silently. I'd either do it in place with
\`SET balance = balance - $1\`, or take \`FOR UPDATE\`, or use a version column."
- "This is **write skew**: both transactions read the same set and write different rows, so
snapshot isolation sees no conflict. Three defences -- Serializable with a retry loop, materialise
the conflict by locking the shift row itself, or make it a unique constraint so the database
refuses it regardless of isolation level. I'd pick the constraint where the invariant fits one,
because it survives every future code path."
- "If we run Serializable we must handle \`40001\` and retry the *whole* transaction with jitter.
Aborts are the mechanism, not a bug. And I'd check for sequential scans inside those
transactions -- SSI escalates to relation-level predicate locks, so a missing index turns one
conflict into a fleet-wide abort storm."
- "Postgres and MySQL both call it Repeatable Read and they are not the same thing. Postgres gives
me a \`40001\`; MySQL lets a locking read see the latest committed row instead of my snapshot. The
same code is a retryable error on one and a silent wrong answer on the other."
- "The deadlocks are a lock-ordering problem, not a volume problem. Both paths touch the same two
rows in opposite orders. \`SELECT ... WHERE id IN (...) ORDER BY id FOR UPDATE\` imposes a total
order and removes the class."
- "The bloat is on tables that transaction never touched, which means something is holding an old
snapshot. I'd look for \`idle in transaction\` sessions before I look at autovacuum settings, and I
would set \`idle_in_transaction_session_timeout\` regardless."

What these signal: that you have debugged a silent data-integrity bug, that you know isolation
levels are named the same and behave differently, and that you treat transaction *duration* as an
operational property of the whole cluster rather than a local concern. Volunteering the constraint
option as preferable to the clever locking option is a particularly good sign -- it shows you
optimise for the code you have not written yet.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'Two concurrent requests each read `balance = 500`, subtract 100 in application code, and write 400. Both commit at Read Committed. What is the balance, and what is this called?',
          options: [
            '300 -- both writes apply.',
            '400 -- a lost update; one write silently overwrote the other.',
            'One transaction receives a serialization error.',
            '500 -- the second write is rejected.'
          ],
          answer: 1,
          why: 'Both read the same version, both computed 400, and the second `UPDATE` simply overwrote the first with no conflict to detect. Read Committed only promises you will not see uncommitted data; it says nothing about your read still being valid when you write. Doing the arithmetic in the database (`SET balance = balance - 100`) is safe because the row is re-read under lock, and `FOR UPDATE`, a version column, or Serializable each close the gap in a different way.'
        },
        {
          q: 'A rota system requires at least one engineer on call. Two engineers simultaneously check `count(*) = 2` and each remove themselves, under Postgres Repeatable Read. What happens?',
          options: [
            'One gets a serialization failure -- snapshot isolation detects the conflict.',
            'Both succeed and the shift has zero engineers; this is write skew.',
            'A deadlock occurs and one is aborted.',
            'The second read sees 1 and the removal is blocked.'
          ],
          answer: 1,
          why: 'Each transaction deleted a row the other did not read or write, so there is no version conflict for snapshot isolation to find -- the conflict is between one transaction\'s write and the other\'s *predicate*, which only Serializable tracks. Fixes are to run Serializable and retry, to lock a row representing the shift so the transactions genuinely conflict, or to encode the invariant as a constraint the database can enforce.'
        },
        {
          q: 'A Postgres table shows steadily rising `n_dead_tup` and slowing sequential scans, and so do several unrelated tables. Autovacuum is running and configured normally. Most likely cause?',
          options: [
            'Autovacuum needs more workers.',
            'A long-running or idle-in-transaction session is holding an old snapshot, so no newer tuple version can be removed anywhere.',
            'The tables need `REINDEX`.',
            '`fillfactor` is too high.'
          ],
          answer: 1,
          why: 'Vacuum may only reclaim a version once no existing snapshot could still need it, so one forgotten `BEGIN` pins the horizon for the entire cluster and bloat accumulates on tables that session never touched -- which is exactly the fleet-wide signature. Query `pg_stat_activity` for `state = \'idle in transaction\'` ordered by `xact_start`, and set `idle_in_transaction_session_timeout` so it cannot happen unattended. Left long enough this escalates to transaction-id wraparound, which forces the database read-only.'
        },
        {
          q: 'Why must a Serializable retry re-execute the whole transaction rather than just the failing statement?',
          options: [
            'Because Postgres caches the statement plan.',
            'Because the aborted transaction\'s reads are precisely what became stale, so the decisions built on them must be recomputed.',
            'Because the connection is closed on abort.',
            'Because locks are only released at commit.'
          ],
          answer: 1,
          why: 'SSI aborts a transaction when its reads can no longer be reconciled with concurrent commits into any serial order. Re-running only the write reuses the stale values that caused the abort, reproducing the very anomaly the isolation level exists to prevent -- and mechanically the transaction is already aborted, so no statement can succeed within it. This is also why side effects such as charging a card must live outside the retried block.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `Dead tuples, the visibility map and index-only scans continue in **Databases, Indexes
& Query Plans**. Moving external side effects out of the transaction is the outbox pattern in
**Event-Driven Architecture, Sagas & CQRS**, which also covers what replaces a transaction when
the writes span services. Committing on the primary and reading a replica reintroduces anomalies
at a different layer -- see **Replication & Consistency Models**. And the idempotency-key design in
**API Design & Contracts** depends directly on the transaction boundary rules here.`
      }]
    }
  ],

  flashcards: [
    { q: 'What does the C in ACID actually guarantee?', a: 'Only that constraints you declared -- keys, checks, foreign keys -- hold at commit. A business invariant such as "balance never goes negative" is protected only if it is an actual `CHECK` constraint.' },
    { q: 'Explain MVCC visibility in Postgres via xmin and xmax.', a: 'Each tuple records the creating transaction (`xmin`) and the deleting/superseding one (`xmax`). A snapshot sees a tuple if `xmin` committed before the snapshot and `xmax` is unset or uncommitted. Readers and writers therefore never block each other.' },
    { q: 'Why can one idle transaction bloat your whole database?', a: 'Vacuum can only remove a tuple version once no live snapshot could need it. An old snapshot pins that horizon cluster-wide, so dead tuples accumulate on tables the session never touched, and index-only scans degrade as the visibility map goes stale.' },
    { q: 'What is write skew, and why does snapshot isolation permit it?', a: 'Two transactions read the same set, then write *different* rows, jointly breaking an invariant. No transaction writes a row the other read, so there is no version conflict to detect -- only Serializable tracks predicate conflicts.' },
    { q: 'Three ways to defend against write skew?', a: 'Run Serializable and retry `40001`; materialise the conflict by locking a row that represents the invariant; or encode the invariant as a unique or check constraint so it holds regardless of isolation level.' },
    { q: 'How does Postgres Repeatable Read differ from MySQL InnoDB Repeatable Read?', a: 'Postgres raises `40001` if you update a row changed since your snapshot. MySQL lets locking reads (`FOR UPDATE`, and the internal reads of `UPDATE`/`DELETE`) see the latest committed row instead of your snapshot, mixing two points in time silently. MySQL also uses gap locks to block phantoms.' },
    { q: 'What is SSI and what does it demand from the application?', a: 'Serializable Snapshot Isolation detects dangerous read/write dependency structures using non-blocking predicate locks and aborts one transaction with `40001`. The application must retry the entire transaction with jitter; aborts are the mechanism, not a bug.' },
    { q: 'When is optimistic concurrency better than `SELECT FOR UPDATE`?', a: 'When conflicts are rare and the decision takes a long time -- a user editing a form. No lock is held while thinking. It degrades under high contention, where a bounded pessimistic lock is better.' },
    { q: 'What removes a whole class of deadlocks?', a: 'Consistent lock ordering -- acquire rows in a deterministic total order, e.g. `WHERE id IN (...) ORDER BY id FOR UPDATE`, so two transactions can never hold locks the other needs in the opposite order.' }
  ],

  drills: [
    {
      prompt: 'A wallet service at 600 writes/s reports that roughly one in 50,000 balance updates is wrong -- the total does not match the ledger of transactions. There are no errors in the logs, isolation is the Postgres default, and the code reads the balance, computes the new value in Node, and writes it back. Diagnose, fix, and say how you would prove the fix worked.',
      probes: [
        'Why are there no errors, given the data is wrong?',
        'Which isolation level would turn this into an error instead of a silent loss?',
        'Rank your options: in-place arithmetic, `FOR UPDATE`, version column, Serializable.',
        'How would you detect any recurrence automatically?',
        'What if the balance update must also insert a ledger row and call a fraud service?'
      ],
      strong: [
        'Names lost update at Read Committed and explains why no conflict is detectable.',
        'Computes the plausibility: 1 in 50,000 at 600/s is consistent with a narrow race window.',
        'Prefers `SET balance = balance - $1` as the minimal correct fix and explains the row is re-read under lock.',
        'Notes a `CHECK (balance >= 0)` constraint as defence in depth independent of isolation.',
        'Proposes a continuous invariant check comparing ledger sum to balance, alerting on drift.',
        'Moves the fraud-service call outside the transaction, driven by an outbox row.',
        'Explains what Repeatable Read would change -- a `40001` instead of silence -- and that it needs a retry loop.'
      ],
      weak: [
        'Blames the application language or floating point without examining the concurrency.',
        'Proposes Serializable with no retry loop.',
        'Adds `FOR UPDATE` while keeping the fraud-service call inside the transaction.',
        'Says "add a transaction" when a transaction already exists.',
        'Offers no way to verify the fix beyond "monitor errors".'
      ]
    },
    {
      prompt: 'A booking service moved to `SERIALIZABLE` last month. Error rates were fine in staging but in production 4% of bookings now fail with `40001`, concentrated on a handful of popular venues, and the rate grows superlinearly with traffic. There is a retry loop with three attempts and no backoff. What is happening and what do you change?',
      probes: [
        'Why superlinear rather than linear in traffic?',
        'What does a retry loop with no jitter do to conflict rate?',
        'What in the query plan could be escalating the conflict scope?',
        'Would Repeatable Read plus an explicit lock be better here? What would you lose?',
        'How would you make the hottest venues not affect the rest?'
      ],
      strong: [
        'Identifies retry-without-jitter as a synchroniser that makes retries collide again.',
        'Explains that SSI false positives rise with conflict density, hence superlinear growth.',
        'Suspects a sequential scan inside the transaction escalating predicate locks to relation scope; proposes indexing the predicate.',
        'Considers narrowing the transaction: shorter, fewer reads, later BEGIN.',
        'Offers the materialise-the-conflict alternative -- lock the venue/slot row, or a unique index on `(venue_id, slot)` -- and states the trade-off versus Serializable.',
        'Adds full jitter, more attempts with a cap, and a metric on retries per transaction rather than just failures.',
        'Points out the skew: per-venue conflict rate, not global, is the metric to alert on.'
      ],
      weak: [
        'Reverts to Read Committed without noting which anomalies return.',
        'Raises the retry count without adding jitter.',
        'Treats `40001` as a database bug or a capacity problem.',
        'Never considers the query plan or predicate lock escalation.',
        'Suggests a bigger instance.'
      ]
    }
  ]
};
