export default {
  blocks: [
    {
      t: 'prose',
      md: `A rate limiter answers one question: given that this request has arrived, and given
everything else that has arrived recently from the same source, should we do the work? Everything
else -- the algorithm, the storage, the headers -- is implementation of that decision.

Multi-tenancy is the same question asked about a shared resource rather than a single caller. One
customer's bulk import must not make the product slow for the other 8,000, and the uncomfortable
part is that rate limiting alone does not achieve this: a tenant can stay under every published
limit and still consume most of your capacity because their queries are 200x more expensive than
average.`
    },

    { t: 'h', text: 'Why it exists' },
    {
      t: 'prose',
      md: `Three distinct problems, and conflating them is why so many limiter designs are wrong for
their purpose.

**Protection.** Your system has finite capacity and, as the queueing curve shows, degrades
non-linearly past about 70% utilisation. A limiter is admission control that keeps you on the flat
part of the curve, and it works by refusing traffic -- which is only a good trade because the
alternative is refusing all traffic slowly.

**Fairness.** On shared infrastructure, capacity is allocated by whoever asks hardest unless you
intervene. One tenant running an unthrottled backfill is not malicious; they are simply the only
one with a loop. Without per-tenant limits, your quality of service for everyone else is determined
by your least considerate customer.

**Commerce.** Quotas are a product feature. 1,000 requests per day on free and 1,000,000 on
enterprise is a pricing tier expressed in code, and it has completely different requirements from
protection: it must be accurate, auditable, billable, and it is measured over a month rather than a
second.

A limiter designed for protection (approximate, fast, local) is wrong for commerce, and vice versa.
Most mature systems run both.`
    },

    {
      t: 'numbers',
      title: 'Figures behind the design choices',
      items: [
        { v: '2x', k: 'Overshoot of a fixed window at the boundary', note: '100/min becomes 200 in one second' },
        { v: '2 values', k: 'Token bucket state per key', note: 'Tokens plus last-refill timestamp' },
        { v: '0.2-0.5 ms', k: 'Cost of a shared-counter round trip', note: 'Paid on allowed requests too' },
        { v: '/64', k: 'IPv6 prefix a single household gets', note: 'Per-address limiting is meaningless' },
        { v: '~429', k: 'Client exceeded its limit', note: '`503` means *you* are shedding -- different instruction' }
      ]
    },

    { t: 'h', text: 'The five algorithms' },
    {
      t: 'table',
      cols: ['Algorithm', 'Mechanism', 'Memory per key', 'Burst behaviour', 'Accuracy', 'Use for'],
      rows: [
        ['**Fixed window**', 'Counter per key per interval, reset on the boundary', '1 integer', 'Allows 2x the limit across a boundary', 'Poor at edges', 'Rough quotas where the boundary artefact is acceptable'],
        ['**Sliding window log**', 'Store a timestamp per request, count those inside the window', 'O(limit) -- one entry per request', 'None; exact', 'Exact', 'Low limits with strict correctness (login attempts, OTP sends)'],
        ['**Sliding window counter**', 'Two adjacent fixed windows, weighted by overlap', '2 integers', 'Smooth, small approximation', '~±1% typical', 'General-purpose API limiting at scale'],
        ['**Token bucket**', 'Tokens refill at rate R up to capacity B; each request takes one', '2 values (tokens, last refill)', 'Explicit and controllable via B', 'Exact for the model', 'The default. Bursts are a feature, not a bug'],
        ['**Leaky bucket** (queue)', 'Requests enter a bounded queue drained at a constant rate', 'Queue depth', 'Absorbs bursts by *delaying* them', 'Exact output rate', 'Smoothing traffic to a fragile downstream, not rejecting it']
      ]
    },
    {
      t: 'prose',
      md: `The fixed-window flaw is worth seeing concretely, because it is the reason the naive
implementation fails review. With a limit of 100 per minute, a client sends 100 requests at
10:00:59 and 100 more at 10:01:00. Both windows are satisfied, and you just served 200 requests in
one second -- twice the intended rate, at the worst possible instant. Halving the window halves the
overshoot but multiplies the boundary count.

The sliding window counter fixes it cheaply. Keep the count for the current window and the previous
one, and weight the previous by how much of it still overlaps the trailing window. At 10:01:15 with
a 60-second window, 75% of the previous minute is still in range, so the estimate is
\`current + 0.75 * previous\`. That assumes the previous window's requests were spread evenly, which
is why it is approximate -- but the error is small and the storage is two integers regardless of
limit size.

Token bucket is the default for good reasons. It handles bursts *deliberately*: capacity B is how
much burst you permit and refill rate R is the sustained rate, and separating them is exactly what
you want, because real clients are bursty and blocking a legitimate burst is a worse outcome than
absorbing it. It is also cheap -- two values per key, computed lazily on read, no background timer.

Leaky bucket is the one people forget, and it is a genuinely different tool: it **delays** instead
of rejecting. When you are protecting a fragile downstream that must never see more than 500 rps,
queueing to a constant drain rate is better than returning \`429\` to the caller. The catch is that
queueing adds latency and the queue must be bounded, so past the bound you are rejecting anyway.`
    },
    {
      t: 'diagram',
      code: `flowchart LR
  A["Requests arrive<br/>bursty, 900 rps peak"] --> B{"Tokens available?"}
  B -->|yes| C["Consume 1 token<br/>serve request"]
  B -->|no| D["429 plus Retry-After"]
  R["Refill R = 500 per sec<br/>capacity B = 1000"] --> B
  C --> E["Downstream<br/>sustained 500 rps"]
  F["Leaky bucket variant"] --> G["Bounded queue<br/>drained at 500 per sec"]
  G --> E`,
      caption: 'Token bucket rejects the excess; leaky bucket delays it. Capacity B is the burst you are willing to absorb and R is the rate you can sustain -- two separate business decisions.'
    },

    { t: 'h', text: 'A distributed token bucket in Redis' },
    {
      t: 'prose',
      md: `The hard part of a distributed limiter is atomicity. Read the token count, decide, write
it back -- and between the read and the write, forty other application instances did the same
thing. At 5,000 rps across 40 instances the race is not rare, it is the common case, and the result
is that you serve substantially more than the limit under exactly the load where the limit matters.

Two mechanisms give you atomicity in Redis. A **Lua script** executes on the single command thread
with nothing interleaved, so read-decide-write is one indivisible operation. Or Redis 4+ with the
\`redis-cell\` module implements a generic cell rate limiter natively. Lua is the portable answer
and it is worth being able to write.`
    },
    {
      t: 'code',
      lang: 'lua',
      title: 'Atomic token bucket. Lazy refill, no background timer, self-expiring keys.',
      code: `-- KEYS[1] = bucket key, e.g. "rl:tb:tenant:42"
-- ARGV[1] = capacity (max burst)
-- ARGV[2] = refill tokens per second
-- ARGV[3] = now, in milliseconds (from the CALLER, never from the Redis node)
-- ARGV[4] = tokens requested (cost of this call)
-- Returns: { allowed (1/0), tokens_remaining, retry_after_ms }

local capacity    = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now_ms      = tonumber(ARGV[3])
local requested   = tonumber(ARGV[4])

local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1])
local last   = tonumber(state[2])

if tokens == nil then           -- first sight of this key: start full
  tokens = capacity
  last   = now_ms
end

-- Lazy refill: compute what has accrued since we last looked.
local elapsed_ms = math.max(0, now_ms - last)
tokens = math.min(capacity, tokens + (elapsed_ms / 1000.0) * refill_rate)

local allowed, retry_after_ms = 0, 0
if tokens >= requested then
  tokens  = tokens - requested
  allowed = 1
else
  local deficit  = requested - tokens
  retry_after_ms = math.ceil((deficit / refill_rate) * 1000)
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now_ms)
-- Expire after the time it takes to refill from empty, so idle keys vanish.
redis.call('PEXPIRE', KEYS[1], math.ceil((capacity / refill_rate) * 1000) + 1000)

return { allowed, math.floor(tokens), retry_after_ms }`
    },
    {
      t: 'code',
      lang: 'javascript',
      title: 'Calling it, with the failure mode decided in advance',
      code: `const script = await redis.script('LOAD', luaSource);   // EVALSHA afterwards

async function checkLimit(key, { capacity, ratePerSec, cost = 1 }) {
  try {
    const [allowed, remaining, retryAfterMs] = await redis.evalsha(
      script, 1, key, capacity, ratePerSec, Date.now(), cost
    );
    return { allowed: allowed === 1, remaining, retryAfterMs };
  } catch (err) {
    // Redis is unreachable. This is a policy decision, not an error path.
    metrics.increment('ratelimit.backend_error');
    return { allowed: FAIL_OPEN, remaining: 0, retryAfterMs: 0 };
  }
}

// FAIL_OPEN = true  for abuse protection: never let the limiter cause an outage.
// FAIL_OPEN = false for billing quotas and login attempts: never give away
//                   metered capacity or unlimited password guesses.
// A local in-process fallback limiter is better than either: degrade to
// per-instance limits of (global_limit / instance_count) while Redis is down.`
    },
    {
      t: 'note',
      tone: 'warn',
      title: 'Pass the clock in, and mind the slot',
      md: `Never call \`redis.call('TIME')\` inside a Lua script -- it is non-deterministic and was
historically forbidden for replication reasons. Pass the timestamp from the caller, and accept that
client clock skew across your fleet is now part of your error budget. Also: keep every limiter
script to **one key**, so it works unchanged in Redis Cluster and survives resharding. A multi-key
script requires all keys in one hash slot forever, which is a constraint you will regret.`
    },

    { t: 'h', text: 'Accuracy versus coordination cost' },
    {
      t: 'prose',
      md: `A globally exact limit requires every instance to agree on a single counter, which means
a network round trip per request to a single owner of that counter. At 50,000 rps that is 50,000
round trips per second to one Redis node -- which is near a single node's ceiling, and it adds
0.2-0.5 ms to every request including the ones you allow. Exactness is not free, and it is often not
worth it.

The spectrum of choices, and each is right somewhere:

**Local-only limits.** Each instance enforces \`global_limit / instance_count\`. Zero added
latency, zero shared dependency. Wrong whenever instance counts change (autoscaling silently changes
your effective global limit) or when load is unevenly balanced -- and with sticky connections it
usually is. Fine for coarse protection.

**Shared counter per request.** Exact, and the coordination cost above. Correct for billing and for
security-sensitive limits where being wrong is unacceptable.

**Batched or leased local counters.** Each instance leases a block of 50 tokens from the shared
counter and spends them locally, returning for more when depleted. Coordination drops by 50x while
staying globally bounded. The error is at most one lease per instance, and unreturned leases on a
crash are lost capacity -- so leases need a TTL.

**Approximate with reconciliation.** Count locally, flush to a shared store every second, enforce
locally against the last known global figure. Overshoot is bounded by one flush interval times the
instance count, which you can compute and state. This is how most large-scale limiters actually
work.

The design rule: pick your accuracy from the *consequence of being wrong*. Overshooting an abuse
limit by 5% costs you nothing. Overshooting a paid quota by 5% is a billing dispute. Allowing 20
password attempts instead of 5 is a security finding.`
    },

    { t: 'h', text: 'Where to enforce' },
    {
      t: 'table',
      cols: ['Location', 'Sees', 'Cost of a rejection', 'Good for', 'Blind to'],
      rows: [
        ['CDN / edge (Cloudflare, CloudFront)', 'IP, headers, path, JA3 fingerprint', 'Nearly zero -- never enters your network', 'Volumetric abuse, L7 DDoS, crawler control', 'Identity, tenant, cost of the operation'],
        ['API gateway (Kong, Envoy, ALB)', 'API key, JWT claims, route', 'One hop; no application code runs', 'Per-key and per-plan quotas, coarse tenant limits', 'Actual work a request implies'],
        ['Service middleware', 'Full identity, endpoint, request body', 'Full request parse plus auth', 'Per-endpoint weights, per-tenant fairness, cost-based limits', 'Aggregate traffic across other services'],
        ['Resource layer (DB pool, worker pool)', 'Real resource consumption', 'Work already done', 'Concurrency limits and the true bottleneck', 'Who the caller is, unless propagated']
      ]
    },
    {
      t: 'prose',
      md: `You want more than one, and the ordering follows a single principle: **reject as early as
possible, but you can only enforce what you can see.** The edge can drop a million junk requests per
second for effectively nothing but knows nothing about tenants. The service knows exactly who is
calling and what the request will cost, but by then you have paid for TLS, parsing and
authentication. Volumetric defence at the edge, quota enforcement at the gateway, fairness and
cost-based limits in the service, concurrency limits at the resource.

The corollary that matters operationally: a limiter at the edge cannot protect you from a tenant
whose requests are individually expensive. That requires weighting, and weighting requires knowing
the cost -- which only the service knows.`
    },

    { t: 'h', text: 'What key to limit on' },
    {
      t: 'prose',
      md: `The limiter key determines who bears the cost of a rejection, so getting it wrong is not
a tuning error -- it is a decision about which innocent users you punish.

**Tenant or account id** is the right primary key for a B2B API, because it matches the billing
relationship and the fairness requirement. **User id** is right for per-user abuse (posting,
messaging). **API key** is right when one tenant has several integrations you want to isolate from
each other. **IP address** is the one to be careful with.

The problem with IP is NAT and CGNAT. A university, a large employer, or an entire mobile carrier
region can share one public address -- a mobile operator using carrier-grade NAT may put hundreds of
thousands of subscribers behind a single IPv4 address. An IP limit of 100 requests per minute then
blocks an entire campus because of one person's script. The reverse is also true: IPv6 gives a
single household a /64, which is 18 quintillion addresses, so per-address limiting is trivially
evaded -- limit on the /64 prefix instead, and typically the /48 for a site.

IP therefore belongs to unauthenticated traffic only -- login, signup, password reset -- where you
have no better identifier, and even then it should be one signal among several (device fingerprint,
proof of work, CAPTCHA escalation) rather than a hard block. Once a request is authenticated, limit
on identity.

And when you do use IP, you must extract it correctly: \`X-Forwarded-For\` is a client-controllable
list, so take the entry contributed by *your* trusted proxy -- counted from the right -- rather than
the leftmost value, which any caller can forge to appear as a different client on every request.`
    },
    {
      t: 'table',
      title: 'Key choice and its consequence',
      cols: ['Key', 'Blast radius of a false positive', 'Evadable by', 'Use when'],
      rows: [
        ['Tenant / account id', 'That customer only', 'Buying more accounts', 'B2B APIs -- the default'],
        ['User id', 'One user', 'Creating accounts', 'Per-user abuse: posting, messaging, invites'],
        ['API key', 'One integration', 'Issuing more keys (cap the count)', 'Isolating a tenant\'s own integrations'],
        ['IP address', 'Everyone behind that NAT -- possibly a whole campus or carrier region', 'Proxies, botnets, IPv6 rotation', 'Unauthenticated endpoints only'],
        ['IPv6 /64 or /48 prefix', 'One household or site', 'Multiple prefixes', 'Any IPv6 limiting -- per-address is meaningless'],
        ['Composite (tenant + endpoint)', 'One operation for one tenant', 'Spreading across endpoints', 'Protecting a specific expensive endpoint'],
        ['Session or device id', 'One device', 'Clearing state', 'Consumer abuse prevention, alongside other signals']
      ]
    },

    { t: 'h', text: 'The response: `429`, `Retry-After`, and `RateLimit-*`' },
    {
      t: 'prose',
      md: `A limiter that rejects without telling the client when to come back has created a polling
loop. The client does not know whether to wait 1 second or 300, so it guesses -- and a badly
guessing client under rejection generates more load than one that was allowed through.

\`429 Too Many Requests\` plus \`Retry-After\` is the minimum. The IETF \`RateLimit\` header fields
draft standardises the richer form -- \`RateLimit-Limit\`, \`RateLimit-Remaining\` and
\`RateLimit-Reset\` -- which lets a well-behaved client pace itself *before* being rejected, which
is strictly better for both sides. GitHub, Stripe and Twitter all ship equivalents (often with an
\`X-\` prefix predating the draft).

One distinction worth getting right: use \`429\` when the *client* exceeded its own limit, and
\`503\` with \`Retry-After\` when *you* are shedding load. They mean different things -- "you did
too much" versus "we cannot cope right now" -- and clients should treat them differently, since a
\`429\` means slow down permanently and a \`503\` means try again shortly.`
    },
    {
      t: 'code',
      lang: 'http',
      title: 'Both sides of the contract',
      code: `# Allowed -- the client can self-pace and never hit a 429.
HTTP/1.1 200 OK
RateLimit-Limit: 1000
RateLimit-Remaining: 41
RateLimit-Reset: 27                  # seconds until the window refills
RateLimit-Policy: 1000;w=3600        # 1000 requests per 3600s window

# Rejected -- the client is told exactly how long to wait.
HTTP/1.1 429 Too Many Requests
Retry-After: 27
RateLimit-Limit: 1000
RateLimit-Remaining: 0
RateLimit-Reset: 27
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/rate-limit-exceeded",
  "title": "Rate limit exceeded",
  "status": 429,
  "detail": "1000 requests per hour for plan 'growth'. Resets in 27s.",
  "code": "RATE_LIMIT_EXCEEDED",
  "scope": "tenant",
  "upgrade_url": "https://example.com/billing"
}

# Us shedding load -- a different statement entirely.
HTTP/1.1 503 Service Unavailable
Retry-After: 2`
    },

    { t: 'h', text: 'Quota, rate, and concurrency are three different limits' },
    {
      t: 'prose',
      md: `These are routinely collapsed into one setting, and they constrain genuinely different
things.

A **rate** limit (1,000 requests per minute) bounds arrival frequency. It does nothing about
expense: 1,000 requests that each run a 30-second report will destroy you while staying comfortably
within the limit.

A **concurrency** limit (at most 5 simultaneous requests per tenant) bounds resources held at
once, and it is the limit that most directly protects you, because resource exhaustion is what
actually causes outages. It is also what you want for long-running operations -- exports, report
generation, LLM inference -- where duration varies by orders of magnitude.

A **quota** (1,000,000 requests per month) bounds total consumption over a billing period. It is a
commercial construct: it must be accurate, auditable, survive restarts, and reconcile with invoices.

The unifying idea is **cost-based limiting**: give each endpoint a weight reflecting the work it
implies, and debit the weight rather than one token. A cheap key lookup costs 1, a search costs 20,
a report costs 500. This is how GitHub's GraphQL API works -- it computes a point cost per query --
and it is the only approach that survives clients who discover your expensive endpoint. Once you
have weights, the token bucket takes \`cost\` instead of 1, which the Lua script above already
supports.`
    },

    { t: 'h', text: 'Noisy neighbours and fair queueing' },
    {
      t: 'prose',
      md: `Rate limits cap what a tenant can ask for. They do not allocate what is left when demand
exceeds supply, and that is the noisy-neighbour problem: every tenant is within their limit, but the
sum exceeds capacity, and a naive FIFO queue gives capacity to whoever submits most.

**Fair queueing** fixes the allocation. Instead of one queue, maintain a queue per tenant and serve
them round-robin, so a tenant with 10,000 queued items and a tenant with 3 each get served at the
same rate rather than in proportion to their backlog. **Weighted fair queueing** extends it with a
share per tenant -- an enterprise customer gets weight 10 and a free-tier tenant weight 1, so under
contention they receive capacity in a 10:1 ratio while still both making progress. The important
property in both cases is that an idle tenant's share is redistributed rather than reserved, so you
get isolation without wasting capacity -- which is exactly what a fixed per-tenant allocation fails
to do.

**Deficit round robin** is the practical implementation: give each queue a quantum of credit per
round, let it dequeue while it has credit, carry the remainder forward. It is O(1) per dequeue and
handles variable item costs correctly, which a plain round robin does not.

The other half of noisy-neighbour defence is **concurrency isolation** at the resource: a per-tenant
semaphore on database connections or worker slots, so one tenant cannot hold every connection even
if their request rate is legal. And beyond that, **cells** -- partition the fleet into independent
groups and assign tenants to a cell, so the worst case is that one cell's tenants suffer rather
than everyone.`
    },
    {
      t: 'diagram',
      code: `flowchart LR
  I["Incoming work"] --> C["Classify by tenant"]
  C --> QA["Queue: tenant A<br/>weight 10"]
  C --> QB["Queue: tenant B<br/>weight 1"]
  C --> QC["Queue: tenant C<br/>weight 1"]
  QA --> S["Deficit round robin<br/>scheduler"]
  QB --> S
  QC --> S
  S --> W["Worker pool<br/>per-tenant semaphore"]
  W --> D[("Shared database")]`,
      caption: 'A backlog of 10,000 items from tenant B cannot delay tenant C, because the scheduler serves per-queue rather than per-item. Idle weight is redistributed, so isolation does not cost utilisation.'
    },

    { t: 'h', text: 'Per-tenant data isolation models' },
    {
      t: 'table',
      title: 'Four isolation models and what each costs',
      cols: ['Model', 'Mechanism', 'Blast radius of a bug', 'Noisy-neighbour isolation', 'Per-tenant restore', 'Tenants per cluster', 'Cost'],
      rows: [
        ['**Row-level** (shared schema)', '`tenant_id` on every table, ideally enforced by Postgres RLS', 'One missing `WHERE` clause exposes all tenants', 'None at the storage layer', 'Painful -- selective row extraction', '100,000+', 'Lowest; one schema, one migration'],
        ['**Schema-per-tenant**', 'One Postgres schema per tenant, same database', 'Bounded by a connection\'s `search_path`', 'Still shares buffer cache, WAL and CPU', 'Straightforward -- dump one schema', '~1,000s before catalog bloat hurts', 'Migrations run N times; catalog pressure'],
        ['**Database-per-tenant**', 'Separate database or instance', 'One tenant', 'Good -- separate buffer cache and connections', 'Trivial', '~100s per cluster', 'High: N backups, N upgrades, N connection pools'],
        ['**Cell-per-group**', 'Full independent stack per cell; tenants assigned to cells', '1/N of customers', 'Complete across cells', 'Per cell', 'Unbounded by adding cells', 'Highest: N of everything, plus routing and migration machinery']
      ]
    },
    {
      t: 'prose',
      md: `Row-level is right for the overwhelming majority of SaaS products, and the honest reason
is economics: 50,000 small tenants with database-per-tenant means 50,000 backups and 50,000
migrations, which is not an engineering problem but a permanent operational tax. The risk is
real though -- one \`WHERE tenant_id = ?\` omitted in one query is a cross-tenant data leak -- so
the mitigation must be structural rather than disciplinary. Postgres **row-level security** with a
session variable makes the database enforce it, so a forgotten predicate returns zero rows instead
of everyone's.`
    },
    {
      t: 'code',
      lang: 'sql',
      title: 'Making the database enforce tenancy',
      code: `ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;   -- applies to the table owner too

CREATE POLICY tenant_isolation ON invoices
  USING       (tenant_id = current_setting('app.tenant_id')::uuid)
  WITH CHECK  (tenant_id = current_setting('app.tenant_id')::uuid);

-- Set per transaction. SET LOCAL is essential: with pgBouncer in
-- transaction mode, a session-level SET can leak to another tenant's request.
BEGIN;
SET LOCAL app.tenant_id = '8f1c...';
SELECT * FROM invoices;          -- scoped by the database, not by the ORM
COMMIT;

-- Composite indexes must lead with tenant_id so the policy predicate
-- is a seek rather than a filter:
CREATE INDEX ON invoices (tenant_id, issued_at DESC);`
    },
    {
      t: 'prose',
      md: `The pragmatic pattern that most successful SaaS companies converge on is **hybrid**:
row-level for the long tail of small tenants, and dedicated databases or cells for the handful of
large or regulated ones who will pay for it. That also gives you a migration story -- promoting a
tenant from shared to dedicated becomes a product SKU rather than a re-architecture.`
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      title: 'Per-tenant limits plus weighted fair queueing',
      gains: [
        'One tenant\'s backfill cannot degrade the other 8,000.',
        'Overload becomes a fast, explicit `429` rather than universal timeouts.',
        'Quotas become a pricing lever the business can use directly.',
        'Cost weighting protects you from clients who find the expensive endpoint.',
        'Idle tenants\' shares are redistributed, so isolation does not waste capacity.'
      ],
      costs: [
        'A shared counter adds a round trip and a hard dependency to every request.',
        'Per-tenant queues and semaphores mean per-tenant state, metrics and cardinality.',
        'Limits are guesses until measured, and a wrong limit is a self-inflicted outage.',
        'Weights must be maintained as endpoints change, or they silently stop reflecting cost.',
        'Fail-open versus fail-closed is a decision you must make per limiter, not globally.',
        'Per-tenant observability is expensive: 8,000 tenants times a few metrics is real cardinality.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'Fixed window at the boundary', blast: '2x the intended rate served in one second, at exactly the moment the limit mattered.', fix: 'Sliding window counter with two weighted buckets, or a token bucket where burst is explicit.' },
        { mode: 'Non-atomic read-modify-write across instances', blast: 'Limit exceeded by a wide margin under concurrency; the limiter appears to work in testing and not in production.', fix: 'Single-key Lua script (or `redis-cell`) so read-decide-write is indivisible.' },
        { mode: 'Rate limit with no cost weighting', blast: 'A tenant stays within 1,000 rpm while each request runs a 30-second report -- capacity consumed legally.', fix: 'Per-endpoint weights debited from the bucket, plus a per-tenant concurrency limit.' },
        { mode: 'Limiting on IP behind CGNAT', blast: 'One script blocks an entire campus or mobile carrier region; support cannot explain it.', fix: 'Limit on identity once authenticated; IP only for unauthenticated endpoints, and on the /64 prefix for IPv6.' },
        { mode: 'Trusting the leftmost `X-Forwarded-For` value', blast: 'Any caller forges a different client IP per request and bypasses the limiter entirely.', fix: 'Take the entry appended by your trusted proxy, counting from the right; configure trusted-proxy depth explicitly.' },
        { mode: '`429` without `Retry-After`', blast: 'Clients poll blindly, so rejected traffic generates more load than accepted traffic did.', fix: '`Retry-After` on every rejection and `RateLimit-*` on every success, so clients can self-pace.' },
        { mode: 'Limiter fails open for a billing quota', blast: 'A Redis outage gives away metered capacity, or allows unlimited password attempts.', fix: 'Choose per limiter: fail open for abuse protection, closed for billing and auth, with a local fallback limiter in between.' },
        { mode: 'FIFO queue shared across tenants', blast: 'A 10,000-item backlog from one tenant delays every other tenant\'s three items behind it.', fix: 'Per-tenant queues with deficit round robin, weighted by plan.' },
        { mode: 'Missing `WHERE tenant_id` in a shared-schema query', blast: 'Cross-tenant data exposure -- the highest-severity bug this architecture permits.', fix: 'Postgres RLS with `SET LOCAL`, so the database enforces scoping and a forgotten predicate returns nothing.' },
        { mode: 'Session-level `SET` for tenant context behind pgBouncer', blast: 'Transaction-mode pooling reuses the connection, so one tenant\'s context applies to another\'s query.', fix: '`SET LOCAL` inside an explicit transaction, always.' }
      ]
    },

    {
      t: 'staff',
      md: `The weak version of this answer is "token bucket in Redis". The strong version separates
the three problems, names the key, and is explicit about what the limiter does *not* solve.

- "There are three different limits here and they need different designs. Rate bounds arrival,
concurrency bounds resources held -- which is what actually causes outages -- and quota is a
commercial construct that must be accurate and auditable. I would run all three."
- "A rate limit does not solve noisy neighbours. A tenant can sit inside 1,000 rpm and consume most
of our capacity if their requests are 200x the average cost. That needs per-endpoint weights
debited from the bucket, plus a per-tenant concurrency semaphore at the database pool."
- "The read-decide-write has to be atomic or the limiter simply does not work at 40 instances. One
Lua script, one key, so it survives Redis Cluster resharding, and the timestamp passed in by the
caller rather than read inside the script."
- "I would not limit on IP for authenticated traffic. A mobile carrier can put hundreds of thousands
of subscribers behind one address, so an IP limit blocks a region because of one script. And on
IPv6 a household has a /64, so per-address limiting is trivially evaded -- limit the prefix."
- "Fail-open versus fail-closed is a per-limiter decision. Abuse protection fails open, because I
will not let the limiter cause the outage it exists to prevent. Login attempts and billing quotas
fail closed. Better still, degrade to a local limiter at global-limit-over-instance-count while
Redis is unavailable."
- "Rate limiting caps demand; it does not allocate supply. When every tenant is legal and the sum
exceeds capacity, I want weighted fair queueing -- deficit round robin per tenant -- so a 10,000-item
backlog cannot delay someone's three items, and idle weight is redistributed rather than reserved."
- "For 50,000 small tenants, row-level with Postgres RLS and \`SET LOCAL\` -- the database enforces
scoping so a forgotten \`WHERE\` returns zero rows rather than everyone's data. Dedicated databases
for the handful of large or regulated tenants, which also makes isolation a SKU. 50,000 databases is
50,000 backups and 50,000 migrations, and that is an operational tax with no end date."
- "\`429\` and \`503\` are different statements. One says the client did too much, the other says we
cannot cope. Clients should react differently, so I want both, both with \`Retry-After\`."

The two sentences that most reliably mark experience: "a rate limit does not solve noisy
neighbours", and treating fail-open as a per-limiter policy decision with a local fallback. Both
come from having watched a limiter either fail to protect or become the outage.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'With a fixed-window limit of 100 requests per minute, what is the maximum a client can send in any 1-second period?',
          options: ['100', '150', '200', 'Unbounded'],
          answer: 2,
          why: 'Sending 100 at 10:00:59 and 100 at 10:01:00 satisfies both windows while delivering 200 requests in about one second -- twice the intended rate, concentrated at the boundary. A sliding window counter weights the previous window by its remaining overlap and removes the artefact for two integers of storage, and a token bucket makes the permitted burst an explicit parameter rather than an accident of the window boundary.'
        },
        {
          q: 'Your limiter reads the token count from Redis, decides, then writes it back from 40 app instances. Load tests at low concurrency pass; production overshoots badly. Why?',
          options: [
            'Redis replication lag.',
            'The read-modify-write is not atomic, so concurrent instances interleave and all see the same stale count.',
            'Clock skew between instances.',
            'The TTL is too short.'
          ],
          answer: 1,
          why: 'Between one instance\'s read and its write, dozens of others have read the same value and each concluded there was room, so the effective limit becomes roughly the true limit times the concurrency. A single-key Lua script executes on Redis\'s command thread with nothing interleaved, making the whole decision indivisible. Keep it to one key so the script keeps working after a cluster reshard -- and pass the clock in from the caller rather than reading it inside the script.'
        },
        {
          q: 'Every tenant is within their published rate limit, yet p99 latency has doubled and one tenant accounts for most of the database load. What is missing?',
          options: [
            'A lower global rate limit.',
            'Cost weighting and per-tenant concurrency limits -- rate bounds arrival frequency, not the work each request implies.',
            'More Redis capacity.',
            'IP-based limiting.'
          ],
          answer: 1,
          why: 'A request count is a poor proxy for resource consumption: 1,000 cheap lookups and 1,000 thirty-second reports are identical to a rate limiter and nothing alike to your database. Assigning each endpoint a weight and debiting that from the bucket makes expensive calls cost proportionally more, and a per-tenant semaphore on the connection pool prevents one tenant holding every connection regardless of their arrival rate. Fair queueing then allocates the remaining contention.'
        },
        {
          q: 'Which per-tenant isolation model fits a product with 60,000 small tenants and 5 large regulated ones?',
          options: [
            'Database-per-tenant for all 60,005.',
            'Row-level with Postgres RLS for the long tail, dedicated databases or cells for the 5 large tenants.',
            'Schema-per-tenant for all.',
            'Row-level for all, with application-layer filtering only.'
          ],
          answer: 1,
          why: '60,005 databases means 60,005 backup schedules, migrations and connection pools -- an operational tax that never ends -- while schema-per-tenant at that count causes serious catalog bloat. Row-level with RLS enforced by the database keeps the long tail cheap and makes a forgotten `WHERE tenant_id` return zero rows rather than other tenants\' data, which application-layer filtering alone cannot guarantee. Dedicating infrastructure to the few tenants who need and will pay for it also turns isolation into a sellable SKU.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{
        t: 'prose',
        md: `Load shedding, admission control and why \`503\` differs from \`429\` are developed in
**Resilience: Timeouts, Retries & Backpressure**. The queueing curve that determines your real
limits is in **Scalability & Capacity Planning**. The Redis primitives -- sorted sets for sliding
windows, Lua atomicity, cluster slot constraints -- are covered in **Server-Side Caching & Redis
Patterns**. Cells and per-tenant partitioning connect to **Sharding & Partitioning**, and
\`RateLimit-*\` header semantics belong to the contract described in **API Design & Contracts**.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why is a fixed window limiter flawed?', a: 'It allows up to twice the limit across a boundary -- 100 requests at 10:00:59 plus 100 at 10:01:00 satisfies both windows while delivering 200 in a second. A sliding window counter or token bucket removes the artefact.' },
    { q: 'How does a sliding window counter work?', a: 'Keep counters for the current and previous fixed windows and weight the previous one by its remaining overlap: `current + 0.75 * previous` at 15 seconds into a 60-second window. Two integers per key, approximate because it assumes the previous window was evenly spread.' },
    { q: 'Why is token bucket the usual default?', a: 'Capacity `B` and refill rate `R` separate permitted burst from sustained rate, which matches how real clients behave. It stores two values per key, refills lazily on read, and needs no background timer.' },
    { q: 'When is a leaky bucket better than a token bucket?', a: 'When you want to *delay* rather than reject -- smoothing bursty traffic to a fragile downstream that must never exceed a fixed rate. The cost is added latency, and the queue must still be bounded.' },
    { q: 'Why must a distributed limiter use a Lua script?', a: 'Read-modify-write across many instances interleaves, so the effective limit becomes the true limit times the concurrency. Lua runs on Redis\'s single command thread, making the decision indivisible. Keep it to one key so it survives cluster resharding, and pass the timestamp in from the caller.' },
    { q: 'Why is limiting on IP address dangerous?', a: 'Carrier-grade NAT can put hundreds of thousands of mobile subscribers behind one IPv4 address, so one script blocks a region. Conversely, an IPv6 household has a /64 -- 18 quintillion addresses -- so per-address limiting is trivially evaded. Limit identity when authenticated, and prefixes for IPv6.' },
    { q: 'Distinguish rate, concurrency and quota limits.', a: 'Rate bounds arrival frequency. Concurrency bounds resources held simultaneously, which is what actually causes outages and is right for long-running work. Quota bounds total consumption over a billing period and must be accurate and auditable.' },
    { q: 'Why does rate limiting not solve noisy neighbours?', a: 'It caps demand but does not allocate supply. Every tenant can be within their limit while the sum exceeds capacity, and requests differ in cost by orders of magnitude. You need cost weights, per-tenant concurrency limits and weighted fair queueing.' },
    { q: 'What is deficit round robin and why use it?', a: 'Each per-tenant queue receives a quantum of credit per round, dequeues while credit remains, and carries the remainder forward. It is O(1) per dequeue, handles variable item costs correctly, and redistributes idle tenants\' shares so isolation does not waste capacity.' }
  ],

  drills: [
    {
      prompt: 'A B2B analytics API serves 8,000 tenants at 30,000 rps from 50 instances. One tenant starts a backfill: 800 rps of a query that scans 90 days of data. Every other tenant\'s p99 goes from 120 ms to 3 s. The backfilling tenant is within their contracted 1,000 rpm-per-key limit across 60 API keys. Design the fix.',
      probes: [
        'Why did the existing rate limit not prevent this?',
        'What is the right limit key here, given 60 API keys on one account?',
        'Which limit type actually protects the database?',
        'What do you return to the backfilling tenant, and how do they discover the constraint?',
        'How do you ensure the other 7,999 tenants are unaffected next time, even if the limits are wrong?'
      ],
      strong: [
        'Identifies that per-key limits aggregate to 60,000 rpm per account -- the key must be the account, with per-key limits nested beneath it.',
        'Notes that a request count is not a cost measure, and proposes per-endpoint weights debited from the bucket.',
        'Adds a per-tenant concurrency semaphore on the database pool as the limit that actually protects the resource.',
        'Proposes weighted fair queueing so one tenant\'s backlog cannot delay others even when legal.',
        'Returns `429` with `Retry-After` plus `RateLimit-*` on successes so the client can self-pace before rejection.',
        'Offers a legitimate path for the workload -- an async export or bulk endpoint with its own queue and quota.',
        'Adds per-tenant latency and cost metrics so "who is expensive" is answerable during an incident.',
        'Considers moving that tenant to a dedicated read replica or cell if this recurs.'
      ],
      weak: [
        'Lowers the global rate limit for everyone.',
        'Blocks the tenant with no communication or alternative path.',
        'Adds Redis capacity.',
        'Never distinguishes request count from request cost.',
        'Relies on rate limiting alone and never mentions concurrency or queueing.'
      ]
    },
    {
      prompt: 'You are building the limiter for a payments API. Requirements: enterprise customers get 10,000 rps with bursts to 20,000; free tier gets 100 per day; login endpoints allow 5 attempts per 15 minutes per account; and the limiter must not be able to cause an outage. Specify the design, including behaviour when Redis is unavailable.',
      probes: [
        'Which algorithm for each of the three limits, and why different ones?',
        'Where is each enforced, and why not all in one place?',
        'What happens to each limit when Redis is down?',
        'How do you keep 10,000 rps of limiter checks from adding a round trip to every request?',
        'How does a client know its state before being rejected?'
      ],
      strong: [
        'Token bucket for the enterprise rate, with capacity expressing the 20,000 burst explicitly.',
        'Sliding window log or a durable counter for the daily free-tier quota, noting it must survive restarts and reconcile with billing.',
        'Sliding window log for login attempts, because the limit is small and exactness matters for security.',
        'Enforces volumetric defence at the edge, quotas at the gateway, and account-level fairness in the service.',
        'Fail-open for the enterprise rate limiter, fail-closed for login and for the billing quota, and states this as a per-limiter policy.',
        'Local leased token blocks or per-instance fallback limits at global-limit-over-instance-count to cut coordination at 10,000 rps.',
        'Bounds the overshoot from batching explicitly and states the number rather than hand-waving.',
        'Emits `RateLimit-*` on every response so clients self-pace, and `Retry-After` on every rejection.',
        'Handles clock skew by passing caller timestamps and notes it as part of the error budget.'
      ],
      weak: [
        'Uses one algorithm for all three limits.',
        'Enforces everything in one place.',
        'Applies a single fail-open or fail-closed policy globally.',
        'Adds a Redis round trip to all 10,000 rps without discussing the cost.',
        'Returns `429` with no headers or retry guidance.'
      ]
    }
  ]
};
