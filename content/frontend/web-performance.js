export default {
  blocks: [
    {
      t: 'prose',
      md: `Performance engineering is the practice of deciding what "fast enough" means, measuring
whether you are there for real users rather than for yourself, and building a mechanism that
stops you drifting back.

That last part is what separates it from optimisation work. Anyone can make a page faster for a
week. The difficulty is that performance is a **commons** -- every team adds a script, a
dependency, an image, a tracking pixel, and each addition is individually defensible while the
sum is a four-second load. Without a budget that fails a build and a metric that reflects real
devices, you will re-do the same optimisation project every eighteen months.`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `For a long time the industry measured the wrong things. \`window.onload\` was the headline
number, and it was nearly useless: it fires after every image finishes, which has almost nothing
to do with whether a user can read or use the page. Teams optimised a metric that did not
correspond to experience, and "it feels slow" remained unanswerable.

Core Web Vitals exist to fix that by measuring three distinct user perceptions rather than
technical milestones. **Is it there?** -- Largest Contentful Paint, when the main content
appeared. **Is it stable?** -- Cumulative Layout Shift, whether things moved under the user's
finger. **Does it respond?** -- Interaction to Next Paint, how long from a tap to a visible
result. Those are the three complaints real users have, and each maps to a different engineering
cause.

The second reason this discipline exists is commercial. Performance work competes for roadmap
space against features, and "it should be faster" loses that argument. A number with money
attached wins it.`
    },

    { t: 'h', text: 'The metrics, with current thresholds' },
    {
      t: 'table',
      title: 'Core Web Vitals, measured at p75 across all page loads',
      cols: ['Metric', 'Good', 'Needs improvement', 'Poor', 'What it actually measures', 'Dominant cause'],
      rows: [
        ['**LCP**', '≤ 2.5 s', '2.5-4.0 s', '> 4.0 s', 'Render time of the largest text block or image in the viewport', 'TTFB, then resource load delay -- usually a late-discovered hero image'],
        ['**CLS**', '≤ 0.1', '0.1-0.25', '> 0.25', 'Sum of the worst session windows of unexpected layout shift', 'Images without dimensions, injected banners, web font swap'],
        ['**INP**', '≤ 200 ms', '200-500 ms', '> 500 ms', 'Input to next paint, for essentially the worst interaction on the page', 'Long tasks: hydration, heavy handlers, third-party scripts'],
        ['TTFB', '≤ 800 ms', '0.8-1.8 s', '> 1.8 s', 'Request start to first response byte', 'Round trips plus server think time'],
        ['FCP', '≤ 1.8 s', '1.8-3.0 s', '> 3.0 s', 'First pixel of any content', 'Render-blocking CSS and synchronous scripts'],
        ['TBT (lab only)', '≤ 200 ms', '200-600 ms', '> 600 ms', 'Total blocking time above 50 ms per task during load', 'The lab proxy for INP -- use it in CI where INP is unavailable']
      ]
    },
    {
      t: 'prose',
      md: `Three details about these metrics that are routinely misunderstood and that an
interviewer may well probe.

**p75, not average.** The threshold is evaluated at the 75th percentile of page loads, which
means one in four users may be worse and you still pass. Averages hide the tail entirely: a
bimodal distribution of fast desktop and slow mobile traffic can average to a comfortable 2.2 s
while 40% of users are above 4 s.

**INP replaced FID in March 2024**, and it is a much harder metric. FID measured only the *input
delay* of the *first* interaction -- essentially queueing time -- so a page could score well while
every interaction took a second to produce a result. INP measures the full duration from input to
the next painted frame, and reports approximately the worst interaction of the session. Most sites
that were green on FID were not green on INP, and the reason is that FID never measured the
handler or the rendering that followed it.

**CLS is windowed.** It is not a total for the page; it is the largest sum within any
five-second session window, capped at one second between shifts. This matters because it means
an infinite-scroll page is not automatically doomed, but a single badly-timed banner injection
can dominate your score.`
    },

    { t: 'h', text: 'RUM vs lab, and why they disagree' },
    {
      t: 'prose',
      md: `Lab measurement -- Lighthouse, WebPageTest, a CI run -- is a synthetic load on fixed
hardware with a fixed network profile. It is reproducible, which makes it the right tool for
catching regressions and for comparing two commits. Real User Monitoring collects the same
metrics from actual sessions via the \`web-vitals\` library and the Performance Observer APIs. It
is the ground truth for what users experience and it is not reproducible at all.

They disagree constantly, and every reason is instructive rather than a measurement bug.

**Device distribution.** Lighthouse's mobile preset emulates a specific mid-tier device. Your
actual traffic is a long tail from flagships to five-year-old Androids, and CPU-bound metrics
like INP and TBT vary by a factor of five across it.

**Cache state.** Lab runs are always cold. A large share of your real traffic is a repeat visit
with a warm HTTP cache and a resumed TLS connection, so real LCP is often *better* than lab.

**Network reality.** Lighthouse throttles to a clean simulated profile. Real mobile networks have
packet loss, variable RTT, and the radio promotion cost of 100-500 ms that no lab profile models.

**Interaction patterns.** Lab tools do not click anything, so they cannot measure INP at all --
only TBT as a proxy. And real users interact in ways you did not script, which is exactly where
the worst interaction hides.

**Geography and bots.** Lab runs from one region; users are everywhere. And unfiltered RUM
includes bots, synthetic checks and headless browsers that distort percentiles.

The correct posture is to use both for what each is good at: **lab in CI to catch regressions
per commit, RUM to decide what to work on and whether it worked.** Optimising the number your
laptop reports is the classic failure, and the corollary is that you should never accept a local
Lighthouse score as evidence that a change helped real users.`
    },
    {
      t: 'diagram',
      code: `flowchart TB
  L["Lab: Lighthouse in CI"] --> LR["Reproducible<br/>one cold load<br/>emulated device<br/>never interacts"]
  LR --> G["Use for: regression gate<br/>per commit"]
  F["Field: RUM via web-vitals"] --> FR["Real devices<br/>warm and cold caches<br/>lossy networks<br/>real interactions"]
  FR --> D["Use for: what to work on<br/>and whether it worked"]
  D --> S["Segment by device class<br/>and country"]
  S --> A["Attribution:<br/>which element, which phase"]
  A --> W["Fix the named cause"]
  G --> W`,
      caption: 'Lab and field answer different questions. Gating on lab and deciding on field is the only combination that works; swapping them is the classic failure.'
    },
    {
      t: 'table',
      title: 'Field data segmented -- the table that changes priorities',
      cols: ['Segment', 'Share of sessions', 'p75 LCP', 'p75 INP', 'What it tells you'],
      rows: [
        ['Desktop, North America', '31%', '1.4 s', '90 ms', 'Comfortably green. This is what your team sees daily.'],
        ['iOS, North America', '22%', '1.9 s', '120 ms', 'Green. Good hardware and good networks.'],
        ['Android flagship, Europe', '14%', '2.3 s', '210 ms', 'LCP passing, INP already at the boundary.'],
        ['Android mid-tier, India', '19%', '4.6 s', '580 ms', '**Failing both.** A fifth of sessions, and invisible in any average.'],
        ['Android mid-tier, Brazil', '9%', '4.1 s', '520 ms', 'Failing both. Same cause as above.'],
        ['Aggregate p75', '100%', '2.6 s', '240 ms', 'Marginal -- which is why aggregates make you complacent.']
      ]
    },
    {
      t: 'note',
      tone: 'warn',
      title: 'The aggregate is the least useful number you have',
      md: `Read the table above: the aggregate p75 LCP of 2.6 s is a rounding error away from
passing, and it implies the work needed is small. Segmented, 28% of sessions are at 4+ seconds
and failing badly, and the cause is concentrated -- CPU-bound work on mid-tier Android plus
latency to a distant origin.

Those two views lead to completely different quarters of work. Always segment by **device class
and country** before deciding what to fix, and set your targets per segment. Otherwise you will
optimise for the users who already have a good experience, because they are the majority and they
are also the people writing the code.`
    },

    { t: 'h', text: 'Budgets enforced in CI' },
    {
      t: 'prose',
      md: `A performance budget is only a budget if exceeding it blocks something. A dashboard
nobody is accountable to is a decoration.

The mechanism that works is two-layered. **Bundle size checks** run on every pull request, are
fast and deterministic, and fail the build -- these catch the "I added a 200 KB dependency" case
immediately, in the review where it is cheapest to fix. **Lighthouse CI against a preview
deployment** catches the composite effects that size alone cannot see: a render-blocking
stylesheet, a late-discovered LCP image, a regression in TBT.

Two practical notes. Use *median of several runs* for lab metrics, because a single Lighthouse
run has enough variance to produce false failures and a flaky gate gets disabled within a month.
And give the check an explicit override path with a named approver, because an unoverridable gate
during an incident gets removed permanently rather than temporarily.`
    },
    {
      t: 'code',
      lang: 'json',
      title: 'A budget configuration that actually blocks a merge',
      code: `// size-limit: runs in seconds on every PR, deterministic, no flake.
// package.json
{
  "size-limit": [
    { "name": "entry (main)",  "path": "dist/main.*.js",   "limit": "170 kB" },
    { "name": "framework",     "path": "dist/vendor.*.js",  "limit": "120 kB" },
    { "name": "critical css",  "path": "dist/main.*.css",   "limit": "14 kB"  }
  ],
  "scripts": { "size": "size-limit --json" }
}

// lighthouserc.json: runs against a preview deploy. Median of 5 runs
// because a single run has enough variance to cause false failures.
{
  "ci": {
    "collect": {
      "numberOfRuns": 5,
      "settings": { "preset": "desktop", "throttlingMethod": "simulate" }
    },
    "assert": {
      "assertions": {
        "largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
        "total-blocking-time":      ["error", { "maxNumericValue": 300  }],
        "cumulative-layout-shift":  ["error", { "maxNumericValue": 0.1  }],
        "first-contentful-paint":   ["warn",  { "maxNumericValue": 1800 }],
        "resource-summary:script:size":
          ["error", { "maxNumericValue": 350000 }],
        "resource-summary:third-party:count":
          ["error", { "maxNumericValue": 8 }],
        "unused-javascript": ["warn", { "maxLength": 1 }]
      }
    },
    "upload": { "target": "temporary-public-storage" }
  }
}

// The 14 kB CSS limit is not arbitrary: it is roughly the first TCP
// congestion window, so critical CSS above it costs an extra round trip.`
    },
    {
      t: 'code',
      lang: 'js',
      title: 'RUM collection with the attribution you will actually need',
      code: `import { onLCP, onCLS, onINP, onTTFB } from 'web-vitals/attribution';

// Segment at collection time. Without these dimensions the data
// cannot answer "who is slow", which is the only useful question.
const dims = {
  release: __BUILD_SHA__,
  route: matchedRoutePattern(),      // pattern, not the raw URL
  deviceMemory: navigator.deviceMemory,   // 0.25-8, a decent proxy
  cores: navigator.hardwareConcurrency,
  effectiveType: navigator.connection?.effectiveType, // 4g, 3g, slow-2g
  saveData: navigator.connection?.saveData === true
};

function report(metric) {
  navigator.sendBeacon('/rum', JSON.stringify({
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    // Attribution is the difference between a number and a diagnosis.
    // LCP: element selector + the four sub-parts.
    // INP: the event target, plus input delay / processing / presentation.
    // CLS: the largest shift source element.
    attribution: metric.attribution,
    ...dims
  }));
}

// Report all changes so a late interaction is not missed.
onLCP(report); onCLS(report); onINP(report, { reportAllChanges: true });
onTTFB(report);`
    },
    {
      t: 'prose',
      md: `The attribution field is what makes RUM actionable rather than merely alarming. A
dashboard saying "p75 INP is 480 ms" tells you there is a problem. Attribution tells you the
interaction was a click on \`button.add-to-cart\`, that 340 ms of it was input delay -- meaning the
main thread was already busy before your handler ran -- and that the processing time was only
40 ms. Those two readings lead to completely different fixes: the first says find the long task
blocking the thread, the second says optimise the handler. Without attribution you will guess,
and you will usually guess the handler.

The same applies to LCP, which decomposes into four parts: TTFB, resource load delay (how long
before the browser even *started* fetching the LCP resource), resource load duration, and
element render delay. In practice the largest slice is very often load *delay* -- the image was
discovered late because it was referenced from CSS, or injected by JavaScript, or lazy-loaded
when it was in fact above the fold. That is a preload or a \`fetchpriority\` fix, not a compression
fix, and you cannot tell without the breakdown.`
    },

    { t: 'h', text: 'Images and fonts: the two biggest levers' },
    {
      t: 'prose',
      md: `The LCP element is an image on the large majority of pages, so image strategy *is* LCP
strategy. Five things, in rough order of impact.

**Format.** AVIF is typically 50% smaller than JPEG at comparable quality and WebP around 30%,
with a \`<picture>\` element providing fallbacks. AVIF's cost is encode time, which matters for a
build pipeline but not for delivery.

**Responsive sizing.** \`srcset\` with \`sizes\` lets the browser pick a width appropriate to the
layout and device pixel ratio. Getting \`sizes\` wrong is the most common error here and it is
silent -- the browser downloads a 1600 px image for a 400 px slot and nothing warns you.

**Priority and discovery.** Any image that is or might be the LCP element needs to be discovered
early and fetched at high priority: \`fetchpriority="high"\`, and \`loading="eager"\` rather than
lazy. The single most common LCP bug in the wild is a lazy-loaded hero image, because the
browser deliberately defers it and you have added hundreds of milliseconds to your most important
metric. Lazy-load below the fold only.

**Reserved space.** Explicit \`width\` and \`height\` attributes, or a CSS \`aspect-ratio\`, let the
browser allocate the box before the bytes arrive. Without them every image is a layout shift.

**Placeholders.** A low-quality image placeholder or a dominant-colour block improves perceived
performance, but note honestly that an inlined LQIP counts toward your HTML size and a *large*
placeholder can itself become the LCP element -- which makes the metric look good while the user
still waits for the real image.`
    },
    {
      t: 'prose',
      md: `**Fonts** produce two distinct failure modes and the CSS property \`font-display\` picks
which one you get. **FOIT** (flash of invisible text) is \`font-display: block\`: text is invisible
for up to three seconds while the font loads, which can delay LCP entirely because there is no
text to paint. **FOUT** (flash of unstyled text) is \`font-display: swap\`: text renders
immediately in the fallback and re-renders when the webfont arrives, which protects LCP but
causes a layout shift when the metrics differ.

\`swap\` is the right default because invisible text is worse than restyled text, and the shift is
then a solvable problem. You solve it with \`size-adjust\`, \`ascent-override\` and
\`descent-override\` on a \`@font-face\` fallback declaration, tuning the fallback's metrics to match
the webfont so the swap causes little or no reflow. Beyond that: self-host rather than using a
third-party font CDN (which costs a whole DNS + TCP + TLS setup, and third-party caching no longer
helps since browsers partitioned their HTTP caches by top-level site), preload only the one or two
faces used above the fold, subset to the characters you actually need, and prefer a single
variable font over four static weights.`
    },
    {
      t: 'code',
      lang: 'html',
      title: 'The LCP image and the font, done properly',
      code: `<!-- Discovered in the initial HTML, fetched at high priority,
     never lazy, with space reserved so it cannot shift. -->
<link rel="preload" as="image" fetchpriority="high"
      href="/hero-1200.avif"
      imagesrcset="/hero-800.avif 800w, /hero-1200.avif 1200w"
      imagesizes="(max-width: 768px) 100vw, 1200px">

<picture>
  <source type="image/avif" srcset="/hero-800.avif 800w,
                                    /hero-1200.avif 1200w"
          sizes="(max-width: 768px) 100vw, 1200px">
  <img src="/hero-1200.jpg" alt="" width="1200" height="630"
       fetchpriority="high" loading="eager" decoding="async">
</picture>

<!-- Self-hosted, preloaded, one variable font instead of four weights. -->
<link rel="preload" href="/fonts/inter-var.woff2" as="font"
      type="font/woff2" crossorigin>

<!-- CSS: swap avoids invisible text; the adjusted fallback means the
     swap barely shifts anything, so CLS stays near zero.
  @font-face { font-family: Inter; src: url(/fonts/inter-var.woff2);
               font-display: swap; font-weight: 100 900; }
  @font-face { font-family: "Inter fallback"; src: local("Arial");
               size-adjust: 107%; ascent-override: 90%;
               descent-override: 22%; }
  body { font-family: Inter, "Inter fallback", sans-serif; } -->`
    },

    { t: 'h', text: 'Third-party script governance' },
    {
      t: 'prose',
      md: `Third-party scripts are frequently the largest single cost on a page and the one the
engineering team has least control over, because each was added by a different function of the
business for a reason that was individually sound. A tag manager, two analytics vendors, a
session-replay tool, a chat widget, an A/B testing script, a consent manager, and an ad tag is a
completely normal inventory -- and easily 600 KB of JavaScript executing on the main thread,
competing with your own code for the frame budget.

Governance, not heroics, is the answer, and it has three parts.

**Inventory and attribution.** You cannot manage what you cannot see. Long Animation Frames and
the \`PerformanceLongTaskTiming\` attribution let you attribute main-thread time to a script URL,
so "the chat widget costs us 180 ms of blocking time at p75" becomes a statement with a number
rather than a suspicion. That number is what lets you have the conversation with the team that
owns the vendor relationship.

**Loading discipline.** Nothing third-party is render-blocking. \`async\` at minimum, \`defer\` where
order matters, and load on interaction where the feature is interaction-triggered anyway -- a chat
widget does not need to exist until someone might click it, and deferring it to first interaction
or idle is usually invisible to users and worth a hundred-plus milliseconds. Consider moving
analytics into a worker (Partytown is the known implementation) with the honest caveat that it
breaks scripts needing synchronous DOM access, so it requires per-vendor testing.

**A budget with an owner.** Cap the count and the total transfer size of third-party scripts in
CI, and require that adding one means removing one or getting an explicit exception. The crucial
part is that the budget has a named owner who can say no, because otherwise every request is
approved individually and the sum is never anyone's problem.`
    },

    { t: 'h', text: 'Tying latency to money' },
    {
      t: 'prose',
      md: `Performance work needs a business case, and there are published figures you can cite --
provided you attribute them and represent their limits honestly. Quoting a number as universal
law when it came from one company's A/B test is the fastest way to lose credibility with a
skeptical stakeholder.

Vodafone reported an 8% increase in sales after improving LCP by 31%, published as a Google
web.dev case study. Rakuten 24 reported a 53.4% increase in revenue per visitor after bringing
Core Web Vitals into the good range. Deloitte's *Milliseconds Make Millions* study, commissioned
by Google, found that a 0.1 s improvement in mobile site speed corresponded to an 8.4% conversion
lift for retail and 10.1% for travel. Amazon's often-quoted "100 ms costs 1% of sales" comes from
a 2006 talk by Greg Linden and is frequently misattributed; Walmart and Google have published
directionally similar findings at various times.

Every one of those is a **correlation from a specific site with a specific audience**, and the
sites that ran those experiments also changed other things. The mature way to use them is as
evidence that the mechanism is real and worth testing, not as a forecast for your product.

The credible version is to measure it yourself. Segment your own funnel by LCP or INP bucket and
look at conversion per bucket. That is still correlational -- slow sessions correlate with old
devices, poor networks and less affluent users, all of which independently affect conversion --
so the strongest evidence available is a **deliberate holdback**: ship the optimisation to 90% of
traffic, keep 10% on the old path, and compare conversion. It costs you a little revenue on the
holdback and buys you a causal number, which is the only kind that survives a hostile review.`
    },
    {
      t: 'numbers',
      title: 'Published figures -- cite with their source, not as universal law',
      items: [
        { v: '+8%', k: 'Vodafone sales, from a 31% LCP improvement', note: 'web.dev case study' },
        { v: '+53.4%', k: 'Rakuten 24 revenue per visitor', note: 'After reaching good CWV' },
        { v: '+8.4%', k: 'Retail conversion per 0.1 s mobile speed gain', note: 'Deloitte, Milliseconds Make Millions' },
        { v: '+10.1%', k: 'Travel conversion per 0.1 s', note: 'Same Deloitte study' },
        { v: '-1%', k: 'Amazon sales per 100 ms', note: '2006 Greg Linden talk; widely misattributed' }
      ]
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      gains: [
        'Segmented RUM tells you which users are slow, so you work on the right thing.',
        'A CI budget converts a recurring optimisation project into a build failure caught in review.',
        'Attribution turns "INP is 480 ms" into a named element and a named phase.',
        'Correct image discovery and priority is often the single largest LCP win available.',
        'A holdback experiment gives you a causal revenue number instead of a correlation.'
      ],
      costs: [
        'RUM is an ongoing data-volume and cost commitment, so sampling policy becomes a real decision.',
        'Lab metrics are noisy, and a flaky gate gets disabled within a month unless you take the median.',
        'Budgets create friction with teams shipping features and need a named owner and an override path.',
        'Optimising the p75 can mean deliberately deprioritising the p99, which you should state explicitly.',
        'Holdbacks cost real money on the held-back traffic.',
        'Some wins -- an LQIP becoming the LCP element -- improve the metric without improving the experience.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'Optimising against aggregate p75', blast: 'Mid-tier Android in emerging markets fails badly at 4.6 s LCP while the aggregate reads 2.6 s; a quarter of users are invisible in the number that drives decisions.', fix: 'Segment RUM by device class and country, set per-segment targets, and review the worst segment rather than the aggregate.' },
        { mode: 'Lazy-loading the hero image', blast: 'LCP regresses several hundred milliseconds because the browser deliberately defers the most important resource on the page.', fix: '`loading="eager"` plus `fetchpriority="high"` plus a `preload` for anything that could be the LCP element. Lazy-load below the fold only.' },
        { mode: 'Green Lighthouse score, users complaining', blast: 'Engineering believes the problem is solved while real INP is 600 ms; trust in the performance programme erodes.', fix: 'Treat lab as a regression gate only. Never accept a local Lighthouse run as evidence about real users; INP cannot be measured in the lab at all.' },
        { mode: 'RUM collected without device, network, route or release dimensions', blast: 'You can see that something regressed and not what, where, or which deploy caused it.', fix: 'Attach release SHA, route pattern, device memory, core count and effective connection type at collection time; use `web-vitals/attribution` for element and phase breakdown.' },
        { mode: 'Third-party scripts added without a budget or owner', blast: '600 KB of vendor JavaScript on the main thread; INP is dominated by code you did not write and cannot profile.', fix: 'Inventory with long-task attribution by script URL, cap count and size in CI, require one-out-one-in, and name an owner who can refuse.' },
        { mode: '`font-display: block` on a webfont', blast: 'Up to 3 s of invisible text; if the LCP element is text, LCP is delayed by the entire font load.', fix: '`font-display: swap`, preload the above-the-fold faces, self-host, and tune fallback metrics with `size-adjust` and ascent/descent overrides so the swap does not shift layout.' },
        { mode: 'Flaky Lighthouse CI gate on a single run', blast: 'False failures, developers learn to re-run until green, and within a month the check is disabled entirely.', fix: 'Median of 5 runs, assert on stable metrics, keep bundle-size checks as the deterministic first line, and provide a named override path.' },
        { mode: 'Quoting "100 ms costs 1% of revenue" as a general law', blast: 'A stakeholder checks the source, finds a 2006 talk about a different business, and the whole performance case loses credibility.', fix: 'Cite figures with their source and audience, then measure your own funnel by metric bucket, and run a holdback for a causal number.' }
      ]
    },

    {
      t: 'staff',
      md: `The signal is measurement discipline plus honest reasoning about causality, and refusing
to celebrate a metric movement that does not correspond to experience. Sentences that land:

- "Our aggregate p75 LCP is 2.6 seconds, which is nearly passing and completely misleading.
  Segmented, mid-tier Android in India is at 4.6 s and that is 19% of sessions. I want to review
  the worst segment, not the average, because the average is dominated by users on the same
  hardware we develop on."
- "INP is 480 ms and attribution says 340 ms of that is input delay, not processing. So the
  handler is not the problem -- the main thread was already busy when the click arrived. I would
  go looking for the long task, which on this page is almost certainly hydration."
- "The LCP breakdown says most of the time is resource load *delay*, which means we discovered
  the image late. That is a preload and \`fetchpriority\` fix, not a compression fix. Right now it
  is lazy-loaded, which is the worst possible setting for the LCP element."
- "I will use Lighthouse in CI as a regression gate and RUM to decide what to work on. Lighthouse
  cannot measure INP, because it never clicks anything -- TBT is the lab proxy and I would gate on
  that instead."
- "The budget has to fail the build or it is a dashboard. Bundle size on every pull request
  because it is deterministic, Lighthouse against the preview deploy on the median of five runs
  because a single run is too noisy, and a named approver for the override so it does not get
  deleted during the first incident."
- "I can cite Deloitte's figure of 8.4% retail conversion per 0.1 s, but that is their audience
  and their sites. For our case I would segment our own funnel by LCP bucket, acknowledge that is
  correlational since slow sessions also mean older devices and poorer users, and then run a 10%
  holdback so we get a causal number."
- "Careful with that win. The LQIP is now the LCP element, so the metric improved and the user
  still waits the same time for the real image. I do not want to report that as a success."
- "Third-party scripts are the largest single cost here and none of it is code we own. I want
  long-task attribution by script URL so we can say the chat widget costs 180 ms at p75, and a
  budget with an owner who can say no -- otherwise every individual request gets approved and
  nobody owns the sum."

The pattern: segment before concluding, use attribution instead of intuition, distinguish
correlation from causation without hiding behind it, and build a mechanism rather than doing a
project.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'Your p75 INP is 480 ms. Attribution shows 340 ms input delay, 40 ms processing time, and 100 ms presentation delay. What do you fix?',
          options: [
            'Optimise the click handler -- it is clearly doing too much work.',
            'Find and break up the long task that was already occupying the main thread when the click arrived.',
            'Reduce the size of the rendered output to cut presentation delay.',
            'Debounce the interaction so fewer handlers run.'
          ],
          answer: 1,
          why: 'INP decomposes into input delay (waiting for the main thread to become free), processing time (your handler), and presentation delay (rendering the resulting frame). Here the handler is 40 ms -- entirely healthy -- and 71% of the total is queueing before it ever ran. That means something unrelated was blocking the thread: hydration, a large re-render, an analytics flush, or a third-party script. Optimising the handler would remove at most 40 ms from 480 ms. This is exactly why attribution matters: without it, the intuitive move is to optimise the handler, and it would have been close to wasted work.'
        },
        {
          q: 'A team reports that Lighthouse improved from 68 to 94 after their optimisation sprint, but field CLS and INP both got worse. What is the most likely explanation?',
          options: [
            'The field data is stale and will catch up within a few days.',
            'Lab and field measure different populations and different things -- Lighthouse never interacts, so it cannot see INP, and its single cold desktop-emulated run does not reflect the device mix or the interaction patterns of real sessions.',
            'Lighthouse scores and Core Web Vitals are unrelated metrics.',
            'The team must have made a measurement error in the RUM collection.'
          ],
          answer: 1,
          why: 'Lighthouse is one synthetic cold load on emulated hardware from one location, with no user interaction at all -- so INP is not measurable there and TBT is only a proxy. It is a good regression gate and a poor description of your users. Real sessions span a five-fold range of CPU speed, warm and cold caches, lossy networks, and interactions nobody scripted. A common concrete version of this divergence: the team added deferred-loading behaviour that improved the lab score while injecting content later in real sessions, which raised field CLS. The correct posture is lab in CI for regressions, field data for deciding what to work on and whether it worked.'
        },
        {
          q: 'You add a base64-inlined low-quality placeholder for the hero image. LCP improves from 3.2 s to 1.6 s. Should you report this as a win?',
          options: [
            'Yes -- LCP is the metric and it halved.',
            'Not without checking: if the placeholder is now the LCP element, the metric improved while the user waits the same time for the real image, and the inlined bytes have grown the HTML.',
            'Yes, and CLS will also improve automatically.',
            'No -- LQIPs are always counted as a layout shift.'
          ],
          answer: 1,
          why: 'LCP measures the largest contentful paint, and a full-width placeholder can satisfy that definition perfectly well. So the number moves without the experience changing, which is the textbook example of optimising a metric rather than an outcome. Verify with attribution which element LCP actually resolved to. There is also a second cost: inlined base64 is roughly 33% larger than the binary and lands in your HTML, competing with the first TCP congestion window that your critical CSS needs. A placeholder is still often worth having for perceived performance, but report it honestly -- and if the goal is genuinely faster hero content, the fix is preload plus `fetchpriority="high"` plus a modern format.'
        },
        {
          q: 'A stakeholder asks for the revenue impact of a proposed 800 ms LCP improvement. What is the most defensible answer?',
          options: [
            'Cite Amazon\'s 100 ms / 1% figure and extrapolate to 8%.',
            'Segment your own funnel conversion by LCP bucket as directional evidence, state plainly that it is correlational, and propose a 10% holdback to get a causal number.',
            'Decline to estimate, since performance impact cannot be measured.',
            'Use the Deloitte 8.4% figure as a forecast for your site.'
          ],
          answer: 1,
          why: 'Published figures establish that the mechanism is real and worth testing; they are not forecasts for your product, and a stakeholder who checks the source of the Amazon number will find a 2006 talk about a different business, which damages your whole case. Your own funnel segmented by LCP bucket is better evidence but still confounded -- slow sessions correlate with older devices, worse networks and different demographics, all of which independently affect conversion. A holdback is the only design that separates the effect of speed from the characteristics of the users who experience it: ship to 90%, keep 10% on the old path, compare. It costs a little revenue on the holdback and it produces a number that survives scrutiny.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `Long tasks, the frame budget and what makes INP bad are **Browser & Rendering
Pipeline**. TTFB decomposition and resource hints are **Web Foundations: URL to Pixels** and
**CDN & Edge Delivery**. Hydration -- usually the largest long task -- is **CSR, SSR, SSG, ISR &
Streaming** and **React at Scale**. Collection, sampling and release correlation are
**Frontend Observability**, and enforcing a budget across many teams is **Design Systems &
Frontend Platform**.`
      }]
    }
  ],

  flashcards: [
    { q: 'What are the Core Web Vitals thresholds, and at what percentile?', a: 'LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms, all evaluated at the 75th percentile of page loads. p75 means one in four users can be worse and you still pass, which is why segmenting by device and geography matters more than the aggregate.' },
    { q: 'Why is INP harder than the FID it replaced in March 2024?', a: 'FID measured only the input delay of the first interaction -- essentially queueing time -- so a page could pass while every interaction took a second to show a result. INP measures input to next paint for approximately the worst interaction, so it includes the handler and the rendering that follows.' },
    { q: 'What are the three parts of INP, and why does the split matter?', a: 'Input delay (waiting for a free main thread), processing time (your handler), presentation delay (rendering the frame). If most of it is input delay, the handler is irrelevant and you need to find the long task blocking the thread -- usually hydration or a third-party script.' },
    { q: 'What does LCP decompose into, and which slice is usually largest?', a: 'TTFB, resource load delay, resource load duration, and element render delay. Load *delay* is often the biggest -- the image was discovered late because it was referenced from CSS, injected by JavaScript, or lazy-loaded. That is a preload and `fetchpriority` fix, not a compression fix.' },
    { q: 'Name four reasons lab and field data disagree.', a: 'Device distribution (real traffic spans a 5x CPU range), cache state (lab is always cold), network reality (packet loss and the 100-500 ms mobile radio promotion), and interaction (lab tools never click, so INP is unmeasurable and TBT is only a proxy). Plus geography and unfiltered bot traffic.' },
    { q: 'What is the most common LCP bug in the wild?', a: 'A lazy-loaded hero image. `loading="lazy"` tells the browser to deliberately defer the most important resource on the page, adding hundreds of milliseconds. Use `loading="eager"`, `fetchpriority="high"` and a `preload` for anything that could be the LCP element.' },
    { q: 'FOIT vs FOUT -- which do you choose and how do you mitigate it?', a: '`font-display: block` gives FOIT, up to 3 s of invisible text which can delay LCP entirely. `font-display: swap` gives FOUT, immediate fallback text with a shift on swap. Choose swap, then remove the shift with `size-adjust`, `ascent-override` and `descent-override` on a fallback `@font-face`.' },
    { q: 'Why is a single Lighthouse run a bad CI gate?', a: 'Variance is high enough to produce false failures, and a flaky gate gets disabled within a month. Take the median of about five runs, keep deterministic bundle-size checks as the first line on every PR, and provide a named override path so the gate is not deleted during an incident.' },
    { q: 'How do you make a credible business case for performance work?', a: 'Cite published figures with their source and audience (Vodafone +8% sales from a 31% LCP improvement; Deloitte +8.4% retail conversion per 0.1 s) as evidence the mechanism is real, then segment your own funnel by metric bucket while naming the confounders, then run a holdback -- 90% treated, 10% on the old path -- for a causal number.' }
  ],

  drills: [
    {
      prompt: 'You join a retail site with p75 LCP of 3.8 s, p75 INP of 420 ms and CLS of 0.18. Leadership has approved one quarter of performance work and wants a revenue estimate up front. There are nine third-party scripts, the design team is mid-rebrand, and the last performance project two years ago regressed within six months. Plan the quarter.',
      probes: [
        'What do you do in week one, before changing any code?',
        'How do you decide what to work on first?',
        'What do you tell leadership about the revenue estimate?',
        'Why did the last project regress, and what makes yours different?',
        'How do you handle the third-party scripts politically, not just technically?'
      ],
      strong: [
        'Spends week one on measurement: RUM with attribution segmented by device class, country, route pattern and release, because without segmentation the priorities will be wrong.',
        'Reads attribution rather than guessing -- LCP sub-parts to distinguish a discovery problem from a transfer problem, and the INP input-delay-versus-processing split to decide whether the handler matters at all.',
        'Prioritises by (affected sessions × distance from threshold), and explicitly reviews the worst segment rather than the aggregate.',
        'Handles the revenue question honestly: published figures as evidence the mechanism is real with sources attributed, own-funnel segmentation as directional with confounders named, and a 10% holdback proposed to produce a causal number.',
        'Diagnoses the previous regression as a missing mechanism, and installs one: bundle budget failing every PR, Lighthouse CI on median-of-five against preview deploys, RUM alerts on p75 by segment with release correlation, and a named override approver.',
        'Treats third parties as governance: attribute main-thread cost per script URL so the conversation has numbers, then a capped count and size with one-out-one-in and an owner empowered to refuse.',
        'Uses the rebrand as leverage rather than an obstacle -- new image pipeline with AVIF and correct `sizes`, font strategy with `swap` plus metric-adjusted fallbacks, all landing with the redesign.',
        'Names explicit non-goals for the quarter and states what will not improve.'
      ],
      weak: [
        'Starts optimising in week one based on a local Lighthouse run.',
        'Quotes the Amazon 100 ms figure as a forecast.',
        'Works on the aggregate p75 without segmenting.',
        'Proposes removing all third-party scripts with no plan for the stakeholders who added them.',
        'Ships improvements with no CI gate or RUM alerting, repeating the previous failure.',
        'Cannot explain which part of INP is actually slow.'
      ]
    },
    {
      prompt: 'A product team wants to add a session-replay tool. It is 180 KB gzipped, executes on the main thread, and the analytics team says it is essential for understanding a checkout drop-off. Your INP budget is already at 190 ms against a 200 ms target. What do you do?',
      probes: [
        'How do you evaluate the request rather than just refusing it?',
        'What options exist besides yes and no?',
        'What would you measure to decide?',
        'What do you do if the answer has to be yes?',
        'Who makes this call?'
      ],
      strong: [
        'Refuses to answer from principle and proposes measurement: load it on a small traffic slice and measure its actual long-task contribution and INP delta with attribution by script URL, rather than arguing about the 180 KB figure.',
        'Reframes the request as the underlying need -- understanding checkout drop-off -- and proposes cheaper alternatives: sampled replay at 1-5% of sessions, replay limited to the checkout route only, or funnel instrumentation plus targeted logging that answers the question without a full replay tool.',
        'Names the concrete mitigations if it must ship: load after first interaction or on idle, route-scoped so it never touches the pages where INP is tightest, sampled, and evaluated for worker-based execution with the caveat that synchronous DOM access breaks.',
        'Applies the budget as one-out-one-in and identifies what could be removed, making the trade explicit rather than absorbing the cost silently.',
        'Raises privacy and cost as part of the decision -- replay captures user input and needs masking, consent handling and a data-retention policy, which is a real compliance surface.',
        'States clearly that this is a business trade-off and not an engineering veto: their job is to make the cost legible and offer options, and a named owner of the performance budget makes the call.',
        'Commits to re-measuring after launch and to a removal trigger if the INP budget is breached at p75.'
      ],
      weak: [
        'Refuses outright on principle with no measurement and no alternative.',
        'Approves it because the analytics team said it is essential.',
        'Accepts the vendor\'s claim that the script is non-blocking without verifying.',
        'Has no sampling, scoping or deferred-loading proposal.',
        'Ignores the privacy and retention implications entirely.',
        'Provides no post-launch measurement or removal trigger.'
      ]
    }
  ]
};
