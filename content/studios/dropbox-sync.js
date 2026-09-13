export default {
  blocks: [
    { t: 'prose',
      md: `Dropbox sync is the interview question where everyone says "watch folders" and almost nobody
survives the follow-ups: how do you diff a 4 GB file over a flaky laptop connection, what happens
when two people edit the same paragraph offline, and why polling a million clients will not fund
your Series B. The core mechanism is **content-defined chunking** plus a **version graph per file**,
with notify-when-possible and poll-when-you-must.` },

    { t: 'h', text: 'Content-defined chunking and Rabin fingerprints' },
    { t: 'prose',
      md: `Fixed-size blocks (every 4 MB) break when you insert one byte at the top: the entire file
re-uploads. **Content-defined chunking (CDC)** cuts the file where the data says to cut, using a
rolling hash over a sliding window. When the low bits of the hash match a mask, you emit a chunk
boundary. Insert in the middle shifts boundaries only locally -- chunks before and after the edit
often keep the same boundaries and the same **content hash**.

**Rabin fingerprinting** is the usual rolling hash: update in O(1) per byte as the window slides.
Typical targets are 4--16 MB average chunk size via the mask, with min/max bounds so you never emit
absurdly tiny or huge chunks. Each chunk is addressed by **SHA-256 of content** (or BLAKE3) -- the
hash is the id in object storage.

Staff line: "CDC means sync is proportional to **changed bytes**, not file size. A one-line edit in
a 2 GB VM image uploads one chunk, not two gigabytes."` },
    { t: 'diagram',
      code: `flowchart TB
  F["Local file"] --> R["Rolling Rabin scan"]
  R --> C1["Chunk hash A"]
  R --> C2["Chunk hash B"]
  R --> C3["Chunk hash C"]
  C1 --> M["Merkle root per file"]
  C2 --> M
  C3 --> M
  M --> S["Server block list"]`,
      caption: 'Chunk hashes form an ordered block list; merkle root is a cheap whole-file fingerprint for quick "changed?" checks.' },

    { t: 'h', text: 'Block list vs merkle tree per file' },
    { t: 'prose',
      md: `Each file version is an ordered list of chunk hashes -- a **block list**. Comparing local
and remote sync state is walking two lists and finding the first divergence, then uploading missing
chunks. For large files, a **merkle tree** (or merkle root plus intermediate nodes) lets you binary-
search which subtree changed instead of comparing hash-by-hash linearly.

Dropbox-class systems often store the block list in metadata DB and use merkle root as a quick
equality check on the wire: if roots match, skip detailed diff. If roots differ, fetch the remote
block list or merkle proof for the changed range only. Do not merkle the entire account -- per file
is the right granularity.

The metadata record also carries \`parent_rev\`, \`device_id\`, and \`mtime\` for conflict
detection, but **content hashes** are the source of truth for what bytes the server holds.` },

    { t: 'table',
      title: 'Sync metadata structures',
      cols: ['Structure', 'Purpose', 'When it wins', 'Cost'],
      rows: [
        ['Block list', 'Ordered chunk hashes for one file version', 'Upload missing chunks after linear diff', 'O(n) compare for n chunks -- fine under ~1k chunks'],
        ['Merkle root', 'Single fingerprint for whole file', 'Fast "unchanged?" on notify ping', 'Rebuild on every local edit touching root path'],
        ['Merkle tree nodes', 'Subtree proofs', 'Large files -- binary search to changed segment', 'More metadata to store and serialize'],
        ['Revision graph', 'Parent pointer per save', 'Branching history, restore, audit', 'Conflict detection needs policy on top']
      ] },

    { t: 'h', text: 'Notify vs poll' },
    { t: 'prose',
      md: `Clients cannot poll \`/changes\` every second for every user. The scalable pattern is
**long poll or push notify** when another device commits: server sends a lightweight "cursor
advanced" event; client then pulls the delta for files it cares about. Mobile and laptop sleep break
pure push, so you still need **periodic poll with exponential backoff** as fallback -- plus a full
reconcile on app foreground.

The notify channel (WebSocket, SSE, or OS push on mobile) carries only **cursor / generation
numbers**, not file bodies. Bodies always come from chunk upload or chunk download endpoints with
range support. This separation keeps notify fanout cheap and lets CDN serve immutable chunks by
hash.

Weak answer: "WebSocket for everything." Strong answer: "Notify tells me *that* to sync; block list
diff tells me *what*; chunk store tells me *how much* to transfer."` },

    { t: 'h', text: 'Conflicts -- conflict copies, not silent LWW for docs' },
    { t: 'prose',
      md: `For **binary files** (photos, PSDs), last-write-wins with revision history is often enough:
keep both revisions addressable, default view is latest. For **text docs**, silent LWW loses data
and users leave. The Dropbox pattern: on divergent \`parent_rev\`, store **both versions** -- yours
and \`conflicted copy\` -- and surface both in UI. User merges manually or picks one.

Implementation: commit requires \`parent_rev\` match. Mismatch returns \`409\` with remote block
list; client creates \`filename (conflicted copy)\` with local content and downloads remote as
canonical or sibling. Do not attempt operational transform in the sync layer unless the product *is*
a collaborative editor -- that is Google Docs, not Dropbox.

Staff signal: "Conflict policy is a product decision encoded in metadata, not something the chunk
layer magically resolves."` },

    { t: 'h', text: 'Upload resume and deduplication' },
    { t: 'prose',
      md: `Flaky upload must resume mid-chunk and mid-file. Chunk uploads are **PUT by content hash**:
if the server already has hash \`abc...\`, skip upload (dedup). Partial upload of a new chunk uses
a session id or multipart upload with committed parts; on reconnect, client re-lists which hashes
the server acked and sends only gaps.

The client maintains a local **upload queue** persisted to disk: file path, byte offset or chunk
index, attempt count. Crash mid-sync resumes from queue state, not from zero. Server-side, chunks
are immutable once committed -- never overwrite in place.

Dedup across users (same movie trailer uploaded twice) is optional enterprise cost saving; per-user
dedup from CDC is the baseline win.` },
    { t: 'code',
      lang: 'javascript',
      title: 'Commit with parent_rev -- conflict surface',
      code: `// Client proposes new block list against known parent revision.
POST /files/commit
{
  "path": "/notes/todo.txt",
  "parent_rev": "rev_8f2a",
  "blocks": ["sha256:a1...", "sha256:b2...", "sha256:c3..."]
}

// Success: 200 { rev: "rev_9aa1" }
// Conflict: 409 { remote_rev, remote_blocks, server_mtime }
// Client then writes conflicted copy locally and re-syncs both files.` },

    { t: 'h', text: 'LAN sync (optional acceleration)' },
    { t: 'prose',
      md: `When two devices share a LAN, uploading to the cloud and back down is wasteful. **LAN
sync** discovers peers via mTLS or account-scoped broadcast, exchanges block lists, and transfers
missing chunks directly peer-to-peer while still registering the new revision with the server for
consistency and off-LAN devices.

LAN is an optimization path, not the source of truth -- cloud metadata still wins on conflict, and
peer transfer must verify chunk hashes. Mention it briefly in interviews to show you know the full
product; do not design the whole system around P2P unless asked.` },

    { t: 'diagram',
      code: `sequenceDiagram
  participant A as Laptop
  participant C as Cloud metadata
  participant B as Phone
  A->>C: commit blocks plus parent_rev
  C->>B: notify cursor advanced
  B->>C: get block list delta
  B->>C: fetch missing chunk hashes
  C-->>B: chunk bytes by hash`,
      caption: 'Notify is cheap; bulk bytes move only for missing hashes.' },

    { t: 'h', text: 'Trade-offs' },
    { t: 'tradeoffs',
      title: 'CDC plus block list vs whole-file versioning',
      gains: [
        'Upload bandwidth scales with edited bytes, not file size.',
        'Cross-file dedup when same chunk appears twice (VM images, templates).',
        'Resume uploads at chunk granularity after disconnect.',
        'Immutable chunks map cleanly to CDN and object storage.',
        'Merkle root gives O(1) unchanged check before deep diff.'
      ],
      costs: [
        'CDC CPU on every local save -- rolling hash is not free on mobile.',
        'Chunk boundary shift can still re-upload adjacent chunks at boundaries.',
        'Conflict copies multiply files -- users must merge manually for docs.',
        'Metadata DB holds block lists -- hot path for large shared folders.',
        'Notify plus poll dual path adds client complexity and test matrix.'
      ] },

    { t: 'failures',
      items: [
        { mode: 'Fixed-size chunking', blast: 'One-byte insert re-uploads entire multi-GB file; laptop sync never finishes.', fix: 'Content-defined chunking with Rabin rolling hash and average size target via mask.' },
        { mode: 'Silent LWW on text docs', blast: 'Offline edits lost with no trace; support tickets and churn.', fix: 'Require parent_rev match; on 409 create conflicted copy and expose both versions in UI.' },
        { mode: 'Poll-only sync at scale', blast: 'Server melt from constant /delta; battery drain; minutes-late sync.', fix: 'Push or long-poll notify on cursor advance; backoff poll as sleep fallback.' },
        { mode: 'No upload resume', blast: 'Flaky Wi-Fi restarts multi-GB upload from zero; user disables sync.', fix: 'Persistent upload queue; chunk PUT by hash; skip already-committed hashes on reconnect.' },
        { mode: 'Whole-file download on notify', blast: 'Notify payload too heavy; CDN bypassed; cost spike.', fix: 'Notify carries cursor only; client diffs block lists and fetches missing chunks by hash.' },
        { mode: 'Merkle root without block list', blast: 'Know file changed but must download entire blob to find where.', fix: 'Store ordered block list per rev; use merkle for quick equality then subtree diff.' }
      ] },

    { t: 'staff',
      md: `Candidates often stop at "hash the file." Staff answers separate **chunking**, **metadata
rev graph**, and **transport**.

- "CDC with Rabin -- boundaries follow content, so a one-line edit in a huge file is one chunk upload,
not the whole file. Chunks addressed by SHA-256 in object storage."
- "Per-file block list is the version; merkle root is an accelerator for unchanged checks, not a
replacement for the list."
- "Commit is conditional on \`parent_rev\`. 409 means conflict -- for docs I keep conflicted copy,
not silent LWW."
- "Notify tells me the cursor moved; I pull block list delta and fetch missing hashes. Poll with
backoff when the laptop sleeps."
- "Upload queue on disk; PUT chunk by hash; server dedups -- resume after disconnect without restarting
from byte zero."
- "LAN peer transfer is optional bandwidth win; cloud metadata remains source of truth."

Signal: you think in bytes moved and revision graphs, not folder icons.` },

    { t: 'quiz',
      items: [
        {
          q: 'User inserts one line at the top of a 2 GB log file. Fixed 4 MB chunks vs CDC -- what uploads?',
          options: [
            'Both upload the full 2 GB.',
            'Fixed chunks re-upload nearly everything; CDC re-uploads chunks whose boundaries shifted plus the edited chunk -- typically far less.',
            'CDC uploads nothing because hashes are cached.',
            'Fixed chunks upload one 4 MB block only.'
          ],
          answer: 1,
          why: 'Fixed-size blocking shifts every subsequent boundary after an insert, so almost all blocks get new hashes. CDC boundaries are content-defined, so prefix chunks often stay identical and only local region re-chunks. That proportional-to-edit property is the whole reason CDC exists.'
        },
        {
          q: 'Two laptops edit the same README offline and both sync. Best doc policy?',
          options: [
            'Silent last-write-wins by server mtime.',
            'Merge automatically with line-level OT in the sync layer.',
            'Reject both commits permanently.',
            'Keep both versions -- conflicted copy -- and let the user merge; require parent_rev on commit.'
          ],
          answer: 3,
          why: 'Silent LWW loses user data without visibility. OT belongs in a collaborative editor product, not generic file sync. parent_rev conditional commit detects divergence; conflicted copy preserves both forks until human merge.'
        },
        {
          q: 'Why send cursor notify instead of the file in the push message?',
          options: [
            'Push payloads are encrypted differently.',
            'Notify is O(1) fanout; bodies flow through chunk fetch with dedup, CDN, and resume -- separating control from data plane.',
            'Files cannot traverse WebSockets.',
            'Cursor notify eliminates need for block lists.'
          ],
          answer: 1,
          why: 'Push channels are for waking clients, not moving gigabytes. Client pulls metadata delta, diffs block lists, downloads only missing immutable chunks by hash. This keeps notify cheap and leverages object storage and CDN for bulk.'
        }
      ] },

    { t: 'details',
      title: 'Related topics',
      blocks: [{
        t: 'prose',
        md: `Offline queues and client persistence connect to **Offline & Sync** on the frontend.
Idempotent chunk PUT and conditional commits mirror **API Design & Contracts**. Object storage and
CDN delivery for immutable hashes tie to **CDN & Edge**. Conflict policy overlaps **Collaborative
Editing** when the product moves toward live coauthoring.`
      }] }
  ],

  flashcards: [
    { q: 'Why content-defined chunking instead of fixed 4 MB blocks?', a: 'Fixed blocks shift on insert/delete, re-hashing most of the file. CDC uses rolling Rabin fingerprints so boundaries follow content; edits upload proportional changed chunks, enabling practical sync of multi-GB files.' },
    { q: 'What is stored per file version in Dropbox-class sync?', a: 'An ordered block list of content hashes plus parent_rev in a revision graph. Merkle root accelerates unchanged checks but the block list is what drives diff and missing-chunk fetch.' },
    { q: 'How does Rabin rolling hash enable CDC?', a: 'It updates fingerprint in O(1) per byte as a window slides. When low bits match a mask, emit a chunk boundary -- average size tuned by mask without fixed alignment to file offsets.' },
    { q: 'Notify vs poll in sync architecture?', a: 'Server pushes cursor or generation on change; client pulls block list delta and fetches missing chunks. Poll with backoff covers sleep and offline; poll-only at scale melts the API and drains battery.' },
    { q: 'Why conflicted copy instead of silent LWW for docs?', a: 'Silent last-write-wins deletes offline work with no audit trail. parent_rev conditional commit detects fork; both versions kept as normal and conflicted copy until user merges -- appropriate for files, not live OT.' },
    { q: 'How does upload resume work with chunk addressing?', a: 'Client persists upload queue; each chunk PUT keyed by content hash. Server dedups existing hashes; reconnect skips committed chunks and resumes multipart gaps only -- never restart whole file from zero.' },
    { q: 'What is LAN sync for?', a: 'Optional P2P transfer of missing chunks between account devices on same network, verifying hashes. Cloud metadata remains authoritative for rev and conflict; LAN saves uplink/downlink bandwidth only.' }
  ],

  drills: [
    {
      prompt: 'A user edits a 3 GB video locally while flying. Landing, sync shows 100% then restarts from 0% three times before completing over hotel Wi-Fi. Diagnose likely causes and design fixes.',
      probes: [
        'Fixed or content-defined chunking?',
        'Is upload queue persisted across app kill?',
        'Does notify trigger full re-download?',
        'Timeout mid-chunk behavior?',
        'What metrics on client?'
      ],
      strong: [
        'Identifies missing resume -- no persistent queue or chunk-level ack tracking.',
        'Checks whether fixed chunking amplifies upload on metadata edit in container.',
        'Proposes PUT by hash with skip-if-exists and multipart resume token.',
        'Separates progress bar (bytes queued) from commit (parent_rev success).',
        'Metrics: chunk retry count, bytes re-sent vs deduped, time-to-rev-complete.'
      ],
      weak: [
        'Increase timeout and hope.',
        'Single POST of entire file.',
        'Disable sync for large files without chunking story.'
      ]
    },
    {
      prompt: 'Two executives edit budget.xlsx offline on laptops A and B from the same parent_rev. Both sync within seconds. What should the server and each client do?',
      probes: [
        'First commit wins -- second gets what HTTP status?',
        'What appears on each desktop?',
        'Is automatic merge acceptable?',
        'How do you avoid unbounded conflict copies?'
      ],
      strong: [
        'First parent_rev match succeeds; second gets 409 with remote blocks.',
        'Second client creates budget (conflicted copy).xlsx locally and downloads remote.',
        'Explicit rejection of silent LWW for structured docs.',
        'Optional UI to pick winner or merge; audit trail of both revs.',
        'Mentions binary vs doc policy difference if asked.'
      ],
      weak: [
        'Last mtime wins silently.',
        'Block second user entirely.',
        'Attempt OT merge in sync engine without product scope.'
      ]
    }
  ]
};
