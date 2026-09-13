# AI Engineering — Staff cheatsheet

Spoken-answer fragments from each topic. Generated; the full argument is in the topic.

## LLM Fundamentals for Engineers

The junior version of this topic is "LLMs predict the next token". The Staff version
is using that fact to make engineering decisions out loud. Sentences that land:

- "We need two latency SLOs, not one. TTFT is prefill and scales with our prompt size, so it is
  a *context budget* problem; inter-token latency is decode and is bandwidth-bound, so it is a
  *model choice* problem. One dashboard number hides which lever to pull."
- "Temperature 0 gives us reproducible *intent*, not reproducible *bytes*. GPU reductions are
  non-associative and batch composition varies, so I would never assert exact output in a test.
  Our regression gate is an eval suite with a score threshold."
- "Hallucination is not a bug we can patch out, it is what maximising plausibility looks like
  when the model has no fact to draw on. So we spend our effort on grounding, schema
  constraints, citation verification and a rewarded refusal path -- and we design the UI so a
  wrong answer costs the user one click, not an incident."
- "Before we launch in Japan I want tokens-per-request measured per locale. The same prompt can
  cost two to four times more, which moves unit economics without a code change."
- "Anything with a timestamp comes from a tool call. Weights are a frozen snapshot, and the
  model has no way to know it is out of date -- so we inject the current date and route
  time-sensitive intents to retrieval."

The signal in all of these is the same: you reason from the mechanism to the operational
control. Naming the prefill/decode split unprompted, and the determinism caveat, is the
fastest way to show you have run one of these in production rather than read the docs.

## Prompting & Structured Output

Anyone can say "we use JSON mode". The Staff-level version is treating the prompt as a
deployable artefact with a blast radius. Sentences that carry weight:

- "The prompt is a module in the repo with a version number, a pinned model string and a
  changelog, and every trace carries `promptVersion`. Otherwise, when quality drops in six
  weeks, we cannot answer 'what changed', which is the only question anyone will ask."
- "JSON mode guarantees it parses. It does not guarantee the enum values are legal or the order
  ID exists. We use constrained decoding for shape and a Zod schema for semantics, and nothing
  reaches business logic without passing the validator."
- "Every enum gets an `other` member and every extracted identifier is nullable. A required
  field is an instruction to fabricate, and a fabricated value that is well-typed is worse than
  a parse error because nothing downstream will question it."
- "One repair turn, then a deterministic fallback. Unbounded retries convert a bad-input class
  into a latency cliff, and the repair rate is one of our best leading indicators of quality."
- "Reasoning fields come before decision fields in the schema, because JSON is generated in
  order. Put the rationale after the label and you have paid for chain of thought and received
  a rationalisation."
- "We do not change the prompt and the model version in the same rollout. Provider aliases move
  on their own, so the model string is pinned in the prompt module and a model upgrade is its
  own experiment with its own eval run."

The pattern: name the guarantee each layer actually provides, name what it does not, and name
the bounded fallback. Bringing up prefix-cache-friendly prompt ordering, or the fact that
enum-with-no-escape converts uncertainty into confident error, marks someone who has operated
this rather than integrated it once.

## Embeddings & Vector Search

The tell for depth here is whether someone treats the index as a tuned system with a
measured operating point, or as a black box that "does semantic search". Sentences that land:

- "What is our recall@10, and at what p95? If we cannot answer that, we do not know what we are
  serving. I want a golden query set with exact-scan ground truth and that number in CI."
- "`efSearch` is per-query, so we run `ef=32` for the typeahead and `ef=128` for the RAG
  retrieval out of the same index -- and we can shed load by lowering it instead of dropping
  requests. `M` is the one we cannot change without a rebuild, so that is the decision to get
  right up front."
- "At 20M by 1536 dimensions, float32 is about 123 GB before graph overhead. That is a
  memory-cost decision, not a storage decision. I would take binary quantisation in RAM for
  traversal with a full-precision rerank of the top 200 off NVMe -- roughly 10 GB resident
  instead of 128."
- "Permissions get denormalised into the index and filtered during traversal. Post-filtering an
  ACL is not slow, it is *wrong*: a user in a small workspace gets an empty page and we would
  read that as a relevance bug for months."
