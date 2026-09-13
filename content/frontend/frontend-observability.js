export default {
  blocks: [
    {
      t: 'prose',
      md: `Frontend observability is the practice of finding out what actually happened in browsers
you do not own, on networks you cannot see, running code you shipped but cannot inspect.

Backend observability has a structural advantage that is easy to overlook: the code runs on your
machines, so you can emit anything you like at any volume and read it immediately. In the browser,
every signal must be *collected on a device you do not control and transmitted over a network that
may be the reason you wanted the signal*. That constraint shapes every decision in this topic --
what you collect, when you send it, how much you keep, and which numbers you are willing to page
someone about at 3 a.m.`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `Lab measurement tells you what one device on one connection experienced. A Lighthouse run
on a developer laptop over office fibre is a useful regression detector and a terrible description
of your users.

The gap is not subtle. Real-user data on a consumer product routinely shows a p75 Largest
Contentful Paint two to four times the lab figure, because the field includes three-year-old
mid-range Android phones with roughly a quarter of the single-core performance of a current laptop,
on connections with 150-300 ms of latency, with battery saver throttling the CPU, and with browser
extensions injecting script into your page. Lab testing cannot represent any of that, and averages
across the field hide it: a mean LCP of 2.4 s is compatible with 70% of users at 1.2 s and 15% at
9 s, and it is the 15% who churn.

Then there is the class of failure that is invisible without instrumentation. A JavaScript error in
one code path means a button silently does nothing -- no server error, no log line, no support
ticket, because users do not report a button that does nothing; they leave. Observability is how
you find out that 4% of your checkout sessions are hitting an exception on a Samsung browser you
have never tested.`
    },
    {
      t: 'numbers',
      title: 'Field versus lab, typical figures',
      items: [
        { v: '2-4×', k: 'p75 field LCP versus lab LCP', note: 'Consumer products on mixed devices' },
        { v: '~4×', k: 'CPU gap, mid-tier Android to dev laptop', note: 'Single-core; worse under thermal throttling' },
        { v: '2.5 s / 200 ms / 0.1', k: 'Core Web Vitals "good" thresholds at p75', note: 'LCP / INP / CLS' },
        { v: '10-30%', k: 'Sessions with a browser extension modifying the page', note: 'A recurring source of unreproducible errors' },
        { v: '~1-5%', k: 'Beacons lost even with `sendBeacon`', note: 'Budget for it; never treat counts as exact' }
      ]
    },

    { t: 'h', text: 'RUM architecture' },
    {
      t: 'prose',
      md: `Real User Monitoring means collecting measurements from actual sessions. The architecture
is simple and the details are where it goes wrong.

Collect four families of signal. **Core Web Vitals with attribution** -- not just that LCP was
3.8 s but *which element* it was and how the time decomposed into time-to-first-byte, resource load
delay, resource load time and render delay. The \`web-vitals\` library's attribution build gives you
this, and it is the difference between "LCP is bad" and "LCP is bad because the hero image is
discovered late by the preload scanner". **Navigation and resource timing** from the Performance
API. **Errors**, including unhandled promise rejections, which most naive setups miss entirely.
And **custom business metrics**: time from click to search results rendered, checkout step
completion, the things your product actually sells.

Transmission is where the important constraint lives. Do not send on \`unload\` -- it is unreliable
and browsers actively deprioritise work there. Use \`navigator.sendBeacon\` on
\`visibilitychange\` to \`hidden\`, which is the only lifecycle event guaranteed to fire on mobile
where a tab can be discarded without any unload event ever running. \`sendBeacon\` queues the request
in the browser process so it survives the page being torn down, and because it does not block
navigation it costs the user nothing.

One more thing that catches people: some metrics are only final at the end. CLS accumulates across
the session and INP is the worst interaction so far, so both must be reported at page hide, not
after load. Reporting CLS two seconds in gives you a number that is systematically too low.`
    },
    {
      t: 'code',
      lang: 'js',
      title: 'A RUM client that reports correctly',
      code: `import { onLCP, onINP, onCLS, onTTFB } from 'web-vitals/attribution';

const queue = [];
const ctx = {
  release: __BUILD_SHA__,        // injected at build; the single most useful field
  route: routePattern(),         // '/orders/:id', never the raw URL with ids in it
  deviceMemory: navigator.deviceMemory,
  connection: navigator.connection?.effectiveType,   // '4g' | '3g' | 'slow-2g'
  saveData: navigator.connection?.saveData
};

function record(metric) {
  queue.push({
    name: metric.name,
    value: Math.round(metric.value),
    rating: metric.rating,                       // good | needs-improvement | poor
    // Attribution turns a number into something actionable.
    target: metric.attribution?.element?.slice(0, 120),
    ttfb: metric.attribution?.timeToFirstByte,
    loadDelay: metric.attribution?.resourceLoadDelay,
    renderDelay: metric.attribution?.elementRenderDelay,
    ...ctx
  });
}

[onLCP, onINP, onCLS, onTTFB].forEach(fn => fn(record));

// CLS accumulates and INP is a running worst-case, so both are only
// final at page hide. sendBeacon survives teardown; fetch usually does not.
addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || !queue.length) return;
  navigator.sendBeacon('/rum', JSON.stringify(queue.splice(0)));
});

// pagehide covers the back/forward cache case that visibilitychange can miss.
addEventListener('pagehide', flush);`
    },
    {
      t: 'note',
      tone: 'warn',
      title: 'Cardinality is what makes the bill arrive',
      md: `Sending \`route: '/orders/8f21c-9b'\` instead of \`route: '/orders/:id'\` turns one time
series into a million. Most observability vendors price on unique series or indexed dimensions, and
unbounded cardinality is the single most common cause of a frontend telemetry bill that triples
without anyone shipping a feature.

Normalise route patterns at collection time, not in the query. Keep the raw URL as an unindexed
attribute if you need it for debugging, and never put a user id, session id or full URL in a
dimension you group by.`
    },

    { t: 'h', text: 'Errors, source maps and release correlation' },
    {
      t: 'prose',
      md: `A minified stack trace reading \`t.default.a is not a function at a.chunk.7c1e.js:1:48213\`
is not information. Source maps are what convert it back into a file, a line and a function name,
and getting them right is mostly operational discipline.

Upload source maps to your error tracker at build time and do **not** serve them publicly. A
publicly readable \`.map\` file hands anyone your original source, including comments and any
internal naming you would rather not publish. Upload them keyed by release identifier and delete
them from the deployed bundle, or restrict them to authenticated internal access. Also keep
\`//# sourceMappingURL\` pointing somewhere your tracker understands, and verify resolution in
staging -- a silently broken mapping is usually discovered during an incident.

The field that makes error data usable is the **release**. Tag every event with the build SHA and
deploy timestamp, and suddenly the most valuable query in your system becomes available: error rate
per release. That is what lets you say "release \`a91f3c\` raised the TypeError rate on Safari 17
from 0.02% to 1.4% of sessions" and roll back with evidence rather than suspicion. It is also the
signal your automated canary analysis reads, so it is load-bearing infrastructure rather than a
nice label.

A few classes of error need deliberate handling. \`window.onerror\` misses unhandled promise
rejections, so register \`unhandledrejection\` separately or a large fraction of your async failures
never appear. Errors from cross-origin scripts are reported as the useless
\`Script error.\` unless the script is served with \`Access-Control-Allow-Origin\` and the tag carries
\`crossorigin="anonymous"\`. And \`ChunkLoadError\` deserves its own bucket and its own alert, because
it is not an application bug -- it is a deploy that removed assets a user's cached HTML still
references, and the fix is a retention policy, not a code change.`
    },
    {
      t: 'table',
      title: 'Error classes and what each one actually means',
      cols: ['Signal', 'Where it comes from', 'Usual cause', 'Response'],
      rows: [
        ['`ChunkLoadError`', 'Dynamic import failing after a deploy.', 'Old HTML referencing chunks pruned by the new build.', 'Retain N-1 and N-2 assets; offer a reload prompt; alert on rate, not on individual events.'],
        ['`Script error.` with no stack', 'Cross-origin script with no CORS headers.', 'CDN-served bundle missing `Access-Control-Allow-Origin`, or a missing `crossorigin` attribute.', 'Fix the header and the attribute. Until then these events carry no information at all.'],
        ['Unhandled promise rejection', 'Rejected promise with no `catch`.', 'A `fetch` failure path nobody wrote a handler for.', 'Register an `unhandledrejection` listener; `window.onerror` never sees these.'],
        ['`ResizeObserver loop completed`', 'Browser layout notification.', 'Usually benign, occasionally a real render loop.', 'Filter as noise but keep a count; a sudden spike is genuine.'],
        ['Errors only from one extension-heavy cohort', 'Extension injecting or rewriting script.', 'Not your bug, but it is your user\'s experience.', 'Detect and group rather than chase; only act if a real user journey is broken.'],
        ['A spike confined to one release and one browser', 'A genuine regression.', 'An API used without checking support, or a polyfill dropped by a dependency bump.', 'This is your rollback signal. It should be a dashboard, not an archaeology exercise.']
      ]
    },

    { t: 'h', text: 'Sampling that survives a cost review' },
    {
      t: 'prose',
      md: `Collecting everything from every session is the default, and it is what produces the
meeting where someone asks why frontend telemetry costs more than your database. Sampling is not a
compromise you make reluctantly; it is a design decision with arithmetic behind it, and you should
be able to do that arithmetic out loud.

Work an example. Ten million sessions a month. A full RUM payload with vitals, attribution,
navigation timing and a resource entry per request is roughly 8 kB. Unsampled that is 80 GB a month
of ingest, and at typical ingest-plus-retention pricing in the region of one to two dollars per
gigabyte you are looking at 80-160 thousand dollars a year for performance data alone, before error
events or session replay.

Now consider what precision you actually need. You care about p75 LCP per route per device class.
The standard error on a percentile falls with the square root of the sample size, so estimating p75
to within roughly one percentage point needs on the order of a few thousand samples per bucket, not
a million. At 10% sampling, a route with 100,000 monthly sessions still yields 10,000 samples --
comfortably enough -- and your bill drops by 90%. That is the argument: state the precision
requirement, derive the sample size, and sample to it.`
    },
    {
      t: 'table',
      title: 'Sampling strategy by signal type',
      cols: ['Signal', 'Rate', 'Why that rate'],
      rows: [
        ['Core Web Vitals', '**5-10% of sessions**', 'You need a percentile per cohort, and percentiles converge fast. Sample by *session*, not by event, or you bias toward long sessions.'],
        ['Errors', '**100%, then deduplicate**', 'A rare error is exactly the one you need. Never sample away novelty -- instead group by fingerprint and store one full instance per group per window with a count.'],
        ['Resource timing', '**1-2%**', 'Highest-volume, lowest-value-per-event signal. A few percent shows you a slow third party just as clearly.'],
        ['Custom business metrics', '**100%**', 'These are usually low volume and high value -- checkout completions, search-to-result times. Sampling revenue signals to save a few hundred dollars is a bad trade.'],
        ['Session replay', '**0.1-1%, plus 100% of error sessions**', 'By far the most expensive signal per session. Bias the sample toward sessions that had an error or a poor INP, and be explicit that you cannot replay an arbitrary complaint.'],
        ['Long tasks and profiles', '**0.5-1%**', 'Very high volume and only useful in aggregate. A profile from 1% of sessions on a slow cohort is plenty to find the offending function.']
      ]
    },
    {
      t: 'prose',
      md: `Two implementation rules. Sample **deterministically per session** -- hash the session id
and compare against a threshold -- so a sampled session sends all of its events rather than a random
subset, which keeps a trace coherent and lets you reconstruct what happened. And record the
effective rate with each batch so you can scale counts correctly; a count from a 10% sample
reported as an absolute number will mislead someone during an incident.

Finally, keep the sample rate a remotely-controllable value rather than a build constant. When you
are debugging a live incident you want to raise it to 100% for one route for twenty minutes, and
you do not want that to require a deploy.`
    },

    { t: 'h', text: 'Session replay and its obligations' },
    {
      t: 'prose',
      md: `Session replay reconstructs what a user saw by recording DOM mutations and input events,
then replaying them. For diagnosing "the button does nothing" it is genuinely without substitute --
you see the actual sequence, on the actual device, with the actual data.

It is also the highest-risk thing your frontend does with user data, and treating it as just another
vendor script is how teams end up in a regulatory conversation. A DOM recorder captures everything
rendered, which on your pages includes names, addresses, account balances, medical information and
whatever a user typed into a free-text field before deleting it.

Masking must be **default-deny**. Configure the recorder to mask all text and all inputs, then
explicitly unmask the specific elements you need, rather than starting open and adding exclusions.
The allowlist survives a new feature shipping; a denylist does not, because the engineer adding a
field next quarter will not know your exclusion list exists. Never record password, card-number or
one-time-code fields at all -- exclude the element, do not merely mask its value. And remember that
masking is client-side, so a misconfiguration means the sensitive data has already left the device
and is in your vendor's storage.

Beyond masking: have a lawful basis and honour consent before the recorder starts, not after; set a
short retention window, typically 30 days rather than a year, since a replay's value decays in days;
restrict who can view replays and log those views, because the audit trail is what makes the control
real; and make sure a deletion request actually deletes replays, which means knowing how to find
every replay for a user id in your vendor's system before someone asks.`
    },

    { t: 'h', text: 'Tracing from the browser into the backend' },
    {
      t: 'prose',
      md: `The most common debugging dead end in a distributed system is a frontend engineer saying
"the request took 4 seconds" and a backend engineer replying "our p99 is 200 ms". Both are telling
the truth about different windows. Only an end-to-end trace resolves it.

The mechanism is the W3C Trace Context standard. The browser generates a trace id and a span id for
a fetch and sends them in a \`traceparent\` header; the backend continues that trace rather than
starting a new one. The header format is four hyphen-separated fields: version, a 32-hex-character
trace id, a 16-hex-character parent span id, and trace flags where the low bit is the sampled flag.

Two practical requirements. \`traceparent\` is not a CORS-safelisted header, so any cross-origin API
must include it in \`Access-Control-Allow-Headers\` or the preflight fails and your fetch breaks --
a very common first attempt. And the sampling decision should be made in the browser and propagated
via the flags, so a sampled frontend request is guaranteed to have backend spans; deciding
independently at each tier gives you traces with holes exactly where you needed them.

What the trace buys you is the time nobody instruments: queueing in the browser behind other
requests, DNS and connection setup, request body upload on a slow uplink, and the gap between
response arrival and the pixel changing. Those four together are frequently larger than the entire
server span, which is precisely why the two teams disagreed.`
    },
    {
      t: 'diagram',
      code: `sequenceDiagram
  participant B as Browser span
  participant CDN as CDN edge
  participant BFF as BFF
  participant S as Service
  B->>CDN: fetch with traceparent<br/>00-4bf9...-00f0...-01
  Note over B: queue, DNS, TLS,<br/>request upload
  CDN->>BFF: same trace id,<br/>new span id
  BFF->>S: child span
  S-->>BFF: 180 ms
  BFF-->>B: 240 ms
  Note over B: parse, state update,<br/>render to pixels
  Note over B,S: user felt 3.9 s<br/>server span was 240 ms`,
      caption: 'The server span is often the smallest part of what the user experienced. Without propagation you cannot prove where the rest went.'
    },

    { t: 'h', text: 'Alerting on cohorts, and a dashboard someone opens' },
    {
      t: 'prose',
      md: `Global averages are where frontend regressions go to hide. If 8% of your users are on
Android in one country and their LCP triples, the global mean moves by a fraction of a second and
crosses no threshold. A useful alerting scheme is therefore defined on **percentiles, per cohort**,
and the cohorts that earn their keep are route pattern, device class, country or region, browser
family with major version, and release.

That is a lot of dimensions, and alerting on every combination gives you noise instead of signal.
Two things keep it manageable. Alert on *change* rather than on absolute thresholds -- a 30% shift
in p75 for a cohort over its own trailing baseline -- since an absolute threshold either pages
constantly for a genuinely slow cohort or never fires for a fast one. And require a minimum sample
size per window, or a cohort with 40 sessions will page you every night on statistical noise. Then
severity by business impact: a p75 INP regression on your checkout route pages someone; the same
regression on your marketing blog opens a ticket.

The dashboard question is a good interview question in disguise, because most dashboards are built
to look comprehensive and are useless at 3 a.m. The test is whether someone can answer, in under
sixty seconds, *is something broken, when did it start, who is affected, and what changed?* That
implies four things on one screen: error rate and p75 vitals overlaid with **deploy markers**, so
correlation with a release is visual rather than inferred; a breakdown by the cohorts above so
"who is affected" is one click; the top error groups by affected-session count, ordered by users
rather than by event volume so one loop does not dominate; and current release adoption, because
"is the bad version still serving traffic" is the first thing you need after deciding to roll back.

Ordering error groups by affected sessions rather than raw count is a small detail that changes
behaviour a lot: a single user hitting a retry loop 4,000 times will otherwise sit at the top of
your list all week while a bug affecting 900 people sits below it.`
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      gains: [
        'You find out about broken experiences from data rather than from support tickets.',
        'Regressions are attributable to a release and a cohort, so rollback becomes a decision rather than a debate.',
        'Vitals attribution turns "LCP is bad" into a specific element and phase to fix.',
        'End-to-end traces settle frontend-versus-backend disputes with one query.',
        'Automated canary analysis becomes possible, because the rollback signal exists.',
        'Performance work can be tied to conversion, which is how it gets funded.'
      ],
      costs: [
        'The RUM agent itself costs bytes and main-thread time -- keep it under roughly 15 kB and initialise it lazily.',
        'Ingest and retention costs scale with traffic and need active management.',
        'Cardinality mistakes cause bill surprises that look like nothing changed.',
        'Session replay creates real privacy, consent and retention obligations.',
        'Sampling means some individual complaints are genuinely unanswerable.',
        'Alert tuning is ongoing work, and a noisy alert is worse than no alert.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'Metrics reported on load rather than at page hide', blast: 'CLS systematically understated and INP missing its worst interaction; the dashboard says you are fine.', fix: '`sendBeacon` on `visibilitychange` to hidden, plus `pagehide` for the back/forward cache path.' },
        { mode: 'Unbounded route cardinality', blast: 'Telemetry bill triples; dashboards time out; queries become unusable.', fix: 'Normalise to route patterns at collection time; keep raw URLs as unindexed attributes only.' },
        { mode: 'Source maps not uploaded, or uploaded without a release id', blast: 'Every stack trace is minified, so triage is guesswork during an incident.', fix: 'Upload per release in CI, key by build SHA, verify resolution in staging, and do not serve maps publicly.' },
        { mode: 'No `unhandledrejection` handler', blast: 'A large share of async failures are never recorded; the app looks healthier than it is.', fix: 'Register both `error` and `unhandledrejection`; assert both paths report in a smoke test.' },
        { mode: 'Alerting on global averages', blast: 'A severe regression for 8% of users never crosses a threshold and ships unnoticed.', fix: 'Percentiles per cohort, alerting on change against a trailing baseline with a minimum sample size.' },
        { mode: 'Session replay with a masking denylist', blast: 'A new field ships and personal data flows to a third-party vendor -- a reportable incident.', fix: 'Default-deny masking with an explicit unmask allowlist; exclude credential fields entirely; short retention and access logging.' },
        { mode: '`traceparent` missing from `Access-Control-Allow-Headers`', blast: 'Preflight fails and real API calls break in production while working locally on the same origin.', fix: 'Allow the header explicitly; test propagation cross-origin in CI, not only same-origin.' },
        { mode: 'Error groups ranked by event count', blast: 'One user\'s retry loop dominates the list while a bug affecting 900 people sits below the fold.', fix: 'Rank by affected sessions or users; cap per-session event counts at the client.' }
      ]
    },

    {
      t: 'staff',
      md: `Most candidates name tools. The Staff-level answer knows the cost model, the privacy
obligations, and what makes a signal actionable rather than merely present.

- "Every event carries the build SHA, so the query I care about is error rate and p75 vitals per
  release. That is what turns a rollback from an argument into a decision, and it is the signal an
  automated canary reads."
- "I report at \`visibilitychange\` to hidden with \`sendBeacon\`, not on \`unload\`. On mobile a tab
  can be discarded without \`unload\` ever firing, and CLS and INP are only final at page hide
  anyway -- reporting CLS on load gives you a number that is wrong in a flattering direction."
- "On sampling I would work the arithmetic. Ten million sessions at 8 kB is 80 GB a month, which is
  six figures a year at typical pricing. I need p75 per route per device class, and a few thousand
  samples per bucket gets that within about a point, so 10% session sampling is plenty. Errors stay
  at 100% and get deduplicated by fingerprint, because a rare error is the one I need."
- "Route patterns, not raw URLs. Cardinality is the usual reason a telemetry bill triples when
  nothing shipped."
- "Alerts are on percentiles per cohort -- route, device class, region, browser major, release --
  against a trailing baseline with a minimum sample size. A global average hides a tripling for 8%
  of users, and an absolute threshold either pages nightly or never fires."
- "Session replay is masked default-deny with an explicit unmask allowlist, because a denylist does
  not survive the next feature. Credential fields are excluded entirely, retention is 30 days, and
  replay access is logged."
- "For frontend-versus-backend latency arguments I propagate \`traceparent\` and make the sampling
  decision in the browser. And I add \`traceparent\` to \`Access-Control-Allow-Headers\`, because
  otherwise the preflight fails in production while everything works locally on one origin."
- "The dashboard test is whether someone answers four questions in a minute at 3 a.m.: is it broken,
  when did it start, who is affected, what changed? That means deploy markers on every chart and
  error groups ranked by affected sessions, not by event count."

Doing the sampling arithmetic unprompted, naming cardinality as a cost driver, and treating replay
masking as default-deny are the three things that most reliably separate someone who has operated
this from someone who has configured it.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'Your dashboard shows p75 CLS of 0.04 -- comfortably good -- but users complain about content jumping. What is the most likely instrumentation bug?',
          options: [
            'CLS is being sampled too aggressively.',
            'CLS is reported shortly after load, so shifts from lazy content, ads and late fonts are never counted.',
            'CLS does not apply to single-page applications.',
            'The p75 should be a p95.'
          ],
          answer: 1,
          why: 'CLS accumulates over the whole page lifetime, and the shifts users notice usually come later -- a lazy-loaded image, an ad slot, a font swap, a banner appearing after hydration. Reporting on load or after a fixed delay captures only the earliest window and produces a flatteringly low number. Report at `visibilitychange` to hidden with `pagehide` as a backstop, which is the same requirement INP has since it is the worst interaction of the session.'
        },
        {
          q: 'Finance asks you to cut a 90,000-dollar-a-year frontend telemetry bill. Which change gives the largest saving with the least loss of signal?',
          options: [
            'Sample errors at 10%.',
            'Sample vitals and resource timing per session, keep errors at 100% with fingerprint deduplication, and cut replay to 1% biased toward error sessions.',
            'Reduce retention to seven days for everything.',
            'Stop collecting INP.'
          ],
          answer: 1,
          why: 'Volume lives in vitals, resource timing and replay, and percentiles converge with a few thousand samples per cohort, so 10% session sampling costs you almost nothing analytically. Errors are the opposite: low volume, high value, and novelty is the point -- sampling them at 10% means a bug affecting 50 users may produce five events and never reach an alert threshold. Deduplicating by fingerprint gets the cost reduction without discarding rare events.'
        },
        {
          q: 'A release ships. Global p75 LCP is unchanged, but support reports slow loads. Which analysis finds it fastest?',
          options: [
            'Run Lighthouse against production.',
            'Break p75 LCP down by route, device class, country and browser major, compared against the pre-release baseline.',
            'Look at the p99 globally.',
            'Check backend p99 latency.'
          ],
          answer: 1,
          why: 'A regression confined to a cohort -- one browser version, one device class, one region -- moves a global percentile by an amount well inside normal variance. Cohort breakdown against the same cohort\'s own baseline is what surfaces it, which is why those dimensions belong on every event at collection time. Lighthouse reproduces one synthetic device and will almost certainly look fine; a global p99 mixes every cohort\'s tail together and tells you nothing about which one moved.'
        },
        {
          q: 'You add `traceparent` to fetches against `api.acme.com`. Requests that worked now fail in production, though local development is fine. Why?',
          options: [
            'The trace id format is invalid.',
            'It is not a CORS-safelisted header, so the cross-origin preflight fails unless the server lists it in `Access-Control-Allow-Headers`.',
            'Browsers block `traceparent` from page script.',
            'Sampling flags must be set server-side.'
          ],
          answer: 1,
          why: 'Adding any non-safelisted header turns a simple request into a preflighted one, and the preflight fails unless the server explicitly allows that header name. Local development is same-origin, so no preflight happens and the problem is invisible until deploy. The general lesson is to test cross-origin request behaviour in CI rather than relying on a same-origin dev setup, since this failure shape recurs with every custom header you add.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `The metrics themselves, their thresholds and how to move them are in **Performance
Engineering** -- this topic is about collecting them honestly. Release-tagged error rates are the
automated rollback signal in **Deployment, Rollout & Migration**, and \`ChunkLoadError\` is that
topic's asset-retention failure showing up in your error tracker. Attributing a page-level
regression to one team's remote is why every event needs a feature and version dimension in
**Microfrontends**, and CSP violation reports are a **Frontend Security** signal that only works if
someone is watching this pipeline.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why report metrics on `visibilitychange` rather than `unload`?', a: '`unload` is unreliable and never fires when a mobile tab is discarded, while `visibilitychange` to hidden always does. `sendBeacon` there survives page teardown, and CLS and INP are only final at page hide anyway.' },
    { q: 'What does web-vitals attribution add?', a: 'It decomposes a metric into actionable parts -- which element was the LCP candidate, and how the time split between time-to-first-byte, resource load delay, load time and render delay -- turning "LCP is 3.8 s" into a specific thing to fix.' },
    { q: 'Why normalise route patterns before sending telemetry?', a: 'Raw URLs with ids create unbounded cardinality, which is the usual cause of a telemetry bill tripling with no feature shipped, and it makes dashboards slow or unusable. Keep the raw URL as an unindexed attribute.' },
    { q: 'Why is the release identifier the most valuable field on an event?', a: 'It enables error rate and p75 vitals per release, which is what turns a rollback decision from a debate into evidence -- and it is the signal automated canary analysis reads.' },
    { q: 'Sensible sampling rates by signal?', a: 'Vitals 5-10% of sessions; errors 100% with fingerprint deduplication; resource timing 1-2%; custom business metrics 100%; session replay 0.1-1% biased toward error sessions; long tasks and profiles around 1%.' },
    { q: 'Why sample deterministically per session?', a: 'So a sampled session sends all of its events and the story is coherent. Per-event sampling gives you fragments, and sampling by event rather than session biases toward long sessions.' },
    { q: 'Why must session-replay masking be default-deny?', a: 'A denylist does not survive the next feature -- the engineer adding a field will not know it exists. Mask everything and explicitly unmask what you need; exclude credential and card fields entirely rather than masking them.' },
    { q: 'What does `traceparent` carry and what breaks when you add it?', a: 'Version, a 32-hex trace id, a 16-hex parent span id, and flags whose low bit is the sampled flag. It is not CORS-safelisted, so cross-origin calls need it in `Access-Control-Allow-Headers` or the preflight fails.' },
    { q: 'Why alert on percentiles per cohort instead of global averages?', a: 'A tripling of LCP for 8% of users barely moves a global mean and crosses no threshold. Alert on change against each cohort\'s own trailing baseline, with a minimum sample size so small cohorts do not page you on noise.' }
  ],

  drills: [
    {
      prompt: 'You join a team with 12 million monthly sessions, no frontend observability, and a recurring complaint that "the app is slow for some users" that nobody has been able to reproduce in six months. You have a 40,000-dollar annual budget. Design the system and tell me what you would find first.',
      probes: [
        'What do you instrument in week one versus month three?',
        'Justify your sampling rates with arithmetic.',
        'How does this data lead to a rollback decision?',
        'What do you deliberately not collect, and why?'
      ],
      strong: [
        'Starts with errors at 100% plus release tagging and source maps, because unknown breakage outranks unknown slowness and it is cheap.',
        'Adds vitals with attribution at 5-10% session sampling and shows the arithmetic: payload size times sessions times price, against the sample size needed for a stable p75 per cohort.',
        'Puts route pattern, device class, connection type, browser major, region and release on every event from day one, and normalises route patterns at collection.',
        'Reports at `visibilitychange` with `sendBeacon`, and notes CLS and INP are only final at page hide.',
        'Defines the rollback signal concretely: error rate or p75 per cohort per release against the previous release, with deploy markers on the dashboard.',
        'Defers session replay, or scopes it to 0.1% biased toward error sessions, citing both cost and privacy obligations.',
        'Predicts what the data will show -- a slow cohort on low-end Android or a specific region -- and explains why a global average hid it.'
      ],
      weak: [
        'Buys a vendor and enables everything at 100%.',
        'Samples errors to save money.',
        'Sends raw URLs as a grouping dimension.',
        'No release tagging, so nothing correlates with a deploy.',
        'Alerts on global averages and thresholds.',
        'Enables session replay with default masking and no retention or consent plan.'
      ]
    },
    {
      prompt: 'Support escalates that checkout is broken for a small number of users. Your error dashboard is clean, p75 vitals are normal, and you cannot reproduce it. Walk me through the investigation, and then what you change so the next one is not invisible.',
      probes: [
        'What are the plausible reasons the dashboard is clean while users are broken?',
        'What would you raise, temporarily, to see more?',
        'How do you tie a UI failure to a user complaint after the fact?',
        'What permanent instrumentation would have caught it?'
      ],
      strong: [
        'Enumerates the instrumentation blind spots: no `unhandledrejection` handler, cross-origin `Script error.` with no stack, sampled-away events, errors swallowed by a `catch` that only logs locally, and a failure that produces no exception at all -- a 200 response with an unexpected body.',
        'Raises the sample rate to 100% for the checkout route via remote config rather than a deploy, and confirms the rate is runtime-controllable.',
        'Adds funnel-step business metrics so a drop in step completion is visible even with zero errors, which is the signal that actually catches silent failures.',
        'Uses cohort breakdown -- browser major, device class, region, release -- rather than a global view, and checks error groups ranked by affected sessions.',
        'Correlates a specific complaint by session id, acknowledging honestly that a sampled session may simply not have been recorded.',
        'Permanently adds `unhandledrejection`, CORS headers plus `crossorigin` so cross-origin errors carry stacks, and an alert on funnel-step conversion per cohort.'
      ],
      weak: [
        'Concludes the users must be wrong because the dashboard is clean.',
        'No mechanism to raise sampling without a deploy.',
        'Relies only on error counts and never considers a failure with no exception.',
        'No business or funnel metrics, so a silent failure is undetectable by construction.',
        'Investigates using global aggregates throughout.'
      ]
    }
  ]
};
