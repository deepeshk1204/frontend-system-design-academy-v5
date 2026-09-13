export default {
  blocks: [
    {
      t: 'prose',
      md: `Resilience engineering is the discipline of deciding, in advance and in code, what your
system does when a dependency is slow. Not down -- *slow*. A dependency that returns errors
instantly is easy: you notice, you fall back, you move on. A dependency that takes 30 seconds to
answer is the one that kills you, because every caller politely waits, holding a thread, a
connection and a queue slot, until the whole fleet is full of requests nobody is waiting for.

The patterns here -- timeout budgets, jittered retries with budgets, circuit breakers, bulkheads,
load shedding, backpressure -- are all answers to one question: *how does this system stay
partially useful when part of it is not?*`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `A distributed system has a property that a single process does not: it can enter a state
where it stays broken after the original trigger has gone away. This is a **metastable failure
mode**, and it is the reason resilience needs designing rather than reacting.

The mechanism is a feedback loop. Load rises, latency rises, clients time out and retry, retries
increase offered load, latency rises further. Now remove the original cause -- the slow database
query, the brief network blip. The system does not recover, because the retry traffic is now the
load. You have two stable states, a healthy one and a broken one, and a sufficiently large
perturbation moves you between them permanently. Recovery requires an *external* intervention:
shedding load, restarting clients, or blocking traffic at the edge.

The networking equivalent is **congestion collapse** -- the 1986 NSFNET episode where throughput
fell by a factor of a thousand because every dropped packet was retransmitted, and the fix
(Jacobson's congestion control) is fundamentally what backpressure means in an application. The
lesson transfers exactly: a system that responds to overload by generating more work has no stable
operating point under stress.`
    },
    {
      t: 'diagram',
      code: `stateDiagram-v2
  [*] --> Healthy
  Healthy --> Stressed: latency rises
  Stressed --> Healthy: trigger removed
  Stressed --> Metastable: clients begin retrying
  Metastable --> Metastable: retries sustain the load
  note right of Metastable
    Trigger is gone.
    System stays broken.
    Only load shedding
    or a client restart exits.
  end note
  Metastable --> Healthy: shed load, then ramp back`,
      caption: 'The arrow that does not exist is Metastable back to Healthy on its own. That absence is why load shedding is a design requirement rather than an incident tactic.'
    },

    {
      t: 'numbers',
      title: 'Defaults worth arguing about',
      items: [
        { v: '10%', k: 'Retry budget as a share of successful traffic', note: 'Envoy `retry_budget`; stops storms automatically' },
        { v: '1.6x', k: 'Offered load at a 20% failure rate with 3 retries', note: 'At the moment capacity is lowest' },
        { v: '243', k: 'Attempts from 3 retries at 5 layers deep', note: 'Why you retry at exactly one layer' },
        { v: 'p99.9', k: 'The percentile a leaf timeout comes from', note: 'A p50 timeout means a 50% error rate' },
        { v: '~2 s', k: 'Sensible bound on queue depth, in work', note: 'Deeper means everything queued has expired' }
      ]
    },

    { t: 'h', text: 'Timeout budgets that shrink down the chain' },
    {
      t: 'prose',
      md: `A timeout is a statement about how long you are willing to wait. If every service in a
chain states its own independently, the numbers multiply and the total is unbounded from the user's
point of view. The only coherent design is an absolute **deadline** set at the edge and decremented
at each hop, with each service reserving a slice for its own overhead.

Two rules make it work. A downstream timeout must always be *strictly less* than the remaining
budget, otherwise the caller gives up first and the callee keeps working for nobody. And any
retry must fit inside the remaining budget too -- a 2-second timeout with 3 attempts inside a
1-second budget is not a retry policy, it is a guarantee of failure plus wasted capacity.`
    },
    {
      t: 'diagram',
      code: `flowchart TB
  U["User: 1000 ms<br/>perceived limit"] --> E["Edge: budget 900 ms"]
  E --> G["Gateway: 850 ms<br/>timeout to Orders 800"]
  G --> O["Orders: 780 ms"]
  O --> P["Pricing: 200 ms<br/>1 retry of 90 ms"]
  O --> I["Inventory: 200 ms<br/>parallel with Pricing"]
  O --> D[("Postgres<br/>statement_timeout 150 ms")]
  O --> R["Reserve 120 ms<br/>serialise and return"]`,
      caption: 'Every number is smaller than the one above it, and the leaf timeouts plus the reserve fit inside the parent. If any leaf timeout exceeds its parent budget, that hop can never be observed succeeding.'
    },
    {
      t: 'table',
      title: 'Deriving a timeout instead of picking one',
      cols: ['Layer', 'Rule', 'Worked value'],
      rows: [
        ['User-perceived limit', 'From the product requirement', '1,000 ms'],
        ['Edge budget', 'Perceived limit minus client RTT and render', '900 ms'],
        ['Per-hop timeout', 'Remaining budget minus a reserve for your own response', 'Gateway allows Orders 800 ms'],
        ['Leaf call timeout', 'p99.9 of that dependency, not its p50 -- then sanity-check it fits', 'Pricing p99 is 35 ms, so 200 ms is generous and bounded'],
        ['Retry budget', 'Total attempts must fit the remaining budget', '2 attempts x 90 ms = 180 ms, inside the 200 ms slice'],
        ['Database', '`statement_timeout` from the remaining budget', '`SET LOCAL statement_timeout = 150`'],
        ['Connection acquire', 'Bounded and separate from query time', '50 ms acquire timeout -- fail fast rather than block']
      ]
    },
    {
      t: 'note',
      tone: 'warn',
      md: `Set the leaf timeout from the dependency's **p99.9, not its p50**, and then check it fits
the budget. A timeout at p50 turns normal variance into a 50% error rate. A timeout of 30 seconds
means you have no timeout at all, because you will be out of threads long before it fires -- with
100 threads and a 30-second timeout, a single stuck dependency takes you down in the time it takes
to receive 100 requests.`
    },

    { t: 'h', text: 'Retries: only when safe, only with jitter, only within budget' },
    {
      t: 'prose',
      md: `Retries are the highest-leverage and most dangerous tool here. They convert transient
failures into successes -- and a naive retry policy is the most reliable way to turn a partial
degradation into a full outage.

The arithmetic is unforgiving. A service at capacity starts failing 20% of requests. Clients retry
up to 3 times. Offered load is now up to 1.6x what it was, at exactly the moment capacity is lowest.
More requests fail, more are retried, and the multiplier climbs. This is a **retry storm**, and it
is the standard path into the metastable state.

Three rules, and all three are necessary.

**Only retry idempotent operations.** A \`GET\` is always safe. A \`POST\` is safe only if it
carries an idempotency key the server honours. And a **timeout is not a failure** -- it is an
unknown outcome, so retrying a timed-out non-idempotent write is how you double-charge a customer.

**Use exponential backoff with full jitter.** Without jitter, a thousand clients that failed
together retry together, producing a synchronised thundering herd at each backoff boundary. Full
jitter -- \`sleep = random(0, min(cap, base * 2^attempt))\` -- spreads them across the whole
interval. AWS published the comparison: full jitter dramatically reduces both total work and
completion time versus plain exponential backoff and versus "equal jitter" variants.

**Cap the total retry rate with a budget.** This is the rule most often missing. Rather than
allowing N retries per request, allow retries to be at most a small fraction -- 10% is a common
figure -- of successful request volume, tracked in a token bucket. When a dependency is broadly
failing, the budget empties and retries stop automatically, which is precisely the behaviour you
want: retry aggressively for an isolated blip, not at all for a systemic failure. Envoy implements
this as \`retry_budget\`, and gRPC's retry policy has \`retryThrottling\` for the same reason.`
    },
    {
      t: 'code',
      lang: 'javascript',
      title: 'Full jitter plus a retry budget',
      code: `// The budget: retries may be at most 10% of successful traffic.
class RetryBudget {
  constructor({ ratio = 0.1, minPerSec = 3, ttlSec = 10 }) {
    this.ratio = ratio; this.minPerSec = minPerSec; this.ttlSec = ttlSec;
    this.tokens = minPerSec * ttlSec;
  }
  onSuccess() {
    this.tokens = Math.min(this.tokens + this.ratio,
                           this.minPerSec * this.ttlSec);
  }
  tryWithdraw() {
    if (this.tokens < 1) return false;    // dependency is broadly failing
    this.tokens -= 1;
    return true;
  }
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

async function callWithRetry(fn, { attempts = 3, base = 50, cap = 1000,
                                   deadline, budget, idempotent }) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw lastErr ?? new DeadlineExceeded();

    try {
      return await fn(Math.min(remaining, cap));
    } catch (err) {
      lastErr = err;

      // A timeout is an UNKNOWN outcome, not a failure. Never replay a
      // non-idempotent write on unknown.
      if (!idempotent) throw err;
      if (err.status && !RETRYABLE_STATUS.has(err.status)) throw err;
      if (i === attempts - 1) throw err;
      if (!budget.tryWithdraw()) {
        metrics.increment('retry.budget_exhausted');
        throw err;                         // systemic failure: stop retrying
      }

      // Full jitter. Honour Retry-After if the server told us.
      const hinted = err.retryAfterMs;
      const wait = hinted ?? Math.random() * Math.min(cap, base * 2 ** i);
      if (wait >= deadline - Date.now()) throw err;   // no room left
      await sleep(wait);
    }
  }
  throw lastErr;
}`
    },
    {
      t: 'note',
      tone: 'danger',
      title: 'Retry amplification through layers',
      md: `Retries multiply through a call chain. If the gateway retries 3 times, and each of its
calls retries 3 times, and the innermost service retries 3 times against the database, one user
request can become **27** database queries. Every layer independently looks reasonable. The rule is
to retry at **exactly one layer** -- usually the one closest to the failure that knows whether the
operation is idempotent -- and to make every other layer pass failures straight through.`
    },

    { t: 'h', text: 'Circuit breakers' },
    {
      t: 'prose',
      md: `A circuit breaker is a state machine that stops you calling something that is clearly
broken. The point is not to protect you from errors -- you would get those anyway -- but to stop you
*waiting*: to convert a 10-second timeout into a 0-millisecond local failure, so your threads stay
free and your fallback runs instantly. It also gives the struggling dependency room to recover,
which a retry storm actively prevents.`
    },
    {
      t: 'diagram',
      code: `stateDiagram-v2
  [*] --> Closed
  Closed --> Open: over 50 percent failures in 10s, min 20 requests
  Open --> HalfOpen: after 30s cool-down
  HalfOpen --> Closed: 5 consecutive probe successes
  HalfOpen --> Open: any probe fails
  note right of Open
    Calls fail instantly.
    No thread is held.
    Fallback runs in 0 ms.
  end note`,
      caption: 'The minimum-request threshold is what stops 2 failures out of 3 from opening the circuit on a low-traffic endpoint.'
    },
    {
      t: 'prose',
      md: `Three parameters decide whether a breaker helps or hurts. Use a **failure ratio over a
rolling window plus a minimum request count**, never a raw count -- otherwise a service handling 3
requests per minute trips on normal noise. Count only failures the dependency is responsible for: a
\`400\` from your own bad request is not evidence the dependency is unhealthy, while a \`503\`, a
connection error or a timeout is. And set the **half-open probe** to allow only one or a few
concurrent requests, or the moment the cool-down expires you send full production traffic at a
service that has just come back and knock it over again.

The failure mode of breakers worth knowing: a breaker on a *dependency you cannot function without*
converts a partial outage into a total one. If 30% of calls to your auth service fail and the
breaker opens, you now fail 100%. Breakers belong on dependencies with a meaningful fallback --
degrade to a cached value, skip the recommendations strip, return a partial response. For a
hard dependency, a concurrency limit is usually the better tool: it bounds resource consumption
without refusing traffic that would have succeeded.`
    },

    { t: 'h', text: 'Bulkheads and pool isolation' },
    {
      t: 'prose',
      md: `A bulkhead is a partition that stops one leak from sinking the ship. In software it means
separate resource pools per dependency or per traffic class, so exhaustion is contained.

The canonical failure it prevents: one service, 200 worker threads, and eight downstream
dependencies sharing them. The least important dependency -- the recommendations service, called on
one endpoint -- starts taking 20 seconds. Requests to that endpoint accumulate, and within a minute
all 200 threads are waiting on recommendations. Checkout, login and search now all fail, because
they cannot get a thread. A non-critical dependency has taken down everything.

With bulkheads, recommendations gets its own pool of 20 threads or a semaphore permitting 20
concurrent calls. When it degrades, those 20 fill, further calls fail immediately, the endpoint
returns a response without recommendations, and the other 180 threads never notice. The cost is
that you can no longer burst: recommendations cannot use spare capacity even when it is available,
so you sacrifice some utilisation for isolation. That is almost always the right trade.

Bulkheads apply at every layer. Separate connection pools per downstream. Separate thread or
semaphore limits per dependency. Separate database connection pools for the write path and the
batch-report path. And at the top of the stack, **cell-based architecture**: partition your whole
fleet into independent cells with their own compute, cache and database, and assign tenants to
cells. A bad tenant or a bad deploy then damages one cell, so your blast radius is 1/N of customers
instead of all of them. That is the same idea at the largest available scale.`
    },
    {
      t: 'code',
      lang: 'javascript',
      title: 'Semaphore bulkheads, sized from Little\'s Law',
      code: `// Limit = target throughput x expected latency, then bounded by
// how much of our capacity we are willing to lose to this dependency.
const bulkheads = {
  // Critical: 400 rps x 25 ms = 10 concurrent. Allow headroom.
  payments:        new Semaphore(40),
  // Important, slower: 200 rps x 60 ms = 12. Allow 30.
  inventory:       new Semaphore(30),
  // Nice-to-have. Deliberately small: it can never take more than
  // 10 of our 200 workers no matter how slow it gets.
  recommendations: new Semaphore(10)
};

async function call(name, fn, fallback) {
  const sem = bulkheads[name];
  if (!sem.tryAcquire()) {                // full: fail now, do not queue
    metrics.increment('bulkhead.rejected', { dep: name });
    return fallback();                    // e.g. render without the strip
  }
  try { return await fn(); }
  finally { sem.release(); }
}

// The metric that tells you a bulkhead is sized wrong:
//   bulkhead.rejected rising while the dependency is HEALTHY  -> too small
//   bulkhead never saturating during a known incident         -> too large`
    },

    { t: 'h', text: 'Load shedding and admission control' },
    {
      t: 'prose',
      md: `When offered load exceeds capacity, you have exactly two options: serve some requests and
reject the rest, or serve all of them badly. The second is not a real option, because "badly" past
the queueing knee means every request times out -- you do 100% of the work and deliver 0% of the
value. Load shedding is the decision to fail fast and explicitly rather than slowly and universally.

The key insight is that **latency is not the right signal; queue wait is**. A request that has been
sitting in the accept queue for 4 seconds when the client's deadline was 2 seconds is *worthless* --
processing it consumes capacity for a response nobody will read. So the cheapest and most effective
admission control is to check, at dequeue time, how long the request has been waiting and drop it
if it has already exceeded its deadline. Facebook's published approach uses a LIFO queue plus a
wait-time threshold for precisely this reason: under overload, LIFO means at least the most recent
requests are fresh enough to be worth serving, whereas FIFO guarantees you serve the *stalest* ones
first and satisfy nobody.

Shedding must be **prioritised**, or you shed randomly and lose your most valuable traffic at the
same rate as your least valuable. Assign every request a class at the edge and shed from the bottom
up.`
    },
    {
      t: 'table',
      title: 'Priority classes and shed order',
      cols: ['Class', 'Examples', 'Shed at', 'Rationale'],
      rows: [
        ['**Critical**', 'Payment capture, auth token refresh, health checks', 'Never -- fail the whole service first', 'Losing these means losing money or locking everyone out'],
        ['**User-interactive**', 'Checkout, search, page loads', '95% utilisation', 'A human is waiting and will retry manually'],
        ['**Background user**', 'Prefetch, analytics beacons, avatar uploads', '80% utilisation', 'Deferred loss is invisible to the user'],
        ['**Batch / internal**', 'Reports, exports, backfills, reindexing', '65% utilisation', 'Can run later at no cost'],
        ['**Retries**', 'Any attempt beyond the first', 'Before all first attempts', 'A retry during overload is usually counterproductive'],
        ['**Already-expired**', 'Queue wait exceeds the request deadline', 'Always, at dequeue time', 'Zero value; pure capacity theft']
      ]
    },
    {
      t: 'code',
      lang: 'javascript',
      title: 'Admission control: deadline check plus adaptive concurrency limit',
      code: `// 1. Cheapest possible shed: drop what is already worthless.
function admit(req) {
  const waited = Date.now() - req.enqueuedAt;
  if (waited > req.deadlineMs) {
    metrics.increment('shed.expired');
    return reject(503, { retryAfter: 1 });     // never even parse the body
  }
  return true;
}

// 2. Adaptive concurrency: find the limit instead of configuring it.
// Gradient-style: if latency is rising above the no-load baseline,
// the queue is growing, so reduce the limit.
class AdaptiveLimit {
  constructor() { this.limit = 20; this.minRtt = Infinity; }
  update(sampleRtt, inflight) {
    this.minRtt = Math.min(this.minRtt, sampleRtt);
    const gradient = Math.max(0.5, this.minRtt / sampleRtt);   // 1.0 = no queue
    const queueSize = Math.sqrt(this.limit);                   // allow a burst
    const next = this.limit * gradient + queueSize;
    // Grow slowly, shrink fast -- the asymmetry is the whole point.
    this.limit = next > this.limit
      ? this.limit + 1
      : Math.max(4, next);
  }
}

// 3. Prioritised shed, so we lose the cheap traffic first.
const SHED_AT = { critical: 1.00, interactive: 0.95, background: 0.80, batch: 0.65 };
function admitByClass(req, utilisation) {
  return utilisation < SHED_AT[req.class];
}`
    },

    { t: 'h', text: 'Backpressure end to end' },
    {
      t: 'prose',
      md: `Backpressure is the propagation of "slow down" from the bottleneck all the way back to
the source. Without it, every stage in a pipeline buffers, and unbounded buffers turn a throughput
problem into an out-of-memory crash plus enormous latency.

The rule is that **every queue must be bounded**, and the behaviour when full must be a deliberate
choice: block the producer, drop the newest, drop the oldest, or reject with an error. Silently
growing is not among the options, and it is the default in far too many libraries -- an unbounded
\`Channel\`, an unbounded \`ExecutorService\` queue, an \`asyncio.Queue()\` with no maxsize, a
Node stream you never check \`write()\`'s return value on.

The mechanisms differ by transport but the idea is identical. TCP has a receive window: a slow
reader shrinks it and the sender stops. HTTP/2 has per-stream flow control. gRPC streaming
propagates it if you use the flow-control-aware APIs rather than buffering. Kafka is different in
an important way: the broker is a durable buffer by design, so a slow consumer does not push back on
the producer at all -- it accumulates lag. There, backpressure means monitoring consumer lag as a
*time* (400,000 messages at 5,000/s is 80 seconds) and treating a sustained rise as a signal to scale
consumers or shed producer load upstream.

For thread-pool services, the bounded queue *is* your backpressure, and the depth should be small.
A queue deep enough to hold 30 seconds of traffic is a queue deep enough to guarantee every request
in it has already timed out. Size it at a couple of seconds of work, reject beyond that, and let
the client see a \`503\` promptly.`
    },

    { t: 'h', text: 'Graceful degradation tiers' },
    {
      t: 'prose',
      md: `Decide the degradation ladder before the incident, because during the incident you will
not have time to negotiate with a product owner about which features matter. Write it down, name
the trigger for each rung, and make it a feature flag someone on call can flip.

A realistic ladder for an e-commerce product page: full page with live inventory, personalised
recommendations and real-time pricing. Then drop personalisation and serve a popular-items list
from cache. Then serve inventory from a 60-second cache rather than live, accepting a small
oversell risk. Then hide recommendations entirely. Then serve a fully cached static version of the
page with a banner. Then serve a static maintenance page that still allows existing sessions to
complete checkout.

Each rung is a real product decision with a real cost, and "accept a small oversell risk to stay
open" is exactly the kind of decision that must be pre-agreed rather than improvised. The thing
that makes this a Staff-level topic is that the ladder is a conversation with the business, not a
technical artefact.`
    },

    { t: 'h', text: 'Health checks: liveness, readiness, and deep checks' },
    {
      t: 'prose',
      md: `Three different questions, routinely conflated, with genuinely different failure modes
when you get them wrong.

**Liveness** asks "is this process irrecoverably stuck?" and the only correct response to a failure
is to restart it. It must therefore be extremely conservative and must *never* check a dependency.
A liveness probe that checks the database means that when the database has a blip, Kubernetes
restarts every pod in the fleet simultaneously -- turning a recoverable dependency issue into a
total outage plus a cold-start storm.

**Readiness** asks "should this instance receive traffic right now?" Failure removes it from the
load balancer without killing it. This is where local dependency checks belong -- is my connection
pool established, is my cache primed -- and it should reflect genuine readiness, not just "the
process started".

**Deep health checks** verify the whole dependency graph and are useful for dashboards and
alerting. They must not drive traffic routing, for a subtle reason: if every instance's deep check
fails because a shared dependency is down, every instance is removed from rotation, and you have
converted a degraded service into a service with zero capacity. The standard mitigation is a
**minimum healthy threshold** in the load balancer -- if more than, say, 50% of targets are
unhealthy, ignore health checks entirely and route to everything. "Everything is broken" and "this
one instance is broken" require opposite responses, and encoding that is what distinguishes a
thought-through health-check design.`
    },
    {
      t: 'table',
      cols: ['Check', 'Question', 'Action on failure', 'Must not'],
      rows: [
        ['Liveness', 'Is the process wedged?', 'Restart the container', 'Check any external dependency'],
        ['Readiness', 'Can I serve traffic now?', 'Remove from the load balancer', 'Depend on a shared resource whose failure would drain the whole fleet'],
        ['Startup', 'Has initialisation finished?', 'Keep waiting, do not restart yet', 'Share a timeout with liveness'],
        ['Deep / synthetic', 'Is the whole path working?', 'Page a human', 'Drive routing decisions'],
        ['Fleet-level override', 'Is *everything* unhealthy?', 'Ignore health checks; route anyway', 'Be absent -- without it, a shared outage zeroes your capacity']
      ]
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      title: 'A full resilience stack: budgets, breakers, bulkheads, shedding',
      gains: [
        'A slow dependency costs you one bulkhead, not the whole thread pool.',
        'Overload produces fast, explicit `503`s instead of universal timeouts.',
        'The system can exit overload on its own, because it stops amplifying load.',
        'Degradation is a pre-agreed product decision rather than an improvisation at 3am.',
        'Abandoned work is dropped, returning capacity exactly when it is scarcest.'
      ],
      costs: [
        'Substantially more configuration, and every number is a judgement that can be wrong.',
        'Bulkheads waste capacity by forbidding bursting between classes.',
        'Breakers can convert a partial outage into a total one on hard dependencies.',
        'Shedding means deliberately failing requests that would have succeeded.',
        'Fallback paths are code that is rarely exercised, so it rots unless you test it.',
        'Harder to reason about: a request can now fail for reasons that have nothing to do with its own dependencies.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'Retries without jitter', blast: 'Synchronised herds at each backoff boundary; load arrives in spikes that keep re-breaking recovery.', fix: 'Full jitter: `random(0, min(cap, base * 2^n))`. Honour `Retry-After` when present.' },
        { mode: 'Retries without a budget', blast: 'A 20% failure rate becomes 1.6x offered load at the worst moment -- retry storm into metastable failure.', fix: 'Token-bucket retry budget capped at ~10% of successful traffic; retries stop automatically during systemic failure.' },
        { mode: 'Retries at every layer', blast: 'One user request becomes 27 database queries; each layer looks individually reasonable.', fix: 'Retry at exactly one layer -- the one that knows idempotency -- and pass failures through elsewhere.' },
        { mode: 'Retrying a timed-out non-idempotent write', blast: 'Duplicate charges and duplicate orders, because a timeout is an unknown outcome rather than a failure.', fix: 'Idempotency keys on every mutating endpoint; never replay non-idempotent operations on unknown.' },
        { mode: 'Shared thread pool across dependencies', blast: 'The least important dependency exhausts all workers and takes down checkout and login.', fix: 'Per-dependency semaphores or pools sized from Little\'s Law; non-critical pools deliberately small.' },
        { mode: 'Timeout longer than the caller\'s budget', blast: 'Work continues for a caller that already gave up, so capacity is consumed producing unread responses.', fix: 'Propagate an absolute deadline; each hop subtracts a reserve and pushes the remainder into `statement_timeout`.' },
        { mode: 'Unbounded queue anywhere in the pipeline', blast: 'Memory grows until OOM, and every queued request has already timed out before it is served.', fix: 'Bound every queue at ~2 seconds of work; drop or reject when full; prefer LIFO under overload.' },
        { mode: 'Liveness probe that checks the database', blast: 'A database blip restarts every pod simultaneously -- a recoverable issue becomes an outage plus a cold-start storm.', fix: 'Liveness checks only local process health; dependency checks belong in readiness, with a fleet-level minimum-healthy override.' },
        { mode: 'Circuit breaker on a hard dependency with no fallback', blast: '30% failures become 100% failures once the breaker opens.', fix: 'Breakers only where a meaningful fallback exists; use concurrency limits for hard dependencies.' },
        { mode: 'Half-open probing with full traffic', blast: 'A recovering dependency is immediately re-saturated, so the breaker oscillates and never closes.', fix: 'Allow one or a few concurrent probes; require several consecutive successes before closing.' }
      ]
    },

    {
      t: 'staff',
      md: `Almost every candidate lists these patterns. The signal is in the numbers, the ordering,
and the willingness to say a pattern is the wrong choice.

- "Retries are the dangerous part. Full jitter is necessary but not sufficient -- the missing piece
is usually a retry *budget*: cap retries at about 10% of successful traffic in a token bucket, so we
retry hard for an isolated blip and not at all for a systemic failure. And we retry at exactly one
layer, or a single user request becomes 27 database queries."
- "A timeout is an unknown outcome, not a failure. So we can only retry that write if it carries an
idempotency key -- otherwise the retry is how we double-charge someone."
- "I would not put a circuit breaker on auth. It has no fallback, so opening the breaker turns 30%
failures into 100% failures. For a hard dependency I want a concurrency limit instead -- it bounds
how much of our capacity the dependency can consume without refusing requests that would have
succeeded."
- "The right shed signal is not latency, it is **queue wait time at dequeue**. If a request has been
queued for 4 seconds and its deadline was 2, processing it is pure capacity theft. And under
overload I would rather run the queue LIFO, because FIFO guarantees we serve the stalest requests
first and satisfy nobody."
- "Recommendations gets a semaphore of 10 out of 200 workers. Deliberately small -- I never want the
least important dependency able to consume more than 5% of our capacity, and I accept that it cannot
burst into idle capacity."
- "This is a metastable failure: the trigger is gone and the retry traffic is now the load, so there
is no self-recovery path. Getting out requires shedding a large fraction at the edge, letting the
survivors complete and warm the caches, then ramping back."
- "The liveness probe must not touch the database. If it does, a database blip restarts the entire
fleet at once and we have turned a recoverable problem into an outage plus a cold-start storm. And
I want a minimum-healthy override in the load balancer, because 'everything is unhealthy' and 'this
instance is unhealthy' need opposite responses."
- "The degradation ladder has to be agreed with product before the incident. Rung three is
inventory from a 60-second cache, which accepts a small oversell risk -- that is a business
decision, and I do not want to be making it at 3am."

What these signal: retry budgets and queue-wait shedding are strong indicators of real operational
experience, because they are the two pieces most commonly missing. Saying "a breaker is wrong here"
shows you understand the mechanism rather than the vocabulary. And treating degradation as a
negotiated product ladder is the clearest sign of someone who has actually run an incident.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'A service degrades to a 20% failure rate. Clients retry up to 3 times with exponential backoff and full jitter. What happens to offered load, and what is missing?',
          options: [
            'Load is unchanged because jitter spreads retries out.',
            'Load rises up to ~1.6x at the worst moment; jitter fixes clustering but not volume -- a retry budget is missing.',
            'Load falls because backoff delays requests.',
            'Nothing -- 3 retries is a safe default.'
          ],
          answer: 1,
          why: 'Jitter and backoff change *when* retries arrive, not how many. Failing 20% and retrying up to three times adds substantial extra work precisely when capacity is lowest, which is the standard path into a retry storm. A token-bucket budget capping retries at roughly 10% of successful traffic self-disables during systemic failure while still retrying an isolated blip aggressively -- which is exactly the behaviour you want from both regimes.'
        },
        {
          q: 'Your Kubernetes liveness probe calls `/health`, which runs `SELECT 1`. The database has a 30-second blip. What happens?',
          options: [
            'Pods are removed from the load balancer and re-added after recovery.',
            'Every pod fails liveness and is restarted simultaneously, so a recoverable blip becomes an outage plus a cold-start storm.',
            'Nothing -- the probe has a grace period.',
            'Only pods with active database connections restart.'
          ],
          answer: 1,
          why: 'Liveness failure means "restart this container", and since every pod shares the dependency, every pod restarts at once -- and then all of them contend to re-establish connection pools and warm caches against a database that is only just recovering. Dependency checks belong in readiness, which removes an instance from rotation without killing it, and even that needs a fleet-level minimum-healthy override so a shared outage does not drain every target from the load balancer.'
        },
        {
          q: 'Under overload, why is a LIFO request queue often better than FIFO?',
          options: [
            'LIFO is faster to implement.',
            'FIFO serves the oldest requests first, which are the most likely to have already exceeded their deadline, so you do full work for zero value.',
            'LIFO guarantees fairness.',
            'FIFO cannot be bounded.'
          ],
          answer: 1,
          why: 'When the queue is deeper than the deadline allows, the head of a FIFO queue is exactly the set of requests whose clients have already given up -- so you burn capacity producing responses nobody reads, and every request in turn times out. LIFO at least serves requests that are still fresh enough to be useful, which keeps some fraction of traffic succeeding. Pair it with a dequeue-time deadline check so expired requests are dropped before any work is done; under normal load the queue is shallow and the ordering is irrelevant.'
        },
        {
          q: 'A dependency with no viable fallback fails 30% of requests. Is a circuit breaker the right tool?',
          options: [
            'Yes -- it prevents cascading failure.',
            'No -- opening it turns 30% failures into 100%. A concurrency limit bounds resource consumption without refusing requests that would have succeeded.',
            'Yes, but only with a longer cool-down.',
            'No -- use more retries instead.'
          ],
          answer: 1,
          why: 'A breaker trades availability for resource protection, which only pays off when you have something better to do than call the dependency. With no fallback, the 70% of requests that would have succeeded now fail too. A concurrency limit or bulkhead achieves the real goal -- bounding how many of your threads can be held waiting -- while still letting successful calls through, and it degrades continuously instead of stepping to zero.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `The queueing curve that makes shedding necessary is derived in **Scalability & Capacity
Planning**, along with why autoscaling cannot react fast enough to cover the gap. Idempotency keys,
which decide whether a retry is legal at all, and \`Retry-After\` semantics are in **API Design &
Contracts**. Where to enforce admission control and how to prioritise by tenant is **Rate Limiting
& Multi-Tenancy**. The cold-cache variant of metastable failure is in **Server-Side Caching &
Redis Patterns**, and measuring any of this requires **Observability, SLOs & Error Budgets**.`
      }]
    }
  ],

  flashcards: [
    { q: 'What is a metastable failure mode?', a: 'A state the system stays in after the original trigger is gone, sustained by its own retry traffic. There are two stable states and no self-recovery path from the broken one -- exiting requires external intervention such as shedding load or restarting clients.' },
    { q: 'Why is full jitter better than plain exponential backoff?', a: 'Backoff alone leaves clients synchronised, so they retry together at each boundary and arrive as a herd. Full jitter -- `random(0, min(cap, base * 2^n))` -- spreads them across the whole interval, reducing both total work and completion time.' },
    { q: 'What is a retry budget and why is it the piece usually missing?', a: 'A token bucket capping retries at a small fraction (~10%) of successful traffic. Per-request retry limits still allow load to multiply during a broad failure; a budget empties and stops retries automatically, so you retry hard for a blip and not at all for a systemic outage.' },
    { q: 'Why can you not retry a timed-out `POST`?', a: 'A timeout is an unknown outcome, not a failure -- the write may have succeeded with the response lost. Retrying duplicates it unless the endpoint honours an idempotency key.' },
    { q: 'What does a circuit breaker actually buy you?', a: 'It converts a slow failure into an instant one, so threads are not held waiting, and it gives the struggling dependency room to recover. It is only appropriate where a meaningful fallback exists -- on a hard dependency it turns partial failure into total failure.' },
    { q: 'What is a bulkhead, and what does it cost?', a: 'Separate resource pools per dependency, so exhaustion is contained -- a slow recommendations service fills its own 10 permits instead of all 200 workers. The cost is lost utilisation, because a class cannot burst into idle capacity reserved for others.' },
    { q: 'What is the right signal for load shedding?', a: 'Queue wait time measured at dequeue, compared against the request deadline. A request queued longer than its deadline is worthless, so drop it before parsing the body. Latency alone conflates slow work with queued work.' },
    { q: 'Why must every queue be bounded?', a: 'An unbounded queue converts a throughput problem into an OOM crash, and everything in a deep queue has already timed out. Bound at roughly two seconds of work and make the full behaviour an explicit choice: block, drop newest, drop oldest, or reject.' },
    { q: 'Difference between liveness, readiness and a deep health check?', a: 'Liveness asks whether the process is wedged -- failure means restart, so it must never check a dependency. Readiness asks whether this instance can serve now -- failure removes it from the load balancer. Deep checks verify the whole graph and should page a human, never drive routing, and you need a minimum-healthy override so a shared outage does not zero your capacity.' }
  ],

  drills: [
    {
      prompt: 'At 14:10 a downstream pricing service starts responding in 8 seconds instead of 30 ms. By 14:13 your entire checkout API is returning 504s, including endpoints that never call pricing. At 14:20 pricing fully recovers, but checkout stays broken until you restart your fleet at 14:41. Explain every part of this, and specify the changes that would have contained it.',
      probes: [
        'Why did endpoints that never call pricing fail?',
        'Why did your service not recover when pricing did?',
        'What was the client doing between 14:13 and 14:41?',
        'Which single change would have contained the original 8-second latency?',
        'How would you have exited the state without a restart?'
      ],
      strong: [
        'Identifies a shared thread or connection pool exhausted by requests blocked on pricing.',
        'Names the metastable state explicitly: client retries became the load, so removing the trigger did not help.',
        'Explains that a restart worked because it dropped the accumulated queue and in-flight retries.',
        'Proposes a per-dependency semaphore sized so pricing can never hold more than a small fraction of workers.',
        'Adds a timeout derived from pricing\'s p99.9 -- hundreds of milliseconds, not 8 seconds -- plus a deadline check at dequeue.',
        'Adds a retry budget on the client side and notes per-request retry caps would not have been enough.',
        'Describes exiting without a restart: shed a large fraction at the edge, let the rest complete, ramp back.',
        'Considers a breaker on pricing specifically because a fallback exists -- render without live pricing or use a cached price.'
      ],
      weak: [
        'Blames pricing and stops there.',
        'Proposes raising timeouts or adding capacity.',
        'Suggests more retries to "get through the errors".',
        'Cannot explain why unrelated endpoints failed.',
        'Treats the restart as the fix rather than as evidence of a metastable state.'
      ]
    },
    {
      prompt: 'You are asked to make a 60-service platform survive a regional database failover that takes 90 seconds. Traffic is 20,000 rps, the services call each other up to 5 deep, and today every service uses a 30-second client timeout and 3 retries with fixed 1-second backoff. Write the plan, and say what you would measure to prove it works.',
      probes: [
        'What is wrong with 30 seconds and 3 retries at depth 5?',
        'How do you assign timeouts across 60 services without hand-tuning 60 numbers?',
        'What should a request do during the 90 seconds when writes are impossible?',
        'How do you stop the recovery moment from being a second outage?',
        'How do you test this without a real regional failure?'
      ],
      strong: [
        'Computes the amplification: 3^5 = 243 potential attempts per request, and 30 s timeouts at depth 5 means unbounded user-visible latency.',
        'Replaces per-hop timeouts with an absolute deadline propagated via header or gRPC, each hop subtracting a reserve.',
        'Derives leaf timeouts from measured p99.9 rather than assigning them by hand.',
        'Retries at one layer only, with full jitter and a shared retry budget.',
        'Defines the degradation ladder for a read-only window: serve reads from replicas or cache, queue writes to an outbox, return a clear "will complete shortly" contract.',
        'Plans the recovery ramp -- staggered reconnects, jittered pool warm-up, slow-start on the load balancer -- to avoid a thundering herd at t+90s.',
        'Bounded queues and prioritised shedding so critical traffic survives the window.',
        'Proves it with a game day: failover in a staging clone under production-shaped load, plus fault injection of 8-second latency in a single dependency.',
        'Names the metrics: retry rate, budget exhaustion, bulkhead rejections, shed counts by class, and deadline-exceeded at each hop.'
      ],
      weak: [
        'Lowers all timeouts to a single global value with no budget reasoning.',
        'Adds circuit breakers everywhere with no fallback analysis.',
        'Ignores the reconnect storm at recovery.',
        'Has no plan for what a write does during the 90 seconds.',
        'Proposes to verify by watching the next real incident.'
      ]
    }
  ]
};