- "Changing the embedding model is a full reindex with no partial path, because vectors from
  two models are not comparable and a mixed index fails silently. Blue/green with a version tag
  per vector, recall comparison on the golden set, then flip the alias."
- "I would start on pgvector. The chunk, its ACL and the source row update in one transaction,
  which removes an entire class of dual-write bugs around deletes and permission changes. We
  move to a dedicated store when we have a number that says we must."

Two things distinguish the strongest answers: they quote memory arithmetic without being asked,
and they treat filtering as a correctness problem rather than a performance one.

## RAG: The Reference Architecture

The question "how would you build RAG" is really "do you know that RAG is a search
problem". Sentences that separate the two answers:

- "First thing I would build is not the pipeline, it is two eval sets. One maps questions to
  the chunk IDs that contain the answer, which gives me recall@k with no LLM in the loop and
  runs in CI. The other holds retrieval fixed and measures faithfulness. Without that split,
  when quality drops nobody can say whether the retriever missed it or the model ignored it,
  and those have opposite fixes."
- "Before tuning anything, I want to read the raw extracted text for fifty documents. In every
  project I have done, that finds at least one source type that was silently mangled -- a
  two-column PDF interleaved or a table flattened. You cannot retrieve what was destroyed at
  ingest."
- "Retrieve wide, rerank narrow. 50-100 candidates from hybrid search for recall, a
  cross-encoder down to 4-8 for precision, ordered best-first. If recall@50 is high and
  recall@5 is low, that is a ranking problem and swapping the embedding model will not touch
  it."
- "Citations reference `[S3]`, not URLs, and my code resolves the ID. Then I verify every
  cited ID exists after generation. Asking the model for a URL is asking it to generate a
  string that looks like a URL."
- "There is a confidence gate before generation. If the top reranker score is under the
  threshold we calibrated, we do not generate -- we show what we found and say we are not
  sure. A model given five irrelevant passages will still write you a confident answer."
- "ACLs are denormalised into the index and filtered during traversal, and revocation has a
  lag SLO. Post-filtering permissions is not a performance choice, it is a leak waiting for the
  right query."

The unifying signal: treating retrieval as the system and the LLM as the last, least
interesting step -- and naming the detection signal for each failure rather than just the fix.

## Advanced Retrieval

The weak answer to "how would you improve retrieval" is a list of techniques. The
strong answer is a diagnosis followed by an ordered plan with a measurement attached to each
step. What that sounds like:

- "Before I add anything, I want recall@50 and recall@5 on a labelled set. If recall@50 is
  already high, adding a better embedding model is wasted work -- the problem is ranking, and
  a cross-encoder over 50 candidates is the highest quality-per-millisecond change available."
- "Hybrid is not optional for this corpus. Users search by ticket ID and error code, and a
  bi-encoder cannot distinguish `ERR_4021` from `ERR_4022`. I would fuse BM25 and vector with
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
architecture rather than a `WHERE` clause someone will add later.

## Context Engineering

The signal here is treating the window as a resource with an allocation policy and an
owner, rather than as a size limit to stay under. What that sounds like:

- "I want a budget table: every consumer of the window has a typical size, a hard cap and an
  eviction policy, and the output reservation is subtracted first. Without it, whichever
  subsystem appends last wins, and that is decided by call order rather than by importance."
- "Ordering is a cost decision, not a style one. System prompt and tool definitions first
  because they are byte-stable and the provider caches that prefix at roughly a tenth of the
  price; retrieved documents and the question last, because that is the strongest attention
  position. Interpolating the current time at the top would cost us the entire cache."
- "I would monitor `cached_tokens / prompt_tokens` on a dashboard. A cache hit rate you do not
  measure is one you do not have, and it regresses silently the first time someone adds a
  dynamic value to the header."
- "Compaction runs at 85% of budget, not at the wall. Compacting after a 400 means doing
  surgery on a request that already failed in front of a user. And I pin the first user turn,
  because a sliding window throws away the goal and keeps the small talk."
