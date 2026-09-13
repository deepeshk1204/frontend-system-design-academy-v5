/* AI track — AI Product & UX Architecture. See CONTENT-SCHEMA.md. */

export default {
  blocks: [
    {
      t: 'prose',
      md: `Every interface you have built before had two properties you never thought about: it
responded in milliseconds, and it was correct. AI features have neither. A response takes
seconds, arrives gradually, and is sometimes wrong in a way that is fluent, confident and
indistinguishable from a right answer.

That is not a polish problem to hand to a designer at the end. It is an architecture
constraint, and it changes what you build: where state lives, what you stream, what you commit
versus stage, what you log, and how expensive it is for a user to recover from a bad answer.
The best AI products are not the ones with the best model. They are the ones where being wrong
costs the user one click.`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `Two numbers set the terms. Human perception treats about 100 ms as instant and about
1 second as the limit for uninterrupted flow; past roughly 10 seconds, attention leaves. A
frontier LLM answering a grounded question typically takes several seconds end to end, and a
multi-step agent task can run for minutes.

So you are always over the budget. You cannot engineer your way under it -- not with a faster
model, not with better infrastructure. Every technique in this topic is a way of making time
*feel* shorter or *be useful*, and of ensuring that the answer arriving at the end is one the
user can check rather than one they must trust.`
    },

    { t: 'h', text: 'Design around TTFT, not total latency' },
    {
      t: 'prose',
      md: `Perceived latency is dominated by the silence before anything happens. Once tokens are
flowing the user is reading, and the clock runs slower for them. This makes **time to first
token** the number your UX is built around, and it is almost entirely determined by things you
control: how many input tokens you send, whether your prompt prefix is cached, whether you do a
retrieval round trip first, and whether you run a query-rewriting model before the main call.

The design consequences are concrete. A RAG pipeline that spends 800 ms on retrieval and
reranking before calling the model has an 800 ms floor on TTFT -- so you show the retrieval
progress rather than a blank spinner. A query rewrite adds a full generation round trip, so it
had better earn its place. And an architecture that streams from a cheap fast model while a
slower one works in the background is buying perceived latency with real complexity, which is
sometimes the right trade and sometimes not.`
    },
    {
      t: 'numbers',
      title: 'The perception budget',
      items: [
        { v: '~100 ms', k: 'Feels instantaneous', note: 'Acknowledge the input within this' },
        { v: '~1 s', k: 'Flow of thought preserved', note: 'Target for first token where possible' },
        { v: '~10 s', k: 'Attention limit without progress', note: 'Past this, show real progress or lose them' },
        { v: '5-8 tok/s', k: 'Human reading speed', note: 'Decode faster than this is invisible; spend the gap on quality' }
      ]
    },
    {
      t: 'note',
      tone: 'info',
      title: 'Faster decode stops mattering above reading speed',
      md: `If your model emits 90 tokens per second and a person reads 6, the user is never
waiting on decode after the first few words -- they are waiting on TTFT and then reading. That
is a useful thing to know when someone proposes an expensive optimisation to raise throughput:
above reading speed, extra tokens per second buy nothing perceptible for a streaming chat
interface. Spend the budget on TTFT, on quality, or on a cheaper model instead.`
    },

    { t: 'h', text: 'Streaming, and what to show before the first token' },
    {
      t: 'prose',
      md: `Streaming is the single highest-impact technique available, because it converts one
long wait into a short wait followed by continuous feedback. But streaming only starts at the
first token, and everything before that is your problem.

The interval before generation is not empty -- your system is doing real work, and naming that
work is both more honest and more reassuring than a spinner. "Searching 4 sources" then "Found
6 relevant documents" then "Writing answer" turns dead time into a progress narrative and
sets expectations about what the answer will be based on. It also gives the user an early exit:
if the sources are obviously wrong, they can cancel and rephrase instead of waiting for a
confidently wrong answer built on them.`
    },
    {
      t: 'diagram',
      caption: 'Every phase before the first token is an opportunity to say something true.',
      code: `flowchart LR
  A["User submits<br/>0 ms"] --> B["Echo input,<br/>disable resend<br/>~50 ms"]
  B --> C["Rewrite query<br/>~300 ms"]
  C --> D["Retrieve + rerank<br/>~600 ms"]
  D --> E["Show sources found<br/>~900 ms"]
  E --> F["First token<br/>~1.4 s"]
  F --> G["Stream answer<br/>+ inline citations"]
  G --> H["Done: actions,<br/>edit, copy, feedback"]
  E -.->|cancel available<br/>from here on| X["Cancelled,<br/>no charge for output"]`
    },
    {
      t: 'table',
      title: 'What to render at each phase',
      cols: ['Phase', 'Show', 'Avoid'],
      rows: [
        ['Submit → 100 ms', 'The user\'s message echoed, input cleared, send disabled.', 'Nothing at all — the user cannot tell the click registered.'],
        ['Retrieval', '"Searching your documents" then the source titles as they resolve.', 'An indeterminate spinner that says nothing about what is happening.'],
        ['Generation start', 'First tokens immediately; a cursor or shimmer if the stream stalls briefly.', 'Buffering the whole response to render "nicely" — you throw away the streaming win.'],
        ['Streaming', 'Progressive markdown, citations as they are emitted, stable layout.', 'Reflowing the page on every chunk, or auto-scrolling away from what the user is reading.'],
        ['Agent multi-step', 'Named steps with status, results as they complete, elapsed time.', 'One spinner for a three-minute task.'],
        ['Complete', 'Copy, edit, regenerate, cite, apply, and a feedback affordance.', 'A dead block of text the user cannot act on.']
      ]
    },
    {
      t: 'note',
      tone: 'warn',
      title: 'Streaming has costs people discover late',
      md: `Streaming interacts badly with several things you may want. You cannot validate a JSON
response before the user has seen most of it, so structured output and streaming pull in
opposite directions -- stream prose, buffer structure. Output-side safety filters need the full
text, so you either accept a pre-stream delay or risk retracting something already displayed.
Server-Sent Events over HTTP/1.1 hit per-domain connection limits; HTTP/2 or WebSockets avoid
that. And a dropped connection mid-stream needs a resumption story, or a two-minute agent run
dies when a phone changes network. Decide these before launch, not during the incident.`
    },

    { t: 'h', text: 'Progress disclosure for multi-step work' },
    {
      t: 'prose',
      md: `An agent that runs for ninety seconds behind a spinner will be abandoned, and worse,
it will be *distrusted* -- users assume nothing is happening. The same ninety seconds with
visible steps is tolerable and sometimes interesting.

Show the plan if you have one, then each step with its status, and the result of each as it
completes. Name steps in the user's language -- "Checking the deployment logs", not
\`executing tool get_logs\`. Make the whole thing cancellable at every step, and make the cost of
cancelling zero. Critically, on cancellation or failure, **report what actually happened**:
"I updated the config and restarted staging, but could not reach production" is essential
information, and a generic "task failed" after side effects have occurred is the worst possible
outcome.

Two further details matter more than they look. Keep elapsed time visible, because uncertainty
about duration is more uncomfortable than duration itself. And if a step is going to take
unusually long, say so before it starts rather than after the user has begun to worry.`
    },

    { t: 'h', text: 'Communicating uncertainty without hedging everything' },
    {
      t: 'prose',
      md: `There is a failure mode where every answer is wrapped in "I may be wrong, please
verify, as an AI I cannot be certain". It is worse than useless: it provides no information --
the hedge is constant, so it does not distinguish a reliable answer from a shaky one -- and it
trains users to ignore all warnings, including the ones that mattered.

Useful uncertainty is **differentiated and grounded in something real**. The honest signals you
actually have are: whether retrieval found strong matches, whether the sources agree, whether
the question falls inside the domain you support, and whether the model's own stated confidence
is calibrated (usually it is not, so treat self-reported confidence with suspicion until you
have measured it against outcomes).

The strongest form of uncertainty communication is not a hedge at all -- it is **refusal plus
next step**. "I could not find this in your documents. It may be in the archive, which I do not
have access to -- here is how to request it" is more useful and more trustworthy than a
plausible guess with a disclaimer. This requires a confidence gate before generation: if the
top reranker score is below your calibrated threshold, do not generate an answer.`
    },
    {
      t: 'grid',
      cols: 2,
      title: 'Uncertainty signals, strongest first',
      items: [
        { b: 'Refuse and redirect', md: 'No answer, a clear statement of what is missing, and a concrete next step. Use when retrieval is weak or the question is out of scope. Requires a pre-generation confidence gate.' },
        { b: 'Cite and let them verify', md: 'Every claim carries a source the user can open. This is the main trust mechanism — it transfers verification cost from belief to a click.' },
        { b: 'Flag conflicts explicitly', md: '"Your 2024 policy says 30 days, the 2026 revision says 14. I am using the newer one." Naming the conflict is far more credible than silently choosing.' },
        { b: 'Scope the claim', md: '"Based on the three EU policy documents I found" tells the user exactly what the answer does and does not cover, without a generic disclaimer.' }
      ]
    },

    { t: 'h', text: 'Citations as the trust mechanism' },
    {
      t: 'prose',
      md: `Citations do something no confidence score can: they make verification *cheap and
local*. A user reading a claim can check that one claim in two seconds without evaluating the
whole answer. That changes the interaction from "do I trust this system" to "is this sentence
right", which is a question humans are good at.

Make them work properly. Place them inline at the claim, not as a bibliography at the bottom
that nobody maps back to the text. Link to the precise location -- a section anchor or a
highlighted span -- rather than a 40-page PDF, because a citation that costs two minutes to
check is not a citation. Show a preview of the cited passage on hover so verification does not
require leaving the page. Resolve citation IDs to URLs in your own code rather than asking the
model for a URL. And verify after generation that every cited ID exists, flagging or stripping
those that do not.

There is a real risk to be honest about: citations increase perceived credibility whether or not
they are accurate, so a fabricated or mismatched citation makes a wrong answer *more* dangerous
than an uncited one. That is precisely why post-generation verification is not optional.`
    },

    { t: 'h', text: 'Make the output editable, not final' },
    {
      t: 'prose',
      md: `A block of text the user can only accept or reject forces a binary decision about
something that is usually 85% right. Editing is where most of the real value is, and it is also
your best quality signal.

So: generated text goes into an editable field, not a read-only bubble. Generated code goes into
a diff view with per-hunk accept and reject, not a wall the user copies by hand. A drafted email
opens in a composer. A generated configuration change lands as a pull request. In each case the
model produces a *proposal* and the human retains the commit decision -- which is both better
UX and a cleaner authorisation story, because the irreversible action is taken by a person.

The pattern generalises: **stage changes, then commit**. Show a preview of exactly what will
change, let the user modify it, and apply only on explicit approval. Where a change must be
applied immediately, make undo real and obvious, with a time window long enough to notice the
mistake. "Are you sure?" is a much weaker control than a working undo, because users click
through confirmations and genuinely use undo.`
    },

    { t: 'h', text: 'Failing gracefully' },
    {
      t: 'prose',
      md: `AI features fail in ways ordinary features do not: the provider rate-limits you, a
model is deprecated, a region has an outage, content is refused by a safety filter, or the
stream dies at token 400 of 900. Each needs a designed response, because the default -- a
generic error toast -- destroys more trust than the failure itself.

Partial output is the interesting case. If the stream dies mid-answer, keep what arrived, say
clearly that it is incomplete, and offer to continue rather than discarding it. Users are
forgiving of an incomplete answer and unforgiving of losing one they were reading.

For provider failures, degrade in tiers rather than falling over: retry with backoff and
jitter, fail over to a secondary provider or a smaller model with a quality note, serve a cached
answer for a repeated question, and finally fall back to the deterministic non-AI path --
keyword search results, a documentation link, a human handoff. The last tier is the one teams
skip, and it is the one that keeps the product usable during an outage. A support product whose
AI is down should still show search results, not an apology.`
    },

    { t: 'h', text: 'Feedback you can actually learn from' },
    {
      t: 'prose',
      md: `Thumbs up and down are the default and they are a weak signal. Response rates are low
and heavily biased toward the angry and the delighted; the meaning is ambiguous (was the answer
wrong, or correct but unhelpful, or correct and unwelcome?); and they are trivially gamed by
making answers agreeable rather than accurate, which is a real failure mode if you optimise
against them.

Implicit signals are more plentiful and more honest, because the user produces them by working
rather than by rating:

- **Edits.** What the user changed and by how much. A heavily edited draft is a specific,
  actionable failure, and the edit itself is a training-quality label for free.
- **Accept and apply rates.** Did they use the suggestion, the diff hunk, the drafted message?
- **Regeneration.** An immediate regenerate is a clear negative, and the rate is comparable
  across versions.
- **Copy.** Copying an answer out is a strong positive in most products.
- **Abandonment.** Closing or navigating away mid-stream says the answer went wrong early.
- **Follow-up shape.** A rephrasing of the same question means retrieval or comprehension
  failed; a genuine follow-up means it succeeded.
- **Escalation.** Asking for a human is the clearest failure signal a support product has.
- **Downstream outcome.** Did the suggested fix actually work? The ticket reopened? This is the
  slowest and by far the most valuable signal.

Keep the explicit thumbs -- they are cheap and useful as a coarse trend -- but attach an
optional "what was wrong" with a few categories, and treat the free-text box as your richest
source of eval cases. Most importantly, log every signal against the trace ID so a negative
rating can be traced to the exact prompt, retrieved chunks and model version. Feedback you
cannot attribute is feedback you cannot act on.`
    },
    {
      t: 'table',
      title: 'Feedback signals compared',
      cols: ['Signal', 'Volume', 'Clarity', 'Gameable?', 'Best used for'],
      rows: [
        ['Thumbs up/down', 'Low (single-digit % response)', 'Ambiguous', 'Yes — rewards agreeableness', 'Coarse trend over time; sourcing eval cases from the negatives'],
        ['Edit distance on output', 'High', 'High — you see exactly what was wrong', 'No', 'Per-feature quality tracking and eval set construction'],
        ['Accept / apply rate', 'High', 'High', 'Somewhat', 'The primary quality metric for code and diff-shaped products'],
        ['Regeneration rate', 'Medium', 'Clear negative', 'No', 'Comparing prompt and model versions'],
        ['Abandonment mid-stream', 'Medium', 'Clear negative, early failure', 'No', 'Detecting answers that go wrong in the first sentences'],
        ['Escalation to human', 'Low', 'Unambiguous failure', 'No', 'The headline metric for support products'],
        ['Downstream outcome', 'Low, delayed', 'Highest', 'No', 'The number to report to leadership, and the hardest to instrument']
      ]
    },

    { t: 'h', text: 'Cancellation and cost awareness' },
    {
      t: 'prose',
      md: `Every generation must be cancellable, and cancellation must actually stop the work,
not just hide the UI. That means propagating an abort signal through your gateway to the
provider request -- a client-side cancel that leaves the tokens generating is a bill you pay for
output nobody reads, and at scale it is a meaningful line item.

Cost awareness cuts two ways. Users on metered plans need to see what an action will cost
before a long agent run, and they need a spend cap they cannot accidentally blow through. And
your own architecture needs per-user and per-tenant budgets enforced server-side, because a
single runaway session should not be able to exhaust a shared quota. Surface remaining budget
honestly rather than failing silently at the limit, and when you degrade a user to a cheaper
model to stay in budget, say so -- an unexplained quality drop is worse than an explained one.`
    },

    { t: 'h', text: 'Designing so a wrong answer is cheap' },
    {
      t: 'prose',
      md: `This is the organising principle behind everything above, and the one worth stating
explicitly in an interview. You cannot make the model reliably correct. You can make the *cost
of it being wrong* small, and that is a design variable you fully control.

Cost to the user is composed of: how long it takes to notice the error, how much effort it
takes to verify, how hard it is to undo, and how much damage occurred before they noticed.
Citations reduce verification cost. Editable output and staged changes reduce correction cost.
Undo and previews reduce damage. Progress disclosure reduces the time to notice, because the
user sees the wrong turn as it happens instead of at the end.

A useful exercise when reviewing an AI feature design: take the worst plausible wrong answer and
walk through what the user does next. If the answer is "notices in three weeks and files a
support ticket", the design is wrong regardless of how good the model is. If it is "sees the
citation does not support the claim, clicks edit, fixes it in ten seconds", you have built
something that can ship with an imperfect model -- which is the only kind there is.`
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      gains: [
        'Streaming plus phase disclosure makes multi-second latency tolerable and multi-minute agent work usable.',
        'Citations move verification from trusting the system to checking one sentence.',
        'Editable, staged output turns a binary accept/reject into collaboration and yields the best quality signal you have.',
        'Graceful degradation keeps the product usable when the provider is not.',
        'Implicit feedback gives you high-volume, honest quality data without asking users for anything.'
      ],
      costs: [
        'Streaming conflicts with output validation and safety filtering, and needs reconnection handling.',
        'Progress disclosure requires the backend to emit structured events, not just tokens — a real API design cost.',
        'Staging, preview and undo mean building transactional or reversible operations, which is genuine backend work.',
        'Confidence gating and refusal reduce coverage: you answer fewer questions in exchange for being wrong less often.',
        'Implicit feedback instrumentation touches every surface and carries privacy obligations.',
        'Multi-tier fallback doubles the paths you must test and keep working.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'Spinner for the entire pre-token phase', blast: 'Users abandon before the first token, and the abandonment looks like disinterest rather than latency in your metrics.', fix: 'Emit named phase events — rewriting, searching, found N sources — and render them. Track TTFT and abandonment-before-first-token as paired metrics.' },
        { mode: 'Generic hedging on every response', blast: 'Warnings become invisible, so the genuinely low-confidence answers carry no distinguishing signal.', fix: 'Differentiated uncertainty grounded in retrieval scores and source agreement; refusal with a next step instead of a guess with a disclaimer.' },
        { mode: 'Citations to whole documents, or fabricated ones', blast: 'Verification is too expensive to bother with, and false citations make a wrong answer more credible than an uncited one.', fix: 'Anchor-level links with hover previews; resolve IDs to URLs in your code; verify every cited ID exists post-generation and strip or flag failures.' },
        { mode: 'Stream dies mid-answer and the UI discards everything', blast: 'The user loses an answer they were actively reading; trust damage is out of proportion to the failure.', fix: 'Persist partial output, mark it incomplete, offer continue; stream resumption keyed by generation ID.' },
        { mode: 'Cancel only hides the UI', blast: 'Tokens keep generating and billing; at scale it is a visible cost line for output nobody sees.', fix: 'Propagate the abort signal through the gateway to the provider; assert on it in tests; monitor tokens generated after cancellation.' },
        { mode: 'Agent applies changes directly with no preview', blast: 'A wrong action is already in production before the user can evaluate it.', fix: 'Stage and preview by default; human commits the change; real undo with a meaningful window where immediate application is unavoidable.' },
        { mode: 'Thumbs as the only feedback', blast: 'Low-volume, ambiguous, biased data; optimising against it produces agreeable rather than accurate answers.', fix: 'Instrument edits, accepts, regenerations, abandonment and escalations, all attributed to a trace ID; keep thumbs as a coarse trend only.' },
        { mode: 'No non-AI fallback', blast: 'A provider outage takes the whole feature down, including capabilities that never needed a model.', fix: 'Tiered degradation ending in the deterministic path — keyword search, docs link, human handoff — and test it as a routine drill.' }
      ]
    },

    {
      t: 'staff',
      md: `Most candidates discuss AI UX as if it were visual design. The Staff framing is that
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
better model will fix.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'Your RAG answer has 2.9 s TTFT because retrieval and reranking run first. Engineering proposes optimising decode throughput from 45 to 90 tokens/sec. What is the better investment?',
          options: [
            'Ship the decode optimisation — halving generation time is a large win.',
            'Attack TTFT instead: prefix caching, fewer input tokens, and streaming named retrieval phases so the 2.9 s is informative rather than empty.',
            'Buffer the whole response and render it at once for a cleaner layout.',
            'Increase k so fewer follow-up questions are needed.'
          ],
          answer: 1,
          why: 'Decode at 45 tokens/sec is already far above reading speed of roughly 5-8, so the user never waits on it — doubling it is imperceptible in a streaming interface. The entire perceived latency is the 2.9 s of silence. Cut it with prefix caching and a smaller prompt, and make what remains informative by streaming phase events. Buffering would discard the streaming benefit entirely.'
        },
        {
          q: 'Which feedback signal is most useful for improving a code-suggestion product?',
          options: [
            'Thumbs up/down on each suggestion.',
            'Per-hunk accept rate combined with what the developer edited after accepting, both attributed to the trace ID.',
            'Average session length.',
            'Model self-reported confidence per suggestion.'
          ],
          answer: 1,
          why: 'Accept rate plus post-accept edits is high-volume, unambiguous and produced as a side effect of normal work — no one has to rate anything. The edit itself is a free quality label showing exactly what was wrong, which is directly usable as an eval case. Attribution to the trace ID is what makes it actionable, letting you resolve a bad suggestion back to its prompt and model version. Thumbs are sparse and biased; session length is confounded, since a long session can mean engagement or struggle; self-reported confidence is typically uncalibrated.'
        },
        {
          q: 'An agent that modifies infrastructure config has a 92% success rate. Which design choice most reduces the cost of the other 8%?',
          options: [
            'A confirmation dialog showing the raw JSON of the planned change.',
            'Generating a staged diff the user reviews and applies, with per-change accept/reject and a real undo path.',
            'Adding "please verify this change" to every response.',
            'Raising the model temperature to produce more varied options.'
          ],
          answer: 1,
          why: 'The lever is the cost of being wrong, not the error rate. A staged diff makes the error visible before it has any effect, lets the user fix part of a mostly-correct change rather than rejecting all of it, and keeps the commit decision with a human — which is also the cleaner authorisation story. Raw JSON in a dialog is unreadable, so it produces approvals without comprehension; a blanket verify instruction is a constant hedge that carries no information.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `TTFT and the prefill/decode split come from **LLM Fundamentals for Engineers**, and
the prefix caching that lowers TTFT from **Context Engineering**. Citation design and refusal
gating are the product face of **RAG: The Reference Architecture** and **Advanced Retrieval**.
Confirmation gates and staged changes are the UI half of **Tool Calling & Typed Actions** and
**Agent Architecture**. Implicit feedback attributed to trace IDs is **AI Observability &
Tracing**, and it is the input to **Evaluation & Quality Regression**.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why is TTFT the metric AI UX is designed around?', a: 'Perceived latency is dominated by the silence before anything appears; once tokens stream the user is reading and the clock feels slower. TTFT is also the part you control — prompt size, prefix cache hits, and whether you do a retrieval round trip first.' },
    { q: 'Why does raising decode throughput above ~8 tokens/sec stop helping?', a: 'That is roughly human reading speed. Above it the user is never waiting on generation in a streaming interface, so extra tokens per second are imperceptible. Spend the effort on TTFT, quality, or a cheaper model instead.' },
    { q: 'What should you show before the first token?', a: 'The real work, named: "Searching your documents", then the source titles as they resolve, then "Writing answer". It converts dead time into a progress narrative, sets expectations about what the answer is based on, and lets the user cancel early if the sources are obviously wrong.' },
    { q: 'Why is generic hedging worse than no hedging?', a: 'A constant disclaimer carries no information — it cannot distinguish a well-grounded answer from a shaky one — and it trains users to ignore all warnings including the ones that mattered. Differentiate using real signals: retrieval scores, source agreement, and scope.' },
    { q: 'Why are citations the primary trust mechanism?', a: 'They make verification cheap and local: the user checks one claim in two seconds instead of evaluating the whole answer. Link to anchors with hover previews, resolve IDs to URLs in your own code, and verify every cited ID exists — a fabricated citation makes a wrong answer more dangerous than an uncited one.' },
    { q: 'What is the "stage then commit" pattern?', a: 'The model produces a proposal — a diff, a draft, a pull request — which the user reviews, edits and explicitly applies. It turns a binary accept/reject into collaboration, and it keeps the irreversible action with a human who has the authority to take it.' },
    { q: 'Why are thumbs up/down a weak feedback signal?', a: 'Low response rate, biased toward the angry and the delighted, ambiguous meaning, and gameable — optimising against them rewards agreeableness over accuracy. Use edits, accept rates, regenerations, abandonment and escalations instead, all attributed to a trace ID.' },
    { q: 'What should happen when a stream dies mid-answer?', a: 'Persist what arrived, mark it clearly incomplete, and offer to continue from that point. Users forgive an incomplete answer and do not forgive losing one they were reading. Stream resumption should be keyed by generation ID.' },
    { q: 'What are the tiers of graceful degradation for a provider outage?', a: 'Retry with backoff and jitter, fail over to a secondary provider or smaller model with a quality note, serve a cached answer for a repeated question, then fall back to the deterministic non-AI path — keyword search, docs link, human handoff. The last tier is the one teams skip and the one that keeps the product usable.' }
  ],

  drills: [
    {
      prompt: 'Design the interaction for an AI assistant in a data platform that answers analytics questions by writing and running SQL. Queries take 3-30 s, the SQL is right about 85% of the time, and some tables contain regulated data.',
      probes: [
        'What does the user see in the first two seconds?',
        'How does a user catch a wrong query before it costs them a wrong decision?',
        'What happens when the warehouse is slow or the model is unavailable?',
        'What feedback do you collect and how do you attribute it?'
      ],
      strong: [
        'Streams the generated SQL first so the user can read and correct it before execution, treating the SQL as the reviewable artefact rather than the result.',
        'Stages execution behind an explicit run action, with row and cost estimates, and blocks or gates queries touching regulated tables.',
        'Names each phase — understanding the question, finding tables, writing SQL, running — with elapsed time and a working cancel that aborts the warehouse query, not just the UI.',
        'Makes the result verifiable: shows the SQL alongside the output, cites which tables and columns were used, and surfaces assumptions such as the date range chosen.',
        'Makes the SQL editable with re-run, so an 85%-correct query is a ten-second fix rather than a rejected answer.',
        'Designs the wrong-answer path explicitly: a plausible but subtly wrong aggregate is the dangerous case, so it shows row counts, a sample of underlying rows, and the filters applied.',
        'Degrades in tiers: retry, smaller model, cached prior result for the same question, then a link to the saved-query library or a human analyst.',
        'Instruments edits to the generated SQL, run rate, re-run-after-edit rate and abandonment, all attributed to a trace ID carrying the prompt, schema context and model version.',
        'Notes that authorisation must run as the user against the warehouse, so the assistant cannot read tables the user could not.'
      ],
      weak: [
        'Runs the query immediately and shows only the result.',
        'A single spinner for the full 3-30 s with no phases or cancel.',
        'Hides the SQL because "users should not need to see it".',
        'Thumbs up/down as the entire feedback mechanism.',
        'No plan for warehouse slowness or provider outage.'
      ]
    },
    {
      prompt: 'Your AI support assistant has a 71% "helpful" thumbs rate and leadership considers that a success. Escalations to human agents have not fallen. Explain what is going on and what you would measure instead.',
      probes: [
        'Why can those two numbers coexist?',
        'What would you instrument this quarter?',
        'How do you connect a bad outcome back to a specific generation?'
      ],
      strong: [
        'Explains the bias directly: thumbs are collected from a small, self-selected slice, so 71% describes the people who chose to rate rather than the population.',
        'Points out that "helpful" is not "resolved" — a polite, well-written, wrong answer rates well and still produces an escalation.',
        'Names escalation rate and downstream resolution as the real outcome metrics, since they are unambiguous and tied to the business result.',
        'Proposes implicit instrumentation: abandonment mid-stream, rephrasing of the same question, copy rate, time to escalation, and ticket reopen rate.',
        'Requires every signal to be attributed to a trace ID carrying prompt version, retrieved chunk IDs and scores, and model version, so a bad outcome resolves to a specific generation.',
        'Warns that optimising against thumbs specifically rewards agreeableness, which can raise the rating while worsening resolution.',
        'Proposes mining escalated conversations into a labelled eval set, separating retrieval failures from generation failures.',
        'Suggests a holdout or staged comparison so the assistant\'s effect on escalation rate can be measured rather than asserted.'
      ],
      weak: [
        'Accepts 71% as the quality number and proposes improving it.',
        'Adds more prompts asking users to rate responses.',
        'No causal link between feedback and specific generations.',
        'Does not question whether "helpful" measures anything the business cares about.'
      ]
    }
  ]
};
