export default {
  blocks: [
    {
      t: 'prose',
      md: `News feed backend interviews fail in a predictable way: the candidate draws Kafka in the
middle, arrows to "timeline service," and cannot explain **fanout** -- whether you push posts into
each follower's inbox at write time or pull and merge at read time. The mechanism that decides Staff
is the **celebrity problem** (one author, 50M followers), what you actually store in the timeline
(Redis list vs Cassandra wide rows), and the separation between **ranking** (scoring) and **fanout**
(delivery). Kafka is the durable write path; it is almost never the read path. This page is those
decisions with numbers, not a message-bus tutorial.`
    },

    { t: 'h', text: 'Push vs pull fanout' },
    {
      t: 'prose',
      md: `When user B posts, their followers need B's post in *some* structure they can read later.

**Push fanout (write-time):** On post create, enqueue a job per follower (or batch) that inserts
post id into each follower's timeline store. Read is O(k) where k is page size -- just read your
pre-built list. Twitter's classic "fanout on write" for normal users.

**Pull fanout (read-time):** Store posts only in the author's outbox. On read, fetch recent posts
from everyone you follow, merge, sort, paginate. Write is O(1); read is O(following count × posts
per author) -- expensive for users who follow 3,000 accounts.

**Hybrid (production default):** Push for users with < N followers (say 10,000); **pull-only for
celebrities** whose push would be 50M writes per post. Reader merges: pre-built timeline entries +
on-the-fly fetch from celebrity outboxes. The threshold is operational -- measure push job lag and
adjust N.

At **500M users**, even 0.1% celebrities break naive push. The hybrid is not a compromise; it is
the only architecture that survives both a normal user and @elon posting simultaneously.`
    },
    {
      t: 'diagram',
      code: `flowchart TB
  P["New post"] --> K["Kafka posts topic"]
  K --> W{"Author followers?"}
  W -->|"< 10k"| Push["Fanout worker: LPUSH timeline:userId"]
  W -->|">= 10k"| Out["Store in author outbox only"]
  R["Feed read"] --> T["Read user timeline list"]
  R --> M["Merge celebrity outboxes"]
  T --> Merge["Rank + dedupe + paginate"]
  M --> Merge
  Merge --> Resp["Return page"]`,
      caption: 'Kafka decouples post accept from fanout work. Celebrities skip push; readers merge at request time.'
    },
    {
      t: 'numbers',
      title: 'Fanout arithmetic',
      items: [
        { v: '50M', k: 'Celebrity follower count', note: 'Push = 50M writes per post -- minutes of lag' },
        { v: '10k', k: 'Typical push threshold', note: 'Above this, pull at read time' },
        { v: '~300', k: 'Median following count', note: 'Push cost per post for typical user' },
        { v: '500 bytes', k: 'Timeline entry', note: 'post_id + author_id + ts + type flags' },
        { v: '1-2 ms', k: 'Redis LRANGE 20 entries', note: 'Hot read path for materialised timeline' }
      ]
    },

    { t: 'h', text: 'Timeline store: Redis list vs Cassandra' },
    {
      t: 'prose',
      md: `The timeline is an ordered list of post ids (and minimal metadata) per user.

**Redis LIST (\`LPUSH\` + \`LTRIM\`):** Fanout worker does \`LPUSH timeline:{userId} entry\` and
\`LTRIM\` to keep last 800-1000 entries (~400 KB/user). Read: \`LRANGE 0 19\` in ~1 ms. Perfect
for **materialised push** timelines. Weaknesses: memory cost at scale (800 entries × 500M users is
not all hot -- tier by last-active), no durable history if Redis evicts (you still have post store
in Cassandra/Postgres), resharding pain on cluster hot users.

**Cassandra wide row (\`timeline_by_user\`):** Partition key \`user_id\`, clustering key
\`(bucket, post_id)\` where bucket = \`reverse_timestamp\` for time ordering. Push fanout writes
one row per follower; read fetches top-K columns. Durable, cheaper per GB, handles cold users.
Write amplification on celebrity push is the same logical problem -- hence hybrid fanout before you
choose Cassandra.

**Pattern:** Redis for **hot, active users** last 7 days of timeline; Cassandra (or Scylla) as
system of record; cold users rebuild timeline from Cassandra on next login or pull entirely from
outboxes. Do not store full post bodies in the timeline -- store ids, hydrate from post service on
read (batch \`MGET\` or single query \`WHERE id IN (...)\`).`
    },
    {
      t: 'table',
      cols: ['Store', 'Fanout write', 'Feed read', 'Durability', 'When'],
      rows: [
        ['Redis LIST', '`LPUSH` + `LTRIM` per follower', '`LRANGE` O(k)', 'Ephemeral unless AOF/replicate', 'Hot timelines, sub-ms reads, bounded depth'],
        ['Cassandra wide row', 'One insert per follower row', 'Top-K column slice', 'Durable, tunable consistency', 'All users SOR; cold timelines; audit'],
        ['Postgres (avoid)', 'B-tree insert per follower', 'Indexed scan + sort', 'Durable', 'Prototype only -- fanout crushes write IOPS'],
        ['Author outbox only', 'Single write', 'Multi-get at read', 'Durable', 'Celebrity path; small following lists on pull side']
      ]
    },

    { t: 'h', text: 'Celebrity / hot-key at read merge' },
    {
      t: 'prose',
      md: `Hybrid fanout means every feed read for a user following @celebrity does extra work: fetch
celebrity's last N posts from their outbox (cached aggressively). **Celebrity outbox** is a hot key
-- millions of readers query the same partition.

Mitigations:

- **CDN or edge cache** of celebrity recent posts (30-60 s TTL) -- posts are public, same for all readers.
- **Dedicated read replica** or **local cache** on feed servers: in-process LRU of top 50 posts per
celebrity, 5 s TTL.
- **Rank cache:** precompute "global top posts last hour" for injection into feeds, separate from
follow graph.

Celebrity **write** stays O(1) -- one outbox append. Cost moves to read, but read is parallelisable
and cacheable; write fanout of 50M is not.`
    },

    { t: 'h', text: 'Ranking vs fanout -- separate stages' },
    {
      t: 'prose',
      md: `**Fanout** answers: which post ids are *eligible* to appear in this user's feed.
**Ranking** answers: in what *order* should they appear.

Conflating them produces unmaintainable fanout workers that embed ML models. Production split:

1. **Candidate generation (fanout):** Timeline list + celebrity merge + optional "recommended from
non-followed" ids. Output: 200-500 candidate post ids.
2. **Ranking/scoring:** Feature store lookups (affinity, recency, engagement velocity, content
type), lightweight model or heuristic weights, sort, take top 20.
3. **Filtering:** Dedupe, remove blocked/muted, apply diversity rules (max 2 from same author).

Ranking can run **on read** for freshness (scores change as likes accrue) or on a **periodic
re-rank** job that rewrites Redis timeline order every 30-60 s for inactive scrollers. Real-time
"post just got 10k likes" injection uses a side channel (see frontend studio) not re-fanout.

Kafka carries **post.created** and **engagement.updated** events; ranker consumers update feature
stores, not user timelines directly for every like.`
    },
    {
      t: 'diagram',
      code: `sequenceDiagram
  participant API as Feed API
  participant TL as Timeline Redis
  participant OB as Celebrity outbox
  participant RK as Ranker
  participant PS as Post service
  API->>TL: LRANGE timeline user 0 199
  API->>OB: fetch cached celebrity posts
  API->>RK: score 250 candidates
  RK-->>API: ordered top 20 ids
  API->>PS: batch hydrate bodies
  PS-->>API: post payloads`,
      caption: 'Fanout produces candidates; ranker orders; hydration is a separate batch call. Kafka is not in this read path.'
    },

    { t: 'h', text: 'Unread vs materialised timeline' },
    {
      t: 'prose',
      md: `Two product concepts often confused:

**Materialised timeline:** The stored list of post ids (push fanout result). "What we think you
should see" bounded to last 800 entries. Cheap to read; stale until fanout completes (typically
100 ms -- 2 s after post).

**Unread pointer / badge count:** Separate metadata -- \`last_read_at\` or \`last_seen_post_id\` per
user. Unread = posts in materialised timeline with \`created_at > last_read_at\`. Do not recompute
by scanning all followees. Store \`unread_count\` denormalised, increment on fanout \`LPUSH\`,
decrement on feed open (batch update).

**Pull vs materialised for unread:** Mobile apps want "37 new posts" without shifting scroll
position -- that is a **client concern**, but backend must expose \`since_id\` or cursor based on
\`last_read_at\`, not offset pagination (inserts at top break \`OFFSET\`).

Optional **activity pub/sub** (WebSocket/SSE) pushes "new post available" signals; timeline body
still fetched via HTTP cursor. Kafka → notification service → Redis pub/sub channel per user session.`
    },

    { t: 'h', text: 'Kafka as write path, not read path' },
    {
      t: 'prose',
      md: `Kafka (or Pulsar) sits **after** the API accepts a post:

1. API validates, writes post to durable store (Cassandra/Postgres), publishes \`post.created\` to
Kafka, returns 201 to client.
2. **Fanout consumer group** reads partition keyed by \`author_id\`, pushes to follower timelines
(or skips celebrities).
3. **Search indexer**, **notification**, **ranking feature** consumers read same topic independently.

Why not read feed from Kafka? Consumer lag would directly become user-visible staleness; replay
semantics do not match "give me page 2"; and fanout already materialised the answer optimized for
read. Kafka is for **decoupling write side effects**, backpressure (fanout workers scale with lag),
and audit replay -- not serving \`GET /feed\`.

Partition by \`author_id\` so all posts from one user stay ordered in one partition for outbox
consistency. Fanout jobs can be a separate topic \`fanout.jobs\` with \`follower_id\` partitions to
parallelise per-user timeline writes.`
    },
    {
      t: 'code',
      lang: 'text',
      title: 'Write path vs read path',
      code: `# WRITE (accept post)
POST /posts -> insert post row -> produce post.created (author_id key) -> 201

# ASYNC (fanout consumer)
on post.created:
  if author.follower_count < PUSH_THRESHOLD:
    for batch in follower_ids.chunk(500):
      pipeline LPUSH timeline:{fid} entry; LTRIM; INCR unread:{fid}
  else:
    LPUSH outbox:{author_id} entry   # celebrity: one write

# READ (feed API -- no Kafka)
GET /feed?cursor=<last_post_id>
  candidates = LRANGE timeline:{me} + merge celebrity outboxes
  ranked = ranker.score(candidates)[:20]
  return hydrate(ranked), next_cursor`
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      title: 'Hybrid push-pull with Redis hot timelines vs pure pull',
      gains: [
        'Push gives O(k) reads for typical users following hundreds, not thousands of queries.',
        'Celebrity pull avoids 50M writes per post -- post goes live in <200 ms.',
        'Kafka decouples fanout lag from post accept -- API stays fast under spike.',
        'Separating rank from fanout lets you change scoring without rewriting timelines.',
        'Redis materialisation hits 1-2 ms read p99 for the common case.'
      ],
      costs: [
        'Hybrid complexity: two code paths, merge logic, and cache layers for celebrity outboxes.',
        'Push storage: 800 entries × active users -- memory and fanout worker fleet to provision.',
        'Eventual consistency: follower sees post 1-30 s after author if fanout queues lag.',
        'Rank-on-read adds 10-50 ms CPU per request unless candidate set is bounded.',
        'Rebuilding timeline on unfollow/block requires compaction jobs or tombstone entries.'
      ]
    },

    {
      t: 'failures',
      items: [
        { mode: 'Push fanout for celebrity account', blast: '50M LPUSH operations per post; fanout queue hours behind; post appears dead until merge pull catches up.', fix: 'Follower-count threshold; celebrities write outbox only; readers merge cached outbox at read time.' },
        { mode: 'Fanout consumer lag under viral post', blast: 'Normal users wait minutes for posts from non-celebrity friends; unread counts wrong.', fix: 'Scale consumer group with lag alert; priority queue for recent authors; cap timeline depth with LTRIM.' },
        { mode: 'Storing full post body in timeline list', blast: 'Memory 100x; hydration duplicates; edit/delete requires scanning all follower lists.', fix: 'Store post_id + metadata only; hydrate batch from post service; edits invalidate cache key.' },
        { mode: 'Ranking inside fanout worker', blast: 'Every scoring model change requires refanout or inconsistent order across users.', fix: 'Fanout writes chronological candidates; ranker runs on read or async re-rank job.' },
        { mode: 'Reading feed from Kafka tail', blast: 'Consumer lag = stale feed; pagination impossible; p99 read tied to broker latency.', fix: 'Materialise timeline in Redis/Cassandra; Kafka for write-side effects only.' },
        { mode: 'Offset pagination on feed', blast: 'New post at top shifts offsets; duplicate/missing items on page 2.', fix: 'Cursor on post_id or (timestamp, id) tuple; never OFFSET for infinite feeds.' }
      ]
    },

    {
      t: 'staff',
      md: `Separate **fanout** from **rank** in the first two minutes or the whiteboard is wrong.

- "For users under 10k followers I fanout on write: Kafka consumer LPUSHes into each follower's
Redis list, LTRIM to 800. Read is LRANGE 20 -- about 1 ms. For @celebrity with 50M followers I
write one outbox row and merge at read from a 5-second cached outbox slice."
- "Kafka is post.created → fanout workers. GET /feed never touches Kafka. If fanout lag is 30 seconds,
users see delay -- I alert on consumer lag, not broker uptime."
- "Timeline stores ids, not bodies. Hydrate 20 posts with one \`WHERE id IN\` or Redis MGET on
post:{id}. Edit post invalidates post cache; timeline entry is just a pointer."
- "Ranking takes 200 candidates from materialised list plus celebrity merge, scores with recency and
affinity features, returns 20. Changing weights does not refanout 500M timelines."
- "Unread is \`last_read_at\` pointer plus denormalised count incremented on LPUSH, not a second
fanout system."

The hire signal is naming the **50M writes** number before the interviewer draws the celebrity box.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'A user with 80M followers publishes a post. What should the fanout worker do?',
          options: [
            'LPUSH into 80M follower timeline lists in batches',
            'Append to the author outbox only; merge at read for followers',
            'Publish to a dedicated celebrity Kafka topic consumed by clients',
            'Skip storage; followers pull from search index'
          ],
          answer: 1,
          why: 'Push fanout is O(followers) writes. 80M Redis LPUSH operations per post creates hours of lag and overwhelms workers. Celebrity path stores one outbox entry; feed read merges recent celebrity posts from cache. Clients still use HTTP feed API, not Kafka directly.'
        },
        {
          q: 'Why should timeline entries store post_id rather than the full post body?',
          options: [
            'Post bodies are too large for Kafka messages',
            'Edits and deletes would require updating every follower copy; hydration lets a single post row be authoritative',
            'Redis cannot store strings larger than 512 bytes',
            'Ranking requires binary post format'
          ],
          answer: 1,
          why: 'Fanout copies a pointer per follower, not the content. Author edits post once; readers hydrate fresh body on read. Delete marks post row gone; timeline entries can lazy-filter missing ids. Storing bodies multiplies storage and creates stale copies across millions of lists.'
        },
        {
          q: 'Feed API p99 is 80 ms. Ranker adds 40 ms. Fanout already materialised timelines. Best first optimisation?',
          options: [
            'Move feed reads to Kafka log tail',
            'Cache ranked top-20 for inactive users 30 s; reduce candidate set from 500 to 150 before rank',
            'Switch from Redis to Postgres for timelines',
            'Push rank scoring into fanout LPUSH'
          ],
          answer: 1,
          why: 'Rank-on-read is the flexible but expensive stage. Caching ranked results for users not actively scrolling saves repeat work. Trimming candidates before ML scoring cuts feature lookups. Kafka read path worsens latency. Push ranking into fanout couples model changes to write amplification.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Concept topics this studio applies',
      blocks: [{
        t: 'prose',
        md: `Fanout write amplification and celebrity hot keys extend **Sharding & partitioning** and
**Server-side caching**. Kafka's role here matches **Queues & Streaming** -- durable write-side
effects, not serving reads. Timeline memory trade-offs connect to **Scalability & capacity
planning**. Sub-second celebrity outbox reads often use **CDN & Edge** caching for public posts.
Feed **cursor pagination** and unread semantics are specified in the companion **News feed
(frontend)** studio; **Web performance** budgets apply to hydrate batch size.`
      }]
    }
  ],

  flashcards: [
    { q: 'Push vs pull fanout -- when is each appropriate?', a: 'Push (write-time): insert post into each follower timeline -- O(k) read, expensive write. Good when followers < ~10k. Pull (read-time): merge followees outboxes on read -- O(1) write, expensive read. Hybrid: push normal users, pull celebrities with millions of followers.' },
    { q: 'What is the celebrity problem in feed fanout?', a: 'One author with tens of millions of followers makes push fanout tens of millions of writes per post, causing hours of lag. Solution: write only to author outbox; readers merge celebrity posts at read time with aggressive caching.' },
    { q: 'Redis LIST vs Cassandra for timelines?', a: 'Redis LPUSH/LRANGE gives sub-ms reads for hot materialised timelines but is memory-bound and ephemeral. Cassandra wide rows give durable per-user post lists at lower GB cost. Production uses Redis for active users, Cassandra as source of truth.' },
    { q: 'Why is Kafka not the feed read path?', a: 'Consumer lag becomes user-visible staleness; replay does not support cursor pagination; read p99 would depend on broker poll latency. Kafka decouples post accept from fanout, search, and notifications on the write side.' },
    { q: 'How do ranking and fanout differ?', a: 'Fanout decides candidate post ids eligible for a user (follow graph, outbox merge). Ranking scores and orders those candidates (recency, affinity, engagement). Mixing them forces refanout on every model change.' },
    { q: 'How is unread count maintained?', a: 'Denormalised counter incremented on fanout LPUSH to follower timeline; decremented or reset when user opens feed and updates last_read_at pointer. Not computed by scanning all sources on each badge render.' },
    { q: 'What breaks offset pagination in feeds?', a: 'New posts insert at the top constantly; OFFSET 20 skips or duplicates items when the list shifts between requests. Use cursor on (timestamp, post_id) or since_id instead.' }
  ],

  drills: [
    {
      prompt: 'Design the backend for a Twitter-scale home feed: 400M users, median 300 follows, top creator 100M followers, 200k posts/s globally, feed read 2M rps. Cover fanout, storage, ranking, and Kafka placement.',
      probes: [
        'Exact fanout strategy for 300-follow user vs 100M-follow creator',
        'What is stored per timeline entry and where',
        'Where ranking runs and with how many candidates',
        'What Kafka topics exist and what consumes them',
        'How soon after post does a typical follower see it'
      ],
      strong: [
        'Hybrid push under 10k followers; celebrity outbox only with cached read merge.',
        'Timeline: post_id + ts in Redis LTRIM 800 for MAU; Cassandra SOR; hydrate batch 20 bodies.',
        'Rank 200 candidates to 20 on read or 30s cache for idle users; features from Redis feature store.',
        'Kafka post.created → fanout, indexer, notifications; no Kafka on GET /feed.',
        'SLA: accept post <100ms; fanout p95 <2s for push users; celebrity visible immediately via outbox merge.',
        'Alerts on fanout consumer lag and celebrity outbox cache hit rate.'
      ],
      weak: [
        'Pure push for all users including celebrities.',
        'Full post JSON in every follower timeline.',
        'Feed read consumes Kafka directly.',
        'OFFSET pagination for infinite scroll.',
        'No distinction between fanout and ranking stages.'
      ]
    },
    {
      prompt: 'Fanout consumer lag spikes to 45 minutes after a sporting event. Users complain friends posts are missing but celebrities show up. Diagnose and fix.',
      probes: [
        'Why would celebrity content still appear?',
        'What metric proves fanout lag vs ranker slowness?',
        'Immediate mitigation vs permanent fix'
      ],
      strong: [
        'Celebries use outbox merge at read -- unaffected by fanout queue.',
        'Push fanout backlog causes delay for normal follow graph; check consumer lag metric per partition.',
        'Scale consumer replicas, temporarily raise push threshold, shed low-priority fanout (inactive users).',
        'Long-term: priority queues, autoscale on lag, cap batch fanout concurrency, dead-letter poison followers.',
        'Communicate eventual consistency window; do not block post accept.'
      ],
      weak: [
        'Blames Kafka broker without checking consumer group lag.',
        'Suggests disabling hybrid fanout entirely.',
        'Proposes synchronous fanout in POST handler.',
        'Does not explain why celebrity posts still visible.'
      ]
    }
  ]
};
