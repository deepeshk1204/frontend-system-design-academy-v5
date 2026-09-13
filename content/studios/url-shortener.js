export default {
  blocks: [
    {
      t: 'prose',
      md: `A URL shortener looks trivial until you name the constraint that actually decides the offer:
**a slug, once issued, must never resolve to a different destination.** That sounds like a data
integrity rule, but in production it collides with HTTP semantics, CDN caching, and key generation
at write QPS. The interview is not "hash the URL and store it" -- it is whether you can explain why
a 301 on \`/t/abc123\` turns slug reuse into a security incident, how you guarantee uniqueness at
~10,000 creates per second without a single global counter, and why analytics belongs on an async
path that never blocks the redirect.`
    },

    { t: 'h', text: '301 vs 302 -- the decision that outlives your deploy' },
    {
      t: 'prose',
      md: `Every redirect response carries a status code that tells intermediaries how aggressively
to remember it. **302 Found** (or 307) means "follow this *for now*." Browsers may cache it briefly;
CDNs typically will not treat it as permanent unless you explicitly misconfigure them. **301 Moved
Permanently** means "this slug *forever* maps here." Browsers cache 301 aggressively -- Chrome will
honour one for months without revalidating. CDNs cache 301 at the edge with \`Cache-Control\` implied
by permanence; many operators set multi-day or multi-year TTLs on redirect responses because it
saves origin load.

The staff-level trap: you ship 301 because "permanent redirect is what a short link *is*," then six
months later a user deletes their link, an admin reassigns slug \`abc123\` to a new campaign, and
millions of clients -- including CDN edges you cannot purge synchronously -- still redirect to the
old phishing URL. That is not a cache bug; you told the internet to remember forever.

**Default for a general-purpose shortener: 302 (or 307) on the redirect.** You pay one extra
round trip on repeat visits from clients that do not cache 302, which is acceptable at redirect
latency budgets (~5 ms from edge). You retain the ability to change, disable, or audit a slug.
Reserve 301 for links you *contractually* never change -- marketing vanity domains with legal review,
not user-generated slugs.

If product insists on 301 for SEO on public short links, the operational consequence is **no slug
recycling, ever.** Deleted slugs go to a tombstone table; reissue is a new slug. Custom aliases
require the same rule: once \`go.co/sale\` existed, that string is burned even if the campaign ended.`
    },
    {
      t: 'diagram',
      code: `sequenceDiagram
  participant U as User browser
  participant E as CDN edge
  participant O as Redirect origin
  U->>E: GET /t/abc123
  E->>O: cache miss
  O-->>E: 301 Location evil.com
  E-->>U: 301 Location evil.com
  Note over E: Edge caches 301 for days
  O-->>E: slug reassigned to bank.com
  U->>E: GET /t/abc123
  E-->>U: 301 Location evil.com
  Note over U,E: User never reaches origin again`,
      caption: '301 at the edge survives slug reassignment. The security incident is architectural, not a missed invalidation.'
    },

    { t: 'h', text: 'Key generation at ~10k writes/s' },
    {
      t: 'prose',
      md: `Three families of slug generation, and the trade-off is collision handling under load, not
encoding elegance.

**Hash of URL (Base62 of MD5/SHA truncated):** Deterministic -- same long URL always gets the same
slug, which is a deduplication feature and a privacy leak (guess the hash, discover someone else's
link). Collisions are astronomically rare but non-zero; you still need a unique index and a retry on
\`23505\`. At 10k writes/s the hot path is one indexed insert, not the hash.

**Monotonic counter (Base62 encode of \`next_id\`):** Dense, sequential, guessable -- bad for
unguessable links, fine for internal tools. A single \`UPDATE counters SET v = v + 1\` row is a
global write serialisation point; at 10k/s it becomes the bottleneck unless you **pre-allocate
ranges** per writer (\`worker-7\` owns ids 70,000,000--79,999,999) or use Snowflake-style
timestamp+worker+sequence ids embedded in the slug.

**Pre-generated key pool:** A background job fills a Redis \`SET\` or DB table with 100M unused
slugs; create is \`SPOP available_keys\` plus insert mapping. Writes decouple from encoding logic;
burst traffic drains the pool, and you alert when depth drops below 48 hours of runway. This is what
large shorteners actually run -- Bitly-style systems talk about pool refill as a first-class job.

At **~10,000 creates/s**, back-of-envelope: 864M new links per day if sustained. A 7-character
Base62 space is 62^7 ≈ 3.5 trillion -- ample for years, but **custom aliases** and **no recycling**
consume the namespace as a liability ledger, not a reusable resource.`
    },
    {
      t: 'table',
      cols: ['Strategy', 'Create path', 'Collision handling', 'Guessability', 'Best when'],
      rows: [
        ['Hash of URL', 'Hash then insert', 'Retry on unique violation', 'Medium -- deterministic', 'Dedup-by-URL is a feature; internal tools'],
        ['Counter / Snowflake', 'Allocate id, encode', 'None if ids unique', 'High -- sequential', 'Opaque slugs at high QPS with range allocation'],
        ['Pre-generated pool', '`SPOP` from Redis set', 'Pool exhaustion is the failure mode', 'Low if pool is random', 'Production default above ~1k creates/s'],
        ['Custom alias', 'User string, insert', 'Reject if taken or tombstoned', 'User-chosen', 'Vanity URLs with legal review and no recycle policy']
      ]
    },
    {
      t: 'numbers',
      title: 'Figures that drive redirect architecture',
      items: [
        { v: '~10k/s', k: 'Sustained create QPS at scale', note: 'Pool refill and range allocation become mandatory' },
        { v: '62^7', k: '7-char Base62 keyspace', note: '~3.5 trillion slugs before length bump' },
        { v: '<5 ms', k: 'Redirect p99 from edge cache', note: 'Origin only on miss; hot slug in local memory' },
        { v: '100:1', k: 'Typical read:write ratio', note: '1M redirects/s vs 10k creates/s shapes the cache tier' },
        { v: '0', k: 'Acceptable slug recycles', note: 'Any recycle with 301 or CDN-cached 302 is a security bug' }
      ]
    },

    { t: 'h', text: 'Read path: hot-key redirect cache' },
    {
      t: 'prose',
      md: `Redirect is read-heavy -- often 100:1 or 500:1 vs creates. A viral link (\`t.co/xyz\` on a
celebrity tweet) becomes a **hot key**: one slug, millions of rps, one Redis slot or one DB row.

Layer the cache:

1. **CDN edge** -- cache the *302 response* keyed by path, short \`s-maxage\` (60-300 s) if you use
302, or accept that 301 is immutable. Include \`Cache-Tag: slug-abc123\` for targeted purge on
takedown.
2. **Regional Redis** -- \`GET slug:abc123 → {url, flags}\` at ~0.2 ms. TTL 24 h; invalidate on
update/delete. Hot slug still one key -- replicate to \`slug:abc123:{0..7}\` and pick at random, or
**local in-process cache** (1-2 s TTL) in front of Redis on redirect workers.
3. **Database** -- authoritative mapping, indexed on slug. Reads only on cache miss.

The redirect handler itself should be **minimal**: lookup, optional bot/expired check, 302 with
\`Location\`, done. No synchronous analytics.`
    },
    {
      t: 'diagram',
      code: `flowchart LR
  R["GET /t/abc123"] --> CDN["CDN edge"]
  CDN -->|miss| GW["Redirect service"]
  GW --> L["Local LRU 2s"]
  L -->|miss| Redis["Redis slug map"]
  Redis -->|miss| DB[("Postgres")]
  GW --> A["Async: Kafka click event"]
  A --> Q["Analytics consumer"]`,
      caption: 'Redirect never waits on analytics. The async path absorbs 100x write volume without touching p99 redirect.'
    },

    { t: 'h', text: 'Custom aliases, tombstones, and no recycling' },
    {
      t: 'prose',
      md: `Custom aliases (\`short.co/my-brand\`) are a product feature with a schema cost: a second
unique index on \`alias\`, reserved-word blocklist, profanity filter, and **tombstone table** for
every deleted slug. "Delete" marks \`deleted_at\`, moves slug to \`slug_tombstones\`, and **never**
returns the slug to the available pool.

Why tombstones matter: even with 302 everywhere, recycling creates user confusion ("I bookmarked
\`/sale\` and now it goes somewhere else") and abuse ("claim expired premium aliases"). With any 301
or CDN caching, recycling is an **open redirect vulnerability** -- attacker creates link to evil.com,
deletes it, victim claims same alias, attacker's distributed links now hit victim's URL or vice versa.

Expired links: return **410 Gone** or a branded interstitial, not a generic 404 that looks like a
platform bug. Rate-limit alias creation per account to prevent namespace squatting.`
    },

    { t: 'h', text: 'Analytics on the async path' },
    {
      t: 'prose',
      md: `Click analytics wants: timestamp, slug, referrer, user-agent, geo, UTM params, maybe
user id from cookie. That is 500 bytes × 1M rps = **500 MB/s** of write traffic if you do it
inline. Doing it inline also adds 2-20 ms to redirect p99 when the analytics DB hiccups.

Pattern: redirect service **fire-and-forget** to Kafka (\`clicks\` topic, partition by slug hash
for ordered per-link counts). Consumers batch-insert to ClickHouse or BigQuery, update rolling
counters in Redis for dashboard "clicks last hour." Dedupe with \`(slug, ip, minute_bucket)\` if
you care about bot inflation; accept approximate counts for billing.

If Kafka is down: **drop analytics, never block redirect.** A metrics counter \`analytics_dropped\`
pages you; redirects stay up.`
    },
    {
      t: 'code',
      lang: 'javascript',
      title: 'Redirect handler shape -- sync lookup, async telemetry',
      code: `async function handleRedirect(req, res) {
  const slug = req.params.slug;
  const dest = await resolveSlug(slug); // local -> Redis -> DB, <2ms p99
  if (!dest) return res.status(410).send('Link removed');
  if (dest.flagged) return res.status(403).send('Blocked');

  // Never await this on the redirect path
  publishClick({
    slug,
    ts: Date.now(),
    ref: req.get('Referer'),
    ua: req.get('User-Agent'),
    ip: hashIp(req.ip)
  }).catch(err => metrics.analyticsDrop.inc());

  res.redirect(302, dest.url); // not 301 unless product + legal signed off
}`
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      title: '302 + pool + layered cache vs 301 + hash + sync analytics',
      gains: [
        '302 preserves slug mutability and takedown without fighting browser/CDN permanence.',
        'Pre-generated pool removes the global counter bottleneck at ~10k creates/s.',
        'CDN + Redis + local cache serves viral slugs without melting one DB row.',
        'Async Kafka analytics decouples 1M click/s from 5 ms redirect SLO.',
        'Tombstones make "delete" auditable and block alias-squatting reuse attacks.'
      ],
      costs: [
        '302 repeats full redirect latency for clients that do not cache temporary redirects.',
        'Key pool requires refill jobs, monitoring, and provisioned slack for burst creates.',
        'Hot slug mitigation (replication, local cache) adds staleness on takedown -- purge must hit all layers.',
        'No recycling consumes namespace forever -- 7-char space is large but not free with vanity aliases.',
        'Async analytics is eventually consistent -- real-time dashboards lag seconds to minutes.'
      ]
    },

    {
      t: 'failures',
      items: [
        { mode: '301 on user-generated slugs, then slug reuse', blast: 'CDN and browsers redirect to old destination indefinitely; phishing link survives takedown.', fix: 'Default 302; if 301 required, tombstone slugs forever and never reissue. Purge CDN by cache-tag on delete.' },
        { mode: 'Global counter for slug ids at 10k/s', blast: 'Single-row update serialises creates; p99 create latency spikes, pool drains, outages during viral signup.', fix: 'Pre-generated Redis pool or Snowflake ids with per-worker ranges; alert when pool depth < 48h runway.' },
        { mode: 'Viral slug as single Redis key', blast: 'One cluster node at 100% CPU; redirect p99 rises globally even though other nodes idle.', fix: 'Local 1-2s in-process cache, key replication `slug:{0..7}`, or read replicas with sticky routing.' },
        { mode: 'Synchronous click insert on redirect path', blast: 'Analytics DB slow query adds 50 ms to every redirect; SLO breach during traffic spike.', fix: 'Kafka fire-and-forget; drop events under backpressure; never block 302 on telemetry.' },
        { mode: 'Recycling deleted slugs into pool', blast: 'Attacker\'s old links activate on innocent user\'s URL; open-redirect class bug regardless of status code.', fix: 'Tombstone table; `SPOP` only from never-issued random pool, never from deleted mappings.' },
        { mode: 'Custom alias without reserved-word check', blast: '`/api`, `/admin` paths hijacked; phishing on trusted domain.', fix: 'Blocklist system routes; minimum length; rate limits; manual review for top-level aliases.' }
      ]
    },

    {
      t: 'staff',
      md: `The candidate who wins names **302 vs 301 as a cache contract**, not a trivia question.

- "I default 302 because a 301 at Cloudflare's edge outlives any slug reassignment. If we ever ship
301 for SEO, we tombstone slugs and never recycle -- otherwise takedown is theatre."
- "At ~10k creates/s a global \`UPDATE counter\` row is the bottleneck. I'd pre-fill a Redis set
with random 7-char slugs and make create \`SPOP\` plus insert; refill workers keep 48 hours of depth
and page when it drops below 12."
- "Reads are 100:1. Viral slug is a hot key on one Redis slot -- I'd put a 2-second in-process LRU
in front of Redis on each redirect pod. Takedown purges CDN cache-tag, deletes Redis key, and accepts
2 seconds of stale on edge before local TTL expires."
- "Analytics goes to Kafka on the redirect path with \`.catch()\` -- if the cluster is down we drop
clicks and keep redirecting. ClickHouse consumer batches; dashboard reads pre-aggregated Redis counters."
- "Custom alias \`go.co/sale\` is burned forever after delete, even with 302, because recycling is
confusing and abusable. Tombstone table is the audit trail."

Volunteer the 301/CDN story before they ask about takedown. That separates people who operated
redirects from people who drew a box labeled 'cache'.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'Product wants 301 for SEO on all short links. Six months later, deleted slug `promo24` is reassigned to a new customer. What breaks?',
          options: [
            'Nothing -- Postgres has the new URL, so redirects update immediately.',
            'Browsers and CDN edges that cached the 301 still redirect to the old URL; users never hit origin.',
            'Only users who bookmarked the link are affected; new clicks work.',
            'Redis invalidation fixes it within one TTL cycle.'
          ],
          answer: 1,
          why: '301 is treated as permanent by browsers and most CDNs. Intermediaries serve the cached redirect without contacting origin, so reassignment in the database is invisible to them. Redis TTL and DB updates only help clients that revalidate -- which 301 explicitly discourages. The fix is never recycle slugs when 301 is in play, or use 302 for mutable mappings.'
        },
        {
          q: 'Create traffic hits ~10,000/s sustained. Which slug generation approach avoids a single write hot spot?',
          options: [
            'MD5 hash of URL with retry on collision',
            'Single Postgres sequence incremented per insert',
            'Pre-generated pool with `SPOP` from Redis plus background refill',
            'UUID string as slug'
          ],
          answer: 2,
          why: 'A single sequence row or auto-increment column serialises ~10k writes/s through one lock. Hash-with-retry still does one indexed insert per create but avoids the counter hot spot; UUID works but is long and ugly. Pre-generated pools decouple allocation from insert -- create becomes pop-from-set plus row write, and refill runs asynchronously across many workers with batched inserts.'
        },
        {
          q: 'A celebrity tweet drives 800,000 redirect rps to one slug. Redis p99 jumps to 40 ms. First mitigation?',
          options: [
            'Add Redis cluster nodes',
            'Shard the slug across Postgres read replicas only',
            'In-process cache with 1-2 s TTL on redirect workers plus CDN cache of the 302',
            'Move redirects to synchronous DB reads'
          ],
          answer: 2,
          why: 'One slug is one Redis key on one slot -- more nodes do not split a hot key. Local cache collapses 800k rps per pod to one Redis read every 2 seconds per instance. CDN caching the 302 removes most traffic from origin entirely. DB-only reads would be catastrophically worse at this ratio.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Concept topics this studio applies',
      blocks: [{
        t: 'prose',
        md: `Redirect permanence and edge caching are developed in **CDN & Edge Delivery** and
**Caching layers** -- the 301 decision is a CDN policy choice, not an app detail. Pre-generated
pools and click ingestion use **Queues & Streaming** patterns. Hot slug mitigation reuses
**Server-side caching** and **Sharding & partitioning** when you replicate keys across suffixes.
Redirect latency SLOs tie to **Web performance** measurement. Real-time "clicks per second" dashboards
optional via **Realtime frontend** channels are read-side only -- never on the redirect path.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why is 301 dangerous for a user-generated URL shortener?', a: 'Browsers and CDNs cache 301 as permanent. Reassigning or recycling a slug does not update cached redirects -- users keep hitting the old destination. Takedown fails unless you never reuse slugs and can purge every edge, which is not synchronous.' },
    { q: 'How does a pre-generated key pool work at ~10k creates/s?', a: 'Background jobs batch-insert random unused slugs into a Redis SET or staging table. Create pops one slug, inserts the mapping, returns. Refill workers maintain 48+ hours of depth; alert when low. This removes a global counter hot spot and smooths burst traffic.' },
    { q: 'Where should click analytics run relative to the redirect?', a: 'Async on a separate path -- fire-and-forget to Kafka or a queue after resolving the destination. Never await analytics before sending 302. If telemetry is down, drop events and keep redirecting; blocking redirect on analytics violates the sub-5 ms SLO.' },
    { q: 'What is a slug tombstone and why keep it forever?', a: 'A record that a slug was issued and deleted, preventing reuse. Stops alias squatting, bookmark confusion, and open-redirect abuse where old links activate on a new owner\'s URL. Required especially if any 301 or CDN caching exists.' },
    { q: 'How do you mitigate a viral single-slug hot key?', a: 'Layer caches: CDN on the 302 response, regional Redis for mapping, 1-2 s in-process LRU on redirect pods. Optionally replicate Redis key to slug:0..7 and read randomly. Adding cluster nodes alone does not help one hot key.' },
    { q: '302 vs 307 for redirects?', a: 'Both are non-permanent. 307 preserves the original HTTP method; 302 may allow method change in older clients. For GET-only short links, 302 is standard. Use 307 if the short URL might be used with POST in API integrations.' },
    { q: 'Why hash-of-URL slug generation can be wrong for public shorteners?', a: 'Deterministic: same long URL always yields same slug, enabling dedup but leaking that two users shared a link if you can guess inputs. Collisions still need DB unique index and retry. Does not solve hot-key reads on popular destinations.' }
  ],

  drills: [
    {
      prompt: 'Design a URL shortener for 1M redirects/s and 8k creates/s. Product demands custom vanity aliases, click analytics within 60 seconds, and legal requires link takedown within 5 minutes. Walk through slug generation, redirect status code, cache layers, and takedown propagation.',
      probes: [
        '301 or 302, and what happens when a taken-down slug would have been cached?',
        'How do you generate slugs at 8k/s without a global lock?',
        'How does takedown reach CDN, Redis, and in-process caches within 5 minutes?',
        'Where does analytics run, and what degrades if Kafka is overloaded?',
        'Can vanity alias `brand/sale` ever be reissued to another customer?'
      ],
      strong: [
        'Defaults 302 with CDN s-maxage 60-300s and cache-tag purge API on takedown; explains 301 requires eternal tombstones.',
        'Pre-generated pool with refill metrics; custom aliases separate unique index with blocklist.',
        'Takedown: mark deleted, purge CDN by tag, DEL Redis key, broadcast invalidation to pods or wait 2s local TTL; 410 response thereafter.',
        'Kafka click stream partitioned by slug; ClickHouse consumer; dashboard reads materialised counts, not sync insert.',
        'Explicit no-recycle policy with tombstone table and legal audit trail.',
        'Numbers: 100:1 read/write, hot slug local cache, p99 redirect budget under 5 ms from edge.'
      ],
      weak: [
        'Chooses 301 for performance without mentioning CDN permanence.',
        'Single Postgres sequence for all slugs.',
        'Synchronous click write before redirect.',
        'Assumes DELETE in DB instantly fixes all users worldwide.',
        'Recycles aliases after 90 days without discussing abuse.'
      ]
    },
    {
      prompt: 'A phishing link on slug `x7k2m` goes viral -- 2M rps. Security requests immediate block. Your Redis key is at 100% CPU on one shard. Describe the incident steps and the architectural follow-up.',
      probes: [
        'What do you do in the first 60 seconds?',
        'Why did adding Redis nodes not help yesterday?',
        'How do you block without waiting for CDN TTL to expire?',
        'What permanent design change prevents recurrence?'
      ],
      strong: [
        'Immediate: flag slug in DB, purge CDN cache-tag, DEL Redis key, enable interstitial 403 at origin; accept brief stale window on local LRU.',
        'Explains single-key hot spot vs cluster scale-out.',
        'CDN purge API + short s-maxage policy; 302 not 301 so purge is effective.',
        'Follow-up: local cache + key replication; rate-limit creates; automated abuse scoring on destination URL.',
        'Post-incident: tombstone slug, never recycle; async analytics preserved redirect SLO during spike.'
      ],
      weak: [
        'Blocks by taking down entire redirect service.',
        'Proposes "add more Redis" without hot-key strategy.',
        'Relies only on DB update with no CDN or edge plan.',
        'Does not mention analytics path staying async during incident.'
      ]
    }
  ]
};
