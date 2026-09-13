export default {
  blocks: [
    {
      t: 'prose',
      md: `You type a URL and press Enter. Somewhere between 300 milliseconds and four seconds
later you are looking at a page. This topic is about what happens in that gap, in order, with
the cost of each step attached.

It matters because almost every frontend performance decision is really a decision about one of
these steps -- how many round trips you pay, how many of them you can avoid, and which ones you
can overlap. If you cannot name the steps, you end up optimising the one that is already fast.`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `The web was designed for a world where a document lived on one machine and a reader
lived on another, possibly on a different continent, over a link that might drop packets. Every
layer in the stack exists to solve one problem in that world.

DNS exists because humans remember \`github.com\` and routers only understand \`140.82.121.4\`.
TCP exists because IP delivers packets out of order, duplicated, or not at all, and applications
wanted a reliable byte stream. TLS exists because the network path between you and the server
includes routers owned by people you have never met. HTTP exists because everyone needed one
agreement about what a request and a response look like.

The uncomfortable part is that each layer costs *round trips*, and a round trip is bounded by
physics. Light in fibre moves at roughly 200,000 km/s, about two-thirds of \`c\`, which works out
to about 200 km per millisecond. Mumbai to Virginia is roughly 13,000 km of cable, so the
theoretical one-way floor is about 65 ms and real-world RTT lands near 200 ms once you add
switching, queuing and non-great-circle routing. No amount of clever code beats that. You only
get to choose how many times you pay it.`
    },

    { t: 'h', text: 'The full trace, URL to pixels' },
    {
      t: 'diagram',
      code: `sequenceDiagram
  participant B as Browser
  participant R as DNS resolver
  participant E as Edge server
  participant O as Origin
  B->>B: Parse URL, check HSTS + caches
  B->>R: A/AAAA query for app.example.com
  R-->>B: 203.0.113.9 with TTL
  B->>E: TCP SYN
  E-->>B: SYN-ACK
  B->>E: ACK + TLS ClientHello
  E-->>B: ServerHello + Finished
  B->>E: GET / with HTTP/2 headers
  E->>O: Cache miss, forward
  O-->>E: 200 text/html
  E-->>B: First byte, then stream
  B->>B: Parse, subresources, render`,
      caption: 'Three separate network phases before a single byte of HTML: name resolution, transport setup, and the request itself.'
    },
    {
      t: 'steps',
      ordered: true,
      title: 'What the browser actually does',
      items: [
        '**Parse and normalise the URL.** Scheme, host, port, path, query, fragment. The fragment never leaves the browser. The browser also checks its **HSTS** list here -- if the host is on it, an \`http://\` URL is upgraded to \`https://\` internally with no network request and no redirect.',
        '**Resolve the name.** Consult, in order: the in-process DNS cache, the OS resolver cache, then the configured recursive resolver. Only a full miss walks root, TLD and authoritative servers.',
        '**Open a transport connection.** TCP three-way handshake, one RTT. Over QUIC this merges with the crypto handshake.',
        '**Negotiate TLS.** One RTT on TLS 1.3, two on 1.2. ALPN in the ClientHello is where \`h2\` or \`h3\` is chosen, so protocol selection is free -- it rides the handshake you were already paying for.',
        '**Send the request.** One RTT to first byte at best, plus however long the server takes to produce it. This is the server-think part of TTFB.',
        '**Stream and parse the HTML.** The parser discovers subresources as bytes arrive and starts fetching them before the document is complete. This is why where you put a \`<script>\` still matters.',
        '**Build the render tree, lay out, paint, composite.** Covered in *Browser & Rendering Pipeline*.'
      ]
    },

    { t: 'h', text: 'DNS and its four caching layers' },
    {
      t: 'prose',
      md: `DNS resolution is almost never a full recursive walk, and that is the whole point. There
are four places an answer can already be sitting, and each one you hit removes a network hop.

The browser keeps its own cache -- Chrome's is small and holds entries for around 60 seconds
regardless of the record TTL, which surprises people. Below that the OS resolver caches per the
TTL. Below that your recursive resolver -- your ISP, or \`8.8.8.8\`, or \`1.1.1.1\` -- caches for
the TTL and serves millions of users, so popular names are essentially always warm there. Only
a miss at every level triggers the recursive walk: root server for the TLD nameservers, TLD
server for the authoritative nameservers, authoritative server for the record.

That walk is three sequential round trips in the worst case, and on a cold mobile connection it
is routinely 100-300 ms of pure latency before you have even opened a socket. The mitigations
worth knowing: \`<link rel="dns-prefetch">\` to resolve a third-party host early,
\`<link rel="preconnect">\` to do DNS *and* TCP *and* TLS early, and a TTL choice that is a real
trade-off -- 60 seconds gives you fast failover for traffic steering, 86,400 seconds gives you
a near-perfect cache hit rate and a bad afternoon during a region evacuation.`
    },
    {
      t: 'table',
      title: 'Where a DNS answer comes from',
      cols: ['Layer', 'Typical lookup cost', 'Respects record TTL?', 'What it means for you'],
      rows: [
        ['Browser cache', '~0 ms', 'No -- Chrome pins to roughly 60s', 'You cannot force a browser to re-resolve mid-session; plan failover at the connection layer too.'],
        ['OS resolver cache', '<1 ms', 'Yes', 'A machine that has visited the host recently pays nothing.'],
        ['Recursive resolver', '5-50 ms', 'Yes', 'Popular hostnames are effectively always cached here. Your own rare hostnames are not.'],
        ['Authoritative walk', '100-300 ms', 'Sets the TTL', 'The cold-start cost a first-time mobile user actually pays.'],
        ['`dns-prefetch` / `preconnect`', 'Moved off critical path', 'n/a', 'Turns a blocking cost into a parallel one. Budget it -- each `preconnect` holds a real socket.']
      ]
    },
    {
      t: 'note',
      tone: 'info',
      title: 'Anycast is why this is not worse',
      md: `Recursive resolvers and CDN edges both advertise the *same* IP address from hundreds of
physical locations, and BGP routes each client to the topologically nearest one. \`1.1.1.1\` is
not a server, it is an address announced from over 300 cities. This is how a single global IP
gives you a 5 ms lookup in Frankfurt and a 5 ms lookup in São Paulo, and it is also why
"the IP responded, so the service is up" is not a statement you can make globally -- one
Anycast site can be broken while every other one is fine.`
    },

    { t: 'h', text: 'TCP: the handshake and the slow start you forgot about' },
    {
      t: 'prose',
      md: `The three-way handshake -- SYN, SYN-ACK, ACK -- costs one RTT before you may send
application data. That part is well known. The part people forget is **congestion control**.

TCP does not know how much bandwidth is available, so it probes. A new connection starts with a
congestion window of about 10 segments, roughly 14 KB, and doubles each RTT while acknowledgements
keep arriving. So a 60 KB HTML document does not arrive in one flight over a fresh connection: it
takes 14 KB, then 28 KB, then 56 KB -- three round trips of *transfer* on top of the setup, purely
because the connection has not yet earned the right to send faster.

Two consequences that should change how you design. First, getting critical content under
roughly 14 KB genuinely matters for first paint, because it fits the initial window. Second,
**connection reuse is worth more than compression on small responses**: a warm connection has
already grown its window and skipped both handshakes, so the tenth request on a connection is
dramatically cheaper than the first. This is the mechanical reason HTTP/2's single multiplexed
connection beats HTTP/1.1's six cold ones, and the reason \`preconnect\` to a third-party origin
you will definitely use is one of the highest-leverage hints available.`
    },

    { t: 'h', text: 'TLS 1.3, and what 0-RTT really buys' },
    {
      t: 'prose',
      md: `TLS 1.2 needed two round trips: ClientHello/ServerHello, then key exchange and Finished.
TLS 1.3 cut that to one by having the client *guess* the key-exchange group and send its key
share in the very first message. The server picks from what was offered and replies with
everything needed, so application data flows after one RTT. Combined with the TCP handshake, a
fresh HTTPS connection is two RTTs before the request goes out -- at 200 ms RTT that is 400 ms
of nothing.

Session resumption removes the TLS RTT entirely for a returning client: the server issues a
pre-shared key ticket, and on the next connection the client sends the PSK identity plus, if
enabled, **0-RTT early data** -- the actual HTTP request riding along with the handshake's first
flight. First byte can then arrive one RTT after connection start.

The catch is real and you should say it out loud in an interview: 0-RTT early data is
**replayable**. An attacker who captures the early-data flight can resend it, and the server has
no handshake-completion context to reject it with. Therefore 0-RTT is safe for idempotent
requests -- \`GET\` of a cacheable resource -- and unsafe for anything that mutates state. Cloudflare
and others only permit 0-RTT on \`GET\` requests without cookies for exactly this reason. QUIC has
the same property, which is why \`POST\` over an 0-RTT QUIC connection is normally deferred to the
1-RTT phase.`
    },
    {
      t: 'numbers',
      title: 'Round trips to first byte',
      items: [
        { v: '3 RTT', k: 'Cold TCP + TLS 1.2 + request', note: 'The legacy path' },
        { v: '2 RTT', k: 'Cold TCP + TLS 1.3 + request', note: 'Today\'s default' },
        { v: '1 RTT', k: 'QUIC 1-RTT, or resumed TLS 1.3', note: 'Handshake merged' },
        { v: '0 RTT', k: 'QUIC 0-RTT early data', note: 'Idempotent requests only' }
      ]
    },

    { t: 'h', text: 'The latency budget' },
    {
      t: 'prose',
      md: `Here is the same page load at three network profiles. The point of the table is not the
exact milliseconds -- they vary by device and route -- it is the *shape*: on a fast connection your
server time dominates, and on a slow one your round-trip count dominates. Those two situations call
for completely different fixes, and most teams apply the fix for the profile their laptops have.`
    },
    {
      t: 'table',
      title: 'Time to first byte, by network profile',
      cols: ['Phase', 'Same-region fibre (RTT 10 ms)', 'Cross-continent (RTT 150 ms)', '4G mobile, cold (RTT 70 ms + radio)'],
      rows: [
        ['DNS (cached)', '~0 ms', '~0 ms', '~0 ms'],
        ['DNS (cold recursive)', '~25 ms', '~180 ms', '~150 ms'],
        ['Radio wake-up', '0 ms', '0 ms', '~100-500 ms'],
        ['TCP handshake', '10 ms', '150 ms', '70 ms'],
        ['TLS 1.3 handshake', '10 ms', '150 ms', '70 ms'],
        ['Request to first byte', '10 ms + server', '150 ms + server', '70 ms + server'],
        ['**Total before HTML**', '**~55 ms + server**', '**~630 ms + server**', '**~460-860 ms + server**']
      ]
    },
    {
      t: 'note',
      tone: 'warn',
      title: 'The mobile radio tax nobody budgets for',
      md: `On cellular, an idle radio must be promoted to a connected state before any packet
leaves the device. On LTE this is typically 100-500 ms, and on a congested network it can be
worse. It happens **before** your first RTT, it does not appear in any server-side metric, and
it is the single largest reason lab numbers on office wifi understate real mobile TTFB. It is
also why a background poll every 10 seconds destroys battery life -- each poll pays the promotion
and then holds the radio in a high-power tail state for seconds afterwards.`
    },
    {
      t: 'code',
      lang: 'html',
      title: 'Resource hints, in decreasing order of aggression',
      code: `<!-- Full DNS + TCP + TLS to an origin you will definitely use.
     Costs a real socket. Use for 1-3 origins, no more. -->
<link rel="preconnect" href="https://api.example.com" crossorigin>

<!-- DNS only. Cheap. Good for third parties you might use. -->
<link rel="dns-prefetch" href="https://analytics.vendor.com">

<!-- Fetch now at high priority because this is in the LCP path.
     'as' is mandatory: it sets priority and the Accept header. -->
<link rel="preload" href="/fonts/inter-var.woff2" as="font"
      type="font/woff2" crossorigin>

<!-- Tell the server what is coming while it is still thinking (103). -->
# Server response, before the 200:
HTTP/2 103 Early Hints
link: </assets/app.a91f.js>; rel=preload; as=script`
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      gains: [
        'Understanding round-trip count tells you which optimisations can possibly help.',
        'Connection reuse and HTTP/2 coalescing remove entire handshakes, not milliseconds.',
        'Short DNS TTLs give you real traffic-steering and failover control.',
        'TLS 1.3 plus resumption makes encryption nearly free on repeat visits.'
      ],
      costs: [
        'Every extra origin you talk to is a fresh DNS + TCP + TLS bill.',
        'Short DNS TTLs raise resolver query volume and cold-lookup frequency.',
        '0-RTT trades replay safety for one round trip -- only acceptable for idempotent requests.',
        '`preconnect` to origins you never use wastes sockets and competes with the critical path.',
        'None of this is visible in server metrics, so you need RUM to see it at all.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'Third-party origin sprawl', blast: 'Each of 12 origins costs a cold DNS+TCP+TLS on first paint; mobile LCP degrades by seconds.', fix: 'Inventory origins in CI and fail the build past a threshold. Self-host fonts. `preconnect` only the 2-3 that are truly critical.' },
        { mode: 'DNS TTL set to 86400 for agility, then a region fails', blast: 'Failover DNS change takes up to a day to propagate; browsers pin longer still.', fix: 'TTL of 30-60s on user-facing records, plus health-checked Anycast or a load balancer so failover does not depend on DNS at all.' },
        { mode: '0-RTT enabled for all methods', blast: 'A captured `POST` is replayed; a payment or write executes twice.', fix: 'Restrict early data to safe methods at the edge. Enforce server-side idempotency keys for anything that mutates.' },
        { mode: 'Critical CSS over 14 KB', blast: 'First paint waits an extra round trip or two for the congestion window to grow.', fix: 'Inline only above-the-fold CSS, keep the first flight under ~14 KB compressed, defer the rest.' },
        { mode: 'Redirect chains on the entry URL', blast: '`http://x` to `https://x` to `https://www.x` is two extra full connection setups before any HTML.', fix: 'Preload HSTS, canonicalise to one host at the DNS/edge layer, and never redirect across origins on the landing path.' },
        { mode: 'Optimising server time when RTT dominates', blast: 'Weeks of backend work moves p75 LCP by 40 ms because the user pays 800 ms in setup.', fix: 'Break TTFB into DNS / connect / TLS / wait using `PerformanceNavigationTiming` and fix the largest slice.' }
      ]
    },

    {
      t: 'staff',
      md: `The tell at this level is whether you reason in *round trips* rather than milliseconds.
Sentences that land:

- "Before we optimise the server we should split TTFB with \`PerformanceNavigationTiming\` --
  \`domainLookupEnd - domainLookupStart\`, \`connectEnd - connectStart\`, and
  \`responseStart - requestStart\`. If connect and TLS are 400 ms of an 800 ms TTFB, the backend
  is not the problem and terminating TLS at an edge is."
- "We are on TLS 1.3, so a cold connection is two round trips before the request. At our p75
  RTT of 140 ms that is 280 ms we can only remove by moving termination closer, not by making
  the origin faster."
- "I would enable 0-RTT for \`GET\` only. Early data is replayable by design, so allowing it on
  \`POST\` means an attacker can re-run a mutation, and the server has no handshake context to
  reject it with."
- "Our DNS TTL is 60 seconds, but Chrome pins its own cache to about a minute independently, so
  DNS alone is not a failover mechanism. Real failover has to happen behind a health-checked
  Anycast address."
- "That homepage talks to nine origins. Each one is a fresh handshake on a cold mobile
  connection. Self-hosting the two font origins removes four round trips from first paint."

What each of these signals: you have looked at a real waterfall, you know which costs are
physics and which are choices, and you understand that a security property (replay) can be the
reason a performance feature is off.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'A user in Sydney loads your US-hosted page. RTT is 200 ms, the server takes 50 ms to render. TTFB is measured at roughly 650 ms. What is the biggest single win available?',
          options: [
            'Optimise the server render from 50 ms to 20 ms.',
            'Terminate TLS at an edge PoP near Sydney so the handshake round trips are local.',
            'Enable brotli instead of gzip on the HTML.',
            'Lower the DNS TTL so resolvers refresh faster.'
          ],
          answer: 1,
          why: 'Three of those 650 ms are round trips: TCP, TLS 1.3, and the request itself -- 600 ms of the 650. Server time is 50 ms, so even making it instant wins under 8%. Terminating TLS at a nearby PoP turns two of the three round trips into ~5 ms local ones; only the final origin fetch still crosses the Pacific, and a cache hit removes even that. Compression affects transfer, not setup, and DNS TTL affects freshness, not latency.'
        },
        {
          q: 'Why is TLS 1.3 0-RTT early data restricted to safe methods in practice?',
          options: [
            'Early data is sent unencrypted, so it would leak request bodies.',
            'Early data can be captured and replayed, and the server cannot distinguish a replay from the original.',
            'The congestion window is too small to carry a POST body.',
            'Browsers do not implement 0-RTT for POST.'
          ],
          answer: 1,
          why: 'Early data is encrypted, but it is sent before the handshake gives the server forward-secrecy and freshness guarantees for that flight, so an on-path attacker can replay the bytes verbatim and the server has nothing to reject them with. That is harmless for a cacheable `GET` and dangerous for a transfer or an order. The defence pairing is: allow 0-RTT only on safe methods at the edge, and enforce idempotency keys server-side so a replay of any mutation is a no-op.'
        },
        {
          q: 'Your critical CSS is 42 KB after compression and inlined in the HTML head. Why might splitting it hurt less than you expect and inlining hurt more?',
          options: [
            'Inlined CSS is never cached, so it is always slower.',
            'A new TCP connection can only send ~14 KB in its first flight, so 42 KB takes about three round trips of transfer before first paint.',
            'HTTP/2 refuses to stream responses above 32 KB.',
            'Brotli cannot compress inlined CSS.'
          ],
          answer: 1,
          why: 'TCP slow start begins at an initial congestion window of roughly 10 segments -- about 14 KB -- and doubles per RTT. A 42 KB first flight therefore needs 14 KB, then 28 KB: two extra round trips before the browser has the styles it needs to paint. At 150 ms RTT that is 300 ms of first paint you bought by inlining. The fix is to inline only genuinely above-the-fold rules and keep the initial document under the first window.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `The round trips described here are exactly what **CDN & Edge Delivery** removes by
moving termination closer. Multiplexing, priority and QUIC get their own treatment in
**HTTP, HTTP/2 & HTTP/3**. What happens after the HTML arrives is **Browser & Rendering
Pipeline**. And turning \`PerformanceNavigationTiming\` into a number you can defend in a
review is **Performance Engineering**.`
      }]
    }
  ],

  flashcards: [
    { q: 'How many round trips before the first request byte on a cold TLS 1.3 connection?', a: 'Two -- one for the TCP handshake, one for TLS 1.3. TLS 1.2 needs three total. QUIC merges transport and crypto into one, and resumption with 0-RTT can reach zero for safe methods.' },
    { q: 'Why does the initial TCP congestion window matter to first paint?', a: 'A fresh connection may only send about 10 segments (~14 KB) before waiting for acknowledgements, doubling each RTT. Anything critical above ~14 KB costs additional round trips of pure transfer.' },
    { q: 'Difference between `dns-prefetch`, `preconnect` and `preload`?', a: '`dns-prefetch` resolves the name only. `preconnect` does DNS + TCP + TLS and holds a socket. `preload` actually fetches a specific resource and requires an `as` attribute to set priority and the `Accept` header.' },
    { q: 'Why is 0-RTT early data unsafe for `POST`?', a: 'The early-data flight is replayable -- an on-path attacker can resend it and the server has no handshake freshness context to reject it. Safe for idempotent `GET`; mutations need either 1-RTT or server-side idempotency keys.' },
    { q: 'What is Anycast and what does it break?', a: 'One IP address advertised from many physical sites, with BGP routing each client to the nearest. It gives global low-latency from a single address, but it also means "the IP is up" says nothing about whether a specific site is healthy.' },
    { q: 'Which DNS cache ignores your record TTL?', a: 'The browser\'s. Chrome pins entries to roughly 60 seconds regardless of TTL, so DNS changes alone cannot be relied on for fast failover -- you need health-checked Anycast or a load balancer behind a stable address.' },
    { q: 'What is the mobile radio promotion tax?', a: 'On cellular an idle radio must be promoted to connected before any packet is sent -- typically 100-500 ms on LTE. It precedes your first RTT, never appears in server metrics, and is the main reason lab TTFB understates real mobile TTFB.' },
    { q: 'Where is the HTTP protocol version actually chosen?', a: 'In ALPN, carried inside the TLS ClientHello. The client offers `h2`, `http/1.1` (and advertises `h3` via `Alt-Svc` or DNS HTTPS records) and the server picks, so negotiation costs no extra round trip.' }
  ],

  drills: [
    {
      prompt: 'Your p75 TTFB in India is 1.4 s while your US p75 is 180 ms. The origin is a single region in us-east-1 and server-side render time is a steady 60 ms at p95. You have two weeks. Walk me through how you find the real cost and what you change.',
      probes: [
        'How do you decompose that 1.4 s without guessing?',
        'Which parts are physics and which are choices?',
        'What do you do about the parts you cannot move?',
        'How do you prove the change worked, given your laptops are all in the US?'
      ],
      strong: [
        'Splits TTFB with `PerformanceNavigationTiming` into DNS, connect, TLS and wait, and reports each at p75 per country.',
        'Identifies that server time is 60 ms of 1400 ms, so backend work is capped at ~4% and deprioritises it explicitly.',
        'Names TLS termination at an edge PoP as the fix for the two setup round trips, and edge caching or a regional read replica for the request round trip.',
        'Mentions the mobile radio promotion tax and that it will not disappear, so budgets around it.',
        'Ships RUM segmented by country and device class before the change so the delta is measurable, and treats lab numbers as directional only.'
      ],
      weak: [
        'Jumps to "optimise the backend" or "add more caching" without decomposing TTFB.',
        'Cannot say how many round trips a cold HTTPS connection costs.',
        'Proposes lowering DNS TTL as a latency fix.',
        'Measures success on a local Lighthouse run from a US office.',
        'Suggests multi-region write capability as the first step without noting the consistency cost.'
      ]
    },
    {
      prompt: 'A payments team wants 0-RTT enabled at the edge because it removes a round trip from their checkout API and their p95 is over budget. Their endpoint is `POST /v1/charges`. What do you tell them, and what would make it acceptable?',
      probes: [
        'What exactly is the risk, mechanically?',
        'Who is the attacker and what do they need?',
        'Is there a version of this you would approve?',
        'What round trip could you remove instead?'
      ],
      strong: [
        'Explains replay concretely: the early-data flight has no handshake freshness guarantee, so captured bytes can be resent and the server cannot tell.',
        'Refuses 0-RTT on the mutating method rather than hedging, and restricts early data to safe methods at the edge.',
        'Offers the real alternative: server-side idempotency keys, so a duplicate charge request is a no-op and retries become safe generally, not just under 0-RTT.',
        'Points out the connection is likely already warm for a returning user, so the RTT they want back may only exist on the first request of a session.',
        'Redirects the latency work to connection reuse, `preconnect` to the payments origin during checkout entry, and edge TLS termination.'
      ],
      weak: [
        'Approves it because "TLS 1.3 is encrypted, so it is fine".',
        'Blocks it with "it is insecure" and cannot describe the replay mechanism.',
        'Does not mention idempotency keys at all.',
        'Assumes 0-RTT applies to every request rather than only resumed connections.'
      ]
    }
  ]
};