- "Structured state beats a prose summary. A typed object with goal, constraints, decisions and
  open questions is diffable, validatable and inspectable when something goes wrong -- recursive
  prose summaries accumulate drift you cannot see or recover from."
- "Big read-heavy sub-tasks go to a sub-agent with its own window. It burns 100K tokens
  exploring and hands back 500, so the parent's context stays small and its prefix cache stays
  warm. The trade is that the brief must be complete, because the sub-agent cannot see anything
  we did not tell it."
- "Every generation span records per-section token counts, retrieved chunk IDs with scores, the
  compaction generation and a prompt hash. Otherwise 'the assistant was wrong' is unfalsifiable."

The distinguishing moves: quantifying the cache lever, compacting proactively at a threshold,
and insisting the assembled context is logged.

## Tool Calling & Typed Actions

The interview question is usually "how would you let the model take actions". The
weak answer describes the API. The strong answer describes the envelope around it:

- "Tools execute with the user's identity, never a service account. Otherwise we have built a
  confused deputy -- a privileged component taking instructions from text that includes
  retrieved documents and user input. The same authorisation service the UI uses, called per
  action with its arguments."
- "Every write tool takes an idempotency key, and I derive it deterministically in the
  orchestrator from the semantic arguments rather than letting the model generate it. A model
  retrying will happily produce a fresh random key, which defeats the whole mechanism. Retries
  are the normal path here, not an edge case."
- "Error messages are part of the prompt. `403 Forbidden` makes the model retry until the
  budget dies; 'this user cannot refund over $500, requested $840, use escalate_to_human' makes
  it take the right path on the next turn. I also count consecutive failures of the same tool
  in the orchestrator, because I am not going to rely on the model's judgement for a safety
  property."
- "The confirmation gate shows the effect in human terms -- 'Refund $49.99 to card ending 4242'
  -- not the JSON. A dialog nobody can read is audit theatre, and it makes the incident worse
  because someone technically approved it."
- "I would apply the lethal-trifecta test per operation: private data, untrusted content,
  external communication. Any turn that has all three is a data-exfiltration path. The control
  is restricting the tool set available in that context, not trying to detect injections in
  prose."
- "Past about twenty tools, selection accuracy degrades and the schemas alone cost thousands of
  tokens per request. I would merge overlaps first, then move to dynamic tool discovery -- which
  is where MCP is heading anyway, because a user with ten servers connected has hundreds of
  tools before they type anything."
- "And I would write the test where a tool result contains an injected instruction, and assert
  nothing happens. Almost nobody writes that test and it is the one that matters."

The signal throughout: safety properties are enforced in deterministic code, and the prompt
explains rules rather than enforcing them.

## Agent Architecture

The failure mode in an agent interview is enthusiasm. Candidates describe a
multi-agent swarm and never mention what stops it. Strong answers sound constrained on purpose.

- "Before I design the agent I want to know whether this needs to be an agent. If I can draw
  the flowchart, I will write the flowchart and use the model to fill in steps -- I only hand
  over the control flow where the branch factor genuinely depends on runtime data."
- "Budgets are checked in the orchestrator before each model call, not asked for in the prompt.
  Step budget, token budget, wall clock. A prompt instruction is a suggestion to a stochastic
  process; a check in the loop is a control."
- "The doom loop is my main reliability worry, and I detect it structurally -- hash of tool name
  plus normalised args, three repeats in a window, one explicit break message, then terminate
  with a partial result. Failing honestly in 45 seconds beats failing expensively in four
  minutes."
- "Run state is an append-only step log with a checkpoint per step, and every tool call carries
  an idempotency key derived from run ID and step index. A deploy mid-run should cost me a
  resume, not a double charge."
- "I would use sub-agents here, but for context isolation, not intelligence. Code search reads
  60k tokens and returns two sentences -- I do not want that in the main thread. They are
  stateless functions, not peers holding a conversation, because I want one readable trace and
  one place where authorisation happens."
- "The safety property is bounded authority. I assume the model will eventually be talked into
  the wrong action, so the run executes as the end user with a scoped tool set, irreversible
  actions hit a gate in code, and egress is allowlisted. The worst case of total model
  compromise should be recoverable."
