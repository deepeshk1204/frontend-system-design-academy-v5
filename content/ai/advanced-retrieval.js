/* AI track — Advanced Retrieval. See CONTENT-SCHEMA.md. */

export default {
  blocks: [
    {
      t: 'prose',
      md: `Basic RAG is one embedding lookup. Advanced retrieval is what you build once you have
measured that lookup and found it is not good enough -- which it will not be, for reasons that
are predictable rather than mysterious.

The techniques here are a pipeline, not a menu: transform the query, retrieve from multiple
systems with complementary strengths, fuse the result lists, rerank with a slower and more
accurate model, and enforce permissions throughout. Each stage has a measurable contribution,
and they are not equally valuable. Most of the gain is in the first two.`
    },

    { t: 'h', text: 'Why dense-only retrieval fails' },
    {
      t: 'prose',
      md: `An embedding is a lossy compression of meaning into a few hundred numbers. Compression
discards what was rare, and what is rare in a corpus is precisely what identifies things:
error codes, SKUs, ticket IDs, function names, version strings, surnames, internal project
codenames.

Ask a vector index for \`ERR_PAYMENT_4021\` and you will get documents about payment errors.
That is semantically excellent and operationally useless -- the user wanted the one page that
mentions that exact code, and the encoder has no reason to distinguish it from
\`ERR_PAYMENT_4022\`, which differs by one token it has probably never seen. The same applies to
negation ("refunds *not* available for..."), to short queries where there is little signal to
embed, and to any domain vocabulary the encoder did not meet in training.

Lexical search has the mirror-image profile. BM25 will nail the exact code and completely miss
"my card keeps getting declined" against a page titled "Authorisation failures". You want both,
because their failures are uncorrelated -- which is the whole argument for hybrid search.`
    },

    { t: 'h', text: 'BM25, briefly but properly' },
    {
      t: 'prose',
      md: `BM25 scores a document against a query by summing a contribution per query term, and
three intuitions explain its behaviour:

**Rare terms count more.** The inverse-document-frequency factor means a term appearing in 12
documents contributes far more than one appearing in 300,000. This is exactly why BM25 is
strong on identifiers -- rarity is the signal.

**Repetition saturates.** Term frequency enters through a saturating function controlled by
\`k1\` (typically ~1.2), so the tenth occurrence of a word adds very little over the third. A
page that spams a keyword does not win.

**Long documents are penalised.** Length normalisation, controlled by \`b\` (typically ~0.75),
prevents a 50-page document from outscoring a focused paragraph merely by containing more
words.

You get BM25 for free in Elasticsearch, OpenSearch, Lucene and Vespa, and in Postgres via
\`tsvector\`/\`ts_rank\` (a related but not identical ranking function -- fine in practice, worth
knowing it is not literally BM25 unless you install an extension that provides it).`
    },

    { t: 'h', text: 'Hybrid search and Reciprocal Rank Fusion' },
    {
      t: 'prose',
      md: `Once you run two retrievers you must merge two result lists, and the naive approach --
normalise both scores and take a weighted sum -- is fragile. BM25 scores are unbounded and
corpus-dependent; cosine similarities sit in a narrow band and are not comparable across
queries. Any normalisation you invent will need re-tuning whenever the corpus changes.

**Reciprocal Rank Fusion** (Cormack, Clarke & Buettcher, 2009) sidesteps the problem by
throwing the scores away and using only ranks:`
    },
    {
      t: 'code',
      lang: 'text',
      title: 'The RRF formula',
      code: `RRF(d) = sum over each retriever r of:   1 / (k + rank_r(d))

where rank_r(d) is d's 1-based position in retriever r's list
      k is a constant, conventionally 60
      documents absent from a list contribute 0`
    },
    {
      t: 'prose',
      md: `The constant \`k\` damps the top of each list. With \`k = 60\`, rank 1 scores
\`1/61 = 0.0164\` and rank 2 scores \`1/62 = 0.0161\` -- barely different. That is deliberate: it
means a document ranked first by *one* retriever cannot dominate a document ranked reasonably
well by *both*. Agreement across retrievers is what RRF rewards. Lower \`k\` sharpens the
preference for top-ranked items; higher \`k\` flattens it further.`
    },
    {
      t: 'table',
      title: 'Worked example: fusing BM25 and vector results, k = 60',
      cols: ['Doc', 'BM25 rank', 'Vector rank', 'BM25 term', 'Vector term', 'RRF score', 'Fused rank'],
      rows: [
        ['**D-A**', '1', '—', '1/61 = .01639', '0', '**.01639**', '3'],
        ['**D-B**', '3', '2', '1/63 = .01587', '1/62 = .01613', '**.03200**', '**1**'],
        ['**D-C**', '—', '1', '0', '1/61 = .01639', '**.01639**', '3'],
        ['**D-D**', '2', '4', '1/62 = .01613', '1/64 = .01563', '**.03176**', '**2**'],
        ['**D-E**', '—', '3', '0', '1/63 = .01587', '**.01587**', '5']
      ]
    },
    {
      t: 'prose',
      md: `Read the result. Neither retriever put **D-B** first, but both liked it, and it wins.
**D-A** was BM25's top hit and **D-C** was the vector index's top hit, and both fall behind two
documents that had cross-retriever agreement. That is the behaviour you want: it suppresses the
single-retriever false positive, which is the dominant failure mode of each system alone.

Two practical notes. Retrieve deeply from each list -- 50 to 100 each -- because RRF can only
promote documents it can see, and a document at rank 80 in one list and rank 3 in the other is
exactly the case you are trying to catch. And if you need to weight one retriever, multiply its
term by a weight rather than fiddling with \`k\`; that keeps the semantics interpretable.`
    },
    {
      t: 'code',
      lang: 'js',
      title: 'RRF in about fifteen lines',
      code: `export function rrf(lists, { k = 60, weights = null } = {}) {
  const scores = new Map();
  const docs = new Map();

  lists.forEach((list, i) => {
    const w = weights ? weights[i] : 1;
    list.forEach((doc, idx) => {
      const rank = idx + 1;                       // 1-based
      scores.set(doc.id, (scores.get(doc.id) ?? 0) + w / (k + rank));
      docs.set(doc.id, doc);
    });
  });

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ ...docs.get(id), rrfScore: score }));
}

// Retrieve DEEP from each — RRF can only promote what it can see.
const [lex, vec] = await Promise.all([
  bm25Search(query, { limit: 100, filter: aclFilter }),
  vectorSearch(queryEmbedding, { limit: 100, filter: aclFilter, efSearch: 128 })
]);
const fused = rrf([lex, vec]).slice(0, 50);   // 50 candidates into the reranker`
    },

    { t: 'h', text: 'Cross-encoder reranking: the biggest single quality lever' },
    {
      t: 'prose',
      md: `The retrievers above are **bi-encoders**: the query and the document are embedded
independently, so document vectors can be precomputed and indexed. That independence is what
makes search fast and it is also the source of the accuracy ceiling -- the document's
representation was fixed before your query existed, so it cannot emphasise the part that
matters to you.

A **cross-encoder** feeds the query and the document *together* through a transformer and
outputs a single relevance score. Full attention runs across both, so the model can decide that
this paragraph answers this question even though the wording diverges. It is substantially more
accurate, and it is \`O(candidates)\` model invocations per query, so it cannot be your search.

Hence two-stage retrieval: a fast bi-encoder stage optimised for **recall** (do not miss it) and
a slow cross-encoder stage optimised for **precision** (put it first). The reranker only sees
what stage one returned, which is why you retrieve 50-100 -- a cross-encoder cannot recover a
document the retriever never surfaced.`
    },
    {
      t: 'diagram',
      caption: 'Funnel: 100 candidates, one cross-encoder pass, 5 chunks into the prompt.',
      code: `flowchart LR
  Q["Query"] --> QR["Rewrite / decompose"]
  QR --> B["BM25<br/>top 100"]
  QR --> V["Vector ANN<br/>top 100"]
  B --> F["RRF fuse"]
  V --> F
  F --> C["~50 candidates"]
  C --> X["Cross-encoder rerank<br/>50 query-doc pairs"]
  X --> T["Top 5<br/>best first"]
  T --> P["Grounded prompt"]
  QR -.->|ACL filter applied<br/>inside both retrievers| B
  QR -.-> V`
    },
    {
      t: 'table',
      title: 'Reranker options — verify latency on your own hardware and payload sizes',
      cols: ['Option', 'Mechanism', 'Rough latency for 50 candidates', 'Notes'],
      rows: [
        ['**Hosted reranker API** (Cohere Rerank, Voyage, Jina)', 'Cross-encoder as a service', 'Tens to low hundreds of ms', 'Fastest path to the quality gain. One more network dependency in the critical path.'],
        ['**Self-hosted small cross-encoder** (e.g. a MiniLM-class model)', 'Batched GPU or even CPU inference', 'Tens of ms on GPU; hundreds on CPU', 'Cheap and private. Batch all candidates in one forward pass.'],
        ['**ColBERT / late interaction**', 'Per-token embeddings with a MaxSim operator — between bi- and cross-encoder', 'Low, once indexed', 'Much better than a bi-encoder, much cheaper than a cross-encoder. Storage cost is large: many vectors per document.'],
        ['**LLM-as-reranker**', 'Prompt a model to score or order candidates', 'Hundreds of ms to seconds', 'Flexible and expensive. Reasonable for offline eval or very small candidate sets; usually too slow for the request path.']
      ]
    },
    {
      t: 'numbers',
      title: 'A two-stage budget that fits a ~1 s retrieval SLO',
      items: [
        { v: '100 + 100', k: 'Candidates from lexical and vector', note: 'Deep enough for RRF to find agreement' },
        { v: '~50', k: 'Into the reranker after fusion', note: 'Past ~100 the cost grows and the gain does not' },
        { v: '4-8', k: 'Into the prompt, ordered best-first', note: 'More distractors hurt more than they help' },
        { v: '2-3x', k: 'Typical reranker share of retrieval latency', note: 'Usually still the best quality per millisecond you can buy' }
      ]
    },

    { t: 'h', text: 'Query transformation' },
    {
      t: 'prose',
      md: `The user's literal words are often a poor search key. Four transformations, in
roughly descending order of how often they earn their latency:

**Rewriting for context.** In a conversation, "what about for EU customers?" is unsearchable in
isolation. A cheap fast model rewrites it into a standalone query using the last few turns.
This is close to mandatory for any multi-turn interface and is the one I would build first.

**Decomposition.** "How does our refund policy differ between the US and Germany?" needs two
retrievals, not one -- no single chunk contains the comparison. Split into sub-questions,
retrieve for each, and merge. Detect the need with a cheap classifier rather than doing it
always.

**HyDE** (Hypothetical Document Embeddings, Gao et al., 2022). Have the model *write* a
plausible answer, embed that, and search with it. It works because a hypothetical answer lives
in answer-space, closer to real documents than a question is. Genuinely useful when queries and
documents are stylistically far apart; it adds a full generation round trip to your TTFT, and
the hallucinated answer can pull retrieval toward a wrong topic. Measure before adopting.

**Multi-query expansion.** Generate three or four paraphrases, retrieve for each, fuse with
RRF. Cheap to implement, parallelisable, robust to one bad phrasing. The cost is N times the
retrieval load.

All of these add latency before the first token. Run them in parallel where you can, cache
rewrites keyed by conversation state, and use a small fast model -- query rewriting is not a
frontier-model task.`
    },

    { t: 'h', text: 'Contextual retrieval' },
    {
      t: 'prose',
      md: `A chunk pulled out of its document loses the referents that made it meaningful. A
paragraph reading "Revenue grew 3% quarter over quarter" is useless in an index because it
names neither the company nor the quarter, and no query will find it.

**Contextual retrieval** (described publicly by Anthropic in 2024) fixes this at ingest: for
each chunk, ask a cheap model to write one or two sentences situating it within the whole
document, and prepend that to the chunk before embedding *and* before BM25 indexing. The
paragraph becomes "From Acme's Q3 2026 earnings report, discussing the EMEA segment: Revenue
grew 3% quarter over quarter." It is now retrievable by the queries people actually type, and
the reported gains in retrieval failure rate are substantial.

The cost is one model call per chunk at ingest, mitigated heavily by prompt-prefix caching of
the document -- the document is the stable prefix and each chunk is a short suffix. Do the
arithmetic for your corpus size before committing: it is a real bill for a large corpus, and
unlike a prompt change you pay it again on every reindex.

The cheap 80% version, if that bill is too large: prepend the document title and heading
breadcrumb mechanically. No model calls, no cost, and it captures a large share of the benefit
on structured documents.`
    },

    { t: 'h', text: 'Permission-aware retrieval' },
    {
      t: 'prose',
      md: `This is the part that separates a demo from an enterprise product, and it is a
*design* problem rather than a filtering detail.

The naive implementation retrieves the top k and then checks permissions on each result. It is
wrong for two independent reasons. Operationally, it is the post-filter trap: a user with
access to 0.5% of the corpus gets an almost empty page, because the global nearest neighbours
belong to other people. And architecturally, by the time you filter you have already leaked --
the count of removed results, the latency signature, and any summarisation that saw the text.

The correct shape is **filter during retrieval**, which means the authorisation data must live
in the index.`
    },
    {
      t: 'steps',
      ordered: true,
      title: 'Building permission-aware retrieval',
      items: [
        '**Denormalise the ACL into the index.** Each chunk carries the set of principals that may read it -- usually group IDs rather than user IDs, so the set stays small and stable. Both the vector index and the lexical index need it.',
        '**Expand groups at query time.** Resolve the user to their transitive group memberships (groups contain groups) and pass that set as the filter. Cache the expansion per user with a short TTL -- seconds to a couple of minutes -- and be explicit that the TTL is your revocation lag.',
        '**Filter inside traversal.** Qdrant payload filters with filterable HNSW, Elasticsearch filtered kNN, pgvector with a `WHERE` clause plus `iterative_scan`. Never a post-hoc `.filter()` in application code.',
        '**Handle deny rules deliberately.** Most systems model allow-lists. If your product supports explicit denies, they cannot be expressed as a set intersection and usually need a second exclusion filter — get this right at design time, because retrofitting it is painful.',
        '**Re-check authorisation before rendering.** Defence in depth: the index is eventually consistent, so verify the final cited documents against the live authoritative check. Cheap, because it is only 4-8 documents.',
        '**Treat permission changes as high-priority index updates** with a measured lag SLO, an alert, and a canary that continuously measures revocation-to-invisibility time.',
        '**Test it in CI.** A suite of cross-tenant and cross-team queries that must return zero results. This is the only failure in the topic that is a security incident rather than a quality issue.'
      ]
    },
    {
      t: 'note',
      tone: 'danger',
      title: 'The staleness window is a real, quantifiable exposure',
      md: `Between "access revoked in the identity system" and "the index and the group-expansion
cache reflect it", the user can still retrieve. Three timers stack: the ACL propagation delay
into the index, the group-expansion cache TTL, and any response or semantic cache keyed by
query alone. Write those numbers down and add them up -- that sum is your exposure window, and
security review will ask for it. Mitigations: short cache TTLs, event-driven ACL invalidation,
a live authorisation check before render, and never sharing a semantic cache across principals.`
    },
    {
      t: 'code',
      lang: 'js',
      title: 'Permission filtering pushed into both retrievers',
      code: `// Group expansion is transitive: groups contain groups.
// The TTL here IS your revocation lag. Choose it, do not inherit it.
const groups = await groupCache.get(userId, { ttlSeconds: 60 },
  () => identity.expandTransitiveGroups(userId));

const aclFilter = {
  must: [
    { key: 'workspace_id', match: { value: workspaceId } },
    { key: 'acl_groups', match: { any: groups } }
  ],
  must_not: [
    { key: 'acl_denied_users', match: { any: [userId] } }   // explicit denies
  ]
};

// Same filter object goes to BOTH retrievers. A filter applied to only one
// leaks through the other, and the fused list hides which path it came from.
const [lex, vec] = await Promise.all([
  bm25Search(q, { limit: 100, filter: aclFilter }),
  vectorSearch(qv, { limit: 100, filter: aclFilter, efSearch: 128 })
]);

// Defence in depth: 4-8 docs, so the live check is cheap.
const top = await rerank(q, rrf([lex, vec]).slice(0, 50)).then(r => r.slice(0, 6));
const authorised = await authz.filterReadable(userId, top);
if (authorised.length < top.length) {
  metrics.increment('retrieval.acl_staleness_caught');   // alert on this
}`
    },

    { t: 'h', text: 'Graph and relational augmentation' },
    {
      t: 'prose',
      md: `Some questions are structural rather than semantic. "Which services depend on the auth
library and who owns them?" has no chunk containing the answer -- the answer is a traversal.
Similarly, "how many open P1s in the payments team" is an aggregate, and an LLM summarising ten
retrieved tickets will get the count wrong.

Two additions, in increasing order of cost. **Expand along known edges**: after retrieving a
chunk, pull its neighbours -- the adjacent chunks, the parent section, the documents it links
to, the ticket's linked issues. Cheap, no new infrastructure, and it fixes the common case
where the answer was one paragraph away. **Query the system of record**: route structural and
aggregate questions to a real query -- SQL, a graph traversal, a service API -- as a tool call,
and let the model narrate the result.

Full GraphRAG, where you build an entity-relationship graph over the corpus with an LLM and
traverse it at query time, is genuinely powerful for global questions ("what are the main
themes across these 10,000 documents") and is expensive to build and maintain. Reach for it
when you have evidence that multi-hop structural questions are a large share of your traffic,
not because it is interesting.`
    },

    { t: 'h', text: 'What actually moves the needle, in order' },
    {
      t: 'table',
      title: 'Priority order, assuming you are starting from dense-only retrieval',
      cols: ['#', 'Change', 'Typical impact', 'Effort', 'Why it ranks here'],
      rows: [
        ['1', 'Build a labelled retrieval eval set (questions → correct chunk IDs)', 'None directly', 'Days', 'Everything below is unmeasurable without it. You will otherwise optimise by anecdote.'],
        ['2', 'Fix ingestion and chunking (layout-aware parsing, structural chunks, heading breadcrumbs)', 'Often the largest single gain', 'Days to weeks', 'You cannot retrieve text that was destroyed or made contextless at ingest.'],
        ['3', 'Hybrid BM25 + vector with RRF', 'Large, especially on identifiers and rare terms', 'Days', 'Two uncorrelated failure profiles; fusion is ~15 lines of code.'],
        ['4', 'Cross-encoder reranking over 50 candidates', 'Large precision gain; usually the best quality-per-ms available', 'Days', 'Directly fixes the "retrieved but ranked 30th" failure.'],
        ['5', 'Query rewriting for conversational context', 'Large on multi-turn, zero on single-turn', 'Days', 'Follow-up questions are otherwise unsearchable.'],
        ['6', 'Metadata filters and recency boosting', 'Moderate; sometimes decisive for freshness-sensitive corpora', 'Days', 'Cheap, and it is also how permissions get enforced correctly.'],
        ['7', 'Contextual retrieval at ingest', 'Moderate to large on fragmentary corpora', 'Weeks + ingest cost', 'Real gain, real recurring bill. Try the free heading-breadcrumb version first.'],
        ['8', 'HyDE, multi-query, decomposition', 'Variable; sometimes negative', 'Days', 'Adds latency before the first token. Measure per query class rather than adopting globally.'],
        ['9', 'Fine-tuning the embedding model on your domain', 'Moderate', 'Weeks + full reindex', 'Real but expensive, and it commits you to a reindex on every model iteration.'],
        ['10', 'GraphRAG / entity graphs', 'Large for multi-hop structural questions only', 'Weeks to months', 'Powerful and heavy. Needs evidence from your query mix first.']
      ]
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      gains: [
        'Hybrid retrieval covers exact-match and semantic queries with uncorrelated failure modes.',
        'Reranking converts good recall into good precision without changing the index.',
        'Query rewriting makes conversational follow-ups searchable at all.',
        'Index-level permission filtering is both correct and fast, and it is the only defensible design for multi-tenant products.',
        'Every stage is independently measurable, so improvements are attributable.'
      ],
      costs: [
        'Each stage adds latency ahead of the first token, where users feel it most.',
        'More moving parts: a lexical index, a reranker service, a rewriter model, each with its own failure and on-call surface.',
        'Fusion and reranking make relevance harder to explain and debug for a single query.',
        'Contextual retrieval and embedding fine-tuning carry recurring ingest costs paid again on every reindex.',
        'ACL denormalisation creates a staleness window you must quantify and defend.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'ACL filter applied to the vector index but not the lexical one', blast: 'Unauthorised documents enter the fused list; the fusion step hides which retriever surfaced them.', fix: 'One filter object constructed once and passed to every retriever; a CI suite of cross-tenant queries asserting zero results.' },
        { mode: 'Retrieving only top 10 from each list before RRF', blast: 'Fusion cannot promote a document ranked 40th by one retriever and 2nd by the other — exactly the case hybrid search exists for.', fix: 'Retrieve 50-100 per retriever; measure recall@50 pre-fusion and recall@5 post-rerank separately.' },
        { mode: 'Reranker latency in the critical path with no timeout', blast: 'A provider slowdown becomes a full retrieval outage, and TTFT collapses for every user.', fix: 'Hard timeout with fallback to fused RRF order; circuit breaker; track the fallback rate as a quality signal, not just an availability one.' },
        { mode: 'Group-expansion cache TTL treated as a performance setting', blast: 'Revoked users keep retrieving for the TTL duration; nobody has quantified the exposure.', fix: 'Treat the TTL as the revocation SLO; event-driven invalidation on membership change; live authorisation re-check before render.' },
        { mode: 'HyDE adopted globally without per-class measurement', blast: 'TTFT grows by a full generation round trip and recall drops on the query classes where the hypothetical answer is off-topic.', fix: 'A/B per query class against the labelled set; enable only where it measurably wins; run it in parallel with direct retrieval and fuse.' },
        { mode: 'Semantic or response cache shared across users', blast: 'One tenant\'s answer served to another. A data breach wearing a performance optimisation\'s clothes.', fix: 'Include the principal or the ACL group set in every cache key; never cache across authorisation boundaries.' },
        { mode: 'BM25 index tokenisation mismatched to the corpus', blast: 'Identifiers like `ERR_PAYMENT_4021` are split or stemmed away, removing the exact-match capability hybrid search was added to provide.', fix: 'Configure an analyser that preserves identifiers and code tokens; add exact-match test queries to the retrieval eval set.' }
      ]
    },

    {
      t: 'staff',
      md: `The weak answer to "how would you improve retrieval" is a list of techniques. The
strong answer is a diagnosis followed by an ordered plan with a measurement attached to each
step. What that sounds like:

- "Before I add anything, I want recall@50 and recall@5 on a labelled set. If recall@50 is
  already high, adding a better embedding model is wasted work -- the problem is ranking, and
  a cross-encoder over 50 candidates is the highest quality-per-millisecond change available."
- "Hybrid is not optional for this corpus. Users search by ticket ID and error code, and a
  bi-encoder cannot distinguish \`ERR_4021\` from \`ERR_4022\`. I would fuse BM25 and vector with
  RRF at k=60, pulling 100 from each, because RRF can only promote what it can see."
- "RRF rewards agreement. A document ranked third by both retrievers beats a document ranked
  first by one, which is exactly the behaviour we want -- it suppresses the single-retriever
  false positive that each system produces on its own."
- "Permissions are a retrieval-time filter, never a post-filter. Post-filtering gives a user in
  a small workspace an empty page and we would spend a quarter calling that a relevance bug.
  ACLs get denormalised into both indexes, group expansion is transitive, and the same filter
  object goes to every retriever."
- "My revocation exposure is the sum of three timers: ACL propagation into the index, the
  group-expansion cache TTL, and the response cache TTL. I would write that number down,
  defend it in security review, and add a canary that measures revocation-to-invisibility
  continuously rather than asserting it."
- "The reranker gets a hard timeout and falls back to fused RRF order. It is a third-party
  dependency in the critical path, and I would rather serve slightly worse ranking than turn a
  provider blip into a retrieval outage. The fallback rate is a monitored quality metric."

The signal is prioritisation with evidence, and treating permission-aware retrieval as
architecture rather than a \`WHERE\` clause someone will add later.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'Under RRF with k=60, document A is rank 1 in BM25 and absent from the vector list; document B is rank 4 in BM25 and rank 3 in the vector list. Which ranks higher and why?',
          options: [
            'A, because a rank-1 hit is the strongest possible signal.',
            'B, because 1/64 + 1/63 ≈ 0.0315 exceeds A\'s 1/61 ≈ 0.0164 — RRF rewards cross-retriever agreement over a single top hit.',
            'They tie, because RRF normalises per list.',
            'A, because absent documents receive a default mid-list score.'
          ],
          answer: 1,
          why: 'The reciprocal with k=60 deliberately flattens the top of each list: rank 1 and rank 4 differ by under 5%. So two moderate placements comfortably outweigh one first place. That is the design intent — each retriever produces confident false positives that the other does not share, and agreement is a better relevance signal than either list\'s top hit. Absent documents contribute exactly zero.'
        },
        {
          q: 'A multi-tenant assistant applies the workspace filter to the vector search but the lexical search runs unfiltered, with results filtered in application code after fusion. What is the most serious consequence?',
          options: [
            'Slightly higher latency from over-fetching.',
            'Cross-tenant content reaches the fused candidate list and can be reranked, summarised or counted before it is removed — a data leak that post-filtering does not prevent.',
            'RRF scores become incomparable between the two lists.',
            'BM25 scores need renormalising.'
          ],
          answer: 1,
          why: 'Post-filtering is not a boundary. Anything in the candidate list has already been read by your reranker and may influence downstream steps, and even the removal itself leaks information through result counts and timing. Permission predicates must be pushed into every retriever, with one filter object constructed once so an unfiltered path cannot be added by accident, plus a CI suite of cross-tenant queries that must return zero results.'
        },
        {
          q: 'Recall@50 is 0.93, recall@5 after reranking is 0.91, and answer quality is still poor. What should you investigate next?',
          options: [
            'Add HyDE and multi-query expansion.',
            'Retrieval is performing well, so shift focus to generation: chunk completeness, prompt construction, context ordering and model behaviour.',
            'Increase `efSearch` and retrieve 200 candidates.',
            'Fine-tune the embedding model on your domain.'
          ],
          answer: 1,
          why: 'Both retrieval numbers are strong and close together, so neither recall nor ranking is the bottleneck — more retrieval work has almost no headroom to recover. The remaining suspects are downstream: chunks that contain the answer but not the qualifying exception, too many chunks diluting attention, ordering that buries the best passage in the middle, or a prompt that does not force grounding. This is exactly why the two eval suites are kept separate.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `This topic assumes the pipeline and chunking decisions from **RAG: The Reference
Architecture** and the index internals from **Embeddings & Vector Search**. The labelled
retrieval set and recall gating belong to **Evaluation & Quality Regression**. Permission
staleness and cross-tenant cache keys connect to **AI Security & Guardrails**, and the
per-stage latency budget is a **Context Engineering** and **AI Product & UX Architecture**
concern once you account for TTFT.`
      }]
    }
  ],

  flashcards: [
    { q: 'Write the RRF formula and explain the constant.', a: '`RRF(d) = Σ_r 1/(k + rank_r(d))`, conventionally k=60, with absent documents contributing 0. The constant flattens the top of each list — rank 1 and rank 4 differ by under 5% — so cross-retriever agreement beats a single retriever\'s top hit, which suppresses each system\'s confident false positives.' },
    { q: 'Why can a cross-encoder not be your primary retriever?', a: 'It scores query and document jointly in one forward pass, so cost is O(candidates) model invocations per query and nothing can be precomputed. Bi-encoders precompute document vectors and index them, which is what makes sub-linear search possible. Hence retrieve wide with a bi-encoder, rerank narrow with a cross-encoder.' },
    { q: 'Why does dense retrieval fail on identifiers like `ERR_PAYMENT_4021`?', a: 'Embeddings compress meaning and discard rarity, but rarity is exactly the signal an identifier carries. The encoder has likely never seen the token, so it returns topically-related payment-error documents and cannot distinguish 4021 from 4022. BM25\'s IDF term does exactly the opposite, which is why hybrid works.' },
    { q: 'Why retrieve 100 per list rather than 10 before RRF?', a: 'Fusion can only promote documents it can see. The case hybrid search exists for — rank 80 in one retriever, rank 3 in the other — is invisible if you truncate at 10. Deep retrieval then aggressive reranking is the shape.' },
    { q: 'What is contextual retrieval?', a: 'At ingest, a cheap model writes one or two sentences situating each chunk in its parent document, prepended before embedding and lexical indexing. It makes chunks like "Revenue grew 3%" retrievable by naming the company and quarter. Costs one call per chunk, heavily mitigated by prompt-prefix caching; the free approximation is prepending the heading breadcrumb.' },
    { q: 'Why is post-filtering permissions a security problem, not a performance one?', a: 'Unauthorised content has already entered the candidate list, been read by the reranker, and can influence summarisation and counts before removal. Timing and result counts leak too. And with a selective ACL the user sees an almost-empty page, which teams misdiagnose as a relevance bug for months.' },
    { q: 'What three timers make up your permission revocation exposure window?', a: 'ACL propagation lag into the index, the group-expansion cache TTL, and any response or semantic cache TTL. Add them up — that sum is the window during which a revoked user can still retrieve. Mitigate with event-driven invalidation, short TTLs, principal-scoped cache keys, and a live authorisation check before render.' },
    { q: 'What does HyDE do and when is it worth the latency?', a: 'It has the model write a hypothetical answer, embeds that, and searches with it — a hypothetical answer sits nearer real documents in embedding space than a question does. Worth it when query and document language diverge sharply; it costs a full generation round trip before the first token and can pull retrieval off-topic, so measure per query class.' },
    { q: 'In priority order, what are the first four things to fix in a dense-only RAG system?', a: '1) Build a labelled retrieval eval set — nothing below is measurable without it. 2) Fix ingestion and chunking, usually the largest single gain. 3) Add hybrid BM25 + vector with RRF. 4) Add cross-encoder reranking over ~50 candidates. Model swaps and GraphRAG come much later.' }
  ],

  drills: [
    {
      prompt: 'An engineering knowledge assistant covering code, runbooks, incident reports and tickets is at 0.62 recall@10. Users complain most about queries containing error codes, service names and ticket IDs. You have a two-week window and a 1.2 s p95 retrieval budget.',
      probes: [
        'What is your first change and why that one?',
        'How do you know the reranker earned its latency?',
        'What do you do about the 1.2 s budget as you add stages?',
        'What would you explicitly not do in two weeks?'
      ],
      strong: [
        'Diagnoses the complaint pattern as the classic dense-retrieval weakness on rare, high-information tokens, and ships hybrid BM25 + vector with RRF first.',
        'Checks BM25 analyser configuration specifically, noting that default tokenisation often destroys `ERR_4021` and `payments-svc` — and adds exact-match cases to the eval set.',
        'Retrieves 100 per list and states why shallow retrieval defeats fusion.',
        'Adds a cross-encoder over ~50 candidates and measures recall@5 before and after, with the reranker behind a timeout and a fallback to RRF order.',
        'Builds or extends the labelled eval set from real failing queries before making changes, and reports recall@50 and recall@5 separately.',
        'Manages the latency budget explicitly: parallel retrievers, a single batched reranker call, and a stated per-stage budget summing under 1.2 s.',
        'Defers embedding fine-tuning and GraphRAG with a reason, not just a shrug.'
      ],
      weak: [
        'Proposes a bigger embedding model as the first move.',
        'Adds HyDE, multi-query and decomposition simultaneously with no per-class measurement.',
        'Retrieves 10 from each list and fuses.',
        'No latency accounting as stages are added.',
        'Measures success by trying a few queries by hand.'
      ]
    },
    {
      prompt: 'You are adding retrieval to a product where documents have per-document ACLs, users belong to nested groups, and sharing changes hundreds of times a day. Security requires that a revoked user cannot retrieve content within 60 seconds, demonstrably. Design the retrieval path.',
      probes: [
        'Where does the ACL live and how does it get there?',
        'What exactly is your exposure window, as a number?',
        'How do you demonstrate the 60-second guarantee continuously?',
        'What happens to caching?'
      ],
      strong: [
        'Denormalises group-based ACLs into both the vector and lexical indexes, and passes one filter object to every retriever.',
        'Uses group IDs rather than user IDs to keep the per-chunk set small and stable, with transitive group expansion at query time.',
        'Quantifies the exposure window as the sum of ACL propagation lag, group-cache TTL and response-cache TTL, and sizes each so the total is comfortably under 60 s.',
        'Adds event-driven invalidation on membership and share changes rather than relying on TTL expiry alone.',
        'Proposes a continuous canary: revoke a synthetic user\'s access on a schedule and measure time-to-invisibility, alerting on the p99 — demonstration rather than assertion.',
        'Includes the principal or ACL group set in every cache key and rules out cross-principal semantic caching explicitly.',
        'Keeps a live authorisation re-check on the final 4-8 documents as defence in depth, and instruments how often it catches something as a staleness signal.',
        'Handles explicit deny rules as a separate exclusion filter and notes they cannot be modelled as a set intersection.'
      ],
      weak: [
        'Filters permissions after retrieval.',
        'Relies on a nightly ACL sync.',
        'Caches responses keyed on query text alone.',
        'Asserts the 60-second guarantee with no continuous measurement.',
        'Forgets that the lexical index needs the same filter as the vector index.'
      ]
    }
  ]
};
