/* Practice question bank. Plain ES module, no imports. See CONTENT-SCHEMA.md. */

export default [
  {
    id: 'design-system-platform-40-teams',
    title: 'Design a design-system and component platform for 40 product teams',
    track: 'frontend',
    difficulty: 'core',
    pattern: 'Versioned contracts, tokens as data, adoption over enforcement',
    prompt:
      'You own the design system at a company with 40 product teams, 300 frontend engineers and 9 deployable apps, three of which still ship Angular 12. Design leadership wants a rebrand shipped across every surface in one quarter, and the apps release on independent cadences ranging from continuous to once a month. Your team is eight people and cannot hand-edit 9 codebases.',
    clarify: [
      'Can every consumer app upgrade a package version within a quarter, or do some pin dependencies for compliance reasons? This decides whether the rebrand ships as a code change or as runtime-loaded tokens.',
      'Is the rebrand purely visual (colour, spacing, type) or does it change component anatomy and interaction? Pure visual can ship through tokens; anatomy changes force a breaking major.',
      'Do the Angular and React apps ever render on the same page, for example in an iframe or a shell? If so the CSS reset and token scope must be collision-safe.',
      'Who is accountable when a design-system upgrade breaks a product team\u2019s release: my team or theirs? That determines how much automated migration I have to build versus document.'
    ],
    approach: [
      'Split the system into three independently versioned layers: `@ds/tokens` (JSON design tokens compiled to CSS custom properties), `@ds/primitives` (unstyled behaviour and a11y, React and a thin Angular wrapper), and `@ds/components` (styled compositions). Tokens change without touching component code.',
      'Publish tokens as CSS custom properties on a single `:root` scope plus a `data-ds-theme` attribute selector, so the rebrand ships by swapping one stylesheet at the CDN rather than by bumping 9 package versions.',
      'Version with strict semver and a deprecation policy: a deprecated prop logs a console warning for one minor, throws in dev for the next, and is removed only in the following major, with a minimum six-month window published as a calendar.',
      'Ship a codemod (`jscodeshift`) with every breaking major, run it in CI against the 9 consumer repos nightly, and open the migration PR automatically so the consuming team reviews rather than writes it.',
      'Build adoption telemetry: components emit a build-time manifest of which component and version each app bundles, collected by a Rollup plugin into a dashboard showing per-team adoption, deprecated-API usage and drift.',
      'Treat the Angular apps as tier-2 consumers served by web components wrapping the primitives, so they get tokens and behaviour without a full framework port, and document that new features land in React first.',
      'Gate visual regression with Chromatic or Playwright screenshots on the component library, not on the 9 apps, and give consumers a preview channel (`@ds/components@next`) so breakage is discovered before the stable tag.',
      'Run a contribution model with a small core team plus designated "DS champions" per product team who hold review rights, so the eight-person team is a gatekeeper for API design, not a bottleneck for implementation.'
    ],
    deepdives: [
      {
        q: 'A product team needs a variant your system does not support and ships a fork. How do you handle it?',
        a: 'I treat a fork as a signal of a missing extension point, not a discipline problem. The primitives layer exists exactly so teams can compose their own styled variant without copying behaviour, and I add a documented `asChild` or slot escape hatch plus a token override scope. I then track forked components in the adoption dashboard and prioritise upstreaming the top three each quarter. The failure mode to avoid is refusing the fork, because the team ships it anyway and I lose visibility.'
      },
      {
        q: 'The rebrand ships via a CDN-hosted token stylesheet. What happens when that CDN request fails?',
        a: 'Every app inlines a compiled fallback token block in its own CSS bundle, so the CDN sheet only overrides. A failed fetch means the previous brand renders, which is ugly but functional, rather than an unstyled page. I also pin the token sheet by content hash per app release and roll forward through a manifest, so a bad token push can be reverted at the edge in seconds without any app deploy.'
      },
      {
        q: 'How do you version accessibility fixes that change DOM structure?',
        a: 'A11y fixes that change DOM are breaking in practice even when the public props are unchanged, because consumers write CSS and test selectors against our internal structure. I publish a documented "structure is not API" policy up front, expose stable `data-ds-part` attributes as the sanctioned styling hook, and ship structural fixes in a minor only once tests confirm no `data-ds-part` changed. If a part must change, it is a major with a codemod.'
      },
      {
        q: 'How do you measure whether the design system is actually worth its eight engineers?',
        a: 'I measure time-to-first-screen for a new product surface, the count of distinct button implementations across the estate, the percentage of a11y audit findings originating in DS components versus product code, and adoption-weighted deprecated-API usage. The headline metric I report to leadership is the rebrand itself: engineer-hours spent by product teams on the rebrand, against a baseline estimate of doing it by hand.'
      }
    ],
    redflags: [
      'Proposes a single monolithic `@company/ui` package, so a token change forces all 40 teams to bump a version and coordinate releases.',
      'Says "we will enforce it with a lint rule" without any migration path, codemod or adoption telemetry.',
      'Ignores the three Angular apps entirely or assumes they will be rewritten inside the quarter.',
      'Treats accessibility as a component checklist rather than as a versioned contract with consumers, so a11y fixes silently break product CSS.'
    ],
    topicIds: ['design-systems', 'deployment-and-rollout', 'react-at-scale']
  },
  {
    id: 'jquery-monolith-to-react-migration',
    title: 'Migrate a 2M-line jQuery monolith to React incrementally',
    track: 'frontend',
    difficulty: 'hard',
    pattern: 'Strangler fig, dual-runtime bridges, migration as a product',
    prompt:
      'A 12-year-old B2B admin product is 2M lines of jQuery, Backbone views and server-rendered ERB templates, serving 400k daily users across 1,100 distinct screens. Business will not fund a rewrite freeze: feature delivery must continue at full pace, and the team of 60 engineers has maybe 15 people who know React well. The product also has a 5-year support contract requiring IE-era behaviour on two enterprise screens.',
    clarify: [
      'Is there usage telemetry per screen? If 80% of traffic hits 50 screens, I migrate those and leave the 1,050-screen long tail on jQuery indefinitely, which changes the project from a rewrite to a 12-month effort.',
      'Do jQuery and React need to coexist on the same page, or can I migrate whole routes at a time? Page-level migration avoids a bridge entirely and is worth fighting for.',
      'What is the shared global state today \u2014 a jQuery event bus, globals on `window`, or DOM as the source of truth? That decides how expensive the interop layer is.',
      'Are the two IE-era enterprise screens contractually frozen, meaning I can carve them out into a separately deployed legacy bundle rather than carrying polyfills across the whole app?'
    ],
    approach: [
      'Instrument first: add per-route page-view and interaction telemetry for two weeks, then rank all 1,100 screens by traffic multiplied by change frequency, and publish the ranked list as the migration backlog.',
      'Adopt a strangler-fig routing layer: put a thin router in front that decides per URL whether to serve the legacy ERB shell or the new React shell, driven by a config file so a screen can be flipped back in one deploy.',
      'For pages that genuinely must mix, build one narrow bridge: a `mountReact(el, Component, props)` helper and a `legacyBus` adapter that converts the jQuery event bus into a React context, and forbid any other interop pattern by lint rule.',
      'Freeze the legacy codebase to bug fixes only for migrated areas, and make the rule concrete: any change to a top-100 screen must be done in React, enforced by a CODEOWNERS plus CI check on changed paths.',
      'Extract shared concerns bottom-up before screens: auth session, API client with consistent error handling, and design tokens become framework-neutral packages both runtimes consume, so a migrated screen is not also a re-implementation of the network layer.',
      'Ship behind a per-screen, per-tenant feature flag with automatic rollback on error-rate or task-completion regression, and run the React version shadow-rendered for internal users first.',
      'Solve the skills gap deliberately: pair the 15 React engineers across squads as embedded enablers for one quarter, and invest in a screen-scaffolding generator so the 45 others write React that matches conventions by default.',
      'Carve the two IE-era screens into their own entry point with its own legacy build config, so the main bundle targets modern baseline and the contract is honoured without a global tax.'
    ],
    deepdives: [
      {
        q: 'Two months in, feature delivery has slowed 30% and an executive wants to stop the migration. What do you do?',
        a: 'I would expect this and have instrumented for it: I track lead time and defect rate separately for migrated and unmigrated screens, so I can show whether the slowdown is migration overhead or dual-maintenance of the bridge. If migrated screens are already faster to change, the argument is to accelerate, not stop. If they are not, the honest answer is that my slice boundaries are wrong \u2014 usually too much shared state crossing the bridge \u2014 and I pause new slices to fix the bridge rather than defend the plan.'
      },
      {
        q: 'How do you avoid shipping two design systems and a visibly inconsistent product during the multi-year overlap?',
        a: 'Design tokens ship as CSS custom properties consumed by both runtimes from day one, before any screen migrates, so a colour or spacing change lands in both at once. Component parity is the harder half: I accept that jQuery widgets will not gain new interactions, and I explicitly scope the React components to match the legacy visual contract rather than the new design, deferring visual change to a separate, later, token-only rebrand. Mixing a rewrite with a redesign is how these projects die.'
      },
      {
        q: 'What is your rollback story when a migrated high-traffic screen is subtly wrong \u2014 not broken, just producing different numbers?',
        a: 'Flag flip back to the legacy route is the fast path and must stay available for at least a full release cycle after each screen migrates, which means I keep the legacy code alive rather than deleting it at cutover. For correctness specifically, I run a shadow comparison: the React screen calls the same endpoints and I diff the rendered aggregate values against the legacy ones for a sample of real sessions, alerting on divergence above a threshold before any user traffic flips.'
      },
      {
        q: 'How do you keep the 1,050-screen long tail from becoming permanent technical debt that nobody owns?',
        a: 'I make it explicit rather than accidental. The long tail gets a documented status of "legacy, maintenance only", a named owning team, and a yearly review that either migrates or deletes based on usage. Screens below a usage threshold are candidates for deletion, and deleting a screen is cheaper than migrating it \u2014 I would expect 15 to 20% of 1,100 screens to have effectively zero users. The failure mode is a migration that is declared "done" at 60% with no decision recorded about the rest.'
      }
    ],
    redflags: [
      'Proposes a big-bang rewrite or a feature freeze without addressing that the business has explicitly refused one.',
      'Designs an elaborate two-way state-sync bridge between jQuery and React instead of picking route-level boundaries that avoid shared state.',
      'Has no telemetry-driven ordering, so the migration starts with whichever screen is most interesting rather than highest traffic times churn.',
      'Bundles a visual redesign into the migration, which makes every regression ambiguous and every rollback a product decision.'
    ],
    topicIds: ['react-at-scale', 'deployment-and-rollout', 'microfrontends']
  },
  {
    id: 'collaborative-document-editor',
    title: 'Design a collaborative document editor',
    track: 'frontend',
    difficulty: 'hard',
    pattern: 'CRDT vs OT, intention preservation, offline convergence',
    prompt:
      'Build a Google-Docs-style editor for a product with documents up to 200 pages, typically 3 concurrent editors but occasionally 60 during a live review session. Users expect edits to feel instant on a 300 ms RTT connection and expect to keep editing on a plane with no network for up to four hours. Legal requires a full, replayable edit history with named attribution for seven years.',
    clarify: [
      'Do we need rich structure (tables, nested lists, comments anchored to ranges) or is it plain text with inline marks? Anchored comments and tables are what make CRDT selection genuinely hard.',
      'Is four hours offline a real requirement or aspirational? A long offline window rules out server-authoritative OT and forces a CRDT with a document-level merge story.',
      'Does the seven-year history need to be legally replayable operation-by-operation, or is a periodic immutable snapshot with attribution sufficient? Op-level replay dictates the storage model.',
      'Can a document be locked or is concurrent editing of the same paragraph expected during the 60-user review sessions? Reviews are usually comment-heavy and edit-light, which changes the hot path.'
    ],
    approach: [
      'Choose a sequence CRDT (Yjs `Y.XmlFragment` or an RGA variant) over OT, because the four-hour offline requirement means clients must merge without a central sequencer, and CRDT convergence does not depend on server-ordered transforms.',
      'Model the document as a tree of CRDT types: `Y.XmlFragment` for block structure, `Y.Text` with formatting attributes for inline marks, and a separate `Y.Map` keyed by comment id for anchored comments, so a comment anchor survives concurrent text edits via relative positions.',
      'Transport updates over a WebSocket with binary Yjs update messages, batched on a 20 ms debounce, and fall back to long-poll for corporate proxies; local edits apply optimistically to the shared type first so keystroke latency is unaffected by the 300 ms RTT.',
      'Persist on the server as an append-only log of CRDT updates plus periodic compacted snapshots every 500 updates, so load time is one snapshot plus a short tail instead of replaying the whole history.',
      'Keep an IndexedDB-backed local provider so an offline client accumulates updates durably and syncs the diff on reconnect using state vectors, exchanging only missing updates rather than the whole document.',
      'Handle the 60-editor case by sharding awareness (cursors and presence) onto a separate ephemeral channel with its own throttle at 10 Hz, because presence is the message volume problem, not the edits.',
      'Bound CRDT tombstone growth with a garbage-collection pass that runs when no client has an outstanding state vector older than the GC horizon, and enforce a document size cap with a user-visible split suggestion at 200 pages.',
      'Satisfy legal by writing a parallel, human-meaningful audit stream: every update batch is attributed to an authenticated user id and timestamp and appended to immutable object storage with a periodic hash chain, independent of the CRDT log used for convergence.'
    ],
    deepdives: [
      {
        q: 'A user edits offline for four hours while the document is heavily restructured online. What does the merge produce, and is that acceptable?',
        a: 'CRDT merge guarantees convergence, not intention. If a colleague deleted the section the offline user was rewriting, the merge typically resurrects nothing and the offline text lands orphaned or inside an unexpected parent. My answer is to detect this rather than pretend it does not happen: on reconnect I compare the offline client state vector distance against a threshold, and above it I present a review UI showing the offline changes as a suggested diff the user confirms, rather than silently merging. Correctness is a product decision at that point, not an algorithmic one.'
      },
      {
        q: 'Why not OT, given Google Docs shipped OT successfully?',
        a: 'OT needs a central server that totally orders operations and transforms each incoming op against the ops it missed. That works extremely well for short offline windows and gives smaller payloads and no tombstones. It fails my four-hour offline requirement, because transform chains grow with divergence and the transform functions for rich structure like tables are notoriously hard to prove correct. I would pick OT if offline were capped at seconds and I controlled a single-region server, and I would say so explicitly rather than treating CRDT as universally better.'
      },
      {
        q: 'The server falls over mid-session. What do users see and what is lost?',
        a: 'Clients keep editing against their local CRDT, so typing never blocks; the UI shows a degraded "reconnecting, changes saved locally" state driven by the provider connection status. On recovery the state-vector exchange replays missing updates in both directions, so nothing is lost as long as the client survives. The genuine risk is the client closing before reconnect, which is why the IndexedDB provider persists updates synchronously before the network attempt. Server-side, the append-only log means recovery is replaying from the last durable snapshot.'
      },
      {
        q: 'How do you migrate the document schema when you add a new block type two years in, with millions of stored documents?',
        a: 'I version the document at the CRDT root with a `schemaVersion` field and make every reader tolerant of unknown block types, rendering them as an opaque preserved node rather than dropping them, so an old client never destroys new content. Migrations run lazily on open, writing the upgraded structure back as ordinary CRDT operations attributed to a system user, and I hold a minimum-supported-client version so a client too old to preserve unknown nodes is forced to upgrade before it can write.'
      },
      {
        q: 'How do you keep the editor responsive on a 200-page document?',
        a: 'Rendering is virtualised at the block level with an estimated-height windowing layer, and the CRDT observer emits granular deltas so only touched blocks re-render rather than the whole tree. Formatting operations over a large selection are applied as a single transaction so observers fire once. The number I hold myself to is keystroke-to-paint under 16 ms at p95 on a mid-range laptop with the full document loaded, measured with a synthetic 200-page fixture in CI, because this regresses silently otherwise.'
      }
    ],
    redflags: [
      'Says "use a CRDT" without naming which CRDT family or acknowledging tombstone growth and its garbage-collection conditions.',
      'Treats cursor and presence traffic as the same channel as edits, then is surprised that 60 users generate more presence messages than edits.',
      'Claims CRDTs guarantee the merge is what the user intended, rather than only that all replicas converge to the same state.',
      'Has no snapshot strategy, so opening a document means replaying an unbounded operation log.'
    ],
    topicIds: ['collaborative-editing', 'offline-and-sync', 'realtime-frontend']
  },
  {
    id: 'realtime-trading-dashboard',
    title: 'Design a realtime trading dashboard handling 10k updates per second',
    track: 'frontend',
    difficulty: 'hard',
    pattern: 'Backpressure in the browser, coalescing, render budget as a constraint',
    prompt:
      'Traders watch a dashboard with 400 visible instruments, a depth-of-book panel and a P&L strip. The market feed pushes 10,000 price updates per second at peak, bursting to 40,000 on an open. Traders will fire you if a price is more than 250 ms stale, and compliance requires that any price a trader acted on is reconstructable, so you cannot simply drop updates without a record.',
    clarify: [
      'Does every one of the 10k updates need to reach the UI, or only the latest value per instrument? Last-value-wins per symbol collapses 10k/s into at most 400 renders/s and is the whole design.',
      'Is the compliance reconstruction requirement about what was *displayed* or what the *server sent*? If the server log suffices, the client can coalesce freely; if it is about the display, I must log render decisions.',
      'What is the display precision \u2014 do traders perceive a change under 5 ms of freshness difference, or is the real requirement "never show a price older than 250 ms"? A staleness bound is far cheaper than a throughput target.',
      'Are traders on managed hardware with a known browser and CPU, or arbitrary laptops? A known floor lets me budget frames precisely rather than design for the worst device.'
    ],
    approach: [
      'Terminate the feed in a `SharedWorker` so one WebSocket serves all open tabs, decode binary frames (protobuf or a fixed-layout `ArrayBuffer`) off the main thread, and never pass JSON across the worker boundary.',
      'Maintain the authoritative price map inside the worker as a `Map<symbolId, latestTick>` with last-value-wins coalescing, so burst traffic mutates memory rather than queuing work for the UI thread.',
      'Drive the UI from a `requestAnimationFrame` pull loop: each frame the main thread asks the worker for the set of symbols that changed since the last frame and receives one transferable buffer, capping UI work at 60 messages per second regardless of feed rate.',
      'Render the grid with virtualisation so only the roughly 40 visible rows mount, and write price cells by mutating `textContent` and a CSS class through a direct DOM ref rather than through React reconciliation, keeping React for structure and layout only.',
      'Enforce a staleness contract: each tick carries a server timestamp, and any cell whose latest tick is older than 250 ms renders in a visually distinct stale state, so degradation is visible to the trader rather than silent.',
      'Apply explicit backpressure upstream: the worker tracks its own lag, and past a threshold it asks the server to switch the subscription from full tick to conflated 100 ms snapshots for non-focused instruments, keeping the focused instrument on the full feed.',
      'Satisfy compliance with a server-side authoritative tick archive keyed by session, plus a lightweight client log of which symbol versions were painted per frame, batched and shipped every 5 seconds, so display reconstruction does not cost per-tick network traffic.',
      'Budget explicitly: a frame is 16 ms, of which I allocate 4 ms to decoding, 6 ms to DOM writes and leave headroom, and I fail the CI performance test if a synthetic 40k/s replay exceeds a p99 frame time of 16 ms.'
    ],
    deepdives: [
      {
        q: 'At market open the feed bursts to 40k/s and the worker starts falling behind. What degrades, and who decides?',
        a: 'The worker measures queue depth and processing lag. Past the threshold it degrades in a fixed, documented order: first it conflates off-screen instruments, then non-focused visible instruments to 100 ms snapshots, and only the focused instrument and the depth-of-book stay at full rate. This ordering is a product decision made in advance with the trading desk, not an emergent one, and the UI shows a persistent "conflated feed" indicator so the trader knows the mode they are in. Silent degradation on a trading screen is worse than a visible slowdown.'
      },
      {
        q: 'Why not use React state for prices, given React is already in the app?',
        a: 'Every tick through React state means a reconciliation pass, and even with memoisation 400 components reconciling at feed rate blows the frame budget. I keep React responsible for what is structural and slow-changing \u2014 which instruments are in the grid, layout, panel composition \u2014 and drive the numeric cells imperatively through refs subscribed to the worker. This is a deliberate escape hatch with a clear boundary, not a rejection of React, and I would enforce it with a lint rule so nobody re-introduces `setState` in the tick path.'
      },
      {
        q: 'The WebSocket drops for 8 seconds. What is on screen when it comes back?',
        a: 'During the drop every cell crosses the 250 ms staleness threshold and renders stale, which is the correct behaviour: a trader must never see a confident-looking stale price. On reconnect the client does not replay the gap \u2014 replaying 8 seconds of ticks is both useless and expensive \u2014 it requests a full snapshot of current values for subscribed symbols, applies it atomically, and then resumes the delta stream from the snapshot sequence number. I also log the outage window to the compliance stream so the gap is reconstructable.'
      },
      {
        q: 'How would you know in production that traders are actually seeing fresh prices?',
        a: 'I instrument end-to-end staleness rather than component render times: each painted frame samples the age of the oldest visible tick and reports a p50, p95 and p99 histogram per session, tagged with device class and feed mode. The SLO is "p99 visible staleness under 250 ms during market hours", and I alert on it directly. Frame rate alone lies here \u2014 a dashboard can hold 60fps while showing prices from two seconds ago.'
      }
    ],
    redflags: [
      'Puts every tick through React state or a global store and relies on `React.memo` to save it.',
      'Treats 10,000 updates per second as 10,000 renders per second, never proposing last-value-wins coalescing per symbol.',
      'Drops updates under load without making the degraded mode visible to the trader or recording it for compliance.',
      'Parses JSON on the main thread and never mentions a worker or a binary wire format.'
    ],
    topicIds: ['realtime-frontend', 'web-performance', 'browser-rendering']
  },
  {
    id: 'offline-field-service-app',
    title: 'Design an offline-capable field-service mobile web app',
    track: 'frontend',
    difficulty: 'core',
    pattern: 'Local-first writes, sync queue, conflict policy per entity',
    prompt:
      'Technicians visit basements, lifts and rural sites with no connectivity for up to 8 hours, completing work orders that include checklists, parts consumption from inventory, photos and a customer signature. A shift generates up to 40 work orders and 200 photos on a mid-range Android device. Parts inventory is shared across technicians, so two people can claim the last unit of a part while both are offline.',
    clarify: [
      'Which entities are truly last-write-wins and which need server arbitration? Checklist answers are personal and safe to merge; parts inventory is contended and cannot be resolved on the client.',
      'Is a signed work order legally binding at the moment of signature, or only once synced? That determines whether an offline completion can ever be rejected by the server.',
      'What device storage can I assume? 200 full-resolution photos is roughly 800 MB, which exceeds typical origin quota and forces compression or eager upload decisions.',
      'Can technicians be assigned work orders mid-shift, or is the day\u2019s route fixed at login? A fixed route means I can prefetch everything and never need a partial-sync protocol.'
    ],
    approach: [
      'Make the local IndexedDB store the source of truth for the UI: every screen reads from local data only, and the network is an asynchronous replication detail, so the app has no separate "offline mode" code path to rot.',
      'Prefetch the whole shift at login: the route, all work order details, the relevant parts catalogue and the customer history, in one bundled request, and show an explicit "ready for offline" state before the technician leaves signal.',
      'Model writes as an append-only outbox of intent records (`consumePart`, `answerChecklist`, `completeOrder`) rather than as document mutations, so the sync protocol replays business intentions the server can validate, not blind state overwrites.',
      'Compress photos on capture to roughly 1,600 px longest edge as WebP at quality 0.7, target under 300 KB each, store the blob in IndexedDB, and upload opportunistically via Background Sync with resumable multipart so a 2-minute signal window makes progress.',
      'Define conflict policy per entity in one table: checklist answers are last-write-wins by device clock with server timestamp tie-break, photos are additive and never conflict, and parts consumption is server-arbitrated with an optimistic local reservation.',
      'On sync, send the outbox in order with a per-record idempotency key so a retried batch cannot double-consume a part, and have the server return per-record accept or reject with a reason code.',
      'Surface rejections as a first-class inbox in the UI \u2014 "2 of your 40 orders need attention" \u2014 with the specific resolution action, rather than silently discarding or silently retrying.',
      'Ship the app as an installable PWA with a versioned service-worker precache and a strict rule that an app-shell update never activates mid-shift, deferring activation until the outbox is empty and the technician is idle.'
    ],
    deepdives: [
      {
        q: 'Two technicians both consume the last unit of a part while offline. Walk through what happens.',
        a: 'Both devices optimistically record consumption locally and both complete their work orders, because blocking the technician in a basement is not an option. On sync, the server applies the intents in arrival order; the first succeeds and the second gets a rejection with reason `INSUFFICIENT_STOCK`. The losing technician sees a resolution task, not a data-loss message: the order stays complete, but a parts discrepancy is raised and routed to the depot. The design point is that inventory truth lives on the server and the client only ever holds a reservation it may lose.'
      },
      {
        q: 'How do you handle a service-worker update that changes the local database schema, while a technician has 40 unsynced orders?',
        a: 'Schema migrations run in the IndexedDB `upgradeneeded` handler and must be forward-only and non-destructive, never dropping an outbox table. I gate activation: the new service worker installs but does not `skipWaiting` while the outbox is non-empty, so a technician mid-shift keeps the code version that wrote their pending data. I also keep the outbox record format independently versioned from the app, and the server accepts the last two outbox versions, so a device that was offline across two releases can still drain.'
      },
      {
        q: 'The device clock is wrong by three hours. What breaks?',
        a: 'Anything using device time for ordering or last-write-wins conflict resolution breaks, and skewed clocks are common on rugged field devices. I record both a device timestamp and a monotonic per-device sequence number on every outbox record, and the server stamps its own receipt time. Ordering within a device uses the sequence number, which is skew-proof; ordering across devices uses server receipt time. I also capture the device-to-server clock offset at login and display a warning if it exceeds a few minutes, because a wrong timestamp on a signed work order is a legal problem, not just a sync one.'
      },
      {
        q: 'How do you debug a sync failure that only happens on one technician\u2019s device in a rural area?',
        a: 'I cannot reproduce it, so I design for postmortem evidence. Every sync attempt writes a structured local log entry \u2014 outbox depth, batch id, network type, response code, duration \u2014 kept in a ring buffer of the last 500 entries in IndexedDB, and there is a "send diagnostics" action that uploads the buffer plus the outbox contents when connectivity returns. Server-side I correlate by device id and idempotency key. Without this, offline bugs are unfalsifiable stories.'
      }
    ],
    redflags: [
      'Applies one global conflict strategy to every entity, so contended inventory is resolved by last-write-wins on the client.',
      'Stores mutations as full document overwrites rather than as intents, making server-side validation and partial rejection impossible.',
      'Uploads full-resolution photos with no compression, resumability or quota planning, then blames the network.',
      'Assumes `navigator.onLine` is a reliable signal of connectivity rather than treating every request as potentially failing.'
    ],
    topicIds: ['offline-and-sync', 'state-management', 'web-performance']
  },
  {
    id: 'video-streaming-player-ui',
    title: 'Design a video streaming player UI',
    track: 'frontend',
    difficulty: 'core',
    pattern: 'ABR feedback loops, buffer as state, startup versus stability',
    prompt:
      'You own the web player for a streaming service with 30M monthly users across 190 countries, half on connections under 5 Mbps and a third on TVs and set-top browsers with 512 MB of RAM. Product wants time-to-first-frame under 1 second and a rebuffer ratio under 0.4%, and the content team insists on DRM for premium titles, which rules out simply preloading everything.',
    clarify: [
      'What is the content mix \u2014 long-form 90-minute films or short 3-minute clips? Startup latency dominates short-form economics, while rebuffering dominates long-form, and they pull the ABR ladder in opposite directions.',
      'Do we control the CDN and the packaging, or is the manifest fixed by a third party? Owning the ladder lets me add a low-bitrate startup rung, which is the cheapest win for time-to-first-frame.',
      'Are the TV browsers running a modern Media Source Extensions implementation, or do some need native HLS playback? That splits the player into two very different code paths.',
      'Is the 0.4% rebuffer ratio measured per session or per playback hour, and is a single 300 ms stall counted the same as a 10 second one? The definition changes which ABR strategy wins.'
    ],
    approach: [
      'Build on Media Source Extensions with a segment-based ABR engine (shaka-player or hls.js as the base rather than a bespoke engine), and fall back to native HLS on platforms where MSE is absent or broken.',
      'Cut time-to-first-frame by starting at the lowest rung of the ladder for the first two segments, using 2-second segments at the start and 6-second segments thereafter, and issuing the manifest and first-segment requests in parallel with DRM licence acquisition rather than serialised after it.',
      'Preconnect and preload at page level: `preconnect` to the CDN and licence server on hover of a title card, and warm the manifest request on intent-to-play rather than on click, which typically buys 200 to 400 ms.',
      'Drive ABR with a hybrid signal \u2014 throughput estimate (EWMA over recent segments) gated by current buffer level \u2014 so the player only steps up when buffer exceeds a safety threshold, and steps down immediately on buffer decline regardless of throughput optimism.',
      'Cap buffer memory by platform: 30 seconds of forward buffer on desktop, 10 on the 512 MB TV class, with explicit `SourceBuffer` eviction behind the playhead, because unbounded buffering is the top cause of crashes on constrained devices.',
      'Separate the UI layer completely from the playback engine with an event-driven state machine (`idle`, `loading`, `playing`, `seeking`, `rebuffering`, `error`), so UI regressions cannot stall playback and the same engine drives TV, mobile and desktop shells.',
      'Handle DRM explicitly: request the licence early, cache the licence per session where the policy allows, and map every Encrypted Media Extensions error to a user-actionable message rather than a generic failure, since DRM errors are a large share of real-world playback failure.',
      'Instrument the four numbers that matter \u2014 time to first frame, rebuffer ratio, average bitrate delivered and playback failure rate \u2014 as a beacon on every session, sliced by CDN, device class and country, because the ABR change that helps Germany often hurts Indonesia.'
    ],
    deepdives: [
      {
        q: 'Throughput collapses mid-stream from 8 Mbps to 600 kbps. Describe exactly what the player does over the next 10 seconds.',
        a: 'The buffer level is the fast signal, not throughput. As soon as buffer stops growing the engine stops considering up-switches; once buffer drops below the panic threshold, typically 5 seconds, it abandons the in-flight segment request rather than waiting for it, switches to the lowest rung, and re-requests the same segment at that rung. Abandoning the in-flight request is the step people miss \u2014 waiting for a stalled high-bitrate segment to complete is what turns a downshift into a rebuffer. If buffer hits zero anyway, the UI enters an explicit rebuffering state with a spinner after 300 ms, not instantly, to avoid flashing on micro-stalls.'
      },
      {
        q: 'One CDN in one region starts serving 15% of segment requests with 5-second latency. How does the player respond and how do you detect it centrally?',
        a: 'Per-session, the engine applies a request timeout well below the buffer safety margin and retries on an alternate CDN host from the manifest\u2019s redundant base URLs, with a small amount of jitter so a whole region does not stampede the backup. Centrally, the segment-latency beacon sliced by CDN and region is what surfaces it: I alert on p95 segment latency per CDN-region pair, not on aggregate, because 15% of one region is invisible in a global average. The remediation lever is a server-side manifest change shifting weight away from that CDN, which takes effect for new sessions without a client deploy.'
      },
      {
        q: 'How do you ship an ABR algorithm change safely to 30M users?',
        a: 'ABR changes are notoriously non-monotonic: a change that lifts average bitrate can raise rebuffering in exactly the markets that matter. I ship it as a server-controlled config, not a code deploy, hold it at 1% for 48 hours to cover a full diurnal cycle, and evaluate on a fixed metric hierarchy where rebuffer ratio is a guardrail that can veto a bitrate win. I require the experiment to be positive or neutral in every device-class and country segment above a traffic floor, because the aggregate will hide a regression in low-bandwidth markets.'
      },
      {
        q: 'The 512 MB TV devices crash after about 40 minutes of playback. How do you approach it?',
        a: 'I would assume memory growth in the buffer or in the UI before assuming a platform bug. First step is to confirm with a long-soak test on real hardware, sampling `SourceBuffer.buffered` ranges and any available memory API over time. The usual culprits are failing to evict buffered ranges behind the playhead, retaining decoded thumbnail images for the scrub bar, and accumulating event listeners on each segment append. The fix is a hard cap on both forward and backward buffer, a bounded thumbnail cache, and a UI layer that mounts once rather than per state change.'
      }
    ],
    redflags: [
      'Picks the ABR rung from bandwidth alone, with no buffer-level gate, and never mentions abandoning an in-flight segment on a downswitch.',
      'Ignores device memory constraints and buffers aggressively everywhere, which is precisely what kills set-top browsers.',
      'Treats DRM as a checkbox rather than as a latency contributor on the startup critical path and a major source of real failures.',
      'Reports only aggregate rebuffer ratio, with no slicing by CDN, country or device class.'
    ],
    topicIds: ['web-performance', 'cdn-and-edge', 'frontend-observability']
  },
  {
    id: 'ecommerce-core-web-vitals-global',
    title: 'Design an e-commerce storefront optimised for Core Web Vitals at global scale',
    track: 'frontend',
    difficulty: 'core',
    pattern: 'Per-route rendering strategy, critical path budget, third-party containment',
    prompt:
      'A retailer does $4B a year across 20 countries, and organic search drives 60% of revenue, so Core Web Vitals affect ranking and conversion directly. The current site is a client-rendered SPA with an LCP p75 of 4.2 seconds on mobile and 11 third-party tags that marketing refuses to remove, including a tag manager that can inject arbitrary scripts. Peak traffic is 30x baseline during a 4-hour flash sale.',
    clarify: [
      'Which routes actually earn the revenue \u2014 product detail pages from search, or the logged-in account area? Rendering strategy should be chosen per route, and there is no reason to server-render the account dashboard.',
      'Is the tag manager under any governance at all, or can marketing push a script to production without engineering review? If it is ungoverned, no amount of first-party optimisation will hold p75.',
      'Is pricing or availability personalised per user? Personalised content is what decides whether product pages can be statically cached at the edge or must be dynamically rendered.',
      'What is the p75 device and network in the largest markets? A 4.2 s LCP driven by a mid-range Android on 4G in Brazil needs a different fix than one driven by payload size in Germany.'
    ],
    approach: [
      'Set a rendering strategy per route: product listing and product detail pages become statically generated with incremental revalidation at the edge, the cart and checkout are server-rendered per request, and the account area stays client-rendered.',
      'Move personalised fragments out of the cached HTML: render the page with a generic price and stock, then hydrate personalised deltas from a single edge endpoint, so one HTML document serves every user in a locale and the CDN hit rate goes above 95%.',
      'Attack LCP directly: the hero product image is served as AVIF with a `fetchpriority="high"` preload in the document head, sized with explicit width and height to avoid layout shift, and served from the same origin as the HTML so no extra connection is needed.',
      'Enforce a critical-path budget in CI: 140 KB compressed JavaScript before interaction on product detail, measured by Lighthouse CI on a throttled mid-range Android profile, with the build failing on regression rather than a dashboard nobody reads.',
      'Contain third parties rather than fight them: load all 11 tags through Partytown or an equivalent worker sandbox where compatible, load the rest with `async` after the LCP element has painted, and apply a `Content-Security-Policy` that constrains what the tag manager can inject.',
      'Give marketing a governed path: a staging tag container, an automated Lighthouse check on every tag change, and a published performance budget that a tag must fit into, so the conversation is about a number rather than about permission.',
      'Handle the 30x flash sale by making the surge path fully static: the sale landing page and its product pages are pre-rendered and pushed to the CDN before the sale, the inventory counter is a separate lightweight polling endpoint with a short TTL, and origin is protected by a request-collapsing shield.',
      'Measure with field data, not lab data: collect real Core Web Vitals with the `web-vitals` library attributed to route, country, device class and A/B variant, and hold the p75 LCP target per country rather than globally.'
    ],
    deepdives: [
      {
        q: 'Marketing adds a tag two weeks after launch and LCP p75 goes from 2.1 s to 3.4 s. How does your system respond?',
        a: 'This is the expected steady-state failure, so the response has to be automated. Field RUM alerting on p75 LCP per route with a 24-hour window flags it, and because I attribute the beacon to the tag container version I can identify the change without guessing. The structural fix is that new tags land in the worker sandbox by default and only get main-thread access by exception, and the tag container is versioned and revertible independently of a site deploy, so the mitigation is a container rollback in minutes rather than a negotiation with marketing.'
      },
      {
        q: 'Edge caching product pages means a price change can serve stale. How do you bound that?',
        a: 'I separate the two failure costs: a stale marketing description is harmless, a stale price is a legal and trust problem. So price and stock are never in the cached HTML \u2014 they come from the personalised delta endpoint with a 10-second TTL and a stale-while-revalidate window. The cached HTML carries a price placeholder with the last-known value rendered in a visually stable way so LCP is unaffected, and the checkout re-validates the price server-side at order creation, which is the only place correctness actually has to hold.'
      },
      {
        q: 'Your INP is poor on the product listing page despite a good LCP. Where do you look first?',
        a: 'INP is a main-thread contention problem, so I look at long tasks during interaction rather than at bundle size. The usual causes on a listing page are a filter change triggering a synchronous re-render of hundreds of cards, hydration of the entire page rather than islands, and third-party scripts doing work on scroll. I would profile with the Long Animation Frames API in the field to attribute the blocking script, then fix in order: yield with `scheduler.yield` in the filter handler, virtualise the grid, and move analytics listeners off the interaction path.'
      },
      {
        q: 'How do you prove the performance work actually moved revenue, and not just the metric?',
        a: 'I run it as an A/B test on the real funnel rather than inferring from a correlation study. The variant gets the optimised rendering path, the control does not, split at the edge so both see identical inventory and pricing, and I measure conversion rate and revenue per session as the primary metric with LCP and INP as the mechanism metrics. I would be honest that the effect size is usually small per release and needs weeks of traffic to detect, and that the stronger business case for the SEO-driven 60% is ranking, which I would track with Search Console impressions rather than claim from the A/B test.'
      }
    ],
    redflags: [
      'Proposes server-side rendering for the entire site uniformly, including the logged-in account area, with no per-route reasoning.',
      'Says "remove the third-party tags" as the plan, when the prompt states marketing refuses, showing no containment or governance strategy.',
      'Optimises against Lighthouse lab scores only, with no field RUM sliced by country and device.',
      'Caches personalised price or stock in the edge-cached HTML and has no revalidation at checkout.'
    ],
    topicIds: ['rendering-strategies', 'web-performance', 'cdn-and-edge']
  },
  {
    id: 'browser-feature-flag-sdk',
    title: 'Design a feature-flag and experimentation SDK for the browser',
    track: 'frontend',
    difficulty: 'core',
    pattern: 'Local evaluation, flicker avoidance, exposure correctness',
    prompt:
      'Build the browser SDK for an internal experimentation platform used by 9 web properties with 80M monthly users. Product teams want targeting by user attributes, gradual rollouts and holdout groups. The constraint that makes it hard: the SDK must add under 12 KB compressed, must not delay first paint, and must never show the control variant and then flip to the treatment, because that flicker both looks broken and poisons the experiment analysis.',
    clarify: [
      'Are flags evaluated for a known, authenticated user at request time, or for an anonymous visitor before any identity exists? Anonymous-first is what creates the flicker problem, and it may be solvable at the edge instead of in the browser.',
      'Do we control the HTML response, or is the SDK dropped into pages we do not own? Controlling the response lets me inline the evaluated flag payload and eliminate the client fetch entirely.',
      'Are targeting rules allowed to reference attributes the client does not have, like a server-side segment or a purchase history? That decides between local evaluation and a remote evaluation call.',
      'How quickly must a kill-switch flag propagate \u2014 seconds, or is the next page load acceptable? A true kill switch and an experiment flag have very different freshness requirements.'
    ],
    approach: [
      'Evaluate flags locally from a downloaded ruleset rather than calling an evaluation API per flag, so flag reads are synchronous and add zero network latency to the render path.',
      'Inline the evaluated payload into the HTML document for the flags needed above the fold: the edge worker evaluates against the request cookie and injects a small JSON blob plus the correct CSS variant class, so the first paint is already the treatment and flicker is structurally impossible.',
      'Bootstrap the SDK from that inlined payload, then asynchronously fetch the full ruleset for below-the-fold and later-navigation flags, with the ruleset cached in `localStorage` keyed by ruleset version and an `ETag` revalidation.',
      'Assign variants with a deterministic hash \u2014 `murmur3(flagKey + ":" + bucketingId) % 10000` \u2014 so assignment is stable across devices and sessions without any server round trip, and the same function runs identically in the server SDK.',
      'Separate exposure from evaluation: reading a flag does not log an exposure; the SDK fires an exposure event only when the variant actually affects what the user saw, via an explicit `trackExposure` call or an intersection-observed component wrapper.',
      'Batch exposure events with a 2-second flush, `navigator.sendBeacon` on `visibilitychange`, and deduplicate per session so a component rendering 50 times does not log 50 exposures and skew the denominator.',
      'Keep the bundle under budget by shipping the evaluation engine only \u2014 no analytics SDK, no polyfills, no date library \u2014 tree-shakeable named exports, and a size check in CI that fails the build at 12 KB compressed.',
      'Give kill switches a separate, faster channel: a tiny always-fresh endpoint with a 10-second TTL carrying only the kill-switch flags, so a bad rollout is stopped without waiting for ruleset cache expiry.'
    ],
    deepdives: [
      {
        q: 'Why is flicker an analysis problem and not just a cosmetic one?',
        a: 'If the control renders first and then flips to treatment, users who bounce in that window are counted in the experiment but never saw the treatment, and users who did see the flip had a worse experience caused by the SDK rather than by the feature. Both bias the result, usually against the treatment, and the bias correlates with connection speed, so it hits exactly the users a performance-sensitive experiment cares about. The fix has to be structural \u2014 evaluate before paint \u2014 rather than hiding the page with an anti-flicker overlay, which just converts a visual bug into an LCP regression.'
      },
      {
        q: 'The ruleset fetch fails or the CDN serves a stale ruleset. What variant does a user get?',
        a: 'Every flag has an explicitly declared default in the calling code, and a failed fetch means defaults are used and no exposure is logged, so the experiment simply loses that user rather than recording them incorrectly. Staleness is bounded by version: the ruleset carries a monotonic version and a generation timestamp, and the SDK refuses rulesets older than a configured max age, falling back to defaults. I also report a `sdk_ruleset_stale` metric, because silent degradation to defaults across a region would otherwise look like a null experiment result rather than an outage.'
      },
      {
        q: 'An anonymous visitor gets bucketed, then logs in. How do you avoid them switching variants mid-session?',
        a: 'Bucketing uses a stable `bucketingId` that starts as a first-party cookie generated on first visit and is never regenerated. On login the SDK does not re-bucket; instead it emits an identity-link event associating the anonymous id with the user id, and analysis resolves the link downstream. Re-bucketing on login is the common bug: it changes the variant mid-session, double-counts the user, and makes login itself look like it causes the treatment effect. For cross-device consistency I would offer an opt-in mode that switches the bucketing id to the user id at the cost of one mid-session switch, but only for experiments where that is explicitly acceptable.'
      },
      {
        q: 'How does a product team safely roll out a flag to 50% when the flag controls a schema-affecting behaviour?',
        a: 'Flags that change persisted data are not experiments and I would push back on treating them as one. The pattern is a multi-stage rollout where writes are made forward-compatible first behind a separate flag at 100%, then the read path flips gradually, then the old write path is removed \u2014 three deploys, not one flag. The SDK supports this by allowing dependent flags with a declared prerequisite, and by exposing flag state to the server SDK through the same ruleset so client and server never disagree about which write format is active.'
      }
    ],
    redflags: [
      'Fetches flag values over the network on page load and hides the page with an anti-flicker overlay until it resolves.',
      'Logs an exposure every time a flag is read, inflating the denominator and making the experiment unanalysable.',
      'Re-buckets the user when they log in, so variant assignment changes mid-session.',
      'Uses a random or non-deterministic assignment that is not reproducible from the bucketing id, making server and client disagree.'
    ],
    topicIds: ['deployment-and-rollout', 'state-management', 'web-performance']
  },
  {
    id: 'frontend-rum-observability-pipeline',
    title: 'Design a frontend observability and RUM pipeline',
    track: 'frontend',
    difficulty: 'core',
    pattern: 'Sampling with intent, attribution over aggregation, cost per insight',
    prompt:
      'You need real-user monitoring across 9 web properties with 80M monthly users generating roughly 2B page views a month. Engineering wants errors with usable stack traces, Core Web Vitals attributed to code, and session replay for support escalations. Finance has capped the observability bill at $30k a month, and legal requires that no personal data leaves the browser, including anything typed into a form.',
    clarify: [
      'What decisions will this data actually drive \u2014 release gating, per-team performance SLOs, or support triage? Each needs a different sampling strategy and I cannot afford all three at full fidelity.',
      'Is the 2B page views figure evenly spread or dominated by a few high-traffic, low-value routes? Head-heavy traffic means uniform sampling wastes almost the entire budget on pages nobody debugs.',
      'Does "no personal data" mean redaction at the client or is a processing agreement with a vendor acceptable? Client-side redaction is far more defensible and constrains session replay heavily.',
      'Do we need to correlate a frontend error with the backend trace that caused it? If yes, trace context propagation has to be in the SDK from day one, not retrofitted.'
    ],
    approach: [
      'Split the pipeline into three streams with independent sampling: errors at 100% with client-side deduplication, Web Vitals at a fixed 5% head sample, and session replay at effectively 0% baseline but triggered on-demand.',
      'Deduplicate errors in the browser before sending: hash the normalised message plus the top three stack frames, keep a per-session `Set`, and send a count rather than N events, which typically cuts error volume by an order of magnitude because one broken component fires continuously.',
      'Upload source maps at build time to a private store, never serve them publicly, and symbolicate server-side keyed by the bundle hash embedded in the error payload, so stack traces are usable without exposing source.',
      'Attribute Web Vitals to code, not just to URLs: capture the LCP element selector, the INP interaction target and the Long Animation Frames script attribution, so a regression points at an owning team instead of at a page.',
      'Make session replay pull-based: the SDK buffers a rolling 30-second `rrweb` recording in memory and only uploads when triggered by an unhandled error, a support-initiated flag, or a rage-click heuristic, which keeps replay under a fraction of a percent of sessions.',
      'Enforce privacy at capture: mask all input values by default with an explicit allowlist, block `contenteditable` content, strip query strings and hashes from URLs against an allowlist of known parameters, and scrub the payload once more at the collection edge as defence in depth.',
      'Run collection through an owned edge endpoint on a first-party domain rather than a vendor domain, so ad blockers do not silently remove 20 to 30% of your data and bias every metric toward users without blockers.',
      'Control cost with a per-property ingest quota enforced at the edge and a sampling rate delivered as remote config, so a runaway error loop on one property degrades its own sampling rather than consuming the whole budget.'
    ],
    deepdives: [
      {
        q: 'A deploy triggers an error loop that generates 400M events in an hour. What stops the bill?',
        a: 'Three layers. In the browser, per-session deduplication plus a hard cap of, say, 50 error events per session stops a single user generating unbounded traffic. At the edge, a per-property token bucket sheds load and returns a 429 the SDK respects with exponential backoff. Centrally, the remote-config sampling rate can be dialled down within a minute without a client deploy. Critically, the shed events are counted in a cheap aggregate counter so I still know the true error rate even when I am dropping the detailed payloads \u2014 losing the count is what makes the incident invisible.'
      },
      {
        q: 'Your p75 LCP looks fine but users complain the site is slow. How do you reconcile that?',
        a: 'Almost always a sampling or survivorship problem. Beacons sent on `visibilitychange` are lost when the tab crashes or the user bounces before the metric finalises, so the slowest sessions are systematically missing. Ad blockers remove a non-random population. And aggregating across countries and device classes hides a bimodal distribution. I would check beacon delivery rate against server-side page view counts first \u2014 if RUM sees 70% of known page views, the metric is not trustworthy \u2014 then slice by device class and country before believing any global percentile.'
      },
      {
        q: 'How do you connect a frontend error to the backend request that caused it?',
        a: 'The SDK generates a W3C `traceparent` for each outbound `fetch` to first-party origins and records it alongside the request in the session context. Backend services already propagate it, so joining on trace id gives the server span for a failed client request. The practical constraints are that CORS requires the backend to allow the `traceparent` header, that sampling decisions must be made at the client and honoured downstream or the trace will be half-missing, and that I should sample the trace at 100% when the client request failed, which means the client must be able to force the sampling bit.'
      },
      {
        q: 'Who consumes this and how do you stop it becoming a dashboard nobody looks at?',
        a: 'I would tie it to ownership rather than to dashboards. Every metric is attributed to a code owner through the bundle-to-team mapping, each team gets a small number of SLOs they signed up for \u2014 typically p75 INP on their routes and error rate \u2014 and regressions page the owning team through the same alerting path as backend SLOs. The pipeline\u2019s success metric is not data volume, it is the fraction of production frontend incidents detected by RUM before a support ticket, which I would track explicitly.'
      }
    ],
    redflags: [
      'Samples uniformly at a low rate and then tries to debug rare errors that sampling deleted.',
      'Records full session replay for all users, ignoring both the cost cap and the privacy constraint.',
      'Ships source maps publicly so the browser can symbolicate, exposing source to anyone.',
      'Collects on a third-party vendor domain and never accounts for ad blockers biasing the dataset.'
    ],
    topicIds: ['frontend-observability', 'web-performance', 'frontend-security']
  },
  {
    id: 'image-feed-infinite-scroll',
    title: 'Design an image-heavy social feed with infinite scroll',
    track: 'frontend',
    difficulty: 'warmup',
    pattern: 'Windowing, cursor pagination, image budget per viewport',
    prompt:
      'A social app shows a vertically infinite feed of posts, each with one to ten images, on mobile web. A heavy user scrolls through 500 posts in a session, and the p75 device is a mid-range Android on 4G. Product also requires that scroll position is restored exactly when a user taps into a post and presses back, which today loses their place and is the top complaint.',
    clarify: [
      'Can the feed change underneath the user between page fetches? If the ranking is live, offset pagination will duplicate and skip posts, and cursor pagination is mandatory rather than a preference.',
      'Is the feed ordering personalised and server-computed, or can a page of results be cached? That decides whether back-navigation can re-fetch cheaply or must restore from a client cache.',
      'How many images must be decoded per viewport in the worst case \u2014 is a ten-image carousel eagerly loaded? Image decode, not network, is usually what janks a mid-range Android.',
      'Do we need to keep DOM for posts already scrolled past, for example to support in-place comment updates? That is the difference between simple windowing and a more careful recycling strategy.'
    ],
    approach: [
      'Paginate with an opaque cursor encoding the ranking position and a snapshot id, so new posts arriving at the top cannot cause duplicates or skips in later pages.',
      'Virtualise the list with a windowing layer that keeps roughly three viewports of DOM mounted, using measured heights cached per post id so variable-height image posts do not cause scroll jumps as they measure.',
      'Reserve layout space before images load by sending intrinsic width and height in the API response and rendering a CSS `aspect-ratio` box, which removes the cumulative layout shift that otherwise dominates feed CLS.',
      'Load images responsively: `srcset` with three widths, AVIF with a WebP fallback, `loading="lazy"` for anything below the fold, and `fetchpriority="high"` only on the first visible image.',
      'Limit carousels to eagerly loading the first image and prefetching the second on user interaction, rather than loading all ten, which is the single biggest data and decode saving in a feed like this.',
      'Prefetch the next page when the user is two viewports from the end, using an `IntersectionObserver` sentinel, and cancel the in-flight request if they scroll back up.',
      'Restore scroll by persisting the loaded page cursors, the measured height map and the scroll offset keyed by feed session id in `sessionStorage`, then on back-navigation rehydrate the height map first so the scroll container has the right total height before restoring the offset.',
      'Cap memory by evicting the height map and cached page data beyond 500 posts and forcing a fresh feed session, since an unbounded feed will eventually exhaust a mid-range device regardless of DOM windowing.'
    ],
    deepdives: [
      {
        q: 'Why does scroll restoration break so often, and what is the actual mechanism of your fix?',
        a: 'It breaks because the browser restores a scroll offset against a container whose height is temporarily wrong: a virtualised list starts with zero rendered items, so the container is short and the offset is clamped to the bottom of a nearly empty page. The fix is ordering \u2014 restore the total height first from the persisted measurement map, so the container is the right size before setting `scrollTop`, then render the window around the restored offset. I would also set `history.scrollRestoration = "manual"` so the browser does not race my logic.'
      },
      {
        q: 'A user on 4G burns 60 MB of data in one session. What do you change?',
        a: 'I would measure where it goes before changing anything, but in a feed it is almost always images and almost always over-sized ones. The levers in order of impact are serving AVIF at device-pixel-appropriate widths rather than one large asset, loading only the first carousel image, and lowering quality for the `save-data` client hint and slow `effectiveType` connections. I would also check whether prefetching the next page is running too eagerly during fast scrolling, which fetches pages the user flies past \u2014 throttling prefetch by scroll velocity is a cheap win.'
      },
      {
        q: 'The feed API is slow at p99 and users see an empty screen. What is the frontend responsibility here?',
        a: 'The frontend cannot make the API fast but it owns perceived latency and honesty. I render skeleton items matching the real post layout so there is no shift on arrival, keep the previous page visible while the next loads rather than blanking, and after a timeout show an explicit retry rather than an indefinite spinner. Where the product allows, I would also serve a cached previous feed from the client immediately and revalidate, so a returning user sees content instantly even if it is a minute old.'
      }
    ],
    redflags: [
      'Uses offset or page-number pagination on a live-ranked feed, then patches the resulting duplicates client-side.',
      'Renders all loaded posts in the DOM and relies on `content-visibility` alone to save a 500-post feed.',
      'Does not reserve image dimensions, producing constant layout shift as images arrive.',
      'Restores `scrollTop` before the virtualised container has its correct total height.'
    ],
    topicIds: ['web-performance', 'browser-rendering', 'state-management']
  },
  {
    id: 'multi-tenant-white-label-portal',
    title: 'Design a multi-tenant white-label portal with per-tenant theming',
    track: 'frontend',
    difficulty: 'core',
    pattern: 'Runtime theming, tenant config as data, one build many brands',
    prompt:
      'A B2B2C platform serves 1,200 business customers who each present the portal under their own brand on their own custom domain, with their own colours, logo, fonts and in some cases a custom CSS override that their agency wrote. Enterprise tenants can also disable features and change copy. Today each tenant is a separate build, so a security patch takes nine days to reach everyone, which is the reason you are redesigning it.',
    clarify: [
      'How much can a tenant actually change \u2014 tokens and copy only, or arbitrary layout? If some tenants genuinely need custom components, I need a plugin boundary, not just a theme.',
      'Are the agency-written CSS overrides contractual? If I cannot break them, I need a stable class contract and a migration path, which is the hardest part of collapsing 1,200 builds into one.',
      'Is tenant resolution by custom domain only, or also by path and subdomain? Custom domains mean certificate management and per-domain edge routing become part of the design.',
      'What is the acceptable time for a tenant branding change to go live \u2014 instant, or is a few minutes fine? Instant rules out build-time generation of theme assets.'
    ],
    approach: [
      'Collapse to a single build artefact served to all tenants, with everything tenant-specific expressed as runtime data: a tenant config document containing tokens, feature toggles, copy overrides and asset URLs.',
      'Resolve tenant at the edge from the `Host` header, attach the tenant id and a config version to the request, and inject the theme as CSS custom properties in a `<style>` block in the document head so the first paint is already branded with no flash of default theme.',
      'Serve the config from an edge KV store with a 60-second TTL and explicit purge on save, so a branding change is live in about a minute without a deploy and without a build.',
      'Constrain theming to a fixed token contract \u2014 a documented set of roughly 60 custom properties \u2014 and validate tenant values on save, including a contrast check that rejects a brand colour pairing failing WCAG AA, because 1,200 self-serve tenants will otherwise ship inaccessible portals under your name.',
      'Migrate the agency CSS overrides by freezing a stable, documented class contract and running the existing override sheets against the new build in a screenshot-diff harness per tenant, triaging failures rather than assuming they will work.',
      'Load tenant custom CSS as a separate stylesheet with a bounded size limit, served from a sandboxed subdomain and scoped under a tenant root class, so an override cannot break the app shell or the login flow.',
      'Handle custom domains with a wildcard-capable edge that provisions certificates automatically per domain, and keep a tenant-to-domain mapping as the single source of truth used by both routing and CORS policy.',
      'Ship feature toggles and copy through the same config document with a strict default: an unknown toggle is off and a missing copy key falls back to the base locale string, so a partial config never renders a broken page.'
    ],
    deepdives: [
      {
        q: 'One tenant\u2019s custom CSS breaks the checkout button for their users. How do you find out and what do you do?',
        a: 'I would not rely on the tenant reporting it. Custom CSS is treated as a deployable artefact: on save it runs through an automated visual-regression and interaction smoke test against key flows for that tenant, and it cannot publish if the checkout smoke test fails. In production, RUM is tagged with tenant id so a conversion or error-rate anomaly is attributable to one tenant rather than lost in the aggregate. The mitigation lever is disabling the tenant override sheet at the edge, which restores the base theme immediately without their agency being involved.'
      },
      {
        q: 'A security patch needs to reach all 1,200 tenants today. Walk me through it under the new design.',
        a: 'It is one build and one deploy, so the patch reaches every tenant as soon as the CDN cache for the app shell turns over, which I would keep short with a hashed-asset plus short-TTL HTML pattern. The part that needs care is that tenants are on different config versions, not different code versions, so I verify the patch is config-agnostic. If a tenant\u2019s custom CSS depends on the patched markup, the edge kill switch for overrides is the safety valve. Nine days becomes under an hour, and that is the entire justification for the redesign.'
      },
      {
        q: 'An enterprise tenant demands a genuinely custom component, not a theme change. How do you say yes without going back to 1,200 builds?',
        a: 'I would define a narrow extension point rather than allowing arbitrary code: named slots in specific layout regions that can render a remote module loaded at runtime, with a declared props contract, a strict CSP allowing only our asset origin, and a timeout plus error boundary so a failing tenant module degrades to the default. Crucially the module is versioned against a published host API and runs in the same build, so it does not fork the application. I would also price it: a custom module is a supported product tier with a maintenance commitment, not a favour, because otherwise the extension point becomes 1,200 forks by another name.'
      },
      {
        q: 'How do you test a single build against 1,200 configurations?',
        a: 'Exhaustive testing is not the goal; representative coverage is. I would cluster the 1,200 configs by the dimensions that actually affect rendering \u2014 presence of custom CSS, enabled feature set, locale, logo aspect ratio, extreme token values \u2014 and pick a canonical tenant per cluster, perhaps 25 in total, for the visual regression suite. Alongside that, property-based rendering tests exercise token extremes such as very long brand names and very dark and very light palettes. Then I rely on staged rollout by tenant cohort with automated error-rate gates to catch the rest.'
      }
    ],
    redflags: [
      'Keeps a build per tenant and only optimises the build pipeline, which does not address the nine-day patch latency.',
      'Uses a CSS-in-JS runtime that regenerates the whole stylesheet per tenant on the client, causing a flash of unbranded content.',
      'Lets tenants inject arbitrary CSS or script with no scope, size limit, validation or kill switch.',
      'Has no accessibility validation on tenant-chosen colours, shipping contrast failures under the platform brand.'
    ],
    topicIds: ['design-systems', 'rendering-strategies', 'deployment-and-rollout']
  },
  {
    id: 'microfrontend-shell-12-teams',
    title: 'Design a micro-frontend shell and rollout strategy for 12 teams',
    track: 'frontend',
    difficulty: 'hard',
    pattern: 'Independent deployability versus shared runtime cost',
    prompt:
      'A logistics SaaS has 12 product teams shipping into one authenticated web app. Today it is a single React repo where a release train ships twice a week and one team\u2019s failing test blocks everyone. Leadership wants independent deploys. The app must stay under a 400 KB compressed initial payload, the teams disagree on React version (three are on 17, nine on 18), and the app is used by warehouse staff on locked-down tablets with old Chromium builds.',
    clarify: [
      'Is the real problem deployment coupling or test-suite reliability? If a single flaky test suite is the blocker, fixing CI is dramatically cheaper than adopting micro-frontends and I should say so before designing one.',
      'Do the 12 teams\u2019 surfaces appear on the same screen simultaneously, or does the user navigate between them? Route-level isolation is a fundamentally easier problem than composing five teams into one dashboard.',
      'Is shared client state required across team boundaries \u2014 a cart, a selected shipment, a global filter? Heavy cross-boundary state is the thing that makes micro-frontends worse than a monolith.',
      'Can we mandate a single React version, or is the 17-versus-18 split immovable? Two React runtimes on one page roughly doubles framework payload and breaks context sharing.'
    ],
    approach: [
      'State the honest default first: if the pain is a flaky shared test suite and a slow train, fix CI and adopt independently deployable route bundles from one repo before splitting runtimes, because micro-frontends trade a build problem for a distributed-systems problem.',
      'Assuming independent deploys are genuinely required, compose at the route level with Module Federation: a thin shell owns routing, auth, layout chrome and error boundaries, and each team publishes a remote exposing a route-level entry.',
      'Force a single React version as a singleton shared dependency with a strict version range, and treat the 17-to-18 split as a migration with a deadline rather than a permanent state, because shipping two Reacts blows the 400 KB budget on its own.',
      'Pin the shared dependency contract in a versioned `host-contract` package listing singletons (React, router, design system, auth client) with allowed ranges, and fail a remote\u2019s build if it declares an incompatible range.',
      'Deploy each remote as an immutable, content-hashed bundle plus an entry in a manifest the shell reads at runtime, so a rollout is a manifest pointer change and a rollback is the previous pointer \u2014 seconds, not a rebuild.',
      'Isolate failure: each remote mounts inside an error boundary with a load timeout, and a remote that fails to load renders a scoped fallback panel rather than taking down the shell, with the failure reported to the owning team.',
      'Protect the payload budget with a CI gate on the shell plus the three most common remotes, and publish per-team bundle budgets, because the classic micro-frontend failure is total payload growing while each team stays within its own local budget.',
      'Handle the old Chromium tablets by fixing one compilation target for all remotes in the host contract, so a team cannot ship syntax the tablet cannot parse; verify with a real-device smoke test in the release pipeline.'
    ],
    deepdives: [
      {
        q: 'Team A ships a remote that upgrades the shared design system in a way team B has not adopted. What happens at runtime?',
        a: 'With the design system as a shared singleton, whichever version loads first wins and team B gets code it never tested against \u2014 a class of bug that is nearly impossible to reproduce locally. I would avoid it structurally: the design system version is pinned by the shell, not by remotes, so the host decides and remotes declare compatibility. Upgrades then become a shell release with a staged rollout, and remotes are validated against the next shell version in a nightly integration pipeline so incompatibility is found before the shell ships, not after.'
      },
      {
        q: 'How do you keep total bundle size under control when nobody owns the whole page?',
        a: 'Local budgets do not compose, so I measure globally and attribute locally. A synthetic integration build in CI loads the shell plus each remote and produces a size report attributed per team, including duplicated dependencies that failed to dedupe \u2014 which is where the real waste is. The number that gets reported is total bytes on the three most-used journeys, and a team whose change pushes the journey over budget owns the fix. I would also make dependency duplication a hard build failure rather than a warning, because it is silent and cumulative.'
      },
      {
        q: 'Twelve months in, how do you tell whether the micro-frontend architecture was the right call?',
        a: 'I would look at whether the promised benefit materialised and what it cost. The benefit metrics are deploy frequency per team, lead time from merge to production, and the fraction of incidents that are cross-team. The cost metrics are total payload, p75 INP, the number of production incidents attributed to version-skew between remotes, and how much time the platform team spends on integration issues. If deploy frequency did not move but payload grew 40% and version-skew incidents are now the top category, the honest conclusion is to recentralise, and I would rather say that than defend the architecture.'
      },
      {
        q: 'A user session spans three remotes. How do you debug an error that crosses them?',
        a: 'The shell owns cross-cutting concerns, so it generates a session id and a per-navigation correlation id and exposes them through the host contract; every remote tags its errors, RUM beacons and backend requests with those ids plus its own remote name and version. The critical extra field is the resolved manifest \u2014 the exact set of remote versions loaded for that session \u2014 because "works on my machine" in this architecture usually means a different version combination. Source maps are uploaded per remote build and symbolication keys off the remote name and hash.'
      }
    ],
    redflags: [
      'Reaches for micro-frontends without first asking whether the real problem is CI reliability and release-train coupling.',
      'Allows each team to ship its own React version and does not connect that to the 400 KB budget.',
      'Has no runtime manifest, so a rollback of one team\u2019s surface requires rebuilding and redeploying the shell.',
      'Ignores cross-remote shared state, then invents an ad hoc global event bus on `window` to patch it.'
    ],
    topicIds: ['microfrontends', 'module-federation', 'deployment-and-rollout']
  },
  {
    id: 'rich-text-editor',
    title: 'Design a rich text editor',
    track: 'frontend',
    difficulty: 'core',
    pattern: 'Model-view separation, contenteditable containment, schema-driven commands',
    prompt:
      'Build the editor powering a help-centre authoring tool: headings, lists, tables, code blocks, embeds, inline comments and paste from Microsoft Word and Google Docs. Authors are non-technical and paste constantly. The content is published to a static site, so the stored format must be stable for years, and a legacy corpus of 60,000 articles is stored as raw HTML that authors will keep editing.',
    clarify: [
      'Is the stored format ours to define, or must it stay HTML for the 60,000 legacy articles? A canonical JSON document model is far better for the editor but forces a migration of the corpus.',
      'Does the editor need to preserve unknown markup in legacy articles that our schema does not model? If yes, the schema needs an opaque passthrough node or editing an old article will silently delete content.',
      'What exactly must survive a paste from Word \u2014 semantic structure only, or also colours and fonts? Authors usually want structure; keeping Word inline styles is what makes help centres look broken.',
      'Do inline comments anchor to text ranges that must survive later edits? Range anchoring is a much harder problem than comments attached to a block.'
    ],
    approach: [
      'Separate the document model from the DOM: use a schema-driven model (ProseMirror or Lexical) where every change is a transaction against a validated document tree, and `contenteditable` is only a rendering and input surface, never the source of truth.',
      'Define an explicit schema \u2014 allowed nodes, marks, and which nodes may contain which \u2014 so an invalid document is unrepresentable, and paste, undo and collaborative edits all flow through the same validation.',
      'Store a canonical JSON document with a `schemaVersion`, and treat HTML as an import and export format only, which decouples the stored content from both the editor implementation and the published markup.',
      'Migrate the 60,000 legacy articles lazily: parse HTML to the model on open with a strict allowlist parser, and represent anything unrecognised as an opaque `rawHtml` node preserved verbatim, so editing an old article never silently drops content.',
      'Handle paste with a dedicated normalisation pipeline: read `text/html`, strip Word and Docs wrapper markup, map `mso` list markers back to real lists, drop all inline colour and font styles, and run the result through schema validation so anything that survives is valid by construction.',
      'Implement commands as pure model transforms (`toggleHeading(level)`, `wrapInList(type)`) with the toolbar reading state from the current selection, so keyboard shortcuts, toolbar and programmatic API share one code path.',
      'Anchor inline comments with relative positions that transform with each document transaction rather than character offsets, and mark a comment orphaned rather than deleting it when its range is fully removed.',
      'Test with a corpus harness: a fixture set of a few hundred real legacy articles and real Word paste payloads, asserting round-trip stability so that opening and saving without edits produces a byte-identical document \u2014 the single most valuable test in an editor.'
    ],
    deepdives: [
      {
        q: 'Why not just use `contenteditable` directly and read `innerHTML` on save?',
        a: 'Because browsers disagree about what `contenteditable` produces for identical input, and the DOM becomes the source of truth for a document you cannot validate. Undo behaves differently per browser, pasting injects arbitrary markup, and every feature becomes DOM string manipulation. A model-first architecture means the same transaction produces the same document everywhere, undo is a stack of inverse transactions rather than the browser\u2019s, and collaborative editing or schema migration is possible at all. The cost is a much larger upfront investment, which is the honest trade-off.'
      },
      {
        q: 'An author opens a 2015 article containing a custom widget your schema does not know about, edits one paragraph, and saves. What happened to the widget?',
        a: 'It must survive byte-identical, which is why the import parser produces an opaque node for unrecognised markup rather than dropping it. That node is atomic and non-editable in the UI, rendered as a placeholder card labelled with what it is, and serialised back verbatim on export. I would also log every distinct unrecognised construct encountered across the corpus, so the team can prioritise modelling the common ones properly instead of leaving 60,000 articles full of opaque blocks forever.'
      },
      {
        q: 'How do you evolve the schema when you add a callout node two years from now?',
        a: 'The document carries a `schemaVersion` and migrations are explicit, ordered, pure functions from version N to N+1, run on load and written back on the next save so the corpus migrates gradually under real usage. Readers must tolerate a newer version than they know by refusing to save rather than by silently downgrading, which means the published static-site renderer and the editor share the schema package and are released together. I would never do an in-place bulk migration of 60,000 documents as the first move; lazy migration with a background backfill for the tail is safer because failures are observable one article at a time.'
      },
      {
        q: 'Table editing is where editors usually fall apart. What specifically goes wrong and how do you handle it?',
        a: 'Selection across cells, merged cells, and keyboard navigation are the three. Native selection does not respect table cell boundaries, so a drag from one cell to another produces a DOM range that maps to a nonsensical model selection. The handling is a dedicated cell-selection type in the model rather than a text range, custom key handling for `Tab` and arrow keys that operates on the table structure, and representing merged cells as `colspan` and `rowspan` attributes with validation that rejects an inconsistent grid. I would also expect to spend a disproportionate amount of the project\u2019s test budget here.'
      }
    ],
    redflags: [
      'Treats the DOM as the document model and manipulates `innerHTML` for commands.',
      'Accepts pasted HTML from Word without a normalisation and allowlist pipeline.',
      'Has no plan for legacy content the schema cannot represent, so editing an old article silently destroys markup.',
      'Anchors comments to absolute character offsets that break on any earlier edit.'
    ],
    topicIds: ['collaborative-editing', 'state-management', 'web-foundations']
  },
  {
    id: 'data-grid-one-million-rows',
    title: 'Design a spreadsheet-style data grid with 1M rows',
    track: 'frontend',
    difficulty: 'hard',
    pattern: 'Two-axis virtualisation, server-side aggregation, incremental formula evaluation',
    prompt:
      'Financial analysts need a grid over 1M rows and 120 columns with sorting, multi-column filtering, grouping with subtotals, inline editing and computed columns whose formulas reference other cells. It must be usable on a 4-year-old corporate laptop, and analysts routinely select 50,000 rows and apply a bulk edit, then expect undo to work.',
    clarify: [
      'Does the client ever need all 1M rows locally, or can sorting, filtering and aggregation run server-side? Client-side is roughly 1 to 2 GB of JavaScript objects at 120 columns, which settles the architecture immediately.',
      'Are computed columns row-local (a function of that row) or can they reference arbitrary other cells like a spreadsheet? Arbitrary references mean a dependency graph and a topological evaluator, which is an order of magnitude more work.',
      'Must a bulk edit of 50,000 rows be atomic \u2014 all applied or none? That determines whether the client can stream the edit or must wait for a server transaction.',
      'What is the acceptable staleness if another analyst edits the same dataset concurrently? Live invalidation of a virtualised window is much harder than a manual refresh.'
    ],
    approach: [
      'Keep the data on the server and make the grid a window into it: the client requests row ranges by index against a server-defined ordering, with sort, filter and grouping expressed as a query the server resolves.',
      'Virtualise both axes with absolute positioning and a fixed row height, rendering roughly 40 rows by 15 columns \u2014 about 600 cells \u2014 regardless of dataset size, and recycle cell DOM nodes rather than unmounting and remounting them.',
      'Cache fetched row ranges in a sparse client store keyed by the query signature, prefetch one viewport ahead in the scroll direction, and render placeholder rows for unfetched ranges so scrolling never blocks on the network.',
      'Compute grouping subtotals and aggregate footers server-side as part of the query, because computing a subtotal requires the whole group and the client only holds a window.',
      'Model computed columns as a dependency graph: parse each formula into an AST, record cell-level dependencies, and on edit recompute only the transitive dependents in topological order, detecting cycles at formula-save time rather than at evaluation time.',
      'Run formula evaluation in a Web Worker with the dependency graph held there, so a 50,000-row recalculation never blocks scrolling, and stream results back to the main thread in chunks the renderer applies per frame.',
      'Express a bulk edit as a server-side operation over the current filter predicate rather than as 50,000 individual row updates, sending the predicate plus the change and receiving an operation id, so the payload is constant-size.',
      'Implement undo as an inverse-operation stack of the same predicate-based operations, stored server-side with the operation id, so undoing a 50,000-row edit is one request rather than replaying 50,000 inverses.'
    ],
    deepdives: [
      {
        q: 'An analyst sorts by a column the server has not indexed, over 1M rows. What do you do?',
        a: 'Sorting 1M rows without an index is a full scan and will blow any interactive budget, so I would not pretend it is instant. The design answer is to make sortable columns an explicit, indexed contract, and for non-indexed columns either disable sorting or run it as an asynchronous job with a progress state and a materialised result set the grid then pages through. Front-end-wise the important part is that the grid has a first-class "computing" state per query rather than freezing, and that a slow sort can be cancelled, because analysts will change their minds within two seconds.'
      },
      {
        q: 'Formula evaluation in a worker means the main thread has stale values for a moment. How do you render that honestly?',
        a: 'Each cell carries a computation generation number. When an edit invalidates dependents, those cells immediately render in a pending state \u2014 the previous value dimmed rather than blanked, because blanking a financial grid is alarming \u2014 and the worker streams recomputed values tagged with the generation. The renderer ignores results from a stale generation, which is what prevents a slow earlier recalculation from overwriting a newer one. A cell that stays pending past a threshold surfaces an explicit error state rather than dimming forever.'
      },
      {
        q: 'Two analysts edit overlapping rows in the same view. What is your consistency story?',
        a: 'I would avoid pretending this is a collaborative editor. Each edit carries the row version it was based on, and the server rejects an edit whose base version is stale, returning the current value. The client shows a scoped conflict indicator on that row with both values rather than silently overwriting or silently discarding. For the visible window I subscribe to a lightweight change feed filtered to the current row range, so another analyst\u2019s committed edit appears with a brief highlight. Bulk predicate edits are the dangerous case, and I would require an explicit confirmation showing the affected row count computed at submit time.'
      },
      {
        q: 'How do you keep scroll smooth at 60fps while fetching, computing and rendering?',
        a: 'The main thread does one job: turn already-available data into DOM. Fetching is in the network layer, formula evaluation is in a worker, and both deliver into a store that the render loop samples once per frame rather than subscribing per cell. Cell DOM is recycled with direct `textContent` writes, never React reconciliation per cell. I would enforce this with a synthetic scroll benchmark in CI over a 1M-row fixture asserting p99 frame time under 16 ms, because every one of these properties regresses quietly as features are added.'
      },
      {
        q: 'How would you roll this out to replace an existing grid analysts depend on daily?',
        a: 'Grid replacements fail on muscle memory, not on capability. I would run both grids side by side behind a per-user toggle, instrument the specific interactions analysts actually perform \u2014 which is usually a surprisingly small set dominated by filter, sort and export \u2014 and require parity on that measured set rather than on the feature matrix. Export fidelity in particular is where trust is won or lost, so I would diff exported CSV between the old and new grid for a corpus of saved views as an automated gate.'
      }
    ],
    redflags: [
      'Loads all 1M rows into the browser and relies on virtualisation alone to make it work.',
      'Recomputes every formula on every edit instead of maintaining a dependency graph and recomputing only dependents.',
      'Sends 50,000 individual row updates for a bulk edit and builds undo as 50,000 inverse operations.',
      'Virtualises rows but renders all 120 columns, so each row still mounts 120 cells.'
    ],
    topicIds: ['web-performance', 'browser-rendering', 'state-management']
  },
  {
    id: 'global-search-as-you-type',
    title: 'Design a global search-as-you-type UI',
    track: 'frontend',
    difficulty: 'warmup',
    pattern: 'Race-safe async UI, debounce versus responsiveness, result stability',
    prompt:
      'Add a command-palette-style global search to a SaaS app that searches across documents, people, projects and settings. Median backend latency is 120 ms but p99 is 900 ms, users type at up to 8 characters per second, and product insists the first keystroke must show something useful within 100 ms. Results from four different backends arrive at different times and must be merged into one ranked list.',
    clarify: [
      'Can any of the four sources be searched locally? People and settings are small, bounded datasets that can be prefetched and matched client-side, which is how you hit 100 ms honestly rather than with a spinner.',
      'Is the ranking across the four sources defined server-side, or does the client merge? Client-side merging of independently-scored sources tends to produce a list that reshuffles as each source lands.',
      'Must results be permission-filtered per user? If so client-side caching of results across sessions is dangerous and the cache needs a per-user key with a short TTL.',
      'What does the user do most \u2014 re-open something they used recently, or genuinely explore? If it is recency-dominated, a local recents index serves most queries without touching the backend at all.'
    ],
    approach: [
      'Open the palette with content already present: show recents and pinned items from a local index, so the 100 ms requirement is met by not having a network request on the critical path at all.',
      'Search bounded local datasets (people, settings, recent documents) in memory on every keystroke with a simple prefix-and-fuzzy matcher, rendering those results immediately while remote sources are still in flight.',
      'Debounce remote queries at roughly 150 ms of inactivity but issue an immediate request on the third character, so a fast typist gets one request rather than eight and a deliberate typist does not wait.',
      'Make every request race-safe: tag each with a monotonically increasing sequence number, `AbortController`-cancel superseded requests, and discard any response whose sequence is lower than the last rendered, which is the single most common bug in this UI.',
      'Merge sources into fixed, labelled sections with a reserved slot per source rather than interleaving by score, so a late-arriving source fills its own section instead of reshuffling results the user is already reading.',
      'Never move the item under the keyboard cursor: once the user presses arrow-down, freeze list ordering until the query text changes, because reshuffling under a committed selection causes users to open the wrong thing.',
      'Cache responses per query string in an LRU keyed by user id with a short TTL, so backspacing through a query is instant and does not re-issue requests for prefixes already seen.',
      'Make the palette fully accessible as a combobox: `role="combobox"` with `aria-expanded`, `aria-activedescendant` tracking the virtual cursor, and a polite live region announcing the result count, since a keyboard-first feature that screen readers cannot use is a failed feature.'
    ],
    deepdives: [
      {
        q: 'A p99 request for the query "re" returns after the user has typed "report q3". What does the user see?',
        a: 'Nothing, because the response is dropped. The sequence number attached to the request is lower than the last one rendered, so the handler discards it before touching state. Cancelling with `AbortController` is the first line of defence, but cancellation is not guaranteed to prevent an in-flight response from resolving, so the sequence check is the correctness guarantee. The visible behaviour is that stale results never flash \u2014 the list either shows results for the current query or a loading state for the sections still pending.'
      },
      {
        q: 'One of the four backends is down. What does the UI do?',
        a: 'It degrades per section rather than globally. Each source has its own request, its own timeout around 1.2 seconds, and its own section state, so a failing documents backend shows an inline "documents unavailable, retry" affordance while people and projects render normally. I would not show a global error, and I would not silently omit the section, because a user searching for a document would otherwise conclude it does not exist \u2014 a silent empty result is worse than a visible error here.'
      },
      {
        q: 'How do you decide whether the debounce should be 150 ms or 300 ms?',
        a: 'By measuring rather than by taste. I would instrument keystroke-to-first-useful-result latency and the ratio of issued requests to committed selections, then look at the distribution of inter-keystroke intervals in real usage, which is usually bimodal between fast typists and hunt-and-peck users. A fixed debounce serves one group badly, so the better answer is an adaptive one: debounce on observed typing cadence, with an immediate fire when the interval since the last keystroke already exceeds the threshold. Backend cost is the other input \u2014 if each query is expensive, the debounce is a cost decision as much as a UX one.'
      }
    ],
    redflags: [
      'Fires a request per keystroke with no cancellation and no sequence guard, so results flicker between queries.',
      'Uses only a debounce as the race protection, assuming responses arrive in request order.',
      'Interleaves results from four sources by raw score, so the list reshuffles as each source lands under the user\u2019s cursor.',
      'Builds it as a `div` with click handlers, with no combobox semantics or keyboard cursor announcements.'
    ],
    topicIds: ['state-management', 'api-and-bff', 'web-performance']
  },
  {
    id: 'notification-inbox-frontend',
    title: 'Design a notification inbox',
    track: 'frontend',
    difficulty: 'warmup',
    pattern: 'Read-state convergence, realtime plus pagination, cross-tab coherence',
    prompt:
      'Build the in-app notification inbox for a collaboration product: a bell with an unread count, a dropdown of recent items, and a full page with filters. Users commonly have 5 tabs open, an active user receives 200 notifications a day, and heavy accounts have 50,000 historical notifications. Marking something read in one tab must reflect everywhere quickly, and the unread count must never be wrong, because a permanently stuck badge is the single most complained-about bug in products like this.',
    clarify: [
      'Is the unread count a count of individual notifications or of grouped threads? Grouping changes both the count semantics and whether marking one item read clears a badge.',
      'Does read state need to survive being set offline, or can we require connectivity? Offline read-marking needs an outbox and idempotent server semantics.',
      'How fresh must the count be \u2014 sub-second, or is 30 seconds acceptable? Sub-second implies a persistent connection for every logged-in user, which is a real infrastructure cost for a badge.',
      'Should a notification created while the user is already looking at the list appear immediately, or appear behind a "3 new" affordance? Inserting rows under the reader is a common usability mistake.'
    ],
    approach: [
      'Treat the unread count as server-authoritative and fetch it explicitly rather than deriving it from the loaded page of notifications, because a client that has loaded 20 of 50,000 items cannot compute the count correctly.',
      'Deliver updates over the app\u2019s existing WebSocket (or SSE) as small events carrying a notification id and the new unread count, and reconcile by fetching, not by trusting the client to increment, so a missed event self-heals on the next message.',
      'Share one connection across the 5 tabs with a `SharedWorker`, or elect a leader tab via the Web Locks API, and broadcast state to the other tabs over a `BroadcastChannel`, so five tabs do not open five sockets and five polls.',
      'Mark-as-read is an optimistic local update plus an idempotent server call keyed by notification id, with the server returning the authoritative count so the badge converges even if two tabs raced.',
      'Paginate history with a cursor on `(created_at, id)` so 50,000 items page reliably, and never load the full history into client memory; the dropdown loads only the most recent 20.',
      'Insert newly arrived notifications behind an explicit "3 new notifications" pill when the list is scrolled or focused, and prepend directly only when the user is at the top and idle, so nothing shifts under a click.',
      'Reconcile on visibility change: when a tab becomes visible after being backgrounded, refetch the count and the first page rather than replaying missed socket events, because a laptop that slept for six hours will have missed everything.',
      'Batch a "mark all read" as a single server operation with a high-water-mark timestamp rather than N individual calls, so a user with 50,000 unread items does not issue 50,000 requests.'
    ],
    deepdives: [
      {
        q: 'Why do unread badges get stuck, and how does your design prevent it?',
        a: 'They get stuck because the count is maintained as a client-side increment and decrement over an unreliable event stream: a missed event, a duplicate delivery or a failed mark-as-read leaves the local count permanently diverged with no path back to truth. My design never computes the count locally as the source of truth \u2014 every server response that could affect it carries the authoritative count, and visibility change forces a refetch. That means the worst case is a stale badge for seconds, which self-corrects, rather than a wrong badge forever.'
      },
      {
        q: 'Five tabs are open and the user marks an item read in tab 3. Walk through what the other four do.',
        a: 'Tab 3 applies the optimistic update locally and posts the idempotent mark-read call, then publishes a `notification:read` message with the id and the returned authoritative count on the `BroadcastChannel`. The other tabs apply it to any locally cached copy of that notification and set the badge to the broadcast count without making their own request. If a tab was not listening \u2014 for example it was frozen by the browser \u2014 its visibility-change reconciliation fixes it on focus. The rule is that cross-tab messages are an optimisation and never the only path to correctness.'
      },
      {
        q: 'The WebSocket is unavailable for a segment of users behind a corporate proxy. What is the fallback?',
        a: 'Fall back to polling the count endpoint, but adaptively: every 30 seconds while the tab is visible and focused, back off to a few minutes when backgrounded, and stop entirely when hidden for a long period, resuming with an immediate fetch on visibility. The count endpoint is designed to be cheap and cacheable per user for a few seconds precisely so this fallback is affordable at scale. I would also track the fallback rate as a metric, because a silent rise means a proxy or infrastructure change has moved a population onto the degraded path.'
      }
    ],
    redflags: [
      'Derives the unread count by filtering the locally loaded page of notifications.',
      'Opens one WebSocket per tab and never mentions cross-tab coordination.',
      'Increments and decrements the badge purely from socket events with no reconciliation path.',
      'Implements "mark all read" as a loop of per-item requests.'
    ],
    topicIds: ['realtime-frontend', 'state-management', 'api-and-bff']
  },
  {
    id: 'checkout-never-double-charge',
    title: 'Design a checkout flow that must never double-charge',
    track: 'frontend',
    difficulty: 'core',
    pattern: 'Client-generated idempotency, state machine over network retries',
    prompt:
      'You own the checkout for a marketplace processing $900M a year. Users pay on flaky mobile networks, double-tap buttons, background the browser mid-3DS redirect, and hit refresh when a spinner takes too long. Support currently handles roughly 300 duplicate-charge tickets a month, each costing a refund plus trust. The payment provider supports idempotency keys, and 3D Secure redirects out of the app and back.',
    clarify: [
      'Does the payment provider\u2019s idempotency key have a retention window, and what is it? A 24-hour window versus 15 minutes changes whether a user returning the next day can safely retry.',
      'Is the order created before or after the payment authorisation? Creating the order first gives a stable id to use as the idempotency anchor and is usually the better shape.',
      'Can a single cart legitimately be paid twice \u2014 for example a split payment or a retry after a genuine decline? That determines whether the key is per cart or per payment attempt.',
      'What happens today when the browser dies between authorisation and our confirmation \u2014 is there a provider webhook that reconciles, or do we rely entirely on the client returning?'
    ],
    approach: [
      'Create the order server-side before payment, returning an `orderId` and a server-generated `paymentAttemptId`, and make that attempt id the idempotency key sent to the provider, so retrying is safe by construction rather than by client discipline.',
      'Model the client as an explicit state machine \u2014 `idle`, `creatingOrder`, `authorising`, `awaiting3DS`, `confirming`, `succeeded`, `failed` \u2014 persisted in `sessionStorage` keyed by cart id, so a refresh resumes into the correct state rather than restarting at `idle`.',
      'Disable the pay button on the first click via the state machine rather than via a boolean flag, and make the handler itself idempotent so a double-tap that beats a re-render cannot fire two submissions.',
      'On any network error during authorisation, do not retry blindly: transition to a `verifying` state that polls the order status endpoint, because a timeout means unknown, not failed, and treating unknown as failed is exactly how double charges happen.',
      'Handle the 3DS redirect by persisting the attempt id before navigating away and reconciling on return by order status, not by URL parameters, since the user may return via a bookmark, a back button or a different tab.',
      'Make the server the reconciler of record: the provider webhook updates order status independently of the client, so a user whose phone died still gets a completed order and a confirmation email.',
      'Show honest UI for the unknown state \u2014 "confirming your payment" with a polling indicator and an explicit "do not retry" message \u2014 rather than a generic spinner that invites a refresh, and give a clear path to support with the order id visible.',
      'Instrument the funnel by state transition, especially transitions into `verifying` and out of it, so the duplicate-charge rate becomes a monitored metric with an owner rather than a support ticket count.'
    ],
    deepdives: [
      {
        q: 'The authorisation request times out after 30 seconds. Exactly what does the client do next?',
        a: 'It must not re-send the authorisation as a fresh attempt. It transitions to `verifying` and polls the order status endpoint with backoff for up to about 60 seconds. Three outcomes: the order is authorised, so we proceed to confirmation; the order is definitively declined, so we show the decline and allow a new attempt with a new attempt id; or it is still unknown, in which case we show the pending state, tell the user they will receive an email, and stop. If a retry is genuinely needed, it reuses the same idempotency key, so the provider returns the original result rather than charging again.'
      },
      {
        q: 'Why generate the idempotency key on the server rather than in the browser?',
        a: 'A browser-generated key is lost on refresh unless it is persisted, and persisting it correctly across a 3DS redirect, a crashed tab and a restored session is more fragile than it looks. A server-issued attempt id is durable, is already associated with the order, and lets the server enforce the invariant that an order has at most one in-flight attempt. I would still accept a client-supplied key as a secondary guard for the order-creation call itself, since that request also needs protection against double submission before any server id exists.'
      },
      {
        q: 'Support still sees duplicate charges after launch, at a lower rate. How do you find the remaining cause?',
        a: 'I would stop treating it as one bug. Each duplicate gets classified by the state transition sequence recorded on the two attempts, which the funnel instrumentation gives me. The usual remaining causes are genuinely distinct: a user legitimately retrying after a decline that was actually an approval reported late, two devices submitting the same cart, and provider-side retries of a webhook creating a second order. Each needs a different fix \u2014 a longer key window, a server-side lock on cart id, and webhook idempotency respectively \u2014 and lumping them together is why the problem persists.'
      },
      {
        q: 'How do you roll this out without risking payments during the migration?',
        a: 'Payments are the one place I would not do a straight flag flip. I would ship the server-side attempt id and webhook reconciliation first, behind the existing flow, so reconciliation is already correct before the client changes. Then the new client state machine rolls out by percentage with the duplicate-charge rate and authorisation success rate as automated guardrails, holding at 1% for long enough to see a full day of mobile-network conditions. I would also keep the old flow removable in one config change for at least a month, and I would not run this rollout during a peak sales period.'
      }
    ],
    redflags: [
      'Prevents double submission with only a disabled button or a `isSubmitting` boolean, which loses to a refresh or a background-and-return.',
      'Treats a network timeout as a failure and automatically retries the charge with a new key.',
      'Relies on the client returning from the 3DS redirect to complete the order, with no server-side webhook reconciliation.',
      'Stores payment state only in React state, so a refresh mid-flow restarts checkout from scratch.'
    ],
    topicIds: ['api-and-bff', 'state-management', 'frontend-security']
  },
  {
    id: 'i18n-rtl-thirty-locales',
    title: 'Design internationalisation and RTL support for 30 locales',
    track: 'frontend',
    difficulty: 'core',
    pattern: 'Message catalogues as build artefacts, logical CSS, locale-aware formatting',
    prompt:
      'A product in English must launch in 30 locales in six months, including Arabic and Hebrew (RTL), Japanese (no word wrapping at spaces), German (strings 40% longer) and Hindi (complex script shaping). The codebase has 8,000 hardcoded English strings across 600 components, translators work in a TMS on a two-week cycle, and marketing wants to launch locales incrementally rather than all at once.',
    clarify: [
      'Are the 30 locales launching with full translation or partial? Partial coverage means a per-key fallback chain and a policy for what a missing string renders, which affects every component.',
      'Do any locales need different layouts or features rather than just translated text \u2014 for example a different address form or name ordering? Those are not i18n, they are localisation variants, and they need real product decisions.',
      'Is the content in the product user-generated, which cannot be translated, or entirely product copy? Mixing translated chrome with untranslated user content in RTL is where bidirectional text bugs live.',
      'Does the server need to render localised HTML for SEO, or is client-side translation acceptable? SEO across 30 locales forces locale into routing and server rendering.'
    ],
    approach: [
      'Extract the 8,000 strings mechanically with a codemod that replaces literals with `t()` calls and auto-generates stable keys from the component path plus a content hash, reviewing in batches per component directory rather than by hand.',
      'Adopt ICU MessageFormat rather than simple interpolation, so plurals, gender and number formatting are expressed in the message where translators can control them, instead of being assembled by concatenation in code.',
      'Ban string concatenation for user-facing text with a lint rule, because concatenation is what makes a sentence untranslatable into languages with different word order.',
      'Ship message catalogues as separate, hashed JSON chunks loaded per locale and per route, so a user in Japan downloads Japanese for the route they are on, not 30 locales of everything.',
      'Convert all directional CSS to logical properties \u2014 `margin-inline-start` instead of `margin-left`, `padding-block` instead of vertical shorthands \u2014 enforced by a stylelint rule, then set `dir` on the `html` element so RTL is one attribute rather than a parallel stylesheet.',
      'Use `Intl` for every date, number, currency and relative time rather than a formatting library with its own locale data, and make raw `toLocaleString` calls without an explicit locale a lint error, since they silently use the device locale.',
      'Integrate the TMS through CI: extraction runs on merge, new keys are pushed automatically, translations are pulled and committed on a schedule, and a locale is only enabled once its coverage crosses a threshold \u2014 which is exactly the mechanism that supports incremental launch.',
      'Build a pseudo-locale for testing that expands every string by 40% and wraps it in brackets, and run the visual regression suite against it plus Arabic, so truncation and RTL breakage are caught in CI rather than by a user in Riyadh.'
    ],
    deepdives: [
      {
        q: 'What breaks in RTL that logical CSS properties do not fix?',
        a: 'Several things. Icons with inherent direction \u2014 back arrows, progress chevrons, undo \u2014 must be mirrored, but brand logos and media playback controls must not, so mirroring has to be an explicit per-icon decision rather than a blanket transform. Anything positioned with JavaScript, like a tooltip computing `left` from `getBoundingClientRect`, needs direction awareness. Mixed-direction text \u2014 an Arabic sentence containing an English product name or a number \u2014 needs bidi isolation with `unicode-bidi: isolate` or the `dir="auto"` attribute, or the punctuation lands on the wrong side. And charts, timelines and any canvas rendering need their own direction handling since CSS does not reach them.'
      },
      {
        q: 'A key is missing in Japanese at runtime. What renders, and how do you know?',
        a: 'It falls back down a declared chain \u2014 regional to base language to English \u2014 and renders the English string rather than the raw key, because a raw key in production is a visible defect while an English fallback is merely unlocalised. Crucially it also emits a `missing_translation` telemetry event with the key and locale, sampled, so missing coverage is a monitored number rather than something a user reports. In development and in the pseudo-locale build the same case throws loudly, which is where I want the failure to surface.'
      },
      {
        q: 'German strings are 40% longer and break your layouts. Is that a design problem or an engineering one?',
        a: 'It is a design constraint that engineering has to make visible early. Practically I fix it in three ways: run the pseudo-locale in visual regression from week one so expansion breakage is caught continuously rather than at translation time, avoid fixed-width containers and single-line truncation for anything that carries meaning, and give designers a rule that any component with text must be reviewed at 140% string length. Where a control genuinely cannot expand \u2014 a compact toolbar \u2014 the right answer is a shorter source string agreed with content design, not a CSS hack.'
      },
      {
        q: 'How do you handle the two-week translation cycle without blocking weekly feature releases?',
        a: 'Decouple the release of code from the release of a locale. New strings ship immediately with the English fallback active, the key is pushed to the TMS on merge, and the translated value arrives in a later pull without a code change because catalogues are data loaded at runtime, not compiled in. For high-visibility launches where an untranslated string is unacceptable, the feature flag for that locale gates on translation coverage of its specific key set, which the CI pull can compute. The anti-pattern is holding a release until all 30 locales are complete, which turns translation into a release blocker forever.'
      }
    ],
    redflags: [
      'Builds sentences by concatenating translated fragments with variables, making correct translation impossible for many languages.',
      'Treats RTL as a mirrored stylesheet rather than logical properties plus explicit per-icon mirroring decisions.',
      'Bundles all 30 locale catalogues into the main bundle.',
      'Has no pseudo-locale or long-string testing, so German and Arabic breakage is discovered in production.'
    ],
    topicIds: ['web-foundations', 'design-systems', 'rendering-strategies']
  },
  {
    id: 'accessible-complex-widget-suite',
    title: 'Design an accessible complex-widget suite',
    track: 'frontend',
    difficulty: 'warmup',
    pattern: 'Behaviour primitives, focus management, testing a11y as a contract',
    prompt:
      'Your product must meet WCAG 2.2 AA for a public-sector contract worth $12M, and an external audit happens in four months. The hard components are a combobox with async options, a data grid with cell navigation, a multi-level menu, a modal stack and a date-range picker. Three teams have each built their own version of each, and screen-reader users report that the current combobox announces nothing when results load.',
    clarify: [
      'Which assistive technology combinations are in scope for the audit \u2014 NVDA with Firefox, JAWS with Chrome, VoiceOver with Safari? They disagree enough that "accessible" is only meaningful against a named matrix.',
      'Is the audit against the shipped product or against the component library? If it is the product, I need a remediation plan for existing screens, not just good new components.',
      'Are keyboard-only power users a real population here, or is the requirement compliance-driven? That changes whether I optimise for audit pass or for genuine usability, which sometimes diverge.',
      'Can I consolidate the three teams onto one implementation within four months, or must I remediate three in parallel? Consolidation is the only way this stays maintainable but it costs delivery time.'
    ],
    approach: [
      'Do not write ARIA from scratch: build on a headless behaviour library (React Aria or Radix primitives) that already encodes the WAI-ARIA authoring practices, and keep your own code to styling and composition.',
      'Consolidate to one implementation per widget in the design system, and give the three teams a codemod plus a deprecation deadline, because three accessible implementations will diverge into three inaccessible ones within a year.',
      'Fix the combobox announcement specifically: the listbox is referenced by `aria-controls`, the active option is tracked with `aria-activedescendant` rather than moving DOM focus, and a polite live region announces "8 results available" when the async options settle, debounced so rapid typing does not produce a stream of interruptions.',
      'Manage focus explicitly at every boundary: a modal traps focus and restores it to the trigger on close, a stacked modal restores to the modal beneath it, and a route change moves focus to the main heading, since focus loss to `body` is the most common real-world failure.',
      'Implement the grid with the composite widget pattern \u2014 a single tab stop into the grid, arrow keys for cell navigation, and `aria-rowindex` and `aria-colindex` on virtualised rows so the position announced matches the full dataset rather than the rendered window.',
      'Add automated checks at two levels: `axe-core` in component tests catches static violations, and Playwright keyboard-journey tests assert the actual tab order and focus destination for each widget, which is where the real bugs are and where axe is blind.',
      'Run manual testing against the named AT matrix on a schedule, with a scripted set of tasks per widget, because no automated tool detects a technically valid ARIA pattern that is incomprehensible to listen to.',
      'Make accessibility a release gate rather than a project: axe violations fail CI, the keyboard journey suite is required, and new components need a documented AT test before they can be published.'
    ],
    deepdives: [
      {
        q: 'Automated axe tests pass on every component but the audit still finds 40 issues. Why?',
        a: 'Because axe checks what is statically verifiable \u2014 missing labels, contrast, invalid ARIA \u2014 and roughly half to two thirds of real WCAG failures are not statically verifiable. Focus order after a dynamic change, whether a live-region announcement is actually useful, whether an error message is associated with the field that caused it, and whether a custom widget behaves as its role promises all require interaction or judgement. I would treat automated coverage as a floor that prevents regressions, and plan the audit remediation budget assuming it catches maybe a third of what an auditor will.'
      },
      {
        q: 'Your virtualised grid only renders 40 of 10,000 rows. What does a screen reader announce, and how do you fix it?',
        a: 'By default it announces a 40-row table, which is a factual lie to the user about where they are. The fix is to set `aria-rowcount` to the true total on the grid and `aria-rowindex` to the absolute index on each rendered row, so assistive technology reports "row 4,213 of 10,000" correctly despite the DOM containing a window. Keyboard navigation to a row outside the window must also scroll and render it before moving focus, otherwise arrow-down at the window edge silently does nothing.'
      },
      {
        q: 'A designer\u2019s brand colour fails contrast on disabled buttons. How do you resolve it?',
        a: 'WCAG 2.2 does not require contrast for disabled controls, so the compliant answer is that it passes. The useful answer is that unreadable disabled states are a genuine usability problem and a frequent source of support tickets, so I would push for a disabled treatment that keeps 3:1 against the background even though it is not required. More importantly I would question the disabled button itself: an aria-disabled button that stays focusable and explains why it is unavailable is better for everyone than a control that cannot be focused and gives no reason.'
      }
    ],
    redflags: [
      'Hand-writes ARIA roles and states for a combobox or grid instead of building on an established behaviour library.',
      'Equates passing automated axe checks with being accessible.',
      'Never mentions focus management on route change, modal close or async content update.',
      'Leaves three divergent implementations in place and only fixes the newest one.'
    ],
    topicIds: ['design-systems', 'web-foundations', 'browser-rendering']
  },
  {
    id: 'frontend-build-ci-platform',
    title: 'Design a build and CI platform for 200 frontend engineers',
    track: 'frontend',
    difficulty: 'hard',
    pattern: 'Affected-graph builds, remote caching, developer feedback loop as an SLO',
    prompt:
      'Two hundred engineers work in a monorepo with 140 packages and 6 deployable apps. CI takes 52 minutes at p50 and 2 hours at p95, the flake rate is 8%, and the merge queue backs up for hours on busy afternoons. Local `dev` startup is 4 minutes. Cloud CI spend is $180k a year and the CFO has asked why. You have a platform team of four.',
    clarify: [
      'What fraction of the 52 minutes is test execution versus build versus install and setup? Optimising the wrong one is the standard failure, and I would want the breakdown before proposing anything.',
      'Is the 8% flake rate concentrated in a few suites or spread evenly? Concentrated flake is a week of work; evenly spread flake usually means a systemic issue like shared test state or timing-dependent E2E.',
      'Do all 6 apps genuinely need to be built and tested on every PR, or is the dependency graph mostly disjoint? If it is disjoint, affected-only builds alone may cut the median dramatically.',
      'What is the actual business cost being optimised \u2014 the $180k of compute, or 200 engineers waiting? At loaded cost, an hour of waiting per engineer per day dwarfs the entire CI bill, which reframes the whole conversation.'
    ],
    approach: [
      'Measure before changing anything: instrument every CI job with per-step timing, produce a flame chart of the median and p95 pipeline, and publish the breakdown, because four engineers cannot afford to optimise by intuition.',
      'Adopt a task graph runner (Nx or Turborepo) with a correct dependency graph, so a PR touching one leaf package runs that package\u2019s tests and its dependents\u2019 tests, not all 140.',
      'Add remote build caching keyed by content hash of inputs including the toolchain version, so unchanged packages are restored rather than rebuilt, and make cache hit rate a tracked metric with a target above 80% on main.',
      'Attack flake as a first-class programme: quarantine flaky tests automatically after a detected threshold of inconsistent results on identical commits, route them to the owning team with a deadline, and never let a quarantined test silently stay quarantined for months.',
      'Split the suite by feedback value: fast unit and type checks as required blocking checks under 5 minutes, integration tests in parallel shards, and the slow end-to-end suite on the merge queue and on a post-merge schedule rather than on every push.',
      'Replace the backed-up merge queue with a batching queue that speculatively tests batches of PRs together and bisects only on failure, which turns N sequential runs into roughly log N on a healthy day.',
      'Fix local dev separately: move to an esbuild or Vite-based dev server with on-demand transpilation so startup is seconds, and let engineers run only the app they are working on rather than the whole graph.',
      'Report cost per merged PR rather than total spend, so the CFO conversation is about efficiency and throughput, and cut spend concretely by using cheaper spot runners for non-blocking jobs and by not running the full E2E suite on every push.'
    ],
    deepdives: [
      {
        q: 'Remote caching introduces a risk of a false cache hit. How do you keep it correct?',
        a: 'The cache key must include everything that can affect the output: source content hashes of the package and all its transitive dependencies, the lockfile, the tool versions, the environment variables the task reads, and the task definition itself. The two classic holes are tasks that read an undeclared environment variable and tasks that touch files outside their declared inputs, both of which produce a hit that should have been a miss. I would run a periodic cache-verification job that rebuilds a sample of cached tasks from scratch and diffs the output, so a correctness bug is caught by the platform rather than by a production incident.'
      },
      {
        q: 'The flake rate stays at 8% after a quarter of effort. What is actually going on?',
        a: 'Usually one of three things, and I would find out which before spending more. Either the flake is concentrated in E2E tests that are genuinely testing an async system with real timing, in which case the fix is architectural \u2014 deterministic waits on application state rather than timeouts, and seeded test data rather than shared fixtures. Or it is shared mutable state between parallel test workers, which shows up as failures that correlate with shard count. Or, most commonly in my experience, there is no ownership: tests are quarantined and never fixed because nobody is accountable, and the fix is organisational \u2014 flake budget per team, visible, with the same weight as an SLO.'
      },
      {
        q: 'How do you justify the platform team\u2019s existence to the CFO who is asking about $180k?',
        a: 'I would reframe from compute cost to throughput cost with the same arithmetic they use. Two hundred engineers, a median CI wait contributing an hour of context-switching per engineer per day, at a loaded rate, is several million dollars a year of capacity \u2014 an order of magnitude more than the $180k. Then I commit to metrics they can audit: p50 and p95 time-to-green, merged PRs per day, and cost per merged PR. I would also be honest that some of the $180k should go up, not down, if buying faster runners reduces wall-clock wait, and I would show the trade explicitly rather than optimising the number they asked about.'
      },
      {
        q: 'How do you migrate 140 packages onto a task graph runner without a six-month freeze?',
        a: 'Incrementally and in the boring order. First make the graph explicit without changing execution: declare dependencies and run the existing scripts through the runner with caching disabled, so failures are about graph correctness only. Then enable local caching, then remote caching read-only, then read-write once hit-rate and verification look sane. Package-by-package migration is possible because the runner can shell out to whatever the package already does. The thing I would not do is combine the runner migration with a build-tool migration, because when CI breaks you need to know which change caused it.'
      }
    ],
    redflags: [
      'Proposes buying bigger CI runners as the primary fix without a per-step breakdown of where 52 minutes goes.',
      'Ignores the 8% flake rate, which makes every other optimisation invisible behind retries.',
      'Runs the full end-to-end suite on every push and treats it as non-negotiable.',
      'Adds remote caching without addressing cache key correctness or verifying that hits are sound.'
    ],
    topicIds: ['deployment-and-rollout', 'react-at-scale', 'frontend-observability']
  },
  {
    id: 'url-shortener',
    title: 'Design a URL shortener',
    track: 'backend',
    difficulty: 'warmup',
    pattern: 'ID generation, read-heavy caching, redirect semantics',
    prompt:
      'Build a link shortener handling 500M new links a year and 50k redirects per second at peak, with a p99 redirect latency budget of 30 ms globally. Links never expire, marketing needs per-link click analytics within a minute, and a small number of links go viral and take 40% of all traffic for a few hours.',
    clarify: [
      'Must short codes be unguessable? If links can point at private documents, sequential base62 encoding leaks the entire corpus and I need random codes with collision handling instead.',
      'Are custom vanity aliases supported? They break pure ID-derived code generation and introduce a uniqueness constraint that must be enforced transactionally.',
      'Is analytics allowed to be approximate, or must every click be counted exactly? Exact counting on a 50k/s hot path is a very different system from sampled or eventually-aggregated counts.',
      'Do we need a 301 or a 302? A 301 is cached by browsers forever, which makes redirects free but makes analytics and link editing impossible.'
    ],
    approach: [
      'Generate codes from a distributed counter: each write node takes a 64k block from a central range allocator, base62-encodes the value, giving 7-character codes with zero coordination per write and no collision checks.',
      'For links requiring unguessability, issue 10-character random codes from a CSPRNG in a separate keyspace, with a unique-index insert that retries on the rare collision, and let the caller choose per link.',
      'Store the mapping in a partitioned key-value store keyed by short code \u2014 the access pattern is a single-key point read, so a relational database buys nothing and costs elasticity.',
      'Serve redirects from an edge cache: the code-to-URL mapping is immutable in the common case, so it caches at the CDN with a long TTL and the origin only sees cold codes, which is what makes 30 ms globally achievable.',
      'Return `302` rather than `301` so browsers re-request and analytics stays accurate, and rely on the CDN cache rather than the browser cache for the latency win.',
      'Handle the viral 40% with request collapsing at the edge plus an in-process LRU on each origin node, so a hot code costs one origin read per node per TTL regardless of request rate.',
      'Make analytics asynchronous: the redirect path appends a compact event to a local buffer flushed to Kafka, and a stream job aggregates per-link counts into a serving store on a one-minute tumbling window, so the hot path never writes to an analytics store.',
      'Handle deletes and abuse with a separate blocklist checked at the edge via a bloom filter in edge KV, so taking a malicious link down is seconds rather than waiting for a long cache TTL to expire.'
    ],
    deepdives: [
      {
        q: 'A link is reported as malware and must stop resolving within 60 seconds, but it is cached at 200 edge locations with a 24-hour TTL. What do you do?',
        a: 'TTL-based expiry cannot meet a 60-second requirement, so I need an explicit invalidation path plus a fast negative check. The primary mechanism is a CDN purge by cache key, which most providers complete in tens of seconds globally. Because purge is best-effort, I also keep a small blocklist distributed to edge KV with a 10-second refresh, checked by an edge function before serving the cached redirect. The blocklist is bounded in size, so it stays cheap, and it means the correctness of takedown does not depend on purge succeeding everywhere.'
      },
      {
        q: 'Your range allocator for the counter goes down. What happens to writes?',
        a: 'Nothing immediately, which is the point of allocating 64k blocks: each write node has enough locally allocated ids for hours of traffic. Nodes request the next block when they are at 20% remaining, so a short allocator outage is invisible. If the outage outlasts the buffer, writes fail rather than risk duplicate codes \u2014 I would not fall back to a guessed range. For durability the allocator is a small strongly-consistent store, and losing it entirely means restoring the high-water mark conservatively by skipping forward past any possibly-issued range, which wastes codes but never reuses them.'
      },
      {
        q: 'How do you count clicks exactly if marketing later demands exact billing-grade counts?',
        a: 'I would push back first, because exact counting on the redirect path trades availability for a number nobody audits. If it is genuinely required, the redirect path writes the event durably before responding \u2014 to a partitioned log with acknowledgement \u2014 which adds a few milliseconds and couples redirect availability to the log. Deduplication then needs an event id derived from the request so retries do not double-count, and the aggregation must be exactly-once, which in practice means idempotent upserts keyed by event id in the aggregate store. I would state the latency and availability cost explicitly as the trade.'
      }
    ],
    redflags: [
      'Hashes the long URL with MD5 and truncates, then hand-waves collisions rather than handling them.',
      'Uses a relational database with a random-UUID primary key as the redirect store, ignoring the point-read access pattern and index locality.',
      'Writes an analytics row synchronously on the redirect path at 50k/s.',
      'Returns a 301 and then wonders why click analytics undercounts and edited links never update.'
    ],
    topicIds: ['server-side-caching', 'sharding-and-partitioning', 'api-design-backend']
  },
  {
    id: 'distributed-rate-limiter',
    title: 'Design a distributed rate limiter',
    track: 'backend',
    difficulty: 'core',
    pattern: 'Token bucket, approximate counters, fail-open versus fail-closed',
    prompt:
      'Your API gateway fleet of 200 nodes across 3 regions must enforce per-tenant rate limits for 40,000 tenants, with limits ranging from 10 requests per minute on the free tier to 50,000 requests per second for the largest customer. Limit decisions must add under 2 ms to p99 request latency, and the business insists that a paying customer must never be wrongly throttled, while abuse must be stopped within seconds.',
    clarify: [
      'Is the limit a hard contractual ceiling or a protection mechanism? A protection limit can be approximate and fail open; a billing-enforced quota cannot, and that single answer determines the whole design.',
      'Are limits per region or global? A global limit across 3 regions requires cross-region coordination on the hot path, which is hard to reconcile with a 2 ms budget.',
      'What is the tenant distribution \u2014 do a handful of tenants dominate traffic? Hot tenants make a single shared counter key a hotspot and need a different treatment from the 39,900 quiet tenants.',
      'Should a throttled request be rejected or queued? Queueing changes this from a rate limiter into an admission-control and backpressure system with very different failure modes.'
    ],
    approach: [
      'Implement token bucket rather than fixed window, since it handles bursts naturally and its state is two numbers per key \u2014 token count and last refill timestamp \u2014 which is cheap to replicate.',
      'Use a two-tier design: each gateway node holds a local bucket with a locally allocated share of the tenant\u2019s budget, and a central Redis cluster acts as the coordinator that periodically redistributes allocation based on observed per-node demand.',
      'Size the local allocation adaptively: a node serving 1% of a tenant\u2019s traffic gets roughly 1% of the budget plus a safety margin, refreshed every 200 ms, so the hot path is an in-memory compare-and-decrement with no network call and easily fits the 2 ms budget.',
      'Shard the coordinator by tenant id with consistent hashing, and for the largest tenants split the key into N sub-counters (`tenant:123:shard:0..15`) that each node hashes into, avoiding a single hot Redis key at 50,000 requests per second.',
      'Handle the 10-per-minute free tier differently: those limits are too small to subdivide across 200 nodes, so those tenants are checked against the central store directly, which is affordable precisely because their traffic is negligible.',
      'Fail open on coordinator unavailability for paying tenants and fail closed for free tenants, with the policy expressed as tenant-tier configuration rather than hardcoded, since the business requirement is explicitly asymmetric.',
      'Return `429` with a `Retry-After` header and `X-RateLimit-Remaining`, and emit a structured decision log sampled at a low rate plus full counters, so a customer dispute can be answered with evidence.',
      'Add a separate, faster abuse path: a coarse per-IP and per-credential limiter at the edge with much higher thresholds and a hard fail-closed policy, so stopping an attack does not depend on the tenant-aware tier being healthy.'
    ],
    deepdives: [
      {
        q: 'The Redis coordinator becomes unavailable for 90 seconds. Walk through exactly what happens.',
        a: 'Each node keeps serving from its last allocation, which drifts stale: a tenant whose traffic shifts to different nodes will have budget stranded on idle nodes. For paid tiers the policy is fail open, so the practical effect is that a tenant can exceed their limit by roughly the sum of unused local allocations \u2014 bounded and acceptable. Free tiers, which check centrally, fail closed and get 429s, which is the deliberate asymmetry. I would also have each node fall back to a conservative static allocation after the allocation goes stale past a threshold, so a long outage converges to limits-are-enforced-approximately rather than limits-are-off.'
      },
      {
        q: 'Why not just run an exact global counter in Redis with a Lua script per request?',
        a: 'It is correct and it is what I would build first at small scale, but at 200 nodes and a 2 ms p99 budget a synchronous round trip per request to a cross-AZ Redis is already most of the budget, and it makes every API request depend on Redis availability. It also concentrates the largest tenant on one key, which a single Redis shard cannot serve at 50,000 operations per second with headroom. The local-allocation design trades exactness \u2014 you can overshoot by the allocation granularity \u2014 for latency and availability, and the business requirement that paying customers are never wrongly throttled makes overshoot the cheaper error.'
      },
      {
        q: 'A tenant complains they were throttled at 8,000 requests per second when their limit is 10,000. How do you investigate?',
        a: 'First I check whether their traffic was skewed across gateway nodes: if 90% landed on 5 of 200 nodes, those nodes exhausted their local allocation while the global budget was unused. That is the known failure mode of local allocation and the fix is faster redistribution or demand-weighted allocation, both of which I would have instrumented \u2014 I track per-node allocation versus consumption so this is a dashboard lookup, not an investigation. Second, I check the sub-counter sharding for a hash imbalance. Third, I confirm the request count we measured matches theirs, since clients often count differently from the gateway, particularly around retries.'
      },
      {
        q: 'How would you migrate 40,000 tenants from the existing naive fixed-window limiter without breaking anyone?',
        a: 'Token bucket and fixed window disagree at the boundaries, so some tenants will see different behaviour even at the same nominal limit. I would run the new limiter in shadow mode first, computing decisions and logging them without enforcing, then diff shadow decisions against the live limiter per tenant for a week to find who is materially affected \u2014 in my experience it is a small number of bursty clients. Those tenants get a proactive conversation and possibly a raised limit. Then enforcement rolls out tenant-cohort by tenant-cohort with the 429 rate per tenant as an automatic rollback trigger.'
      }
    ],
    redflags: [
      'Uses a fixed window counter and never mentions that a client can send twice the limit across a window boundary.',
      'Puts a synchronous Redis call on every request without checking it against the stated 2 ms p99 budget.',
      'Applies one fail-open or fail-closed policy to everyone, ignoring the explicit requirement that free and paid tiers differ.',
      'Ignores hot-key concentration for the largest tenant, so one Redis shard is asked to do 50,000 operations per second.'
    ],
    topicIds: ['rate-limiting-and-tenancy', 'resilience-patterns', 'server-side-caching']
  },
  {
    id: 'distributed-cache',
    title: 'Design a distributed cache',
    track: 'backend',
    difficulty: 'core',
    pattern: 'Consistent hashing, invalidation, stampede control',
    prompt:
      'Design the shared caching tier for a platform where 300 services read from a primary database cluster that is at 70% CPU. Target is 2M cache operations per second, cached objects range from 200 bytes to 4 MB, and a small set of keys are read 10,000 times per second each. The database team will not accept a cache design where a cache-layer failure produces a thundering herd that takes the database down.',
    clarify: [
      'What staleness can each consumer tolerate? A 60-second stale product description and a stale permission check have completely different correctness implications and should not share a TTL policy.',
      'Is invalidation event-driven from the database, or is TTL-only acceptable? Write-through and event-driven invalidation require a reliable change stream and are far more work than TTL.',
      'Are the 4 MB objects common or rare? Large values wreck slab allocation and network fairness, and may belong in object storage with the cache holding only a pointer.',
      'Do we need cross-region cache coherence, or is a per-region cache with independent TTLs acceptable? Cross-region invalidation ordering is the expensive requirement.'
    ],
    approach: [
      'Partition with consistent hashing using a large number of virtual nodes per physical server \u2014 on the order of 200 \u2014 so adding or removing a node moves roughly 1/N of keys rather than rehashing everything.',
      'Standardise the key schema as `service:entity:version:id` with the schema version embedded, so a data-shape change is a key-space change and there is no need to invalidate anything on deploy.',
      'Default to cache-aside with TTL, and reserve write-through for the small set of entities where staleness is unacceptable, because write-through couples write availability to cache availability.',
      'Prevent stampedes on the hot keys with per-key single-flight: a miss takes a short-lived lock and only one caller recomputes while the others wait briefly or serve the stale value, combined with probabilistic early expiry so keys do not all expire simultaneously.',
      'Add an in-process L1 cache in each client with a 1-to-5-second TTL for the hottest keys, which turns 10,000 reads per second per key into a handful of remote reads and removes the hot-shard problem entirely.',
      'Route the 4 MB objects to a separate cache pool with its own memory configuration and eviction policy, so one large value does not evict thousands of small ones and network buffers stay predictable.',
      'Protect the database explicitly with a bounded concurrency limiter on cache-miss fills per entity type, so even a total cache flush results in a controlled trickle to the database rather than 2M requests per second arriving at once.',
      'Cache negative results with a short TTL to stop repeated lookups for missing keys, and use a bloom filter for existence checks where the miss rate is high, since unbounded misses are how caches fail to protect anything.'
    ],
    deepdives: [
      {
        q: 'A cache node dies. Describe the next 30 seconds at the database.',
        a: 'Consistent hashing moves that node\u2019s share of the keyspace \u2014 roughly 1/N \u2014 to neighbours, so those keys miss simultaneously. Without protection that is a correlated burst to the database. The three mechanisms that contain it are the client L1 cache absorbing the hottest keys, per-key single-flight so a key that 500 callers want produces one database read, and the bounded fill concurrency limiter which caps total database load regardless of miss rate. I would also size the cluster so losing one node is a fraction, not a third \u2014 a 3-node cache is a database outage waiting for a deploy.'
      },
      {
        q: 'How do you invalidate a cached entity that is derived from five database tables?',
        a: 'TTL is the honest default here, because deriving invalidation for a five-way join means tracking dependencies you will inevitably get wrong. If freshness genuinely matters, I would use change-data-capture from the database write-ahead log into a stream, with a materialiser that knows the derivation and writes the composed object into the cache on change \u2014 that inverts the problem from invalidation to recomputation and gives a consistent object rather than a hole. The cost is an extra pipeline with its own lag and failure modes, so I would only do it for entities where a stale read causes a real business problem.'
      },
      {
        q: 'Two services cache the same entity under different keys with different TTLs, and a user sees inconsistent data across two pages. Whose bug is it?',
        a: 'It is a platform bug, not a service bug, because the platform allowed it. The fix is ownership: an entity has exactly one cache key owned by the service that owns the data, and other services read it through that owner\u2019s client library rather than caching their own copy. I would enforce this with key-prefix ownership registered in a central registry and rejected at the client library level if a service writes under a prefix it does not own. Without that, cache coherence across 300 services degenerates into folklore.'
      },
      {
        q: 'How do you roll out a change to the cache serialisation format across 300 services?',
        a: 'Never in place. The serialisation version is part of the key, so writers on the new version write to new keys and old readers keep reading old keys \u2014 both populations coexist and the old keys age out by TTL. That costs a temporary doubling of memory for the affected entities, which I would budget for explicitly. The rollout is then: deploy readers that understand both formats, flip writers to the new format by percentage, wait for the old keys to expire, then remove the old reader path. Attempting a synchronised flip across 300 services is how you get a multi-hour outage.'
      }
    ],
    redflags: [
      'Uses modulo hashing over node count, so adding a node invalidates nearly the whole cache.',
      'Has no stampede protection and assumes TTL jitter alone is enough at 10,000 reads per second on a single key.',
      'Treats cache and database as interchangeable, with no bound on how much load a cache failure passes through.',
      'Mixes 200-byte and 4 MB objects in one pool with one eviction policy.'
    ],
    topicIds: ['server-side-caching', 'sharding-and-partitioning', 'resilience-patterns']
  },
  {
    id: 'message-queue',
    title: 'Design a message queue',
    track: 'backend',
    difficulty: 'hard',
    pattern: 'Log-structured storage, delivery semantics, consumer group rebalancing',
    prompt:
      'Build the internal queueing platform for 400 services: 5M messages per second aggregate, retention of 7 days, and consumer groups that must be able to replay from any point in that window. Some topics carry payment events that cannot be lost or reordered per account; others carry click events where a 0.01% loss is fine. A single misbehaving consumer must not be able to degrade other tenants of the platform.',
    clarify: [
      'Do the payment topics need total ordering or only per-key ordering? Total ordering across a topic caps throughput at a single partition and is almost never actually required.',
      'Is exactly-once required end-to-end, or is at-least-once with idempotent consumers acceptable? True exactly-once needs transactional coupling to the consumer\u2019s own store, which I cannot provide for 400 heterogeneous services.',
      'What is the maximum acceptable consumer lag before it is an incident, and who owns that \u2014 the platform or the consuming team? This shapes whether the platform enforces quotas or just reports.',
      'Does replay mean re-reading the log from an offset, or reprocessing into a fresh sink? Reprocessing into live sinks needs downstream idempotency that may not exist.'
    ],
    approach: [
      'Model each topic as a set of append-only partitioned logs, with the partition chosen by a hash of a producer-supplied key, giving per-key ordering without any global sequencer.',
      'Store each partition as segmented files on local NVMe with the page cache doing the read serving, replicate each partition to 3 brokers with a leader and an in-sync replica set, and acknowledge a write only once it is on a quorum of replicas for durability-critical topics.',
      'Expose durability as a per-topic setting: payment topics use `acks=all` with `min.insync.replicas=2` and disabled unclean leader election, click topics use `acks=1`, which is where the 0.01% loss tolerance buys real throughput.',
      'Track consumer progress as committed offsets per consumer group per partition, stored in a compacted internal topic, so replay is simply resetting an offset and retention is a storage decision rather than a delivery-state one.',
      'Assign partitions to consumers with a cooperative incremental rebalance protocol so adding one consumer moves only the partitions it takes over, rather than stopping the whole group \u2014 a stop-the-world rebalance on a large group is a self-inflicted outage.',
      'Offer at-least-once as the platform default and ship an idempotency helper library, and support transactional producer semantics for the subset of services whose sink is also transactional, while being explicit that exactly-once is a property of the whole pipeline and not of the queue.',
      'Enforce multi-tenancy with per-topic quotas on produce bytes per second, fetch bytes per second and request rate, applied at the broker with throttling rather than rejection, so a runaway consumer is slowed rather than killed and other tenants are unaffected.',
      'Handle poison messages with a per-topic retry policy and a dead-letter topic carrying the original message plus failure metadata, because an unhandled poison message blocking a partition is the most common real-world queue outage.'
    ],
    deepdives: [
      {
        q: 'A broker holding the leader for 300 partitions loses its disk. What happens to producers and consumers?',
        a: 'Leadership for those partitions fails over to in-sync replicas, which takes a controller election round and typically a few seconds. Producers with `acks=all` see retriable errors during the window and must have retries enabled with an idempotent producer id, or the retry itself creates duplicates. Consumers resume from their committed offsets against the new leaders. The dangerous setting is unclean leader election: enabling it lets an out-of-sync replica take over and silently truncates acknowledged messages, which is exactly why payment topics have it disabled and accept unavailability instead.'
      },
      {
        q: 'One consumer group is 6 hours behind on a topic with 7-day retention. What do you do, and what would you have done earlier?',
        a: 'Immediately: confirm whether it is a throughput problem or a stuck partition, because they look the same on a lag dashboard and have opposite fixes. If it is throughput, add consumers up to the partition count \u2014 and the partition count is the ceiling, which is why partition sizing is a capacity decision made at topic creation. If it is one stuck partition, it is almost always a poison message and the fix is the dead-letter path. Earlier: lag should have alerted at minutes, not hours, with the alert routed to the consuming team, and the platform should publish time-to-retention-loss rather than raw lag, since "6 hours behind on a 7-day retention" and "6 hours behind on a 12-hour retention" are very different emergencies.'
      },
      {
        q: 'Why is exactly-once so often claimed and so rarely true?',
        a: 'Because the queue can only guarantee exactly-once within its own boundary \u2014 deduplicating producer retries and atomically committing offsets with writes to other topics. The moment a consumer writes to an external database, a payment provider or a cache, the atomicity has to span two systems, and without a transaction across both you get at-least-once with a window where the write succeeded and the offset commit did not. The honest engineering answer is at-least-once delivery plus idempotent consumers keyed on a message id, which is achievable and testable. I would provide the idempotency library and the message id rather than market exactly-once.'
      },
      {
        q: 'How do you run this as a platform for 400 teams without becoming the bottleneck for every topic creation?',
        a: 'Self-service with guardrails encoded as policy rather than as review. Topic creation is an API with required declarations \u2014 owner, durability class, expected throughput, retention, key schema \u2014 and the platform derives partition count and replication from the declaration rather than letting teams guess. Defaults are safe, deviations require an approval, and cost is attributed back to the owning team so over-provisioning has a visible price. The platform team then owns the failure modes that cross tenants \u2014 quotas, rebalance storms, broker capacity \u2014 and publishes an SLO rather than reviewing individual topics.'
      },
      {
        q: 'Should you build this or run Kafka?',
        a: 'Run Kafka, or a managed equivalent, and I would say so in the first two minutes of the interview. The design above is essentially Kafka\u2019s because the design space has a strong attractor, and building it means owning replication correctness, rebalance protocols and a decade of operational edge cases with no differentiation. The genuinely interesting work is the platform layer: the self-service topic API, quotas, the idempotency library, lag SLOs and cost attribution. If the question is really "can you reason about log-structured queues", I want to show that; if it is "what would you actually do", the answer is buy the log and build the platform.'
      }
    ],
    redflags: [
      'Promises exactly-once delivery end to end without discussing the consumer\u2019s own write transaction.',
      'Uses a single partition to achieve ordering and does not connect that to a hard throughput ceiling.',
      'Has no dead-letter or poison-message path, so one bad message blocks a partition indefinitely.',
      'Ignores multi-tenancy entirely, so one consumer\u2019s fetch pattern can saturate brokers for everyone.'
    ],
    topicIds: ['queues-and-streaming', 'replication-and-consistency', 'event-driven-architecture']
  },
  {
    id: 'notification-fanout-system',
    title: 'Design a notification and fanout system',
    track: 'backend',
    difficulty: 'warmup',
    pattern: 'Channel abstraction, preference evaluation, provider failover',
    prompt:
      'Build the platform that delivers push, email, SMS and in-app notifications for a product with 120M users. Peak is a marketing campaign to 40M users in 30 minutes, alongside transactional notifications like password resets that must go out within 5 seconds regardless of what campaign is running. Users have granular preferences and quiet hours, and SMS costs real money per message so duplicates are directly expensive.',
    clarify: [
      'Do transactional and campaign notifications share infrastructure? They have opposite characteristics \u2014 low volume and strict latency versus high volume and loose latency \u2014 and sharing a queue means the campaign starves the password reset.',
      'Is the user preference check authoritative at send time or at enqueue time? A 30-minute campaign means a user can unsubscribe after enqueue, and sending anyway is a compliance problem in some jurisdictions.',
      'What is the dedup window for a given notification \u2014 must the same event never send twice ever, or within 24 hours? SMS cost makes this a money question rather than a taste question.',
      'Are we responsible for delivery confirmation or only handoff to the provider? Tracking actual delivery requires ingesting provider webhooks, which is a substantial system of its own.'
    ],
    approach: [
      'Separate the pipeline into priority classes with physically separate queues and worker pools: `transactional` with a small dedicated pool and a 5-second SLO, and `bulk` with an elastic pool, so a 40M campaign cannot delay a password reset.',
      'Model the flow as request, then resolve, then render, then deliver: a notification request names a template and a recipient set, the resolver expands it into per-user sends after evaluating preferences, the renderer localises and personalises, and channel adapters handle provider specifics.',
      'Evaluate preferences and quiet hours at delivery time rather than at enqueue time, reading from a fast per-user preference store, so a user who unsubscribes 10 minutes into a campaign is genuinely excluded.',
      'Expand the 40M recipient set in chunks through a queue rather than in one job: a campaign becomes thousands of batch tasks of 10,000 recipients each, giving natural parallelism, resumability and progress tracking.',
      'Deduplicate with an idempotency key of `(notificationType, userId, dedupWindowBucket)` stored in a TTL cache checked before provider handoff, which directly protects the SMS spend from retry storms.',
      'Abstract providers behind a channel interface with at least two providers per channel, health-tracked with circuit breakers, so an SMS provider outage fails over automatically rather than manually at 3am.',
      'Rate-limit per provider and per recipient: providers have their own throughput contracts, and a per-user cap of, say, 5 notifications per hour per channel prevents a bug in one service from carpet-bombing users.',
      'Ingest provider delivery webhooks into a status store keyed by send id, so bounce handling, suppression lists and deliverability metrics are driven by real outcomes rather than by handoff success.'
    ],
    deepdives: [
      {
        q: 'The campaign is halfway through 40M sends and someone realises the template has a broken link. What now?',
        a: 'There has to be a stop button, and it has to work on in-flight work rather than only on new work. Because expansion is chunked through a queue, cancellation is a campaign-level flag checked by every batch task before it renders, so pending batches drain as no-ops within seconds. Already-handed-off messages cannot be recalled, which is why I would also require a staged campaign rollout by default \u2014 1% of recipients, a 10-minute soak, then the remainder \u2014 so the blast radius of a bad template is 400,000 rather than 40M. Prevention beats cancellation here.'
      },
      {
        q: 'Your primary SMS provider starts returning success but not delivering. How would you detect it?',
        a: 'Handoff success is not delivery, so I monitor the delivery-webhook confirmation rate per provider as a distinct metric with its own alert, not just the send success rate. A provider silently dropping messages shows up as a divergence between accepted and delivered within minutes. For channels where confirmation is unreliable, I would run a synthetic canary \u2014 a small number of sends per minute to owned numbers across carriers \u2014 which is the only way to catch a per-carrier failure that the provider itself does not report. The remediation is shifting provider weight, which should be a config change rather than a deploy.'
      },
      {
        q: 'How do you keep from sending a user the same thing on four channels?',
        a: 'Channel selection needs to be a policy decision, not four independent pipelines. Each notification type declares a channel strategy \u2014 for example, in-app immediately, push if not read within 5 minutes, email digest if still unread after an hour \u2014 and the orchestrator holds that escalation state per notification, cancelling downstream steps when a read receipt arrives. That requires in-app read events flowing back into the platform, which is worth building because without it the escalation logic devolves into sending everything everywhere.'
      }
    ],
    redflags: [
      'Puts transactional and bulk notifications on the same queue and assumes priority flags will save the password reset.',
      'Expands a 40M recipient list in a single long-running job with no resumability or progress.',
      'Checks user preferences only at enqueue time, then sends to users who unsubscribed mid-campaign.',
      'Treats provider handoff success as delivery and has no webhook ingestion or bounce handling.'
    ],
    topicIds: ['queues-and-streaming', 'event-driven-architecture', 'resilience-patterns']
  },
  {
    id: 'social-feed-fanout',
    title: 'Design a social feed with fanout',
    track: 'backend',
    difficulty: 'core',
    pattern: 'Fanout-on-write versus read, hybrid for celebrities, ranking as a separate stage',
    prompt:
      'Design the home timeline for a social network with 400M monthly users, median following count of 300 and a long tail of accounts followed by 80M people. Reads are 100:1 against writes, the timeline must be personalised and ranked rather than purely chronological, and a post must be visible to followers within 5 seconds. Deleting a post must remove it from every timeline quickly, for legal reasons.',
    clarify: [
      'Is the timeline strictly reverse-chronological or ranked? Ranking means the precomputed timeline is a candidate set rather than the final answer, which changes what fanout-on-write actually buys.',
      'How fresh must the timeline be for an inactive user \u2014 does someone who last logged in 6 months ago need a maintained timeline? Fanning out to dormant users is usually the largest single waste in these systems.',
      'What is the true distribution of follower counts? The design hinges on it: if the 99th percentile is 5,000 followers, pure fanout-on-write works and the celebrity case is a special path for a few thousand accounts.',
      'Does "deleted within seconds" mean removed from stored timelines or merely filtered at read? Filtering at read is far cheaper and usually sufficient if the read path is authoritative.'
    ],
    approach: [
      'Use a hybrid fanout: fanout-on-write for the vast majority of accounts, pushing post ids into per-follower timeline lists, and fanout-on-read for accounts above a follower threshold of roughly 100,000, merged at read time.',
      'Store each user timeline as a capped list of post ids in a partitioned key-value store \u2014 the last 800 entries \u2014 keyed by user id, because a timeline is a bounded recent window and unbounded storage buys nothing.',
      'Run fanout asynchronously through a partitioned queue with the work chunked by follower batches, so a 200,000-follower account within the write threshold does not produce one enormous task.',
      'Skip fanout for dormant users entirely: maintain an activity bitmap and only write to timelines of users active in the last 30 days, rebuilding a dormant user\u2019s timeline on demand at login, which typically removes more than half of all fanout writes.',
      'Treat the stored timeline as a candidate set, not the answer: at read time merge the precomputed list with the celebrity pull, hydrate post metadata, apply blocks, mutes and visibility rules, then run the ranking model over roughly 500 candidates to produce 30 results.',
      'Enforce deletion at read: a deleted post id is added to a fast-lookup tombstone set checked during hydration, so removal is effective within a cache TTL of a second, while a background job lazily scrubs stored timelines without being on the critical path.',
      'Cache the hydrated, ranked timeline per user for a short window of 30 to 60 seconds, since the read amplification of a user refreshing repeatedly is otherwise the dominant cost.',
      'Bound the celebrity merge cost by caching each celebrity\u2019s recent post list separately with a very high hit rate \u2014 80M followers reading the same 20 post ids is the single most cacheable thing in the system.'
    ],
    deepdives: [
      {
        q: 'Why not pure fanout-on-read, given you already need a ranking pass over candidates?',
        a: 'Because for a user following 300 accounts, fanout-on-read means 300 scatter queries per timeline load, and at 100:1 read-to-write that is a brutal multiplier on the post store. Fanout-on-write moves the work to the write path where it is 300 small appends once, amortised over many reads. The hybrid exists because that arithmetic inverts for celebrities: one post by an 80M-follower account is 80M writes to save reads that the celebrity-list cache would have served almost for free. So the rule is fanout-on-write when followers are fewer than reads-per-post, pull otherwise.'
      },
      {
        q: 'A user with 80M followers posts, and 10M of them are online. Describe the load.',
        a: 'With the pull path there is no fanout write at all. At read time each of those 10M timeline requests merges the celebrity\u2019s cached recent-posts list, which is a single small key with an extremely high cache hit rate, so the incremental cost is one cache read per timeline load rather than 80M writes. The real load is on hydration and ranking, which would have happened anyway, and on the post\u2019s own engagement path \u2014 likes and replies hitting a single post row, which needs its own counter sharding. The lesson is that the celebrity problem on the read side is a caching problem and on the write side is a hot-key problem.'
      },
      {
        q: 'Timelines drift \u2014 some users report missing posts from people they follow. How do you debug that?',
        a: 'I would treat the stored timeline as a cache that can be wrong and build a reconciliation tool rather than hunting individual bugs. A background job samples users, recomputes their timeline from the source of truth \u2014 the follow graph and the post store \u2014 and diffs against the stored list, reporting a drift rate as a monitored metric. Typical causes are fanout task failures without retry, follows processed after a post, and the dormant-user optimisation misclassifying an active user. Having the drift metric means the fix is verifiable; without it you are responding to anecdotes.'
      },
      {
        q: 'How would you evolve this when product wants to add a second, algorithmically-sourced feed of accounts the user does not follow?',
        a: 'That breaks the assumption that candidates come from the follow graph, so I would restructure the read path into an explicit candidate-generation stage with multiple pluggable sources \u2014 follow-graph timeline, celebrity pull, recommendation retrieval, trending \u2014 each returning scored candidates into a common pool, followed by one ranking and one policy-filter stage. That is a bigger refactor than adding a source, and I would do it deliberately, because the alternative is a second parallel pipeline that duplicates blocks, mutes and deletion handling and eventually gets one of them wrong.'
      }
    ],
    redflags: [
      'Picks fanout-on-write or fanout-on-read globally with no threshold, then cannot explain the 80M-follower case.',
      'Fans out to all followers including accounts dormant for years.',
      'Stores unbounded timelines rather than a capped recent window.',
      'Implements deletion by rewriting millions of stored timelines synchronously instead of filtering at read.'
    ],
    topicIds: ['scalability-and-capacity', 'server-side-caching', 'data-modeling']
  },
  {
    id: 'chat-messaging-presence',
    title: 'Design a chat system with presence',
    track: 'backend',
    difficulty: 'core',
    pattern: 'Connection routing, per-conversation ordering, presence as soft state',
    prompt:
      'Build a messaging backend for a workplace product: 20M daily active users, 8M concurrent WebSocket connections, group conversations up to 5,000 members, and message delivery p99 under 200 ms. Messages must be durable and ordered within a conversation, read receipts and typing indicators are required, and the largest customer needs all their data resident in the EU.',
    clarify: [
      'Is ordering required across a conversation only, or globally per user? Per-conversation ordering can be achieved with a single partition per conversation, which is far cheaper than any global sequencer.',
      'Are typing indicators and presence durable or best-effort? If they are ephemeral, they should never touch the durable store and can be an order of magnitude cheaper.',
      'For the 5,000-member group, does every member need realtime delivery, or are most members reading later? Fanning out to 5,000 connections synchronously is very different from writing once and letting clients pull.',
      'Does EU residency mean data at rest only, or must processing also stay in region? Processing residency forces a full regional stack rather than a regional database.'
    ],
    approach: [
      'Terminate WebSockets on a stateless gateway tier with sticky routing recorded in a connection registry \u2014 a fast key-value store mapping `userId` to the gateway node holding their connection \u2014 so any service can route a message to a user in one hop.',
      'Persist messages to a partitioned log and store partitioned by `conversationId`, assigning a monotonic per-conversation sequence number on write, which gives ordering without a global clock and makes gap detection trivial for clients.',
      'Acknowledge the sender only after the durable write, then fan out to recipients asynchronously, so the sender never sees a message that could be lost while recipients see it within milliseconds.',
      'Fan out to the 5,000-member group by looking up which members currently have live connections \u2014 usually a small fraction \u2014 and pushing only to those, while everyone else syncs on next open via the per-conversation sequence cursor.',
      'Treat presence and typing as soft state in a separate in-memory tier with short TTLs and heartbeat refresh, never written to the durable store, and aggregate presence subscriptions per conversation so 5,000 members do not each subscribe to 4,999 others.',
      'Sync clients by cursor: a client reconnecting sends its last known sequence number per conversation and receives the delta, which handles offline, reconnect and multi-device with one mechanism.',
      'Model read receipts as a per-user high-water mark per conversation rather than per-message records, collapsing what would be 5,000 times N rows into one row per member.',
      'Implement EU residency as a shard-by-tenant-region topology: the tenant record names a home region, the connection gateway routes to that region, and cross-region access is only through explicitly audited paths.'
    ],
    deepdives: [
      {
        q: 'A gateway node holding 200,000 connections dies. What do clients experience?',
        a: 'Their sockets drop and they reconnect, landing on other nodes via the load balancer. The connection registry entries for that node go stale, so it must have a short TTL with heartbeat refresh, or senders will route messages to a dead node \u2014 that is the detail that makes or breaks this design. On reconnect each client sends its per-conversation cursors and receives any missed messages, so nothing is lost, only delayed. The operational risk is the reconnect stampede: 200,000 clients reconnecting at once needs jittered backoff on the client and enough spare gateway capacity to absorb it, which is a capacity planning decision I would make explicitly.'
      },
      {
        q: 'Typing indicators for 8M concurrent users: what is the actual message volume and how do you keep it sane?',
        a: 'It is the highest-volume message type in the system and the least valuable, which is the wrong combination. I would throttle at the client to one typing event every 3 seconds while actively typing, never send a stop event (let it expire by TTL), and suppress typing fanout entirely in conversations above roughly 20 members, where it is noise anyway. Server-side it stays in the ephemeral tier with no persistence and no delivery guarantee. The framing I would give is that presence and typing should be allowed to fail silently, and the architecture should make that failure cheap and isolated from message delivery.'
      },
      {
        q: 'Two users send messages to the same conversation at the same instant from different regions. What ordering do they see?',
        a: 'Both writes go to the conversation\u2019s home partition, which assigns sequence numbers, so there is one authoritative order and all clients converge to it. Locally each sender sees their own message immediately with an optimistic pending state, and it may reorder once the server sequence arrives \u2014 which is visible and needs a deliberate UI decision, usually keeping the optimistic position stable unless the difference is large. The important property is that ordering is decided in exactly one place; any design where two regions can both assign order for one conversation will produce divergent transcripts.'
      },
      {
        q: 'How do you add end-to-end encryption later without rebuilding the system?',
        a: 'The parts that would need to change are anything that reads message content server-side: search, notification previews, moderation and link unfurling. So the migration is mostly a product negotiation, not an infrastructure one. Architecturally I would keep the message body opaque to the transport and storage layers from day one \u2014 treat it as bytes with a content-type \u2014 so adding encryption does not touch routing, ordering or sync. Key distribution and multi-device key management are the genuinely hard parts and they live in a new service, not in the messaging path.'
      }
    ],
    redflags: [
      'Persists typing indicators and presence heartbeats to the durable message store.',
      'Uses a global sequencer or a single ordering service for all conversations.',
      'Pushes synchronously to all 5,000 group members and blocks the sender\u2019s acknowledgement on it.',
      'Has no per-conversation cursor, so reconnect and multi-device sync each need bespoke logic.'
    ],
    topicIds: ['queues-and-streaming', 'scalability-and-capacity', 'data-modeling']
  },
  {
    id: 'ride-matching-geo',
    title: 'Design ride matching with geospatial search',
    track: 'backend',
    difficulty: 'core',
    pattern: 'Spatial indexing, dispatch as an optimisation problem, supply-demand skew',
    prompt:
      'Build the matching service for a ride-hailing product in 60 cities: 400k drivers sending location updates every 4 seconds, 30k ride requests per minute at peak, and a matching decision required within 2 seconds. During a concert letting out, demand in a 1 km area spikes 50x while the rest of the city is quiet, and matching the nearest driver greedily produces visibly unfair outcomes for riders who waited longer.',
    clarify: [
      'Is the objective minimising rider wait, maximising driver utilisation, or maximising completed rides? They conflict during a surge, and the answer determines whether greedy nearest-driver is even the right algorithm.',
      'Can we batch requests over a short window? Batching a few seconds of requests turns greedy matching into a bipartite assignment problem with materially better global outcomes, at the cost of a little latency.',
      'Is a match binding, or can a driver decline? Declines mean the system needs a re-match loop with a decay policy, which dominates the real-world complexity.',
      'How accurate must "nearest" be \u2014 straight-line distance or estimated time of arrival on the road network? ETA-based matching needs a routing service in the hot path with its own latency budget.'
    ],
    approach: [
      'Index driver locations with a hierarchical spatial grid \u2014 S2 cells or H3 hexes at roughly 1 km resolution \u2014 held in an in-memory geospatial store sharded by city, so a proximity query is a lookup of a cell plus its ring of neighbours.',
      'Treat location updates as a high-volume, low-value stream: 100k updates per second go to the in-memory index with no durability, while a sampled copy goes to a log for analytics and trip reconstruction.',
      'Batch matching into 2-second windows per city region: collect open requests and available drivers, then solve a constrained assignment (Hungarian algorithm or a greedy approximation with a fairness penalty) rather than matching each request independently as it arrives.',
      'Score candidate pairs on estimated time of arrival from a routing service rather than straight-line distance, with ETA cached per origin-cell to destination-cell pair for a short TTL so the routing service is not called 30k times per minute at full cost.',
      'Add a waiting-time term to the objective so a rider who has waited 90 seconds outranks a marginally closer new request, which directly addresses the fairness complaint without abandoning efficiency.',
      'Handle the concert spike by detecting cell-level demand-supply imbalance and responding with two levers: widening the search radius for that cell, and triggering surge pricing which both rations demand and attracts supply from neighbouring cells.',
      'Make dispatch a state machine with timeouts \u2014 `offered`, `accepted`, `declined`, `expired` \u2014 where an offer holds a soft reservation on the driver for 15 seconds, so two requests cannot be matched to the same driver and a non-responding driver does not strand a rider.',
      'Shard everything by city, since rides do not cross cities, giving natural isolation: a matching failure in one city cannot affect the other 59, and capacity can be provisioned per city against its own peak.'
    ],
    deepdives: [
      {
        q: 'Why is batched assignment better than greedy nearest-driver, and what does it cost?',
        a: 'Greedy is locally optimal and globally poor: assigning the nearest driver to whoever asked first can strand a rider 200 metres away because their driver was taken by someone 2 km away. Batching a 2-second window lets me solve the assignment jointly, typically reducing average pickup time meaningfully and reducing the variance a lot, which is what riders actually perceive as fairness. The costs are a fixed 2 seconds of latency added to every request, a solver that must complete within the window for the largest batch, and a fallback to greedy if the solver times out \u2014 which must exist, because a surge is exactly when the batch is largest and the solver is slowest.'
      },
      {
        q: 'A driver accepts a ride but the acceptance and a second offer race. How do you guarantee one driver, one ride?',
        a: 'The soft reservation is the mechanism, and it must be a compare-and-set on the driver\u2019s state in a single authoritative store, not a check-then-write. The matcher sets `driver:state` from `available` to `offered:{rideId}` atomically; if the CAS fails the driver was already taken and the matcher picks another candidate in the same batch. Acceptance transitions `offered` to `assigned`, also by CAS on the same ride id, so a late acceptance after expiry fails cleanly and the driver is told the ride is gone. Since drivers are sharded by city, this store is a per-city in-memory service and the CAS is cheap.'
      },
      {
        q: 'The routing service degrades and ETAs take 3 seconds. What happens to matching?',
        a: 'The 2-second decision budget is blown, so matching has to degrade rather than stall. The circuit breaker on the routing client trips and the scorer falls back to haversine distance adjusted by a per-city historical speed factor, which is materially worse but still produces reasonable matches. Riders are matched, slightly less optimally, and I would emit a metric for the fraction of matches made in degraded mode because that number quietly explains a bad day of pickup-time metrics. What I would not do is queue requests waiting for routing to recover.'
      },
      {
        q: 'How do you evaluate a change to the matching algorithm before shipping it to 60 cities?',
        a: 'Offline replay first: matching is one of the few systems where you can faithfully replay a recorded day of requests and driver positions against a new algorithm and compare pickup time, utilisation and unmatched rate. Replay does not capture behavioural response \u2014 drivers reposition when the algorithm changes \u2014 so it is a filter, not a proof. Then a switchback experiment rather than a user-level A/B, alternating the algorithm by city and time block, because matching is a market and user-level randomisation contaminates both arms through shared supply. I would gate on rider wait time p90 and driver idle time together, since improving one at the cost of the other is easy and worthless.'
      }
    ],
    redflags: [
      'Runs a SQL bounding-box query over a driver locations table for every request.',
      'Persists every driver location update durably at 100k writes per second.',
      'Matches greedily per request and has no mechanism preventing the same driver being offered two rides.',
      'Treats a 50x local surge as a general scaling problem rather than a spatial hot-cell problem.'
    ],
    topicIds: ['databases-and-indexes', 'scalability-and-capacity', 'resilience-patterns']
  },
  {
    id: 'video-upload-transcoding-pipeline',
    title: 'Design a video upload and transcoding pipeline',
    track: 'backend',
    difficulty: 'core',
    pattern: 'Chunked ingest, DAG orchestration, cost-aware compute placement',
    prompt:
      'Creators upload 500k videos a day averaging 400 MB, with a long tail up to 20 GB. Each video must be transcoded into 6 renditions plus thumbnails and captions, and be playable within 5 minutes for videos under 10 minutes long. Uploads come from unreliable mobile connections worldwide. Transcoding compute is the second-largest line item in the infrastructure budget, so cost per minute of video is a tracked business metric.',
    clarify: [
      'Is the 5-minute playable target for all renditions or just the first one? Producing one low rendition fast and the rest lazily is a completely different pipeline shape and much cheaper.',
      'What fraction of uploaded videos are ever watched? If a third get fewer than 10 views, transcoding all 6 renditions eagerly for every upload is the single biggest cost mistake available.',
      'Do we need to support live streaming later? Designing the ingest around segmented chunks now makes that a variation rather than a rewrite.',
      'Are there content-moderation or rights checks that must gate publication? If so they belong in the DAG before publish, and their latency counts against the 5-minute target.'
    ],
    approach: [
      'Accept uploads directly to object storage with resumable multipart uploads and pre-signed URLs, so bytes never transit the application tier and a mobile client that loses connectivity resumes at the last completed part rather than restarting a 20 GB transfer.',
      'Split ingest by geography using storage buckets in the nearest region with transfer acceleration, then process in that region and replicate only the finished renditions, since moving 400 MB of source across regions is more expensive than moving the compute.',
      'Model processing as an explicit DAG per video: probe, segment, transcode-per-rendition in parallel, package into HLS and DASH, generate thumbnails, extract captions, then publish \u2014 orchestrated by a durable workflow engine so a failed step retries without redoing the whole job.',
      'Segment the source into chunks of 10 to 30 seconds and transcode chunks in parallel, which turns a 20 GB video from a single multi-hour task into hundreds of parallelisable tasks and is the only way the tail meets any latency target.',
      'Prioritise the ladder: produce the 720p rendition first and publish as soon as it and the packaging are done, then complete the other five in the background, which is what actually meets a 5-minute playable promise.',
      'Transcode the long tail lazily: eagerly produce only the two most-used renditions for every video, and generate the rest on first request with a short just-in-time path, which cuts compute cost substantially given most videos are rarely watched.',
      'Run transcoding on spot or preemptible instances with checkpointing at chunk boundaries, since chunk-level work is naturally interruptible, and keep a small on-demand pool for jobs that have been preempted repeatedly or are latency-critical.',
      'Track cost per minute of transcoded video as a first-class metric broken down by rendition and instance type, and alert on it, because in a pipeline this size an inefficient encoder setting is a six-figure annual change that is otherwise invisible.'
    ],
    deepdives: [
      {
        q: 'A 20 GB upload fails at 85% on a mobile connection. What exactly happens?',
        a: 'With resumable multipart the client has already committed 85% of the parts to object storage, each independently acknowledged. On retry the client queries which parts exist and uploads only the missing ones, so the cost of the failure is bounded by one part, typically 8 to 16 MB. The details that matter are choosing a part size small enough that a single part failure is cheap but large enough that the part count stays manageable, setting a lifecycle rule to abort and clean up incomplete multipart uploads after a few days so abandoned uploads do not accrue storage cost, and making the upload session resumable across app restarts by persisting the upload id on the device.'
      },
      {
        q: 'Spot instances are reclaimed mid-transcode for 30% of your fleet during a cloud capacity event. What do users see?',
        a: 'Individual chunk tasks are lost and retried, so a video in flight is delayed rather than failed, because the workflow engine holds the DAG state durably outside the workers. The visible effect is that the 5-minute target is missed for videos being processed during the event. To contain it I would have the scheduler monitor preemption rate and shift new work to the on-demand pool above a threshold, accepting higher cost during the event as an explicit trade. I would also make sure chunk tasks are sized to a few minutes of work \u2014 a 40-minute chunk task on a spot instance is a task that frequently never finishes.'
      },
      {
        q: 'How would you migrate to a new codec like AV1 across an existing library of 200M videos?',
        a: 'Not by bulk re-encoding, which would cost more than the original encoding of the entire library. I would add AV1 to the ladder for new uploads immediately, then backfill on demand: when a video is requested by an AV1-capable client and no AV1 rendition exists, serve the existing codec and enqueue a background transcode, so the library converts in proportion to actual viewing. I would also run a bulk backfill for the top few percent of videos by view count, which captures most of the bandwidth saving for a fraction of the compute. The measurable goal is bandwidth cost reduction, so the backfill priority is view-weighted, not chronological.'
      },
      {
        q: 'Who owns the 5-minute SLO when it depends on upload speed you do not control?',
        a: 'I would define the SLO from the moment the last byte lands in object storage, not from the start of the upload, because otherwise the number measures the user\u2019s network rather than our system. Upload success rate and time-to-upload are tracked separately as client-side metrics with their own owner. Being explicit about the boundary matters organisationally: it stops the pipeline team from being paged for a carrier outage in Indonesia, and it stops the client team from ignoring a genuine regression in resumability.'
      }
    ],
    redflags: [
      'Uploads video bytes through the application servers rather than directly to object storage.',
      'Transcodes each video as one monolithic job, so a 20 GB video cannot meet any latency target.',
      'Eagerly produces all 6 renditions for every video with no consideration of viewing distribution or cost.',
      'Uses a queue with at-most-once semantics for expensive jobs, so a worker crash silently loses a video.'
    ],
    topicIds: ['queues-and-streaming', 'infra-and-deployment', 'scalability-and-capacity']
  },
  {
    id: 'file-sync-and-storage',
    title: 'Design a file sync and storage service',
    track: 'backend',
    difficulty: 'hard',
    pattern: 'Content-addressed chunking, sync as diff exchange, conflict as a product decision',
    prompt:
      'Build a Dropbox-style sync service: 50M users, average 40 GB each, desktop clients on Windows, macOS and Linux syncing continuously. Users edit 2 GB video project files where a small change touches a few megabytes, and teams share folders where 30 people can modify the same tree. Clients are frequently offline, and a user renaming a 100,000-file folder must not re-upload it.',
    clarify: [
      'Is a file the unit of sync, or the directory tree? Renames and moves are metadata operations only if the tree is modelled separately from content, which is the difference between a cheap rename and a 100,000-file re-upload.',
      'Do we need to support real-time collaborative editing inside files, or is last-writer-wins with conflict copies acceptable? Conflict copies are the industry-standard answer and dramatically simplify the system.',
      'What deduplication scope is acceptable \u2014 per user, per team, or global? Global dedup saves enormous storage but leaks information about whether a file already exists, which is a real security consideration.',
      'Is there a compliance requirement for retention or for guaranteed deletion? Content-addressed storage with dedup makes "delete this file everywhere" non-trivial.'
    ],
    approach: [
      'Separate metadata from content completely: a metadata service holds the directory tree, file names, permissions and a per-file list of content chunk hashes, while a content store holds immutable chunks keyed by hash.',
      'Chunk files with content-defined chunking (a rolling hash such as Rabin fingerprinting, target 4 MB average) rather than fixed offsets, so an insertion in the middle of a 2 GB video shifts only the chunks it touches instead of every subsequent chunk.',
      'Make sync a diff exchange: the client sends the hash list for a changed file, the server replies with the subset it has never seen, and only those chunks are uploaded, which is what makes a small edit to a 2 GB file cost megabytes.',
      'Give each user or shared folder a monotonically increasing journal of metadata changes, and have clients sync by cursor, so a client that has been offline for a week replays a delta rather than diffing the whole tree.',
      'Implement rename and move as a single metadata operation on the tree node, touching no content, which turns a 100,000-file folder rename into one journal entry.',
      'Detect conflicts by comparing the parent revision the client based its change on against the current server revision; on divergence, keep both by creating a conflicted copy with the device name, rather than attempting a merge of arbitrary binary content.',
      'Deduplicate chunks within a team or namespace rather than globally, with a reference count per chunk, which captures most of the storage win from shared folders without the cross-user existence-oracle risk.',
      'Encrypt chunks at rest with per-namespace keys and make deletion a reference-count decrement plus a garbage collection pass, with a documented deletion latency, since "deleted" in a deduplicated store is never instantaneous.'
    ],
    deepdives: [
      {
        q: 'Thirty people share a folder and five of them modify files in it while offline. What does reconnection look like?',
        a: 'Each client syncs by cursor against the shared folder journal and receives the changes it missed. For files nobody else touched, it uploads its new chunks and appends a journal entry. For files where the server revision has moved past the client\u2019s base revision, the client creates a conflicted copy \u2014 the server\u2019s version stays canonical and the local edit becomes a new file with the device and timestamp in the name. This is deliberately not a merge: merging binary content is unsolvable in general, and a conflicted copy is a bad outcome that is at least comprehensible and never loses data. The important guarantee is no silent overwrite.'
      },
      {
        q: 'A user deletes a 40 GB folder and immediately their quota does not drop. Explain.',
        a: 'Deletion is a metadata operation: the tree node is tombstoned and the file disappears from the client immediately. The underlying chunks may still be referenced by a shared folder, by another user in the dedup namespace, or by a version history entry within the retention window. So quota accounting has to be defined carefully \u2014 I would charge against logical file size in the user\u2019s tree rather than against physical chunk storage, so the user\u2019s quota does drop immediately and the divergence between logical and physical is the platform\u2019s problem, not theirs. Physical reclamation happens when the reference count hits zero after retention expiry, via a garbage collector that must be conservative about races with concurrent uploads referencing the same hash.'
      },
      {
        q: 'A bug in a client release causes it to delete files and sync the deletion. How do you recover 50M users?',
        a: 'This is the scenario the architecture must survive, and the answer is that the journal is append-only and content chunks are immutable, so nothing is actually gone within the retention window \u2014 recovery is replaying the tree to a point in time per affected user. Operationally: halt the client rollout immediately, identify affected users by the journal signature of mass deletions from the bad version, and run a bulk restore to the pre-incident cursor. The preconditions that make this possible are worth stating because they are easy to omit: never hard-delete chunks inside the retention window, keep the journal append-only rather than mutating tree state in place, and stage client releases so the affected population is thousands rather than millions.'
      },
      {
        q: 'Why content-defined chunking rather than fixed-size blocks?',
        a: 'With fixed-size blocks, inserting one byte at the start of a file shifts every subsequent block boundary, so every block hash changes and the entire file re-uploads \u2014 catastrophic for the 2 GB video project case in the prompt. Content-defined chunking sets boundaries where a rolling hash over a sliding window hits a pattern, so boundaries are determined by content and an insertion only affects the chunks around it. The costs are CPU for the rolling hash on every changed file and variable chunk sizes that complicate storage layout, which I would bound with minimum and maximum chunk sizes.'
      },
      {
        q: 'How do you handle the fact that Windows, macOS and Linux disagree about filenames?',
        a: 'This is where sync products actually bleed. Case sensitivity, Unicode normalisation, path length limits, and reserved names all differ, so a file legal on Linux can be unrepresentable on Windows. I would define a canonical server-side representation \u2014 NFC-normalised Unicode, case-preserving but case-insensitive collision detection \u2014 and have clients map to and from local filesystem semantics, surfacing an explicit "cannot sync this file" state rather than silently renaming or dropping. I would also validate at upload so an unrepresentable name never enters a shared folder that a Windows user will later join, since the failure otherwise appears months later on someone else\u2019s machine.'
      }
    ],
    redflags: [
      'Uses fixed-size blocks and does not connect that to re-uploading an entire large file after a small insertion.',
      'Implements rename by deleting and re-creating, causing a 100,000-file folder to re-upload.',
      'Attempts automatic three-way merge of arbitrary binary files instead of conflicted copies.',
      'Hard-deletes content chunks immediately, leaving no recovery path from a bad client release.'
    ],
    topicIds: ['data-modeling', 'replication-and-consistency', 'sharding-and-partitioning']
  },
  {
    id: 'payment-system-with-ledger',
    title: 'Design a payment system with a double-entry ledger',
    track: 'backend',
    difficulty: 'hard',
    pattern: 'Double-entry invariants, idempotency, reconciliation against external truth',
    prompt:
      'Build the money movement core for a marketplace: buyers pay, the platform holds funds in escrow, sellers are paid out on a schedule, and fees, refunds, chargebacks and multi-currency all apply. Volume is 3M transactions a day across 14 currencies. Finance must be able to produce a trial balance at any historical instant, and a discrepancy of one cent against the bank statement is a reportable incident.',
    clarify: [
      'Is the ledger the system of record for money, or is the payment provider? They will disagree, and which one wins determines whether reconciliation is a correction process or an alerting process.',
      'Are multi-currency balances held per currency, or converted at transaction time? Holding balances per currency means FX gain and loss becomes a ledger account, which finance will require.',
      'What is the required immutability guarantee \u2014 can a ledger entry ever be corrected in place, or only reversed with a compensating entry? This is non-negotiable in most regulated contexts and shapes the whole schema.',
      'What settlement latency does escrow release need? Instant payout changes the risk model entirely versus a T+2 schedule.'
    ],
    approach: [
      'Model the ledger as immutable double-entry: every movement is a transaction containing two or more entries that sum to zero per currency, posted against typed accounts \u2014 `user_wallet`, `escrow`, `platform_fee_revenue`, `fx_gain_loss`, `bank_settlement` \u2014 with no updates or deletes ever.',
      'Enforce the balance invariant in the database itself with a constraint or a trigger that rejects any transaction whose entries do not sum to zero per currency, so no application bug can create money.',
      'Never store money as a float: use integer minor units with an explicit currency code, and represent currencies with different exponents (JPY has none, KWD has three) through a currency metadata table rather than assuming two decimals.',
      'Make every externally-triggered operation idempotent with a client-supplied key stored in a unique index on the transaction table, so a retried payment webhook or a retried API call produces exactly one posting.',
      'Compute balances as a materialised running total per account updated in the same database transaction as the entries, with the authoritative value always reconstructible by summing entries, so a corrupted materialised balance is detectable and repairable rather than authoritative.',
      'Handle multi-currency by keeping separate per-currency balances and posting FX conversion as an explicit transaction touching a `fx_gain_loss` account at a recorded rate with its source and timestamp, so finance can audit every conversion.',
      'Treat refunds and chargebacks as new compensating transactions referencing the original, never as reversals of existing entries, which preserves the property that history is append-only and a trial balance at any instant is a query with a timestamp bound.',
      'Run continuous reconciliation: ingest the provider and bank settlement files daily, match against ledger entries by external reference, and post any unmatched item to a `suspense` account that must be zero at close \u2014 a non-zero suspense balance is the alert, and it is an alert nobody is allowed to snooze.'
    ],
    deepdives: [
      {
        q: 'Your payment provider says a charge succeeded, your ledger says it failed. What is the process?',
        a: 'The bank and the provider are external truth; the ledger is our representation of it, so on divergence the ledger is wrong and must be corrected forward, never edited. The mechanism is the suspense account: reconciliation detects an unmatched provider credit, posts it to suspense against the settlement account so the books still balance, and raises an investigation item with the external reference. A human or an automated rule then posts a correcting transaction moving it from suspense to the right account. What makes this workable is that the ledger never claims to be right \u2014 it claims to be complete and balanced, with disagreements visibly parked rather than silently absorbed.'
      },
      {
        q: 'A network partition causes a payout to be submitted twice to the bank. How does the ledger help and where does it not?',
        a: 'The ledger prevents double-posting through the idempotency key, so internally we record one payout. It does not prevent the bank from executing two transfers, because the bank is outside our transaction boundary \u2014 that is the fundamental limit and I would say so plainly. Mitigations are a payout file with a unique batch reference the bank deduplicates, and reconciliation catching the second debit the next day as an unmatched item. Recovery is a correcting entry plus a recall request. The design principle is that the ledger guarantees internal consistency and detects external inconsistency fast, rather than pretending to prevent it.'
      },
      {
        q: 'Three million transactions a day means roughly a billion ledger entries a year. How do you keep the trial balance query fast?',
        a: 'I would not compute a trial balance by scanning a billion rows. Daily closing balances per account are materialised at period close into a snapshot table, and a balance at an arbitrary instant is the nearest prior snapshot plus the entries since, which bounds the scan to at most a day of activity for that account. Partitioning the entries table by posting date supports both that query and archival. The critical constraint is that snapshots are derived and verifiable: a periodic job recomputes a sample from raw entries and alerts on any divergence, because a wrong snapshot that nobody checks is worse than no snapshot.'
      },
      {
        q: 'How do you change the ledger schema \u2014 say, adding a new account type \u2014 in a system where history must never be rewritten?',
        a: 'Additive changes only. New account types are new rows, not new columns on existing entries. If an entry needs a new attribute, it is added as a nullable column populated going forward, and any query that depends on it must handle the historical null explicitly rather than backfilling a guess into immutable records. When the semantics of an existing account genuinely change, the correct move is to open a new account and post a transfer transaction on a stated effective date, so the historical meaning of the old account is preserved. I would also version the chart of accounts so a report can state which version it was run against.'
      },
      {
        q: 'What is your testing strategy for something where a one-cent error is an incident?',
        a: 'Property-based testing on the invariants rather than example-based testing on flows: for any generated sequence of operations, the sum of all entries per currency is zero, no account that must be non-negative goes negative, and replaying the event log reproduces identical balances. On top of that, a continuously-running production invariant checker recomputes balances from entries and compares to materialised values, because the failure mode I fear is not a bug caught in CI but slow drift under concurrency. I would also require that every new money-moving code path ships with its reconciliation rule, not after it.'
      }
    ],
    redflags: [
      'Stores balances as mutable account rows updated in place, with no immutable entry log to reconstruct from.',
      'Uses floating point or a single `amount` column with no currency and no minor-unit convention.',
      'Implements a refund by deleting or editing the original transaction.',
      'Has no reconciliation against provider or bank statements, so internal consistency is mistaken for correctness.'
    ],
    topicIds: ['transactions-and-isolation', 'data-modeling', 'databases-and-indexes']
  },
  {
    id: 'ticket-booking-inventory',
    title: 'Design ticket booking with inventory contention',
    track: 'backend',
    difficulty: 'core',
    pattern: 'Reservation holds, contention on a small hot keyspace, queueing as fairness',
    prompt:
      'A ticketing platform sells seats for events. A stadium show with 60,000 seats goes on sale at 10:00 and draws 900,000 people hitting the page in the first minute. Seats are individually selectable, must never be double-sold, and a user gets 8 minutes to complete checkout after selecting. The client also runs 4,000 small events a day where contention is essentially zero, and one architecture must serve both.',
    clarify: [
      'Is seat selection user-chosen or best-available? Best-available lets the server allocate and is far easier to make contention-safe than 900,000 people clicking the same seat map.',
      'Is overselling ever acceptable with compensation, as airlines do, or is a double-sold seat an absolute failure? That single answer decides whether optimistic or pessimistic reservation is correct.',
      'Must the queue be fair, in the sense that earlier arrivals get earlier access? Fairness is a product promise with real architectural cost, and "random lottery" is often both fairer in practice and much simpler.',
      'What is the actual inventory size per contended event \u2014 60,000 seats is small enough to fit in memory on one node, which changes everything about the design.'
    ],
    approach: [
      'Put a virtual waiting room in front of the sale: on-sale traffic is admitted to the booking system at a controlled rate, with everyone else holding a queue token and a position, so the booking system sees a manageable arrival rate rather than 900,000 concurrent users.',
      'Admit at a rate derived from measured checkout throughput \u2014 if the system completes 500 checkouts per minute, admit around 1,500 per minute to account for abandonment \u2014 and adjust dynamically from the observed conversion rate.',
      'Hold contended event inventory in a single-writer in-memory authority per event, since 60,000 seats is a small state that fits comfortably in memory, making each seat state transition a local operation with no distributed locking.',
      'Model a hold as a state transition from `available` to `held(userId, expiresAt)` applied through that single writer, with an 8-minute expiry, and persist each transition to a durable log so the authority can be rebuilt after a crash.',
      'Back the in-memory authority with the database as the record of truth for completed purchases only: holds live in memory and the log, purchases are committed transactionally, so the database is never the contention point.',
      'Expire holds with a timer wheel inside the authority rather than a polling sweep, so a released seat becomes available immediately and re-enters the pool for waiting buyers.',
      'Serve the seat map read path from a separate, heavily cached projection updated from the transition log, accepting a second of staleness, because 900,000 people are reading the map and only a few thousand are writing.',
      'Route the 4,000 low-contention events through the same API but with a simpler path \u2014 optimistic reservation with a conditional database update \u2014 selected by an event-level configuration flag, so the expensive machinery is only paid for where contention exists.'
    ],
    deepdives: [
      {
        q: 'The single-writer authority for the big event crashes 90 seconds into the sale. What happens?',
        a: 'It is a single point of failure by design, so the recovery path has to be fast and correct rather than avoided. Every transition is appended to a durable replicated log before being acknowledged, so a standby instance replays the log and takes over, typically in a few seconds. During failover, booking requests for that event fail fast with a retryable error and the waiting room stops admitting, which is far better than allowing a second writer. The invariant I protect above all is single-writer-ness, enforced with a lease from a coordination service, because two writers means double-sold seats and a legal problem, while a 10-second stall means angry users.'
      },
      {
        q: 'Why not just use `SELECT ... FOR UPDATE` on the seat row in Postgres?',
        a: 'For the 4,000 small events that is exactly what I would do, and I would say so \u2014 it is simple, correct and needs no new infrastructure. It fails for the stadium case because 900,000 requests converging on a few thousand hot rows produces lock contention, connection pool exhaustion and lock-wait timeouts that cascade into every other query on that database. The in-memory single-writer is not faster because memory is faster; it is better because it serialises contention in one cheap place instead of in a shared resource that everything else depends on. Choosing per event based on expected contention is the actual answer.'
      },
      {
        q: 'Users complain the waiting room is unfair \u2014 people who joined later got in first. How do you handle it?',
        a: 'Strict first-in-first-out across a globally distributed edge is genuinely hard, because clock skew, retries and multiple devices all break the ordering, and users who lose will always believe the system cheated. I would first check whether the perceived unfairness is real: usually it is people refreshing and getting a new token, which the design should prevent by binding the token to an identity rather than a session. Then I would be explicit in the product about the model \u2014 either a timestamp-ordered queue with a published tolerance, or a randomised lottery among everyone who joined in the first N minutes, which is defensible, resistant to bot advantage, and removes the incentive to hammer the page at 09:59:59.'
      },
      {
        q: 'How do you load-test this credibly before a real on-sale?',
        a: 'A synthetic test that hits the API at 900,000 requests per minute proves the load balancer works, not that the system works, because the real pattern is a spike with heavy contention on a small keyspace and a realistic abandonment curve. I would replay a recorded traffic shape from a previous on-sale, with the same seat-selection distribution, since real buyers cluster on the same good seats, and I would include the checkout provider with a simulated latency distribution including its tail. The specific numbers I would validate are hold-to-purchase conversion, seat map staleness under write load, and failover time for the authority under full contention \u2014 that last one is the test people skip.'
      }
    ],
    redflags: [
      'Relies on database row locks for a 900,000-user on-sale without considering connection pool and lock-wait cascades.',
      'Has no waiting room or admission control, so all load reaches the booking path at once.',
      'Implements holds with a TTL cache that has no durable record, so a crash silently releases or strands seats.',
      'Applies the high-contention architecture to all 4,000 daily events, massively over-engineering the common case.'
    ],
    topicIds: ['transactions-and-isolation', 'consensus-and-coordination', 'scalability-and-capacity']
  },
  {
    id: 'distributed-job-scheduler',
    title: 'Design a distributed job scheduler',
    track: 'backend',
    difficulty: 'core',
    pattern: 'Time-wheel dispatch, at-least-once execution, tenant isolation',
    prompt:
      'Build a scheduler running 20M scheduled jobs a day for 600 internal services: cron-style recurring jobs, one-off delayed tasks up to a year out, and workflows with dependencies. Jobs must fire within 5 seconds of their scheduled time, a job must not run twice concurrently with itself, and a badly-written job that hangs for 6 hours must not delay anyone else\u2019s jobs.',
    clarify: [
      'Is at-least-once or at-most-once execution required? A job that sends an email and a job that charges a card want opposite answers, and the platform should let the owner declare it rather than choosing globally.',
      'Does "within 5 seconds" apply to dispatch or to completion? Dispatch latency is a scheduler property; completion depends on worker capacity, which is a different SLO with a different owner.',
      'Are workflow dependencies a DAG or can they be cyclic with conditions? A general workflow engine is a much larger system than a scheduler and I would want to know if it is in scope.',
      'What happens to missed schedules after an outage \u2014 fire all of them, fire the latest, or skip? Different jobs need different catch-up policies and it must be declared, not defaulted.'
    ],
    approach: [
      'Store schedules in a partitioned database indexed on `next_run_at`, and have dispatcher nodes poll a narrow time window \u2014 jobs due in the next 10 seconds \u2014 per partition, which keeps the hot query small regardless of the total number of scheduled jobs.',
      'Shard by a hash of `jobId` across dispatcher nodes with leases held in a coordination service, so exactly one dispatcher owns a partition at a time and a node failure reassigns its partitions within seconds.',
      'Separate dispatch from execution: the dispatcher only writes an execution record and enqueues a message, while stateless workers pull from per-tenant queues, so a hung job consumes a worker rather than blocking the scheduler.',
      'Guarantee no concurrent self-overlap with a per-job execution lease: starting an execution requires a compare-and-set on `job.currentExecutionId`, and a job whose previous run is still active either skips or queues according to its declared overlap policy.',
      'Make execution at-least-once by default with an idempotency key equal to `(jobId, scheduledTime)` passed to the job, and offer an at-most-once mode that acknowledges before running for the rare jobs where a duplicate is worse than a miss.',
      'Isolate tenants with per-service worker pools or at minimum per-service concurrency limits and queue quotas, so one team\u2019s 6-hour hang consumes only their allocation, and add a hard execution timeout with a declared default.',
      'Handle recurring schedules by computing `next_run_at` after dispatch rather than during execution, with the timezone and daylight-saving rules evaluated explicitly, since cron in local time across DST transitions is a persistent source of double-runs and skipped runs.',
      'Declare a catch-up policy per job \u2014 `fireAll`, `fireLatest` or `skip` \u2014 so that recovery from a scheduler outage is a configured behaviour rather than an emergent one, and the thundering herd of a `fireAll` recovery is rate-limited on replay.'
    ],
    deepdives: [
      {
        q: 'A dispatcher node is partitioned from the coordination service but can still reach the database. What stops double dispatch?',
        a: 'The lease must be time-bounded and the dispatcher must stop acting when it cannot renew, which is the classic fencing problem. A lease held with a TTL means the partitioned node must voluntarily halt dispatch before the TTL expires, and I would set its self-halt margin well inside the reassignment window. Because voluntary halting depends on clocks I do not fully trust, I add a fencing token: each lease grant increments a monotonic token, the execution record write is conditional on the token being the highest seen, so a zombie dispatcher\u2019s writes are rejected by the database even if it never noticed it lost the lease.'
      },
      {
        q: 'The scheduler is down for 20 minutes. 40,000 jobs were due. What happens at recovery?',
        a: 'The dispatcher resumes and finds 40,000 overdue rows, which without care becomes an instant 40,000-message burst that takes down the downstream services. Recovery therefore applies each job\u2019s catch-up policy \u2014 most recurring jobs should be `fireLatest`, firing once rather than 20 times for a per-minute job \u2014 and the remaining backlog is drained through a rate limiter at a configured multiple of normal throughput. I would also surface the missed-execution count per job as a metric so owners learn about their gap rather than discovering it in data later.'
      },
      {
        q: 'How do you support a job scheduled one year out without scanning it every 10 seconds for a year?',
        a: 'The dispatcher query is bounded by a time window, so a job due in a year simply never matches the query until the year has nearly passed \u2014 an index on `next_run_at` means the cost of far-future jobs is storage, not query time. The subtlety is index bloat and partition skew if hundreds of millions of far-future jobs accumulate, so I would partition the schedule table by time bucket, keeping the near-term partition small and hot in memory while distant partitions are cold. A two-tier design that promotes jobs from a cold store into the hot near-term store a few hours before due is the refinement if the far-future volume is very large.'
      },
      {
        q: 'Six hundred services depend on this. How do you deploy a change to it safely?',
        a: 'The scheduler is a shared dependency where a bad deploy is simultaneously an incident for everyone, so I treat availability during deploy as a hard requirement: dispatcher nodes are stateless apart from leases, so a rolling deploy releases leases gracefully and the incoming node picks them up, and I would verify lease handover explicitly in a pre-production soak rather than assume it. I also keep a shadow environment consuming the same schedule data and dispatching to a null sink, so I can compare dispatch timing distributions between versions before rollout. And I would never deploy during the hourly and daily peaks, which in a scheduler are extremely predictable \u2014 the top of every hour is 40% of the day\u2019s dispatches.'
      }
    ],
    redflags: [
      'Runs a single cron process as the scheduler with a standby, and calls that highly available without addressing split-brain.',
      'Executes jobs inside the scheduler process, so a hung job blocks dispatch for everyone.',
      'Uses a lease without a fencing token and assumes clock-based expiry alone prevents double dispatch.',
      'Has no catch-up policy, so recovering from an outage fires every missed occurrence at once.'
    ],
    topicIds: ['consensus-and-coordination', 'queues-and-streaming', 'resilience-patterns']
  },
  {
    id: 'feature-flag-service-backend',
    title: 'Design a feature flag service',
    track: 'backend',
    difficulty: 'warmup',
    pattern: 'Config distribution, local evaluation, kill-switch latency',
    prompt:
      'Build the flag service backing 900 microservices and 4 client platforms: 30,000 flags, 2M flag evaluations per second in aggregate, and targeting rules referencing user attributes and segments of up to 10M members. A kill-switch flag must take effect globally within 10 seconds, and the flag service being down must never take down the services that depend on it.',
    clarify: [
      'Can a flag evaluation ever block a request? If the answer is no \u2014 and it should be \u2014 then evaluation must be local and the service only distributes rules, which settles the architecture.',
      'Do targeting rules need attributes the calling service does not have, such as a 10M-member segment? Large segments cannot be shipped to every SDK and need a different mechanism than inline rules.',
      'Is there an audit requirement for who changed which flag and what the resulting exposure was? In regulated environments this is often the real product, not the toggling.',
      'How stale can a non-kill-switch flag be \u2014 seconds or minutes? Separating kill switches from ordinary flags lets the common case be cheap.'
    ],
    approach: [
      'Distribute rules rather than answers: SDKs fetch a compiled ruleset and evaluate locally in microseconds, so flag evaluation adds no network hop and the service being down cannot break a request path.',
      'Push updates over a streaming connection (server-sent events or a long-poll with a version cursor) so a change propagates in about a second, with a periodic full-ruleset poll as a self-healing fallback for clients that missed a push.',
      'Cache the last known good ruleset on local disk in every SDK, so a service restarting during a flag-service outage still starts with correct flags rather than falling back to defaults, which is the failure mode that actually causes incidents.',
      'Handle 10M-member segments by not shipping them: represent large segments as a bloom filter distributed with the ruleset for a fast probabilistic check, plus an optional authoritative lookup for the small number of cases where a false positive matters.',
      'Make flag evaluation deterministic with a documented hash \u2014 `sha1(flagKey + ":" + unitId)` bucketed into 10,000 slots \u2014 implemented identically across every SDK and verified with a shared cross-language conformance test suite, since silent disagreement between SDKs is the worst bug this system can have.',
      'Give kill switches a separate, tiny ruleset with a 5-second poll interval, so the 10-second requirement does not force every flag to be that fresh and the payload stays small.',
      'Version rulesets monotonically and make every change an immutable revision with author, timestamp and diff, supporting instant rollback to a prior revision as the primary incident response tool.',
      'Enforce lifecycle: every flag has an owner and a declared type \u2014 release, experiment, ops or permission \u2014 with a default expiry, and stale-flag reports go to owners, because 30,000 flags mostly means tens of thousands of dead conditionals nobody dares remove.'
    ],
    deepdives: [
      {
        q: 'The flag service is completely down for an hour and a service autoscales up 200 new instances. What flags do they get?',
        a: 'The disk-cached ruleset is baked into the container image as a build-time snapshot and also written to a persistent volume where available, so a new instance starts with the snapshot rather than with code defaults. That distinction matters: code defaults are usually the pre-launch state, so falling back to them during an outage silently turns off features that have been on for months. The snapshot may be hours stale, which is acceptable, and the SDK reports its ruleset age as a metric so staleness is observable rather than assumed.'
      },
      {
        q: 'Two SDKs in different languages bucket the same user differently for the same flag. How did that happen and how do you prevent it?',
        a: 'Usually string encoding or integer overflow: a hash implemented over UTF-8 bytes in one language and UTF-16 in another, or a modulo on a signed 32-bit value that goes negative. The prevention is a language-independent conformance suite \u2014 a fixture file of thousands of (flag, unit, expected bucket) tuples that every SDK must pass in CI before release. I would also make the bucketing function a tiny, frozen specification that is versioned separately from the SDK, so changing it is a deliberate, breaking event rather than an accidental refactor.'
      },
      {
        q: 'A product manager toggles a flag that causes a 40% error rate. What does the platform do?',
        a: 'The platform should make the flag change a first-class deployment artefact, which means three things: the change is recorded with a revision id that is emitted into the service\u2019s metrics as a label, so error-rate dashboards show a flag-change annotation; automatic guardrails can watch a declared health metric for N minutes after a change and auto-revert on breach; and rollback is a single click to the previous revision that propagates in seconds. Without the revision id flowing into telemetry, a flag change is an invisible deploy, and that is the most common reason these incidents take an hour to diagnose.'
      }
    ],
    redflags: [
      'Makes services call the flag service per evaluation, putting a network hop and a hard dependency on every request.',
      'Falls back to hardcoded defaults when the service is unreachable, silently reverting features that have been live for months.',
      'Ships 10M-member segments inline in the ruleset payload.',
      'Has no cross-language conformance testing for the bucketing hash.'
    ],
    topicIds: ['infra-and-deployment', 'resilience-patterns', 'api-design-backend']
  },
  {
    id: 'metrics-timeseries-platform',
    title: 'Design a metrics and time-series platform',
    track: 'backend',
    difficulty: 'hard',
    pattern: 'Cardinality as the cost driver, tiered retention, query pushdown',
    prompt:
      'Build the metrics platform for a company running 30,000 services: 80M active time series, 25M samples ingested per second, 13-month retention for a subset and 15 days for the rest. Engineers write ad hoc queries over 30-day ranges in dashboards, and a single team once shipped a metric labelled with user id that created 400M series in an hour and took the platform down.',
    clarify: [
      'Is the 80M series count stable or growing, and what governs label cardinality? Cardinality, not sample volume, is what actually kills these systems, and the design must assume someone will do the user-id thing again.',
      'What query patterns dominate \u2014 recent dashboards, long-range trend analysis, or alerting rules? Alerting is a continuous high-frequency query load with very different characteristics from a human opening a dashboard.',
      'Do we need exact values or are approximations acceptable for high-cardinality aggregations? Sketches make some queries orders of magnitude cheaper if the product tolerates them.',
      'Is downsampled data acceptable for the 13-month tier? Nobody looks at per-second resolution from 11 months ago, and pretending otherwise multiplies storage by two orders of magnitude.'
    ],
    approach: [
      'Ingest through a stateless write tier that shards by a hash of the full series identity (metric name plus sorted labels), so all samples for a series land on the same storage node and time-ordered appends stay sequential.',
      'Store as a columnar time-series format with delta-of-delta encoding on timestamps and XOR encoding on float values, which is roughly 1.3 bytes per sample in practice and is the difference between this being affordable and not.',
      'Separate the inverted index from the sample store: labels map to series ids in an index optimised for set intersection, and queries resolve to a series id set first, because query cost is dominated by series matching, not by reading samples.',
      'Tier storage by age: the last few hours in memory, the last two weeks on local NVMe, and everything older in object storage with the query layer reading remote blocks, which makes 13-month retention a storage cost rather than a cluster-size cost.',
      'Downsample automatically \u2014 raw for 15 days, 5-minute rollups for 3 months, 1-hour rollups to 13 months \u2014 with the query layer selecting the resolution appropriate to the requested range, so a 13-month dashboard query reads thousands of points rather than billions.',
      'Enforce cardinality quotas per team at ingest: a per-namespace limit on active series with the write tier rejecting new series beyond the quota and emitting a clear error, so the user-id incident becomes one team\u2019s rejected writes rather than a platform outage.',
      'Detect cardinality explosions in real time by tracking new-series creation rate per metric name, and auto-quarantine a metric exceeding a threshold \u2014 dropping it with a loud alert to its owner rather than accepting it and dying.',
      'Push aggregation down to storage nodes: a query for a sum across 50,000 series aggregates partially on each node and ships summaries to the coordinator, rather than streaming raw samples across the network.'
    ],
    deepdives: [
      {
        q: 'Explain precisely why one extra label with 1M values is so catastrophic.',
        a: 'A time series is identified by the full set of label values, so cardinality multiplies: a metric with 3 labels of 10, 20 and 5 values is 1,000 series, and adding a user-id label with 1M values makes it a billion. Each series carries index entries and an in-memory write buffer with its own compression state, so cost is per-series and largely independent of how many samples each one receives \u2014 a series with one sample costs nearly as much as one with a million. That is why the failure is sudden: memory for write buffers and index growth exceed capacity within minutes, long before disk becomes an issue.'
      },
      {
        q: 'An engineer runs a query summing a metric across all 30,000 services over 30 days. What happens and how do you protect the platform?',
        a: 'Without protection it matches millions of series and the coordinator tries to fan out to every storage node, saturating them and degrading every other query including alert evaluation. Protection is layered: the query planner estimates the matched series count from the index before executing and rejects or requires confirmation above a limit; per-user and per-tenant concurrency and memory limits apply to running queries; the query automatically resolves to the 1-hour rollup for a 30-day range so sample volume is bounded; and alerting queries run on a separate, isolated query pool so human exploration can never delay alert evaluation. That last isolation is the one people forget, and it turns a slow dashboard into a missed page.'
      },
      {
        q: 'How do you handle a storage node loss without losing recent data?',
        a: 'Recent data lives in memory and on local disk, so node loss without replication is data loss. I would have the write tier dual-write each series to two nodes in different failure domains, with queries reading from either and deduplicating by timestamp \u2014 a simple approach that works because samples are immutable and idempotent by (series, timestamp). Full quorum replication is unnecessary overhead for metrics, where a small amount of loss is tolerable but a total gap during an incident is not. Blocks flushed to object storage are durable by the storage provider and need no additional replication.'
      },
      {
        q: 'How would you migrate 30,000 services from the existing platform to this one?',
        a: 'Dual-write at the agent level rather than migrating services: the metrics agent on each host forwards to both old and new platforms, so no service code changes and rollback is an agent config change. Then migrate consumers gradually \u2014 dashboards and alert rules \u2014 with an automated translation for the common query shapes and a compatibility report for the ones that cannot be translated. Alerts move last and only after a period of running in both systems with divergence comparison, because a migration that silently changes alert semantics is how you find out months later that a critical alert never fired.'
      },
      {
        q: 'What do you do about the fact that most of those 80M series are never queried?',
        a: 'I would measure it rather than assume, by sampling query-time series access and joining it against the series catalogue. In most estates the majority of series are never read, which means the platform is spending most of its budget on data nobody uses. The actionable levers are per-team cost attribution so the bill lands with the owner, automatic expiry of series with no writes and no reads, and a default-off policy for the highest-cardinality metric families. What I would avoid is unilaterally deleting metrics, because the one time a never-queried metric matters is during an incident.'
      }
    ],
    redflags: [
      'Stores metrics in a general-purpose relational database or document store with a row per sample.',
      'Has no cardinality quota or explosion detection, having just been told a team took the platform down that exact way.',
      'Keeps raw resolution for 13 months with no downsampling tier.',
      'Runs alerting queries and ad hoc dashboard queries in the same resource pool.'
    ],
    topicIds: ['backend-observability', 'sharding-and-partitioning', 'scalability-and-capacity']
  },
  {
    id: 'distributed-tracing-platform',
    title: 'Design a distributed tracing platform',
    track: 'backend',
    difficulty: 'hard',
    pattern: 'Context propagation, tail sampling, trace assembly across time',
    prompt:
      'Instrument 30,000 services handling 10M requests per second, where a single user request touches 40 services on average. Engineers need complete traces for slow and failing requests, but storing every span is 400M spans per second and financially impossible. Traces must be queryable within 30 seconds of completion, and a trace that is missing its slowest span is worse than useless.',
    clarify: [
      'Is the primary use case debugging individual slow requests or aggregate latency analysis? Aggregate analysis can be served by metrics derived from spans at 100% coverage, which is far cheaper than storing traces.',
      'What fraction of services can be instrumented \u2014 are there legacy services or third-party hops that will break context propagation? A broken link mid-trace is the most common real cause of useless traces.',
      'How long must traces be retained? Tracing retention is usually days, not months, and a short retention makes storage a much smaller problem than the sampling decision.',
      'Is there a requirement to trace across asynchronous boundaries like queues and batch jobs? Async propagation needs deliberate context carriage and is often silently missing.'
    ],
    approach: [
      'Propagate W3C `traceparent` and `tracestate` headers through every hop, including queue messages as message attributes, and make propagation a property of the shared service framework rather than of individual service code.',
      'Sample at the tail, not the head: agents buffer all spans of a trace locally, and a per-trace decision is made after the trace completes, so slow and erroring traces are kept at 100% while successful fast traces are kept at a fraction of a percent.',
      'Implement tail sampling with a two-stage collector: spans are routed by trace id hash to a consistent collector so all spans of a trace meet in one place, buffered for a decision window of 10 to 30 seconds, then evaluated against policies and either persisted or dropped.',
      'Emit span metrics at 100% regardless of sampling \u2014 request count, error count and latency histogram per service and operation \u2014 so aggregate analysis is always complete and only the detailed traces are sampled, which decouples the two use cases.',
      'Store spans in a columnar store partitioned by time and indexed on trace id, service name and a small set of high-value attributes, with aggressive compression and a retention of 7 to 14 days.',
      'Bound collector memory explicitly: the decision window times the span rate is a fixed memory requirement, and when a trace exceeds a span-count limit it is truncated with an explicit marker rather than allowed to consume unbounded memory.',
      'Support forced sampling: a debug header set at the edge forces a trace to be kept end to end, which is how you actually debug a reproducible customer issue rather than hoping it gets sampled.',
      'Reduce cost further with span-level sampling policies per service tier \u2014 a high-volume cache service emits fewer internal spans \u2014 configured centrally and delivered to agents as remote config, since the alternative is 30,000 services each hardcoding a rate.'
    ],
    deepdives: [
      {
        q: 'Why is head sampling insufficient here, and what does tail sampling cost you?',
        a: 'Head sampling decides at the root before anything has happened, so you keep a random 1% and the specific slow request an engineer is investigating is almost certainly in the discarded 99%. Tail sampling decides after outcomes are known, so you keep the traces that matter. The costs are real: every span must be transmitted to the collector even if it is later dropped, so network and collector CPU scale with total volume rather than sampled volume; the collector needs enough memory to hold a decision window of all in-flight traces; and all spans of a trace must reach the same collector, which requires consistent routing and makes collector scaling and rebalancing a correctness concern rather than just a capacity one.'
      },
      {
        q: 'A trace is missing spans from three services. How do you diagnose that?',
        a: 'I would separate the three causes because they need different fixes. Propagation breakage \u2014 a service that does not forward the header, commonly an older HTTP client or a queue hop \u2014 shows up as traces that consistently end at the same service, which I detect with a continuous audit comparing per-service request counts from metrics against spans received. Late arrival past the decision window shows up as orphan spans arriving for a trace already decided, which I count as a metric and use to tune the window. Collector routing errors show up as partial traces distributed randomly. Without the metrics-versus-spans audit, all three look identical to a user, so I would build that audit before anything else.'
      },
      {
        q: 'The collector tier is at capacity during an incident, exactly when traces are most valuable. What gives?',
        a: 'This is the cruel property of tail sampling: an incident increases error rates, which increases the fraction of traces the policy wants to keep, at the same moment span volume spikes. I would make the degradation explicit and tiered: first reduce the decision window, then begin probabilistically dropping traces at the ingest edge with the drop rate recorded so downstream analysis knows its denominator, and preserve forced-sampling traces and a reserved quota for erroring traces above all else. Silently dropping without recording the rate is the unacceptable option, because it makes incident analysis draw wrong conclusions from a biased sample.'
      },
      {
        q: 'How do you get 30,000 services instrumented without a multi-year programme?',
        a: 'Not by asking teams to add instrumentation. The leverage is in the shared layers: the service framework, the HTTP and gRPC clients, the database drivers and the message queue library, all of which are centrally owned. Instrumenting those gives useful traces for the majority of services on their next dependency upgrade with zero team effort. Service mesh sidecars can add a coarse layer for services that cannot be updated. Custom spans inside business logic are then an opt-in refinement for teams that want it, rather than the mechanism the platform depends on. I would measure coverage as the percentage of inter-service calls that appear in traces, not as the percentage of teams who adopted.'
      }
    ],
    redflags: [
      'Uses head-based sampling at 1% and then proposes to debug rare slow requests with it.',
      'Routes spans to collectors without consistent trace-id-based routing, so tail sampling never sees a complete trace.',
      'Ignores asynchronous boundaries, so every trace ends at the first queue.',
      'Drops spans under load without recording the drop rate, biasing every subsequent analysis.'
    ],
    topicIds: ['backend-observability', 'event-driven-architecture', 'scalability-and-capacity']
  },
  {
    id: 'log-ingestion-platform',
    title: 'Design a log ingestion and search platform',
    track: 'backend',
    difficulty: 'core',
    pattern: 'Write-optimised ingest, index selectively, cost per queried byte',
    prompt:
      'Ingest 8 TB of logs a day from 30,000 services with bursts to 4x during incidents, retain 30 days searchable and 12 months in cold storage for compliance. Engineers search full text during incidents and expect results in seconds over the last hour. The current Elasticsearch cluster costs $2.1M a year and falls over during exactly the incidents it is needed for, which is why you are redesigning it.',
    clarify: [
      'What fraction of logged data is ever searched? In most estates it is a low single-digit percentage, and indexing everything to serve 3% of reads is the root cause of the $2.1M bill.',
      'Are the incident-time searches mostly recent and scoped to a service, or genuinely global full-text? Scoped recent search can be served by a cheap partition-pruned scan without a full inverted index.',
      'Is the compliance requirement for search or just for retention and retrieval? Twelve months of retrievable-but-not-indexed object storage is two orders of magnitude cheaper than twelve months of indexed data.',
      'Can we require structured logging? Structured fields allow indexing a small set of dimensions instead of full-text indexing everything, which changes the cost model fundamentally.'
    ],
    approach: [
      'Decouple ingest from indexing with a durable log in front: agents write to Kafka, which absorbs the 4x incident burst and means a slow indexing tier causes lag rather than log loss.',
      'Write all raw logs to object storage in compressed columnar files partitioned by `service/date/hour`, as the durable system of record, and treat any index as a derived, rebuildable accelerator.',
      'Index selectively rather than fully: build an inverted index only over the last 72 hours and only over a declared set of structured fields plus a bloom filter per file block for full-text terms, so a search prunes to a small number of blocks and scans them directly.',
      'Serve older searches with a distributed scan over object storage with partition pruning and block-level bloom filters, accepting tens of seconds for a 20-day-old query, since incident searches are overwhelmingly recent.',
      'Enforce structured logging through the shared logging library, with a declared schema per service and a small number of indexed fields, and reject or sample unstructured blobs, because unstructured logs are what force full-text indexing of everything.',
      'Apply per-team ingest quotas and tail sampling of high-volume, low-value log lines \u2014 keeping 100% of warn and error and a fraction of info \u2014 with the sampling rate set centrally so a chatty service degrades its own fidelity rather than the platform.',
      'Move data older than 30 days to cold object storage with a lifecycle rule and no index at all, retrievable by an asynchronous job for compliance requests.',
      'Report cost per team and cost per queried byte as first-class metrics, because the only durable fix for a $2.1M log bill is putting the bill in front of the people generating the logs.'
    ],
    deepdives: [
      {
        q: 'During an incident, ingest goes to 4x and everyone starts searching. How does the platform stay up?',
        a: 'The two loads are physically separated. Ingest is absorbed by Kafka, so the buffer grows and indexing lags rather than the ingest path failing \u2014 and I would publish indexing lag prominently, because during an incident engineers need to know they are searching data that is 4 minutes behind. Search runs on a separate query tier with per-user concurrency limits and a query cost estimator that rejects unbounded scans. The specific failure in the old cluster was that indexing and search shared nodes, so an ingest burst starved search exactly when it was needed; separating write and read paths is the single most important change.'
      },
      {
        q: 'You are dropping the full inverted index for data older than 72 hours. What do engineers lose?',
        a: 'Arbitrary full-text search over old data becomes seconds-to-minutes instead of sub-second, and some exotic query shapes such as leading-wildcard searches become impractical. I would validate that trade with data rather than assert it: instrument the existing cluster to record the age distribution of queried data, and in my experience the overwhelming majority of searches target the last few hours. For the minority of genuinely old-data investigations, a slower scan is an acceptable answer, and I would offer an explicit "build a temporary index for this time range" job for a sustained investigation rather than paying to index everything permanently.'
      },
      {
        q: 'A service starts logging a stack trace on every request and its volume goes up 50x. What happens?',
        a: 'The per-team ingest quota is the containment: the write tier throttles that service and drops beyond quota with a loud metric and a direct alert to the owning team, rather than letting one service consume the platform. I would also auto-detect the pattern \u2014 a sudden change in bytes-per-log-line or in log-line cardinality for a single service \u2014 since that detection is what turns a $30,000 surprise at month end into a page within minutes. The point I would make is that in a shared logging platform the noisy-neighbour problem is not an edge case, it is the steady state, and quotas need to exist before the first incident.'
      },
      {
        q: 'How do you migrate off the existing Elasticsearch cluster without an outage?',
        a: 'Dual-ship from the agents: the same log stream goes to both the old cluster and the new pipeline, so the new system can be validated against real production volume, including incident bursts, before anyone depends on it. Then migrate readers, not writers \u2014 point a subset of teams at the new search UI, compare results for the same queries, and keep the old cluster as the fallback until query parity is demonstrated for the query shapes people actually use, which I would harvest from the existing cluster\u2019s query logs rather than guess. The old cluster shrinks by reducing its retention progressively, which cuts cost during the migration instead of doubling it.'
      }
    ],
    redflags: [
      'Indexes every field of every log line and treats the resulting cost as unavoidable.',
      'Puts ingest and search on the same nodes, reproducing the failure mode described in the prompt.',
      'Has no per-team quota, so one service can consume the whole platform budget.',
      'Keeps 12 months of compliance data in a hot search cluster rather than in cold object storage.'
    ],
    topicIds: ['backend-observability', 'queues-and-streaming', 'scalability-and-capacity']
  },
  {
    id: 'distributed-lock-service',
    title: 'Design a distributed lock service',
    track: 'backend',
    difficulty: 'core',
    pattern: 'Leases with fencing, liveness versus safety, the cost of coordination',
    prompt:
      'Several hundred internal services want mutual exclusion: leader election for singleton workers, exclusive access to a shared external resource, and preventing concurrent runs of the same job. You must offer a service with a clear correctness contract. Some callers hold locks for milliseconds, others for hours, and callers run in containers that can be paused by the scheduler for tens of seconds at a time.',
    clarify: [
      'Do callers need the lock for safety or for efficiency? A lock preventing duplicate work is very different from a lock preventing data corruption, and only the second one justifies the cost of real fencing.',
      'Can the protected resource participate in fencing by rejecting stale writes? If it can, the lock becomes much simpler and genuinely safe; if it cannot, no lock service can give a true safety guarantee.',
      'What is the acceptable lock acquisition latency, and how contended are individual locks? Hot locks are a queueing problem, not a consensus problem.',
      'How long is the longest lock hold, and can the holder be preempted? Hour-long locks with container pauses mean lease renewal is the central design problem.'
    ],
    approach: [
      'Build on a consensus-backed store (etcd or ZooKeeper) rather than on a single Redis instance, because a lock service without a replicated, linearisable log will silently lose locks on failover.',
      'Model a lock as a lease with a TTL plus a monotonically increasing fencing token issued at grant time, and require the protected resource to reject any operation carrying a token lower than the highest it has seen.',
      'Require holders to renew the lease at a fraction of the TTL \u2014 renew every third of the TTL \u2014 and require the holder to stop all protected work if a renewal fails or the remaining validity drops below a safety margin.',
      'Set the safety margin to account for the container pause problem: a process paused for 30 seconds may resume believing it holds a lease that expired, so the client library must check remaining validity against a monotonic clock immediately before every protected operation, not only at acquisition.',
      'Expose leader election as a distinct, higher-level API built on the same primitive, since most callers asking for a lock actually want leader election and hand-rolling it on raw locks is where bugs come from.',
      'Handle contended locks with a fair queue: waiters register in sequence and are notified on release, rather than polling, which turns a hot lock from a thundering herd into an ordered handoff.',
      'Set an upper bound on lease TTL and require long holders to renew, rather than allowing an hour-long TTL, because a crashed holder with an hour-long lease is an hour-long outage for that resource.',
      'Publish the contract in blunt terms: the service guarantees that at most one holder believes it holds the lock at any instant only when the resource honours fencing tokens, and that without fencing the lock is an efficiency optimisation and not a safety mechanism.'
    ],
    deepdives: [
      {
        q: 'Walk through how a lock without fencing tokens causes data corruption.',
        a: 'Client A acquires the lease, then its container is paused by the scheduler or it hits a long garbage collection pause. The lease expires and client B acquires it legitimately and writes. Client A resumes, still believing it holds the lock, and writes stale data over B\u2019s write. No amount of TTL tuning eliminates this, because the pause can always exceed the margin. Fencing tokens fix it at the resource: A carries token 41, B carries 42, and once the resource has seen 42 it rejects A\u2019s write. The crucial implication is that safety lives in the resource, not in the lock service, which is the part people omit.'
      },
      {
        q: 'Someone proposes Redlock over five Redis nodes. What is your response?',
        a: 'I would say it is more complicated than a single Redis and still does not provide the safety guarantee people assume. Its correctness depends on bounded clock drift and bounded process pauses, and the container-pause scenario in this prompt violates exactly that assumption. It also lacks fencing tokens, so even a perfectly functioning Redlock cannot stop the stale-writer case. If the caller needs efficiency only \u2014 avoiding duplicate work \u2014 a single Redis lease is sufficient and Redlock is unnecessary complexity. If they need safety, they need consensus plus fencing. There is no configuration of Redlock that occupies the useful middle.'
      },
      {
        q: 'The etcd cluster is unavailable for two minutes. What happens to a hundred services holding locks?',
        a: 'Renewals fail, so every well-behaved holder stops protected work within its safety margin \u2014 which means the outage propagates as a loss of liveness across all lock-dependent services. That is the correct behaviour and it is also why I would push callers away from locks wherever possible. Mitigations are to make holds short so the blast radius is small, to ensure each caller degrades gracefully rather than crashing, and to make sure nothing on a user-facing request path takes a distributed lock. A lock service is a shared availability dependency, and treating it as free coordination is how a two-minute etcd blip becomes a company-wide incident.'
      },
      {
        q: 'How would you get hundreds of teams to stop misusing this?',
        a: 'By making the safe thing the easy thing and the unsafe thing visible. I would ship a client library that implements renewal, safety-margin checks and fencing-token plumbing correctly, and treat raw API use as unsupported. I would offer higher-level primitives \u2014 leader election, singleton job execution, idempotency keys \u2014 so most teams never touch a lock directly. And I would publish per-team usage: number of locks, hold duration distribution, renewal failure rate, and whether the protected resource honours fencing. The teams with hour-long holds and no fencing are the incident list, and they should know they are on it before the incident.'
      }
    ],
    redflags: [
      'Recommends a single Redis `SETNX` with a TTL as a safety-grade distributed lock.',
      'Never mentions fencing tokens or acknowledges that safety must be enforced at the protected resource.',
      'Assumes process pauses and clock drift are negligible, when the prompt explicitly states containers can pause for tens of seconds.',
      'Puts a distributed lock acquisition on a user-facing request path without discussing the availability coupling.'
    ],
    topicIds: ['consensus-and-coordination', 'resilience-patterns', 'replication-and-consistency']
  },
  {
    id: 'multi-region-active-active',
    title: 'Design a multi-region active-active data strategy',
    track: 'backend',
    difficulty: 'hard',
    pattern: 'Partition data by conflict cost, home regions, honest consistency contracts',
    prompt:
      'A SaaS platform serving 200k business customers must run active-active across three regions to meet a 99.99% availability commitment and sub-100 ms latency for users in Europe, North America and Asia. The data includes user profiles, a shared team workspace, usage counters that drive billing, and audit logs. A previous attempt used bidirectional database replication and produced billing discrepancies that took months to unwind.',
    clarify: [
      'Which data actually needs to be writable in every region? Most SaaS data is naturally owned by one tenant who is mostly in one place, and a home-region model avoids conflicts entirely for the majority of it.',
      'What is the actual availability requirement \u2014 is it survive a region loss, or serve writes from every region continuously? Active-passive with fast failover meets many 99.99% commitments at a fraction of the complexity.',
      'For billing counters, is undercounting or overcounting the worse error? That determines whether they can be eventually consistent at all, and the previous failure suggests they cannot be naively replicated.',
      'Is data residency a legal requirement for any customers? If so, some tenants must not replicate to some regions, which constrains the topology independently of performance.'
    ],
    approach: [
      'Classify every dataset by conflict cost before choosing any technology: tenant-owned mutable data, globally-shared reference data, monotonic counters, and append-only logs each get a different strategy, and treating them uniformly is what caused the previous failure.',
      'Give each tenant a home region recorded in a globally-replicated routing table: writes for that tenant are routed to its home region and are strongly consistent there, while other regions serve read replicas, which eliminates write conflicts for the bulk of the data.',
      'Route at the edge based on the tenant routing table rather than on user geography, so a European user of a US-homed tenant gets correct behaviour rather than a conflicting local write.',
      'Replicate reference data \u2014 plans, feature definitions, pricing \u2014 asynchronously from a single writer region, since it is read-heavy, rarely written and tolerant of seconds of staleness.',
      'Model usage counters as per-region append-only event streams that are aggregated centrally for billing, rather than as replicated mutable counters, so two regions incrementing concurrently is a sum rather than a conflict.',
      'Make audit logs append-only per region with a region identifier in the key, so there is no merge at all and the global view is a union rather than a reconciliation.',
      'Handle region failure by promoting a tenant\u2019s home region: the routing table is updated after confirming replication lag is within the recovery point objective, and tenants whose lag exceeds it are failed over with an explicit, recorded data-loss window rather than silently.',
      'Publish an explicit consistency contract per API \u2014 which endpoints are read-your-writes, which are eventually consistent and with what typical lag \u2014 because the previous failure was fundamentally a contract problem, not a replication-technology problem.'
    ],
    deepdives: [
      {
        q: 'Why exactly did bidirectional database replication produce billing discrepancies?',
        a: 'Because last-write-wins on a mutable counter row loses increments. Two regions each read a counter at 100, each increment to 101, and replication resolves the conflict by keeping one row \u2014 so two units of usage become one. The database reports no error; it resolved the conflict exactly as configured. The fix is not better conflict resolution but a different data model: increments are commutative, so representing usage as an append-only event stream or a per-region sub-counter that is summed makes concurrent writes mathematically safe. The general lesson is that conflict-free replication is a property of the data model, and no replication setting can rescue a model that is not.'
      },
      {
        q: 'A team wants a globally unique username that must be reserved atomically across all three regions. How do you handle it?',
        a: 'Global uniqueness requires global coordination, so I would not pretend otherwise. The options are a single global writer for the namespace, accepting cross-region latency on registration only \u2014 which is acceptable because usernames are claimed once and read constantly \u2014 or partitioning the namespace so each region owns a disjoint slice, which works for generated identifiers but not for user-chosen ones. I would choose the single global writer with a strongly consistent store, and keep the scope as small as possible: only the uniqueness reservation is global, while the profile it belongs to lives in the tenant home region. Shrinking the globally-coordinated surface is the whole skill here.'
      },
      {
        q: 'Region failure: how do you decide to fail over, and what do you tell customers?',
        a: 'I would not make failover fully automatic for a data tier with asynchronous replication, because an automatic promotion during a network partition rather than a true region loss causes a split brain that is much worse than a few extra minutes of downtime. The decision is human-triggered against a documented runbook, informed by an automated readiness report showing per-tenant replication lag. Tenants within the recovery point objective fail over cleanly; those beyond it are promoted with an explicit recorded data-loss window and are proactively notified with the window and the affected records. Telling customers precisely what was lost is the difference between an incident and a lost account.'
      },
      {
        q: 'Is three-region active-active the right answer for a 99.99% commitment?',
        a: 'Often not, and I would say so before designing it. Four nines is 52 minutes of downtime a year, which a well-run active-passive setup with a tested, automated failover under 10 minutes can meet comfortably if you only expect one or two regional events a year. Active-active buys latency and capacity more than it buys availability, and it introduces conflict classes whose bugs \u2014 like the billing discrepancy \u2014 are themselves availability and trust incidents. I would propose active-active for the read path and latency-sensitive stateless tiers, tenant-homed writes, and only genuinely multi-master for the data models that are conflict-free by construction.'
      },
      {
        q: 'How do you test this before a real region loss?',
        a: 'By losing regions on purpose, regularly and in production. A quarterly game day that removes one region from the routing tier for a scheduled window is the only way to know that the routing table update, the promotion runbook, the replication lag reporting and the client retry behaviour all work together. I would start in a staging environment with production-shaped data, then move to production with a small tenant cohort, then to full region evacuation. The failures found are rarely in the database; they are in hardcoded region endpoints, connection pools that never re-resolve DNS, and runbooks referencing a dashboard that was deleted.'
      }
    ],
    redflags: [
      'Turns on bidirectional replication with last-write-wins and treats conflict resolution as a database setting.',
      'Applies one consistency model to all data rather than classifying by conflict cost.',
      'Replicates mutable billing counters instead of modelling usage as commutative events.',
      'Proposes fully automatic cross-region failover for an asynchronously replicated data tier with no split-brain reasoning.'
    ],
    topicIds: ['replication-and-consistency', 'consensus-and-coordination', 'resilience-patterns']
  },
  {
    id: 'fraud-detection-on-a-stream',
    title: 'Design fraud detection on a transaction stream',
    track: 'backend',
    difficulty: 'core',
    pattern: 'Feature freshness, synchronous scoring budget, feedback loop latency',
    prompt:
      'Score 8,000 transactions per second for fraud with a hard 80 ms budget, because the decision sits inline in the payment authorisation path. Rules and models need features computed over windows from 10 seconds to 90 days, such as "distinct cards used by this device in the last hour". Fraud patterns change weekly, and a false positive blocks a legitimate customer, so the business tracks both false positive rate and fraud loss.',
    clarify: [
      'Is the decision strictly synchronous, or can some transactions be approved optimistically and reviewed asynchronously? A two-tier decision dramatically relaxes the latency budget for expensive features.',
      'What is the relative cost of a false positive versus a missed fraud? A blocked $30 purchase and a missed $3,000 one are not comparable, and the threshold must be value-aware rather than a single global cutoff.',
      'How quickly must a newly discovered fraud pattern be deployable \u2014 minutes via a rule, or days via a model retrain? That determines whether rules and models are separate systems, and they usually should be.',
      'Do we need to explain a decline to the customer or to a regulator? Explainability constrains model choice significantly in some jurisdictions.'
    ],
    approach: [
      'Split the decision into a synchronous path and an asynchronous path: the inline scorer uses only precomputed and short-window features within the 80 ms budget, while a slower analysis runs after authorisation and can trigger holds, reversals or account review.',
      'Serve features from a low-latency feature store with precomputed aggregates: streaming jobs maintain windowed aggregates (10-second, 1-hour, 30-day) keyed by card, device, IP and merchant, written into a key-value store so the scorer does point lookups rather than computing anything.',
      'Compute the long-window features in a batch pipeline and the short-window ones in a stream processor, but serve both through one interface with identical feature definitions, since training-serving skew from two divergent implementations is the most common cause of a model that works offline and fails online.',
      'Budget the 80 ms explicitly: roughly 15 ms for feature fetch of a batched multi-key lookup, 20 ms for model inference on a gradient-boosted tree served in-process, 10 ms for rule evaluation, leaving headroom for network and the tail.',
      'Keep rules and models as separate, independently deployable layers: rules are a fast path for known patterns, deployable in minutes by an analyst through a reviewed config change, while models retrain on a weekly cadence with proper validation.',
      'Make the threshold value-aware and segment-aware rather than global, so the expected-loss calculation drives the decision and a low-value transaction is not declined at the same score as a high-value one.',
      'Close the feedback loop deliberately: chargebacks arrive 30 to 90 days later, so maintain a labelled outcome store and track model performance against labels as they mature, while using manual review decisions as a faster, noisier interim signal.',
      'Fail open with a conservative rule set: if the feature store or model server is unavailable, fall back to a small set of high-precision rules rather than declining everything, because declining all transactions is a worse outcome than a brief elevated fraud rate.'
    ],
    deepdives: [
      {
        q: 'The feature store is slow at p99 and you are blowing the 80 ms budget for 1% of transactions. What do you do?',
        a: 'I would enforce a hard deadline on the feature fetch rather than let it consume the budget: at 20 ms the scorer proceeds with whatever features arrived and a explicit missing-feature indicator, and the model must be trained to handle missing features rather than receiving imputed zeros that look like real values. I would also batch all feature lookups into a single multi-key request so the tail is one round trip rather than N, and colocate the feature store with the scorer to remove cross-AZ latency. The principle is that a degraded decision made in time is better than a perfect decision made after the authorisation timed out.'
      },
      {
        q: 'Fraud loss jumps 5x overnight. Walk me through the response.',
        a: 'First determine whether it is a new attack pattern or a system failure, because they need opposite responses and look similar on a loss dashboard. I would check feature freshness and scorer error rates first \u2014 a stalled streaming job silently serving stale aggregates presents exactly as a fraud spike, and it is the more common cause. If the pipeline is healthy, it is an attack, and the fast lever is the rules layer: analysts write a targeted high-precision rule against the observed pattern and deploy it in minutes, accepting some false positives, while the model retrains on the new labels over days. The organisational point is that the rules layer exists precisely so the response time is not gated on a model release.'
      },
      {
        q: 'How do you evaluate a new model before it makes real decisions?',
        a: 'Offline evaluation on held-out historical data first, but with a hard caveat: the historical data is censored, because transactions the old model declined have no outcome label, so naive offline metrics are biased optimistically. I would maintain a small randomised control group that is approved regardless of score \u2014 expensive, but it is the only source of unbiased labels. Then shadow mode, where the new model scores live traffic without deciding, comparing score distributions and disagreement cases against the incumbent. Then a percentage rollout gated on both false positive rate and observed fraud, with the awareness that the fraud signal takes weeks to mature while the false positive signal is nearly immediate.'
      },
      {
        q: 'Who owns the threshold \u2014 engineering, risk, or product?',
        a: 'Risk owns it, and engineering owns the ability to change it safely and instantly. The threshold is a business decision that trades fraud loss against declined revenue and customer trust, and engineers should not be choosing it implicitly by picking a default. What the platform must provide is a threshold that is configurable per segment without a deploy, a simulator that shows the projected effect of a threshold change on last month\u2019s traffic before it is applied, and an audit trail of who changed it and when. That simulator is what turns the conversation from opinion into a shared number.'
      }
    ],
    redflags: [
      'Computes windowed aggregates on demand inside the 80 ms request path.',
      'Uses different feature implementations for training and serving, guaranteeing training-serving skew.',
      'Fails closed on scorer unavailability, declining all transactions.',
      'Treats fraud labels as immediately available, ignoring that chargebacks arrive months later.'
    ],
    topicIds: ['queues-and-streaming', 'event-driven-architecture', 'scalability-and-capacity']
  },
  {
    id: 'api-gateway',
    title: 'Design an API gateway',
    track: 'backend',
    difficulty: 'warmup',
    pattern: 'Edge concerns centralised, config-driven routing, blast radius control',
    prompt:
      'Build the gateway fronting 900 internal services for both public API customers and first-party clients: 400k requests per second, authentication and authorisation, rate limiting, request routing, and per-route observability. The gateway is the single point every request passes through, so its p99 added latency budget is 5 ms and a bad config push must not be able to take down the whole platform.',
    clarify: [
      'Does the gateway do request transformation and aggregation, or only routing and policy? Aggregation makes it a BFF and couples it to service contracts, which is a very different maintenance burden.',
      'Are public API customers and first-party clients subject to the same policies? They usually are not, and conflating them leads to a gateway config that nobody can reason about.',
      'Who owns route configuration \u2014 the platform team or the 900 service teams? Self-service config is necessary at this scale but is exactly what creates the bad-config risk.',
      'Is there a service mesh handling service-to-service traffic? If so the gateway should handle only north-south concerns and not duplicate east-west policy.'
    ],
    approach: [
      'Keep the data plane thin and the control plane separate: the proxy layer (Envoy or equivalent) does routing, TLS termination, authentication token validation and rate limiting, while a control plane compiles and distributes configuration.',
      'Validate JWTs locally against cached public keys rather than calling an auth service per request, which keeps authentication inside the 5 ms budget and removes a hard dependency from the request path.',
      'Make route configuration declarative and owned by service teams in their own repositories, compiled by the control plane into a single validated snapshot, so ownership is distributed but the artefact is centrally verified.',
      'Validate configuration aggressively before distribution: schema checks, route conflict detection, and a dry-run against a corpus of recorded production requests confirming that every previously-routable request still routes to the same place.',
      'Roll out configuration like code: canary the new snapshot to a small percentage of gateway instances, watch error rate and latency, then promote, with an automatic revert to the previous snapshot on regression \u2014 since a config push is functionally a deploy of the entire platform edge.',
      'Enforce per-consumer rate limits with a local token bucket synchronised against a central coordinator, and add per-route circuit breakers and outlier ejection so one failing upstream does not consume gateway connection capacity for everyone.',
      'Emit per-route, per-consumer metrics and structured access logs with a trace id propagated downstream, since the gateway is the only place that sees every request and is therefore the most valuable observability vantage point in the system.',
      'Protect the gateway itself with connection limits, request body size caps, timeouts on every upstream, and a bounded retry policy with a retry budget, because unbounded retries at the edge are how a partial upstream failure becomes a total one.'
    ],
    deepdives: [
      {
        q: 'One upstream service becomes slow, taking 10 seconds per request. What happens to the gateway?',
        a: 'Without protection, gateway worker connections and memory fill with requests waiting on that upstream, and the gateway degrades for all 900 services \u2014 the classic shared-resource failure. The mitigations are per-upstream connection pools with a hard cap, per-route timeouts well below the client timeout, outlier ejection removing consistently slow endpoints from the load balancing pool, and a circuit breaker that fails fast once the error or timeout rate crosses a threshold. I would also make sure the gateway sheds load rather than queueing indefinitely, returning 503 quickly so clients can retry elsewhere rather than holding a connection.'
      },
      {
        q: 'A team pushes a route config with a catch-all path that shadows 40 other routes. How does your design prevent the outage?',
        a: 'Detection happens at compile time, not at runtime: the control plane builds the full routing table and runs conflict detection, flagging any route that shadows an existing one, which is a straightforward analysis on a compiled trie. Beyond that, the dry-run against recorded production traffic would show 40 routes suddenly resolving to a different upstream, which fails the validation gate. And if both are somehow passed, the canary rollout limits exposure to a small percentage of instances with automatic revert. Three independent gates, because the cost of an edge outage is total.'
      },
      {
        q: 'Should the gateway do response aggregation for mobile clients?',
        a: 'I would keep it out of the shared gateway and put it in a separate BFF layer owned by the client team. Aggregation logic needs to change at client release cadence and encodes knowledge of specific service contracts, so putting it in the platform gateway means the platform team becomes a bottleneck for every mobile feature and the gateway accumulates client-specific code paths that nobody can safely remove. The gateway handles cross-cutting policy that is genuinely universal; anything that varies per client belongs to that client\u2019s team behind the gateway.'
      }
    ],
    redflags: [
      'Calls an authentication service synchronously on every request without addressing the added latency and dependency.',
      'Treats configuration changes as data rather than as deploys, with no validation, canary or automatic revert.',
      'Has no per-upstream isolation, so one slow service exhausts shared gateway resources.',
      'Puts client-specific aggregation logic into the shared gateway.'
    ],
    topicIds: ['api-design-backend', 'request-lifecycle', 'resilience-patterns']
  },
  {
    id: 'recommendation-serving-system',
    title: 'Design a recommendation serving system',
    track: 'backend',
    difficulty: 'core',
    pattern: 'Candidate generation then ranking, feature freshness, online-offline parity',
    prompt:
      'Serve personalised recommendations for a catalogue of 50M items to 80M users, with a 120 ms p99 budget for the full response. The ranking model uses roughly 200 features, some computed from behaviour in the last 30 seconds. The business needs to A/B test new models weekly, and a newly added item must be recommendable within 10 minutes rather than waiting for a nightly batch.',
    clarify: [
      'What is the objective \u2014 clicks, watch time, purchases, or long-term retention? Optimising the easy proxy is how recommendation systems end up degrading the product they are supposed to improve.',
      'How much of the catalogue is eligible for a given user after business rules, availability and regional licensing? If eligibility is highly restrictive, filtering must happen during candidate generation rather than after ranking.',
      'Is a cold-start user a meaningful fraction of traffic? If so, a personalisation-only design will serve a large population badly and needs an explicit non-personalised fallback.',
      'Does "recommendable within 10 minutes" mean the item must appear in candidates, or that the model must have learned about it? Those are very different systems.'
    ],
    approach: [
      'Structure serving as candidate generation, filtering, ranking and policy: retrieve roughly 1,000 candidates from several sources, filter for eligibility, rank with the heavy model to 100, then apply diversity and business policy to produce the final 20.',
      'Generate candidates from multiple complementary retrievers running in parallel \u2014 an approximate-nearest-neighbour search over user and item embeddings, a collaborative-filtering co-occurrence lookup, recent trending items and an editorial source \u2014 because a single retriever has a characteristic blind spot.',
      'Serve item embeddings from a vector index refreshed continuously, and add new items to the index within minutes using content-based embeddings derived from metadata, which solves the 10-minute requirement without waiting for interaction data.',
      'Split features by freshness requirement: user long-term features precomputed in batch and cached, item features precomputed, and real-time behavioural features maintained by a stream processor and read from a low-latency store, with all three served through one feature-store interface.',
      'Budget the 120 ms explicitly: 25 ms for parallel candidate retrieval, 10 ms for filtering, 50 ms for ranking 1,000 candidates with a batched model call, and the remainder for policy and serialisation, with a deadline at each stage that degrades rather than blocks.',
      'Guarantee online-offline parity by defining each feature once in a shared registry and generating training data by logging the exact feature vector used at serving time, rather than recomputing features from logs for training.',
      'Support weekly A/B tests by making the model a versioned artefact loaded by the serving layer and selected per request from an experiment assignment, so shipping a model is a config change and multiple models run side by side.',
      'Log the full ranking context \u2014 candidates, features, scores, model version and the experiment arm \u2014 sampled, so a bad recommendation can be reproduced exactly, which is the only practical way to debug a system where the model is a black box.'
    ],
    deepdives: [
      {
        q: 'The ranking model service is degraded. What does the user see?',
        a: 'A response, always \u2014 an empty recommendations panel is a worse product outcome than a mediocre one. The serving layer applies a deadline to the ranking call and on timeout falls back progressively: first to a lighter model, then to ordering candidates by a simple popularity-and-recency heuristic, then to a precomputed non-personalised list cached per segment. Each fallback tier is tagged in the response and logged, so the metric "percentage of impressions served by fallback" is monitored. That metric matters because a slow degradation into fallback looks like a gradual model-quality regression rather than an availability incident.'
      },
      {
        q: 'What is training-serving skew and how does your design prevent it?',
        a: 'It is when the feature values a model sees in training differ from what it sees in production, which produces a model that validates beautifully offline and performs poorly live. The common causes are recomputing features from logs with information that was not available at serving time \u2014 a subtle form of label leakage \u2014 and having two implementations of the same feature in the batch and streaming systems. My prevention is to log the actual serving-time feature vector as the training example, so by construction training sees exactly what serving saw, and to define each feature once in a shared registry rather than reimplementing it. I would also monitor feature distribution drift between training and serving as a continuous check.'
      },
      {
        q: 'A new model wins on click-through rate in the A/B test but you suspect it is worse. How do you argue that?',
        a: 'Click-through is a short-horizon proxy that is easy to inflate with clickbait and with recommending things the user would have found anyway. I would look at three things: whether the gain persists over a longer horizon or decays as novelty wears off, which requires running the experiment for weeks rather than days; whether guardrail metrics such as completion rate, return visits and diversity of consumed items moved negatively; and whether the gain is concentrated in a small user segment. I would also check for cannibalisation, where the model surfaces items users would have reached through search anyway, making the lift illusory at the session level.'
      },
      {
        q: 'How do you handle the 10-minute new-item requirement when the model has never seen the item?',
        a: 'Two separate mechanisms. Retrieval gets content-based embeddings computed from item metadata at ingest, so a new item is findable by similarity immediately without any interaction history. Ranking gets an explicit exploration allowance: a fraction of slots are reserved for items with low impression counts, with the exploration budget controlled centrally so it can be tuned against the cost in short-term engagement. Without deliberate exploration, a new item with no interactions is ranked poorly forever and never accumulates the data it needs, which is the classic feedback loop that makes catalogues stale.'
      }
    ],
    redflags: [
      'Proposes scoring all 50M items per request with the ranking model.',
      'Has no fallback when the model service is slow, so a degraded model means an empty response.',
      'Computes training features by replaying logs, introducing leakage and skew.',
      'Ignores cold-start entirely for both new items and new users.'
    ],
    topicIds: ['scalability-and-capacity', 'server-side-caching', 'data-modeling']
  },
  {
    id: 'realtime-analytics-platform',
    title: 'Design a realtime analytics platform',
    track: 'backend',
    difficulty: 'core',
    pattern: 'Pre-aggregation versus scan, approximate distincts, late-arriving data',
    prompt:
      'Product teams need dashboards over 60B events a month with sub-second queries: counts, unique users and funnels, sliced by any of 40 dimensions, over ranges from the last 5 minutes to the last 12 months. Events arrive up to 48 hours late from mobile clients that were offline. Precomputing every dimension combination is 40 factorial and obviously impossible, so you have to choose what to precompute.',
    clarify: [
      'Which dimension combinations do users actually query? Usage data from the existing tool will show a small set dominating, and precomputing those plus scanning for the rest is the practical answer.',
      'Are approximate unique counts acceptable? Exact distinct counts over 60B events are enormously more expensive than sketches, and most product decisions do not need the precision.',
      'What does a funnel query need to guarantee \u2014 strict event ordering per user, or just presence within a window? Ordered funnels require per-user sequence reconstruction, which is a different query engine requirement.',
      'How should late data be reflected \u2014 must a dashboard viewed yesterday show the same number today? Restating history versus freezing it is a product decision with big architectural consequences.'
    ],
    approach: [
      'Ingest into a durable log, then write into a columnar analytical store (ClickHouse, Druid or Pinot) partitioned by time and sorted by the highest-selectivity dimensions, so most queries prune to a small fraction of data.',
      'Use a lambda-style split with one query interface: a real-time segment holding the last few hours in memory serving the 5-minute queries, and immutable historical segments for older data, with the query layer unioning both.',
      'Precompute a small number of rollup cubes chosen from actual query logs \u2014 typically the top 10 to 20 dimension combinations cover the large majority of dashboard loads \u2014 and fall back to a raw columnar scan for anything else.',
      'Compute unique counts with HyperLogLog sketches stored per time bucket per dimension combination, so a distinct count over any time range is a merge of sketches rather than a scan, with roughly 2% error that I would surface explicitly in the UI.',
      'Handle funnels with a specialised per-user sequence structure \u2014 a bitmap or array of event ids ordered by time per user per window \u2014 rather than as self-joins, since funnel queries over 60B events as joins are not tractable.',
      'Manage 48-hour late arrival by keeping recent time partitions mutable: a partition is open for a 48-hour grace window during which late events are merged and rollups recomputed, then sealed and never changed.',
      'Publish the restatement contract to users: numbers for the last 48 hours are provisional and may increase, and the dashboard labels them as such, because the alternative is a support ticket every time yesterday\u2019s number changed.',
      'Control cost with tiered retention and resolution: full-fidelity raw events for 90 days, rollups only beyond that, and per-team quotas on query concurrency and scanned bytes so one expensive dashboard cannot starve everyone.'
    ],
    deepdives: [
      {
        q: 'A user wants an exact unique count for a billing-relevant metric. How do you serve that?',
        a: 'Sketches are wrong for billing, so I would serve it from a different path rather than degrade the general one. Billing-relevant metrics are a small, enumerable set, so I would compute them exactly with a dedicated pipeline that maintains exact distinct sets for those specific dimension combinations, accepting the cost because the set is small and known. I would keep them visibly separate in the product \u2014 an "exact, computed daily" metric versus an "approximate, realtime" one \u2014 because the failure mode I want to prevent is someone invoicing a customer from a HyperLogLog estimate.'
      },
      {
        q: 'An event arrives 40 hours late and it changes a number a customer already saw. What happens?',
        a: 'The partition is still within its grace window, so the event is merged and the affected rollups are recomputed, meaning the number changes. That is correct but surprising, so the design has to make it expected: the dashboard marks the last 48 hours as provisional, and I would expose an "as of" timestamp on every number. For anything used in a contract or a report, the product should offer a sealed snapshot taken after the grace window, so a report generated from sealed data never changes. The architectural mistake would be silently restating and letting users discover it.'
      },
      {
        q: 'How do you decide which rollup cubes to precompute, and how do you keep that decision current?',
        a: 'From query logs, treated as a continuously running optimisation rather than a one-time design. I would log every query with its dimension set, scanned bytes and latency, then rank candidate cubes by the total scan cost they would eliminate weighted by query frequency, against the storage and maintenance cost of each cube. That produces a ranked list that a scheduled job re-evaluates weekly, adding cubes that have become valuable and retiring ones no longer used. The important property is that no human has to guess, and that a new dashboard which becomes popular automatically earns a cube within a week.'
      },
      {
        q: 'Ingestion falls behind by two hours during a traffic spike. What is the user-visible effect and what do you do?',
        a: 'Real-time queries silently return numbers that are two hours stale, which is more dangerous than an error because teams make decisions on them. So the first requirement is that ingestion lag is a published, first-class number on every dashboard, and queries over a range that overlaps the lag window carry a visible warning. Operationally the durable log means nothing is lost, only delayed, and recovery is adding consumer capacity. I would also make sure the real-time segment can degrade by reducing the dimensionality it maintains during a backlog, prioritising completeness of the core dimensions over the long tail.'
      }
    ],
    redflags: [
      'Proposes precomputing all dimension combinations or, conversely, scanning raw events for every query.',
      'Uses exact distinct counts everywhere without considering sketch-based approximation.',
      'Treats late-arriving data as an error case rather than a designed-for 48-hour grace window.',
      'Provides no visibility into ingestion lag, so stale dashboards look current.'
    ],
    topicIds: ['queues-and-streaming', 'databases-and-indexes', 'scalability-and-capacity']
  },
  {
    id: 'idempotent-webhook-delivery',
    title: 'Design an idempotent webhook delivery system',
    track: 'backend',
    difficulty: 'warmup',
    pattern: 'At-least-once with dedup, retry with backoff, endpoint isolation',
    prompt:
      'Deliver 200M webhooks a day to 40,000 customer endpoints. Customer servers are unreliable: some are down for days, some accept and then time out, some are slow enough to back up your workers. Customers must be able to rely on ordering per resource, must never miss an event, and complain loudly about duplicates. You are also a security target, since you make outbound requests to customer-controlled URLs.',
    clarify: [
      'Is per-resource ordering a hard guarantee or best effort? Strict ordering means a failing delivery blocks all subsequent events for that resource, which most customers do not actually want once they understand it.',
      'What is the retention and replay window \u2014 can a customer recover events from a week-long outage? That determines storage and whether the system is a delivery mechanism or an event log.',
      'Do customers verify signatures, and do we need key rotation? Outbound webhooks without signing are a standing vulnerability for the recipient.',
      'Are there limits on how much of our capacity a single slow endpoint may consume? Without per-endpoint isolation, 40,000 endpoints means the slowest one sets the throughput for everyone.'
    ],
    approach: [
      'Persist every event before attempting delivery, with a stable event id, so delivery is a separate, retryable concern and the event log is the source of truth rather than the queue.',
      'Give every event a unique `id` and include it in the payload plus an `Idempotency-Key` header, and document that customers must deduplicate on it, because at-least-once is the only guarantee an unreliable network permits and duplicates will happen.',
      'Partition delivery work by endpoint so each customer endpoint has its own queue and bounded concurrency, which means a single hanging endpoint consumes only its own workers \u2014 this is the single most important property in the system.',
      'Retry with exponential backoff and jitter over a long horizon \u2014 roughly 1 minute, 5, 30, 2 hours, 6 hours, up to 3 days \u2014 and then move to a dead-letter state with a customer-visible notification rather than silently giving up.',
      'Circuit-break per endpoint: after a threshold of consecutive failures, stop attempting and check with a low-frequency probe, so a customer who has been down for two days is not receiving thousands of doomed requests per minute from us.',
      'Offer ordering as an opt-in per-resource mode where a single in-flight delivery is allowed per resource key and a failure blocks the queue for that key only, with a clearly documented consequence, while the default is unordered parallel delivery.',
      'Sign every payload with an HMAC over the body plus a timestamp, support two active signing keys for rotation, and include the timestamp in the signed content so customers can reject replays.',
      'Treat outbound requests as a security boundary: validate customer URLs against a blocklist of private IP ranges and link-local addresses at registration and again at resolution time, disable redirects, and route through an egress proxy, because server-side request forgery through webhook URLs is a well-known and frequently exploited hole.'
    ],
    deepdives: [
      {
        q: 'A customer endpoint accepts requests but takes 60 seconds to respond. What happens to your fleet?',
        a: 'Without per-endpoint concurrency limits, workers accumulate on that endpoint and throughput for the other 39,999 customers collapses \u2014 this is the classic noisy-neighbour failure and it is what actually takes these systems down. With per-endpoint queues and a concurrency cap of, say, 5, the damage is bounded to that customer\u2019s own backlog growing. I would also set an aggressive client timeout of around 10 seconds and treat a timeout as a retryable failure, publishing that timeout in the documentation so customers know they must acknowledge quickly and process asynchronously.'
      },
      {
        q: 'Why can you not just guarantee exactly-once delivery?',
        a: 'Because the acknowledgement can be lost. If we send a request and the connection drops before the response arrives, we cannot distinguish "the customer processed it" from "the customer never received it", and both retrying and not retrying are wrong in one of those cases. We choose to retry, which makes duplicates possible and missed events not. The honest contract is at-least-once delivery with a stable event id, and we push deduplication to the consumer where it can be done correctly against their own transaction. I would make that easy by documenting it prominently and providing a short code sample rather than burying it.'
      },
      {
        q: 'A customer was down for three days and wants every missed event. How do you support that?',
        a: 'Because events are persisted independently of delivery, replay is a query over the event log by customer and time range, dispatched into the delivery pipeline with the original event ids so the customer\u2019s deduplication still works. I would expose it as a self-service API with a rate limit, since a replay of three days of events can be a larger burst than the customer\u2019s steady state and could take them down again on recovery. The retention window for replay is a published number, and events older than it are genuinely gone, which is a product decision that should be stated rather than discovered.'
      }
    ],
    redflags: [
      'Uses a single shared queue for all endpoints, so one slow customer starves everyone.',
      'Claims exactly-once delivery to customer endpoints.',
      'Retries immediately and indefinitely with no backoff, jitter or circuit breaker.',
      'Fetches customer-supplied URLs with no validation against internal address ranges, leaving an obvious server-side request forgery hole.'
    ],
    topicIds: ['event-driven-architecture', 'resilience-patterns', 'backend-security']
  },
  {
    id: 'multi-tenant-saas-data-isolation',
    title: 'Design multi-tenant SaaS data isolation',
    track: 'backend',
    difficulty: 'core',
    pattern: 'Isolation model per tier, defence in depth, noisy neighbour control',
    prompt:
      'A B2B SaaS has 30,000 tenants ranging from 5-seat startups to a 200,000-seat enterprise that generates 40% of all load. Enterprise buyers demand proof of isolation and some require their data in a specific region or in their own encryption boundary. A cross-tenant data leak would be an existential event for the company. You must also be able to run schema migrations across all tenants without weeks of downtime.',
    clarify: [
      'What does the enterprise contract actually require \u2014 logical isolation with an audit, a dedicated database, or dedicated infrastructure? These have wildly different costs and are often conflated in sales conversations.',
      'Is the 200,000-seat tenant\u2019s 40% of load steady or spiky? A single tenant that large may simply not fit in a shared pool and may need its own cell regardless of contract.',
      'Do we need per-tenant encryption keys with customer-managed key material? That constrains everything from caching to backups, and is a common enterprise checkbox with deep implications.',
      'How often do schema migrations happen, and are they usually additive? Additive migrations across a shared schema are easy; a per-tenant-database model makes 30,000 migrations an operational programme.'
    ],
    approach: [
      'Offer a tiered isolation model rather than one answer: shared schema with a `tenant_id` column for the long tail, a dedicated database per tenant for the enterprise tier, and a dedicated cell \u2014 full stack \u2014 for the largest and for regional residency requirements.',
      'Make tenant scoping structural rather than disciplined: all data access goes through a repository layer that injects the tenant predicate from the request context, and raw query access is prohibited by lint and code review, because "every developer remembers the WHERE clause" is not a security control.',
      'Add a second independent layer with database row-level security policies keyed to a session variable set per connection, so even a query that escapes the repository layer cannot read another tenant\u2019s rows \u2014 defence in depth matters here precisely because the failure is existential.',
      'Propagate tenant context explicitly through every asynchronous boundary: queue messages, scheduled jobs and cache keys all carry the tenant id, since the most common real leak is a background job that processes without tenant scope or a cache key that omits it.',
      'Isolate the 40%-of-load tenant into its own cell so its traffic cannot degrade the shared pool, and design the cell architecture generally so any tenant can be promoted to a dedicated cell without a code change \u2014 just a routing table update and a data move.',
      'Enforce per-tenant quotas in the shared pool on query concurrency, storage and request rate, with fair-share scheduling so a mid-size tenant running a large report does not degrade the other 29,999.',
      'Handle migrations by requiring the expand-migrate-contract pattern: add the new structure, dual-write, backfill in batches with rate limiting, switch reads, then remove the old \u2014 each step independently deployable and reversible, which is what avoids downtime in both the shared and dedicated models.',
      'Prove isolation continuously rather than annually: run an automated test suite that attempts cross-tenant access through every API surface on every deploy, and log every query lacking a tenant predicate as a security event.'
    ],
    deepdives: [
      {
        q: 'Where do cross-tenant leaks actually come from in practice?',
        a: 'Almost never from the main read path, which is well tested. In my experience they come from four places: cache keys missing the tenant id so one tenant is served another\u2019s cached response; background jobs and admin tooling that query without tenant scope because they were written for operational convenience; search indexes where documents from all tenants share an index and a filter is forgotten; and exported reports or bulk endpoints built quickly for one customer. Each of these is outside the request path where the discipline lives, which is why tenant context must be carried through async boundaries and enforced at the storage layer rather than at the controller.'
      },
      {
        q: 'How do you run a schema migration across 30,000 tenant databases in the dedicated tier?',
        a: 'As a controlled programme, not a command. Migrations are versioned artefacts applied by an orchestrator that tracks per-tenant schema version, runs in waves starting with internal and canary tenants, and stops the entire rollout on a failure rate threshold. Critically, the application must support both the old and new schema simultaneously for the whole duration, because 30,000 databases will not all be at the same version for days \u2014 that constraint is what makes expand-migrate-contract mandatory rather than stylistic. I would also track tenants that fail repeatedly as a visible remediation list, because the tail of stuck tenants is where these programmes quietly die.'
      },
      {
        q: 'The enterprise customer demands their own encryption key, which they can revoke. What does that mean for your architecture?',
        a: 'It means their data must be encrypted with a key they control at a boundary we can actually enforce, typically envelope encryption where a per-tenant data key is wrapped by their key in a managed key service. The consequences ripple: caches holding decrypted data must be per-tenant and must be purgeable on revocation, backups must be encrypted under the same key so revocation covers them, and any cross-tenant analytics pipeline can no longer read their rows. Revocation must be a tested operation with a defined completion time, because a customer who revokes and then finds their data still readable has a stronger complaint than one who was never offered the feature.'
      },
      {
        q: 'A tenant grows from 500 seats to 50,000. How do you move them between isolation tiers without downtime?',
        a: 'The tier must be a routing decision, not an architectural fork, which is why the cell design should be identical in shape across tiers. The move is then a standard data migration: replicate the tenant\u2019s data to the target cell, dual-write during a catch-up window, verify with a row-count and checksum comparison, then flip the tenant\u2019s entry in the routing table and drain the old connections. The step people miss is invalidating every cache and in-flight job referencing the old location, which is why tenant context on async work matters for operations as much as for security.'
      }
    ],
    redflags: [
      'Relies on developers remembering to add a `tenant_id` predicate, with no enforcement at the storage or framework layer.',
      'Puts all 30,000 tenants including the 40%-of-load enterprise in one shared pool with no quotas or cells.',
      'Omits tenant context from cache keys, queue messages and scheduled jobs.',
      'Proposes a single synchronised migration across all tenant databases with a maintenance window.'
    ],
    topicIds: ['rate-limiting-and-tenancy', 'backend-security', 'data-modeling']
  },
  {
    id: 'tamper-evident-audit-log',
    title: 'Design a tamper-evident audit log',
    track: 'backend',
    difficulty: 'hard',
    pattern: 'Hash chaining, external anchoring, write-path availability versus completeness',
    prompt:
      'A regulated platform must record every privileged action \u2014 4M events a day \u2014 in an audit log that can be proven unmodified, including against an insider with database administrator access. Auditors must be able to verify integrity for any 7-year window, queries must return within seconds for investigations, and the log must not be a single point of failure that blocks the operations it records.',
    clarify: [
      'Does tamper-evident mean detect-only, or must modification be prevented outright? Prevention requires either a write-once storage medium or an external party, and detection is usually what regulators actually require.',
      'Is the threat model an external attacker or a privileged insider? The insider case rules out any scheme where the same operator controls both the log and the verification material.',
      'Must an action be blocked if the audit write fails, or may it proceed with a recorded gap? This is the core availability trade and the compliance team, not engineering, has to answer it.',
      'Who verifies, and how often \u2014 continuous automated verification or an annual audit? Continuous verification changes the design toward cheap incremental proofs.'
    ],
    approach: [
      'Make every entry immutable and chained: each record contains its content hash plus the hash of the previous record, so altering any historical entry invalidates every subsequent hash and the tampering is detectable by recomputation.',
      'Build a Merkle tree over each time batch \u2014 say, per minute \u2014 so verifying a single entry requires an inclusion proof of logarithmic size rather than rehashing the whole chain, which is what makes 7-year verification practical.',
      'Anchor the batch root externally at regular intervals: publish the Merkle root to a separate trust domain with different administrative control, such as a third-party timestamping authority or a write-once storage bucket with an object-lock retention policy, which is what defends against an insider who controls the primary system.',
      'Write entries to append-only storage with object-lock or an equivalent write-once-read-many policy, so even a database administrator cannot delete them without an auditable change to the retention configuration itself.',
      'Decouple the audit write from the operation with a durable local buffer: the service appends to a local write-ahead log synchronously, then ships asynchronously, so the audit subsystem being slow does not block a privileged operation while still guaranteeing the record survives a crash.',
      'Detect gaps rather than assume completeness: each producer maintains a monotonic per-source sequence number, and the ingestion side alerts on any missing sequence, so a dropped batch is a visible incident rather than an invisible hole.',
      'Serve investigation queries from a separate derived index over the log \u2014 by actor, resource, action and time \u2014 clearly marked as a non-authoritative projection, with any result verifiable back to the chained original on demand.',
      'Run continuous verification: a job re-verifies recent batches against their anchored roots hourly and samples historical batches daily, so tampering is detected in hours rather than at the next annual audit.'
    ],
    deepdives: [
      {
        q: 'A database administrator deletes 500 rows and rebuilds the hash chain over the remaining records. Are you protected?',
        a: 'Only because of the external anchor. Rebuilding the chain locally produces a self-consistent log, so local verification passes \u2014 this is exactly why hash chaining alone is insufficient and it is the detail that separates a real design from a superficial one. The anchored Merkle roots, held in a system the administrator does not control, will not match the recomputed roots for those batches, and continuous verification flags the mismatch within an hour. The anchoring interval sets the detection granularity and the maximum window in which tampering is undetectable, so it is a compliance parameter, not an implementation detail.'
      },
      {
        q: 'The audit pipeline is down for 10 minutes. Do privileged operations continue?',
        a: 'That is a compliance decision and I would insist it is made explicitly and documented, not defaulted by engineering. My recommended design allows operations to continue, because the synchronous local append-only write means the record is durable before the action completes, and only the shipping is asynchronous \u2014 so the log is complete even though it is delayed. If the local write itself fails, the operation is refused, because at that point we genuinely cannot record it. For environments where even delayed recording is unacceptable, the alternative is failing the operation, and the cost of that is an audit system outage becoming a platform outage.'
      },
      {
        q: 'Seven years of 4M events a day is roughly 10 billion records. How do queries stay fast?',
        a: 'The authoritative chained log is optimised for append and verification, not for query, so I would not query it directly. A derived index partitioned by time and indexed on actor and resource serves investigations, backed by columnar storage in object storage for older partitions with partition pruning. Recent data \u2014 the last 90 days, which is the overwhelming majority of investigation traffic \u2014 stays in a hot store. The important discipline is that the index is explicitly a projection: any record returned can be verified against the original and its inclusion proof, so a compromised index cannot fabricate evidence that survives verification.'
      },
      {
        q: 'How do you handle a legal requirement to delete personal data from a log that must be immutable?',
        a: 'These requirements genuinely conflict, so the design must anticipate it rather than resolve it afterwards. The approach is to never put erasable personal data in the log body: store a pseudonymous subject identifier in the entry and keep the mapping from identifier to person in a separate, erasable store. Deleting the person deletes the mapping, so the audit chain remains intact and verifiable while the data becomes unlinkable. This has to be a design-time decision, because once personal data is inside a hash-chained, externally-anchored record, the only ways out are breaking the chain or keeping the data, and both are bad.'
      },
      {
        q: 'Who owns this system and how do you keep the owner from being able to subvert it?',
        a: 'Ownership is part of the control. The team that operates the platform should not have write access to the anchoring destination or to the retention policy on the write-once store; those should sit with a separate function such as security or compliance, with changes requiring multi-party approval and themselves being audited elsewhere. That organisational separation is the real mechanism against the insider threat \u2014 the cryptography only makes the tampering detectable, and detection only matters if the detector is outside the attacker\u2019s control. I would document the trust boundaries explicitly, because an auditor will ask exactly this question.'
      }
    ],
    redflags: [
      'Uses hash chaining alone with no external anchor, which an administrator can simply recompute.',
      'Stores audit records in a mutable table alongside application data with ordinary write access.',
      'Blocks or fails privileged operations on any audit pipeline hiccup without acknowledging that as a deliberate compliance trade.',
      'Puts raw personal data in immutable records with no plan for erasure requirements.'
    ],
    topicIds: ['backend-security', 'data-modeling', 'infra-and-deployment']
  }
];
