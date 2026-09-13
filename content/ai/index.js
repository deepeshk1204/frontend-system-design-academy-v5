export default {
  id: 'ai',
  short: 'ai',
  name: 'AI Engineering',
  tagline: 'The model is 10% of the system. This track is the other 90%.',
  blurb: `"AI-enabled Staff engineer" does not mean you can call an API. It means you can put a
non-deterministic, expensive, occasionally-wrong component into a production system and still
make promises about correctness, latency, cost and security. This track goes from tokens to a
multi-tenant AI platform.`,
  topics: [
    { id: 'llm-fundamentals', title: 'LLM Fundamentals for Engineers', level: 'foundation', minutes: 19, summary: 'Tokens, context windows, sampling, why latency is two different numbers, and what the model cannot know.', tags: ['tokens', 'context', 'sampling', 'latency'], load: () => import('./llm-fundamentals.js') },
    { id: 'prompting-and-structured-output', title: 'Prompting & Structured Output', level: 'foundation', minutes: 18, summary: 'System prompts as code, JSON schema and constrained decoding, validation and repair loops.', tags: ['prompting', 'JSON schema', 'validation', 'function calling'], load: () => import('./prompting-and-structured-output.js') },
    { id: 'embeddings-and-vector-search', title: 'Embeddings & Vector Search', level: 'core', minutes: 20, summary: 'What a vector actually encodes, ANN indexes, HNSW vs IVF, recall/latency trade-offs, pgvector.', tags: ['embeddings', 'HNSW', 'ANN', 'pgvector'], load: () => import('./embeddings-and-vector-search.js') },
    { id: 'rag-architecture', title: 'RAG: The Reference Architecture', level: 'core', minutes: 22, summary: 'Ingest, chunk, index, retrieve, rerank, ground, cite -- and the eight places it silently fails.', tags: ['RAG', 'chunking', 'citations', 'grounding'], load: () => import('./rag-architecture.js') },
    { id: 'advanced-retrieval', title: 'Advanced Retrieval', level: 'staff', minutes: 20, summary: 'Hybrid search and RRF, rerankers, query rewriting, metadata filters, and permission-aware retrieval.', tags: ['hybrid search', 'reranking', 'BM25', 'ACL'], load: () => import('./advanced-retrieval.js') },
    { id: 'context-engineering', title: 'Context Engineering', level: 'staff', minutes: 19, summary: 'The context window as a scarce, contended resource. Compaction, memory, and lost-in-the-middle.', tags: ['context', 'memory', 'compaction', 'caching'], load: () => import('./context-engineering.js') },
    { id: 'tool-calling', title: 'Tool Calling & Typed Actions', level: 'core', minutes: 19, summary: 'Tools as an API surface for a stochastic caller: schemas, idempotency, errors the model can act on.', tags: ['tool calling', 'MCP', 'schemas', 'idempotency'], load: () => import('./tool-calling.js') },
    { id: 'agent-architecture', title: 'Agent Architecture', level: 'staff', minutes: 22, summary: 'Loops, planning, state, multi-agent patterns, step budgets, and bounded authority.', tags: ['agents', 'planning', 'multi-agent', 'guardrails'], load: () => import('./agent-architecture.js') },
    { id: 'evaluation', title: 'Evaluation & Quality Regression', level: 'staff', minutes: 21, summary: 'Golden sets, LLM-as-judge and its biases, retrieval vs generation metrics, evals in CI.', tags: ['evals', 'LLM-as-judge', 'CI', 'metrics'], load: () => import('./evaluation.js') },
    { id: 'ai-observability', title: 'AI Observability & Tracing', level: 'core', minutes: 18, summary: 'Spans for prompts and retrievals, token accounting, quality telemetry, and feedback you can trust.', tags: ['tracing', 'OpenTelemetry', 'cost', 'feedback'], load: () => import('./ai-observability.js') },
    { id: 'inference-serving', title: 'Inference Serving & Performance', level: 'staff', minutes: 21, summary: 'KV cache, continuous batching, TTFT vs throughput, quantisation, and GPU capacity planning.', tags: ['vLLM', 'KV cache', 'batching', 'quantisation'], load: () => import('./inference-serving.js') },
    { id: 'model-routing-and-cost', title: 'Model Routing, Caching & Cost Control', level: 'staff', minutes: 19, summary: 'Cascades, semantic and prefix caching, per-tenant budgets, and provider failover.', tags: ['routing', 'cost', 'caching', 'failover'], load: () => import('./model-routing-and-cost.js') },
    { id: 'finetuning-and-adaptation', title: 'Fine-Tuning, LoRA & Distillation', level: 'staff', minutes: 19, summary: 'When weights are the right answer, what SFT/DPO actually change, and serving many adapters.', tags: ['fine-tuning', 'LoRA', 'DPO', 'distillation'], load: () => import('./finetuning-and-adaptation.js') },
    { id: 'ai-security', title: 'AI Security & Guardrails', level: 'staff', minutes: 21, summary: 'Prompt injection as a confused-deputy problem, the lethal trifecta, PII, and output-side controls.', tags: ['prompt injection', 'guardrails', 'PII', 'authorisation'], load: () => import('./ai-security.js') },
    { id: 'ai-product-ux', title: 'AI Product & UX Architecture', level: 'core', minutes: 18, summary: 'Streaming, latency masking, uncertainty, citations, undo, and designing for being wrong.', tags: ['streaming', 'UX', 'trust', 'feedback'], load: () => import('./ai-product-ux.js') },
    { id: 'ai-platform-architecture', title: 'Capstone: An AI Platform', level: 'staff', minutes: 24, summary: 'Gateway, router, retrieval, tool runtime, evals and governance for many teams and tenants.', tags: ['platform', 'gateway', 'multi-tenant', 'governance'], load: () => import('./ai-platform-architecture.js') }
  ]
};
