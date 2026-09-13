export default {
  blocks: [
    {
      t: 'prose',
      md: `HTTP is an agreement about the shape of a request and a response, plus a set of promises
about what each method and status code means. The wire format underneath it has been rewritten
three times -- text over one connection, binary frames over one connection, and binary frames over
UDP -- while the semantics stayed almost identical.

Both halves matter at Staff level, and for different reasons. The semantics decide whether it is
*safe* to retry a failed request. The wire format decides how fast a page loads. People who only
know one half write systems that either double-charge customers or waterfall for three seconds.`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `The original problem was interoperability: any client should be able to talk to any
server without prior arrangement. That is why HTTP is stateless and why it defines a small fixed
vocabulary of methods -- an intermediary such as a proxy, a CDN or a browser cache can then make
correct decisions about a request it has never seen before. A CDN can cache a \`GET\` without
knowing anything about your application, precisely because \`GET\` *promises* not to change state.

The rewrites of the wire format were forced by a change in how pages are built. HTTP/1.1 assumed
a document with a handful of images. A modern page pulls 80 resources from a dozen origins, and
HTTP/1.1's one-request-at-a-time-per-connection model made that pathological. HTTP/2 fixed it at
the application layer, then discovered that TCP itself was now the bottleneck, which is what
HTTP/3 and QUIC exist to solve.`
    },

    { t: 'h', text: 'Safe, idempotent, cacheable -- three different things' },
    {
      t: 'prose',
      md: `These are routinely conflated in interviews and they are genuinely distinct properties.

**Safe** means the request is read-only: it is not intended to change server state at all.
**Idempotent** means performing it N times has the same effect on server state as performing it
once. **Cacheable** means a response may be stored and reused for a later equivalent request.

The interesting consequence is that \`DELETE\` is idempotent but not safe -- deleting the same
resource twice leaves the same end state, but it definitely changed something. And \`PUT\` is
idempotent because it *replaces* the whole resource, so a duplicate write lands the same bytes,
while \`POST\` is neither safe nor idempotent because "append a new thing" run twice appends two
things. That single distinction is why retrying a \`POST\` is the most common source of duplicate
orders in production.

\`PATCH\` is the trap. It is not idempotent in general, because a patch body can express a relative
change -- \`{ "op": "increment", "path": "/balance", "value": 10 }\` applied twice adds twenty. A
patch expressed as absolute field values happens to be idempotent, but the method does not
promise it, so no intermediary may assume it.`
    },
    {
      t: 'table',
      title: 'Method properties, and what each implies for retries',
      cols: ['Method', 'Safe', 'Idempotent', 'Cacheable', 'Can a proxy retry it on timeout?'],
      rows: [
        ['`GET`', 'Yes', 'Yes', 'Yes', 'Yes, freely.'],
        ['`HEAD`', 'Yes', 'Yes', 'Yes', 'Yes.'],
        ['`OPTIONS`', 'Yes', 'Yes', 'No', 'Yes.'],
        ['`PUT`', 'No', 'Yes', 'No', 'Yes -- the same bytes land twice, same end state.'],
        ['`DELETE`', 'No', 'Yes', 'No', 'Yes -- second attempt returns 404 or 204, state is identical.'],
        ['`POST`', 'No', 'No', 'Only with explicit `Cache-Control`', '**No** -- needs an idempotency key to be retry-safe.'],
        ['`PATCH`', 'No', 'Not guaranteed', 'No', '**No** -- a relative patch applied twice is wrong.']
      ]
    },

    { t: 'h', text: 'Idempotency keys: the concrete pattern' },
    {
      t: 'prose',
      md: `A network timeout is ambiguous. The client does not know whether the request never
arrived, arrived and is still processing, or completed and the response was lost on the way back.
There is no way to distinguish these from the client, which means a client that retries on
timeout will sometimes duplicate a completed mutation. On a payments endpoint that is a real
customer being charged twice.

The fix is to make the *server* responsible for deduplication, by having the client supply a
unique key per logical operation. Stripe's \`Idempotency-Key\` header is the canonical
implementation and worth naming by name. The important details are in the edge cases: the server
must store the key *before* doing the work, must return the original response body for a repeat
of a completed key, must return a \`409\` for a repeat that is still in flight, and must reject a
repeat of the same key with a *different* request body, because that indicates a client bug
rather than a retry.`
    },
    {
      t: 'diagram',
      code: `sequenceDiagram
  participant C as Client
  participant S as Payments API
  participant D as Key store
  C->>S: POST /charges<br/>Idempotency-Key abc123
  S->>D: Claim abc123
  D-->>S: Claimed, new
  S->>S: Charge card, 4s
  Note over C: Client times out at 3s
  C->>S: Retry, same key abc123
  S->>D: Claim abc123
  D-->>S: In progress
  S-->>C: 409 retry after 2s
  C->>S: Retry, same key abc123
  S->>D: Claim abc123
  D-->>S: Completed, stored 201
  S-->>C: 201 with original body`,
      caption: 'The key is claimed before the work starts, so an in-flight duplicate is detectable rather than a race.'
    },
    {
      t: 'code',
      lang: 'http',
      title: 'Retry-safe mutation, wire level',
      code: `POST /v1/charges HTTP/2
Host: api.example.com
Idempotency-Key: 7f3a1c9e-4b2d-4c11-9f8e-2a6b5d0c1e33
Content-Type: application/json

{"amount": 4999, "currency": "usd", "source": "tok_visa"}

# --- first attempt completes server-side but response is lost ---
# --- client retries with the SAME key ---

HTTP/2 201 Created
Idempotency-Replayed: true
Content-Type: application/json

{"id": "ch_1P2q3r", "amount": 4999, "status": "succeeded"}

# Same key, DIFFERENT body -> this is a client bug, not a retry:
HTTP/2 422 Unprocessable Entity
{"error": "idempotency_key_reused_with_different_parameters"}`
    },
    {
      t: 'note',
      tone: 'danger',
      title: 'Retries without jitter are a self-inflicted DDoS',
      md: `When an API starts timing out, every client retries. If they all retry after exactly
1 s, 2 s, 4 s, the load arrives in synchronised waves that keep the service down long after the
original cause cleared -- a **retry storm**. Exponential backoff alone does not fix this; you need
**full jitter**, \`sleep = random(0, min(cap, base * 2^attempt))\`, so the waves spread out. Pair
it with a client-side **circuit breaker** that stops sending entirely after a failure threshold,
and a \`Retry-After\` header so the server can tell clients how long to wait. Never retry a 4xx --
it will fail identically and you are just amplifying load.`
    },

    { t: 'h', text: 'Status codes that carry real meaning' },
    {
      t: 'prose',
      md: `The classes are worth stating precisely because the boundary between 4xx and 5xx is a
routing decision for your on-call: 4xx means *the client sent something wrong, do not retry
unmodified*, and 5xx means *the server failed, a retry may succeed*. Getting that backwards is why
some dashboards page an engineer for user typos.`
    },
    {
      t: 'table',
      title: 'The codes you should be able to justify',
      cols: ['Code', 'Means', 'When you actually reach for it'],
      rows: [
        ['`201 Created`', 'New resource, `Location` header points at it.', 'Successful `POST` that created something. Not `200`.'],
        ['`202 Accepted`', 'Queued, not done.', 'Async job kicked off; return a status URL to poll.'],
        ['`204 No Content`', 'Success, deliberately empty body.', 'Successful `DELETE` or a `PUT` where echoing state is pointless.'],
        ['`304 Not Modified`', 'Your cached copy is still valid.', 'Response to a conditional request. Costs headers only, no body.'],
        ['`400` vs `422`', 'Malformed syntax vs syntactically valid but semantically invalid.', '`400` for broken JSON; `422` for a valid shape that fails business rules.'],
        ['`401` vs `403`', 'Not authenticated vs authenticated but not permitted.', '`401` invites a retry with credentials; `403` says do not bother.'],
        ['`409 Conflict`', 'State conflict.', 'Optimistic-concurrency failure, or a duplicate idempotency key still in flight.'],
        ['`412 Precondition Failed`', '`If-Match` did not match.', 'Lost-update prevention -- the resource changed under you.'],
        ['`428 Precondition Required`', 'Server refuses an unconditional write.', 'Forcing clients to send `If-Match` so blind overwrites are impossible.'],
        ['`429 Too Many Requests`', 'Rate limited.', 'Always pair with `Retry-After`; without it clients guess and guess badly.'],
        ['`503` + `Retry-After`', 'Temporarily unavailable.', 'Load shedding. Tells clients to back off rather than hammer.']
      ]
    },

    { t: 'h', text: 'Conditional requests and optimistic concurrency' },
    {
      t: 'prose',
      md: `A conditional request attaches a validator so the server can answer "nothing changed"
cheaply. \`ETag\` plus \`If-None-Match\` is the strong form -- an opaque token, usually a hash of the
representation. \`Last-Modified\` plus \`If-Modified-Since\` is the weak form, limited by one-second
granularity, which makes it useless for anything changing fast.

The same mechanism inverted gives you **optimistic concurrency control**, and this is the part
people miss. Send \`If-Match: "abc123"\` on a \`PUT\`, and the server applies the write only if the
resource still has that ETag; otherwise it returns \`412 Precondition Failed\`. That is
lost-update prevention with no locks and no coordination -- the last writer is forced to re-read
and re-decide rather than silently clobbering. If you want to *require* it, answer unconditional
writes with \`428 Precondition Required\`.

Also note weak versus strong ETags. \`ETag: W/"abc"\` marks the validator weak, meaning
"semantically equivalent but possibly not byte-identical". Weak validators are fine for cache
revalidation and are **not** usable for range requests or \`If-Match\`, because those need byte
identity.`
    },

    { t: 'h', text: 'The wire format: 1.1, 2, and 3' },
    {
      t: 'prose',
      md: `**HTTP/1.1** sends one request per connection at a time. Pipelining was specified but is
effectively dead because responses had to come back in request order, so one slow response
blocked the rest -- **application-layer head-of-line blocking**. Browsers worked around it by
opening up to six connections per origin, which is why domain sharding used to be a real
technique. Six connections also means six handshakes and six independent congestion windows, each
starting cold.

**HTTP/2** replaced the text protocol with binary **frames** carrying a stream ID, so many
requests and responses interleave over **one** connection. That kills application-layer HoL
blocking, removes the need for sharding, and adds **HPACK** header compression, which matters far
more than people expect -- a page with 80 requests each carrying 800 bytes of near-identical
cookie and user-agent headers pays about 64 KB of redundant header bytes on HTTP/1.1, and HPACK's
dynamic table reduces repeated headers to a few bytes each.

But HTTP/2 does **not** fix TCP-level head-of-line blocking, and this is the question that
separates a memorised answer from an understood one. TCP guarantees in-order delivery of one byte
stream. If a packet carrying frames for stream 5 is lost, the kernel holds back *every*
subsequently received byte -- including frames for streams 1 through 4 -- until the retransmission
arrives. At 2% packet loss a single HTTP/2 connection can perform worse than six HTTP/1.1
connections, because with six connections a loss only stalls one sixth of your traffic.

**HTTP/3** moves to **QUIC** over UDP and implements streams in user space, so each stream has
its own loss recovery. A lost packet stalls only its own stream. QUIC also merges the transport
and TLS handshakes into one round trip, supports 0-RTT resumption, and identifies connections by
a **connection ID** rather than the IP/port four-tuple -- which means a phone moving from wifi to
cellular keeps the connection instead of rebuilding it.`
    },
    {
      t: 'diagram',
      code: `flowchart TB
  subgraph One["HTTP/1.1"]
    A1["6 TCP connections<br/>1 request each at a time"]
  end
  subgraph Two["HTTP/2"]
    B1["1 TCP connection"] --> B2["Interleaved streams"]
    B2 --> B3["TCP still enforces<br/>in-order bytes"]
    B3 --> B4["One lost packet<br/>stalls all streams"]
  end
  subgraph Three["HTTP/3 over QUIC"]
    C1["1 UDP connection"] --> C2["Independent stream<br/>loss recovery"]
    C2 --> C3["Lost packet stalls<br/>only its stream"]
  end`,
      caption: 'HTTP/2 solved head-of-line blocking at the application layer and inherited it at the transport layer. QUIC is the fix.'
    },
    {
      t: 'table',
      title: 'Protocol comparison, practical view',
      cols: ['Property', 'HTTP/1.1', 'HTTP/2', 'HTTP/3 (QUIC)'],
      rows: [
        ['Connections per origin', 'Up to 6', '1', '1'],
        ['Concurrency', 'One response at a time per connection', 'Multiplexed streams', 'Multiplexed streams'],
        ['App-layer HoL blocking', 'Yes', 'No', 'No'],
        ['Transport HoL blocking', 'Per connection', '**Yes -- all streams**', 'No -- per stream'],
        ['Header compression', 'None', 'HPACK', 'QPACK'],
        ['Handshake RTTs to first byte', '2-3', '2 (TCP + TLS 1.3)', '1, or 0 with resumption'],
        ['Survives network change', 'No', 'No', 'Yes -- connection ID'],
        ['Server push', 'n/a', 'Specified, removed from Chrome', 'Replaced by `103 Early Hints`'],
        ['Works behind hostile middleboxes', 'Always', 'Usually', 'Sometimes -- UDP is blocked on some networks, needs TCP fallback']
      ]
    },
    {
      t: 'note',
      tone: 'info',
      title: 'Connection coalescing -- why "split your assets across subdomains" reversed',
      md: `If \`cdn.example.com\` and \`img.example.com\` resolve to the same IP and are covered by
the same TLS certificate (matching SAN or wildcard), a browser on HTTP/2 will **reuse one
connection** for both. That is coalescing, and it is why domain sharding went from best practice
to anti-pattern: under HTTP/1.1 sharding bought you more parallel connections, and under HTTP/2
it buys you extra handshakes and extra cold congestion windows for nothing. It also means the
certificate SAN list is quietly a performance decision.`
    },

    { t: 'h', text: 'Prioritisation, Early Hints, and compression' },
    {
      t: 'prose',
      md: `HTTP/2's original priority scheme was a dependency tree with weights, and it was
implemented inconsistently enough that Chrome effectively ignored server-provided priorities and
Firefox and Chrome built different trees. It has been superseded by **Extensible Prioritization**
(RFC 9218), a much simpler model with an urgency level 0-7 and an incremental flag, expressed in
a \`Priority\` header. On the client side the lever you actually have is
\`fetchpriority="high"\` on an image or script, and the implicit priorities the browser assigns --
a render-blocking stylesheet outranks an async script, which outranks an image below the fold.

**\`103 Early Hints\`** is the practical replacement for HTTP/2 server push. Push failed because
the server could not know what the client already had cached, so it routinely wasted bandwidth
pushing bytes the browser would discard. Early Hints inverts the control: the server sends an
informational \`103\` response with \`Link: rel=preload\` headers *while it is still generating the
real response*, and the client decides whether it needs those resources. On a page with 400 ms of
server think time, that is 400 ms of asset fetching you get for free.

On **compression**: brotli at quality 11 typically beats gzip -9 by 15-25% on JavaScript and
HTML, at a compression cost high enough that you only do it once at build time. Brotli at
quality 4-5 is the sensible choice for dynamic responses -- comparable speed to gzip with better
ratios. zstd is now negotiable in Chrome via \`Accept-Encoding: zstd\` and its selling point is
decompression speed, which is what matters on a low-end phone. All of them only help
*compressible* payloads -- re-compressing a JPEG or a WebP wastes CPU on both ends, which is why
you exclude image and video MIME types from your compression config.`
    },

    { t: 'h', text: 'CORS preflight, mechanically' },
    {
      t: 'prose',
      md: `CORS is a browser-enforced rule, not a server-side security control. The server always
receives and can always process the request; the browser decides whether to hand the *response*
to JavaScript. That framing kills a lot of confusion, including the common belief that CORS
protects your API. It does not -- \`curl\` ignores it entirely.

A request is "simple" and skips preflight if it uses \`GET\`, \`HEAD\` or \`POST\`, carries no
non-standard headers, and its \`Content-Type\` is one of \`application/x-www-form-urlencoded\`,
\`multipart/form-data\` or \`text/plain\`. Note what is missing: \`application/json\` is *not* on that
list, so essentially every modern API call triggers a preflight.

The preflight is an \`OPTIONS\` request that must complete before the real one, costing a full
round trip. \`Access-Control-Max-Age\` lets the browser cache the preflight result -- Chrome caps
it at 7200 seconds -- and setting it is one of the cheapest wins available on a cross-origin API.
The other detail worth knowing: with \`credentials: 'include'\` the server may not answer
\`Access-Control-Allow-Origin: *\`; it must echo the specific origin and send
\`Access-Control-Allow-Credentials: true\`, which in turn means you must \`Vary: Origin\` or your
CDN will serve one tenant's CORS headers to another.`
    },
    {
      t: 'code',
      lang: 'http',
      title: 'Preflight for a credentialed JSON POST',
      code: `OPTIONS /v1/orders HTTP/2
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type,x-request-id

HTTP/2 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: POST, PATCH, DELETE
Access-Control-Allow-Headers: content-type, x-request-id
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 7200
Vary: Origin

# Only now does the real POST go out. Without Max-Age you pay this
# extra round trip on every request -- ~200 ms each on a slow link.`
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      gains: [
        'HTTP/2 removes per-request handshakes and shrinks repeated headers to a few bytes with HPACK.',
        'HTTP/3 eliminates transport head-of-line blocking and survives wifi-to-cellular handoff.',
        'Idempotency keys make retries safe, which is what allows aggressive client timeouts.',
        'Conditional requests turn most revalidations into a header-only `304`.',
        '`103 Early Hints` recovers server think time as asset fetch time.'
      ],
      costs: [
        'A single HTTP/2 connection concentrates loss impact -- worse than HTTP/1.1 above ~2% loss.',
        'QUIC runs in user space, so it uses more CPU per byte and is blocked on some UDP-hostile networks.',
        'Idempotency keys require durable storage, TTL policy, and body-hash comparison to be correct.',
        'Brotli quality 11 is too slow for dynamic responses; you need a per-content-type policy.',
        'CORS preflights add a round trip to every JSON call unless `Access-Control-Max-Age` is set.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'Client retries `POST` on timeout with no idempotency key', blast: 'Duplicate orders and double charges; reconciliation work and refunds.', fix: 'Server-side `Idempotency-Key` claimed before work, replaying the stored response; `409` while in flight; `422` if the body differs.' },
        { mode: 'Synchronised exponential backoff across all clients', blast: 'Retry storm keeps the service down after the trigger clears.', fix: 'Full jitter, client circuit breakers, `Retry-After` on `429`/`503`, and never retry a 4xx.' },
        { mode: 'Validation errors returned as `500`', blast: 'On-call paged for user typos; real incidents lost in the noise; clients retry unretryable requests.', fix: '`400` for malformed, `422` for semantically invalid; alert on 5xx rate only and keep 4xx on a separate dashboard.' },
        { mode: 'Missing `Vary: Origin` on a CORS response behind a CDN', blast: 'Cached `Access-Control-Allow-Origin` for tenant A served to tenant B; the API appears randomly broken.', fix: '`Vary: Origin` on every dynamic CORS response, and an allowlist rather than reflecting whatever `Origin` arrives.' },
        { mode: 'HTTP/2 on a lossy mobile network', blast: 'p95 worse than HTTP/1.1 because one lost packet stalls all streams.', fix: 'Enable HTTP/3 with `Alt-Svc` and keep TCP fallback; measure p95 by protocol and network type in RUM, not just the mean.' },
        { mode: 'Domain sharding retained after the HTTP/2 migration', blast: 'Four extra DNS+TCP+TLS setups and four cold congestion windows on first paint.', fix: 'Consolidate onto one origin, or ensure shards share an IP and certificate SAN so the browser coalesces connections.' },
        { mode: 'Unconditional `PUT` from two concurrent editors', blast: 'Silent lost update -- the second save erases the first with no error anywhere.', fix: '`If-Match` with the current ETag, `412` on mismatch, and `428` to reject unconditional writes outright.' }
      ]
    },

    {
      t: 'staff',
      md: `The differentiator is connecting a protocol property to a business consequence, and
knowing which claims about HTTP/2 are actually false. Lines that land:

- "The client retries after a 3-second timeout, which means a slow-but-successful charge gets
  submitted twice. This is not a timeout tuning problem, it is a missing \`Idempotency-Key\`. The
  server should claim the key before doing the work and replay the stored response for a repeat."
- "HTTP/2 fixes head-of-line blocking at the application layer, not at the transport layer. TCP
  still delivers one ordered byte stream, so one lost packet stalls every multiplexed stream. On
  our Indonesian traffic at around 2% loss, that is why a single connection underperforms six."
- "\`PATCH\` is not idempotent, so we cannot let the gateway retry it. Either we make the patch
  bodies absolute rather than relative, or we require an idempotency key on \`PATCH\` too."
- "Exponential backoff without jitter just synchronises everyone into waves. We need full jitter
  plus a circuit breaker, and the server should be sending \`Retry-After\` so clients are not
  guessing."
- "We are returning \`500\` for validation failures, which means on-call gets paged for user typos
  and our error budget is meaningless. \`422\` for semantic failures, and alerts on 5xx only."
- "Before we optimise the API itself, set \`Access-Control-Max-Age: 7200\`. Every JSON call is
  paying a preflight round trip because \`application/json\` is not a simple content type. And
  \`Vary: Origin\`, or the CDN will cross-serve CORS headers between tenants."
- "I would not enable server push. It cannot know what the client already has cached, so it
  wastes bandwidth. \`103 Early Hints\` gives us the same benefit and lets the browser decide."

Each of these pairs a mechanism with a blast radius and a specific control. The strongest single
signal in this area is volunteering the TCP head-of-line caveat about HTTP/2 -- almost everyone
says "HTTP/2 solves head-of-line blocking" and stops there.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'Your gateway retries any request that times out after 2 s. Which endpoint is most likely to cause a customer-visible correctness bug?',
          options: [
            '`GET /v1/invoices/42`',
            '`PUT /v1/users/42/profile` with the full profile body',
            '`PATCH /v1/accounts/42` with `{"op":"increment","path":"/credits","value":50}`',
            '`DELETE /v1/sessions/abc`'
          ],
          answer: 2,
          why: '`GET` is safe, and both `PUT` (full replacement) and `DELETE` are idempotent -- running them twice leaves the same end state, so a blind retry is harmless. The relative `PATCH` is the outlier: applying an increment twice adds 100 credits instead of 50, and nothing in the protocol lets the gateway detect that. This is exactly why `PATCH` must not be in a gateway retry policy unless the patch semantics are absolute or an idempotency key is enforced.'
        },
        {
          q: 'You migrate from HTTP/1.1 to HTTP/2 and p50 latency improves, but p95 on mobile in a market with ~2% packet loss gets worse. What explains it?',
          options: [
            'HPACK compression fails on large cookies, forcing renegotiation.',
            'One TCP connection means a single lost packet blocks delivery of all multiplexed streams, whereas six connections isolated the damage.',
            'HTTP/2 disables TLS session resumption.',
            'Stream priorities starve the lowest-priority requests indefinitely.'
          ],
          answer: 1,
          why: 'HTTP/2 removed application-layer head-of-line blocking but runs over TCP, which guarantees in-order byte delivery. A lost segment makes the kernel buffer everything received after it, including frames belonging to completely unrelated streams, until retransmission arrives. Six HTTP/1.1 connections spread that risk so a loss only stalls one sixth of your traffic. The real fix is HTTP/3, where QUIC implements streams in user space with independent loss recovery -- which is why you should measure p95 by protocol and network type rather than trusting an aggregate improvement.'
        },
        {
          q: 'Two editors open the same document and save 10 seconds apart. The second save silently erases the first editor\'s changes. What is the minimal protocol-level fix?',
          options: [
            'Switch the save endpoint from `PUT` to `PATCH`.',
            'Have clients send `If-Match` with the ETag they loaded, and have the server return `412` when it does not match.',
            'Add a `Cache-Control: no-store` header to the document response.',
            'Add an `Idempotency-Key` to the save request.'
          ],
          answer: 1,
          why: 'This is a lost update, and conditional writes are the standard answer: the client proves which version it edited by sending `If-Match: "<etag>"`, and the server refuses with `412 Precondition Failed` if the resource has moved on, forcing a re-read and a merge decision. `PATCH` narrows the blast radius for non-overlapping fields but still loses concurrent edits to the same field. An idempotency key solves duplicate submission of *the same* operation, which is a different problem. If you want to make unconditional writes impossible, answer them with `428 Precondition Required`.'
        },
        {
          q: 'Why did HTTP/2 server push get removed from Chrome in favour of `103 Early Hints`?',
          options: [
            'Push was incompatible with TLS 1.3.',
            'The server cannot know what the client already has cached, so pushed bytes were frequently discarded; Early Hints lets the client choose.',
            'Push required a second TCP connection.',
            'Early Hints compresses better under HPACK.'
          ],
          answer: 1,
          why: 'Push put the decision on the wrong side. A server pushing `app.css` has no reliable view of the browser cache, so on repeat visits it spends bandwidth -- and competes with the critical path -- on bytes that get thrown away. Cache digests were proposed and never shipped. `103 Early Hints` sends `Link: rel=preload` headers during server think time and leaves the fetch decision with the browser, which does know its own cache. You get the same latency win on cold loads with no waste on warm ones.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `Handshake round trips and 0-RTT are in **Web Foundations: URL to Pixels**. The
caching directives that make \`304\` and \`stale-while-revalidate\` work are in **CDN & Edge
Delivery** and **The Caching Stack**. Error contracts, pagination and schema evolution build on
these semantics in **API Contracts & the BFF**. Idempotent mutation is load-bearing for
**Offline-First & Sync**.`
      }]
    }
  ],

  flashcards: [
    { q: 'Safe vs idempotent -- what is the difference?', a: 'Safe means read-only, no intended state change (`GET`, `HEAD`, `OPTIONS`). Idempotent means N identical requests leave the same state as one. `DELETE` and `PUT` are idempotent but not safe. `POST` is neither; `PATCH` is not guaranteed idempotent.' },
    { q: 'Why is `PATCH` not idempotent?', a: 'A patch body can express a relative change -- increment a counter, append to a list -- and applying it twice compounds. An absolute-value patch happens to be idempotent, but the method makes no such promise, so no proxy or gateway may retry it.' },
    { q: 'How does an idempotency key work, including the edge cases?', a: 'Client sends a unique key per logical operation. Server claims the key *before* doing work; a repeat of a completed key replays the stored response, a repeat while in flight returns `409`, and the same key with a different body returns `422` because that is a client bug, not a retry.' },
    { q: 'Does HTTP/2 solve head-of-line blocking?', a: 'Only at the application layer. TCP still delivers one ordered byte stream, so one lost packet stalls every multiplexed stream on that connection. Above roughly 2% loss a single HTTP/2 connection can be worse than six HTTP/1.1 ones. HTTP/3 over QUIC fixes it with per-stream loss recovery.' },
    { q: 'What is connection coalescing?', a: 'If two hostnames resolve to the same IP and are covered by the same certificate, an HTTP/2 browser reuses one connection for both. It is why domain sharding became an anti-pattern -- extra hostnames now cost handshakes and cold congestion windows instead of buying parallelism.' },
    { q: 'What makes a CORS request "simple", and why does it rarely matter?', a: '`GET`/`HEAD`/`POST`, no custom headers, and `Content-Type` limited to form-urlencoded, multipart, or text/plain. `application/json` is excluded, so nearly every modern API call triggers an `OPTIONS` preflight -- a full extra round trip unless `Access-Control-Max-Age` is set.' },
    { q: 'Why does `Vary: Origin` matter on CORS responses?', a: 'Without it a shared cache stores one origin\'s `Access-Control-Allow-Origin` value and serves it to requests from other origins, so the API appears to fail intermittently for some tenants. Combined with credentialed requests -- which forbid `*` -- it is a correctness requirement, not a tuning knob.' },
    { q: '`412` vs `428` -- when do you use each?', a: '`412 Precondition Failed` answers a conditional write whose `If-Match` ETag no longer matches, preventing a lost update. `428 Precondition Required` rejects a write that arrived with *no* precondition at all, which is how you make blind overwrites impossible by policy.' },
    { q: 'Why did server push lose to `103 Early Hints`?', a: 'The server cannot see the client cache, so push wasted bandwidth on assets the browser already had and competed with the critical path. Early Hints sends `Link: rel=preload` during server think time and lets the browser, which knows its own cache, decide whether to fetch.' }
  ],

  drills: [
    {
      prompt: 'A checkout service processes roughly 800 requests per second. During a 90-second database failover, clients time out and retry; afterwards support reports about 1,200 duplicate charges and the service stayed degraded for 15 minutes after the database recovered. Design the fix, client and server side.',
      probes: [
        'Which of those two problems is a correctness bug and which is a capacity bug?',
        'Where exactly does the duplicate come from, given the first request succeeded?',
        'How does the server distinguish a legitimate retry from a genuine second purchase?',
        'Why did it stay degraded after the database came back?',
        'What would you put in place so this is detectable next time before support notices?'
      ],
      strong: [
        'Separates the two failures: duplicate charges are a missing-idempotency correctness bug, the 15-minute tail is a retry storm capacity bug.',
        'Explains that a timeout is ambiguous -- the client cannot tell "never arrived" from "succeeded, response lost" -- so client-side dedup is impossible in principle.',
        'Specifies the server contract precisely: `Idempotency-Key` claimed before the charge, stored response replayed on repeat, `409` while in flight, `422` on same-key-different-body, and a TTL on the key store (24h is the common choice).',
        'Notes that the key must be generated per logical user intent -- once when the user clicks Pay, not regenerated per retry attempt.',
        'Fixes the tail with full jitter (`random(0, min(cap, base * 2^n))`), a client circuit breaker, `Retry-After` on `503`, and server-side load shedding that returns `503` quickly rather than queuing.',
        'Adds observability: duplicate-key replay rate, retry rate as a share of total requests, and an alert on retry amplification rather than just error rate.'
      ],
      weak: [
        'Proposes longer client timeouts as the primary fix.',
        'Says "make the endpoint idempotent" without describing the key lifecycle or the in-flight case.',
        'Suggests exponential backoff and does not mention jitter.',
        'Puts deduplication in the client.',
        'Cannot explain why the service stayed down after the root cause cleared.'
      ]
    },
    {
      prompt: 'You own a widely embedded JSON API. p75 latency from browsers is 340 ms but your server-side p75 is 40 ms, and the gap is larger in Brazil and India. The API is on `api.example.com` while the embedding apps are on many customer domains. Where is the 300 ms and what do you change?',
      probes: [
        'What network work happens before your server sees the request?',
        'Does the content type matter here?',
        'What is the risk of the obvious fix?',
        'How would you validate the improvement given you cannot instrument customer pages?'
      ],
      strong: [
        'Identifies the CORS preflight immediately: `application/json` is not a simple content type, so every call is an `OPTIONS` round trip first.',
        'Adds `Access-Control-Max-Age: 7200` and notes Chrome caps it at 7200 s, so higher values are wasted.',
        'Names the cold-connection cost too -- DNS + TCP + TLS on a cross-origin host -- and proposes edge TLS termination plus `preconnect` guidance for embedders.',
        'Flags `Vary: Origin` as mandatory given a CDN and many customer origins, and rejects reflecting arbitrary `Origin` in favour of an allowlist.',
        'Mentions that credentialed requests forbid `Access-Control-Allow-Origin: *`, so the echo-plus-Vary pattern is required rather than optional.',
        'Validates with a RUM beacon in the embedded SDK reporting `PerformanceResourceTiming` split into DNS/connect/TLS/wait, segmented by country.'
      ],
      weak: [
        'Blames "network latency" without naming the preflight.',
        'Sets `Access-Control-Allow-Origin: *` with credentials and does not notice the browser will reject it.',
        'Omits `Vary: Origin` while putting the API behind a CDN.',
        'Proposes HTTP/3 as the answer without accounting for the extra round trip that is actually an `OPTIONS` request.'
      ]
    }
  ]
};
