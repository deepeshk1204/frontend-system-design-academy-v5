/* Studios — Design permissioned RAG. See CONTENT-SCHEMA.md. */

export default {
  blocks: [
    {
      t: 'prose',
      md: `Permissioned RAG is a search product with a language model on the end -- and the
permission part is not optional. Enterprise buyers will ask whether an intern can retrieve the
CEO's compensation doc. If your ACL check runs after vector search, the answer is already in
the candidate set and you have a leak waiting for the right embedding.

This studio is the interview shape: hybrid retrieval, chunking that survives real PDFs, citations
users can trust, a golden eval set the VP can see, and a cost envelope that survives a demo
turning into production traffic.`
    },

    { t: 'h', text: 'ACL before search, not after' },
    {
      t: 'diagram',
      caption: 'Filters are part of retrieval traversal. Generation never sees forbidden chunks.',
      code: `flowchart LR
  Q["User query"] --> ACL["ACL hard filter<br/>metadata predicate"]
  ACL --> H["Hybrid retrieve<br/>BM25 plus vector"]
  H --> RR["Rerank top 8"]
  RR --> G["Generate with citations"]
  G --> C["Citation UX"]
  IX[("Index with acl_groups")] --> H`
    },
    {
      t: 'prose',
      md: `Denormalise \`acl_groups\`, \`workspace_id\`, or equivalent into every chunk record at
ingest. At query time, apply the user's allowed set as a **hard metadata filter during
retrieval** -- the same predicate on BM25 and vector paths before fusion. Post-filtering top-k
after ANN search is wrong: approximate nearest neighbour already surfaced forbidden text into
the candidate pool, and your logs may retain it.

Defence in depth: filter at retrieval, then re-check authorisation before rendering citations.
**Never answer from parameters the user cannot read** -- if a chunk failed the ACL predicate,
it must not appear in the prompt, the citation list, or a hidden chain-of-thought scratchpad.

Revocation is a delete-for-someone event with a lag SLO, not a nightly batch hope.`
    },
    {
      t: 'note',
      tone: 'danger',
      title: 'The question that ends deals',
      md: `Ask: "Show me what happens when a user searches immediately after losing access to a
workspace." If the design is filter-after-search or "we re-index weekly", you fail security
review regardless of answer quality.`
    },

    { t: 'h', text: 'Chunking and hybrid retrieval' },
    {
      t: 'prose',
      md: `Chunks are the atom of both embedding and citation. For wikis and policies, prefer
**heading-aware** splits with the breadcrumb prepended before embed: \`Refund Policy > EU >
Digital goods\` plus body. Fixed 1,000-token slices cut exceptions away from the rule they
belong to.

Retrieve **wide, rerank narrow**: hybrid **BM25 plus vector** with RRF for recall on exact
terms, ticket IDs, and error codes; dense search for paraphrase. Pull 50-100 candidates, rerank
to 4-8 with a cross-encoder, order best-first in the prompt. Dense-only loses the language
mismatch between how users ask and how engineers wrote the doc.`
    },
    {
      t: 'table',
      title: 'Product choices for permissioned corpora',
      cols: ['Decision', 'Staff default', 'Why'],
      rows: [
        ['ACL enforcement', 'Metadata filter during index traversal', 'Post-filter leaks into candidates and logs'],
        ['Retrieval', 'Hybrid BM25 + vector, RRF, then rerank', 'Exact tokens and paraphrase both required'],
        ['Chunking', 'Structural parent-child with heading path', 'Retrieval precision plus readable citations'],
        ['Grounding rule', 'Answer only from retrieved passages', 'No general knowledge for enterprise facts'],
        ['Low confidence', 'Threshold before generate; show sources', 'Confident wrong is worse than "not found"']
      ]
    },

    { t: 'h', text: 'Citation UX users actually trust' },
    {
      t: 'prose',
      md: `Citations are a UX and compliance feature, not decoration. Require stable short IDs
(\`[S2]\`) in model output; resolve to title, heading path, and deep link in your UI code. Do
not ask the model for URLs -- it will paraphrase them.

Show **quoted snippets** with highlight, source type icon, and \`updated_at\`. Let users expand
the full chunk. When the model refuses, show the top sources it did find so "I don't know" feels
grounded, not broken.

Post-generation, verify every cited ID exists and that the sentence supports the claim. Trend
**hallucinated citation rate** and **uncited factual sentence rate** as product metrics, not
one-off QA.`
    },
    {
      t: 'code',
      lang: 'js',
      title: 'Never leak via prompt assembly',
      code: `function buildPrompt(query, user, index) {
  const allowed = aclFor(user); // computed from identity, not client input
  const hits = index.hybridSearch(query, {
    filter: { acl_groups: { $in: allowed } }, // hard filter BEFORE top-k
    k: 80
  });
  const top = rerank(query, hits).slice(0, 6);
  // If a chunk is not in top, it does not exist for the model.
  return groundingTemplate(query, top.map(toSourceBlock));
}`
    },

    { t: 'h', text: 'Eval golden set and cost envelope' },
    {
      t: 'prose',
      md: `Ship two eval suites before tuning prompts. **Retrieval eval**: 150-300 real questions
labelled with chunk IDs that contain the answer -- recall@50, recall@8, MRR. Runs in CI without
an LLM. **Generation eval**: same questions with gold passages injected -- faithfulness,
citation validity, refusal on unanswerable items.

The **golden set** is a contract with legal and the VP: "We will not regress below this recall
on ACL-filtered queries." Include cross-tenant probes -- user A must never retrieve user B's
labels.

**Cost envelope**: estimate per-query as embed plus (retrieval candidates) plus (rerank calls)
plus (prompt tokens times price) plus (output tokens). Set per-tenant daily caps, cache embeds
for repeated questions, and prefix-cache the system prompt. Present leadership a table: p50,
p95 cost at expected QPS, and what happens at 3x traffic without caps.`
    },
    {
      t: 'numbers',
      title: 'Starting envelope math',
      items: [
        { v: '50-100', k: 'Hybrid candidates', note: 'Recall pass before rerank' },
        { v: '4-8', k: 'Chunks in prompt', note: 'Past this, faithfulness drops' },
        { v: '150+', k: 'Golden retrieval questions', note: 'Including ACL negative cases' },
        { v: '$0.02-0.15', k: 'Target per query band', note: 'Tune with caps and caching' }
      ]
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      gains: [
        'Answers grounded in current, private docs with enforceable permissions.',
        'Citations give auditability -- compliance teams can click through.',
        'Hybrid retrieval fixes the exact-token failures dense-only hides.',
        'Split eval lets you improve retrieval without swapping models.',
        'Cost envelope is defensible when tied to caps and cached embeds.'
      ],
      costs: [
        'ACL denormalisation and revocation lag are ongoing index obligations.',
        'Hybrid plus rerank adds tens to hundreds of ms before first token.',
        'Golden set labelling is expensive and must include security cases.',
        'Chunking mistakes are silent until eval or a user complaint.',
        'Refusal and low-confidence UX feel worse than a chatbot that guesses.',
        'Every indexed copy duplicates data subject to deletion requests.'
      ]
    },

    { t: 'h', text: 'Failure modes' },
    {
      t: 'failures',
      title: 'Permissioned RAG in production',
      items: [
        { mode: '**ACL post-filter after ANN**', blast: 'Forbidden chunk appeared in logs, traces, or reranker input.', fix: 'Metadata predicate during traversal on both lexical and vector paths; cross-tenant tests in CI.' },
        { mode: '**Answer from params user cannot read**', blast: 'Model cites a title the user cannot open -- trust and audit failure.', fix: 'Only inject chunks that passed ACL; resolve citation links with same check; no hidden context.' },
        { mode: '**Chunk split the exception**', blast: 'Confident answer missing the "unless" clause one chunk away.', fix: 'Heading-aware parent-child; eval labels spanning chunk boundaries.' },
        { mode: '**Dense-only on ticket IDs and SKUs**', blast: 'Paraphrase works; exact lookup fails.', fix: 'Hybrid BM25 + vector; measure recall on exact-match subset of golden set.' },
        { mode: '**No confidence gate**', blast: 'Fluent fabrication when retrieval missed.', fix: 'Reranker score threshold; refusal copy; unanswerable questions in eval.' },
        { mode: '**Cost cliff at launch**', blast: 'Demo QPS times full rerank plus long context bankrupts the SKU.', fix: 'Per-tenant caps, embed cache, smaller rerank on tail, nightly cost alarms on p95 tokens.' }
      ]
    },

    {
      t: 'staff',
      md: `Lead with security and measurement, not embeddings.

- "ACL is a filter during retrieval traversal on both BM25 and vector legs. Post-filter is a
  leak. I have cross-tenant cases in the golden set to prove it."
- "Nothing enters the prompt the user could not read themselves -- citations included. Prompt
  assembly is server-side with identity-derived ACL, not client-supplied doc IDs."
- "Hybrid for recall, rerank for precision, 4-8 chunks best-first. I evaluate retrieval and
  generation separately so I know which knob to turn."
- "Citations are [S3] IDs resolved in code; I verify they exist and support the claim. URLs
  from the model are untrusted strings."
- "I ship a cost envelope: embed plus rerank plus prompt tokens at expected QPS, with caps and
  caches, before the VP signs traffic."
- "Low confidence is a product state -- show sources, refuse to invent -- not a smaller model
  hope."

That framing says you have shipped enterprise search, not a notebook demo.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'User loses access to workspace W. Within five minutes they must not see W content in answers or citations. Best design?',
          options: [
            'Filter search results in the UI after generation.',
            'Propagate ACL revocation into index metadata and apply hard filters during retrieval, plus render-time check; measure lag with canary revokes.',
            'Tell the model not to use W in the system prompt.',
            'Re-embed the entire corpus nightly.'
          ],
          answer: 1,
          why: 'UI filtering is too late -- forbidden text may already be in the prompt, logs, and caches. Prompt instructions are not enforcement. Nightly re-index violates a five-minute SLO. Event-driven ACL updates on chunk metadata plus filter-at-traversal, with lag metrics and canary tests, is the auditable answer.'
        },
        {
          q: 'Retrieval recall@50 is high but users say answers miss policy exceptions. First investigation?',
          options: [
            'Switch to a larger LLM.',
            'Inspect chunk boundaries and parent-child retrieval on labelled questions where the exception span crosses chunks.',
            'Raise k to 40.',
            'Remove BM25 and go dense-only.'
          ],
          answer: 1,
          why: 'High recall@50 means the right material is usually in the candidate set -- the failure is often chunking (exception separated from rule) or parent not returned after child hit. Larger models and higher k do not rejoin split clauses. Dense-only worsens exact-match cases common in policy text.'
        },
        {
          q: 'Why hybrid BM25 plus vector instead of vector alone for an internal doc assistant?',
          options: [
            'BM25 is cheaper to store.',
            'Users ask with support language while docs use product codes, ticket IDs, and legal terms -- lexical match catches what embeddings miss.',
            'Vectors cannot represent PDFs.',
            'Hybrid is required by regulation.'
          ],
          answer: 1,
          why: 'Enterprise corpora are full of exact tokens and mismatched vocabulary between questions and docs. Dense retrieval excels at paraphrase but misses rare strings BM25 finds instantly. RRF fusion is the standard production compromise; either alone fails a slice of real queries measurable on a golden set.'
        },
        {
          q: 'What belongs in the VP-facing cost envelope?',
          options: [
            'Only LLM output token price.',
            'Per-query embed, retrieval, rerank, and generation at p50 and p95, times expected QPS, with cap behaviour at 3x traffic.',
            'Monthly GPU rental for self-hosted models only.',
            'Engineering headcount for labelling.'
          ],
          answer: 1,
          why: 'Leadership needs total marginal cost per successful query at realistic traffic, including the retrieval stack, not just generation. p95 matters because long answers and rerank dominate bills. Showing cap and cache behaviour at 3x traffic proves the SKU survives success.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics',
      blocks: [{
        t: 'prose',
        md: `Pipeline depth lives in **RAG Architecture** and **Advanced Retrieval**. Vector index
internals are in **Embeddings & Vector Search**. Eval methodology connects to **Evaluation &
Quality Regression**. Injection via retrieved docs is **AI Security & Guardrails**.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why filter ACL during retrieval, not after?', a: 'Post-filter runs after ANN or top-k already selected forbidden chunks into candidates, logs, and rerankers. Hard metadata predicates during traversal on both BM25 and vector paths keep forbidden text out of the pipeline entirely.' },
    { q: 'What does "never answer from unreadable params" mean?', a: 'Only chunks passing the user\'s ACL enter the prompt and citation list. Server-side assembly uses identity-derived filters, not client doc IDs. Hidden context and unresolved citations must pass the same authorisation check.' },
    { q: 'Why hybrid BM25 plus vector in production RAG?', a: 'Dense search handles paraphrase; BM25 handles exact tokens, SKUs, error codes, and vocabulary mismatch between questions and docs. RRF fusion improves recall before reranking.' },
    { q: 'What is the golden set for permissioned RAG?', a: 'Labelled questions with chunk IDs, including cross-tenant negatives proving user A never retrieves user B\'s content. Retrieval metrics gate CI; generation metrics hold passages fixed.' },
    { q: 'How should citations work in the UX?', a: 'Model emits stable [S] IDs; UI resolves title, heading, date, and deep link. Show snippet highlights. Verify IDs post-generation. Never trust model-generated URLs.' },
    { q: 'What is the cost envelope?', a: 'Per-query estimate: embed plus candidate retrieval plus rerank plus prompt and output tokens at p50/p95, scaled to QPS, with tenant caps and caches. Presented before production traffic commits.' },
    { q: 'When should the product refuse to answer?', a: 'When reranker scores fall below a calibrated threshold or no chunk supports the claim. Show found sources with low-confidence copy instead of generating from general knowledge.' },
    { q: 'Why heading-aware parent-child chunking?', a: 'Small children embed precisely for retrieval; parents provide context for generation and citations. Heading breadcrumbs fix chunks that start with "This exception..." without naming the subject.' }
  ],

  drills: [
    {
      prompt: 'Legal wants an assistant over 200K Confluence pages and PDF policies. SOC2 requires provable ACL, citations for every factual sentence, and deletion within 24 hours. Budget: $0.08 per query at 500 QPS peak. Design the retrieval and governance loop.',
      probes: [
        'Where exactly is ACL enforced?',
        'How do you prove deletion and revocation?',
        'What is in the golden set beyond happy-path Q&A?',
        'How do you stay inside $0.08 at peak?'
      ],
      strong: [
        'ACL denormalised at ingest; hard filter on both index legs before fusion.',
        'Never inject chunks the user cannot open; citation links re-check authorisation.',
        'Hybrid BM25 + vector, rerank to 6, confidence gate and refusal UX.',
        'Golden set includes cross-tenant negatives and unanswerable questions.',
        'Deletion propagates to vector and lexical indexes with lag SLO and reconciliation.',
        'Cost model: cached query embeds, prefix cache, rerank only on top 80, token budget per answer.',
        'Separate retrieval CI (recall@k) from nightly generation faithfulness eval.'
      ],
      weak: [
        'Post-filter search results or rely on prompt "only use allowed docs".',
        'Client-supplied document IDs in the API.',
        'Dense-only with k=20 and no reranker or eval.',
        'Weekly full re-index as the deletion story.',
        'No citation verification or cost math at 500 QPS.'
      ]
    },
    {
      prompt: 'Support says the bot "quoted the old refund policy" three weeks after legal published an update. Trace the failure and fix the system, not the prompt.',
      probes: [
        'Is this retrieval, index lag, or generation?',
        'How do you detect it before support does?',
        'What SLO do you publish internally?'
      ],
      strong: [
        'Diagnoses index lag or failed incremental re-index, not model hallucination.',
        'Change-feed or webhook driven re-chunk and re-embed on doc update; content_hash skip unchanged.',
        'Hard-delete old chunks on publish, not render-time hide.',
        'Monitor max index lag per doc type; alert when lag exceeds SLA.',
        'Golden set includes versioned policy questions with expected chunk dates.',
        'Citation UX shows updated_at so users spot staleness.'
      ],
      weak: [
        'Adds "prefer recent documents" to system prompt only.',
        'Blames the LLM and swaps models.',
        'Full corpus re-embed weekly without event-driven updates.',
        'No metric for propagation delay from source to index.'
      ]
    }
  ]
};
