export default {
  blocks: [
    {
      t: 'prose',
      md: `Model routing is deciding, per request, which model should handle it -- and cost control
is making sure that the answer to "what did this feature cost last month" is a number you chose
rather than a number you discovered.

Both matter more than they sound. An AI feature is the first thing most teams have shipped where
the marginal cost per request is large, variable, and directly controlled by application-level
decisions: which model, how much context, how many retries. A single careless change -- one more
retrieved chunk, one reordered prompt -- can move your bill by a factor of two with no visible
difference in the code review.`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `In a conventional service, cost is roughly proportional to traffic and dominated by
fixed infrastructure. You provision for peak, the marginal request costs approximately nothing,
and finance cares about headcount and instances rather than per-request arithmetic.

LLM features break that in three ways. The marginal cost is real and visible -- a request can
cost a fraction of a cent or several dollars depending on context length and how many times the
loop iterated. **The variance is enormous**: the spread in cost per request on a single endpoint
routinely spans one to two orders of magnitude, so request counts are not a cost proxy. And the
biggest determinant is usually not what people expect.

**Most of your spend is input tokens.** System prompts, few-shot examples, tool schemas,
retrieved context and conversation history are re-sent on every call, and in an agent loop the
whole accumulated history is re-sent every step. Output is typically a few hundred tokens; input
is often thousands to tens of thousands. Even where output tokens are priced several times higher
per token, the sheer volume asymmetry usually means input dominates the bill -- and the second
biggest line is frequently *retries and abandoned runs*, work you paid for and threw away.

That is good news, because input tokens and retries are both things you control in application
code.`
    },
    {
      t: 'numbers',
      title: 'Where the money actually goes',
      items: [
        { v: '10-100x', k: 'Spread in cost per request, one endpoint', note: 'Why request counts tell you nothing about spend' },
        { v: 'usually >70%', k: 'Share of spend that is input tokens', note: 'Prompt, context, history -- resent every call' },
        { v: 'often 5-15%', k: 'Spend on retries and abandoned runs', note: 'Measure it; it is rarely zero' },
        { v: 'order of 10x', k: 'Price gap between frontier and small models', note: 'The prize routing is chasing' },
        { v: 'up to ~90%', k: 'Typical discount on cached input tokens', note: 'Varies by provider; check current terms' },
        { v: '~50%', k: 'Typical discount for async batch APIs', note: 'In exchange for a long completion window' },
        { v: 'quadratic', k: 'Growth of agent input tokens in step count', note: 'History resent each step' }
      ]
    },
    {
      t: 'note',
      tone: 'info',
      title: 'Build the unit-economics model before you optimise',
      md: `Write down, for one representative request: system prompt tokens, retrieved context
tokens, history tokens, expected output tokens, expected retries, and the model price. Multiply
out. Then multiply by requests per active user per month, and by users per tenant. You now have
cost per tenant per month and can compare it to what you charge them.

Teams that skip this spend months optimising output length -- which is a rounding error -- while
a 12k-token system prompt is re-sent on every call. The model takes an hour and routinely
identifies a 5-10x saving that needs no cleverness at all.`
    },

    { t: 'h', text: 'Cascades: small model first, escalate on a signal' },
    {
      t: 'prose',
      md: `The central observation is that request difficulty is very unevenly distributed. Most
traffic is easy -- classification, extraction, short factual answers grounded in retrieved text,
simple rewrites -- and a small cheap model handles it at quality indistinguishable from a frontier
model. A minority is genuinely hard and needs the expensive one. Sending everything to the
frontier model means paying the hard-case price for the easy 80%.

A cascade tries the cheap model first and escalates only when a signal says the answer is not
good enough. The entire design rests on that signal, and this is where most cascades fail: if
you escalate on nothing, quality drops; if you escalate on everything, you pay for both models
and are worse off than not cascading at all.

Signals that work in practice, roughly in order of trustworthiness. A **deterministic
verification failure** is the best one available -- the output did not parse, failed schema
validation, cited a document ID that does not exist, produced SQL that does not execute, or
generated code that fails its test. That is a real, cheap, unambiguous signal. Next, **explicit
self-assessed uncertainty**: ask the small model to return a confidence field or to answer
\`INSUFFICIENT_CONTEXT\` when the retrieved text does not support an answer. Models are poorly
calibrated in general, but a structured "I cannot answer this from the given context" is
surprisingly usable and cheap. Then **token-level signals** like average log-probability of the
generated tokens, where available. And finally a **cheap classifier** trained on your own
production data labelled by which model was actually needed -- more work, but it escalates
*before* spending the first call rather than after.

The economics only work if escalation is rare. At a 10x price gap between tiers, escalating 20%
of traffic still saves roughly 70% versus frontier-only; escalating 60% saves almost nothing
once you count the wasted first call. So instrument the escalation rate, alert on it, and treat
a rising rate as a product incident rather than a cost curiosity -- it usually means your
retrieval got worse.`
    },
    {
      t: 'diagram',
      code: `flowchart TB
  R["Request"] --> CL["Classify: task class plus difficulty"]
  CL -->|"trivial: extract, classify"| S["Small model"]
  CL -->|"hard: multi-step reasoning"| L["Frontier model"]
  CL -->|"default"| S
  S --> V{"Verify: schema, citations,<br/>confidence, tests"}
  V -->|pass| OUT["Response"]
  V -->|fail| L
  L --> V2{"Verify"}
  V2 -->|pass| OUT
  V2 -->|fail| H["Degrade: cite sources,<br/>or hand to a human"]
  OUT --> M["Record model, route reason,<br/>tokens, cost, cache status"]`,
      caption: 'Two routing decisions: a cheap up-front classification, and a verification-driven escalation. Both get logged as route reason.'
    },
    {
      t: 'prose',
      md: `Routing by **task class** is separate from routing by difficulty, easier, and often
worth more. Different jobs have genuinely different requirements: classification and extraction
need a small model with constrained decoding; summarisation needs long context but not deep
reasoning; code generation needs a code-tuned model; multi-step planning needs the frontier
model. Route on the task, which you already know from which product surface called you, before
you try to predict difficulty, which you do not know.

Two further dimensions worth routing on. **Latency class**: an interactive autocomplete has a
budget of a few hundred milliseconds and must use a small fast model regardless of quality
preference, while a background summariser can wait and should use whatever is cheapest.
**Compliance class**: some tenants' data may only go to specific providers or regions, which is a
routing constraint that overrides every cost consideration -- and it belongs in the router, not
in each application.`
    },

    { t: 'h', text: 'Prompt-prefix caching: the highest-leverage lever' },
    {
      t: 'prose',
      md: `If you do one thing, do this. Providers and self-hosted engines both cache the KV state
of a prompt prefix, so a request whose leading tokens match a recent request skips the prefill
work for the shared portion. You pay a heavily discounted rate for those input tokens -- discounts
in the region of 90% are common, though the exact figure and minimum cacheable length vary by
provider and change, so check current terms -- and TTFT drops substantially at the same time.

It is the rare optimisation that improves cost *and* latency with no quality cost whatsoever.

The mechanism imposes one hard constraint: **matching is prefix-exact.** The cache keys on the
tokens from the start of the prompt up to the first difference. Change one token near the
beginning and every subsequent block misses. So prompt assembly order becomes a performance
interface, and it should be reviewed like one:

1. System prompt and role definition -- identical across all requests.
2. Tool and function schemas -- change only on deploy.
3. Few-shot examples -- static per prompt version.
4. Tenant-level context, such as an organisation's policy documents -- stable per tenant.
5. Retrieved chunks for this query -- varies per request.
6. Conversation history -- grows per turn.
7. The user's current message -- always different.

The classic self-inflicted wound is putting a timestamp, a request ID, a random greeting or the
user's name at the top of the system prompt. Every request then misses the cache entirely.
Second most common: sorting retrieved chunks in a non-deterministic order, so two identical
queries produce different prefixes. Third: a "personalisation" line injected before the shared
instructions.

None of those appear as bugs in review. They appear a week later as a cost increase and a TTFT
regression with no obvious cause -- which is why **cache hit rate belongs on your dashboard as a
first-class metric with an alert on a drop**, as covered in **AI Observability & Tracing**.`
    },
    {
      t: 'code',
      lang: 'typescript',
      title: 'Prompt assembly ordered for cache hits',
      code: `// Most stable first, most volatile last. This ordering is an interface:
// changing it is a performance and cost change, and belongs in the PR description.
function buildMessages(ctx: RequestContext): Message[] {
  return [
    // --- cacheable across ALL tenants: identical bytes on every request
    { role: 'system', content: PROMPT_REGISTRY.get('support_reply', 'v17') },
    { role: 'system', content: serialiseToolSchemas(TOOLS) },   // stable per deploy
    ...FEW_SHOT_EXAMPLES,                                        // static per version

    // --- cacheable per tenant: same bytes for every request from this org
    { role: 'system', content: ctx.tenant.policyPreamble },

    // --- volatile from here down; everything below this line misses on every request
    { role: 'system', content: renderChunks(sortById(ctx.retrieved)) },  // deterministic order!
    ...ctx.history.slice(-6),
    { role: 'user', content: ctx.message }
  ];
}

// What NOT to do -- each of these zeroes your hit rate and looks harmless in review:
//   \`You are a helpful assistant. Current time: \${new Date().toISOString()}\`
//   \`You are assisting \${user.firstName} today.\`
//   renderChunks(ctx.retrieved)        // ANN result order is not stable run to run
//   \`Request ID: \${requestId}\` at the top of the system prompt`
    },

    { t: 'h', text: 'Response caching, and where it becomes dangerous' },
    {
      t: 'prose',
      md: `Caching whole responses is different from caching prefixes, and considerably riskier.

**Exact-match caching** is safe and underused. Hash the full normalised prompt -- including
tenant, model, prompt version, temperature and the retrieved document IDs -- and return the stored
response on a hit. Because the key covers everything that affects the answer, a hit is genuinely
the same question in the same state. Useful hit rates appear wherever traffic is repetitive: FAQ
answers, documentation questions, autocomplete on common prefixes, and regenerated identical
requests. Include the *retrieval result IDs* in the key, or a re-index will serve answers grounded
in documents that no longer say that.

**Semantic caching** embeds the query, finds a previous query within some cosine similarity
threshold, and returns its cached answer. It is much more appealing and much more dangerous, for
a reason worth stating precisely: **similar questions do not have the same answer.**

"How do I cancel my subscription?" and "How do I cancel my subscription *before renewal*?" sit
very close in embedding space and have materially different answers. "Is my data encrypted at
rest?" and "Is my data encrypted in transit?" are near-identical vectors with different
compliance implications. Negation is the sharpest case: embeddings are notoriously weak at it, so
"can I export my data" and "can I *not* export my data" may be neighbours.

Then the failure that turns a cost optimisation into a security incident. **If the cache key does
not include the tenant and the permission scope, a semantic cache is a cross-tenant data leak.**
User A asks "what is our Q3 revenue target?", the answer is cached, and user B at a different
company asks a similar question and receives A's answer. That is not a subtle bug -- it is the
same class of failure as caching a personalised HTML page in a shared CDN, with a fuzzier match
function making it more likely rather than less.

So if you use semantic caching: key it on tenant *and* permission scope, never a global
namespace; set the threshold high and validate it against labelled pairs from your own traffic
rather than picking 0.95 because it sounds safe; restrict it to a whitelist of stable,
non-personalised, non-time-sensitive intents rather than applying it to all traffic; give entries
a short TTL; and log every hit with the original and matched query so you can audit what it
served. Honestly, for most products exact-match caching plus aggressive prefix caching captures
the bulk of the available saving at a fraction of the risk.`
    },
    {
      t: 'table',
      title: 'Caching tiers, what they save, and what they can break',
      cols: ['Tier', 'Key', 'Typical saving', 'Risk'],
      rows: [
        ['**Prefix / KV cache**', 'Leading tokens, prefix-exact', 'Large discount on shared input tokens plus much better TTFT', 'None to correctness. Silently lost when prompt order changes.'],
        ['**Exact-match response**', 'Hash of full prompt, tenant, model, prompt version, retrieved doc IDs', '100% of the call on a hit', 'Stale answers if retrieval changed and doc IDs are not in the key.'],
        ['**Semantic response**', 'Query embedding within a similarity threshold, **scoped to tenant and permissions**', '100% of the call, with higher hit rate than exact match', '**Wrong answers for near-miss queries; cross-tenant leakage if scope is missing.**'],
        ['**Embedding cache**', 'Hash of the text, plus embedding model version', 'All re-embedding cost on unchanged documents', 'Stale vectors if the model version is not in the key.'],
        ['**Retrieval result cache**', 'Normalised query, filters, ACL scope, index version', 'Vector search and rerank cost', 'Serving results from a superseded index.']
      ]
    },

    { t: 'h', text: 'The other cost knobs' },
    {
      t: 'prose',
      md: `**Batch and async APIs.** Most providers offer an asynchronous batch endpoint at a
substantial discount -- commonly around half price -- in exchange for a completion window measured
in hours. Anything not in front of a waiting human belongs there: nightly document enrichment,
backfilling embeddings or summaries, bulk classification, eval runs over a large dataset. Teams
routinely pay interactive rates for work nobody is waiting for, simply because the interactive
path was already written.

**Context trimming and retrieval-k.** Retrieved context is usually the largest volatile part of
the prompt, so k is a direct cost dial. Going from k=20 to k=5 cuts that component roughly 4x,
and it frequently *improves* quality, because long stuffed contexts suffer from attention falling
off in the middle and from irrelevant chunks actively distracting the model. Measure it: plot
your eval score against k and pick the knee. A reranker that lets you pass 5 excellent chunks
instead of 20 mediocre ones pays for itself several times over. History is the same story -- a
rolling window plus a running summary is far cheaper than replaying thirty turns, and past a
point it is also better.

**Output caps and stop conditions.** Set \`max_tokens\` deliberately rather than leaving it at the
model maximum, and watch \`finish_reason=length\`: a truncated answer is a failure you paid full
price for. Ask for structure instead of prose where a UI is going to render it anyway -- JSON with
five fields is a fraction of the tokens of three explanatory paragraphs.

**Retries.** Retries are pure duplicated cost and are frequently the biggest line nobody is
tracking. Retry only on transient transport failures with jittered exponential backoff, cap
attempts, and never retry a request that failed validation without changing something -- an
identical retry of a semantic failure will fail identically. For agents, the step budget *is* the
retry cap, which is one more reason those budgets belong in the orchestrator.`
    },

    { t: 'h', text: 'Per-tenant budgets and graceful degradation' },
    {
      t: 'prose',
      md: `Without per-tenant accounting you cannot price the product, cannot stop one customer
from consuming everyone's capacity, and cannot answer the finance question. The building blocks
are a spend counter per tenant per window, a soft threshold, a hard threshold, and a defined
behaviour at each.

The mistake is to have exactly one behaviour -- a 429 at the hard cap. That turns a cost event
into an outage for that customer, and a support ticket, and usually a decision you did not want
to make under pressure. Degrade in stages instead, and decide the stages in advance:

At around 70% of the window's budget, notify the tenant admin and start emitting a warning metric
-- nothing user-visible. At 85%, change the routing: force the cheap tier, drop k, disable
speculative or optional enrichment calls, raise the cache TTL. The feature is slightly worse and
still works, which for most customers is strictly better than an error. At 100%, serve
cache-only and queue non-interactive work rather than executing it. Beyond that, reject with a
clear, actionable message that names the budget and the reset time, and expose a self-service
increase path if your commercial model allows one.

Two mechanics matter. Budgets must be enforced in a **shared store, not per process**, or ten
instances each enforce a tenth of the limit -- a Redis counter with a short TTL per window is
sufficient and the atomicity is worth getting right. And enforcement belongs in the **gateway**,
not in each application, so it is uniform and cannot be forgotten by the next team to ship a
feature. That is one of the main arguments for a gateway in **Capstone: An AI Platform**.

Hard caps also need to consider abuse. A single user can drive an unbounded bill with a script,
so pair the tenant budget with a per-user rate limit and a per-request token ceiling. The cost of
an AI feature is attacker-controllable in a way that a normal endpoint's is not.`
    },
    {
      t: 'code',
      lang: 'python',
      title: 'Budget check with staged degradation',
      code: `# Enforced in the gateway, against a shared counter. Per-process budgets do not work.
async def apply_budget(ctx, request):
    spent  = await redis.incrbyfloat(f"spend:{ctx.tenant_id}:{window_key()}", 0)
    budget = ctx.tenant.monthly_budget_usd
    ratio  = spent / budget if budget else 0.0

    if ratio < 0.70:
        return request                                    # normal path

    if ratio < 0.85:
        metrics.warn("budget_soft", tenant=ctx.tenant_id, ratio=ratio)
        notify_admin_once(ctx.tenant_id, ratio)
        return request

    if ratio < 1.00:
        # Degrade, do not fail. Cheaper model, less context, longer cache TTL.
        return request.override(
            model=TIER_SMALL,
            retrieval_k=min(request.retrieval_k, 4),
            cache_ttl_s=3600,
            disable_optional_enrichment=True
        )

    if request.interactive and cache.has(request.exact_key()):
        return request.serve_from_cache()                  # still useful

    if not request.interactive:
        return request.defer_to_batch_queue()              # run it when budget resets

    raise BudgetExceeded(
        message=f"Monthly AI budget of \${budget:.0f} reached. Resets {reset_at()}.",
        upgrade_url=ctx.tenant.self_service_budget_url
    )`
    },

    { t: 'h', text: 'Multi-provider abstraction and failover' },
    {
      t: 'prose',
      md: `You want a single internal interface in front of several providers, for three reasons
that have nothing to do with cost: availability, because providers have incidents and rate limits
and you would rather degrade than go down; negotiation, because a credible ability to move
traffic is the only real leverage you have on price; and compliance, because some tenants'
traffic must go to a specific provider or region. \`LiteLLM\` is the common off-the-shelf choice
for the translation layer, and most gateways implement something similar internally.

Now the honest caveat, which strong candidates say unprompted: **the API surface is portable and
the prompts are not.** A unified SDK gives you one function signature. It does not give you
equivalent behaviour. Models differ in how reliably they follow formatting instructions, in
tool-calling syntax and reliability, in refusal boundaries, in how they handle long context, in
tokenisation (so your carefully budgeted 8,000 tokens is a different length elsewhere), and in
which sampling parameters exist at all. Prompts tuned on one model routinely lose several points
of quality on another.

So treat failover as a **capability tier, not a transparent swap**. Maintain a tuned prompt
variant per model for the paths you actually intend to fail over, and gate each variant with the
same eval suite. For paths where you have not done that work, be explicit that failover means
degraded quality, and prefer a clear degradation -- "answering from cached results" or "this may
take longer" -- over silently routing to an untested model in a compliance-sensitive workflow.

Mechanically: health-check by success rate and latency rather than liveness, trip a circuit
breaker per provider and per model, respect \`Retry-After\` on 429s instead of hammering, and
spread load across multiple accounts or regions if your rate limits are the binding constraint.
Track cost per provider continuously, because the cheapest option changes and a routing table
that was optimal six months ago probably is not.`
    },

    { t: 'h', text: 'Cost guardrails in CI' },
    {
      t: 'prose',
      md: `Cost regressions arrive the same way quality regressions do -- in an innocent-looking
pull request -- and they deserve the same treatment. Measure tokens and cost per example in the
eval run and report the delta on the PR alongside quality. A change that improves quality 3% and
costs 2.4x is a legitimate trade, but it must be a *decision* someone made rather than something
discovered on next month's invoice.

Three cheap static checks catch most of it. Assert a token budget on rendered prompt templates,
so a system prompt that grows from 800 to 4,000 tokens fails the build. Assert that the stable
prefix of each prompt is unchanged unless the prompt version was bumped, which catches the
cache-destroying reorder. And assert that model identifiers come from the config registry rather
than being hardcoded in application code, so routing stays a platform decision.

Then close the loop in production: alert on cost per request by tenant and feature on *rate of
change* rather than absolute value, and alert on a cache-hit-rate drop. Those two catch the
regressions that CI cannot see, and they catch them in hours rather than at the end of the
billing period.`
    },

    {
      t: 'tradeoffs',
      title: 'Routing, cascades and layered caching',
      gains: [
        'Order-of-magnitude cost reduction on a workload with a typical easy/hard distribution.',
        'Prefix caching improves cost and TTFT simultaneously at no quality cost.',
        'Per-tenant budgets make usage-based pricing and quota enforcement possible.',
        'Provider abstraction gives availability during incidents and real negotiating leverage.',
        'Cheap-tier defaults often reduce latency as well as cost, since small models are faster.'
      ],
      costs: [
        'Every routing path is a separate quality surface to evaluate and maintain.',
        'Cascade escalations mean paying twice for the hard cases; the maths only works if escalation is rare.',
        'Semantic caching can return wrong answers and, without scoping, leak across tenants.',
        'Prompt-assembly order becomes a fragile performance contract that ordinary edits break.',
        'Prompts are not portable, so failover is a quality change, not a transparent one.',
        'Degradation tiers add real state and branching to the request path.'
      ]
    },
    {
      t: 'failures',
      title: 'Cost and routing failures',
      items: [
        { mode: 'Prompt reordered, prefix cache hit rate collapses', blast: 'Cost and TTFT both jump with no visible cause; reviewers saw nothing wrong in the diff.', fix: 'Stable-first prompt assembly, a CI assertion on the prefix, and an alert on cache hit rate as a first-class metric.' },
        { mode: 'Semantic cache without tenant scoping', blast: 'One customer receives another customer\u2019s answer. Security incident, not a cost bug.', fix: 'Tenant and permission scope in the cache key, always. Whitelist safe intents, short TTL, log original and matched query for audit.' },
        { mode: 'Semantic cache threshold too loose', blast: 'Confidently wrong answers to near-miss questions -- especially negations and qualifiers -- that no error rate reveals.', fix: 'Tune the threshold against labelled pairs from your own traffic; restrict to stable non-personalised intents; measure cache-hit answers in your eval set.' },
        { mode: 'Escalation rate creeps up unnoticed', blast: 'Cascade savings evaporate and you now pay for two calls per request instead of one.', fix: 'Escalation rate as a monitored metric with an alert; investigate as a quality regression, since it usually means retrieval got worse.' },
        { mode: 'Per-process budget enforcement', blast: 'Ten replicas each allow the full limit, so the effective cap is 10x the intended one.', fix: 'Shared atomic counter with a windowed TTL, enforced in the gateway rather than in each application.' },
        { mode: 'Hard 429 as the only budget behaviour', blast: 'A cost threshold becomes a customer outage and an escalation someone has to resolve manually.', fix: 'Staged degradation -- notify, then cheap tier and lower k, then cache-only and deferral, then a clear message with a reset time and an upgrade path.' },
        { mode: 'Retries on non-transient failures', blast: 'A malformed-output failure is retried three times at full cost and fails identically each time.', fix: 'Retry only transport-level errors with jittered backoff; on validation failure, change something -- repair prompt or escalate tier -- or give up.' },
        { mode: 'Interactive pricing for background work', blast: 'Nightly enrichment costs roughly double what it needs to, indefinitely.', fix: 'Route anything without a waiting human to the async batch endpoint; make that the default for background jobs in the platform.' },
        { mode: 'Silent failover to an untuned provider', blast: 'Quality drops noticeably during a provider incident and nobody can explain why; possibly a compliance breach if the region was constrained.', fix: 'Per-model tuned prompt variants gated by evals; treat failover as a declared capability tier; encode residency constraints in the router.' }
      ]
    },

    {
      t: 'staff',
      md: `Cost is where AI engineering meets business reality, and interviewers use it to find
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
it deserves.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'Your AI feature costs 3x forecast. Where do you look first?',
          options: [
            'Reduce `max_tokens` to shorten responses.',
              'Input token composition -- system prompt, tool schemas, retrieved context, history -- plus retry and escalation rates.',
            'Negotiate a volume discount with the provider.',
            'Switch to a cheaper provider across the board.'
          ],
          answer: 1,
          why: 'Input tokens usually dominate because everything static is re-sent on every call and history is re-sent every agent step, so a 12k-token system prompt or k=20 retrieval is a far bigger lever than output length. Retries and cascade escalations are the other common surprise -- work you paid for and discarded. Shortening outputs optimises the smaller side of the ledger, and switching provider before understanding the composition just moves an unexamined bill.'
        },
        {
          q: 'A teammate adds `Current date: {{today}}` to the top of the system prompt for date-awareness. What happens?',
          options: [
            'Nothing measurable -- it is a few tokens.',
            'Prefix cache hit rate collapses, so input-token cost and TTFT both rise sharply.',
            'The model refuses requests with unstable prompts.',
            'Only requests spanning midnight are affected.'
          ],
          answer: 1,
          why: 'Prefix caching is prefix-exact: the cache matches leading tokens up to the first difference, so a value that changes near the start invalidates everything after it. Every request now pays full prefill and full input-token price on content that used to be heavily discounted. The fix is placement, not removal -- put volatile values after the stable system prompt, tool schemas and few-shot examples. This is why cache hit rate needs an alert: the diff looks harmless and the regression is invisible until the invoice.'
        },
        {
          q: 'Which is the strongest reason to be cautious about semantic caching in a multi-tenant B2B product?',
          options: [
            'Embedding the query adds latency.',
            'Without tenant and permission scope in the key it can serve one customer\u2019s answer to another, and near-miss queries with different answers look similar in embedding space.',
            'Vector databases are expensive to operate.',
            'It only works for English.'
          ],
          answer: 1,
          why: 'Two failures stack. The correctness one: similar is not the same -- "cancel my subscription" versus "cancel before renewal", "encrypted at rest" versus "in transit", and negations, which embeddings handle poorly. The security one is worse: a globally-keyed semantic cache is a cross-tenant data leak with a fuzzy match function, the same class of failure as caching personalised HTML in a shared CDN. If you use it, scope by tenant and permissions, whitelist stable intents, keep the TTL short, and log original and matched query for audit.'
        },
        {
          q: 'A tenant hits their monthly AI budget on day 22. What is the best default behaviour?',
          options: [
            'Return 429 for the rest of the month.',
            'Degrade in stages: cheap tier and reduced context, then cache-only and deferral of background work, then a clear message naming the reset time and an upgrade path.',
            'Keep serving and invoice the overage silently.',
            'Fail over to a different provider to spread the cost.'
          ],
          answer: 1,
          why: 'A hard 429 converts a cost threshold into a customer outage and a manual escalation under pressure. Staged degradation keeps the feature useful while cutting spend substantially -- a smaller model with k=4 can be a large multiple cheaper and only slightly worse. Silent overage destroys the point of a budget and creates a billing dispute. Failing over to another provider does not reduce cost at all; it just moves which invoice it lands on.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `Prefix caching is the commercial face of the KV-cache mechanics in **Inference
Serving & Performance**. Retrieval-k as a cost dial connects to **Advanced Retrieval** and
**Context Engineering**, and the quadratic history growth is **Agent Architecture**. Per-span
cost attribution comes from **AI Observability & Tracing**, every routing path must be gated by
**Evaluation & Quality Regression**, and the gateway that enforces budgets and residency is
**Capstone: An AI Platform**.`
      }]
    }
  ],

  flashcards: [
    { q: 'Where does AI spend actually go?', a: 'Mostly input tokens -- system prompt, tool schemas, retrieved context and history, all re-sent every call, and re-sent every step in an agent loop. Retries and abandoned runs are usually the second largest and least tracked line.' },
    { q: 'Why is prefix caching the highest-leverage cost lever?', a: 'It cuts input-token price substantially (discounts around 90% are common) *and* reduces TTFT, with zero quality cost. Nothing else improves cost and latency at the same time.' },
    { q: 'What breaks prefix caching?', a: 'Any token change near the start, because matching is prefix-exact. Timestamps, user names or request IDs at the top of the system prompt, and non-deterministically ordered retrieved chunks. Order prompts stable-first, volatile-last, and alert on cache hit rate.' },
    { q: 'What makes a good cascade escalation signal?', a: 'A deterministic verification failure -- output did not parse, schema invalid, citation IDs do not resolve, SQL did not execute, tests failed. Then explicit `INSUFFICIENT_CONTEXT` style self-assessment, then log-prob signals, then a classifier trained on your own escalation labels.' },
    { q: 'When does a cascade stop paying?', a: 'When escalation is common. At a 10x tier price gap, escalating 20% of traffic still saves roughly 70%; escalating 60% saves almost nothing once you count the wasted first call. Monitor escalation rate and treat a rise as a quality regression.' },
    { q: 'Why is semantic caching dangerous?', a: 'Similar questions can have different answers -- qualifiers and negations especially, since embeddings handle negation poorly. And without tenant plus permission scope in the key it leaks data across tenants, the same failure class as caching personalised HTML in a shared CDN.' },
    { q: 'How should a tenant budget be enforced and what happens at the limit?', a: 'A shared atomic counter in the gateway, never per process, or the effective cap multiplies by replica count. Degrade in stages: notify at ~70%, cheap tier and lower k at ~85%, cache-only plus deferral at 100%, then a clear message naming the reset time and an upgrade path.' },
    { q: 'Why is retrieval-k both a cost and a quality dial?', a: 'k drives the largest volatile part of the prompt, so k=20 to k=5 cuts that component about 4x -- and quality often improves, because long contexts lose the middle and irrelevant chunks distract. Plot eval score against k and take the knee.' },
    { q: 'What is the honest caveat about multi-provider failover?', a: 'The API surface is portable; the prompts are not. Models differ in instruction following, tool-call syntax, refusal boundaries, long-context behaviour and tokenisation. Treat failover as a declared capability tier with a tuned, eval-gated prompt variant per model.' }
  ],

  drills: [
    {
      prompt: 'A B2B SaaS product has an AI assistant used by 800 tenants. Model spend is $95k/month against a target of $30k, and it is growing faster than revenue. Traffic is roughly 60% short factual questions over the tenant\u2019s own documents, 25% summarisation, and 15% multi-step analysis. Everything currently goes to one frontier model with k=20 retrieval. Get to target without a quality regression the customers notice.',
      probes: [
        'What do you measure before changing anything, and what is your ordering?',
        'Which changes are free, which trade quality, and how do you tell?',
        'Two tenants account for 40% of spend. What do you do about them specifically?',
        'How do you prevent this recurring in six months?',
        'What would make you refuse to hit the target?'
      ],
      strong: [
        'Builds the unit-economics model first and breaks spend down by tenant, feature, prompt version and route reason before proposing tactics.',
        'Starts with the free wins: prefix caching with stable-first prompt ordering, exact-match response caching keyed including retrieved doc IDs, and moving summarisation to the async batch endpoint.',
        'Reduces k with a reranker and justifies it by plotting eval score against k, noting quality often improves.',
        'Routes by task class -- small model for the 60% factual-lookup traffic with verification-driven escalation -- and quantifies the saving against the tier price gap.',
        'Quantifies the escalation rate needed for the cascade to pay and commits to monitoring it.',
        'Investigates the two heavy tenants for a specific pathology (huge documents, retry loops, abusive scripting) rather than assuming they are just big, and proposes per-tenant budgets with staged degradation and possibly a pricing conversation.',
        'Gates every change with the existing eval suite per slice, and reports cost and latency deltas beside quality.',
        'Installs prevention: CI token budget on prompt templates, prefix-stability assertion, cache-hit-rate alert, cost-per-request rate-of-change alert by tenant.',
        'Names a refusal condition -- for example that the 15% multi-step analysis slice cannot be downgraded without a measurable regression, so the target must come from the other 85%.'
      ],
      weak: [
        'Immediately proposes semantic caching across all traffic with no tenant scoping or threshold validation.',
        'Switches everything to a cheaper model with no eval and no per-slice check.',
        'Focuses on shortening outputs, or on negotiating a discount, as the primary lever.',
        'No measurement of the current composition of spend.',
        'Treats the two heavy tenants as simply large without investigating why.',
        'No prevention mechanism, so the same drift recurs next quarter.',
        'Claims the target is achievable with zero quality trade and cannot say how they would know.'
      ]
    },
    {
      prompt: 'Your primary provider has a partial outage: roughly 30% of requests return 529 and p95 latency has tripled. You have a second provider configured through LiteLLM but have never served meaningful production traffic on it, and your prompts were tuned on the primary. One of your surfaces is a regulated workflow whose outputs are reviewed by auditors. Decide what to do in the next ten minutes and what to build afterwards.',
      probes: [
        'Do you fail over everything? Why or why not?',
        'What exactly are you risking by routing to an untuned model?',
        'How do you handle the regulated surface differently?',
        'What do users see, and what do you tell them?',
        'What do you build in the following two weeks so this is boring next time?'
      ],
      strong: [
        'Fails over selectively rather than globally: non-regulated, non-critical surfaces first, and states that prompts are not portable so failover is a quality change.',
        'Names the concrete risks on an untuned model: tool-call format differences, weaker instruction following causing schema failures, different refusal boundaries, different tokenisation blowing context budgets.',
        'Holds the regulated surface back and degrades it explicitly -- queue, cache-only, or route to human review -- rather than silently swapping models in an audited workflow.',
        'Respects `Retry-After` and trips a circuit breaker per provider and model rather than retrying into the outage, since blind retries amplify both load and cost.',
        'Communicates degradation honestly in the UI rather than silently serving worse answers.',
        'Afterwards: maintains an eval-gated prompt variant per model for the paths intended to fail over, and runs a periodic shadow-traffic test on the secondary so it is never cold.',
        'Adds route-reason and resolved-model telemetry so the failover is visible in dashboards and in the audit log.',
        'Encodes residency and provider constraints in the router so the regulated surface cannot be failed over by accident.'
      ],
      weak: [
        'Flips all traffic to the secondary provider and treats it as a transparent swap.',
        'Retries aggressively into the outage without honouring `Retry-After` or a circuit breaker.',
        'Treats the regulated surface identically to the others.',
        'Says nothing to users while quality degrades.',
        'No follow-up work, so the secondary provider stays untested until the next incident.',
        'Cannot name a single concrete way two models differ in behaviour.'
      ]
    }
  ]
};
