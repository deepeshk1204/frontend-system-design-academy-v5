export default {
  blocks: [
    {
      t: 'prose',
      md: `Realtime means the server can tell the browser that something changed without the browser
having to ask. HTTP was not designed for that -- a client requests, a server responds, the exchange
ends -- so every realtime technique is a way of keeping a channel open, or of asking so often that
it feels open.

The choice between those techniques matters less than people expect. What actually decides whether
your realtime feature works is the boring half: what happens when the connection drops on a train,
whether a message delivered twice corrupts your state, and what your app does when 40,000 clients
reconnect in the same second because a load balancer was replaced.`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `Start with the naive alternative and cost it out. A dashboard polls \`GET /notifications\`
every 5 seconds. With 50,000 concurrent users that is 10,000 requests per second, each carrying
full headers and cookies -- call it 1.5 kB up and 300 bytes down -- and on a typical day 99% of
those responses say nothing changed. You are burning roughly 15 MB/s of upstream bandwidth and a
meaningful fraction of your API capacity to transfer nothing, and the user still waits up to 5
seconds to see a change.

Push inverts it. One connection stays open and bytes flow only when something happens. The cost
moves from request volume to *connection state*: 50,000 sockets your gateway must hold, keep alive,
authenticate, and re-establish correctly after any disruption. That is a genuinely different
operational problem, not a strictly better one, which is why polling is still the right answer more
often than realtime enthusiasts admit.`
    },

    { t: 'h', text: 'The five options, and how to choose' },
    {
      t: 'table',
      title: 'Transport decision table',
      cols: ['Transport', 'Direction', 'Real cost', 'Reconnection', 'Choose it when'],
      rows: [
        ['**Short polling**', 'Client pulls', 'Full request overhead per tick; mostly empty responses.', 'Trivial -- there is no connection to lose.', 'Updates matter at 30 s granularity or worse, or the change rate is very low. Genuinely the right default more often than people think.'],
        ['**Long polling**', 'Client pulls, server holds', 'One held request per client; a new request per message.', 'Trivial, and it is the built-in fallback pattern.', 'You need push-like latency but are stuck behind a proxy that mangles upgrades. Still a real answer for hostile corporate networks.'],
        ['**SSE**', 'Server to client only', 'One long-lived HTTP response per client. Text only.', '**Built in.** The browser auto-reconnects and replays `Last-Event-ID` for you.', 'One-way streams: notifications, live scores, deploy logs, and token-by-token LLM output. Underrated.'],
        ['**WebSocket**', 'Bidirectional', 'One TCP connection per client, ~2-14 bytes of frame overhead per message.', '**You build it.** No retry, no resume, no heartbeat unless you write them.', 'Genuine bidirectional chat at sub-second latency: collaborative editing, cursors, trading, multiplayer.'],
        ['**WebTransport**', 'Bidirectional, over HTTP/3', 'QUIC streams plus optional unreliable datagrams; no head-of-line blocking.', 'You build it, with better primitives.', 'You need unordered or unreliable delivery -- position updates, voice, game state -- and can accept Safari gaps and a fallback path in 2026.']
      ]
    },
    {
      t: 'note',
      tone: 'warn',
      title: 'SSE and the HTTP/1.1 connection limit',
      md: `Browsers cap concurrent connections per origin at 6 on HTTP/1.1. An SSE stream holds one
of those six for its entire lifetime, so a user with three tabs open has consumed half the budget
and your ordinary API calls start queueing behind them. Over HTTP/2 the streams are multiplexed on
one connection and the practical limit rises to around 100 concurrent streams, so the problem
largely evaporates.

Two takeaways. Do not ship SSE without HTTP/2 end to end -- including through every proxy in the
path, since one HTTP/1.1 hop reimposes the limit. And open **one** stream shared across tabs via a
\`SharedWorker\` or a \`BroadcastChannel\` leader election, rather than one per tab.

The same property makes SSE excellent for LLM token streaming: it is one-way, text-framed, has a
defined event format, reconnects on its own, and needs no client library. The OpenAI and Anthropic
streaming APIs are SSE for exactly these reasons.`
    },
    {
      t: 'code',
      lang: 'js',
      title: 'SSE, including the part people forget',
      code: `// Server: the headers are the whole protocol.
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',  // no-transform stops proxies buffering
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no'                   // nginx: do not buffer this response
});
// A comment line every 15 s keeps idle proxies and load balancers from
// closing a stream they believe is dead. Costs 3 bytes.
const hb = setInterval(() => res.write(': hb\\n\\n'), 15000);
res.write('id: 10427\\nevent: notification\\ndata: {"kind":"mention"}\\n\\n');

// Client: reconnection and replay are free.
const es = new EventSource('/api/stream');
es.addEventListener('notification', e => apply(JSON.parse(e.data)));
// On drop, the browser reconnects with Last-Event-ID: 10427 after a
// server-suggested retry delay, so the server resumes from the gap.
// EventSource gives you no way to send data up -- that is the trade.`
    },

    { t: 'h', text: 'Connection lifecycle: the part that is actually the work' },
    {
      t: 'prose',
      md: `A WebSocket that works on your laptop tells you almost nothing. The connection will
drop -- a phone switches from Wi-Fi to LTE, a proxy hits an idle timeout, a gateway is redeployed --
and your correctness depends entirely on what happens next.

Naive reconnection is the classic self-inflicted outage. If every client retries immediately, then
a gateway restart means all 40,000 clients reconnect within the same second, your auth service
takes 40,000 token validations at once, half of them fail under load, and those clients retry
again. You have built a synchronised retry storm, and the system cannot recover without shedding
load.

Three ingredients fix it. **Exponential backoff** so each failure doubles the wait. **Jitter** so
clients desynchronise -- full jitter, meaning a random value between zero and the current ceiling,
not a fixed delay plus a small random amount. And a **resume token** so reconnecting is cheap: the
client sends the last sequence number it processed, and the server replays only the gap instead of
sending a full state snapshot to 40,000 clients simultaneously.`
    },
    {
      t: 'diagram',
      code: `stateDiagram-v2
  [*] --> Connecting
  Connecting --> Open: handshake plus auth ok
  Connecting --> Backoff: error or timeout
  Open --> Resuming: pong missed twice
  Open --> Backoff: close code not 1000
  Resuming --> Open: server replays gap after lastSeq
  Resuming --> Resync: gap too large or token expired
  Resync --> Open: full snapshot then resume
  Backoff --> Connecting: wait rand 0..min 30s, 2 to the n
  Backoff --> Offline: navigator.onLine false
  Offline --> Connecting: online event
  Open --> [*]: clean close 1000`,
      caption: 'Resuming and Resync are different states. Collapsing them means every reconnect costs a full snapshot, which is what turns a gateway restart into an outage.'
    },
    {
      t: 'code',
      lang: 'js',
      title: 'Full jitter, heartbeat, and resume in about 40 lines',
      code: `const MAX = 30000;
let attempt = 0, lastSeq = 0, ws, pongTimer;

function backoff() {
  // Full jitter: uniform in [0, min(MAX, base * 2^attempt)).
  // "delay + random(0..1s)" still synchronises the fleet — the mass stays clumped.
  const ceiling = Math.min(MAX, 500 * 2 ** attempt++);
  return Math.random() * ceiling;
}

async function connect() {
  // Fetch a short-lived ticket per attempt. Never put a bearer token in the
  // URL — it lands in access logs and referrers.
  const ticket = await getSocketTicket();
  ws = new WebSocket('wss://rt.acme.com/v1?ticket=' + ticket + '&since=' + lastSeq);

  ws.onopen = () => { attempt = 0; heartbeat(); };

  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.type === 'pong') return heartbeat();
    if (m.seq <= lastSeq) return;          // idempotent: drop replays
    if (m.seq > lastSeq + 1) return resync(); // gap detected: do not apply out of order
    lastSeq = m.seq;
    apply(m);
  };

  // 1000 is a clean close. Anything else is a reason to come back.
  ws.onclose = e => {
    clearTimeout(pongTimer);
    if (e.code !== 1000) setTimeout(connect, backoff());
  };
}

function heartbeat() {
  clearTimeout(pongTimer);
  // App-level ping/pong. Browsers expose no API for protocol-level pings,
  // and TCP will happily hold a socket open that is functionally dead.
  pongTimer = setTimeout(() => {
    ws.send(JSON.stringify({ type: 'ping' }));
    pongTimer = setTimeout(() => ws.close(4000, 'pong_timeout'), 5000);
  }, 20000);
}

addEventListener('online', () => { if (ws.readyState > 1) connect(); });`
    },

    { t: 'h', text: 'Ordering and idempotent application' },
    {
      t: 'prose',
      md: `A single WebSocket connection preserves order, because it is one TCP stream. Almost
everything else in your system does not.

Reconnect and you may receive a replayed message you already applied. Your gateway fans out from
multiple backend publishers, so two events about the same entity can arrive in the order the
*publishers* raced, not the order the changes happened. And if you ever fall back to polling
alongside a socket, you have two delivery paths with no shared ordering at all.

So make every message carry a monotonic \`seq\` from a single ordering authority, and have the
client do three things on receipt: drop anything at or below \`lastSeq\`, apply anything exactly one
above it, and treat a gap as a signal to resync rather than an invitation to apply out of order.
Resync means fetching a snapshot with its own sequence number and resuming from there.

The other half is making application itself idempotent. Prefer messages that state a *fact* --
"item 42 is now in state \`shipped\`, version 7" -- over messages that describe a *delta* --
"increment the badge". Applying a fact twice is harmless. Applying a delta twice is a bug, and it is
the bug that produces a notification badge reading 3 when there is one unread item.`
    },

    { t: 'h', text: 'Presence, fanout and backpressure' },
    {
      t: 'prose',
      md: `**Presence** looks trivial and is not, because a browser tab does not reliably tell
anyone it is leaving. \`beforeunload\` does not fire on a crash, a force-quit, or a tab discarded by
a low-memory mobile OS. So presence must be *lease-based*: a client is online because it renewed
recently, not because it announced itself. Heartbeat every 20-30 seconds, expire a presence record
after 2-3 missed beats, and store it with a TTL in something like Redis so the state self-cleans
when a whole gateway dies. Presence derived from a set someone has to remember to remove from will
accumulate ghosts forever.

**Fanout** is the gateway's real job. A client subscribing to \`document:9f2\` does not get its own
backend subscription; the gateway maintains a topic-to-connections map and each backend event is
written once per interested socket. With 50,000 connections across 5 gateway nodes, a broadcast to
a 10,000-member topic means each node writes to the 2,000 sockets it happens to hold -- which is
why gateways are memory- and syscall-bound rather than CPU-bound, and why you scale them
horizontally behind a shared pub/sub bus rather than vertically.

**Backpressure** runs in both directions and most implementations ignore both.`
    },
    {
      t: 'grid',
      cols: 2,
      items: [
        { b: 'Server to slow client', md: 'A backgrounded tab or a client on a weak link stops draining. The OS send buffer fills and the gateway buffers in user space -- 10,000 slow clients at 1 MB of queued messages each is 10 GB and an OOM. Cap the per-connection queue, and on overflow drop the connection with a close code that means "reconnect and resync" rather than growing forever.' },
        { b: 'Client to server', md: 'Check `ws.bufferedAmount` before sending. If it is climbing, your messages are queueing locally, not in flight. Coalesce -- one cursor position per animation frame instead of one per `mousemove`, which is a 60x reduction -- and drop stale intermediate states rather than delivering a backlog of positions nobody cares about.' },
        { b: 'Subscription multiplexing', md: 'Open one socket and multiplex logical subscriptions over it with a framing envelope carrying a channel id. Six sockets for six widgets costs six handshakes, six auth checks and six reconnect storms. Route on the client by channel.' },
        { b: 'Render backpressure', md: 'A 200-message burst must not be 200 React renders. Buffer incoming messages and flush on a `requestAnimationFrame` or a 50 ms timer, applying them as one batched state update. Otherwise the main thread is the bottleneck and your UI freezes while it is "working".' }
      ]
    },

    { t: 'h', text: 'Auth on a connection that outlives its token' },
    {
      t: 'prose',
      md: `HTTP auth is per request, so an expired token produces a 401 on the next call and you
refresh. A WebSocket is authenticated once at handshake and then lives for hours. If your access
token has a 15-minute lifetime, what happens at minute 16?

The browser \`WebSocket\` constructor accepts no custom headers, which rules out
\`Authorization: Bearer\`. Putting the token in the query string works but writes a credential into
gateway access logs, so if you do it, use a **single-use, short-lived ticket** -- 30 seconds,
one connection -- minted by an authenticated HTTP call and exchanged at handshake. A leaked ticket
is worth almost nothing.

For the long-lived session itself, the workable pattern is re-authentication *over* the connection:
the client refreshes its token through the normal HTTP path and sends an \`auth.renew\` message with
the new one; the gateway updates the connection's identity and expiry. And the gateway must
actually enforce it -- if the connection's credential expires without renewal, close with a
specific code so the client knows to re-authenticate rather than blindly retry.

Authorisation is the harsher half. A user whose access to a document is revoked at 10:03 keeps
receiving updates over a socket authorised at 09:00 unless something invalidates it. That needs a
revocation signal on the pub/sub bus that the gateway acts on by dropping the relevant
subscriptions. It is easy to overlook and it is a data-exposure bug, not a freshness bug.`
    },
    {
      t: 'table',
      title: 'Infrastructure timeouts that will close your connection',
      cols: ['Layer', 'Typical default', 'What you see', 'What to do'],
      rows: [
        ['AWS ALB idle timeout', '60 s', 'Connections die exactly every 60 s with close code 1006.', 'Raise it to 300-3600 s *and* heartbeat well inside it. Both, not either.'],
        ['nginx `proxy_read_timeout`', '60 s', 'Same clean-looking periodic drop.', 'Set to 3600 s on the realtime path; also set `proxy_http_version 1.1` and clear `Upgrade`/`Connection` headers correctly.'],
        ['nginx response buffering', 'On', 'SSE arrives in bursts or never -- but works locally.', '`X-Accel-Buffering: no` plus `Cache-Control: no-transform`.'],
        ['Corporate proxy / captive portal', 'Varies; often strips upgrades', 'WebSocket fails only for some enterprise customers.', 'Keep a long-polling or SSE fallback and pick it after two failed upgrade attempts.'],
        ['Mobile OS background', 'Sockets suspended in seconds', 'Silent death with no close event until foreground.', 'Reconnect on `visibilitychange` to visible and always resync by sequence rather than trusting continuity.'],
        ['Browser backgrounded tab', 'Timers throttled to ~1 per minute', 'Heartbeat stops firing, so the server reaps the connection.', 'Accept it: close the socket on hide after a grace period, reconnect and resume on show. Do not fight the throttle.']
      ]
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      gains: [
        'Sub-second update latency instead of half the polling interval on average.',
        'Bandwidth proportional to actual change rather than to client count times poll rate.',
        'Server-initiated interactions become possible at all: presence, cursors, typing indicators.',
        'One multiplexed connection replaces N polling loops across N widgets.'
      ],
      costs: [
        'Stateful connections, so gateway deploys disconnect everyone and horizontal scaling needs a pub/sub bus.',
        'You own reconnection, ordering, resume and heartbeat -- none of which HTTP made you think about.',
        'Auth and authorisation must be revalidated on a connection that outlives its token.',
        'Harder to debug: no request log per message, and failures are intermittent and network-dependent.',
        'A whole class of load-balancer, proxy and mobile-background behaviour becomes your problem.',
        'A reconnect storm can take down your auth path, so capacity planning must cover the thundering herd, not the steady state.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'Reconnect with no backoff or jitter', blast: 'A gateway restart synchronises 40,000 clients into a retry storm that keeps the system down.', fix: 'Full jitter -- uniform in [0, min(30 s, 500 ms × 2^n)) -- plus a server-side connection-rate limit as a second line of defence.' },
        { mode: 'No resume token', blast: 'Every reconnect requests a full snapshot; a mass reconnect becomes a self-inflicted load spike on the data path.', fix: 'Monotonic `seq` per message, `since=lastSeq` at handshake, server replays only the gap from a bounded buffer.' },
        { mode: 'Load balancer idle timeout below heartbeat interval', blast: 'Connections drop on a precise cadence and look like a mysterious network problem.', fix: 'Heartbeat at 20-30 s, raise the idle timeout to 300 s or more, and alert on close-code distribution -- 1006 clustering is the tell.' },
        { mode: 'Delta messages applied twice after replay', blast: 'Corrupted local state -- badge counts and balances that drift and never self-correct.', fix: 'Send facts with versions rather than increments, and drop any message at or below `lastSeq`.' },
        { mode: 'Unbounded per-connection send queue', blast: 'Slow clients grow gateway memory until the node OOMs, dropping every connection it held.', fix: 'Cap the queue, then disconnect with a resync close code. Alert on queue depth per connection.' },
        { mode: 'Presence tracked by explicit leave events', blast: 'Ghost users accumulate forever; "12 people viewing" when there is one.', fix: 'Lease-based presence with a heartbeat-renewed TTL; expire after 2-3 missed beats.' },
        { mode: 'Authorisation never revalidated', blast: 'A user who lost document access keeps streaming updates for hours -- a data-exposure incident.', fix: 'Publish revocation events on the bus; gateway drops affected subscriptions and forces re-auth.' },
        { mode: 'One socket per widget', blast: 'Six handshakes, six auth checks and six reconnect loops per user; connection limits hit on mobile.', fix: 'One multiplexed connection with a channel-id envelope, shared across tabs via `SharedWorker`.' }
      ]
    },

    {
      t: 'staff',
      md: `The tell for a Staff-level answer is that the transport choice takes thirty seconds and
the failure behaviour takes the rest of the conversation.

- "First, does this need to be realtime? If a 30-second delay is acceptable, polling with
  \`ETag\` and a 304 is dramatically cheaper to operate and cannot have a reconnect storm."
- "It is one-way, so I would use SSE rather than WebSocket. The browser handles reconnection and
  replays \`Last-Event-ID\` for free, which is the exact code I would otherwise have to write and
  test. The condition is HTTP/2 end to end, because on HTTP/1.1 each stream eats one of six
  connections per origin."
- "Reconnection uses full jitter -- uniform between zero and \`min(30 s, 500 ms × 2^n)\`. Delay plus
  a small random offset still leaves the fleet clumped, and the failure I am designing against is
  40,000 clients hitting auth in the same second after a gateway redeploy."
- "Every message carries a monotonic sequence number. On reconnect the client sends
  \`since=lastSeq\` and the server replays the gap. Without that, a mass reconnect turns into 40,000
  full snapshots, which is a bigger outage than the one that caused it."
- "Messages are facts with versions, not deltas, so applying one twice is harmless. That is what
  makes at-least-once delivery survivable on the client."
- "Heartbeat at 20 seconds and I want the ALB idle timeout raised to 300. Both -- the heartbeat
  proves liveness end to end and the timeout stops the infrastructure reaping a healthy connection.
  I would alert on the close-code distribution, because a spike in 1006 is a proxy problem, not an
  application problem."
- "Authorisation gets revalidated on the live connection. A user who loses access at 10:03 must
  stop receiving updates at 10:03, which means a revocation event on the bus that drops their
  subscriptions."

Naming full jitter, resume tokens, the backgrounded-tab timer throttle, and the close-code
distribution as a signal all say the same thing: you have run one of these in production.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'You are building a live deploy-log viewer: server streams text, client sends nothing. What transport?',
          options: [
            'WebSocket, since it is the general realtime answer.',
            'SSE, because it is one-way and gives reconnection with `Last-Event-ID` replay for free.',
            'Long polling, for maximum proxy compatibility.',
            'WebTransport, for lowest latency.'
          ],
          answer: 1,
          why: 'The traffic is one-way and text, which is precisely SSE\'s shape, and the browser\'s built-in reconnect-and-replay is the code you would otherwise write, test and get subtly wrong. Choosing WebSocket here means hand-rolling backoff, heartbeat and resume for no benefit. The condition to check is HTTP/2 end to end, since an HTTP/1.1 hop reimposes the six-connections-per-origin limit.'
        },
        {
          q: 'Your gateway is redeployed and stays down for eight minutes after coming back. Logs show auth service saturation. What is the most likely bug?',
          options: [
            'Heartbeat interval is too short.',
            'Clients reconnect immediately, or with a fixed delay plus small jitter, so the fleet retries in lockstep.',
            'The load balancer idle timeout is too low.',
            'Messages are not idempotent.'
          ],
          answer: 1,
          why: 'This is a synchronised retry storm. Every client was disconnected at the same instant, so any near-uniform retry delay keeps them clumped and each wave re-saturates auth, which causes more failures and more retries. Full jitter -- a uniform random value between zero and the growing ceiling -- spreads the fleet across the window. Pair it with a server-side connection-rate limit, because you cannot trust every client version in the wild to behave.'
        },
        {
          q: 'After a reconnect, users report their unread badge is wrong -- sometimes double the real count.',
          options: [
            'The WebSocket delivered messages out of order.',
            'Replayed messages were applied again because the updates are increments rather than versioned facts.',
            'The heartbeat is racing the badge update.',
            'Two sockets are open.'
          ],
          answer: 1,
          why: 'At-least-once replay after reconnect is normal and expected. An `increment badge` message applied twice permanently corrupts the count with no path back to correctness. A message saying `unread = 3, version 118` is naturally idempotent -- applying it twice is a no-op -- and combined with dropping anything at or below `lastSeq` it makes duplicate delivery a non-event. Two sockets would double *live* messages too, not only after reconnect.'
        },
        {
          q: 'A backgrounded tab keeps getting reaped by the server as dead even though the user has not left. Why?',
          options: [
            'Browsers close WebSockets when a tab is hidden.',
            'Background timers are throttled to roughly one per minute, so the heartbeat stops firing inside the server\'s expiry window.',
            'The access token expired.',
            '`navigator.onLine` flipped to false.'
          ],
          answer: 1,
          why: 'Hidden tabs have their timers heavily throttled -- typically around one execution per minute -- so a 20-second heartbeat simply does not run, and the server correctly concludes the client is gone. Fighting the throttle is not an option. The right design is to accept it: close the socket after a grace period on `visibilitychange` to hidden, then reconnect and resume by sequence number when the tab becomes visible again.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `The sequence-number and resync machinery here is the same machinery that drives
**Offline-First & Sync**, where the gap can be hours rather than seconds. **Collaborative Editing:
OT & CRDT** builds directly on a bidirectional socket and adds a convergence model on top.
Batching bursts into one render per frame is a main-thread problem from **Performance
Engineering**, and a socket that outlives its token is an authorisation question belonging to
**Frontend Security**.`
      }]
    }
  ],

  flashcards: [
    { q: 'When is SSE the better choice than WebSocket?', a: 'When traffic is one-way server-to-client and text: notifications, live logs, LLM token streams. You get automatic reconnection with `Last-Event-ID` replay for free, provided you have HTTP/2 end to end.' },
    { q: 'Why does SSE need HTTP/2?', a: 'On HTTP/1.1 browsers allow six connections per origin and each SSE stream holds one for its lifetime, so a few tabs starve your normal API calls. HTTP/2 multiplexes streams on one connection, raising the practical limit to around 100.' },
    { q: 'What is full jitter and why not fixed-delay-plus-random?', a: 'Full jitter picks a uniform random delay in [0, min(cap, base × 2^n)). Adding a small random offset to a fixed delay leaves the fleet clumped, so each retry wave still arrives together and re-saturates the service.' },
    { q: 'What is a resume token for?', a: 'So a reconnecting client can say `since=lastSeq` and receive only the gap. Without it every reconnect costs a full snapshot, and a mass reconnect after a gateway restart becomes a bigger outage than the restart.' },
    { q: 'Why prefer facts over deltas in realtime messages?', a: 'Delivery is at-least-once, so replays happen. Applying `unread = 3, version 118` twice is a no-op; applying `increment unread` twice permanently corrupts state with no path back to correct.' },
    { q: 'Why must presence be lease-based?', a: 'Browsers do not reliably announce departure -- no `beforeunload` on a crash, force-quit or OS tab discard. So online means "renewed a TTL recently"; expire after 2-3 missed heartbeats or you accumulate ghosts forever.' },
    { q: 'Both directions of WebSocket backpressure?', a: 'Server side: cap the per-connection send queue and disconnect with a resync code, or slow clients OOM the gateway. Client side: check `ws.bufferedAmount`, coalesce to one message per frame, and drop stale intermediate states.' },
    { q: 'How do you authenticate a WebSocket without headers?', a: 'Mint a single-use ticket valid for about 30 seconds over authenticated HTTP and exchange it at handshake, so the credential in the URL and access logs is nearly worthless. Then renew over the connection with an `auth.renew` message.' },
    { q: 'Why do connections drop exactly every 60 seconds?', a: 'A default idle timeout -- AWS ALB and nginx `proxy_read_timeout` are both 60 s. Heartbeat inside the window *and* raise the timeout; a cluster of close code 1006 is the diagnostic signal.' }
  ],

  drills: [
    {
      prompt: 'Design the realtime layer for a customer-support console. 8,000 agents are logged in at once, each watching a queue of about 30 conversations plus presence for their team. A new message must appear within a second. Agents work from home on variable connections and from offices behind corporate proxies.',
      probes: [
        'How many connections per agent, and what is on each one?',
        'What happens when you redeploy the gateway during a shift?',
        'An agent\'s laptop sleeps for 40 minutes. What do they see on wake?',
        'A corporate proxy strips the WebSocket upgrade. Now what?',
        'An agent is removed from a team at 10:03. When do they stop seeing its conversations?'
      ],
      strong: [
        'One multiplexed WebSocket per agent with a channel-id envelope, shared across tabs via a `SharedWorker`, rather than one socket per conversation.',
        'Full jitter backoff with a 30 s cap, plus a server-side connection-rate limit, sized for 8,000 simultaneous reconnects rather than steady state.',
        'Monotonic sequence numbers with `since=lastSeq` resume, and an explicit resync path with a snapshot when the gap exceeds the server buffer -- which is the 40-minute-sleep case.',
        'Lease-based presence with a 20-30 s heartbeat and TTL expiry after 2-3 missed beats.',
        'A long-polling or SSE fallback selected after two failed upgrade attempts, with a metric tracking fallback rate by customer.',
        'A revocation event on the pub/sub bus that drops the agent\'s subscriptions immediately, treating it as a data-exposure risk rather than a freshness one.',
        'Batches incoming bursts into one render per frame so a 200-message catch-up does not freeze the console.'
      ],
      weak: [
        'One WebSocket per conversation, so 30 sockets per agent.',
        'Immediate reconnect, or backoff with no jitter.',
        'Full state refetch on every reconnect with no gap replay.',
        'Presence based on explicit join and leave messages.',
        'No fallback transport, so enterprise customers are simply broken.',
        'Authorisation checked only at handshake and never revalidated.'
      ]
    }
  ]
};
