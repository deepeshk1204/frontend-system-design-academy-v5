export default {
  blocks: [
    {
      t: 'prose',
      md: `Serving a language model means running a fixed set of weights against a stream of
requests that arrive at unpredictable times, have wildly different input lengths, and produce
output one token at a time. Your job is to turn that into a service with a latency SLO and a
cost per million tokens you can defend.

Almost everything surprising about it follows from one fact: **generating a response is two
completely different workloads wearing one API.** Reading the prompt is a big parallel matrix
multiplication that saturates the GPU's compute. Writing the answer is a sequential loop that
mostly sits waiting on memory bandwidth. Optimising one usually hurts the other, and every knob
in vLLM or TensorRT-LLM is somewhere on that trade.`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `The naive way to serve a model is one request at a time: load the weights, run the
prompt through, generate until done, return. It works, and it wastes most of the hardware.

During decode, each forward pass reads the entire weight matrix out of GPU memory to produce a
*single* token for a *single* request. On a large model that is tens of gigabytes of memory
traffic per token. The arithmetic involved is trivial by comparison, so the GPU's compute units
are idle waiting on HBM -- utilisation in the low single-digit percent is normal for unbatched
decode.

The fix is to make those weight reads do more work. If eight requests are decoding
simultaneously, one pass over the weights produces eight tokens instead of one, at almost the
same memory cost. Batching is therefore not a nice optimisation; it is the difference between a
viable service and a very expensive one. Throughput on batched decode can be an order of
magnitude higher than serial decode on the same hardware.

Everything else -- the KV cache, paged attention, continuous batching, chunked prefill -- exists
to make batching work with real traffic, where requests arrive at random times and have wildly
different lengths.`
    },

    { t: 'h', text: 'Prefill and decode' },
    {
      t: 'table',
      title: 'The asymmetry that drives every design decision',
      cols: ['', 'Prefill (reading the prompt)', 'Decode (writing the answer)'],
      rows: [
        ['What happens', 'All input tokens processed in parallel, one pass', 'One token per pass, each conditioned on the last'],
        ['Bottleneck', 'Compute -- the tensor cores', 'Memory bandwidth -- reading weights and KV from HBM'],
        ['Parallelism', 'High; a 2,000-token prompt is 2,000 positions at once', 'None within a request; only across requests'],
        ['Cost driver', 'Roughly quadratic in prompt length for attention', 'Linear in output length, per request'],
        ['User-visible metric', '**TTFT** -- time to first token', '**ITL** -- inter-token latency, hence tokens/sec'],
        ['Batching effect', 'Already efficient; batching adds queueing delay', 'Transformative -- one weight read serves the whole batch'],
        ['Scales with', 'Input tokens and how many arrive together', 'Concurrent sequences and their KV footprint']
      ]
    },
    {
      t: 'prose',
      md: `Read the last two rows together, because that is the whole tension. Decode wants the
largest possible batch, so weight reads are amortised across many sequences. Prefill is already
compute-saturated, so adding more of it to a batch does not help throughput but does delay
everything else in that batch.

Worse, the two interfere. If a long prefill lands in the middle of a batch that is happily
decoding, every decoding request stalls for the duration of that prefill. That shows up as an
ITL spike -- text streaming smoothly to a user, then pausing for 300 ms because someone else
pasted a long document. Chunked prefill exists precisely to fix this.`
    },
    {
      t: 'diagram',
      code: `sequenceDiagram
  participant C as Client
  participant S as Scheduler
  participant K as KV cache blocks
  participant G as GPU
  C->>S: Prompt, 2000 tokens
  S->>K: Reserve blocks for prompt
  S->>G: Prefill, compute-bound, one pass
  G->>K: Write K and V for all 2000 positions
  G-->>C: First token, this is TTFT
  loop Each output token
    S->>G: Decode step batched with other requests
    G->>K: Read all prior K and V, append one position
    G-->>C: One token, this interval is ITL
  end
  S->>K: Free blocks on completion`,
      caption: 'One pass for the whole prompt, then one pass per output token. The KV cache is what makes the second part possible.'
    },

    { t: 'h', text: 'The KV cache, with the arithmetic' },
    {
      t: 'prose',
      md: `Attention at position *n* needs the key and value vectors for every position before it.
Without a cache, generating token 500 would recompute keys and values for all 499 previous
tokens, making generation quadratic and hopeless. So you keep them: for every layer, for every
attention head, for every token in the sequence, you store a K vector and a V vector in GPU
memory. That is the KV cache.

The consequence is that **GPU memory, not compute, is usually what limits your concurrency.**
The weights are a fixed cost you pay once. The KV cache grows with every token of every active
request, and when it is full you cannot admit another request no matter how idle the tensor cores
are.

The formula is worth being able to write from memory:`
    },
    {
      t: 'code',
      lang: 'text',
      title: 'KV cache size, and a worked example',
      code: `bytes = 2 (K and V)
      x num_layers
      x num_kv_heads x head_dim     (note: KV heads, not attention heads)
      x bytes_per_element           (2 for FP16/BF16, 1 for FP8)
      x sequence_length

Worked example -- a 70B-class model with grouped-query attention:
  num_layers      = 80
  num_kv_heads    = 8        (GQA: 64 attention heads share 8 KV heads)
  head_dim        = 128
  dtype           = BF16 -> 2 bytes

  per token = 2 x 80 x 8 x 128 x 2 = 327,680 bytes  ~= 0.31 MiB/token

  8k-token conversation      ~=  2.5 GiB
  32k-token conversation     ~= 10.0 GiB
  batch of 32 x 8k tokens    ~=  80 GiB   <-- exceeds one 80 GB GPU on its own

Same model WITHOUT GQA (64 KV heads, as in older multi-head attention):
  per token = 2 x 80 x 64 x 128 x 2 = 2.6 MiB/token
  32k-token conversation     ~= 84 GiB    <-- a single conversation fills the GPU

FP8 KV cache halves all of the above, at some accuracy cost on long contexts.`
    },
    {
      t: 'note',
      tone: 'info',
      title: 'Why grouped-query attention mattered so much',
      md: `Compare the two blocks above: GQA cut the per-token KV footprint by roughly 8x in that
example by letting several attention heads share one set of KV heads. That is not a marginal
memory saving -- it is the difference between serving one long conversation per GPU and serving
thirty. Multi-query and grouped-query attention were adopted across the industry primarily as
*serving* optimisations, and they are the main reason long-context models became economically
practical at all.`
    },
    {
      t: 'numbers',
      title: 'GPU memory budget on an 80 GB accelerator, 70B-class model',
      items: [
        { v: '~140 GB', k: 'Weights at BF16', note: 'Does not fit; needs 2+ GPUs or quantisation' },
        { v: '~70 GB', k: 'Weights at FP8', note: 'Fits on one 80 GB card with little room left' },
        { v: '~35 GB', k: 'Weights at INT4/W4', note: 'Leaves ~40 GB for KV and activations' },
        { v: '2-5 GB', k: 'Activations and workspace', note: 'Scales with batch and chunk size' },
        { v: '~0.31 MiB', k: 'KV per token, GQA example above', note: 'Multiply by every token of every live request' },
        { v: '~128 concurrent', k: '8k-token requests in ~40 GB of KV', note: 'Your real concurrency ceiling' }
      ]
    },
    {
      t: 'prose',
      md: `Note what that last figure means in practice. Your concurrency limit is a *memory*
calculation, and it moves with average context length. Ship a feature that doubles the amount of
retrieved context you stuff into each prompt and you have halved your concurrency -- the serving
tier gets slower and more expensive with no change to request volume and no change to your code.
That connects directly to retrieval-k as a cost knob in **Model Routing, Caching & Cost
Control**.`
    },

    { t: 'h', text: 'PagedAttention, and why fragmentation mattered' },
    {
      t: 'prose',
      md: `Early serving stacks allocated KV cache as one contiguous block per request, sized for
the *maximum* possible output length, because you cannot know in advance how long the answer will
be. A request that might generate 2,000 tokens reserved space for 2,000 tokens and then produced
40. The rest was reserved, unusable by anyone, and invisible in your metrics. Published analyses
of that era put effective KV utilisation in the low tens of percent -- most of your most
expensive resource was being wasted on reservations.

vLLM's PagedAttention borrowed the fix from operating-system virtual memory. Split the KV cache
into fixed-size blocks -- typically 16 tokens each. Give each sequence a block table mapping
logical positions to physical blocks. Allocate a new block only when the current one fills.
Attention kernels are rewritten to gather K and V through the block table instead of assuming
contiguity.

Three things fall out, and the second and third are arguably more valuable than the first.
Internal waste drops to at most one partly-filled block per sequence -- a few percent instead of
most of the cache. **Sharing becomes possible**: two requests with the same prefix can point at
the same physical blocks, which is the mechanism underneath prompt caching. And copy-on-write
makes parallel sampling from one prompt nearly free, since the shared prefix is stored once.

Freeing the memory is what raises concurrency, and concurrency is what gives you batch size, and
batch size is what gives you throughput. That is why this one idea reshaped LLM serving.`
    },

    { t: 'h', text: 'Continuous batching' },
    {
      t: 'prose',
      md: `Static batching is the intuitive design and it is badly wrong for this workload:
collect N requests, run them together, return all N. Because sequences finish at different
times, the whole batch runs until the *longest* one completes, and every finished slot sits idle
until then. With realistic length variance -- some answers 20 tokens, some 2,000 -- you lose most
of the available throughput.

Continuous batching (also called in-flight batching) makes the batch a mutable set evaluated at
every decode iteration. A sequence that emits its stop token is evicted immediately and its KV
blocks are freed; a queued request is admitted into the freed slot on the very next step. The
GPU never waits for a straggler.

The throughput gain over static batching is large -- multiple-fold in published vLLM and
TensorRT-LLM benchmarks, with the exact factor depending heavily on how variable your output
lengths are. High variance means a bigger win. It is the single most important scheduling
decision in the stack, and it is why you use a real serving engine rather than a loop around
\`model.generate()\`.`
    },
    {
      t: 'diagram',
      code: `flowchart TB
  Q["Request queue"] --> S["Iteration-level scheduler"]
  S -->|"admit if KV blocks free"| B["Running batch"]
  B --> F["Forward pass: one decode step for all"]
  F --> E{"Sequence finished?"}
  E -->|yes| FR["Evict, free KV blocks"]
  E -->|no| B
  FR --> S
  S -->|"KV exhausted"| P["Preempt or queue"]
  P --> Q
  S -->|"token budget left"| CP["Schedule prefill chunk"]
  CP --> F`,
      caption: 'The scheduler re-decides every iteration. Decode is prioritised; prefill fills the leftover token budget.'
    },

    { t: 'h', text: 'Prefix caching, chunked prefill, speculative decoding, disaggregation' },
    {
      t: 'prose',
      md: `Four optimisations that stack, each attacking a different part of the problem.

**Prefix caching** reuses KV blocks across requests that share a leading prefix. Your system
prompt, few-shot examples and tool schemas are identical on every call, and a multi-turn
conversation re-sends the whole history each turn. With paged blocks and a hash of the block
contents, those KV entries can be computed once and reused, eliminating the prefill work for the
shared portion. This is the highest-leverage optimisation available for a typical chat or agent
workload, because prompt overlap is usually enormous. The catch is that it is prefix-exact:
change one token near the start and every subsequent block misses. Put stable content first,
volatile content last.

**Chunked prefill** splits a long prompt into pieces sized to a token budget and interleaves
them with ongoing decode steps, so a 30k-token prompt no longer stalls everyone else's stream.
In vLLM V1 this is on by default, and \`max_num_batched_tokens\` is the dial: smaller values
(around 2,048) give better ITL because fewer prefills slow down decodes, larger values give
better TTFT and throughput, and the docs suggest going above 8,192 when chasing raw throughput
on smaller models with large GPUs. That single parameter is the clearest example of the
latency-throughput frontier being a real choice you have to make.

**Speculative decoding** attacks the sequential nature of decode. A cheap draft model -- or a
lightweight method like n-gram lookup or a Medusa-style head -- proposes k tokens, and the target
model verifies them all in one forward pass. Because verification is parallel and decode is
memory-bound, you get several tokens for roughly the cost of one *when the draft is accepted*.
Output is mathematically identical to normal sampling, so there is no quality cost. The catch:
acceptance rate governs everything, and on a *busy* server speculation can reduce total
throughput, because you are spending compute on verification that the GPU could have spent on
other requests' real tokens. It is a latency optimisation for low-to-moderate load, not a
throughput optimisation under saturation.

**Disaggregated prefill/decode** runs prefill and decode on separate instances and transfers the
KV cache between them over a connector. This lets you tune TTFT and ITL independently -- different
parallelism strategies, different hardware, separate scaling -- and reliably eliminates
prefill-induced ITL spikes rather than merely reducing them as chunking does. vLLM still labels
it experimental and it adds a KV transfer on the critical path, so it earns its keep at scale
and with strict tail-latency requirements, not on your first deployment.`
    },
    {
      t: 'table',
      title: 'What each knob does to TTFT, ITL and throughput',
      cols: ['Knob', 'TTFT', 'ITL', 'Throughput', 'Notes'],
      rows: [
        ['Larger max batch size', 'Worse (queueing)', 'Slightly worse', '**Much better**', 'The core throughput lever; bounded by KV memory'],
        ['`max_num_batched_tokens` up', '**Better**', 'Worse', 'Better', 'Prefill gets more budget per step and interrupts decode more'],
        ['`max_num_batched_tokens` down', 'Worse', '**Better**', 'Slightly worse', 'Smoother streaming; the right call for chat UX'],
        ['Prefix caching on', '**Much better** on hits', 'Neutral', '**Better**', 'Nearly free win; requires stable prompt prefixes'],
        ['Speculative decoding', 'Neutral', '**Better** at low load', 'Worse under saturation', 'Depends entirely on draft acceptance rate'],
        ['Weight quantisation (W4/W8)', 'Better', 'Better', '**Better**', 'Frees memory for KV, so raises concurrency too'],
        ['FP8 KV cache', 'Neutral', 'Neutral', '**Better**', 'Halves KV footprint; some long-context accuracy risk'],
        ['Tensor parallelism (more GPUs)', '**Better**', 'Better', 'Better per replica', 'Adds all-reduce per layer; needs fast interconnect'],
        ['Pipeline parallelism', 'Worse', 'Worse', 'Better (memory fit)', 'Use to fit a model, not to go faster'],
        ['Disaggregated prefill/decode', 'Tunable', '**Much better tail**', 'Neutral to better', 'Experimental; adds KV transfer hop']
      ]
    },
    {
      t: 'code',
      lang: 'bash',
      title: 'Two vLLM configurations for the same model, tuned for opposite goals',
      code: `# Interactive chat: protect TTFT and smooth streaming.
# Smaller prefill budget means long prompts interrupt decode less.
vllm serve meta-llama/Llama-3.3-70B-Instruct \\
  --tensor-parallel-size 4 \\
  --max-num-batched-tokens 2048 \\
  --max-num-seqs 64 \\
  --enable-prefix-caching \\
  --gpu-memory-utilization 0.90 \\
  --max-model-len 16384

# Batch document processing: maximise tokens per dollar, latency is irrelevant.
vllm serve meta-llama/Llama-3.3-70B-Instruct \\
  --tensor-parallel-size 4 \\
  --max-num-batched-tokens 16384 \\
  --max-num-seqs 512 \\
  --enable-prefix-caching \\
  --kv-cache-dtype fp8 \\
  --gpu-memory-utilization 0.95 \\
  --max-model-len 8192

# Note --max-model-len: it caps per-request KV, which sets your concurrency
# ceiling. Advertising 128k context when your traffic is 4k silently reserves
# capacity you never use and cuts the batch size you could have run.`
    },

    { t: 'h', text: 'Quantisation' },
    {
      t: 'prose',
      md: `Quantisation stores numbers in fewer bits. It buys three things at once -- less memory
for weights, less memory traffic per forward pass, and on modern accelerators faster arithmetic
in the narrow format -- which is why it improves both latency and throughput rather than trading
one for the other.

The distinction that matters is **what** you quantise. *Weight-only* quantisation (W8A16, W4A16)
compresses the stored weights and dequantises on the fly to compute in higher precision. Since
decode is memory-bandwidth-bound, shrinking the weights directly shrinks the bottleneck, and
quality impact is usually small. *Weight-and-activation* quantisation (W8A8 with FP8, W4A8) also
narrows the activations, so the actual matrix multiplies run in the low-precision tensor cores --
bigger speedup, more accuracy risk, and it needs calibration data.

FP8 has become the comfortable default on hardware that supports it natively: quality
degradation is typically small enough to be hard to detect on real tasks, and it halves the
weight footprint. INT4 weight-only methods like AWQ and GPTQ go further and are genuinely useful
when memory is the binding constraint, but the degradation is real and task-dependent -- it tends
to show up on long-context reasoning and precise formatting rather than on short conversational
turns, which is exactly why a quick eyeball test passes and your production workload regresses.

Which leads to the rule: **quantisation is an eval question, not a benchmark question.** Run your
own suite from **Evaluation & Quality Regression** on the quantised model, per slice. Published
perplexity deltas will not tell you whether your JSON conformance rate dropped from 99% to 94%,
and that is the number your product cares about.`
    },

    { t: 'h', text: 'Parallelism and capacity planning' },
    {
      t: 'prose',
      md: `When a model does not fit on one GPU you split it, and the two ways to split are not
interchangeable.

**Tensor parallelism** shards each layer's weight matrices across GPUs; every GPU works on every
token and they exchange partial results with an all-reduce at each layer. It reduces both memory
per GPU *and* latency, since the work per GPU is smaller -- but it requires high-bandwidth
interconnect, because you pay a collective communication per layer. Within one node over NVLink
this is the right tool. Across nodes over Ethernet it usually is not.

**Pipeline parallelism** assigns whole layers to different GPUs and passes activations along the
chain. Communication is small -- one activation tensor per boundary -- so it tolerates slower
links and is how you span nodes. But the chain adds latency and introduces bubbles where stages
idle. Use pipeline parallelism to make a model *fit*, not to make it fast.

The usual configuration: tensor parallelism up to the number of GPUs in a node, pipeline
parallelism beyond that, and replicas for throughput once a single model instance fits.

For capacity planning, the sequence is mechanical. Compute the memory budget: weights, plus
activations and workspace, plus whatever is left for KV. Divide the KV remainder by your *p95*
context length -- not the mean, because the long requests are what cause eviction -- to get a
concurrency ceiling. Measure sustained output tokens per second per replica at that concurrency
with a realistic length mix. Divide your target token throughput by that figure and add headroom.

Then autoscale on the signal that actually predicts pain: **queue depth and time-in-queue**, not
GPU utilisation. GPU utilisation reads high during healthy batched decode and tells you nothing
about whether requests are waiting. Queue wait time is the leading indicator of the TTFT
violation your users will feel. Watch KV cache utilisation and preemption rate too -- rising
preemption means you are thrashing, recomputing KV for requests you evicted, and throughput is
about to fall off a cliff.

Budget for **cold start**. Pulling tens of gigabytes of weights, loading them to HBM and warming
CUDA graphs is minutes, not seconds -- so scale-from-zero is not a real strategy for interactive
traffic. Mitigations: keep a warm floor of replicas, cache weights on local NVMe rather than
pulling from object storage each time, bake them into the image or a pre-attached volume, and
pre-warm a new replica before routing traffic to it.`
    },

    { t: 'h', text: 'Self-host versus API' },
    {
      t: 'prose',
      md: `The economics are not close at low volume, and they invert at high volume. An API
charges per token with zero idle cost. A GPU charges per hour whether or not you use it, so your
effective cost per token is entirely determined by utilisation -- a reserved accelerator running
at 10% utilisation is a very expensive way to buy tokens.

The break-even point is a function of sustained throughput, not peak. Spiky traffic with a low
average is the worst case for self-hosting and the best case for an API. Steady high-volume
traffic is where self-hosting wins, and then usually decisively, because you are buying the
hardware rather than the margin on top of it.

But volume is only one of the reasons people self-host, and often not the main one. Data
residency or a contractual ban on third-party processing can make it mandatory regardless of
cost. Custom or fine-tuned weights may not be servable anywhere else. Predictable tail latency
without another company's rate limits and noisy neighbours is worth real money to some products.
And avoiding a silent model swap behind an alias matters when you have certified behaviour.

Against that, honestly: you now own GPU capacity planning, kernel and driver upgrades,
quantisation quality regressions, on-call for a memory-bound service with a cliff-edge failure
mode, and the opportunity cost of not getting the next frontier model for free. A mixed strategy
is common and sensible -- self-host the high-volume, well-understood, latency-sensitive workload;
use an API for the low-volume hard cases and for the frontier capability you cannot reproduce.`
    },

    {
      t: 'tradeoffs',
      title: 'Running your own inference tier',
      gains: [
        'Cost per token can fall well below API pricing at sustained high utilisation.',
        'Full control of tail latency -- no third-party rate limits or noisy neighbours.',
        'Serve custom, fine-tuned or multi-LoRA weights that no API offers.',
        'Data never leaves your boundary, which some contracts require outright.',
        'Model version is pinned by you; no silent snapshot changes behind an alias.'
      ],
      costs: [
        'Idle GPU time is pure loss; low utilisation makes it more expensive than an API.',
        'Cold start is minutes, so scale-from-zero is off the table for interactive traffic.',
        'You own quantisation quality regressions, driver upgrades and kernel bugs.',
        'Memory-bound failure is a cliff, not a gradient -- KV exhaustion causes preemption thrash.',
        'Capacity is bounded by accelerator supply and long-lead commitments.',
        'You do not get the next frontier model for free the week it ships.'
      ]
    },
    {
      t: 'failures',
      title: 'How inference tiers fall over',
      items: [
        { mode: 'KV cache exhaustion under load', blast: 'Requests preempted and their KV recomputed; throughput collapses non-linearly while GPU utilisation still reads high.', fix: 'Admission control on free KV blocks, cap `max-model-len` to real traffic, alert on preemption rate and KV utilisation, autoscale on queue depth.' },
        { mode: 'Long prefill stalling the decode batch', blast: 'Every streaming user sees a multi-hundred-millisecond pause when one user pastes a long document.', fix: 'Chunked prefill with a tuned `max_num_batched_tokens`; disaggregated prefill/decode if tail ITL is contractual.' },
        { mode: 'Prompt prefix reordered by a "harmless" change', blast: 'Prefix cache hit rate falls to near zero; TTFT and cost both jump with no code change visible in review.', fix: 'Treat prompt prefix order as an interface: stable content first, volatile last; alert on cache hit rate as a first-class metric.' },
        { mode: 'Quantised model regresses on a narrow slice', blast: 'JSON conformance or long-context accuracy drops; aggregate benchmarks look fine; downstream parsers break.', fix: 'Run your own eval suite per slice on the exact quantised artefact, and gate the rollout on schema conformance specifically.' },
        { mode: 'Autoscaling on GPU utilisation', blast: 'Scale-up never triggers because batched decode always looks busy; queue grows and TTFT violates SLO.', fix: 'Scale on queue depth and time-in-queue; use KV utilisation and preemption rate as secondary signals.' },
        { mode: 'Cold start on scale-out', blast: 'New replica takes minutes to load weights; the spike is over before capacity arrives.', fix: 'Warm replica floor, weights on local NVMe or baked into the image, pre-warm before routing, plus an API overflow path.' },
        { mode: 'Speculative decoding enabled globally', blast: 'Latency improves in staging, total throughput drops under production saturation.', fix: 'Enable adaptively by load; monitor draft acceptance rate; disable above a concurrency threshold.' },
        { mode: 'Advertising max context you do not need', blast: 'Per-request KV reservation caps batch size; concurrency and throughput silently far below hardware capability.', fix: 'Set `max-model-len` from measured p99 context length; offer long context on a separate, differently-tuned pool.' }
      ]
    },

    {
      t: 'staff',
      md: `The tell in an inference interview is whether you reason in *memory* or in vague
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
- "Chunked prefill with \`max_num_batched_tokens\` around 2,048 for interactive chat -- smaller
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
it.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'Your chat service streams smoothly most of the time, but users report occasional multi-hundred-millisecond pauses mid-response. GPU utilisation is high and steady. What is the most likely cause?',
          options: [
            'Network jitter between the client and the load balancer.',
            'A long prefill from another request is occupying the batch, stalling every decoding sequence.',
            'The KV cache is full and requests are being preempted.',
            'The model is too large for the GPU.'
          ],
          answer: 1,
          why: 'Prefill is compute-bound and, unless chunked, occupies the forward pass for its whole duration -- so one user pasting a 30k-token document pauses everyone else\u2019s stream. That is the classic ITL spike. The fix is chunked prefill with a smaller `max_num_batched_tokens`, which slices the prefill and interleaves it with decode steps, or disaggregated prefill/decode if tail ITL is contractual. KV preemption is a real failure mode but presents as throughput collapse and rising preemption counters rather than isolated mid-stream pauses.'
        },
        {
          q: 'You are serving a 70B-class model with GQA (80 layers, 8 KV heads, head dim 128) in BF16 on 4x80 GB GPUs. Average context is 8k tokens. What most directly determines your maximum concurrency?',
          options: [
            'The number of tensor cores available for matrix multiplication.',
            'GPU memory left after the weights, divided by roughly 0.31 MiB per token times context length.',
            'The provider rate limit.',
            'Network bandwidth to the clients.'
          ],
          answer: 1,
          why: 'KV per token is 2 x 80 x 8 x 128 x 2 bytes, about 0.31 MiB, so an 8k-token request needs roughly 2.5 GiB of KV. Concurrency is whatever memory remains after weights and activations divided by that figure -- compute is almost never the binding constraint in decode, because decode is memory-bandwidth-bound. This is why FP8 KV cache, GQA and a realistic `max-model-len` all raise throughput: they are concurrency levers disguised as memory settings.'
        },
        {
          q: 'Why is autoscaling an inference tier on GPU utilisation a mistake?',
          options: [
            'GPU utilisation is expensive to measure.',
            'Batched decode keeps utilisation high whether or not requests are queueing, so it does not signal user-visible pain.',
            'GPU utilisation is always 100% on modern accelerators.',
            'Utilisation only reflects prefill, never decode.'
          ],
          answer: 1,
          why: 'The scheduler keeps the GPU busy by design -- that is what continuous batching does -- so utilisation stays high while queue wait time grows and TTFT breaches the SLO. Scale on queue depth and time-in-queue, which lead the user-visible symptom, with KV cache utilisation and preemption rate as secondary signals. Rising preemption in particular means you are recomputing KV for evicted requests and throughput is about to fall non-linearly.'
        },
        {
          q: 'A colleague proposes enabling speculative decoding globally to reduce latency. What is the correct caveat?',
          options: [
            'It changes the output distribution, so quality may drop.',
            'It helps latency at low-to-moderate load but can reduce total throughput under saturation, since verification compute competes with other requests\u2019 tokens.',
            'It requires FP8 hardware support.',
            'It only works with a fine-tuned draft model.'
          ],
          answer: 1,
          why: 'Verification is mathematically equivalent to normal sampling, so there is no quality cost -- that is the appeal. The cost is compute: on an idle-ish server the spare capacity is free and you get several tokens for roughly one token\u2019s memory traffic, but on a saturated server that compute would otherwise have produced real tokens for other requests. Gate it on concurrency and monitor draft acceptance rate, because a low acceptance rate means you are paying for verification and discarding the drafts.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `Prefix caching here is the same mechanism exploited commercially in **Model Routing,
Caching & Cost Control**, and context length as a concurrency lever links to **Context
Engineering**. Serving many adapters on one base model is developed in **Fine-Tuning, LoRA &
Distillation**. TTFT and ITL as product metrics are **AI Product & UX Architecture**, the
per-span latency and token telemetry comes from **AI Observability & Tracing**, and gating a
quantised or upgraded artefact is **Evaluation & Quality Regression**.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why are prefill and decode fundamentally different workloads?', a: 'Prefill processes all input tokens in one parallel pass and is compute-bound. Decode produces one token per pass, sequentially, and is memory-bandwidth-bound because each pass reads the whole weight matrix. Prefill governs TTFT, decode governs inter-token latency.' },
    { q: 'Write the KV cache size formula.', a: '2 (K and V) x layers x kv_heads x head_dim x bytes_per_element x sequence_length. For 80 layers, 8 KV heads, head dim 128, BF16: about 0.31 MiB per token, so an 8k-token request is roughly 2.5 GiB.' },
    { q: 'What did PagedAttention actually fix, and what was the bigger win?', a: 'It replaced contiguous per-request KV allocation sized for max output -- which wasted most of the cache on reservations -- with fixed 16-token blocks and a block table. The bigger win is that blocks became *shareable*, which is the mechanism underneath prefix caching and cheap parallel sampling.' },
    { q: 'Why does continuous batching beat static batching?', a: 'Static batching runs until the longest sequence finishes, leaving completed slots idle. Continuous batching evicts finished sequences and admits queued ones every iteration, so the GPU never waits for a straggler. The win grows with output-length variance.' },
    { q: 'What does `max_num_batched_tokens` trade off?', a: 'It is the prefill token budget per scheduler step. Smaller (around 2,048) gives better ITL because prefills interrupt decode less; larger (8,192+) gives better TTFT and throughput. It is the clearest single expression of the latency-throughput frontier.' },
    { q: 'When does speculative decoding hurt?', a: 'Under saturation. Verification compute competes with other requests\u2019 real tokens, so total throughput can fall even as single-request latency improves. It is a latency optimisation for low-to-moderate load, and its value scales with draft acceptance rate.' },
    { q: 'Weight-only versus weight-and-activation quantisation?', a: 'Weight-only (W4A16, W8A16) shrinks stored weights and dequantises to compute in higher precision -- directly attacks the decode bottleneck with modest quality risk. Weight-and-activation (FP8 W8A8, W4A8) also narrows activations so the matmuls run in low precision: faster, riskier, needs calibration.' },
    { q: 'Tensor versus pipeline parallelism?', a: 'Tensor parallelism shards each layer across GPUs, cutting memory *and* latency but paying an all-reduce per layer -- needs NVLink-class interconnect, use within a node. Pipeline parallelism assigns whole layers to GPUs with small communication but adds latency and bubbles -- use it to make a model fit across nodes, not to go faster.' },
    { q: 'What should you autoscale an inference tier on?', a: 'Queue depth and time-in-queue, with KV cache utilisation and preemption rate as secondary signals. Never GPU utilisation -- batched decode reads as busy whether or not anyone is waiting, so it never triggers scale-up while TTFT breaches.' }
  ],

  drills: [
    {
      prompt: 'You must serve a 70B-class open-weights model for an internal coding assistant. Traffic is 2,000 daily active engineers, bursty between 09:00 and 18:00 in two time zones, near-zero overnight. Prompts average 6k tokens (repository context) and responses average 400 tokens. Streaming, and engineers notice pauses. Design the serving tier and justify the economics.',
      probes: [
        'Work out the KV memory per request and your concurrency ceiling.',
        'Which do you optimise for here, TTFT or throughput, and what configuration follows?',
        'Overnight traffic is near zero -- what do you do with the GPUs?',
        'The 09:00 burst is 5x the mean. How does capacity arrive in time?',
        'Would you self-host at all at this volume? Show your reasoning.'
      ],
      strong: [
        'Does the KV arithmetic explicitly and derives a concurrency ceiling from memory left after weights, using p95 rather than mean context length.',
        'Identifies large stable repository context as an ideal prefix-caching case and puts stable content first in the prompt, treating prefix order as an interface.',
        'Chooses a TTFT- and ITL-friendly configuration: chunked prefill with a smaller `max_num_batched_tokens`, tensor parallelism within a node, `max-model-len` set from measured p99 rather than the model maximum.',
        'Recognises that near-zero overnight traffic plus a 5x morning burst is a poor utilisation profile, and quantifies that cost per token is set by utilisation, not by GPU price.',
        'Proposes a hybrid: warm floor of self-hosted replicas sized to steady daytime load, API overflow for bursts, because cold start is minutes.',
        'Autoscales on queue depth and time-in-queue with pre-warming, and names KV utilisation and preemption rate as secondary signals.',
        'Mentions FP8 or INT4 weight quantisation to free memory for KV and gates it on their own eval suite, specifically schema conformance.'
      ],
      weak: [
        'Picks a GPU count with no memory arithmetic.',
        'Autoscales on GPU utilisation, or proposes scale-to-zero overnight with no mention of cold start.',
        'Ignores prefix caching despite 6k tokens of largely repeated repository context.',
        'Optimises for throughput on an interactive streaming product without noticing the conflict.',
        'Assumes quantisation is free, or dismisses it without an eval plan.',
        'Compares self-host against API on GPU list price alone, with no utilisation assumption.'
      ]
    },
    {
      prompt: 'Your self-hosted inference tier has been stable for months. After a release, p95 TTFT went from 900 ms to 4.2 s and throughput fell about 35%. GPU utilisation is unchanged and high. No infrastructure change was deployed -- only application code. Diagnose it.',
      probes: [
        'What application change could do this without touching the serving tier?',
        'Which serving metrics distinguish the candidate causes?',
        'What is your immediate mitigation versus your real fix?',
        'What should have alerted you before users did?'
      ],
      strong: [
        'Leads with prefix cache hit rate: a reordered prompt -- moving a timestamp, user ID or retrieved context ahead of the stable system prompt -- invalidates every downstream block and re-introduces full prefill.',
        'Second hypothesis: retrieved context per request grew (higher k or larger chunks), increasing both prefill work and KV per request, which reduces concurrency and hence throughput.',
        'Names the distinguishing metrics: cache hit rate, mean and p95 input tokens per request, KV utilisation, preemption rate, queue wait time.',
        'Notes that unchanged high GPU utilisation is consistent with both, and is precisely why utilisation is not a useful signal here.',
        'Immediate mitigation: revert the prompt ordering or cap k; add replicas only as a stopgap since it does not address the cause.',
        'Real fix: treat prompt prefix order as a reviewed interface, alert on cache hit rate and p95 input tokens, add a CI check on prompt token budget.'
      ],
      weak: [
        'Blames the model or the GPUs despite no infrastructure change.',
        'Adds capacity as the fix without diagnosing the cause.',
        'Does not consider prompt structure or context length as a serving-tier variable.',
        'Cannot name a metric that separates the hypotheses.',
        'Treats high GPU utilisation as evidence the serving tier is healthy.'
      ]
    }
  ]
};
