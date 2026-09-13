export default {
  blocks: [
    {
      t: 'prose',
      md: `Search-as-you-type is not a smaller search box. It is a latency contract: the user types
at 4-8 keys per second and expects suggestions within 100 ms of the last keystroke, even on a
3G link with 180 ms RTT. That budget leaves almost no room for a round trip to a general search
cluster on every character.

The design splits into three layers that interviewers expect you to name separately: **input
shaping** (debounce, cancel, coalesce), **serving path** (typeahead index vs full search), and
**presentation** (empty states, ranking freshness, mobile keyboard). Get the first two wrong and
no amount of skeleton UI saves the experience.`
    },

    { t: 'h', text: 'Input shaping: debounce, cancel, coalesce' },
    {
      t: 'prose',
      md: `**Debounce** is not "wait 300 ms after typing stops." That feels fine on a settings
form and broken in autocomplete. For typeahead, debounce the *network*, not the *UI*: update the
highlighted prefix locally on every keypress, but only fire a fetch after 20-50 ms of quiet. At
60 WPM that is roughly one character every 120 ms, so a 30 ms debounce collapses "react" into one
request instead of six while still feeling instant.

**AbortController** cancels stale responses. Without it, a slow \`rea...\` response arriving after
\`react hooks\` wins and the dropdown flickers backward -- a classic race. Always abort the
previous fetch before starting the next.

**In-flight coalescing** goes further: if the user types \`r\`, \`re\`, \`rea\` while one request
is still in flight, do not queue three more. Hold the latest query and send exactly one request
when the current one finishes. At 200 req/s per user during fast paste, coalescing cuts load by
80% with no perceptible delay.`
    },
    {
      t: 'diagram',
      code: `sequenceDiagram
  participant U as User input
  participant D as Debouncer
  participant C as Coalescer
  participant S as Typeahead API
  U->>D: key "r"
  D->>D: wait 30ms
  U->>D: key "e" resets timer
  D->>C: query "re"
  C->>S: GET q=re
  U->>D: key "a" while in flight
  D->>C: latest "rea" queued
  S-->>C: results for "re" dropped
  C->>S: GET q=rea
  S-->>C: results for "rea"
  C->>U: render once`,
      caption: 'Debounce collapses bursts; coalescing ensures only the latest query hits the wire after an in-flight request completes.'
    },
    {
      t: 'code',
      lang: 'js',
      title: 'Debounce plus abort plus coalesce in one hook',
      code: `let timer, controller, inFlight = false, pending = null;

function onInput(q) {
  renderLocalPrefix(q);           // instant: no debounce on paint
  clearTimeout(timer);
  timer = setTimeout(() => enqueue(q), 30);
}

function enqueue(q) {
  if (inFlight) { pending = q; return; }
  inFlight = true;
  controller?.abort();
  controller = new AbortController();
  fetch('/api/suggest?q=' + encodeURIComponent(q), { signal: controller.signal })
    .then(r => r.json())
    .then(items => render(items))
    .catch(e => { if (e.name !== 'AbortError') showError(); })
    .finally(() => {
      inFlight = false;
      if (pending) { const next = pending; pending = null; enqueue(next); }
    });
}`
    },

    { t: 'h', text: 'Typeahead index vs full search' },
    {
      t: 'prose',
      md: `Autocomplete and ranked search are different products. **Typeahead** answers "what
strings start with or fuzzy-match this prefix?" from a pre-built index -- trie, n-gram table, or
Elasticsearch completion suggester -- sized for sub-10 ms p99 on a warm cache. **Full search**
answers "what documents best match this intent?" with BM25, vectors, filters, and personalization.
That path is 50-200 ms even when healthy.

The rule: never hit the full search cluster on every keystroke. Serve suggestions from a
dedicated index updated on a lag you can defend -- 1-5 minutes for catalog SKUs, 30-60 seconds
for news -- and only promote to full search on Enter or after 300 ms idle with a query longer than
three characters. Mixing the two in one dropdown without labeling the source confuses users when
rankings disagree.`
    },
    {
      t: 'table',
      title: 'Serving path comparison',
      cols: ['Path', 'Latency target', 'Freshness', 'Best for'],
      rows: [
        ['**Prefix trie / completion index**', '5-15 ms p99 at edge', '1-5 min replication lag', 'Product SKUs, city names, @handles -- finite vocabularies.'],
        ['**Edge KV cache of hot prefixes**', '10-30 ms', 'TTL 30-120 s; invalidate on publish', 'Top 10k queries like "iphone" where 80% of traffic hits 1% of prefixes.'],
        ['**Full search (BM25 + filters)**', '50-200 ms', 'Near real-time index', 'Enter key, "See all results", queries with operators or facets.'],
        ['**Client-side recent + local index**', '0 ms', 'Instant for this device', 'Recent searches, open tabs, offline docs -- zero network until 2+ chars.']
      ]
    },

    { t: 'h', text: 'Ranking freshness and empty states' },
    {
      t: 'prose',
      md: `**Ranking freshness** is the tension between a stale-but-fast index and a fresh-but-slow
one. Ship two tiers in the response: \`suggestions[]\` from the typeahead index and an optional
\`trending[]\` blob refreshed every 60 s at the CDN. When the user types a rare prefix, fall back
to fuzzy matches and show "Search for \`{q}\`" as the first row rather than an empty box -- empty
dropdowns read as broken.

Cap suggestions at 8-10 items. Mobile viewports fit five before the keyboard covers half the
list. Highlight the matched substring with \`<mark>\` semantics, not color alone, and keep
keyboard focus in the input: arrow keys move selection, Enter commits, Escape clears without
submitting the parent form.`
    },
    {
      t: 'note',
      tone: 'info',
      title: 'Mobile keyboard changes the layout budget',
      md: `On iOS Safari the virtual keyboard consumes 40-50% of viewport height. Position the
dropdown **above** the input on narrow screens, or use a full-screen overlay sheet. \`visualViewport\`
resize events beat \`window.innerHeight\` for keyboard detection. Avoid \`position: fixed\` footers
that the keyboard obscures -- users cannot see what they selected.`
    },

    { t: 'h', text: 'Privacy of queries' },
    {
      t: 'prose',
      md: `Every keystroke is a potential PII leak. Typeahead logs contain medical conditions,
password fragments typed into the wrong field, and names of people the user is searching for.
**Minimize retention**: aggregate metrics at the prefix level, not full strings; drop queries
matching credit-card or SSN patterns before logging; never sync raw keystrokes to analytics on
queries shorter than three characters.

Use POST with a JSON body for suggest APIs when referrers leak query strings to third-party
analytics. Set \`Referrer-Policy: no-referrer\` on search pages. If you offer "recent searches,"
store them in \`localStorage\` on device by default -- server-side history requires explicit opt-in
and a deletion API.`
    },

    { t: 'h', text: 'Numbers that anchor the design' },
    {
      t: 'numbers',
      items: [
        { v: '30 ms', k: 'Debounce for typeahead network -- not 300 ms, which waits for a pause the user never gives.' },
        { v: '100 ms', k: 'End-to-end p95 budget from last key to painted suggestions on 4G.' },
        { v: '8 items', k: 'Max dropdown rows before scroll and keyboard clipping dominate mobile.' },
        { v: '1-5 min', k: 'Acceptable typeahead index lag for catalog autocomplete vs near-real-time full search.' },
        { v: '80%', k: 'Request reduction from in-flight coalescing during fast typing or paste.' }
      ]
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      gains: [
        'Sub-100 ms feel by serving from a completion index instead of full search.',
        'AbortController plus coalescing eliminate race flicker and cut redundant load during fast typing.',
        'Separate Enter-path to full search preserves ranking quality without sacrificing keystroke latency.',
        'Local recent searches give zero-latency first rows before the network returns.'
      ],
      costs: [
        'Two indexes to build, monitor, and keep loosely consistent -- typeahead and full search.',
        'Stale suggestions until replication catches up; users may see discontinued SKUs.',
        'Privacy and compliance work on logs that capture partial queries.',
        'Mobile layout complexity: keyboard, viewport, and focus management are easy to get wrong.',
        'Edge caching of prefixes leaks popular queries across users unless scoped carefully.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: '300 ms debounce on autocomplete', blast: 'Dropdown feels one keystroke behind; fast typers outrun suggestions entirely.', fix: 'Debounce network at 20-50 ms; update local prefix highlight on every key with no delay.' },
        { mode: 'No AbortController on fetch', blast: 'Stale responses overwrite fresh ones; dropdown jumps backward and users lose trust.', fix: 'Abort previous request before each new fetch; ignore AbortError in catch.' },
        { mode: 'Full search cluster on every keypress', blast: 'p99 latency hits 200 ms+; cluster cost scales with WPM not with useful queries.', fix: 'Dedicated completion index for suggest; full search only on Enter or idle promotion.' },
        { mode: 'Empty dropdown for unknown prefixes', blast: 'Users assume search is broken and abandon -- 12-18% drop-off in A/B tests at major retailers.', fix: 'Always show "Search for `{q}`" row plus fuzzy fallbacks and recent local history.' },
        { mode: 'Raw keystroke logging to analytics', blast: 'PII incident when users type names, diagnoses, or credentials into the wrong field.', fix: 'Prefix-level aggregates, pattern redaction, POST body, short retention, opt-in server history.' },
        { mode: 'Dropdown below input on mobile', blast: 'Keyboard covers suggestions; user cannot confirm selection without dismissing keyboard.', fix: 'Flip dropdown above input or use full-screen sheet; listen to visualViewport resize.' }
      ]
    },

    {
      t: 'staff',
      md: `Staff signal: you separate **input shaping** from **serving path** and quote real
timings.

- "I debounce the network at 30 ms, not the UI -- prefix highlight is synchronous on every
  keypress. Three hundred milliseconds is for form validation, not typeahead."
- "Every fetch gets an AbortController; without it stale \`rea\` beats \`react\` and the list
  flickers backward. That bug ships constantly."
- "In-flight coalescing: if a request is outstanding, I queue only the latest query. Fast paste
  drops from six in-flight requests to one."
- "Keystrokes hit a completion index at 5-15 ms p99, not the full BM25 cluster. Full search
  runs on Enter or after 300 ms idle with query length greater than three."
- "Empty state is never empty -- first row is always Search for \`{q}\`, plus device-local
  recents. An empty box reads as broken."
- "Query strings do not go to analytics on every key; POST suggest, redact patterns, aggregate
  at prefix level. Recent searches stay in localStorage unless the user opts in."

Naming coalescing, the 30 ms vs 300 ms distinction, and PII on partial queries says you shipped
this, not read a blog post.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'User types "react hooks" quickly. Without coalescing, how many suggest API calls fire if each character waits for the previous response to finish?',
          options: [
            'One -- debounce handles it.',
            'Two -- only the first and last matter.',
            'Up to eleven -- one per character if each fetch outlasts the next keystroke.',
            'Zero -- the browser batches keyboard events.'
          ],
          answer: 2,
          why: 'Debounce collapses quiet periods but does not help when requests overlap. If RTT is 120 ms and the user types 11 characters in 600 ms, each key can start a new fetch before the prior completes unless you coalesce. Coalescing holds the latest query and sends one request when the in-flight call finishes, cutting load roughly 80% during paste.'
        },
        {
          q: 'Product wants "fresh" autocomplete synced to inventory within 5 seconds. Your completion index replicates in 2 minutes. Best approach?',
          options: [
            'Hit full search on every keystroke for freshness.',
            'Keep the fast completion index; invalidate hot SKU prefixes via pub/sub; full search on Enter for edge cases.',
            'Remove autocomplete until replication is instant.',
            'Client polls full search every 5 seconds while the dropdown is open.'
          ],
          answer: 1,
          why: 'Full search on every key destroys the latency budget. Targeted invalidation of affected prefixes -- or a 30 s edge cache TTL on hot keys -- closes most of the freshness gap without sacrificing 100 ms feel. Enter-path full search catches the long tail where the completion index is stale.'
        },
        {
          q: 'Dropdown shows results for "rea" after user typed "react". Most likely bug?',
          options: [
            'Debounce window is too short.',
            'Stale response applied because AbortController was missing or abort was ignored.',
            'Completion index is too small.',
            'Too many suggestions returned.'
          ],
          answer: 1,
          why: 'This is a classic out-of-order response race. Without aborting the in-flight "rea" fetch when "react" is requested, the slower response can win and overwrite fresher results. AbortController plus ignoring results whose query !== currentInput fixes it.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics',
      blocks: [{
        t: 'prose',
        md: `Abort and coalesce patterns appear in **API & BFF** caching chapters. Edge prefix
caching connects to **CDN & Edge**. Offline recent searches overlap **Offline-First & Sync**.
Full-search-on-Enter shares ranking concerns with backend **Databases & Indexes** inverted-index
design.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why debounce typeahead at 20-50 ms instead of 300 ms?', a: 'Users type continuously at 4-8 keys per second; 300 ms waits for a pause that never comes. Thirty milliseconds collapses bursts into one request while local prefix highlight stays instant on every keypress.' },
    { q: 'What does in-flight coalescing do?', a: 'While one suggest request is outstanding, store only the latest query instead of queueing every intermediate one. When the in-flight call finishes, send one request for the latest text -- cutting load up to 80% during fast paste.' },
    { q: 'Why use AbortController on suggest fetches?', a: 'Without abort, a slow response for an old prefix can arrive after a newer one and overwrite the dropdown, causing backward flicker. Abort the previous fetch before starting the next and ignore AbortError.' },
    { q: 'Typeahead index vs full search -- when each?', a: 'Completion index serves keystrokes at 5-15 ms p99 from prefix or n-gram data with minutes of lag. Full BM25 search serves Enter and idle promotion at 50-200 ms with richer ranking -- never on every keypress.' },
    { q: 'What should an empty autocomplete state show?', a: 'Never a blank dropdown -- show a Search for `{q}` row, fuzzy fallbacks, and device-local recent searches. Empty reads as broken and drives 12-18% abandonment in retail A/B tests.' },
    { q: 'How do mobile keyboards affect autocomplete layout?', a: 'Virtual keyboard consumes 40-50% of viewport on iOS; dropdown below input gets covered. Flip above input or use a full-screen sheet and listen to visualViewport resize, not window.innerHeight.' },
    { q: 'Privacy risks in search-as-you-type logging?', a: 'Partial queries contain PII -- names, medical terms, mistyped passwords. Use POST bodies, prefix-level aggregates, pattern redaction, short retention, and keep recent searches in localStorage unless user opts in to server history.' }
  ],

  drills: [
    {
      prompt: 'Design autocomplete for a global e-commerce site: 50M SKUs, 120M suggest requests per day, p95 under 100 ms on 4G, inventory changes must reflect within 2 minutes for top sellers, and GDPR applies in the EU.',
      probes: [
        'Where does each keystroke go -- which index, which cache layer?',
        'User types a SKU number that was delisted 90 seconds ago. What do they see?',
        'How do you debounce, cancel, and coalesce on the client?',
        'What do you log, and what do you never log?',
        'Mobile user on iOS -- where does the dropdown render?'
      ],
      strong: [
        'Completion index for suggest at 5-15 ms p99; full search only on Enter or after 300 ms idle with query length greater than three.',
        '30 ms network debounce with synchronous local prefix highlight; AbortController on every fetch; in-flight coalescing during paste.',
        'Pub/sub invalidation of hot prefix cache entries on inventory change; 2-minute lag acceptable for long-tail SKUs with Enter-path fallback.',
        'Empty state always includes Search for `{q}` plus local recents; max 8 rows on mobile.',
        'POST suggest API, prefix-level metrics, PII pattern redaction, no raw keystroke analytics, EU recent searches in localStorage by default.',
        'Dropdown above input on narrow viewports using visualViewport; arrow-key navigation without stealing focus from input.'
      ],
      weak: [
        'Full Elasticsearch query on every keypress for freshness.',
        '300 ms debounce so the UI feels laggy.',
        'No request cancellation -- race flicker accepted.',
        'Empty dropdown when prefix misses the index.',
        'Query strings in GET logged to third-party analytics on every keystroke.',
        'Fixed dropdown below input on all breakpoints.'
      ]
    },
    {
      prompt: 'Your suggest API p99 jumped from 40 ms to 280 ms after Black Friday traffic doubled. Dropdown abandonment rose 22%. You have 30 minutes with the on-call engineer.',
      probes: [
        'First three graphs you open?',
        'Is the problem client-side, edge, or origin?',
        'Quick mitigations that do not require reindexing?',
        'How do you verify the fix without waiting for peak traffic?'
      ],
      strong: [
        'Check coalescing and abort on client -- spike in parallel in-flight requests per session indicates missing coalesce.',
        'Edge cache hit rate on /suggest -- miss storm to origin explains step-change latency.',
        'Origin p99 on completion service vs full search -- accidental routing of suggest to search cluster is a common deploy bug.',
        'Raise edge TTL on top 10k prefixes to 120 s temporarily; enable stale-while-revalidate.',
        'Cap concurrent suggest fetches client-side to one; verify with synthetic typing trace at 8 keys per second.',
        'Load test with recorded prefix distribution -- 80% of traffic hits 1% of prefixes.'
      ],
      weak: [
        'Add 500 ms debounce to reduce traffic without measuring.',
        'Scale origin horizontally without checking if suggest hits the wrong cluster.',
        'Disable autocomplete entirely until after the sale.',
        'Blame CDN without checking cache-key design per prefix.'
      ]
    }
  ]
};