- "I will not claim determinism. `temperature=0` is not deterministic -- batch composition
  changes floating-point reduction order. What I guarantee is reproducible *inputs*: pinned
  model snapshot, prompt version, tool schema version and raw tool responses recorded per step,
  so I can replay against cached tool results and isolate my orchestration logic."

Each of those sends the same signal: you have operated one of these, you know its cost
distribution has a tail, and you have put the controls in code rather than in prose.

## Evaluation & Quality Regression

Evals are where interviews separate people who have shipped AI from people who have
prototyped it. The tell is whether you talk about the *dataset* or only about metrics.

- "The first thing I would build is not the feature, it is thirty eval cases from real traffic,
  including the ones I expect to fail. Then I build the simplest version and measure it, because
  the baseline is usually better than people guess and it stops me over-engineering."
- "I want retrieval and generation scored separately. If I only have one end-to-end number I
  cannot tell whether we failed to find the document or found it and ignored it, and those have
  completely different fixes. The fastest diagnostic is to run generation with hand-injected
  correct context -- if quality jumps, it is a retrieval problem."
- "Recall@k is the ceiling. If recall@5 is 0.6, no model choice gets me above roughly 0.6, so
  I would work on chunking and hybrid retrieval before touching the prompt."
- "I would use pairwise comparison against the current production prompt, not absolute 1-10
  scoring, because judges compress everything into 7 and 8. I run each pair in both orders and
  only count a win if it survives the swap -- position bias is large enough to manufacture a
  result."
- "Before I believe any judge, I want its agreement rate against a hundred human labels. If the
  judge agrees with humans less than humans agree with each other, the metric is noise and I
  will say so rather than put it in a slide."
- "Non-determinism means a single run is a sample, not a score. I establish the noise floor by
  running the unchanged system twice, then gate on a lower bound across N repeats. Otherwise the
  gate goes flaky and people re-run until green, which is worse than no gate."
- "I gate hard on the deterministic things -- schema conformance, citations resolving to real
  chunks, recall@k -- and softly on judge metrics, always reported per slice. An aggregate that
  moved 1% is usually one slice that moved 20%."
- "The only score I fully trust is online: accept versus edit rate, regenerates, rephrase-and-ask-again,
  escalation to a human. Explicit thumbs are single-digit response rates and biased to the
  extremes, so I use them to *collect eval cases*, not to measure quality."

The signal in all of these is the same: you know the dataset is the product, you know your
metrics are proxies with named biases, and you are willing to say which numbers you do not trust.

## AI Observability & Tracing

Most candidates say "we would use Langfuse" and stop. The signal is in knowing *what
goes on the span*, what must never go on it, and which numbers you would put an alert on.

- "I would keep the existing APM and add a GenAI span layer on top. APM answers up-and-fast,
  which for an LLM feature are the easy questions and nearly uncorrelated with whether it works
  -- a bad answer is an HTTP 200 with a fluent paragraph."
- "Tenant, feature, prompt version and resolved model are required attributes on every span from
  the first commit. You cannot back-fill a tenant ID onto last month's data, and those four
  dimensions answer most incident questions on their own."
- "I record both the requested model and the resolved snapshot. When behaviour shifts overnight
  with no deploy, a group-by on resolved model finds it in thirty seconds instead of a day
  bisecting our own commits."
- "TTFT and total duration are separate metrics with separate SLOs. They fail independently, and
  averaging them hides both."
- "Cost is computed at write time and stored on the span, not joined against a price table at
  query time -- otherwise your historical analysis changes when someone updates prices. I also
  track the share of spend that is retries and abandoned runs, because it is rarely zero and it
  is usually the number that surprises people."
- "Prompts contain whatever users pasted, which includes secrets and other customers' data. So:
  redact before export, payloads in our own store with short retention, metadata to the vendor,
  and raw payload access behind a separate permission with its own audit log."
- "I sample payloads at a low baseline but keep 100% of errors, outlier-cost runs and
  negative-feedback sessions, using tail sampling. Head sampling throws away exactly the traces
  you get paged about."
