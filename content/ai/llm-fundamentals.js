/* AI track — LLM Fundamentals for Engineers. See CONTENT-SCHEMA.md. */

export default {
  blocks: [
    {
      t: 'prose',
      md: `A large language model is a function that takes a sequence of tokens and returns a
probability distribution over the next token. That is the entire interface. Everything you
experience as reasoning, style, refusal or hallucination is a consequence of sampling from
that distribution repeatedly, feeding each choice back in as input.

You do not need to know how transformers are trained to build with them. You do need to know
what the objective implies, because almost every production surprise -- cost, latency,
non-determinism, confident wrongness -- falls out of the mechanism rather than from a bug
someone can fix for you.`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `Before 2018, making a machine do a language task meant building a model per task:
one for sentiment, one for named entities, one for summarisation, each with its own labelled
dataset. The transformer plus next-token prediction collapsed that. Predicting the next token
over a large enough corpus turns out to require modelling syntax, facts, translation, code
structure and a rough approximation of instruction-following, because all of those show up as
patterns that make the next token more predictable.

The practical consequence is that you no longer train a model, you *condition* one. The unit
of engineering moved from datasets and loss curves to tokens in a context window. That shift
is why "prompt", "context" and "tokens" are now capacity-planning terms and not curiosities.`
    },

    { t: 'h', text: 'Tokens: the unit you are billed and limited in' },
    {
      t: 'prose',
      md: `Models do not see characters or words. A tokeniser -- almost always a
byte-pair-encoding (BPE) variant -- splits text into subword units chosen so that frequent
sequences become single tokens and rare ones are spelled out from pieces. \`the\` is one token.
\`unfathomable\` might be three. An unusual surname might be six.

This is not a detail. It determines your bill, your context budget, and a specific family of
failures that look like stupidity but are actually a representation problem.`
    },
    {
      t: 'numbers',
      title: 'Tokenisation rules of thumb (English, modern BPE tokenisers)',
      items: [
        { v: '~4 chars', k: 'One token, average English prose', note: 'Roughly 0.75 words' },
        { v: '~1.3x', k: 'Tokens per word, English', note: 'Use this for quick budgeting' },
        { v: '2-4x', k: 'Token inflation for many non-Latin scripts', note: 'Same meaning, more tokens, more cost' },
        { v: '~1 token', k: 'Per 2-3 chars of minified JS or JSON', note: 'Punctuation-dense text tokenises badly' }
      ]
    },
    {
      t: 'prose',
      md: `Three failure classes follow directly:

- **Arithmetic and digit handling.** \`1234567\` may be split as \`123\`/\`45\`/\`67\`. The model is
  not manipulating place value, it is pattern-matching over chunks that do not align with
  digits. Multi-digit arithmetic degrades for exactly this reason. The fix is a calculator
  tool, not a better prompt.
- **Spelling and character operations.** "How many r's in strawberry" is hard because the model
  never saw the letters as separate items. Anything character-level -- reversing a string,
  counting letters, strict format-by-character -- belongs in code.
- **Non-English cost asymmetry.** The same paragraph in Hindi, Thai or Japanese can cost two to
  four times as many tokens as in English on a tokeniser whose merges were learned mostly from
  English text. If you price a feature per request and then launch in a new market, your unit
  economics move without anyone changing a line of code.`
    },
    {
      t: 'note',
      tone: 'warn',
      title: 'Count tokens, do not estimate them, at the boundary',
      md: `Estimating at 4 chars per token is fine for a capacity plan and dangerous for a hard
limit. Use the provider's tokeniser (\`tiktoken\` or the model's own) when you are deciding
whether a request fits, truncating history, or enforcing a per-tenant budget. The failure mode
of a bad estimate is a 400 at the worst possible moment, mid-conversation, in production.`
    },

    { t: 'h', text: 'Context window and why long context costs more than it looks' },
    {
      t: 'prose',
      md: `The context window is the maximum number of tokens -- input plus output -- the model
can attend to in one forward pass. Frontier models in 2026 advertise windows from roughly
128K up to the low millions of tokens. It is tempting to read that as "long documents are
solved". It is not, for two independent reasons: cost and attention quality.

Self-attention compares every token to every other token, so the attention computation grows
as **O(n²)** in sequence length. Modern implementations (FlashAttention and friends) make this
dramatically faster in wall-clock terms and reduce memory traffic, but they do not change the
asymptotics. Meanwhile the KV cache -- the stored keys and values for every token so you do
not recompute them each step -- grows *linearly* in sequence length and is what actually
limits how many concurrent requests a GPU can hold.

The second reason is quality. Retrieval accuracy inside a long context is not uniform across
positions; the "lost in the middle" result (Liu et al., 2023) showed models attend more
reliably to material at the start and end of the context than in the middle. Later models are
better but the effect has not vanished. A 1M-token window is a *budget*, not a promise that
every token in it is equally influential.`
    },
    {
      t: 'diagram',
      caption: 'One request, two completely different performance regimes. Measure them separately.',
      code: `flowchart LR
  R["Request arrives"] --> Q["Queue / batch admission"]
  Q --> P["Prefill<br/>process all input tokens<br/>in parallel"]
  P --> T1["First token emitted<br/>= TTFT"]
  T1 --> D["Decode loop<br/>one token at a time"]
  D --> D
  D --> E["Stop token or max tokens"]
  P -.->|compute bound<br/>scales with input length| GPU["GPU"]
  D -.->|memory bandwidth bound<br/>scales with model size| GPU`
    },

    { t: 'h', text: 'Prefill vs decode: the single most useful mental model' },
    {
      t: 'prose',
      md: `Inference has two phases with opposite performance characteristics, and conflating
them is the most common reason an AI feature is slow in a way nobody can explain.

**Prefill** processes your entire prompt at once. All input tokens go through the network in
parallel, which saturates the GPU's arithmetic units. It is *compute-bound*, and its duration
scales with how much input you sent. Doubling your prompt roughly doubles your time to first
token.

**Decode** generates output one token at a time. Each step must read the whole model's weights
plus the growing KV cache out of HBM to produce a single token. Almost no arithmetic, enormous
memory traffic: it is *memory-bandwidth-bound*. Its speed barely depends on prompt length and
is largely fixed by model size and hardware. This is why batching helps throughput so much in
decode -- the weights get read once and amortised across many concurrent sequences -- and why
it helps far less in prefill.`
    },
    {
      t: 'table',
      title: 'Two regimes, two metrics, two levers',
      cols: ['', 'Prefill', 'Decode'],
      rows: [
        ['User-visible metric', '**TTFT** — time to first token', '**ITL / TPOT** — inter-token latency, and tokens/sec'],
        ['Bottleneck', 'GPU compute (FLOPs)', 'Memory bandwidth (HBM reads)'],
        ['Scales with', 'Input token count', 'Model size; weakly with context length'],
        ['Main lever', 'Shorter prompts, **prompt-prefix caching**, chunked prefill', 'Smaller/quantised model, speculative decoding, larger batch'],
        ['Effect of batching', 'Modest — already compute-saturated', 'Large — amortises weight reads across requests'],
        ['What users feel', '"It hangs before it starts"', '"It types too slowly"']
      ]
    },
    {
      t: 'note',
      tone: 'info',
      title: 'Why one "latency" number is a broken SLO',
      md: `A 9,000-token RAG prompt returning 80 tokens and a 200-token chat turn returning 900
tokens can have identical end-to-end latency and feel completely different. The first is a
long silence then a quick answer; the second starts instantly and trickles. If you have one
p95 latency dashboard you cannot tell those apart, and you cannot tell which lever to pull.
Track TTFT, inter-token latency, output token count and total separately, tagged by route.`
    },

    { t: 'h', text: 'Sampling: temperature, top-p, and the determinism myth' },
    {
      t: 'prose',
      md: `The model emits logits -- an unnormalised score per vocabulary token. Sampling
parameters decide how those become a choice.

**Temperature** divides the logits before the softmax. Below 1 it sharpens the distribution
toward the top candidates; above 1 it flattens it. **Top-p** (nucleus sampling) keeps the
smallest set of tokens whose cumulative probability reaches p and renormalises over that set,
so it adapts to how confident the model is at each step. **Top-k** does the same with a fixed
count. Tune one of top-p or temperature, not both at once -- their effects compound in ways
that are hard to reason about.`
    },
    {
      t: 'table',
      cols: ['Setting', 'Typical use', 'What it actually does to failure modes'],
      rows: [
        ['`temperature: 0` (greedy)', 'Extraction, classification, structured output, tool calls', 'Maximises reproducibility and format adherence. Can loop or repeat on open-ended generation.'],
        ['`temperature: 0.2-0.4`', 'Summarisation, grounded Q&A', 'Small amount of variation; still strongly format-obedient.'],
        ['`temperature: 0.7-1.0`', 'Brainstorming, drafting, creative copy', 'More diverse and more likely to invent specifics. Do not use for anything you will parse.'],
        ['`top_p: 0.9-0.95`', 'General default with temperature left at 1', 'Truncates the long tail of implausible tokens without flattening confident steps.'],
        ['`seed` (where supported)', 'Reproducing a bug', 'Improves reproducibility. Does **not** guarantee it across provider deployments.']
      ]
    },
    {
      t: 'note',
      tone: 'danger',
      title: 'Temperature 0 is not determinism',
      md: `Greedy decoding is deterministic in theory. In practice, repeated identical requests
to a hosted model can return different text, and the reasons are all infrastructure:
floating-point reductions on GPUs are not associative, so results depend on how work was split
across threads; batch composition changes those splits, so *your* output depends on who else
was in the batch; mixture-of-experts routing can be batch-sensitive; and providers silently
update model builds behind a stable alias.

Engineering consequence: **never write a test that asserts exact model output**, never key a
cache on "the model will say the same thing", and pin the most specific model version string
your provider offers so at least the weights are held still.`
    },

    { t: 'h', text: 'Hallucination is the objective working as designed' },
    {
      t: 'prose',
      md: `The model is trained to produce a *plausible continuation*, not a *true* one. There
is no separate truth channel to consult and no internal "I do not know" state that is reliably
surfaced. When you ask for a citation, "a string that looks like a citation in this context"
is exactly what the objective asks for, and a fabricated one scores well on that objective.

Two further pressures make it worse. Training and evaluation regimes have historically rewarded
answering over abstaining -- a guess sometimes scores, an admission of ignorance never does --
so models are pushed toward confident output. And post-training for helpfulness makes refusal
costly in the eyes of the reward signal.

This reframes what you can build. You cannot prompt hallucination away; you can only change
the system so that being wrong is detectable and cheap:

- **Ground it.** Put the authoritative text in the context and require the answer to come from
  it (see *RAG: The Reference Architecture*).
- **Constrain it.** Enumerate the legal outputs with a schema or grammar so there is no room to
  invent a field (see *Prompting & Structured Output*).
- **Verify it.** Check citations resolve, check IDs exist, check numbers against a database.
- **Let it decline.** Give the model an explicit, rewarded refusal path and an evaluation set
  full of unanswerable questions, or it will never take it.
- **Design for wrongness.** Make the output editable, attributable and reversible (see
  *AI Product & UX Architecture*).`
    },

    { t: 'h', text: 'Knowledge cutoff and what the model cannot know' },
    {
      t: 'prose',
      md: `Weights are frozen at training time. Anything after the cutoff -- your latest deploy,
today's prices, yesterday's incident, the customer record created an hour ago -- is simply not
in there, and the model will happily answer anyway because plausibility does not require
recency. Models are also unreliable narrators about their own cutoff date and their own
identity; asking "what model are you" is a fun party trick and not a source of truth.

The design rule: **anything with a timestamp or an owner comes from a tool call or retrieval,
never from weights.** Put the current date in the system prompt explicitly; it is one of the
highest-value tokens you will ever spend, because without it the model silently assumes it is
still living in its training data.`
    },

    { t: 'h', text: 'A cost model you can actually use' },
    {
      t: 'prose',
      md: `Providers price input and output tokens separately, and output is typically several
times more expensive per token than input -- which follows directly from the prefill/decode
split, since decode is the serialised, bandwidth-bound part. Cached input tokens (a prefix the
provider has already processed) are cheaper still, often by a large factor.

Model your cost per *interaction*, not per token, and remember that in any conversational or
agentic product the history is re-sent every turn, so cost grows roughly quadratically in turn
count unless you compact.`
    },
    {
      t: 'code',
      lang: 'js',
      title: 'Per-interaction cost model — fill in your provider\'s rates',
      code: `// Rates are per 1M tokens. Use YOUR provider's current numbers.
const RATE = { in: 3.00, cachedIn: 0.30, out: 15.00 };

function costUSD({ inTok, cachedTok = 0, outTok }) {
  return (
    ((inTok - cachedTok) * RATE.in + cachedTok * RATE.cachedIn + outTok * RATE.out) / 1e6
  );
}

// A grounded RAG answer: 8 chunks x ~500 tok + 900 tok stable system prompt
// + 120 tok question, 350 tokens out.
costUSD({ inTok: 5020, outTok: 350 });               // ~= $0.0203

// Same request with the 900-token system prefix cached:
costUSD({ inTok: 5020, cachedTok: 900, outTok: 350 }); // ~= $0.0179  (-12%)

// A 20-turn agent conversation WITHOUT compaction. Each turn re-sends history.
let total = 0, ctx = 1200;                 // system prompt + tools
for (let turn = 0; turn < 20; turn++) {
  const out = 300;
  total += costUSD({ inTok: ctx, cachedTok: 1200, outTok: out });
  ctx += out + 400;                        // model output + user message + tool results
}
// total ~= $0.20 for one conversation, and the LAST turn costs ~6x the first.
// This is why compaction and prefix caching are cost features, not polish.`
    },
    {
      t: 'numbers',
      title: 'Orders of magnitude worth carrying in your head (2026, hosted frontier models)',
      items: [
        { v: '10-100x', k: 'Cost spread: small model vs frontier model', note: 'The entire case for routing' },
        { v: '3-10x', k: 'Output token price vs input token price', note: 'Short outputs are a real cost lever' },
        { v: '~10x', k: 'Discount on cached input prefixes', note: 'Order the prompt: stable content first' },
        { v: '50-150 tok/s', k: 'Typical single-stream decode rate', note: 'Faster than reading speed (~5-8 tok/s)' }
      ]
    },

    { t: 'h', text: 'Trade-offs of building on a hosted LLM' },
    {
      t: 'tradeoffs',
      gains: [
        'A general capability you would otherwise need a research team and labelled data to build.',
        'One interface covers extraction, classification, summarisation, drafting and routing.',
        'Capability improves without you retraining anything, as providers ship new versions.',
        'Fast iteration: a prompt change ships in seconds, not a training run.'
      ],
      costs: [
        'Non-determinism makes exact-match testing impossible, so you need evals instead of assertions.',
        'Per-token pricing turns a chatty feature into a variable cost line that scales with usage.',
        'Latency is seconds, not milliseconds, and is only partly under your control.',
        'Provider dependency: rate limits, deprecations and silent model updates are your outages.',
        'Any text that enters the context is effectively instruction-adjacent, which is a security surface.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'Prompt grows past the context limit mid-conversation', blast: 'Hard 400s for long-running or high-value sessions only.', fix: 'Count tokens with the real tokeniser before sending; reserve an explicit output budget; compact history at a threshold, not at the wall.' },
        { mode: 'Latency SLO set on total response time', blast: 'Long-prompt routes look healthy while TTFT quietly triples; users report "it hangs".', fix: 'Separate TTFT and inter-token-latency SLOs per route; alert on TTFT p95.' },
        { mode: 'Test asserts exact model output', blast: 'Flaky CI, team stops trusting the suite, real regressions get ignored.', fix: 'Assert on schema, invariants and eval scores against a golden set; never on the exact string.' },
        { mode: 'Provider silently rolls a model behind a stable alias', blast: 'Quality or format shifts overnight with no deploy of yours.', fix: 'Pin dated/specific version strings; run the eval suite on a schedule, not just on PRs; alert on output-shape drift.' },
        { mode: 'Launch in a non-English market', blast: 'Token spend per user rises 2-4x and some prompts stop fitting the window.', fix: 'Measure tokens-per-request per locale before launch; budget context in tokens, not characters.' },
        { mode: 'Model answers a post-cutoff question confidently', blast: 'Users act on stale facts; trust damage is disproportionate to frequency.', fix: 'Inject current date; route time-sensitive intents to retrieval or tools; evaluate refusal on an unanswerable set.' }
      ]
    },

    {
      t: 'staff',
      md: `The junior version of this topic is "LLMs predict the next token". The Staff version
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
fastest way to show you have run one of these in production rather than read the docs.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'Your RAG endpoint has p95 total latency of 4.1 s. You halve the number of retrieved chunks and total latency drops to 2.6 s, but users still say it "feels slow to start". What is most likely happening?',
          options: [
            'Decode is the bottleneck and needs a larger batch size.',
            'TTFT is still dominated by prefill over a large system prompt and tool schema.',
            'The vector index needs a higher `efSearch`.',
            'The network round trip to the provider is the bottleneck.'
          ],
          answer: 1,
          why: 'Prefill time scales with total input tokens, and retrieved chunks are only part of that. A long system prompt, a big tool schema and conversation history all sit in front of every request. Measure TTFT separately, break input tokens down by section, then put the stable parts first so prefix caching can skip them.'
        },
        {
          q: 'You set `temperature: 0` and a fixed `seed`, then write a CI test asserting the model returns exactly `{"intent":"refund"}`. Why is this a bad test?',
          options: [
            'Because `seed` is ignored when temperature is 0.',
            'Because hosted inference is not bit-reproducible — non-associative GPU reductions and varying batch composition mean identical inputs can yield different text.',
            'Because JSON key order is randomised by the API.',
            'Because temperature 0 disables structured output.'
          ],
          answer: 1,
          why: 'Greedy decoding is deterministic on paper, but hosted serving is not: floating-point reductions depend on how work is partitioned, and that depends on who else is in your batch. Providers also update builds behind stable aliases. Assert on parsed structure and invariants, and gate regressions on eval scores over a golden set.'
        },
        {
          q: 'A support agent conversation costs $0.004 at turn 1 and $0.031 at turn 15, with no change in message size. Why?',
          options: [
            'The provider applies progressive rate-limit surcharges.',
            'Every turn re-sends the whole conversation, so input tokens grow with turn count and cost grows roughly quadratically over the session.',
            'Decode gets slower as the KV cache grows, and you are billed by time.',
            'Tool schemas are re-tokenised at a higher rate after repeated use.'
          ],
          answer: 1,
          why: 'The API is stateless: each turn ships the full history as input. Cost per session is therefore roughly quadratic in turns. The two levers are compaction — summarise old turns instead of replaying them — and prefix caching, which needs a byte-stable prefix, so put the system prompt and tool definitions first and never interpolate a timestamp into them.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `The prefill/decode split is the foundation for **Inference Serving & Performance**
(KV cache, continuous batching) and for the caching strategy in **Model Routing, Caching & Cost
Control**. Tokenisation and the context budget drive **Context Engineering**. Hallucination as
an intrinsic property is the premise of **RAG: The Reference Architecture** and
**Evaluation & Quality Regression**. And the fact that any text in the window is
instruction-adjacent is where **AI Security & Guardrails** begins.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why is TTFT a different metric from inter-token latency?', a: 'They come from different phases with opposite bottlenecks. TTFT is prefill: compute-bound, scales with input length, fixed by prompt size and prefix caching. Inter-token latency is decode: memory-bandwidth-bound, scales with model size, barely affected by prompt length.' },
    { q: 'Why does batching help decode much more than prefill?', a: 'Decode reads the entire model weights from HBM to produce one token, so it is bandwidth-starved and nearly idle on compute — batching amortises that weight read across many sequences. Prefill already saturates the GPU\'s arithmetic units, so there is little spare capacity to fill.' },
    { q: 'Is `temperature: 0` deterministic?', a: 'No, not in hosted serving. GPU floating-point reductions are non-associative, batch composition changes how work is partitioned, MoE routing can be batch-sensitive, and providers update builds behind stable aliases. Reproducible intent, not reproducible bytes.' },
    { q: 'Why do LLMs fail at counting letters and multi-digit arithmetic?', a: 'BPE tokens do not align with characters or digits. `1234567` may be three tokens that cut across place value, and the model never sees individual letters as units. Route these to a tool rather than prompting harder.' },
    { q: 'What does quadratic attention actually cost you in production?', a: 'Attention compute grows as O(n²) in sequence length while the KV cache grows linearly. FlashAttention lowers the constant but not the asymptotics. In practice the KV cache is what caps concurrency per GPU, and prefill time is what caps your TTFT.' },
    { q: 'Why is hallucination not fixable by prompting?', a: 'The training objective rewards plausible continuations, not true ones, and there is no separate truth signal to consult. You manage it structurally: ground in retrieved text, constrain with schemas, verify claims against systems of record, and reward an explicit refusal path.' },
    { q: 'Why is the same feature more expensive in Hindi or Japanese?', a: 'BPE merges are learned mostly from English-heavy corpora, so non-Latin scripts fragment into more tokens — often 2-4x for the same meaning. Both cost and effective context length are affected, with no code change involved.' },
    { q: 'What belongs in the prompt prefix and why?', a: 'Everything byte-stable: system prompt, tool definitions, long-lived policy text — ordered first. Providers cache processed prefixes at a large discount and skip re-prefilling them, which cuts both TTFT and input cost. A single interpolated timestamp at the top destroys the hit.' }
  ],

  drills: [
    {
      prompt: 'You own a customer-support assistant. p95 total latency is 6 s and finance says cost per resolved ticket is 3x the forecast. The prompt is a 2,400-token system prompt with tool schemas, 10 retrieved chunks of ~600 tokens each, and up to 20 turns of history. Diagnose and propose fixes, in priority order.',
      probes: [
        'Which of TTFT and inter-token latency is actually bad, and how do you know?',
        'Where exactly does the 3x cost come from — input, output, or turn growth?',
        'What would you change first if you could only change one thing?',
        'How do you keep quality from regressing while you cut tokens?'
      ],
      strong: [
        'Splits the latency question immediately: instruments TTFT vs inter-token latency and breaks input tokens down by section (system, tools, retrieval, history).',
        'Identifies ~8k input tokens per turn re-sent every turn as the dominant cost driver, and notes cost grows roughly quadratically over a session.',
        'Proposes prefix caching with a byte-stable system+tools prefix ordered first, and calls out that any interpolated timestamp breaks the cache.',
        'Cuts retrieved chunks from 10 to 4-5 backed by a reranker, and justifies it with a retrieval recall@k measurement rather than a guess.',
        'Adds history compaction with a token threshold, and caps output tokens given output is several times the input price.',
        'Guards the change with an eval suite over a golden set, since exact-output assertions are impossible.'
      ],
      weak: [
        'Proposes "use a smaller model" with no measurement of which phase is slow.',
        'Talks about one "latency" number and never separates TTFT from decode.',
        'Suggests reducing cost by lowering temperature, which has no cost effect.',
        'Ignores that history re-sending is the growth term and only tunes the retrieval step.',
        'Plans to verify improvements by "checking a few examples manually".'
      ]
    },
    {
      prompt: 'A product manager asks you to guarantee the assistant "never makes things up" before launch, and suggests adding "Do not hallucinate. Only state facts." to the system prompt. Respond as the engineering owner.',
      probes: [
        'Why does that instruction not work?',
        'What can you actually promise, and how would you measure it?',
        'What does the UI need to do differently?'
      ],
      strong: [
        'Explains hallucination as intrinsic to maximising plausibility, not a defect to patch — there is no truth channel for the instruction to activate.',
        'Reframes the promise as a measurable one: grounded-answer rate, citation-resolves rate, and refusal accuracy on a deliberately unanswerable eval set.',
        'Names concrete structural controls: retrieval grounding, JSON schema or constrained decoding, post-hoc verification of IDs and citations against the system of record.',
        'Insists on a rewarded refusal path and evaluates it, noting models default to answering because abstention is never scored.',
        'Pulls UX into scope: citations, editable output, undo — so a wrong answer costs a click.'
      ],
      weak: [
        'Agrees to add the instruction and considers it handled.',
        'Promises a percentage accuracy number with no eval set behind it.',
        'Treats RAG as a complete fix with no verification or refusal handling.',
        'Has no answer for how the claim would be measured before and after launch.'
      ]
    }
  ]
};
