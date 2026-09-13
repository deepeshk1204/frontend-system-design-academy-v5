export default {
  blocks: [
    {
      t: 'prose',
      md: `Deploying a frontend means publishing new files and pointing users at them. What makes it
harder than deploying a server is that you cannot take the old version out of service.

A server deploy replaces processes: when the last old process exits, no old code is running
anywhere. A browser deploy cannot do that. The user who loaded your page an hour ago is still
running that build, in memory, with its own idea of which asset files exist and which API shape the
server speaks. They will keep running it until they reload -- which might be in thirty seconds or
next Tuesday. So the accurate mental model is not "version 41 replaced version 40". It is
**"version 41 joined versions 40, 39 and 38, which are all still executing"**, and every deployment
decision follows from that.`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `Two failures make this a discipline rather than a scripting task, and both are familiar
enough that most engineers have seen them without naming them.

The first is the **stale-HTML white screen**. Your HTML names \`app.7c1e.js\`. You deploy, the new
HTML names \`app.a91f.js\`, and your pipeline cleans the bucket by deleting files not in the new
build. Every browser holding the old HTML now requests a file that returns 404, the dynamic import
rejects, and the application dies -- often on a route the user navigates to twenty minutes later,
which makes it look random. Nothing is wrong with your code. You deleted a file someone was still
pointing at.

The second is the **contract skew**. You ship a frontend that sends a new field, and the backend
that understands it is deploying in a separate pipeline. For some window, one of the two is ahead.
If the frontend goes first you get errors from a field the server rejects; if the backend goes first
you get errors from a response shape the old frontend does not expect. There is no ordering that
avoids this, only a change design that tolerates both orders -- which is what expand, migrate,
contract is for.

Everything below is a control for one of those two problems.`
    },

    { t: 'h', text: 'Immutable assets and the two-policy split' },
    {
      t: 'prose',
      md: `The foundation is content-hashed filenames. The build computes a hash of each file's
contents and puts it in the name, so different bytes always live at a different URL. That single
property gives you three things: assets can be cached forever with no invalidation, a deploy is
purely additive, and rollback does not require purging anything.

It also splits your caching policy cleanly in two. Hashed assets get
\`Cache-Control: public, max-age=31536000, immutable\`. The HTML -- the mutable pointer that names
which hashed assets to load -- gets a near-zero browser TTL and a short shared TTL, so a deploy
propagates in seconds but a bad one is a minute of exposure rather than a day.

The part people skip is **retention**. Additive deploys only help if you never remove anything. Keep
at least the previous two builds' assets live, and in practice a rolling 30-day window is a better
policy because it also covers long-lived tabs and slow-updating service workers. Storage for old
JavaScript chunks is a rounding error against the cost of a white screen.`
    },
    {
      t: 'code',
      lang: 'http',
      title: 'The policy, and the retention rule that makes it safe',
      code: `# Hashed build output. New bytes always mean a new URL, so this is safe forever.
GET /assets/app.a91f3c.js
Cache-Control: public, max-age=31536000, immutable

# The pointer. Cached at the edge for speed, re-checked by the browser
# constantly for control. 60s of edge TTL == 60s of bad-deploy exposure.
GET /index.html
Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=600
ETag: "build-a91f3c"

# Module Federation: remoteEntry.js is a pointer too, not an asset.
GET /billing/v/2026-09-13-a91f/remoteEntry.js
Cache-Control: public, max-age=30, must-revalidate

# Deploy = upload new files. It never deletes.
# Retention: 30 days minimum, which is what stops ChunkLoadError.
aws s3 sync ./dist s3://acme-assets/ --cache-control "public,max-age=31536000,immutable" \\
  --exclude "index.html"
aws s3 cp ./dist/index.html s3://acme-assets/index.html \\
  --cache-control "public,max-age=0,s-maxage=60,stale-while-revalidate=600"
# Note: no --delete. Ever.`
    },
    {
      t: 'note',
      tone: 'danger',
      title: 'The mixed-fleet reality, stated as a number',
      md: `Measure how long your users hold a build. On a typical B2B SaaS product the p99 session
duration runs into hours, and a meaningful population of tabs survives overnight. That is your
minimum compatibility window: **any change must work for every build still in the field for at
least that long.**

The consequence is uncomfortable and worth saying out loud in an interview: your frontend and your
API are permanently in a mixed-version state, and "we will deploy them together" is not a plan,
because you cannot deploy the copy already running in someone's browser.`
    },

    { t: 'h', text: 'Atomic versus progressive rollout' },
    {
      t: 'table',
      title: 'How new code reaches users',
      cols: ['Strategy', 'Mechanism', 'Rollback', 'Honest cost'],
      rows: [
        ['**Atomic pointer flip**', 'Upload all assets, then update the HTML to name the new ones in one operation.', 'Flip the pointer back. Seconds, and the old assets are still there.', 'Every user gets the new build at once, so a bad deploy is 100% exposure until you notice.'],
        ['**Canary by cohort**', 'A percentage of requests get HTML naming the new build; the rest get the old one.', 'Set the percentage to zero.', 'HTML must vary per request, which weakens edge caching unless you bucket at the edge.'],
        ['**Blue/green**', 'Two complete environments; switch traffic between them.', 'Switch back.', 'Double the infrastructure, and sticky assignment is needed or users flip between versions mid-session.'],
        ['**Feature flags**', 'Deploy the code to everyone, dark; enable behaviour per cohort at runtime.', 'Turn the flag off. No deploy involved, and it is the fastest control you have.', 'Both code paths ship in the bundle, and flags accumulate into permanent complexity.'],
        ['**Progressive by ring**', 'Internal users, then 1%, then 10%, then 50%, then 100%, with automated gates.', 'Halt and revert the ring.', 'Slower, and you need automated analysis or the gates are just someone watching a chart.']
      ]
    },
    {
      t: 'prose',
      md: `These combine rather than compete, and the combination most large teams converge on is:
atomic asset publication, canary the HTML pointer by cohort, and control risky *behaviour* with
flags independently of either. That separation matters. Asset deployment and feature release become
two different operations with two different rollback mechanisms, so you are not forced to revert
fourteen safe changes because the fifteenth was bad.

Bucketing deserves a note. Assign a user to the canary deterministically -- hash a stable
identifier such as a session or user id and compare against the rollout percentage -- and set the
result in a cookie at the edge. Random per-request assignment means a user's second page load lands
on a different build, so their cached chunks and their HTML disagree, and you have manufactured the
exact skew you were trying to control.`
    },
    {
      t: 'diagram',
      code: `flowchart TB
  D["CI publishes hashed assets<br/>nothing deleted"] --> E["Edge worker reads<br/>rollout config"]
  E -->|"hash of user id<br/>under 5 percent"| N["HTML naming build N"]
  E -->|"otherwise"| O["HTML naming build N-1"]
  N --> R["RUM and error events<br/>tagged with release"]
  O --> R
  R --> A{"Automated analysis:<br/>error rate, p75 INP,<br/>conversion vs baseline"}
  A -->|"within bounds"| P["Promote: 5 to 25 to 100"]
  A -->|"regression"| RB["Set rollout to 0<br/>old assets still live"]
  P --> E
  RB --> E`,
      caption: 'The loop only closes if events carry a release identifier. Without it, promotion and rollback are somebody watching a chart and guessing.'
    },

    { t: 'h', text: 'Canary analysis and automated rollback' },
    {
      t: 'prose',
      md: `A canary that nobody evaluates is just a slower deploy. The value comes from comparing the
canary cohort against the baseline cohort on signals that move fast enough to act on, and from
having the comparison run without a human.

Pick metrics that respond within minutes. **Unhandled error rate per session** is the best single
signal -- it moves within a minute of a bad deploy and has a low false-positive rate. **Chunk-load
error rate** specifically, because it diagnoses a retention or publication mistake rather than a
code bug. **p75 INP and p75 LCP** for the canary cohort against the same cohort's baseline, because
a performance regression is real damage that throws no exceptions. And at least one **business
funnel step** -- add-to-cart rate, search-result click-through -- because the worst deploys are the
ones where nothing errors and nobody buys anything.

Set the comparison up honestly. Compare the canary against concurrent baseline traffic rather than
against yesterday, so time-of-day and traffic-mix effects cancel. Require a minimum sample before
judging, or a 1% canary on a quiet route will trip on noise. And be explicit about the statistical
bar -- a fixed relative threshold such as "halt if the canary's error rate exceeds the baseline's by
more than 50% with at least 1,000 canary sessions" is crude but understandable at 3 a.m., which is
worth more than a sophisticated test nobody trusts.

Automated rollback should be the default response, not an escalation. The action is cheap -- set the
rollout percentage to zero, and because you never deleted the old assets, affected users recover on
their next HTML fetch within the edge TTL. Make the bar for automated revert *lower* than the bar
for paging a human, because a revert costs you a deploy cycle and a page costs someone their night.`
    },

    { t: 'h', text: 'Feature flags as decoupled release' },
    {
      t: 'prose',
      md: `A feature flag separates "the code is deployed" from "the behaviour is on". That is a
genuine architectural improvement: you can merge to trunk continuously, ship dark code, enable for
internal users, ramp by cohort, and turn a feature off in seconds without a build. Rollback stops
being a deploy.

Flags also have costs that get discussed far less than their benefits. Every flag doubles a code
path, and n flags in one area produce 2^n combinations of which only a few are ever tested. Flag
evaluation on the client means both code paths ship in the bundle, so a large dark feature is bytes
every user downloads and parses for nothing -- and that argues for lazy-loading the flagged branch
rather than including it inline. If flags are evaluated client-side after render you get a visible
flicker as the UI switches; evaluate server-side, or at the edge, and bake the decision into the
HTML.

The failure that actually bites is **flag debt**. A flag created for a rollout in March is still in
the code in November, nobody remembers what the off path does, it has never been exercised since,
and now it is a trap. Treat flags as having a lifecycle: an owner, a type, and an expiry.`
    },
    {
      t: 'grid',
      cols: 2,
      items: [
        { b: 'Release flags', md: 'Temporary, for a rollout. They should have an expiry date -- 30 to 90 days -- and a CI warning that becomes a failure once past it. This is the category that turns into debt.' },
        { b: 'Experiment flags', md: 'Owned by the experiment, removed when it concludes. The removal should be part of the experiment\'s definition of done, not a follow-up ticket.' },
        { b: 'Operational flags', md: 'Kill switches for expensive features, permanent by design. Keep them, but test the off path regularly -- an untested kill switch is not a kill switch.' },
        { b: 'Permission flags', md: 'Entitlements and plan tiers. These are product configuration rather than flags, and they belong in your authorisation model where they can be enforced server-side.' }
      ]
    },
    {
      t: 'note',
      tone: 'warn',
      md: `A client-evaluated flag is a UX mechanism, not a security control. Anyone can read your
bundle, flip the value in the debugger, and see the dark feature. If "off" must mean "cannot", the
enforcement belongs on the server. Shipping an unreleased pricing tier or an unannounced feature
behind a client-side flag has leaked more launches than any embargo breach.`
    },

    { t: 'h', text: 'Expand, migrate, contract' },
    {
      t: 'prose',
      md: `This is the pattern that makes change safe when you cannot deploy all participants
simultaneously, and it applies identically to an API field, a database column and a local IndexedDB
schema. Three phases, each of which is independently deployable and independently revertible.

**Expand.** Add the new thing without removing the old. The API returns both \`name\` and the new
\`firstName\`/\`lastName\`, or accepts either shape on write. Every version in the field still works,
because nothing they relied on has changed. This phase is backward compatible by construction, so
it is safe to deploy at any time.

**Migrate.** Move readers and writers to the new thing, and backfill existing data. Clients ship
versions that prefer the new field. Crucially, you now **measure** old-path usage -- a counter on
every read of the deprecated field, dimensioned by client version -- because the next phase depends
on knowing that number rather than guessing it.

**Contract.** Once old-path usage is genuinely zero and has been zero for longer than your
compatibility window, remove it. Not on a schedule; on evidence.

The discipline sounds tedious and it is exactly what separates teams that can evolve their
contracts from teams that cannot. The common failure is attempting expand and contract in one
release -- which is just a breaking change with three phases' worth of paperwork.`
    },
    {
      t: 'table',
      title: 'The same pattern across three surfaces',
      cols: ['Phase', 'API field', 'Database column', 'Client local schema'],
      rows: [
        ['**Expand**', 'Return both old and new fields; accept either on write.', 'Add the new nullable column; dual-write both.', 'Add the new store or field as optional; write both.'],
        ['**Migrate**', 'Ship clients preferring the new field; count reads of the old one by client version.', 'Backfill in batches; switch reads to the new column; verify parity.', 'Migrate on app open inside the versioned upgrade transaction; keep reads tolerant of both.'],
        ['**Contract**', 'Remove the old field once its read counter has been zero for longer than your session p99.', 'Drop the old column after reads are zero and a backup exists.', 'Remove the old field once telemetry shows no client version still writing it.'],
        ['**If it goes wrong**', 'Revert the client; the old field still exists.', 'Reads revert to the old column; both are still populated.', 'IndexedDB cannot downgrade, so the real safety is forward-compatible reads shipped in advance.']
      ]
    },
    {
      t: 'prose',
      md: `Killing an endpoint follows the same logic with one addition: you need to know who is
calling it, and "grep the codebase" is not an answer when mobile apps, integrations and old browser
tabs are callers you do not control. Instrument the endpoint with a per-caller counter, announce
deprecation with a \`Deprecation\` and \`Sunset\` header so automated clients can surface it, then use
**brownouts** -- return 410 for one minute at a low-traffic hour, watch who complains, and repeat
with a longer window. A brownout converts an unknown blast radius into a measured one, and it is far
better to discover a forgotten integration during a scheduled minute than during the permanent
removal.`
    },

    { t: 'h', text: 'Long-lived tabs and forced refresh' },
    {
      t: 'prose',
      md: `A dashboard left open for six days is running six-day-old JavaScript against a
six-days-newer API. At some point you need it to reload, and how you ask matters.

Detection is straightforward. Poll a small \`/version.json\` every few minutes, or read a build
identifier from a response header you already receive, and compare it with the build the page is
running. Better still, the service worker's \`updatefound\` event or your realtime channel can tell
you without polling.

What you do next is a graded response rather than a single behaviour. For an ordinary update,
**prompt**: a non-blocking "a new version is available" affordance that the user accepts when
convenient. For a stale build past your support window, **reload at a safe moment** -- on a route
change away from a form, when there is no unsaved state and no in-flight mutation. For a security
fix or a version that is actively broken, **force it**, with a clear message, and accept that you
may interrupt someone.

The rule that keeps this from being hated: never reload while the user has unsaved work. A forced
refresh that discards a half-written message is a worse incident than the stale build was, and it
is the reason users disable auto-updating behaviour when they can.

Two related defences are worth having regardless. Retry a failed chunk load once, then reload the
page -- because a \`ChunkLoadError\` frequently means exactly this situation and a reload genuinely
fixes it. And keep a small compatibility floor in the API: a \`X-Client-Build\` header on every
request lets the server respond with a deliberate "please reload" for builds it no longer supports,
which is far better than serving them a response shape they will crash on.`
    },

    { t: 'h', text: 'Rolling out when the shell and remotes deploy separately' },
    {
      t: 'prose',
      md: `With microfrontends, the mixed-fleet problem becomes multiplicative. Production is not
running version 41; it is running shell 41 with billing 12 and settings 7 for some users, shell 40
with billing 13 for others, and a long tail of combinations nobody enumerated. Three remotes each
keeping two live versions is eight combinations, and you have tested one.

Four controls make it survivable. Resolve remote versions from a **runtime manifest** with a short
TTL, so pinning or rolling back one remote is a pointer flip rather than a host rebuild -- that is
the single most important one, because it makes per-team rollback possible at all. Keep the shell
contract **additive-only within a major**, and have remotes declare the contract version they were
built against so the shell can refuse and render a scoped fallback instead of crashing a page.
Retain **N-1 and N-2 chunks for every remote independently**, since each has its own deploy cadence
and its own population of stale HTML. And **canary a remote by cohort through the manifest**, not
by deploying it to everyone at once, which gives each team the same progressive rollout the shell
gets.

The failure this prevents is specific and common: the shell team deploys a contract change, four
remote teams' features break simultaneously, and the architecture that was supposed to isolate
teams has instead coupled all of them to one deploy.`
    },
    {
      t: 'numbers',
      title: 'Figures that drive the policy',
      items: [
        { v: '30 days', k: 'Minimum asset retention', note: 'Covers long-lived tabs and stale service workers' },
        { v: '60 s', k: 'HTML edge TTL', note: 'Equals your bad-deploy exposure window' },
        { v: '5 → 25 → 100%', k: 'A rollout ramp that works', note: 'With automated gates between steps' },
        { v: '2-10 min', k: 'Time to detect a bad deploy from error rate', note: 'Only if events are release-tagged' },
        { v: '< 60 s', k: 'Time to roll back', note: 'Pointer flip plus edge TTL, no rebuild' },
        { v: '30-90 days', k: 'Release-flag expiry', note: 'Enforced by CI, or it becomes permanent' }
      ]
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      gains: [
        'Rollback is a pointer flip in under a minute, with no rebuild and no cache purge.',
        'A bad deploy is bounded to a small cohort instead of your whole user base.',
        'Release decouples from deploy, so risky behaviour is controlled independently of code shipping.',
        'Contract changes become survivable in a permanently mixed-version fleet.',
        'Automated rollback catches regressions faster than a human watching a dashboard.',
        'Teams can deploy independently without coordinating a release train.'
      ],
      costs: [
        'Canarying HTML means it varies per request, complicating edge caching.',
        'Expand-migrate-contract is three deploys where a breaking change is one.',
        'Flags accumulate, and untested off-paths become traps.',
        'Automated rollback needs trustworthy release-tagged telemetry, which is real infrastructure.',
        'Asset retention grows storage and makes bucket lifecycle policy a correctness concern.',
        'Testing must cover version combinations rather than a single version.',
        'Deployment becomes a system with its own on-call surface rather than a script.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'Pipeline deletes old assets on deploy', blast: '`ChunkLoadError` for every user holding previous HTML -- often thousands of sessions within minutes.', fix: 'Never sync with `--delete`; 30-day retention via bucket lifecycle rules; alert on chunk-load error rate as a first-class signal.' },
        { mode: 'HTML cached with a long browser `max-age`', blast: 'Users pinned to an old build for the TTL with no way to reach them, including for a security fix.', fix: '`max-age=0, s-maxage=60, stale-while-revalidate=600`: edge-cached for speed, always re-checked for control.' },
        { mode: 'Canary assignment random per request', blast: 'A user\'s HTML and cached chunks come from different builds, producing skew you created yourself.', fix: 'Deterministic bucketing on a hashed stable id, persisted in a cookie set at the edge.' },
        { mode: 'Breaking API change deployed with the frontend', blast: 'Every user still on the previous build errors for the duration of your session p99.', fix: 'Expand, migrate, contract, with old-path read counters dimensioned by client version, and contract only on evidence.' },
        { mode: 'Canary with no automated analysis', blast: 'A regression ramps to 100% because the person watching the dashboard went to lunch.', fix: 'Automated gates on error rate, chunk-load errors, p75 INP and one funnel metric, compared against concurrent baseline traffic.' },
        { mode: 'Endpoint removed after a grep', blast: 'A forgotten mobile version or partner integration breaks with no warning and no owner.', fix: 'Per-caller instrumentation, `Deprecation` and `Sunset` headers, then brownouts before removal.' },
        { mode: 'Forced reload discarding unsaved work', blast: 'Users lose in-progress input; trust in updates is gone for good.', fix: 'Prompt by default, reload only at safe moments with no unsaved state, and force only for security or a broken build.' },
        { mode: 'Shell ships a contract change while remotes lag', blast: 'Four teams\' features break at once -- the exact coupling microfrontends were meant to remove.', fix: 'Additive-only within a major, remotes declare their contract version, mount-time check with a scoped fallback, and manifest-based per-remote pinning.' }
      ]
    },

    {
      t: 'staff',
      md: `The signal here is whether you think in terms of a fleet or a version. Sentences that
demonstrate the first:

- "There is no such thing as deploying the frontend. Users hold builds in memory, so production is
  always running several versions at once. I would measure our p99 session duration, because that
  number *is* our compatibility window."
- "Assets are content-hashed and immutable, and the pipeline never deletes. Retention is 30 days.
  The failure I am preventing is a user on old HTML requesting a chunk we pruned, and that is a
  white screen, not a degraded experience."
- "HTML gets \`max-age=0, s-maxage=60\` with \`stale-while-revalidate\`. That makes our bad-deploy
  exposure 60 seconds instead of however long we set the browser TTL to."
- "Canary bucketing has to be deterministic on a hashed user id, set as a cookie at the edge. Random
  per-request assignment means a user's HTML and their cached chunks disagree, which manufactures
  the skew we are trying to avoid."
- "I want automated rollback, with a lower bar than paging a human. Error rate per session and
  chunk-load error rate move within a minute, and I compare the canary against concurrent baseline
  traffic rather than yesterday so time-of-day effects cancel. Plus one funnel metric, because the
  worst deploys throw no errors and just stop converting."
- "Any contract change is expand, migrate, contract, and I contract on evidence rather than on a
  date -- a read counter on the deprecated field, dimensioned by client version, that has to be zero
  for longer than our session p99."
- "Before removing an endpoint I brownout: return 410 for one minute at a quiet hour and see who
  complains. That turns an unknown blast radius into a measured one."
- "Flags are typed and expire. A release flag gets 90 days and then CI fails, because the real cost
  of flags is not the code path -- it is the untested off-path nobody remembers in November."
- "With microfrontends I resolve remote versions from a manifest with a 30-second TTL, so rolling
  back one team's feature is a pointer flip that does not involve the shell team at 2 a.m."

Naming the session-duration p99 as the compatibility window, contracting on evidence rather than on
a calendar, and preferring automated revert to a page are the three moves that most reliably read as
having operated this rather than designed it.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'Your deploy pipeline runs `aws s3 sync ./dist s3://assets --delete`. What is the user-visible failure?',
          options: [
            'Nothing -- old assets are unused after deploy.',
            'Users holding previously-cached HTML request chunks that now 404, producing chunk-load errors and white screens.',
            'The CDN serves stale content until the TTL expires.',
            'Source maps break.'
          ],
          answer: 1,
          why: 'HTML is the pointer that names hashed assets, and browsers can hold an old pointer for hours. Deleting the files it references turns a routine deploy into a wave of `ChunkLoadError`, typically appearing minutes later when someone navigates to a lazily-loaded route -- which makes it look intermittent and unrelated to the deploy. Deploys must be purely additive with a retention window of at least 30 days; the storage cost is negligible against the failure.'
        },
        {
          q: 'You need to split an API\'s `name` field into `firstName` and `lastName`. Web, iOS and Android clients all consume it. What is the correct sequence?',
          options: [
            'Change the field and release all clients simultaneously.',
            'Return all three fields, ship clients that prefer the new ones, instrument reads of `name` by client version, and remove it once that counter has been zero longer than your compatibility window.',
            'Version the whole API as v2 and migrate clients over.',
            'Return `firstName` and `lastName` and keep `name` forever.'
          ],
          answer: 1,
          why: 'Simultaneous release is impossible -- app-store versions persist for months and browser tabs for days. Expand, migrate, contract makes each step independently safe and revertible, and the instrumentation is what makes the final step a decision based on evidence rather than a calculated risk. A whole new API version is a much larger surface to maintain for a single field change, and keeping `name` forever is how an API becomes impossible to reason about.'
        },
        {
          q: 'A canary at 5% shows error rate up 8% and p75 INP up 40 ms after 300 sessions. What should the automated system do?',
          options: [
            'Roll back immediately on any regression.',
            'Keep collecting -- 300 sessions is below the minimum sample for a confident judgement -- while holding the ramp.',
            'Promote to 25% since the error change is small.',
            'Page the on-call engineer.'
          ],
          answer: 1,
          why: 'Both signals are within the range you would expect from sampling noise at 300 sessions, so acting either way is a coin flip. The correct design holds the ramp and waits for the minimum sample, which is why a canary system needs an explicit sample-size gate alongside its thresholds. Reverting on any movement trains the team to disable the automation; promoting on an unconfident read defeats the purpose of canarying at all.'
        },
        {
          q: 'A customer leaves your dashboard open for five days. Your API has since dropped a deprecated response field. What is the best design?',
          options: [
            'Force an immediate reload as soon as a new version is detected.',
            'Send a build identifier with each request so the server can flag unsupported clients, and prompt for reload -- forcing it only at a safe moment with no unsaved work.',
            'Assume users reload daily.',
            'Keep every deprecated field indefinitely.'
          ],
          answer: 1,
          why: 'You need both a detection mechanism and a graded response. A client build header lets the server deliberately tell an unsupported client to reload instead of serving it a shape it will crash on. Forcing an immediate reload risks discarding unsaved work, which is a worse incident than the stale build; and assuming reload behaviour is how the problem exists in the first place. The field should also only have been dropped after read counters showed zero usage across client versions.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `The cache policy underneath all of this -- \`s-maxage\`, \`stale-while-revalidate\`,
\`immutable\` and asset retention -- is **CDN & Edge Delivery**. Release-tagged error rates and
cohort percentiles are the automated rollback signal, which only exists if you built
**Frontend Observability**. Version skew between shell and remotes, and the manifest flip that
fixes it, is **Module Federation & Runtime Integration**, and whether to accept that skew at all is
**Microfrontends**. Migrating a local IndexedDB schema on devices you cannot inspect is the hardest
expand-migrate-contract case, in **Offline-First & Sync**.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why is a frontend deploy not a version replacement?', a: 'You cannot take the old version out of service. Users hold builds in memory until they reload, so production always runs several versions at once and your compatibility window is roughly your p99 session duration.' },
    { q: 'Why must a deploy never delete old assets?', a: 'Browsers hold HTML referencing the previous build\'s hashed chunks. Deleting them makes those dynamic imports 404, producing chunk-load errors and white screens -- often minutes later, on a lazily-loaded route. Retain 30 days.' },
    { q: 'The two-policy caching split for a deployable frontend?', a: 'Hashed assets get `max-age=31536000, immutable`. HTML gets `max-age=0, s-maxage=60, stale-while-revalidate=600`, so deploys propagate in seconds and a bad deploy is a minute of exposure.' },
    { q: 'Why must canary bucketing be deterministic?', a: 'Random per-request assignment gives a user HTML from one build and cached chunks from another. Hash a stable id, compare against the rollout percentage, and persist the result in a cookie set at the edge.' },
    { q: 'Which metrics make a canary gate actually work?', a: 'Unhandled error rate per session, chunk-load error rate specifically, p75 INP and LCP for the cohort, and at least one funnel metric -- compared against concurrent baseline traffic with a minimum sample size.' },
    { q: 'What are the three phases of expand-migrate-contract?', a: 'Expand: add the new thing alongside the old so every live version still works. Migrate: move readers and writers, backfill, and instrument old-path usage by client version. Contract: remove the old path once that usage has been zero longer than your compatibility window.' },
    { q: 'How do you safely kill an endpoint?', a: 'Instrument per-caller usage, announce with `Deprecation` and `Sunset` headers, then brownout -- return 410 for a minute at a quiet hour and see who complains -- before removing. Grepping the codebase misses callers you do not control.' },
    { q: 'Four flag types and their lifecycles?', a: 'Release flags: temporary, 30-90 day expiry enforced by CI. Experiment flags: removed as part of the experiment\'s definition of done. Operational kill switches: permanent, but test the off path. Permission flags: not flags at all -- move them into the authorisation model.' },
    { q: 'What makes per-remote rollback possible in a federated frontend?', a: 'Resolving remote versions from a short-TTL runtime manifest rather than hardcoding URLs in the host build, so rolling back one team\'s remote is a pointer flip that needs no rebuild and no shell deploy.' }
  ],

  drills: [
    {
      prompt: 'You own a frontend serving 3 million daily users. Today a deploy takes 40 minutes, goes to everyone at once, and last month one bad release caused a 25-minute full outage while the team rebuilt and redeployed. Design the deployment system you would put in place, and tell me the order you would build it.',
      probes: [
        'What is your first change, and why that one?',
        'What exactly happens in the first two minutes of a bad deploy?',
        'How do you decide automatically that a canary is bad?',
        'How does a database migration fit into this?'
      ],
      strong: [
        'Starts with content-hashed immutable assets, no-delete deploys and a 30-day retention policy, since that alone converts a class of outage into a non-event.',
        'Separates asset publication from the HTML pointer flip, making rollback a sub-minute pointer change rather than a rebuild.',
        'Sets HTML cache policy explicitly and connects the 60-second edge TTL to the size of the exposure window.',
        'Adds release-tagged telemetry before canarying, acknowledging that canary analysis is impossible without it.',
        'Defines automated gates concretely: error rate per session, chunk-load errors, p75 INP, one funnel metric, versus concurrent baseline, with a minimum sample size.',
        'Uses deterministic cohort bucketing at the edge with a cookie, and explains why random assignment is harmful.',
        'Handles schema and API changes with expand-migrate-contract, contracting on instrumented evidence rather than a date.',
        'Adds flags as a separate release control with typed lifecycles and CI-enforced expiry.'
      ],
      weak: [
        'Jumps straight to blue/green or Kubernetes without addressing asset retention.',
        'Treats rollback as rebuilding the previous commit.',
        'Canaries with a human watching a dashboard as the gate.',
        'No telemetry release tagging, so the rollback signal does not exist.',
        'Plans to deploy frontend and backend changes together as the compatibility strategy.',
        'No answer for users holding old builds.'
      ]
    },
    {
      prompt: 'You are removing a legacy `/api/v1/orders` endpoint. It is called by your web app, an iOS app with versions going back 18 months, two partner integrations you have no contact details for, and an internal reporting script someone wrote in 2021. Plan the removal.',
      probes: [
        'How do you find out who actually calls it?',
        'What is your communication and timeline?',
        'How do you verify it is safe to remove rather than assume?',
        'What if a partner is still calling it on the day you planned to remove it?'
      ],
      strong: [
        'Instruments the endpoint first with per-caller dimensions -- API key, user agent, client build, IP range -- because usage must be measured, not inferred from a grep.',
        'Returns `Deprecation` and `Sunset` headers so automated and partner clients can surface the deadline.',
        'Runs brownouts: 410 for one minute at a low-traffic hour, then progressively longer windows, treating each as a controlled discovery exercise.',
        'Sets the timeline from the slowest client population -- 18 months of iOS versions means a long tail, and app-store update curves, not a wished-for date.',
        'Provides a migration path and keeps the new endpoint feature-complete before starting deprecation.',
        'Defines the removal criterion as instrumented zero usage sustained beyond the compatibility window, and is willing to extend when the data says so.',
        'Plans the failure case: keep the ability to restore the endpoint quickly, since a partner discovering it during removal is the expected outcome, not a surprise.'
      ],
      weak: [
        'Announces a date and removes it on schedule regardless of usage data.',
        'Relies on a codebase search to enumerate callers.',
        'No brownout, so the blast radius is unknown until it is permanent.',
        'Ignores the mobile long tail and app-store update curves.',
        'No rollback path once the endpoint is gone.'
      ]
    }
  ]
};
