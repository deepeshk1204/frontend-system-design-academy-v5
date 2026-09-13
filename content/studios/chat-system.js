export default {
  blocks: [
    {
      t: 'prose',
      md: `Designing chat like WhatsApp is a lesson in **ordering, delivery semantics, and fanout**
-- not in picking WebSocket over SSE. A user with three devices expects a message sent once to
appear on all three, in the same order within each conversation, with checkmarks that mean
something different at each stage.

The traps: global ordering across all chats (unnecessary and expensive), broadcasting every
keystroke over WebSocket (melts your gateway), and treating "delivered" as "read." Staff answers
name per-conversation sequence numbers, an offline outbox, device-level fanout, and presence that
debounces -- plus E2E encryption only as a constraint that moves key material off your servers.`
    },

    { t: 'h', text: 'Per-conversation ordering, not global' },
    {
      t: 'prose',
      md: `Messages need **total order within a conversation**, not across the entire product.
Assign a monotonic \`seq\` per \`(conversationId)\` from a single writer -- the conversation
shard's primary DB, or a Kafka partition keyed by \`conversationId\`. Two different chats can
interleave arbitrarily; clients never merge streams across conversations anyway.

The client tracks \`lastSeqByConversation\`. On receipt: drop \`seq <= last\`, apply \`seq ==
last + 1\`, treat \`seq > last + 1\` as a gap and fetch \`/messages?after=lastSeq\`. Global
ordering via one cluster-wide counter would serialize every message in the company through a
single hot key -- 50k msg/s becomes impossible.`
    },
    {
      t: 'diagram',
      code: `sequenceDiagram
  participant A as Sender client
  participant S as Chat service
  participant G as Gateway fanout
  participant B as Recipient phone
  participant C as Recipient laptop
  A->>S: send conv-9 body hello clientMsgId uuid
  S->>S: assign seq 1042 per conv shard
  S->>G: persist plus fanout conv-9 seq 1042
  G->>B: push seq 1042
  G->>C: push seq 1042
  B->>S: ack delivered device-B up to 1042
  B->>S: read receipt up to 1042`,
      caption: 'Sequence is scoped to one conversation; fanout duplicates the same seq to every device subscribed to that conversation.'
    },

    { t: 'h', text: 'Ack, delivery, and read receipts' },
    {
      t: 'prose',
      md: `Three states, three meanings -- conflating them is a product bug:

- **Sent** (server accepted): one grey check. Server assigned \`seq\` and durably wrote to the
  conversation log.
- **Delivered** (at least one recipient device fetched or received push): two grey checks.
  Track \`deliveredUpTo[deviceId]\` per conversation.
- **Read** (user opened the chat and the message was visible): two blue checks. Track
  \`readUpTo[userId]\` -- usually the max across that user's devices after a debounced "viewport
  saw message" event.

Delivery acks should be **batched**: "device D caught up to seq 1042" every 5 s or 20 messages,
not one HTTP call per message. Read receipts are privacy-sensitive -- support disabling them per
chat, and never infer read from "app foreground" alone.`
    },
    {
      t: 'table',
      title: 'Receipt semantics',
      cols: ['State', 'Meaning', 'Stored as', 'User-visible'],
      rows: [
        ['**Sent**', 'Server persisted with seq', 'Row in message log', 'One grey check'],
        ['**Delivered**', 'Recipient device received or pulled', 'deliveredUpTo per deviceId', 'Two grey checks'],
        ['**Read**', 'User saw message in open chat', 'readUpTo per userId', 'Two blue checks'],
        ['**Failed**', 'Server rejected or TTL expired', 'clientMsgId mapping', 'Red exclamation, tap to retry']
      ]
    },

    { t: 'h', text: 'Fanout to devices and offline outbox' },
    {
      t: 'prose',
      md: `A user is not one socket -- they are **N devices**, each with its own connection and
\`lastAckedSeq\`. On new message, the gateway looks up all devices subscribed to
\`conversationId\` and pushes once per online socket. Offline devices miss the push; they
**catch up on reconnect** via \`GET /sync?conversations=...&since={lastSeq}\`.

The **offline outbox** on the sender side is equally critical. When the sender has no network,
messages queue locally with a client-generated \`clientMsgId\` (UUID). On reconnect, flush the
outbox in order; the server deduplicates by \`clientMsgId\` and returns the assigned \`seq\`.
Without idempotency, a retry creates duplicate "hello" messages -- the bug users never forgive.

Size the outbox -- cap at 500 pending messages or 7 days -- and surface "waiting to send" state
per message, not a generic offline banner.`
    },
    {
      t: 'code',
      lang: 'js',
      title: 'Sender outbox flush with idempotent clientMsgId',
      code: `async function flushOutbox() {
  for (const msg of outbox.sort(byCreatedAt)) {
    const res = await fetch('/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: msg.conv,
        clientMsgId: msg.id,   // UUID generated offline
        body: msg.text
      })
    });
    const { seq, duplicate } = await res.json();
    // duplicate true means retry succeeded; still remove from outbox
    markSent(msg.id, seq);
    outbox.remove(msg.id);
  }
}

// On push: apply only if seq === lastSeq + 1 for this conv
function onPush(conv, seq, body) {
  if (seq <= lastSeq[conv]) return;
  if (seq > lastSeq[conv] + 1) return resync(conv);
  lastSeq[conv] = seq;
  render(conv, body);
}`
    },

    { t: 'h', text: 'Presence without melting the server' },
    {
      t: 'prose',
      md: `**Do not WebSocket-broadcast every keystroke.** Typing indicators are ephemeral,
debounced signals -- send \`typing.start\` after 300 ms of input quiet, auto-expire after 3 s
without refresh, and never persist them to the message log. One typing event per conversation
every 3 s per user is enough; broadcasting each keypress at 8 keys/s × 50 participants in a
group chat is 400 events/s from one user.

**Online presence** is lease-based: heartbeat every 25 s, expire after 60-75 s without renewal.
Store in Redis with TTL; do not rely on disconnect events -- mobile apps kill sockets without
\`beforeunload\`. For "last seen," write on graceful background and on heartbeat gap, not on
every message sent.`
    },
    {
      t: 'note',
      tone: 'warn',
      title: 'Group chat vs 1:1 scaling',
      md: `1:1 fanout is two devices (or four if both have phone plus laptop). A 256-member group
write fans out to 256 sockets -- or 512 if everyone has two devices. For groups above 100 members,
switch to **pull-on-open**: write once to the log, notify with a lightweight "new activity"
badge, let clients fetch on enter. Push every message to 256 idle sockets burns gateway CPU on
muted groups. Mention @user can still trigger targeted push.`
    },

    { t: 'h', text: 'E2E encryption as an architectural constraint' },
    {
      t: 'prose',
      md: `End-to-end encryption is not a frontend detail -- it **moves keys off your servers**.
If messages are E2E encrypted, your service stores ciphertext blobs; **you cannot search message
bodies**, build server-side spam classifiers on content, or recover messages when a user loses
their only device unless you implement key backup with user-held passwords.

Design impact: receipt and presence metadata may still be plaintext; **key distribution** happens
via pre-key bundles uploaded by devices; group chats need sender-key or MLS-style rotation. Mention
E2E only to explain what you **cannot** do server-side -- not as a checkbox feature.`
    },

    { t: 'h', text: 'Numbers that anchor the design' },
    {
      t: 'numbers',
      items: [
        { v: '1 shard key', k: 'conversationId -- seq ordering scoped here, not globally.' },
        { v: '25 s', k: 'Presence heartbeat interval; expire lease after 60-75 s.' },
        { v: '3 s', k: 'Typing indicator TTL before auto-expire without refresh.' },
        { v: '5 s', k: 'Batch window for delivery acks -- not one request per message.' },
        { v: '256+', k: 'Group size where push fanout should yield to pull-on-open for idle members.' }
      ]
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      gains: [
        'Per-conversation seq scales horizontally -- each shard is independent.',
        'clientMsgId idempotency makes offline outbox and retry safe.',
        'Batched delivery acks cut receipt traffic 20× vs per-message.',
        'Debounced typing and lease presence keep gateway load bounded.',
        'Pull-on-open for large groups prevents fanout storms on muted chats.'
      ],
      costs: [
        'Three receipt states to store, sync, and explain to users.',
        'Multi-device sync adds N sockets per user to every fanout.',
        'Offline outbox requires local persistence and conflict UI for failed sends.',
        'E2E removes server-side search, moderation on content, and naive backup.',
        'Gap detection and resync logic is client complexity that must be bulletproof.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'Global message ordering', blast: 'Single hot counter serializes all traffic; p99 send latency explodes at 10k msg/s.', fix: 'Monotonic seq per conversationId from conversation shard or keyed partition only.' },
        { mode: 'WebSocket broadcast per keystroke for typing', blast: 'One fast typist in a 200-person group generates 1,600 events/s; gateway CPU saturates.', fix: 'Debounced typing.start every 3 s TTL; never persist typing to log; optional disable in large groups.' },
        { mode: 'Retry without clientMsgId dedup', blast: 'Duplicate messages on every flaky send -- users see triple "hello" and lose trust.', fix: 'UUID clientMsgId on first enqueue; server unique index on (conversationId, clientMsgId).' },
        { mode: 'Delivered conflated with read', blast: 'Two blue checks while recipient only received push -- privacy backlash and wrong UX.', fix: 'Separate deliveredUpTo per device and readUpTo per user; read requires viewport visibility in open chat.' },
        { mode: 'Push fanout to 500-member muted group', blast: 'Gateway writes 500 sockets per message for users not watching -- wasted 90% of fanout.', fix: 'Pull-on-open above 100 members; lightweight badge push only; @mention targeted push.' },
        { mode: 'Presence via explicit disconnect', blast: 'Ghost online users forever after mobile kill or crash.', fix: 'Lease-based heartbeat every 25 s; Redis TTL expiry at 60-75 s; last-seen on gap not on every msg.' }
      ]
    },

    {
      t: 'staff',
      md: `Staff signal: you separate **conversation-scoped seq**, **device fanout**, and **three
receipt states** -- and you refuse to broadcast keystrokes.

- "Ordering is per conversationId, not global. Seq comes from the conversation shard; two chats
  interleaving is fine, gaps trigger resync for that conv only."
- "Sender offline outbox with clientMsgId UUID; server dedupes on retry. Without it every
  reconnect duplicates messages."
- "Delivered is per device -- at least one socket got it. Read is per user -- saw it in the open
  chat with debounced viewport. Different tables, different checks."
- "Typing: debounce 300 ms, TTL 3 s, never hit the durable log. In a 200-person group, one
  keystroke stream must not fan out 200 times per key."
- "Groups above 256: pull-on-open for idle members, badge-only push. Fanout to every muted socket
  does not scale."
- "E2E means I store ciphertext -- no server-side search or content moderation. Key distribution
  is device pre-keys; mention it as a constraint, not a feature toggle."

Naming batched acks, clientMsgId idempotency, and pull-vs-push group threshold marks production
scars, not diagram vocabulary.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'Sender on a train sends 3 messages offline, then reconnects. Server receives 5 POSTs due to retries. How many appear in the chat?',
          options: [
            '5 -- each POST creates a message.',
            '3 -- server dedupes by clientMsgId and returns existing seq on duplicate.',
            '8 -- retries add to outbox again.',
            '1 -- only the last retry wins.'
          ],
          answer: 1,
          why: 'The offline outbox assigns one UUID clientMsgId per logical message before first send. Retries carry the same id; the server unique index on (conversationId, clientMsgId) returns the original seq with duplicate: true. The client removes the outbox entry either way. Without this, flaky networks create permanent duplicate hell.'
        },
        {
          q: '200-member group, average 30 messages per minute. Most members have the chat muted. Best delivery strategy?',
          options: [
            'Push every message to all 200 sockets immediately.',
            'Write to log once; badge push only; full fetch when user opens chat; @mention gets targeted push.',
            'Email digest every hour.',
            'Disable groups above 50.'
          ],
          answer: 1,
          why: 'Push fanout to 200 idle muted sockets is 200 writes per message for users not watching -- 6,000 socket writes per minute of mostly wasted work. Persist once, notify lightly, pull on open. Targeted push for @mentions preserves urgency without melting the gateway on routine traffic.'
        },
        {
          q: 'User sees two blue checks but insists they never opened the chat. Most likely bug?',
          options: [
            'Delivered and read states share the same readUpTo field.',
            'Seq numbers are global.',
            'Typing indicator persisted too long.',
            'Outbox flushed twice.'
          ],
          answer: 0,
          why: 'Read requires explicit viewport visibility in the open conversation; delivered only means a device received the payload. Conflating the two -- e.g. marking read when push arrives or app foregrounds -- produces false blue checks and privacy incidents. Separate deliveredUpTo per device from readUpTo per user.'
        },
        {
          q: 'E2E encryption is required. What can the server NOT do?',
          options: [
            'Route ciphertext between devices.',
            'Store delivery receipts and seq numbers.',
            'Full-text search message bodies for support queries.',
            'Fanout encrypted payloads to online sockets.'
          ],
          answer: 2,
          why: 'E2E moves content keys to devices; server holds ciphertext only. Routing, seq assignment, receipt metadata, and fanout of opaque blobs still work server-side. Server-side body search, content moderation, and naive account recovery require plaintext or key escrow -- explicitly out of scope under true E2E.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics',
      blocks: [{
        t: 'prose',
        md: `WebSocket lifecycle and reconnect backoff are in **Realtime Frontend**. Offline outbox
and idempotent retry overlap **Offline-First & Sync**. Per-shard ordering connects to backend
**Sharding & Partitioning**. Lease-based presence mirrors realtime presence patterns in the same
track.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why order messages per conversation instead of globally?', a: 'Global seq creates one hot counter serializing all company traffic. Per-conversationId monotonic seq from the conversation shard scales horizontally -- clients only need order within the chat they are viewing.' },
    { q: 'Difference between delivered and read receipts?', a: 'Delivered means at least one recipient device received the message -- tracked per deviceId. Read means the user saw it in the open chat -- tracked per userId with viewport debounce. Conflating them causes false blue checks.' },
    { q: 'What is clientMsgId for in the offline outbox?', a: 'UUID assigned before first send attempt; server dedupes on (conversationId, clientMsgId) so retries after flaky network do not create duplicate visible messages.' },
    { q: 'How should typing indicators work at scale?', a: 'Debounced typing.start after 300 ms, auto-expire after 3 s, never written to durable log. Do not broadcast every keystroke -- one signal per user per conversation per few seconds max.' },
    { q: 'Fanout to multiple devices per user?', a: 'Each device has its own socket and lastAckedSeq. On new message, gateway pushes to all online devices for subscribed conversations; offline devices catch up via sync on reconnect.' },
    { q: 'Group chat push vs pull threshold?', a: 'Above roughly 100-256 members, push to every socket on each message wastes gateway on muted idle users. Write once to log, badge notify, fetch on open; @mention keeps targeted push.' },
    { q: 'E2E encryption architectural constraint?', a: 'Server stores ciphertext only -- no server-side body search, content moderation, or key recovery without user-held backup. Receipts and seq metadata can remain plaintext; keys live on devices via pre-key bundles.' }
  ],

  drills: [
    {
      prompt: 'Design WhatsApp-class messaging: 2B users, 100B messages/day, median 1:1 chats, groups up to 512, multi-device sync, offline send, delivery and read receipts, optional E2E. Gateway fleet must survive morning reconnect thundering herd.',
      probes: [
        'Where does seq come from and what is its scope?',
        'User sends 10 messages on airplane mode then lands -- walk through outbox flush.',
        '256-person group, 40 msgs/min, 80% members muted -- fanout strategy?',
        'Typing indicator in that group -- what hits the wire?',
        'E2E enabled -- what breaks server-side?'
      ],
      strong: [
        'Per-conversationId seq from conversation shard; gap fetch by after=lastSeq; no global ordering.',
        'Offline outbox with clientMsgId UUID; idempotent POST; show per-message pending/sent/failed UI.',
        'Delivered batched every 5 s per device; readUpTo separate with viewport debounce and per-chat disable.',
        'Groups 256+: pull-on-open for idle members, badge push, @mention targeted push only.',
        'Typing debounced 300 ms, 3 s TTL, not persisted, disabled or sampled in megagroups.',
        'Multi-device fanout: push all online sockets; sync since per device on reconnect with full jitter backoff.',
        'E2E: ciphertext at rest, no server body search; pre-key bundles; receipts still plaintext metadata.'
      ],
      weak: [
        'Global auto-increment message id for all chats.',
        'Retry POST without dedup key.',
        'Push every group message to all 512 sockets always.',
        'WebSocket event per keystroke to all members.',
        'One checkmark for both delivered and read.',
        'Assume single device per user.',
        'E2E with server-held master keys for support search.'
      ]
    },
    {
      prompt: 'After a 90-second gateway outage, auth service stays red for 20 minutes. Logs show 12M reconnects in 60 seconds. What failed and how do you fix it?',
      probes: [
        'Why auth and not the gateway?',
        'Client reconnect behavior?',
        'Server-side defenses?',
        'What do users see during the gap?'
      ],
      strong: [
        'Synchronized client reconnect without full jitter -- 12M clients hit auth simultaneously.',
        'Full jitter backoff cap 30 s plus server-side connection rate limit per IP and per user.',
        'Resume token since=lastSeq so reconnect is cheap -- not full history refetch.',
        'Offline outbox buffers sends during outage; flush idempotently after reconnect.',
        'Auth issues short-lived socket tickets over HTTP, not bearer tokens in WebSocket URL.',
        'Metrics on reconnect rate and auth 429/503 to detect thundering herd early.'
      ],
      weak: [
        'Immediate reconnect on every close event.',
        'Fixed 1 s retry delay for all clients.',
        'Full message history refetch for every reconnecting user.',
        'Blame gateway without examining auth saturation curve.'
      ]
    }
  ]
};