- "For quality I would not lean on thumbs -- single-digit response rates, biased to the extremes.
  I would instrument edit survival, regenerate rate, rephrase-and-ask-again and escalation, all
  joined on trace ID, plus a 1-5% judge stream read as a trend rather than an absolute score."
- "My first alerts are retrieval-empty rate, schema failure rate, refusal-rate deviation in
  *either* direction, p95 TTFT, cache hit rate and cost-per-request rate of change. Error rate
  and average latency would stay flat through most of the incidents I actually care about."

The pattern: name the attribute, name the query it enables during an incident, and name the
redaction or retention control that makes capturing it defensible.

## Inference Serving & Performance

The tell in an inference interview is whether you reason in *memory* or in vague
"add more GPUs". Strong answers do arithmetic out loud.

- "Prefill is compute-bound and parallel, decode is memory-bandwidth-bound and sequential. Every
  knob in the stack is somewhere on that trade, so before tuning anything I want to know whether
  this workload is TTFT-sensitive or throughput-sensitive -- they want opposite configurations."
- "My concurrency limit is a memory calculation, not a compute one. For a 70B-class model with
  GQA -- 80 layers, 8 KV heads, head dim 128, BF16 -- KV is about 0.31 MiB per token, so an
  8k-token request is around 2.5 GiB and forty of them fill an 80 GB card before the weights are
  counted."
- "Which means a product change that doubles retrieved context halves my concurrency. The
  serving tier gets slower and more expensive with no traffic change and no code change in my
  service."
- "PagedAttention's real value was not the reduction in internal fragmentation, it was making KV
  blocks *shareable*. That is what prompt caching is built on, and prompt caching is the biggest
  single win available on a chat or agent workload because prompt overlap is enormous."
- "Continuous batching, not static. With static batching the whole batch waits for the longest
  sequence, and with realistic length variance you throw away most of your throughput."
- "I would autoscale on queue depth and time-in-queue, never GPU utilisation. Batched decode
  reads as busy whether or not anyone is waiting, so utilisation is not a signal about pain.
  Preemption rate is my early warning for KV thrash."
- "Chunked prefill with `max_num_batched_tokens` around 2,048 for interactive chat -- smaller
  budget means long prompts interrupt decode less, so ITL is smoother. For batch document work
  I would push it well above 8,192 and stop caring about ITL entirely."
- "Speculative decoding is a latency optimisation at low load, not a throughput one. Under
  saturation the verification compute competes with other requests' real tokens, so I would gate
  it on concurrency and monitor draft acceptance rate."
- "Quantisation is an eval question. FP8 is usually safe enough to be hard to detect; INT4
  weight-only is real memory relief with real degradation that shows up on long-context and
  formatting tasks. I would gate it on my own per-slice suite and specifically on JSON
  conformance, not on a published perplexity delta."
- "Self-hosting is a utilisation bet. Spiky traffic with a low average is the worst case for
  owning GPUs, and cold start is minutes so scale-from-zero is not available. I would self-host
  the steady high-volume workload and keep an API path for spikes and for the frontier capability
  I cannot reproduce."

The signal is arithmetic plus honesty about the cliff: KV exhaustion does not degrade gracefully,
and knowing that is what separates someone who has operated this from someone who has read about
it.

## Model Routing, Caching & Cost Control

Cost is where AI engineering meets business reality, and interviewers use it to find
out whether you have actually owned a budget. The signal is naming *where* the money goes before
reaching for tactics.

- "Before optimising I would build the unit-economics model: system prompt tokens, retrieved
  context, history, expected output, expected retries, times price, times requests per user per
  month. That hour usually finds a 5-10x saving that needs no cleverness."
- "The money is in input tokens, not output. Prompt, tool schemas, retrieved context and history
  are re-sent every call, and in an agent loop the whole history is re-sent every step -- so
  agent input tokens grow with the square of step count."
- "The single highest-leverage lever is prefix caching, because it cuts cost and TTFT at once
  with no quality cost. It is prefix-exact, so prompt assembly order is an interface: stable
  content first, volatile last. Putting a timestamp at the top of a system prompt zeroes the hit
  rate and looks completely harmless in review."
- "I would track cache hit rate as a first-class metric with an alert on a drop, because it is a
  leading indicator of a cost spike that no code review will catch."
