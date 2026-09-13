/* Studios — Design a crawler and search. See CONTENT-SCHEMA.md. */

export default {
  blocks: [
    {
      t: 'prose',
      md: `A web crawler plus search engine is two systems pretending to be one. The crawler
discovers and fetches pages on a schedule governed by politeness and robots.txt. The index
turns those pages into posting lists you can query in milliseconds. The serving path must never
wait for a crawl to finish -- users type a query and expect ranked results now, even when the
corpus is hours stale.

Interviewers are not testing whether you know what an inverted index is. They want to hear that
you separate crawl throughput from query latency, that politeness is per-host not global, and
that sharding the index is a query-shape decision, not a storage afterthought.`
    },

    { t: 'h', text: 'The two loops and why they must decouple' },
    {
      t: 'diagram',
      caption: 'Crawl and serve are independent pipelines. Query traffic never blocks on fetch.',
      code: `flowchart TB
  subgraph Crawl["Crawl loop"]
    F["URL frontier<br/>priority plus politeness"] --> R["Fetch workers"]
    R --> P["Parse and extract"]
    P --> W["Write posting lists"]
  end
  subgraph Serve["Query loop"]
    Q["User query"] --> L["Lexical rank BM25"]
    L --> M["Merge shards"]
    M --> Sn["Snippets"]
    Sn --> U["Results"]
  end
  W --> IX[("Inverted index")]
  IX --> L`
    },
    {
      t: 'prose',
      md: `The crawl loop is a producer: it pulls URLs from a frontier, respects per-host rate
limits, parses HTML, and appends to posting lists. The query loop is a consumer: it tokenises
the query, looks up terms in the inverted index, scores documents with BM25, merges shard
results, and renders snippets from stored text.

**Crawl vs index lag** is the gap between when a page changed on the web and when a query
returns the new version. It is normal and large -- hours to days for most of the corpus. Product
expectations differ: news search wants minutes; archival search tolerates weeks. Name your lag
SLO explicitly and instrument it as \`now() - last_indexed_at\` per URL, not as "we crawl
often".`
    },

    { t: 'h', text: 'URL frontier: priority queue plus politeness per host' },
    {
      t: 'prose',
      md: `The frontier is not a FIFO queue. It is a **priority queue** of URLs scored by
freshness need, in-link importance, sitemap hints, and recrawl policy. A high-traffic homepage
and a forgotten blog post should not compete equally for fetch slots.

Politeness is enforced **per host**, not globally. Each host gets a token bucket or a minimum
interval between requests -- classically one fetch every 1-2 seconds for unknown hosts, tighter
only with permission. A single global rate limit either starves small sites or hammers one
host until you are blocked. Store frontier state in a durable queue keyed by host so a worker
crash does not lose the schedule.

Dedup is part of the frontier: canonical URL normalisation, redirect following, and a bloom
filter or seen-set so you do not enqueue \`http\` and \`https\` variants forever.`
    },
    {
      t: 'code',
      lang: 'js',
      title: 'Per-host politeness sketch',
      code: `class HostScheduler {
  constructor(minIntervalMs = 1000) {
    this.nextAllowed = new Map(); // host -> timestamp
    this.minInterval = minIntervalMs;
  }

  canFetch(host, now = Date.now()) {
    const next = this.nextAllowed.get(host) ?? 0;
    return now >= next;
  }

  recordFetch(host, now = Date.now()) {
    this.nextAllowed.set(host, now + this.minInterval);
  }
}

// Frontier dequeue: pick highest-priority URL whose host is ready.
// Never block the whole crawler on one slow host.`
    },

    { t: 'h', text: 'robots.txt and crawl policy' },
    {
      t: 'prose',
      md: `\`robots.txt\` is a contract, not a security boundary. Well-behaved crawlers fetch
it per host, cache it with TTL, and refuse paths disallowed for their user-agent. It does not
stop a malicious actor; it stops *you* from becoming one.

Cache robots rules with expiry. Refetch on 404 or when \`Cache-Control\` says so. When a path is
disallowed, drop queued URLs for that prefix rather than fetching and discarding -- wasted
politeness budget. For sitemaps listed in robots, treat them as high-priority seed URLs.

Staff signal: mention that crawl policy also includes your own blocklist, rate limits beyond
robots, and respect for \`noindex\` meta tags at index time, not just at fetch time.`
    },

    { t: 'h', text: 'Inverted index and posting lists' },
    {
      t: 'prose',
      md: `An inverted index maps each term to a **posting list**: the set of documents
containing that term, plus payloads you need for ranking and snippets. A posting is typically
\`(doc_id, term_frequency, field boosts, positions)\`. Positions enable phrase queries and
snippet windows; they cost space.

Index updates from the crawl pipeline are append-heavy: new docs add postings; updates merge
or replace a doc's postings atomically per \`doc_id\`. Deletes must remove all postings for
that doc -- a tombstone in the doc store is not enough if the term still points at it.

**BM25 serving** runs entirely on the query path. The crawler never ranks; it only writes
postings. At query time: tokenise, fetch posting lists for query terms, score each candidate
doc with BM25 using collection statistics (\`df\`, avg doc length), take top-k, fetch snippet
text from a forward store or stored positions. Keeping ranking on the serve tier lets you
re-tune BM25 without re-crawling the web.`
    },
    {
      t: 'table',
      title: 'Shard the inverted index: by term vs by document',
      cols: ['Shard key', 'Query pattern', 'Pros', 'Cons'],
      rows: [
        ['**By term**', 'Single-term and short queries', 'One lookup per query term; natural for web scale', 'Hot terms ("the", brand names) create skewed shards; multi-term merge on every query'],
        ['**By document**', 'Rare terms, doc-centric updates', 'Even crawl write load; cheap per-doc delete', 'Every query must fan out to all shards -- bad for head queries'],
        ['**Hybrid**', 'Production search', 'Head terms replicated; tail terms sharded by term', 'More complex routing; two code paths to test']
      ]
    },
    {
      t: 'note',
      tone: 'good',
      title: 'What interviewers want on sharding',
      md: `Say you shard **by term** for the inverted index because queries are term lookups,
and you accept that super-common terms need replication or a separate tier. Mention **by doc**
only if the question is about incremental updates or per-tenant isolation. Never shard the crawl
frontier the same way as the index -- they have opposite access patterns.`
    },

    { t: 'h', text: 'Freshness, recrawl, and index lag' },
    {
      t: 'steps',
      ordered: true,
      title: 'Keeping results useful without crawling the whole web daily',
      items: [
        'Assign each URL a **recrawl priority** from PageRank-like in-links, manual seeds, and change signals (Last-Modified, ETag).',
        'On fetch, compare content hash. If unchanged, update \`last_crawled_at\` only -- skip re-indexing.',
        'Propagate deletes: 404 or Gone removes the doc from the index, not just the frontier.',
        'Expose **index lag** in metrics and optionally in UI for time-sensitive verticals.',
        'Separate **near-real-time** pipeline (small high-priority queue) from bulk recrawl.'
      ]
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      gains: [
        'Decoupled crawl and serve lets query latency stay flat while crawl backlog grows.',
        'Per-host politeness keeps you welcome on sites and avoids IP bans.',
        'BM25 on posting lists gives explainable ranking without ML infra on the hot path.',
        'Term sharding matches the query access pattern for typical web search.',
        'Incremental index updates avoid rebuilding the entire corpus on every change.'
      ],
      costs: [
        'Two large systems to operate: frontier plus index, each with its own failure modes.',
        'Index lag is inevitable; users may see stale snippets unless you invest in recrawl priority.',
        'Posting lists for common terms are huge -- memory and merge cost at query time.',
        'robots.txt and politeness cap crawl rate; fresh coverage fights politeness budget.',
        'Shard skew on hot terms can negate the benefits of sharding unless you replicate heads.',
        'Snippet generation needs a forward store or positions -- extra storage beside the index.'
      ]
    },

    { t: 'h', text: 'Failure modes' },
    {
      t: 'failures',
      title: 'Crawler and search failures',
      items: [
        { mode: '**Politeness storm** -- one host enqueued millions of URLs', blast: 'Crawler hammers the host, gets blocked, crawl stall for that domain.', fix: 'Per-host caps on frontier depth and fetch rate; backoff on 429 or connection errors; fair scheduling across hosts.' },
        { mode: '**Global queue starvation**', blast: 'Low-priority hosts never get fetched; index goes stale on long tail.', fix: 'Priority queue with aging; minimum share of fetch slots per host per hour.' },
        { mode: '**Duplicate URL explosion**', blast: 'Same content under many URLs fills the index and dilutes rank.', fix: 'Canonical URL normalisation, dedup at enqueue, collapse duplicates at index time with a canonical doc_id.' },
        { mode: '**Hot term shard overload**', blast: 'Queries containing a mega-term time out or shed load.', fix: 'Replicate hot posting lists, cache top results for head queries, or split high-frequency terms.' },
        { mode: '**Stale index after delete**', blast: 'Search returns pages that 404 on click -- trust collapse.', fix: 'Propagate 404 to index delete; periodic reconciliation; shorten recrawl for high-traffic URLs.' },
        { mode: '**Crawl blocks query path**', blast: 'Index rebuild or merge during crawl spikes query p99.', fix: 'Separate write path with double-buffer or segment merge offline; serve reads from immutable segments.' }
      ]
    },

    {
      t: 'staff',
      md: `Strong answers name the separation first, then the mechanism.

- "Crawl and serve are different SLAs. I never block a query on fetch. The user gets BM25 over
  whatever the index last saw, and I measure index lag explicitly."
- "The frontier is a priority queue with **per-host** politeness -- token bucket or minimum
  interval. Global rate limits are wrong; they either starve the long tail or DDoS one site."
- "robots.txt is cached per host and enforced before fetch. Disallowed paths come out of the
  queue, not out of the parser after we already wasted a slot."
- "Posting lists are written by the crawl pipeline; BM25 runs only at query time on the serve
  tier. That lets me tune ranking without re-crawling."
- "I shard the inverted index **by term** because queries look up terms. I acknowledge hot-term
  skew and say I'd replicate or tier head terms -- not shard by document unless the question is
  about per-doc updates."
- "Recrawl is hash-based: unchanged body skips re-index. Deletes propagate from 404, not just
  frontier removal."

The signal: you have thought about operability -- lag, politeness, skew -- not just textbook
inverted indexes.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'Query latency spikes whenever a large crawl batch finishes indexing. Best architectural fix?',
          options: [
            'Slow down the crawler so indexing never runs hot.',
            'Keep crawl writes and query reads on separate index segments with offline merge, so serves never block on bulk posting updates.',
            'Cache every query result for an hour.',
            'Move BM25 into the crawler so ranking is precomputed.'
          ],
          answer: 1,
          why: 'The symptom is read/write contention on the same index structure. Segment-based or double-buffered indexes let the crawl pipeline append or merge in the background while the query tier serves immutable segments. Slowing crawl trades away freshness. Query caching hides the problem for repeats only. Precomputing rank at crawl time couples two loops that should stay independent.'
        },
        {
          q: 'Why is politeness enforced per host rather than as one global crawler rate?',
          options: [
            'robots.txt only works per host.',
            'Each site expects its own rate limit; a global cap either under-utilises fetch capacity or overloads individual hosts and risks blocks.',
            'DNS resolution is per host.',
            'HTML parsing is slower for some hosts.'
          ],
          answer: 1,
          why: 'Politeness is a contract with each origin. A global 1000 req/s limit might send 999 to one small blog. Per-host buckets let you parallelise across thousands of sites while respecting each site\'s tolerance. robots.txt is per host but that is not the structural reason -- fairness and ban avoidance are.'
        },
        {
          q: 'You shard the inverted index by document ID. What happens to a typical two-word query?',
          options: [
            'It hits one shard and is fast.',
            'It must fan out to every shard and merge candidate scores, which is expensive for head traffic.',
            'It cannot be answered.',
            'BM25 no longer applies.'
          ],
          answer: 1,
          why: 'Document sharding spreads writes evenly but queries no longer map to a single term lookup. Every shard must evaluate the query against its doc subset and return partial top-k for a global merge. That fan-out is why web search indexes shard by term (or hybrid), not by doc, unless the workload is doc-centric or multi-tenant isolation dominates.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics',
      blocks: [{
        t: 'prose',
        md: `Sharding trade-offs connect to **Sharding & Partitioning**. Queueing the frontier
resembles **Queues & Streaming**. Serving tiers and caching overlap **Server-Side Caching** and
**Scalability & Capacity**. For search-as-you-type UX, see the **Search-as-you-type** studio.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why must crawl and search serve decouple?', a: 'Crawl is batch-oriented and bounded by politeness; search must answer in milliseconds regardless of crawl backlog. Users query the index as it last existed, with measurable index lag, not the live web.' },
    { q: 'What is the URL frontier?', a: 'A priority queue of URLs to fetch, scored by recrawl need and importance, combined with per-host politeness so one site cannot starve others or get hammered. Dedup and canonicalisation happen before enqueue.' },
    { q: 'What does a posting list store?', a: 'For each term, the list of documents containing it plus payloads for ranking: doc_id, term frequency, field weights, and often positions for phrases and snippets. The query path joins lists and scores with BM25.' },
    { q: 'Why shard the inverted index by term?', a: 'Queries look up query terms directly. Term sharding maps each lookup to one shard. Document sharding forces every query to fan out to all shards. Hot common terms need replication or special handling to avoid skew.' },
    { q: 'What is index lag vs crawl lag?', a: 'Crawl lag is time until a URL is fetched. Index lag is time until fetched content appears in search results. A page can be crawled but not yet merged into serving segments; measure lag as now minus last_indexed_at per URL.' },
    { q: 'How does robots.txt affect the crawler?', a: 'Fetched per host, cached with TTL, and used to drop disallowed paths from the frontier before fetch. It is a politeness contract, not security. Combine with noindex handling at index time and your own blocklists.' },
    { q: 'Why run BM25 only on the query path?', a: 'Ranking parameters and collection stats evolve without re-crawling. The crawler writes postings; the serve tier scores candidates at query time using df and document length from the index.' }
  ],

  drills: [
    {
      prompt: 'Design a crawler and search for 10B pages. Median query p99 is 200 ms. Crawl budget is 50M fetches per day. How do you allocate frontier priority, politeness, and index sharding?',
      probes: [
        'How do you avoid one viral host consuming the crawl budget?',
        'Where does BM25 run and what does the crawler write?',
        'How do you handle a query term whose posting list is 8 GB?',
        'What metric proves freshness is acceptable?'
      ],
      strong: [
        'Separates crawl loop from serve loop; queries never wait on fetch.',
        'Per-host politeness with fair scheduling and caps on URLs per host in the frontier.',
        'Priority from in-links, sitemap, recrawl hash-unchanged skip, and a fast lane for news seeds.',
        'Inverted index sharded by term with a plan for hot-term replication or caching.',
        'BM25 on serve tier; crawl writes postings and doc store for snippets.',
        'Index lag SLO per vertical; hash-based skip on unchanged pages to stretch crawl budget.',
        'Segment merge offline so bulk index writes do not spike query latency.'
      ],
      weak: [
        'Single global crawl rate or one FIFO queue for all URLs.',
        'Rebuilds the entire index on every crawl batch.',
        'No story for hot terms or posting list size.',
        'Assumes crawl freshness equals search freshness with no lag metric.',
        'Shards by document without acknowledging query fan-out cost.'
      ]
    }
  ]
};
