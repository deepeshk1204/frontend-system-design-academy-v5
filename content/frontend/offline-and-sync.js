export default {
  blocks: [
    {
      t: 'prose',
      md: `An offline-first app treats the copy of the data on the device as the thing the user
interacts with, and treats the server as a peer it synchronises with when it can. Reads come from
local storage and succeed instantly. Writes go to local storage first, and a background process is
responsible for getting them to the server eventually.

The inversion is the whole point, and it is bigger than it sounds. In a normal app, a write is a
request whose response tells you whether it worked. In an offline-first app, a write is a durable
record of intent, and "did it work" is a question answered minutes or hours later, possibly with
the answer *"no, because someone else changed that row while you were on a plane."* Everything
difficult about offline is that last sentence.`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `Two separate forces push apps here, and they want different things.

The first is genuine disconnection: field service engineers in basements, warehouse scanners in
buildings with no signal, airline crew, anyone on a commuter train. For them offline is a
functional requirement, and a spinner is a broken product.

The second is latency, and it applies to everyone. A round trip to a regional server is 50-150 ms
on a good connection and 300 ms-plus on mobile. Research on interaction latency consistently puts
the threshold for an action feeling instantaneous at around 100 ms, so a server-confirmed write
never feels immediate. Writing locally and syncing in the background makes every interaction feel
instant, which is why apps with no offline requirement at all -- Linear, Superhuman -- adopt the
architecture anyway.

The cost is the same in both cases: you have accepted that two copies of the data can diverge, and
you now own a reconciliation strategy.`
    },

    { t: 'h', text: 'Where the data goes' },
    {
      t: 'table',
      title: 'Browser storage, honestly compared',
      cols: ['Store', 'Shape', 'Sync or async', 'Realistic limit', 'Use it for'],
      rows: [
        ['**IndexedDB**', 'Indexed object store with transactions and cursors.', 'Async, off the main thread.', 'Part of a shared origin quota -- often 60% of free disk on desktop Chrome; far tighter on iOS.', 'The primary application data store. This is the answer for entities and the outbox.'],
        ['**Cache Storage**', 'Request/Response pairs.', 'Async.', 'Same shared quota.', 'HTTP responses and app-shell assets, driven by the service worker. Not a database.'],
        ['**OPFS**', 'A real file system with synchronous access handles in a worker.', 'Sync inside a worker, which is the point.', 'Same quota, best large-file performance.', 'SQLite compiled to WASM, large binaries, anything needing real file semantics.'],
        ['**localStorage**', 'String key/value.', '**Synchronous, main thread.**', '~5-10 MB.', 'Almost nothing. Every access blocks the main thread. A device id or a theme preference at most.'],
        ['**In-memory**', 'Whatever you like.', 'Sync.', 'RAM.', 'The working set you render from, hydrated from IndexedDB at startup.']
      ]
    },
    {
      t: 'prose',
      md: `IndexedDB has a deserved reputation for an unpleasant API -- versioned upgrade
transactions, event-based callbacks, transactions that auto-close if you await something
unrelated -- so most teams use a wrapper such as \`idb\`, Dexie, or a local-first database like
RxDB. That is fine. What you cannot delegate is understanding **eviction**, because it decides
whether your durable write is actually durable.

Storage in a browser is best-effort by default. Under storage pressure browsers evict whole origins
using an approximately least-recently-used policy, and your data goes with it. Safari is far more
aggressive: it caps per-origin storage tightly and, under its storage policy, will delete
script-writable storage for origins the user has not interacted with for seven days. An enterprise
tool a user opens fortnightly can lose its local database between uses.

Call \`navigator.storage.persist()\`, which asks for the \`persistent\` bucket and, when granted,
exempts you from ordinary eviction. Whether it is granted depends on engagement signals --
installed as a PWA, notification permission granted, high site engagement -- so treat it as a
request you check the result of, not a switch. And check \`navigator.storage.estimate()\` so you can
degrade deliberately before you hit a quota error rather than discovering it mid-write.`
    },
    {
      t: 'numbers',
      title: 'Storage figures worth knowing',
      items: [
        { v: '~60%', k: 'Of free disk, Chrome origin quota', note: 'Shared across IndexedDB, Cache Storage and OPFS' },
        { v: '~1 GB', k: 'Typical Safari cap per origin', note: 'Prompts the user beyond it; historically much lower' },
        { v: '7 days', k: 'Safari eviction of unused origin storage', note: 'Without a persistence grant or app install' },
        { v: '~5-10 MB', k: 'localStorage, synchronous', note: 'Every read blocks the main thread' },
        { v: '~100 ms', k: 'Threshold for an interaction to feel instant', note: 'Why local-first wins even when online' }
      ]
    },

    { t: 'h', text: 'The service worker, and the update trap' },
    {
      t: 'prose',
      md: `A service worker is a script that sits between your page and the network and can serve
responses from Cache Storage, which is what makes a cold offline launch possible. Its lifecycle is
also the single most common source of "why are users still on last week's build" incidents, so it
is worth stating precisely.

On registration the browser downloads the worker and it *installs*. If an older worker is already
controlling open pages, the new one goes to \`waiting\` and stays there -- it does not take over.
It activates only when every page controlled by the old worker has been closed. Reloading is not
enough, because a reload keeps the old worker alive across the navigation. Users with a
long-running tab can sit on a months-old worker.

\`self.skipWaiting()\` bypasses the wait, and using it unconditionally is its own bug: the page's
loaded JavaScript suddenly finds itself talking to a worker from a different build, and any
lazy chunk it requests may no longer exist. The correct pattern is to detect the waiting worker,
tell the user an update is ready, and call \`skipWaiting\` followed by a reload only when they
accept -- or silently at a safe moment such as a navigation to a route with no unsaved state.

One more trap: the service worker script itself must not be cached aggressively. Browsers now cap
its freshness check at 24 hours regardless of headers, but if a CDN serves it with a long
\`max-age\` you can still strand users. Serve it with \`Cache-Control: no-cache\`.`
    },

    { t: 'h', text: 'The outbox pattern' },
    {
      t: 'prose',
      md: `Here is the core mechanism. When a user performs a write, you do three things in one
IndexedDB transaction: apply the change to the local entity store so the UI updates immediately,
append a record to an \`outbox\` store describing the intended mutation, and mark the affected entity
as having pending local changes. Then a sync worker drains the outbox in order, one record at a
time, marking each as sent or failed.

The critical property is that the outbox write and the optimistic local update are **atomic**. If
they are separate transactions, a crash between them leaves the UI showing a change that will never
be sent -- a silent data-loss bug your users will report as "it didn't save" and you will never
reproduce.

The second critical property is that the outbox is a queue of *intents*, not of HTTP requests. Store
the operation and its arguments, not a serialised \`fetch\` call, so a client update can change how
an intent maps onto the API without a migration of pending records.`
    },
    {
      t: 'code',
      lang: 'ts',
      title: 'An outbox record schema that survives contact with production',
      code: `interface OutboxRecord {
  id: string;              // UUID v4 generated on the client; also the idempotency key
  entity: string;          // 'task'
  entityId: string;        // client-generated UUID if this is a create
  op: 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;  // only changed fields for an update
  baseVersion: number | null;        // server version the user was looking at
  createdAt: number;       // client clock — for ordering and display only, never for conflicts
  attempts: number;
  nextAttemptAt: number;   // populated by backoff; the drain loop respects it
  status: 'pending' | 'inflight' | 'failed' | 'conflict';
  lastError?: { code: string; message: string; at: number };
}

// The two writes must share one transaction.
async function mutateLocally(db, entity, patch, intent: OutboxRecord) {
  const tx = db.transaction(['tasks', 'outbox'], 'readwrite');
  await tx.objectStore('tasks').put({ ...entity, ...patch, _pending: true });
  await tx.objectStore('outbox').add(intent);
  await tx.done;   // either both landed or neither did
}`
    },
    {
      t: 'diagram',
      code: `flowchart TB
  U["User action"] --> TX["One IndexedDB transaction"]
  TX --> L["Local entity store<br/>marked pending"]
  TX --> O["Outbox append"]
  L --> UI["UI updates immediately"]
  O --> D{"Drain loop<br/>online?"}
  D -->|no| W["Wait for online event"]
  W --> D
  D -->|yes| P["POST with Idempotency-Key<br/>and If-Match baseVersion"]
  P -->|"2xx"| A["Apply server response<br/>clear pending, delete record"]
  P -->|"409 version conflict"| C["Mark conflict<br/>resolve or ask user"]
  P -->|"5xx or network"| B["Backoff, attempts plus 1"]
  B --> D
  P -->|"4xx permanent"| F["Mark failed<br/>surface to user"]`,
      caption: 'Four distinct outcomes. Collapsing 409 into the retry path is how an app retries a doomed mutation for three days.'
    },

    { t: 'h', text: 'Idempotent mutations' },
    {
      t: 'prose',
      md: `Offline sync guarantees duplicate delivery, so idempotency is not optional. The specific
scenario: the client posts a mutation, the server processes it and commits, and the response is lost
to a dropped connection. The client cannot distinguish that from "the request never arrived", so it
retries. Without protection you have created two tasks, or charged the card twice.

The mechanism is a client-generated idempotency key sent with the request -- the outbox record's
UUID is exactly right, because it is stable across every retry of that intent. The server stores the
key with the result for a retention window, typically 24 hours to 7 days, and on seeing a duplicate
key replays the stored response instead of re-executing. Stripe's API works this way, and it is
worth copying rather than inventing.

Two client-side design choices make this dramatically easier. **Generate entity ids on the client.**
If the client mints \`task:0f3a-...\` as a UUID, then a create is idempotent by construction, the
local record never needs its id rewritten when the server responds, and any child records the user
created offline can already reference their parent. Waiting for a server-assigned id means a
temporary id, a rewrite pass, and a class of dangling-reference bug that is genuinely hard to test.

**Send fields, not whole objects, for updates.** A partial patch of \`{ title }\` merges cleanly with
someone else's concurrent change to \`{ assignee }\`. A full-object PUT overwrites their change with
stale data you happened to have loaded, and it does so invisibly.`
    },
    {
      t: 'code',
      lang: 'http',
      title: 'The wire format for a retryable mutation',
      code: `PATCH /api/tasks/0f3a7c21-9bd4-4e11-8a52-2c9f0e1d7b33
Idempotency-Key: 6f1b2d9e-3a4c-4f70-9c1e-7d8a5b2f0e11   # the outbox record id
If-Match: "v7"                    # the server version the user was editing
Content-Type: application/merge-patch+json

{ "title": "Replace bearing on unit 12" }

# 200 -> applied. Body carries the new version; client stores it.
# 412 Precondition Failed / 409 Conflict -> someone else wrote v8.
#     Body should include the current server state so the client can
#     resolve without a second round trip.
# 409 with a replayed Idempotency-Key -> the original response, byte for byte.`
    },

    { t: 'h', text: 'Conflict detection and resolution' },
    {
      t: 'prose',
      md: `Detection and resolution are separate problems and conflating them is the usual mistake.
Detection asks "did someone else change this since the version I based my edit on?" Resolution asks
"what should the merged result be?" You must solve detection mechanically; resolution is a product
decision.

Never detect conflicts with timestamps. Client clocks are wrong -- skew of minutes is common and
users set their clocks deliberately -- so last-write-wins by client time means the user with the
fastest clock wins every race. If you must compare times, compare server-assigned ones.

Three mechanisms that do work.`
    },
    {
      t: 'table',
      title: 'Detecting divergence',
      cols: ['Mechanism', 'How it works', 'Cost', 'Fits'],
      rows: [
        ['**Version number or ETag**', 'Each entity carries an integer or opaque version; a write sends `If-Match` and the server rejects a stale base.', 'One field per entity, trivial to reason about.', 'Almost every CRUD application. This is the default and it is usually sufficient.'],
        ['**Server-assigned sequence**', 'The server assigns a monotonic global or per-tenant sequence to every change; clients pull `changes?since=N`.', 'A single ordering authority and a change log.', 'Anything that needs an incremental sync feed as well as conflict detection -- the two fall out of the same design.'],
        ['**Vector clocks / version vectors**', 'Each replica keeps a counter per replica; comparing vectors distinguishes causally-ordered from genuinely concurrent writes.', 'Metadata grows with replica count and needs pruning.', 'Multi-writer systems with no central authority, or when you must *know* that two edits were concurrent rather than ordered.'],
        ['**Field-level versions**', 'Version per field rather than per entity.', 'Much more metadata; more complex merges.', 'High-contention documents where per-entity versioning would reject harmless concurrent edits to different fields.']
      ]
    },
    {
      t: 'prose',
      md: `For resolution, the decision hinges on whether silently discarding one side's work is
acceptable -- and for user-authored content it almost never is.

**Last-write-wins** is fine for genuinely single-owner, low-stakes state: a user's own theme
preference, a read/unread flag, a cursor position. It is also the honest default for things where
the latest value is definitionally correct, like a device's current location.

**Merge by field** handles the common case well. If the local patch touched \`title\` and the server
change touched \`assignee\`, apply both -- there is no real conflict, only a coarse detector. This one
rule eliminates most conflicts in practice.

**Surface to the user** when both sides changed the same field and the content is theirs. Show both
values with attribution and let them choose, exactly as a merge conflict does. This is more work
than it sounds, because you need to retain enough state to present both sides coherently and to
avoid asking twice about the same conflict.

**Domain rules** beat generic strategies where they exist: for a counter, sum the deltas rather
than picking a value; for a set, union the additions; for an inventory count taken in the field,
the later physical observation wins by definition.

The design rule underneath all of it: escalate to the user only when the merge would destroy
something they typed. Prompting on every version mismatch trains users to click through the dialog,
which is worse than silent LWW because it also wastes their attention.`
    },
    {
      t: 'note',
      tone: 'danger',
      title: 'The queue that retries forever',
      md: `A mutation that can never succeed -- the entity was deleted server-side, the user lost
permission, the payload fails validation after a schema change -- will sit in the outbox retrying
until someone notices. Meanwhile, if your drain loop is strictly ordered, it blocks every mutation
behind it. Users report "my changes stopped saving" and the outbox has 340 records.

Three controls. Classify errors: 4xx other than 408, 409 and 429 are permanent, so mark
\`failed\` and stop. Cap attempts -- around 10, reaching a 30-minute ceiling -- then park the record.
And surface parked records in the UI with an explicit discard or retry action, because a silent
dead-letter queue in a browser is data loss with extra steps.`
    },

    { t: 'h', text: 'Partial sync: pulling changes efficiently' },
    {
      t: 'prose',
      md: `Pushing is the outbox. Pulling is a change feed, and the shape that works is a cursor,
not a timestamp.

The server exposes \`GET /sync/changes?since=CURSOR&limit=500\` returning changed and deleted
entities plus a \`nextCursor\` and a \`hasMore\` flag. The client loops until \`hasMore\` is false,
persisting each page *and the cursor* in the same transaction so an interrupted sync resumes
exactly where it stopped rather than restarting. A device that has been offline for a week does
fourteen pages instead of one impossible request.

Three details decide whether this actually works. **Deletions must be explicit** -- the feed needs
tombstones, because a client cannot infer deletion from absence. **Tombstones need a retention
window**, say 30 days, and a client whose cursor is older than that window must be told to discard
and do a full resync rather than silently missing deletions forever. And **scope the feed by
authorisation at read time**, so a document the user lost access to arrives as a removal rather than
simply stopping.

For large datasets, sync a *working set* rather than everything: the current job, the assigned
region, the last 90 days. Users rarely need the whole corpus offline, and a 400 MB initial sync on
a warehouse tablet over hotel Wi-Fi is a product failure regardless of how correct the algorithm is.`
    },

    { t: 'h', text: 'Testing this' },
    {
      t: 'prose',
      md: `Offline bugs are timing bugs, and the DevTools offline checkbox tests almost none of
them -- it simulates clean disconnection, which is the easy case. The hard cases are captive portals
returning 200 with an HTML login page for your JSON endpoint, connections that accept a request and
never respond, and a tab that was offline while another tab was online on the same device.

What actually finds these: unit-test the outbox drain as a state machine with injected failures at
each step, including a crash between the local write and the outbox append. Integration-test against
a proxy that can drop a response *after* the server committed, which is the exact scenario
idempotency keys exist for. Property-test convergence by generating random interleavings of local
and remote operations and asserting both sides end identical. And keep a manual matrix for
multi-tab, mid-sync reload, quota exhaustion, and a cursor older than the tombstone window.`
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      gains: [
        'Every interaction is instant, because no read or write waits for a network round trip.',
        'The app functions fully with no connectivity, not in a degraded read-only mode.',
        'Transient network failures stop being user-visible errors.',
        'Server load drops -- reads are local and writes batch.',
        'The same change-feed machinery gives you realtime updates nearly for free.'
      ],
      costs: [
        'Two copies of the data can diverge, so you own a conflict strategy forever.',
        'Local schema migrations must run on devices you cannot inspect, with data you cannot see.',
        'Every mutation endpoint needs idempotency keys and version preconditions.',
        'Local data is a security surface -- it is readable by anyone with the device.',
        'Browser storage is evictable, so durability is best-effort without a persistence grant.',
        'Testing requires deliberate failure injection; the offline checkbox tests the easy path.',
        'Users can see stale data and need to understand why, which is a real UI design problem.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'Local write and outbox append in separate transactions', blast: 'Silent data loss -- the UI shows a saved change that will never sync.', fix: 'One IndexedDB transaction spanning both stores. Test with a crash injected between the two writes.' },
        { mode: 'Retrying without an idempotency key', blast: 'Duplicate entities and double charges when a success response is lost.', fix: 'Client-generated UUID as `Idempotency-Key`, stable across retries; server stores key-to-result for 24 h or more.' },
        { mode: 'Conflicts detected by client timestamp', blast: 'The user with the most skewed clock wins every race; edits vanish unpredictably.', fix: 'Server-assigned versions with `If-Match`; client clocks are for display only.' },
        { mode: 'Permanent failure retried forever', blast: 'A strictly ordered queue blocks all later mutations; users report saving has stopped.', fix: 'Classify 4xx as permanent, cap at ~10 attempts, park the record and surface retry or discard in the UI.' },
        { mode: 'Service worker never activates', blast: 'Users stay on an old build for weeks and hit chunk-load errors.', fix: 'Detect the waiting worker, prompt, then `skipWaiting` plus reload. Serve the worker script with `no-cache`.' },
        { mode: 'Storage evicted without a persistence grant', blast: 'The local database disappears -- on Safari after seven days of non-use -- taking unsynced writes with it.', fix: 'Call `navigator.storage.persist()` and check the result; sync opportunistically rather than hoarding; warn when unsynced work is at risk.' },
        { mode: 'Sync feed has no tombstones', blast: 'Deleted records live forever on devices and reappear when a user edits one.', fix: 'Explicit deletion events in the feed with a 30-day retention, and force a full resync for cursors older than the window.' },
        { mode: 'Two tabs draining the same outbox', blast: 'Duplicate in-flight requests and lost updates as they race on the same records.', fix: 'Elect one leader via the Web Locks API or a `SharedWorker`; a single drain loop per device.' }
      ]
    },

    {
      t: 'staff',
      md: `This topic separates candidates fast, because the naive answer -- "cache it in IndexedDB
and replay when online" -- is only about a fifth of the design. Sentences that demonstrate the rest:

- "The optimistic local write and the outbox append go in one IndexedDB transaction. If they are
  separate, a crash between them means the UI shows a change that will never sync, and that bug is
  unreproducible in the office."
- "Entity ids are client-generated UUIDs. That makes creates idempotent by construction and means
  a child record created offline can already reference its parent, instead of needing a temporary
  id and a rewrite pass."
- "Every mutation carries an \`Idempotency-Key\` -- the outbox record id -- because the failure I am
  designing for is the server committing and the response being lost. The client cannot tell that
  apart from a request that never arrived."
- "Conflict detection is server versions with \`If-Match\`, never client timestamps. Clock skew of
  minutes is normal, so timestamp-based last-write-wins means the user with the worst clock wins."
- "I merge by field first, because most 409s are two people editing different fields of the same
  row -- that is a coarse detector, not a real conflict. I only escalate to the user when both sides
  changed the same field of content they authored."
- "The queue needs error classification and a parking lot. A 403 retried on a 30-minute ceiling for
  three days blocks every mutation behind it and reads to the user as 'it stopped saving'."
- "Storage is evictable. I call \`navigator.storage.persist()\` and check whether it was granted,
  because Safari will clear script-writable storage after seven days without interaction, and an
  enterprise tool opened fortnightly is exactly that case."
- "I sync a working set, not the corpus. A 400 MB initial sync on a warehouse tablet is a product
  failure however correct the algorithm is."

Each of those names a specific failure and a specific mechanism. That is the difference between
having read about offline-first and having shipped it.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'A field technician edits a job offline, then reconnects. Your client PUTs the whole job object. A dispatcher had reassigned it while the technician was offline. What happens?',
          options: [
            'The server rejects the write because the version is stale.',
            'The reassignment is silently overwritten, because the PUT carries every field including a stale `assignee`.',
            'The fields merge automatically.',
            'A conflict dialog appears.'
          ],
          answer: 1,
          why: 'A full-object PUT asserts values for fields the user never touched, so the technician\'s stale `assignee` overwrites the dispatcher\'s change with no error anywhere. Two fixes and you want both: send partial patches containing only changed fields, and send `If-Match` with the base version so the server can reject a stale write instead of applying it. Without the precondition the server has no way to know the write was based on old state.'
        },
        {
          q: 'Your outbox drains strictly in order. One record gets a 403 because the user lost project access. What is the user-visible symptom?',
          options: [
            'Only that one change fails.',
            'Every later change stops syncing while the queue retries a doomed request.',
            'The outbox is cleared.',
            'The app goes offline.'
          ],
          answer: 1,
          why: 'Strict ordering plus indiscriminate retry means one permanently-failing record becomes a head-of-line block, and the user sees saving stop entirely with no explanation. Classify errors -- 4xx other than 408, 409 and 429 are permanent -- park the record after a capped number of attempts, and surface it with retry or discard. Ordering only genuinely matters between mutations on the same entity, so consider per-entity queues rather than one global one.'
        },
        {
          q: 'You ship a new service worker on Tuesday. On Thursday, 30% of sessions still run Monday\'s build. Most likely cause?',
          options: [
            'The CDN cached the app shell too long.',
            'The new worker is stuck in `waiting` because those users never closed every controlled tab, and a reload does not activate it.',
            'IndexedDB migration failed.',
            'Users declined the update prompt.'
          ],
          answer: 1,
          why: 'A new worker installs and then waits until every page controlled by the old one is closed. Reloading does not help, because the old worker survives the navigation, so a user with a pinned tab can stay on an old build indefinitely. The fix is to detect the waiting worker, tell the user, and call `skipWaiting` plus a reload when they accept -- doing it unconditionally instead risks the loaded page requesting chunks the new build no longer has.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `The sequence-cursor and resume machinery here is the same idea as reconnection in
**Realtime: Polling, SSE & WebSockets**, stretched from seconds to days. When per-field merging is
not good enough because the data is a text document, you need the convergence models in
**Collaborative Editing: OT & CRDT**. \`Idempotency-Key\` and \`If-Match\` are contract concerns from
**API Contracts & the BFF**, local data at rest is a **Frontend Security** surface, and shipping a
local schema migration to devices you cannot inspect is the hardest case in **Deployment, Rollout
& Migration**.`
      }]
    }
  ],

  flashcards: [
    { q: 'What is the outbox pattern?', a: 'Apply the mutation to the local store and append an intent record to an outbox queue in one atomic transaction, then have a background loop drain the queue to the server with retries, backoff and error classification.' },
    { q: 'Why must the local write and outbox append share a transaction?', a: 'Otherwise a crash between them leaves the UI showing a change that will never be sent -- silent data loss that is effectively unreproducible in development.' },
    { q: 'Why generate entity ids on the client?', a: 'Creates become idempotent by construction, the local record never needs its id rewritten, and records created offline can already reference their parents without temporary ids and a rewrite pass.' },
    { q: 'What exact failure does `Idempotency-Key` protect against?', a: 'The server committing the mutation and the response being lost. The client cannot distinguish that from a request that never arrived, so it retries; the key lets the server replay the stored result instead of re-executing.' },
    { q: 'Why never detect conflicts with client timestamps?', a: 'Client clocks are routinely minutes off and can be set deliberately, so timestamp-based last-write-wins hands the race to whoever has the most skewed clock. Use server-assigned versions with `If-Match`.' },
    { q: 'When should a conflict be shown to the user?', a: 'Only when both sides changed the same field of content the user authored. Different fields should merge, and prompting on every version mismatch just trains people to dismiss the dialog.' },
    { q: 'Why does a new service worker not take effect on reload?', a: 'It installs and waits until every page controlled by the old worker is closed; a reload keeps the old worker alive. You must detect the waiting worker and call `skipWaiting` plus a reload, ideally with user consent.' },
    { q: 'What does `navigator.storage.persist()` do?', a: 'Requests the persistent storage bucket so your origin is exempt from ordinary eviction. It can be denied based on engagement signals, so check the returned value -- especially on Safari, which clears script-writable storage after seven days of non-use.' },
    { q: 'Why does a sync change feed need tombstones?', a: 'A client cannot infer deletion from absence, so deletions must be explicit events. Tombstones need a retention window, and a client with a cursor older than that window must be forced into a full resync.' }
  ],

  drills: [
    {
      prompt: 'Design offline support for a field-service app. Technicians work in basements with no signal for up to six hours, complete checklists and capture photos, and dispatchers reassign jobs from the office in the meantime. Each technician has about 40 jobs assigned, and photos average 2 MB.',
      probes: [
        'What do you sync down before they leave, and what do you leave behind?',
        'A technician and a dispatcher both edit job 812 while the technician is offline. What happens?',
        'The photo upload gets a 200 that never reaches the device. Then what?',
        'The device storage quota fills mid-shift.',
        'How do you know, from the office, whether sync is healthy across the fleet?'
      ],
      strong: [
        'Syncs a bounded working set -- assigned jobs plus reference data -- rather than the whole corpus, with a cursor-based change feed for the catch-up.',
        'One IndexedDB transaction for the optimistic write plus the outbox append, with client-generated UUIDs for new records and photos.',
        'Partial patches with `If-Match` on server versions, merging by field and escalating only when the same field of authored content conflicts.',
        '`Idempotency-Key` per outbox record so a lost success response cannot duplicate a job or a photo.',
        'Photos handled separately from data: queued as blobs in IndexedDB or OPFS, uploaded with resumable chunks, and never blocking the checklist queue behind them.',
        'Calls `navigator.storage.persist()` and checks the grant, monitors `storage.estimate()`, and degrades deliberately -- stop capturing full-resolution photos, warn the technician -- before hitting a quota error.',
        'Error classification with a parking lot and a visible pending-sync indicator showing count and oldest unsynced item.',
        'Fleet observability: report outbox depth and oldest-pending age as telemetry so the office can see a stuck device before the technician calls.'
      ],
      weak: [
        'Syncs everything down and hits quota on day one.',
        'Full-object PUTs, so dispatcher reassignments are silently overwritten.',
        'No idempotency keys, so retries duplicate jobs and photos.',
        'Conflicts resolved by client timestamp.',
        'Photos in the same strictly-ordered queue as data, so one failed 2 MB upload blocks every checklist update.',
        'No visibility into sync state for either the technician or the office.'
      ]
    },
    {
      prompt: 'You need to change the local IndexedDB schema: a `tasks` store gains a required `projectId`, and you are splitting one store into two. Some users have been offline for three weeks with 200 pending outbox records written by the old client. Design the migration.',
      probes: [
        'What happens to outbox records created under the old shape?',
        'How do you handle a migration that throws halfway through on a device you cannot inspect?',
        'Can you roll this back?',
        'How do you know it worked?'
      ],
      strong: [
        'Versions the outbox record format itself and keeps a translator for the previous shape, rather than assuming the queue is empty at upgrade time.',
        'Drains or translates the outbox before the schema change where possible, and treats "the queue is not empty" as the normal case.',
        'Runs the migration inside IndexedDB\'s versioned upgrade transaction so a throw aborts atomically and leaves the old version intact.',
        'Notes that downgrade is not possible in IndexedDB, so the real rollback is a client release that can still read the new shape -- forward-compatible reads written before the migration ships.',
        'Emits telemetry per migration step with the from and to versions, and alerts on failure rate by app version and browser.',
        'Makes the new field nullable for a release, backfills from the server, and only then enforces it -- an expand, migrate, contract sequence on the client.'
      ],
      weak: [
        'Assumes the outbox is empty at upgrade time.',
        'Migration outside the upgrade transaction, so a failure leaves a half-migrated database.',
        'Claims rollback by shipping the previous client, ignoring that the local database version has already advanced.',
        'No telemetry, so a migration failing on one browser version is invisible.',
        'Makes the field required immediately, so every pending record fails validation.'
      ]
    }
  ]
};