- "A cascade lives or dies on the escalation signal, and the best signal is a deterministic
  verification failure -- output did not parse, citation IDs do not resolve, the generated SQL
  does not execute. At a 10x price gap, escalating 20% still saves around 70%; escalating 60%
  saves nothing once you count the wasted first call, so escalation rate is a monitored metric."
- "I would route on task class before difficulty, because I already know the task from the
  calling surface and I do not know the difficulty. Latency class and data-residency class are
  also routing constraints, and residency overrides cost."
- "I am cautious about semantic caching. Similar questions do not have the same answer -- 'cancel
  my subscription' versus 'cancel before renewal' are neighbours with different answers, and
  embeddings are weak at negation. And without tenant and permission scope in the key it is a
  cross-tenant leak, which is the same failure class as caching personalised HTML in a shared
  CDN. Exact-match plus prefix caching gets most of the saving at a fraction of the risk."
- "Budgets degrade in stages -- notify, then cheap tier and lower k, then cache-only and deferral,
  then a clear message with a reset time. A hard 429 turns a cost threshold into a customer
  outage. And enforcement is a shared atomic counter in the gateway, because per-process budgets
  multiply by your replica count."
- "I would keep a provider abstraction for availability, leverage and residency -- but I would be
  clear that the API is portable and the prompts are not. Failover is a declared capability tier
  with a tuned prompt variant per model, gated by evals, not a transparent swap."
- "Retrieval-k is a cost dial that often improves quality when you turn it down. I would plot
  eval score against k and take the knee, because long stuffed contexts lose the middle and
  irrelevant chunks actively distract the model."

The signal throughout: you know the distribution of spend, you know which optimisations are free
and which trade quality, and you treat the dangerous one -- semantic caching -- with the suspicion
it deserves.

## Fine-Tuning, LoRA & Distillation

Fine-tuning is the topic where enthusiasm is most expensive, so interviewers listen for
whether you can argue *against* it. The strongest answers usually end up not fine-tuning.

- "First question: is the gap facts or form? Fine-tuning teaches form and behaviour; retrieval
  supplies facts. If the requirement includes citations, freshness or per-document permissions,
  weights are the wrong place for it and I would say so before we scope anything."
- "I would want the baseline eval per slice before we start. If I cannot state the current score
  I cannot show the fine-tune helped -- and in my experience a better prompt closes a good part
  of the gap for a day's work rather than a month's."
- "LoRA freezes the base and trains two low-rank matrices, so for an 8192x8192 projection you go
  from 67 million parameters to about 260 thousand at rank 16. Optimiser state scales with
  trained parameters, so memory drops by roughly two orders of magnitude and the artefact is tens
  of megabytes instead of 140 gigabytes."
- "That size is what makes the interesting architecture possible: one base model in GPU memory
  and hundreds of per-tenant adapters, batched together with multi-LoRA. Per-tenant full
  fine-tunes are economically impossible; per-tenant adapters are routine."
- "If the goal is cost and latency rather than new capability, this is distillation and it has a
  high success rate, because the teacher gives me unlimited labelled data on my real input
  distribution. I would filter teacher outputs through my deterministic eval checks first --
  otherwise I am training the student to reproduce the teacher's mistakes -- and I would check the
  provider terms on training from outputs."
- "Ninety percent of the work is the dataset, and quality beats quantity decisively. A thousand
  consistent reviewed examples beat ten thousand scraped ones, because the model learns my
  dataset's regularities faithfully -- including the inconsistencies I did not intend."
- "After training I run the *full* suite, not the target slice, plus a regression set of
  capabilities the fine-tune was never meant to touch -- instruction following, tool-call format,
  refusal behaviour. A 15% gain on the target that breaks tool calling is a net loss."
- "DPO after SFT, never instead of it, and only for taste I cannot demonstrate. If I can write
  the output I want, I write it -- demonstrations are cheaper to collect and far easier to debug
  than preference pairs, and pairs where both answers are fine teach almost nothing."
