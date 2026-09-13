export default {
  blocks: [
    {
      t: 'prose',
      md: `Observability for an AI feature means being able to answer, after the fact and without
guessing: what exactly did we send the model, what did it send back, what did that cost, how
long did each part take, which documents did we retrieve, and was the user happy with the
result.

That sounds like ordinary tracing, and the transport is the same -- spans, traces, an exporter.
What is different is that the thing you most need to see is not a status code or a duration. It
is a **payload**: the prompt, the retrieved chunks, the tool arguments. Your latency graph can
be perfectly flat while the feature is confidently wrong on a fifth of requests, and nothing in
a normal APM dashboard will tell you.`
    },

    { t: 'h', text: 'Why standard APM is insufficient' },
    {
      t: 'prose',
      md: `Your existing monitoring stack answers "is it up and is it fast". For an LLM feature
those are the easy questions, and they are close to uncorrelated with whether the feature works.

A conventional service fails loudly: it throws, it 500s, a metric spikes, a page fires. An LLM
call returns HTTP 200 with a fluent paragraph whether that paragraph is correct, subtly wrong,
or a refusal. There is no error rate to alert on because there is no error.

Four other things break the normal model. **Cost per request varies by orders of magnitude** --
a 200-token question and a 60-step agent run go through the same endpoint, so a request-count
graph tells you nothing about spend. **Latency is two numbers, not one**: time to first token
governs perceived speed, total duration governs completion, and averaging them together hides
both. **Quality is the primary signal and it is not in the response** -- it is in what the user
did next. And **the inputs are non-deterministic and unlogged by default**, so "reproduce it
locally" is impossible unless you deliberately captured the exact serialised prompt, the prompt
template version and the resolved model snapshot.

So you keep your APM and you add a layer that treats prompts, retrievals, tokens and cost as
first-class telemetry.`
    },
    {
      t: 'table',
      title: 'Same question, different answer',
      cols: ['Question during an incident', 'Standard APM', 'What you need'],
      rows: [
        ['Is the endpoint erroring?', 'Answers it well', 'Keep it -- this part is unchanged'],
        ['Why did this one answer cite the wrong policy?', 'No visibility', 'Retrieved doc IDs and scores on the retrieval span'],
        ['Why did spend triple on Tuesday?', 'Request count looks flat', 'Token counts and cost per span, attributed to tenant and feature'],
        ['Why does it feel slow but p95 is fine?', 'Measures total duration only', 'TTFT separate from total, plus inter-token latency'],
        ['Is quality worse than last week?', 'Silent', 'Implicit signals plus judge scores on a sampled stream'],
        ['What exactly did we send the model?', 'Not captured', 'Serialised messages plus prompt template version, redacted and sampled'],
        ['Which tenant is causing the rate limiting?', 'Aggregate only', 'Tenant ID as a first-class span attribute on every call']
      ]
    },

    { t: 'h', text: 'The span model for LLM applications' },
    {
      t: 'prose',
      md: `The structure is straightforward once you see it. A **trace** is one user-visible
request. **Spans** are the stages inside it, and for AI work there are five kinds worth naming
separately: a retrieval span, a model-call span, a tool-call span, a guardrail span, and an
agent-step span that parents the others when the model is in a loop.

Nesting matters more than in a typical service, because the interesting question is usually
about a relationship between spans -- did the retrieval that preceded this generation actually
contain the answer? -- and you can only ask that if they share a parent.`
    },
    {
      t: 'diagram',
      code: `flowchart TB
  T["Trace: POST /chat<br/>tenant, user, session"] --> G1["Span: guardrail input<br/>PII scan, injection check"]
  T --> R["Span: retrieval<br/>query, top-k, doc IDs, scores"]
  T --> RR["Span: rerank<br/>model, input k, output k"]
  T --> A["Span: agent step 1"]
  A --> M1["Span: model call<br/>tokens, TTFT, cost, finish reason"]
  A --> TC["Span: tool call<br/>name, args, result, identity"]
  T --> A2["Span: agent step 2"]
  A2 --> M2["Span: model call"]
  T --> G2["Span: guardrail output<br/>egress check, PII redact"]
  T --> FB["Event: feedback<br/>accepted, edited, regenerated"]`,
      caption: 'One trace per user request. The feedback event arrives later and must join back on trace ID.'
    },
    {
      t: 'prose',
      md: `Use the OpenTelemetry GenAI semantic conventions rather than inventing attribute
names. They are still marked Development and they have churned -- \`gen_ai.system\` became
\`gen_ai.provider.name\`, and the older \`prompt_tokens\`/\`completion_tokens\` pair became
\`input_tokens\`/\`output_tokens\` -- so if you are joining telemetry from several SDK generations,
coalesce the old and new names with a precedence rule rather than summing them, because
frameworks in a compatibility window emit the same value under both.

The reason to follow the convention anyway is portability. Langfuse, Arize Phoenix, Braintrust,
Datadog and the rest all consume OTel spans, so conventional attribute naming means you can
change vendor without re-instrumenting, and your AI spans sit in the same trace as your database
and HTTP spans -- which is exactly what you want at 3am.`
    },
    {
      t: 'code',
      lang: 'python',
      title: 'Instrumenting a model call with GenAI conventions',
      code: `from opentelemetry import trace
tracer = trace.get_tracer("chat-service")

# Span name convention: "{operation} {model}"
with tracer.start_as_current_span("chat gpt-4o-2024-11-20") as span:
    span.set_attributes({
        # --- identity and routing: the attributes every dashboard filters on
        "gen_ai.provider.name":        "openai",
        "gen_ai.operation.name":       "chat",
        "gen_ai.request.model":        requested_model,      # what we asked for
        "gen_ai.request.temperature":  0.0,
        "gen_ai.request.max_tokens":   1024,
        # --- our own dimensions, and they are not optional at org scale
        "app.tenant_id":               ctx.tenant_id,
        "app.feature":                 "support_assistant",
        "app.prompt_id":               "support_reply",
        "app.prompt_version":          "v17",                 # replay needs this
        "app.route_reason":            "cascade_escalated",
    })

    t0 = time.perf_counter()
    stream = client.chat(messages=messages, stream=True)
    first_token_at = None
    for chunk in stream:
        if first_token_at is None:
            first_token_at = time.perf_counter()
            span.set_attribute("gen_ai.response.time_to_first_token", first_token_at - t0)
        yield chunk

    span.set_attributes({
        "gen_ai.response.model":       stream.model,           # resolved snapshot, may differ
        "gen_ai.response.finish_reasons": [stream.finish_reason],
        "gen_ai.usage.input_tokens":   stream.usage.input_tokens,   # includes cached
        "gen_ai.usage.cache_read.input_tokens": stream.usage.cached_tokens,
        "gen_ai.usage.output_tokens":  stream.usage.output_tokens,
        "app.cost_usd":                price(stream.model, stream.usage),
        "app.total_ms":                (time.perf_counter() - t0) * 1000,
    })`
    },
    {
      t: 'note',
      tone: 'info',
      title: 'Record requested and resolved model separately',
      md: `\`gen_ai.request.model\` may be a floating alias; \`gen_ai.response.model\` is the dated
snapshot that actually served you. When behaviour shifts overnight with no deploy on your side,
a group-by on the resolved model is the query that finds it in thirty seconds. Without it you
will spend a day bisecting your own commits.`
    },

    { t: 'h', text: 'What to capture per span' },
    {
      t: 'table',
      title: 'Retrieval span',
      cols: ['Attribute', 'Why you will want it'],
      rows: [
        ['Query text, and the rewritten query if you rewrite', 'The most common RAG bug is that the rewrite changed the meaning'],
        ['Embedding model and index version', 'Answers "did the re-index cause this" without a debate'],
        ['Returned document IDs, in order, with scores', 'Lets you ask whether the answer was even retrievable; the core RAG debugging primitive'],
        ['Filters applied, including ACL predicates', 'Empty results are usually a filter, not the vector search'],
        ['Result count and whether it was empty', 'Retrieval-empty rate is a top-tier alert signal'],
        ['Latency split: embed, search, rerank', 'Rerankers are often the hidden p95 contributor']
      ]
    },
    {
      t: 'table',
      title: 'Model-call and tool-call spans',
      cols: ['Attribute', 'Why you will want it'],
      rows: [
        ['Input / output / cached token counts', 'Cost, context-pressure and cache-effectiveness all come from here'],
        ['TTFT and total duration, separately', 'Perceived latency versus completion latency are different products'],
        ['Finish reason', '`length` truncations are a silent quality killer that looks like a success'],
        ['Computed cost in your currency', 'Do the arithmetic at write time; nobody joins a price table at query time'],
        ['Prompt template ID and version', 'The only way to attribute a regression to a prompt change'],
        ['Route reason and cascade level', 'Explains cost spikes -- "escalation rate doubled" is an actionable finding'],
        ['Retry count and the error that triggered each', 'Retries are frequently the real cost story'],
        ['Tool name, arguments, result size, identity used', 'Audit trail for a non-deterministic actor taking real actions'],
        ['Tool outcome: ok, typed error, timeout, denied', 'Denied-call rate is both a quality and a security signal']
      ]
    },
    {
      t: 'note',
      tone: 'danger',
      title: 'What you must not capture, or must redact first',
      md: `Prompts contain whatever the user pasted, and users paste anything -- API keys, medical
details, another customer's contract, a bearer token from a support ticket. Retrieved chunks
contain whatever is in your corpus. If you ship raw prompts to a third-party observability
vendor you have created a data-processing relationship and probably a compliance problem.

Defaults worth adopting: never log credentials or secrets at any sampling rate; run PII
detection and redact before export rather than after; store payloads in *your* infrastructure
with short retention and export only metadata to the vendor if your regime requires it; drop
payload capture entirely for tenants under a data-processing agreement that forbids it, while
keeping the metrics; and gate raw-payload access behind a separate permission with its own audit
log, because "engineer reads customer conversations to debug" is a real incident category.`
    },

    { t: 'h', text: 'Cost attribution as a first-class requirement' },
    {
      t: 'prose',
      md: `On a normal service you learn cost per tenant by modelling it, because CPU time is
roughly proportional to requests. With LLMs the variance between two requests to the same
endpoint is enormous -- one tenant pasting 50-page documents into a summariser can cost more
than ten thousand tenants asking short questions. A request-count graph is actively misleading.

Which means the cost dimension has to be on the span, computed at write time, and attributable
along every axis someone will ask about: tenant, feature, prompt version, model, route reason,
user, and cache-hit status. Retrofitting this is painful -- you cannot back-fill a tenant ID onto
last month's spans -- so it belongs in the first instrumentation pass even if nobody has asked
for chargeback yet.

Three questions you should be able to answer from a dashboard in under a minute. Which tenant is
the top spender this week and what is their cost per active user? Which prompt version changed
cost per request, and when? What fraction of spend is retries and failed runs -- work you paid
for and threw away, which is usually the most surprising number in the whole exercise.`
    },
    {
      t: 'numbers',
      title: 'Cost-telemetry figures worth watching',
      items: [
        { v: '10-100x', k: 'Spread in cost per request on one endpoint', note: 'Why request counts are not a cost proxy' },
        { v: 'usually >70%', k: 'Share of spend that is input tokens', note: 'History, system prompt, retrieved context' },
        { v: 'often 5-15%', k: 'Spend on retries and abandoned runs', note: 'Track it explicitly; it is rarely zero' },
        { v: '2 numbers', k: 'Latency SLOs you need', note: 'TTFT for perception, total for completion' },
        { v: '1-5%', k: 'Sensible payload sampling rate at scale', note: 'Plus 100% of errors and flagged sessions' },
        { v: '7-30 days', k: 'Typical payload retention', note: 'Metrics keep far longer than payloads' }
      ]
    },

    { t: 'h', text: 'Quality telemetry in production' },
    {
      t: 'prose',
      md: `The hardest thing to measure is the thing that matters most, and the trap is to reach
for a thumbs-up button and consider it solved. Explicit feedback has response rates in the low
single digits and a severe selection bias toward the delighted and the furious, so the ratio
mostly describes who chose to click. It is useful for *collecting cases* and close to useless as
a quality metric.

Implicit signals are dense, unbiased by self-selection, and tied to the job the user came to do.
The shape of them depends on your product, but the categories are consistent: did they accept
the output or edit it, and how much of it survived; did they regenerate; did they rephrase and
ask again, which is one of the strongest negative signals available because the user is telling
you the first answer failed; did they abandon mid-stream, and at what token; did the conversation
run long, which can mean engagement or can mean struggle and you need another signal to
disambiguate; did they escalate to a human.

Two implementation details decide whether any of this works. **Join key**: every feedback event
must carry the trace ID of the interaction it refers to, or you have a pile of sentiment with no
link to the prompt version, model or retrieval that produced it. **Timing**: feedback arrives
seconds to hours after the span closed, so it is an out-of-band event joined on trace ID, not an
attribute you can set before the span ends.

On top of that, run a **sampled judge stream** in production: take 1-5% of real interactions,
score them with a frozen judge on groundedness and relevance, and track the distribution over
time. That is your early-warning system for quality drift between releases -- but read it as a
relative trend on a consistent sample, not an absolute score, for all the reasons in
**Evaluation & Quality Regression**.`
    },
    {
      t: 'code',
      lang: 'typescript',
      title: 'Joining feedback back to the trace',
      code: `// The client keeps the trace ID from the response header and attaches it
// to every subsequent interaction with that output.
await fetch('/api/feedback', {
  method: 'POST',
  body: JSON.stringify({
    traceId,                       // the join key -- without this the signal is orphaned
    signal: 'edited',              // accepted | edited | regenerated | rephrased | abandoned
    editDistanceRatio: 0.34,       // how much of the output survived
    dwellMs: 8200,                 // did they read it before acting
    abandonedAtToken: null
  })
});

// Server side: an event on the original trace, not a new trace.
span_link = { trace_id: body.traceId };
emitFeedbackEvent({
  ...span_link,
  signal: body.signal,
  edit_survival: 1 - body.editDistanceRatio,
  // Denormalise the dimensions you will group by, so quality queries do not
  // need a join against the span store at read time.
  prompt_version: lookupPromptVersion(body.traceId),
  resolved_model: lookupResolvedModel(body.traceId),
  tenant_id: ctx.tenantId
});`
    },

    { t: 'h', text: 'Sampling, retention and replay' },
    {
      t: 'prose',
      md: `You cannot store full payloads for every request at scale, and you should not want to.
Split the decision: **metrics for everything, payloads for a sample**. Token counts, latency,
cost, finish reasons and doc IDs are small and belong on 100% of traffic. Serialised prompts and
full retrieved chunks are large and sensitive, so sample them -- with the sampling biased toward
what you will need, which means 100% of errors, 100% of sessions carrying negative feedback,
100% of anything a guardrail flagged, and a low baseline rate of everything else.

Prefer **tail sampling**: decide whether to keep the payload after the trace completes, when you
know it failed, cost an outlier amount, or exceeded the latency budget. Head sampling throws away
exactly the traces you will be asked about.

Replay is what all of this is for. To reproduce a failed run you need the exact serialised
messages, the prompt template version, the resolved model snapshot and sampling parameters, the
tool schema version, and the raw tool responses. With those you get two modes. **Cached replay**
serves tool calls and retrieval from the recorded responses, so you are testing your own logic
in isolation -- this is the mode that turns a vague report into a fixed bug. **Live replay** runs
against the real world, which is how you tell whether behaviour drifted because the model
changed or because the data did.

The reason to store the *serialised* messages rather than the template plus variables is that
the bug is often in the serialisation -- a truncated chunk, a variable that rendered as
\`undefined\`, retrieved context in an order you did not intend. Store both if you can afford it;
store the serialised form if you have to choose.`
    },

    { t: 'h', text: 'Alerting on the right signals' },
    {
      t: 'prose',
      md: `The mistake is to alert on error rate and average latency, which for an AI feature are
nearly flat while it degrades. Alert on the signals that move when quality moves.`
    },
    {
      t: 'table',
      title: 'Alerts worth a page, and what each one is really telling you',
      cols: ['Signal', 'Why it moves', 'Suggested shape'],
      rows: [
        ['**Retrieval-empty rate**', 'Index broken, re-index mid-flight, ACL filter too tight, embedding mismatch', 'Page on a step change; this is the cleanest "RAG is broken" signal'],
        ['**Refusal rate**', 'Prompt change, model swap, safety filter tuning, or an attack wave', 'Alert on deviation in either direction -- a *drop* can mean guardrails stopped working'],
        ['**Schema / parse failure rate**', 'Provider changed the model behind an alias, or a tool schema edit', 'Page above a low threshold; usually correlates with resolved-model change'],
        ['**p95 TTFT**', 'Provider degradation, prompt growth, cache-hit collapse, queue depth', 'Alert on TTFT separately from total duration -- they fail independently'],
        ['**Cost per request, by tenant and feature**', 'Longer context, more retries, cascade escalating more often, cache misses', 'Alert on rate of change, not absolute; catch it in hours, not on the invoice'],
        ['**Cache hit rate**', 'Prompt reordering broke the stable prefix -- a common silent regression', 'Alert on a drop; it is a leading indicator of a cost spike'],
        ['**Judge score on the sampled stream**', 'Genuine quality drift from any upstream change', 'Weekly trend with a wide band; use as a trend, never a hard gate'],
        ['**Escalation / regenerate rate**', 'Users telling you the answer is not good enough', 'Best lagging quality indicator you have; alert on a sustained step change'],
        ['**Truncation (`finish_reason=length`)**', 'Output cap too low for grown inputs', 'Alert above a low threshold -- it looks like success and is not']
      ]
    },

    { t: 'h', text: 'The dashboard someone opens during an incident' },
    {
      t: 'prose',
      md: `A dashboard is a diagnostic instrument, not a gallery. The test is whether an on-call
engineer who did not build the feature can narrow "the assistant is giving bad answers" to a
component within two minutes. Four rows, top to bottom.

**Row 1 -- is it working?** Request rate, error rate, refusal rate, retrieval-empty rate, schema
failure rate. These are the fastest way to see a step change and they localise the problem to a
stage.

**Row 2 -- is it fast?** p50/p95/p99 TTFT and total duration, split by model and by route, plus
provider-side error and rate-limit counts. Split by model matters: one provider degrading looks
like a general slowdown until you break it out.

**Row 3 -- what is it costing?** Cost per request and total spend, grouped by tenant, feature
and prompt version, with cache hit rate and retry share beside them. This row is where a
regression that is invisible in quality terms shows up first.

**Row 4 -- is it any good?** Sampled judge score trend, accept-versus-edit rate, regenerate rate,
escalation rate, and a live list of the most recent negative-feedback traces as clickable links.
That last widget is the single most useful thing on the page, because it takes you from a metric
to a concrete broken example in one click -- and being able to read the actual prompt and the
actual retrieved chunks is how incidents get closed.

Every panel should be filterable by tenant, feature, prompt version and resolved model. Those
four dimensions answer most questions on their own: "it started when prompt v17 rolled out",
"only tenant 4412", "only on the snapshot the provider switched us to".`
    },

    {
      t: 'tradeoffs',
      title: 'Deep AI instrumentation',
      gains: [
        'Bad answers become debuggable -- you can see the exact prompt and retrieved chunks.',
        'Cost becomes attributable per tenant and feature, which makes pricing and quotas possible.',
        'Quality regressions surface from behaviour before users file tickets.',
        'Failed runs can be replayed with cached tools to isolate your own logic.',
        'Model and prompt changes can be correlated to outcomes because versions are on the span.'
      ],
      costs: [
        'Payload storage is large, and sensitive -- PII, retention and access control all become your problem.',
        'Third-party AI observability vendors create a data-processing relationship you must review.',
        'Prompt capture adds serialisation overhead on the hot path if done naively.',
        'Sampling means the trace you want may be the one you dropped.',
        'The GenAI conventions are still Development status, so attribute names have churned and may again.',
        'A sampled judge stream is a real ongoing inference bill for telemetry alone.'
      ]
    },
    {
      t: 'failures',
      title: 'Observability failures, which are the worst kind',
      items: [
        { mode: 'No tenant dimension on spans', blast: 'A cost spike is visible in total and unattributable; you cannot answer "who" and cannot back-fill it.', fix: 'Tenant, feature and prompt version as required attributes enforced in the client wrapper, from the first commit.' },
        { mode: 'Raw prompts exported to a vendor', blast: 'Customer PII and pasted secrets leave your boundary; compliance incident independent of any breach.', fix: 'Redact before export, keep payloads in your own store with short retention, gate raw access behind a separate audited permission.' },
        { mode: 'Feedback with no trace ID', blast: 'Thousands of thumbs-down that cannot be linked to a prompt version, model or retrieval -- unusable.', fix: 'Return the trace ID to the client and require it on every feedback event; denormalise key dimensions onto the event.' },
        { mode: 'Head sampling at 1%', blast: 'The failure you were paged about was not recorded; the investigation ends at "cannot reproduce".', fix: 'Tail sampling with a keep-rule for errors, outlier cost, latency-budget breaches and negative feedback.' },
        { mode: 'TTFT and total duration averaged together', blast: 'Users report the feature feels slow while the latency dashboard is green.', fix: 'Separate metrics and separate SLOs; stream-based products live or die on TTFT.' },
        { mode: 'Truncation counted as success', blast: 'Answers silently cut off mid-sentence; HTTP 200 and no alert; users quietly stop trusting the feature.', fix: 'Record `finish_reason` on every span and alert when `length` exceeds a low threshold.' },
        { mode: 'Cost computed at query time from a price table', blast: 'Historical cost analysis silently changes when prices are updated; numbers stop reconciling.', fix: 'Compute and store cost on the span at write time, with the price-table version recorded.' },
        { mode: 'Prompt version not recorded', blast: 'Quality drops after a rollout and there is no way to attribute it; the team argues instead of reverting.', fix: 'Prompts are versioned artefacts from a registry; the version is a required span attribute and a dashboard filter.' }
      ]
    },

    {
      t: 'staff',
      md: `Most candidates say "we would use Langfuse" and stop. The signal is in knowing *what
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
redaction or retention control that makes capturing it defensible.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'Your AI assistant\u2019s error rate is 0.1% and p95 latency is unchanged, but support tickets about wrong answers tripled this week. Which telemetry finds it fastest?',
          options: [
            'CPU and memory utilisation on the inference service.',
            'Retrieval-empty rate and retrieved document IDs per query, filtered by index version.',
            'Total request count by endpoint.',
            'HTTP status code distribution.'
          ],
          answer: 1,
          why: 'Wrong answers with healthy infrastructure metrics almost always means the retrieval stage stopped supplying the right context -- a re-index, an embedding-model mismatch, or an ACL filter that became too tight. Retrieval-empty rate shows a step change immediately, and the per-query document IDs and scores let you confirm whether the correct chunk was even a candidate. Status codes cannot see this, because a grounded answer and a hallucinated one are both HTTP 200.'
        },
        {
          q: 'Why compute and store cost on the span at write time instead of deriving it later from token counts?',
          options: [
            'Token counts are unreliable.',
            'Prices change, so a query-time join silently rewrites historical cost and your numbers stop reconciling.',
            'It is required by the OpenTelemetry conventions.',
            'It reduces span size.'
          ],
          answer: 1,
          why: 'A price table is mutable; spans are immutable facts. Joining at query time means last quarter\u2019s cost analysis changes when someone edits a price, and reconciliation against the provider invoice becomes impossible. Computing at write time -- and recording which price-table version was used -- makes the span a durable record. It also makes cost a directly groupable dimension by tenant, feature and prompt version without every consumer reimplementing pricing.'
        },
        {
          q: 'You can afford to store full prompt payloads for 2% of requests. How should you choose the 2%?',
          options: [
            'Uniform random head sampling for statistical validity.',
            'Tail sampling: keep all errors, outlier-cost runs, latency-budget breaches and negative-feedback sessions, plus a small random baseline.',
            'Only the highest-paying tenants.',
            'The first 2% of requests each hour.'
          ],
          answer: 1,
          why: 'Payload capture exists for debugging, and debugging is about outliers, so you want a biased sample. Head sampling decides before knowing the outcome and therefore discards most of the traces you will be asked about -- the investigation ends at "not recorded". Tail sampling decides after the trace completes, when failure, cost and latency are known. Keep a small random baseline too, so you retain an unbiased slice for distribution questions.'
        },
        {
          q: 'Which is the strongest reason to follow the OpenTelemetry GenAI semantic conventions rather than your own attribute names?',
          options: [
            'They are stable and will not change.',
            'AI spans land in the same trace as your HTTP and database spans, and vendors consume them, so you can switch tooling without re-instrumenting.',
            'They automatically redact PII.',
            'They are required for prompt caching.'
          ],
          answer: 1,
          why: 'The value is a single correlated trace and vendor portability -- one query can span the model call, the retrieval and the Postgres call behind it, and Langfuse, Phoenix, Braintrust and Datadog all ingest the same shape. They are explicitly *not* stable: `gen_ai.system` became `gen_ai.provider.name` and `prompt_tokens`/`completion_tokens` became `input_tokens`/`output_tokens`, so during a transition coalesce old and new names with a precedence rule and never sum them, since compatibility layers emit both.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `Traces are the raw material for the golden datasets in **Evaluation & Quality
Regression** -- production sampling is the same pipeline. Cost attribution per span is what makes
the budgets and chargeback in **Model Routing, Caching & Cost Control** and **Capstone: An AI
Platform** possible at all. The agent-step span structure comes from **Agent Architecture**, and
replay depends on the pinned versions discussed there. Tool-call audit logging is a security
control covered in **AI Security & Guardrails**, and TTFT as a product metric is
**AI Product & UX Architecture**.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why is standard APM insufficient for LLM features?', a: 'A wrong answer is an HTTP 200 with a fluent paragraph -- there is no error to alert on. Cost per request varies 10-100x on one endpoint, latency is two numbers (TTFT and total), quality lives in what the user did next, and inputs are non-deterministic and unlogged by default.' },
    { q: 'What are the five span kinds in an LLM trace?', a: 'Retrieval, model call, tool call, guardrail, and an agent-step span that parents the others inside a loop. Nesting matters because the useful questions are about relationships between spans -- did the retrieval that preceded this generation contain the answer?' },
    { q: 'Why record requested and resolved model separately?', a: '`gen_ai.request.model` may be a floating alias; `gen_ai.response.model` is the snapshot that actually served you. When behaviour shifts with no deploy, grouping by resolved model finds a silent provider swap immediately.' },
    { q: 'What must never go into exported telemetry?', a: 'Credentials and secrets at any sampling rate, and un-redacted PII from prompts or retrieved chunks. Redact before export, keep payloads in your own store with short retention, and gate raw payload access behind a separate audited permission.' },
    { q: 'Why is tail sampling right for payloads?', a: 'Payloads exist for debugging, and debugging is about outliers. Tail sampling decides after the trace completes, so you can keep 100% of errors, outlier-cost runs, latency breaches and negative feedback. Head sampling discards exactly the traces you get paged about.' },
    { q: 'Why are thumbs-up/down weak, and what replaces them?', a: 'Single-digit response rates with selection bias toward the delighted and furious, so the ratio describes your sampling. Use implicit signals joined on trace ID: edit survival, regenerate rate, rephrase-and-ask-again, abandonment point, escalation.' },
    { q: 'What do you need to replay a failed run?', a: 'Exact serialised messages, prompt template version, resolved model snapshot and sampling parameters, tool schema version, and raw tool responses. Cached replay isolates your own logic; live replay tells you whether the world drifted.' },
    { q: 'Which AI-specific signals deserve alerts?', a: 'Retrieval-empty rate, schema/parse failure rate, refusal-rate deviation in either direction, p95 TTFT separately from total, cache hit rate, cost-per-request rate of change, truncation on `finish_reason=length`, and escalation/regenerate rate.' },
    { q: 'Why is a drop in refusal rate also worth alerting on?', a: 'Refusals are a feature. A sudden drop can mean a guardrail stopped firing, a safety filter was misconfigured, or a prompt change removed a constraint -- so alert on deviation in either direction, not just increases.' }
  ],

  drills: [
    {
      prompt: 'You own an AI feature used by 400 enterprise tenants. Finance says last month\u2019s model spend was 2.8x forecast and wants to know why. Product says three large customers complained about quality. You currently have request counts, HTTP status codes and p95 latency. Design the instrumentation, and say what you would answer with first.',
      probes: [
        'What is the minimum set of span attributes that answers the finance question?',
        'Some of these tenants have contracts that forbid processing their content by sub-processors. How does that change the design?',
        'How do you investigate the quality complaints without reading everyone\u2019s conversations?',
        'What would you alert on so this is caught in hours next time?',
        'What can you not answer about last month, and why?'
      ],
      strong: [
        'Tenant, feature, prompt version, requested and resolved model, input/output/cached tokens and cost computed at write time -- and is explicit that last month is unattributable because the dimensions were never recorded.',
        'Breaks the cost question down by tenant, prompt version and route reason, and specifically calls out retry and abandoned-run share plus cache hit rate as likely culprits.',
        'Separates payload capture from metric capture: metrics on 100% of traffic, payloads tail-sampled and stored in-house with redaction, with per-tenant opt-out that keeps metrics intact.',
        'Gates raw payload access behind a separate permission with its own audit log rather than giving all engineers conversation access.',
        'For quality, uses retrieval-empty rate, retrieved doc IDs and scores, schema failure rate and implicit signals joined on trace ID, plus a small sampled judge stream read as a trend.',
        'Alerts on cost-per-request rate of change per tenant, cache hit rate drops, retrieval-empty step changes and p95 TTFT -- not error rate and average latency.',
        'Notes TTFT versus total duration as separate SLOs.'
      ],
      weak: [
        'Adds an observability vendor SDK and considers cost attribution solved without naming the tenant dimension.',
        'Proposes logging every full prompt to a third party with no redaction or retention story.',
        'Relies on thumbs-up rate for the quality investigation.',
        'Suggests alerting on error rate and average latency.',
        'Claims last month can be reconstructed from provider invoices per tenant.',
        'No distinction between metric capture and payload capture, so the privacy constraint forces them to log nothing.'
      ]
    },
    {
      prompt: 'At 02:10 you are paged: an internal agent that files tickets has created 4,000 duplicate tickets in ninety minutes. It normally creates about 60 an hour. You have full GenAI span instrumentation. Walk through the investigation and say which panels and queries you use.',
      probes: [
        'What is your first query, and why that one?',
        'How do you tell a doom loop from a legitimate traffic surge?',
        'How do you decide whether to disable the feature or just one tool?',
        'What do you need in order to reproduce this in the morning?',
        'Which control should have contained the blast radius?'
      ],
      strong: [
        'Starts by grouping tool-call spans by tool name and normalised arguments to detect repetition, which separates a doom loop from real volume immediately.',
        'Checks steps-per-run distribution and finish reasons for runs hitting the step budget, and looks at whether replan count spiked.',
        'Groups by resolved model and prompt version to test whether a silent provider snapshot change or a prompt rollout correlates with the onset time.',
        'Checks tool-error rate and error *shape* -- an opaque error is the classic cause of identical retried calls.',
        'Mitigates narrowly first: revoke or rate-limit the `create_ticket` tool grant rather than disabling the whole feature, then add an idempotency key.',
        'Pulls the tail-sampled payloads for affected traces and confirms cached replay is possible using serialised messages, prompt version, resolved model and recorded tool responses.',
        'Names the missing controls: per-run step budget, structural loop detection, idempotency keys from run ID plus step index, and a per-tenant action-rate cap in the gateway.'
      ],
      weak: [
        'Starts with CPU and memory dashboards.',
        'Cannot distinguish repeated identical calls from genuine volume.',
        'Disables the entire feature as the only available mitigation.',
        'No plan for reproducing it, or assumes prompts can be reconstructed from the template alone.',
        'Blames the model without checking whether the resolved snapshot changed.',
        'Does not mention idempotency despite duplicate side effects being the symptom.'
      ]
    }
  ]
};