- "The cost people forget is maintenance. Adapters do not transfer across base models, so a
  deprecation means re-train, re-evaluate and re-qualify. And the pattern of the last few years
  is that a general model two generations newer with a good prompt often matches a fine-tune on
  an older base, for free. So I would fine-tune when volume makes a 10x unit-cost win dominate,
  when the behaviour genuinely cannot be prompted, or when residency forces self-hosting anyway
  -- and otherwise I would recommend not doing it."

The signal is a candidate who can run the arithmetic in both directions and who volunteers the
maintenance cost rather than being asked for it.

## AI Security & Guardrails

This is the topic where a Staff candidate most clearly separates from a strong senior
one, and the separation is a single move: reframing from "stop the model being tricked" to "bound
what the model can do".

- "Prompt injection is not a prompt problem, it is an authority problem. There is one token
  channel, so there is no prepared-statement equivalent -- role markers are convention, not a
  boundary. I would not spend the review arguing about wording; I would spend it on what the model
  is allowed to do."
- "The question I actually want answered is: if the model is fully attacker-controlled right now,
  what is the worst outcome? I design until that answer is acceptable."
- "I use the lethal-trifecta checklist -- private data access, untrusted content, external
  communication. Any two is survivable; all three and I assume exfiltration is possible. So per
  capability I decide which leg to break: the document assistant keeps private data and untrusted
  content and has no egress at all -- no HTTP tool, no rendered markdown images, no link
  fetching. The browsing agent keeps untrusted content and egress and has no internal access."
- "Every tool call authorises against the *end user's* identity via a short-lived scoped
  credential, not a service account. The convenient design makes the model's authority the union
  of every user's authority, and then one injection is a tenant-wide breach."
- "ACL-aware retrieval is a security boundary. Permissions live with the vectors and are applied
  as a filter inside the query, never as a post-filter -- post-filtering means unauthorised
  content already transited my process and my logs, and it makes effective k unpredictable."
- "I would deploy an injection classifier, and I would be explicit that it is mitigation and
  telemetry, not prevention. It faces an adaptive adversary with unlimited attempts, and at
  realistic base rates a 95%-recall classifier still passes one attack in twenty while generating
  enough false positives that someone turns it off."
- "Markdown image rendering is the exfiltration channel people miss. The model emits an image tag
  pointing at an attacker host with the data in the query string, and the browser fetches it with
  zero clicks. I strip images and external links from model output, and I put a default-deny
  egress allowlist around tool execution as the backstop -- that is the only control that catches
  the channel I failed to think of."
- "Model output is untrusted user input. It never goes to `innerHTML`, never to `eval` or a
  shell, never interpolated into SQL, never a file path without canonicalisation, never a
  server-side fetch URL without an allowlist."
- "Confirmation gates live in the orchestrator, keyed on reversibility, and they show the
  concrete call plus a dry-run diff. 'The agent wants to proceed' trains people to click yes."
- "An MCP server is a code dependency with a prompt-injection surface, because it supplies the
  tool descriptions that land in my context. I pin versions, review what I install, and alert on
  tool-description changes the way I would on a dependency bump."

The pattern in every one of those: name the attack, name the *architectural* control, and be
honest that the probabilistic defences are secondary.

## AI Product & UX Architecture

Most candidates discuss AI UX as if it were visual design. The Staff framing is that
UX decisions here are architecture decisions with backend consequences. What that sounds like:

- "I design around TTFT, not total latency. Once tokens are flowing the user is reading, so the
  thing to attack is the silence -- prompt size, prefix cache hits, and whether we do a
  retrieval round trip before the first token. And I would not spend engineering effort pushing
  decode above about eight tokens per second, because that is reading speed and nobody can
  perceive the difference."
- "The backend has to emit structured phase events, not just a token stream. 'Searching four
  sources', 'found six documents', 'writing' is an API contract, and it is the difference
  between a tolerable three-second wait and an abandoned one."
- "Generic hedging is worse than none, because a constant warning carries no information and
  teaches users to ignore all warnings. I would rather gate on the reranker score before
  generating and say 'I could not find this, here is how to request archive access' than
  produce a plausible guess with a disclaimer."
- "Output goes into an editable surface, and changes are staged rather than applied. The model
  proposes, the human commits. That is better UX and a cleaner authorisation story, because the
  irreversible action is taken by a person with the authority to take it."
- "Thumbs are a weak signal -- low volume, ambiguous, and gameable toward agreeableness. I want
  edit distance, accept rate, regeneration rate, abandonment and escalation, every one of them
  attached to the trace ID so a bad rating resolves to the exact prompt, chunks and model
  version."
- "Cancellation must propagate to the provider. A cancel that only hides the UI is a bill for
  tokens nobody reads, and I would monitor tokens generated after cancellation as a real metric."
- "The design question I keep coming back to is: what does the user do when the answer is wrong?
  If the answer is 'notices three weeks later', the feature is not shippable at any model
  quality. If it is 'checks the citation, clicks edit, fixes it', we can ship with the models we
  actually have."

The signal is treating imperfection as the design input rather than a temporary state that a
better model will fix.

## Capstone: An AI Platform

This is the question that decides a Staff or Senior Staff loop, because it is
simultaneously technical, organisational and commercial. The failure mode is drawing every box on
the diagram and never saying what you would do first or who owns it.

- "The reason a gateway is non-negotiable is not elegance. It is that auth, tenancy, quota,
  residency, redaction and audit are cross-cutting and correctness-critical, and a control
  implemented per application is a control the next team will forget. I want one place where the
  answer to 'can this customer's data go to this provider' is enforced."
- "My first version is a transparent OpenAI-compatible proxy that does auth, tenant tagging,
  telemetry, cost attribution and retries -- and nothing opinionated. Migration is a base URL and
  a key. I want 100% of traffic through it before I add a single restriction, because a gateway
  that 60% of traffic bypasses provides 0% of the governance."
- "Order matters: visibility, then control, then optimisation. If I build the router and the
  shared retrieval service first I cannot prove anything helped, and I will not get the third
  team to migrate. Stages one and three also give teams something they *want* -- free dashboards,
  prompt changes without a deploy -- which buys the credit I spend in stage two saying no."
- "Routing is configuration, not code. The test is whether a model deprecation is a one-day
  config change or an eight-team coordination project. So the gateway refuses raw provider model
  names and accepts only logical names the registry resolves."
- "I would keep the gateway thin and stateless with a 5-15 ms overhead budget. Policy comes from
  cached config with a stale-if-error path, telemetry export is asynchronous and fails open, and
  there is a documented break-glass direct-provider path with audit -- because this thing is in
  front of every AI feature we own."
- "Prompts and eval datasets are owned by product teams, not the platform. A support team knows
  what a good support reply is; I do not. Centralising prompt authorship creates a queue and
  produces worse prompts. Platform owns the mechanism and the golden path; security and legal own
  the model-and-data-class catalogue, not per-feature review."
- "The health test is whether a product team can ship a low-risk AI feature without talking to
  me. If every feature needs a platform ticket, I have built a bottleneck with a dashboard."
- "Governance has to be risk-tiered and automated. Internal, read-only, human-in-the-loop, no PII
  self-serves with CI checks. Real review is reserved for customer-facing autonomous action,
  regulated workflows and new data classes. A single process applied to everything waves the risky
  things through and blocks the harmless ones."
- "Two controls I would insist on centrally because a team under deadline will get them wrong:
  semantic caching is opt-in, tenant-and-permission-scoped and intent-whitelisted, because a
  global one is a cross-tenant leak; and retrieval ACL filters go through one shared query-builder
  applications cannot bypass, with a continuous job verifying retrieved doc IDs against caller
  entitlements."
- "I would build the gateway, registry and cost attribution, and buy the provider adapters,
  tracing backend, eval runner, index and sandbox. The rule: build what encodes our tenancy and
  policy model, buy what is translation or commodity infrastructure. And never write a serving
  engine -- use vLLM or TensorRT-LLM."
- "I would start with showback rather than chargeback. Most of the behavioural benefit, far less
  political friction, and it gives me time to reconcile attribution against provider invoices
  before anyone's budget depends on my numbers."

The signal is sequencing, ownership and honesty about the platform's own failure modes -- gateway
as SPOF, noisy neighbour, version skew, platform-as-bottleneck -- volunteered rather than extracted.
