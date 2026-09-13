export default {
  blocks: [
    { t: 'prose',
      md: `A container is a normal Linux process that has been lied to about what it can see. A Kubernetes cluster is a control
loop that keeps trying to make reality match a description you wrote down. And a deploy is the moment you replace
working code with code that has never served a real user.

The interesting engineering is not in any of those individually. It is in the failure modes that appear when they
interact: a health check pointed at the wrong thing, a memory limit set from a guess, or a schema migration that
assumes only one version of your application is running.` },

    { t: 'h', text: 'Containers, briefly and correctly' },
    { t: 'prose',
      md: `There is no such thing as a container in the Linux kernel. There is a process, plus three mechanisms.

**Namespaces** control what a process can *see*: a PID namespace makes your process pid 1 and hides the host's
processes, a mount namespace gives it its own filesystem view, a network namespace its own interfaces and routing
table. Isolation of visibility, not of resources. **cgroups** control what it can *use* -- CPU shares and quota,
memory limit, IO bandwidth, pid count -- and this is where resource limits are actually enforced, so cgroup v2 is
what produces the throttling and OOM-kill behaviour later in this topic. **Union filesystem layers** are how images
ship: each instruction produces a content-hashed read-only layer with one writable layer on top, and shared layers
are pulled once per node, which is why installing dependencies before copying application code turns a 2-minute
image pull into a 5-second one.

Two consequences worth knowing. A container shares the host kernel, so it is **not a security boundary** the way a
VM is -- container escape via a kernel vulnerability is a real class of CVE, which is why untrusted multi-tenant
workloads use gVisor, Kata or Firecracker. And **anything written into a layer stays in the image forever**, so a
secret added in one layer and deleted in the next is still extractable.` },

    { t: 'h', text: 'Kubernetes: the objects that matter and the loop' },
    { t: 'prose',
      md: `Kubernetes is a set of controllers, each running the same loop: read desired state, observe actual state, take one
step to close the gap, repeat. Nothing is imperative. When you "delete a pod" you are recording a desired state, and
a controller notices and acts. This is why your change sometimes appears not to happen -- you have described
something no controller can satisfy, and the explanation is in the events, not the logs.` },
    { t: 'diagram',
      code: `flowchart TB
  D["Deployment<br/>desired: 6 replicas, image v2"] --> RS["ReplicaSet v2"]
  D -.->|kept for rollback| RS1["ReplicaSet v1<br/>scaled to 0"]
  RS --> P1["Pod"]
  RS --> P2["Pod"]
  SCH["Scheduler<br/>bin-packs by requests"] --> P1
  SVC["Service<br/>stable virtual IP"] --> EP["EndpointSlice<br/>ready pods only"]
  EP --> P1
  EP --> P2
  ING["Ingress / Gateway"] --> SVC
  HPA["HPA"] -->|scales| D
  PDB["PodDisruptionBudget<br/>minAvailable 5"] -.->|gates evictions| P1`,
      caption: 'The Service sends traffic only to pods in EndpointSlices, and only ready pods are listed. That single fact is why readiness probes matter more than liveness probes.' },
    { t: 'prose',
      md: `The **scheduler** is a bin-packing algorithm, and it packs by *requests* -- not by actual usage and not by limits.
It filters nodes that cannot fit the pod's requests or violate its constraints, scores the survivors, and binds the
pod. That means your \`requests\` values are the sole input to capacity planning: set them far above real usage and
you pay for idle nodes; set them far below and the scheduler cheerfully overcommits a node into resource starvation.

The objects that repay understanding: **Deployment** (declares replicas and manages ReplicaSets, which is how
rollback works -- the old ReplicaSet is kept at zero replicas), **Service** (a stable virtual IP plus DNS name that
load-balances across ready pods), **EndpointSlice** (the actual list of ready pod IPs, and the thing that changes
when a readiness probe flips), **StatefulSet** (stable identities and per-pod storage, for anything with a disk or a
cluster membership), **PodDisruptionBudget** (a floor on availability during *voluntary* disruption), and
**HorizontalPodAutoscaler**.` },

    { t: 'h', text: 'Requests, limits, and the two failure modes' },
    { t: 'prose',
      md: `\`requests\` is what the scheduler reserves. \`limits\` is the ceiling the kernel enforces. CPU and memory behave
completely differently at the limit, and this asymmetry is the single most valuable Kubernetes detail to actually
understand.

**CPU is compressible.** A CPU limit is a cgroup quota: within each 100 ms period, your container may consume at
most \`limit x 100 ms\` of CPU time. Exceed it and the kernel **throttles** -- every runnable thread is descheduled
until the next period begins. The consequence is brutal for latency: a multi-threaded JVM or Go service with
\`limits.cpu: 1\` and eight worker threads can burn its entire 100 ms quota in 12 ms of wall time and then sit
frozen for 88 ms. Your p99 has a floor of ~90 ms and average CPU utilisation reads 40%, so every dashboard says you
have headroom. \`container_cpu_cfs_throttled_seconds_total\` is the metric that reveals it, and almost nobody has it
on a dashboard.

**Memory is incompressible.** There is no way to give a process less memory than it is using, so exceeding the
memory limit means the kernel OOM-kills the container. Exit code 137, no stack trace, no graceful shutdown,
in-flight requests dropped. If it happens repeatedly you get \`CrashLoopBackOff\`, and because a JVM or Node heap
grows to fill what it is given, an undersized limit produces a crash loop under exactly the load where you needed
the service.` },
    { t: 'code',
      lang: 'yaml',
      title: 'The configuration most teams get wrong',
      code: `resources:
  requests:
    cpu:    "500m"      # scheduler reserves this; base it on observed p50-p90
    memory: "512Mi"
  limits:
    # No CPU limit. Requests already give proportional-share fairness under
    # contention, and a limit only adds throttling. Omit it for latency-sensitive
    # services; set it when you must bound a noisy neighbour.
    memory: "512Mi"     # equal to request -> Guaranteed QoS, evicted last

# JVM and Node do not read cgroup limits by default on older runtimes.
# Tell the runtime about its ceiling or it will size its heap from the HOST.
env:
  - name: JAVA_OPTS
    value: "-XX:MaxRAMPercentage=75 -XX:+UseContainerSupport"
  - name: NODE_OPTIONS
    value: "--max-old-space-size=384"     # ~75% of a 512Mi limit

# Eviction order under node pressure: Guaranteed (requests == limits) last,
# Burstable (requests < limits) next, BestEffort (neither set) first.` },
    { t: 'numbers',
      title: 'Throttling arithmetic for `limits.cpu: 1`, 8 threads',
      items: [
        { v: '100 ms', k: 'CFS period', note: 'The default quota window' },
        { v: '12.5 ms', k: 'Wall time to burn the quota', note: '8 threads x 12.5 ms = 100 ms of CPU' },
        { v: '87.5 ms', k: 'Frozen until the next period', note: 'A hard floor added to your tail latency' },
        { v: '~40%', k: 'Average CPU shown on dashboards', note: 'Which is why nobody suspects throttling' }
      ] },
    { t: 'note',
      tone: 'warn',
      title: 'The CPU-limit position, stated honestly',
      md: `Removing CPU limits is widely recommended and it is not free. CPU *requests* already provide proportional-share
fairness, so an unlimited pod cannot starve a neighbour that has requests set -- it can only use idle capacity that
would otherwise be wasted. The cost is non-deterministic performance (your service is faster on an empty node) and
the loss of a hard bound on a genuinely runaway process. The defensible position: omit CPU limits for
latency-sensitive services with correct requests, and keep them for batch and untrusted workloads. Never remove
memory limits -- memory cannot be reclaimed by throttling.` },

    { t: 'h', text: 'Probes, and the cascading-restart mistake' },
    { t: 'table',
      cols: ['Probe', 'On failure', 'Should check', 'Must never check'],
      rows: [
        ['**Startup**', 'Keeps restarting until the timeout, then kills', 'Has initialisation finished?', 'Anything -- it exists so slow starts do not trip liveness'],
        ['**Readiness**', 'Pod removed from EndpointSlices; no traffic, no restart', 'Can I serve a request right now? Including dependency health, if failing is better than serving errors.', 'Nothing fatal -- this probe is safe to fail'],
        ['**Liveness**', '**Container is killed and restarted**', 'Is this process wedged in a way only a restart fixes -- deadlock, corrupt state?', '**Any external dependency.** This is the classic outage.']
      ] },
    { t: 'prose',
      md: `The mistake is writing one \`/health\` handler that checks the database and wiring it to both probes. It looks
thorough and it is a distributed-systems footgun.

Trace it. The database has a 30-second blip. Every pod's liveness probe fails. Kubernetes kills **every pod in the
fleet simultaneously**. They restart, and now you have a cold start storm: empty caches, a stampede of new
connections hammering the database that was already struggling, and JIT warm-up latency on every request. The
database gets worse, the probes fail again, and the restart loop is now self-sustaining. You have converted a
30-second degradation into a 20-minute outage, and the mechanism is your own health check.

The rule: **liveness answers only "is this process broken in a way a restart would fix". Nothing external belongs in
it.** A database outage is not fixed by restarting your application, so restarting cannot be the correct response,
and any probe that triggers it is wrong. Put the dependency check in readiness, where failure removes the pod from
load balancing without killing it -- if every pod goes unready you have a fleet with no endpoints, which is bad but
*recoverable the instant the dependency returns*, with no cold starts and no stampede. And even in readiness, weigh
it: if your service can serve 70% of its endpoints without the recommendations database, going unready takes down
the 70% too, so degraded responses plus SLO alerts often beat removing yourself from rotation.` },
    { t: 'code',
      lang: 'yaml',
      title: 'Probes that do not amplify an outage',
      code: `startupProbe:                  # buys a slow JVM 150s without tripping liveness
  httpGet: { path: /internal/started, port: 8080 }
  periodSeconds: 5
  failureThreshold: 30

readinessProbe:                # checks dependencies; failure sheds traffic only
  httpGet: { path: /internal/ready, port: 8080 }
  periodSeconds: 5
  failureThreshold: 3

livenessProbe:                 # process-local ONLY. No DB, no cache, no upstream.
  httpGet: { path: /internal/alive, port: 8080 }
  periodSeconds: 10
  failureThreshold: 6          # ~60s of grace before a kill

# /internal/alive   -> 200 if the event loop turns and no thread pool is deadlocked
# /internal/ready   -> 200 if the pool has capacity AND we are not draining (503 on SIGTERM)
# /internal/started -> 200 once config and caches are loaded

# Termination. Grace period must exceed preStop + your longest request, or the
# kubelet sends SIGKILL and in-flight work is lost.
terminationGracePeriodSeconds: 60      # 10s propagation + 45s drain + 5s slack
lifecycle:
  preStop:
    exec: { command: ["/bin/sh", "-c", "sleep 10"] }` },

    { t: 'h', text: 'Graceful shutdown: the deploy-time 502s' },
    { t: 'prose',
      md: `When a pod is terminated, two things happen **concurrently and independently**: the kubelet sends \`SIGTERM\` to
your process, and the endpoint controller begins removing the pod's IP from EndpointSlices. There is no ordering
guarantee, and endpoint removal must then propagate to every kube-proxy or ingress controller in the cluster --
which takes a few hundred milliseconds to several seconds.

So if your process exits immediately on \`SIGTERM\`, there is a window where load balancers are still sending it
traffic and nothing is listening. That is the source of the 502s that appear on every deploy and get dismissed as
"normal".

The fix is to make the pod *fail readiness first and keep serving*, then exit only after the endpoint removal has
propagated.` },
    { t: 'steps',
      ordered: true,
      title: 'Correct termination sequence',
      items: [
        'A `preStop` hook sleeps 5-15 seconds. This does nothing except hold the pod alive and still-serving while endpoint removal propagates through every proxy in the cluster.',
        'Your `SIGTERM` handler immediately starts returning 503 from the readiness endpoint, so any lagging load balancer marks the pod down.',
        'Stop accepting new connections and stop consuming from queues, but keep serving in-flight requests to completion.',
        'Flush what must not be lost: commit consumer offsets, drain the outbox relay, complete open transactions.',
        'Exit cleanly. `terminationGracePeriodSeconds` must exceed preStop plus your longest request, or the kubelet sends `SIGKILL` and you lose in-flight work.'
      ] },
    { t: 'note',
      tone: 'warn',
      md: `If your p99.9 request takes 30 seconds, a 30-second grace period silently truncates it. Genuinely
long-running jobs need a different pattern altogether -- checkpoint and resume -- because no grace period is long
enough to wait for them.` },

    { t: 'h', text: 'Autoscaling on the right metric' },
    { t: 'prose',
      md: `The HPA default is CPU utilisation as a percentage of *requests*, and for many services it is the wrong signal. If
your service is IO-bound -- waiting on a database or a downstream API -- CPU stays flat at 20% while request latency
triples, so the HPA never reacts to the thing that is actually hurting users.

Scale on the metric closest to the queue. For an HTTP service that is usually **requests per second per pod** or
**in-flight concurrency**, both of which respond immediately. For a queue consumer it is **consumer lag** or **queue
depth per pod**, via KEDA or an external metrics adapter -- CPU on a consumer tells you almost nothing about
backlog.

The second half of autoscaling is not oscillating. Kubernetes gives you \`behavior\` policies: scale up fast because
being under-provisioned hurts users, and scale down slowly because flapping costs more than the idle capacity. A
300-second scale-down stabilisation window is a reasonable default.

And know the ceiling. An HPA cannot help if new pods take 4 minutes to become ready, if you are out of node capacity
(you need the cluster autoscaler, plus over-provisioned placeholder pods to absorb the node-boot delay), or if the
bottleneck is a shared database that more pods will simply overwhelm faster. Scaling the stateless tier into a
saturated database makes the incident worse, and recognising that is a senior instinct.` },
    { t: 'code',
      lang: 'yaml',
      title: 'HPA on RPS with asymmetric scaling behaviour',
      code: `kind: HorizontalPodAutoscaler        # autoscaling/v2
spec:
  minReplicas: 6                     # survive an AZ loss without a scale event
  maxReplicas: 60
  metrics:
    - type: Pods
      pods:
        metric: { name: http_requests_per_second }
        target: { type: AverageValue, averageValue: "120" }
  behavior:
    scaleUp:                         # react immediately, up to double per 30s
      stabilizationWindowSeconds: 0
      policies: [{ type: Percent, value: 100, periodSeconds: 30 }]
    scaleDown:                       # 5 min of calm, then at most 10% a minute
      stabilizationWindowSeconds: 300
      policies: [{ type: Percent, value: 10, periodSeconds: 60 }]
---
kind: PodDisruptionBudget            # gates VOLUNTARY disruption only: node
spec:                                # drains and upgrades, not a node dying.
  minAvailable: 5
  selector: { matchLabels: { app: checkout } }` },
    { t: 'note',
      tone: 'warn',
      md: `A PDB with \`minAvailable\` equal to your replica count blocks node drains entirely, so cluster upgrades hang and
the platform team files a ticket against you. A PDB with no budget at all lets a drain take every pod at once. Set
\`minAvailable\` to the number you genuinely need to serve traffic, which should be below your replica count -- and
make sure your HPA \`minReplicas\` is above it.` },

    { t: 'h', text: 'Rolling, blue-green and canary' },
    { t: 'table',
      cols: ['Strategy', 'Mechanism', 'Rollback', 'Extra capacity', 'Catches', 'Costs'],
      rows: [
        ['**Rolling**', 'Replace pods incrementally with `maxSurge`/`maxUnavailable`', 'Roll forward or back to the old ReplicaSet -- minutes', '~25%', 'Crashes and failed probes only', 'Both versions serve simultaneously, so schema and API compatibility is mandatory'],
        ['**Blue-green**', 'Full second environment; flip the router', 'Instant -- flip back', '100%', 'Anything you test before the flip', 'Double cost; database is still shared, so migrations remain hard'],
        ['**Canary**', 'Route 1% -> 5% -> 25% -> 100%, comparing metrics at each step', 'Automatic on metric regression', '~5-10%', 'Latency and error regressions under real traffic', 'Needs per-version metrics and a defined analysis; slower rollout'],
        ['**Shadow / mirror**', 'Duplicate real traffic to the new version, discard responses', 'Nothing to roll back', '~100% of one tier', 'Performance and crash behaviour with zero user risk', 'Side effects must be suppressed, which is genuinely hard']
      ] },
    { t: 'prose',
      md: `Canary is the only one of these that catches a *performance* regression before most users see it, and that is the
common case -- a deploy that does not crash, passes every probe, and is 40% slower at p99. Automated canary analysis
(Argo Rollouts with an AnalysisTemplate, or Flagger) compares the canary's error rate and latency against the stable
version over a few minutes and aborts on regression.

The details that make it work: compare against the **stable version running concurrently**, not against yesterday's
baseline, so time-of-day effects cancel out. Require a **minimum sample count** before judging, or a 1% canary at
low traffic will trip on three unlucky requests. And route by a **sticky key** -- session or user -- so one user
does not oscillate between versions mid-flow.` },
    { t: 'code',
      lang: 'yaml',
      title: 'Argo Rollouts canary with automated abort',
      code: `strategy:
  canary:
    steps:                                  # analysis gates every weight bump
      - { setWeight: 1 }
      - { pause: { duration: 5m } }
      - { analysis: { templates: [{ templateName: slo-gate }] } }
      - { setWeight: 10 }
      - { pause: { duration: 10m } }
      - { analysis: { templates: [{ templateName: slo-gate }] } }
      - { setWeight: 50 }
---
kind: AnalysisTemplate                      # slo-gate
spec:
  metrics:
    - name: success-rate
      interval: 1m
      count: 5                              # minimum sample before judging
      successCondition: result[0] >= 0.99
      failureLimit: 1                        # one bad interval aborts + rolls back
      provider: { prometheus: { query: |
        sum(rate(http_requests_total{ver="{{args.canary}}",code!~"5.."}[2m]))
        / sum(rate(http_requests_total{ver="{{args.canary}}"}[2m])) } }
    - name: p99-latency                     # the regression rolling deploys miss
      successCondition: result[0] <= 0.4
      provider: { prometheus: { query: |
        histogram_quantile(0.99, sum by (le) (
          rate(http_request_duration_seconds_bucket{ver="{{args.canary}}"}[2m]))) } }` },

    { t: 'h', text: 'Zero-downtime schema migration: expand, migrate, contract' },
    { t: 'prose',
      md: `Every deployment strategy above runs two versions of your application at the same time. That means **your database
schema must be compatible with both the old and the new code, simultaneously** -- and it means you can never do a
migration that only the new code understands.

The discipline is three phases, and the crucial rule is that each phase is a **separate deploy** that is
independently safe to roll back.` },
    { t: 'diagram',
      code: `flowchart LR
  S0["Deploy 0<br/>code reads/writes<br/>full_name"] --> E["EXPAND<br/>add nullable<br/>first_name, last_name"]
  E --> S1["Deploy 1<br/>write BOTH<br/>read full_name"]
  S1 --> B["BACKFILL<br/>batched, throttled"]
  B --> S2["Deploy 2<br/>write BOTH<br/>read new columns"]
  S2 --> S3["Deploy 3<br/>write and read<br/>new only"]
  S3 --> C["CONTRACT<br/>drop full_name"]`,
      caption: 'Renaming one column is four deploys and two migrations. Every arrow is independently reversible.' },
    { t: 'code',
      lang: 'sql',
      title: 'Renaming `full_name` to `first_name` + `last_name`, fully worked',
      code: `-- ============ EXPAND (migration 1, no deploy dependency) ============
-- Nullable with no default: instant in Postgres 11+, no table rewrite, no lock.
ALTER TABLE users ADD COLUMN first_name text;
ALTER TABLE users ADD COLUMN last_name  text;
-- Old code ignores them. Safe to roll back by dropping them.

-- ============ DEPLOY 1: dual write, read old ============
-- Every write path populates full_name AND first_name/last_name.
-- Reads still use full_name, so a rollback to Deploy 0 loses nothing.

-- ============ BACKFILL (out of band, resumable, throttled) ============
-- Never a single UPDATE: millions of row locks, WAL bloat, replication lag.
-- One batch, driven by a loop that records last_id and sleeps between rounds:
WITH batch AS (
  SELECT id FROM users
   WHERE id > :last_id AND first_name IS NULL AND full_name IS NOT NULL
   ORDER BY id LIMIT 5000                 -- PK order makes it resumable
)
UPDATE users u
   SET first_name = split_part(u.full_name, ' ', 1),
       last_name  = substr(u.full_name, strpos(u.full_name, ' ') + 1)
  FROM batch WHERE u.id = batch.id
RETURNING u.id;                           -- max(id) becomes the next :last_id
-- Commit each batch (short transactions let replicas keep up), then sleep
-- ~100 ms, and pause entirely whenever replication lag exceeds a threshold.

-- ============ DEPLOY 2: dual write, read NEW ============
-- Reads switch to first_name/last_name. Still writing full_name, so
-- rolling back to Deploy 1 is safe and loses nothing.

-- ============ DEPLOY 3: new only ============
-- Stop writing full_name. Now the column is dead but still present:
-- rollback to Deploy 2 still works because the column exists.

-- ============ CONTRACT (migration 2, days later) ============
ALTER TABLE users DROP COLUMN full_name;
-- Only after: Deploy 3 is stable, and no rollback target still reads it.` },
    { t: 'table',
      title: 'Postgres DDL: which operations are actually safe online',
      cols: ['Operation', 'Lock and cost', 'Safe pattern'],
      rows: [
        ['Add nullable column, no default', '`ACCESS EXCLUSIVE` but metadata-only -- microseconds', 'Safe. Always set `lock_timeout` anyway.'],
        ['Add index', '`SHARE` -- blocks all writes for the build', '`CREATE INDEX CONCURRENTLY` -- slower, no write block, can leave an invalid index to retry'],
        ['Add `NOT NULL`, or add a foreign key', 'Full table scan under `ACCESS EXCLUSIVE`; an FK locks both tables', 'Add it `NOT VALID` first, then `VALIDATE CONSTRAINT` separately under a weaker lock'],
        ['Change column type', 'Full rewrite plus index rebuilds', 'New column, dual write, backfill, swap -- the expand/contract dance'],
        ['Rename column or table', 'Instant, and breaks every running old pod', '**Never rename.** Expand and contract instead.'],
        ['Drop column', 'Metadata-only, instant', 'Safe -- but only after no rollback target reads it']
      ] },
    { t: 'note',
      tone: 'danger',
      title: 'The lock queue nobody expects',
      md: `A DDL statement waiting for \`ACCESS EXCLUSIVE\` blocks every subsequent query on that table, even plain
\`SELECT\`s, because lock requests queue in order. So an \`ALTER TABLE\` stuck behind one long-running analytics
query takes your table completely offline while appearing to be "just waiting". Always \`SET lock_timeout = '3s'\`
before DDL so the migration fails fast and retries instead of forming a queue -- and check \`pg_stat_activity\` for
long transactions first.` },

    { t: 'h', text: 'Configuration, secrets and GitOps' },
    { t: 'prose',
      md: `Configuration belongs outside the image so the same artifact can be promoted from staging to production unchanged
-- if you rebuild per environment, you have not tested what you ship. ConfigMaps and environment variables cover
most of it; mounted files are better for anything large or reloadable.

Secrets need more. A Kubernetes Secret is base64, not encryption, and is readable by anyone with get access to the
namespace, so it needs encryption at rest on etcd plus tight RBAC as a minimum. The better pattern is short-lived
credentials issued against a workload identity: External Secrets Operator or the Vault agent injector fetches a
one-hour database password at pod start, so no long-lived secret exists to leak and rotation stops being a project.
For secrets that must live in Git, sealed-secrets or SOPS with a KMS key give you encrypted-at-rest manifests.

**GitOps** makes the Git repository the desired state and has a controller -- Argo CD or Flux -- continuously
reconcile the cluster toward it. Every change is a reviewed commit, drift is detected and corrected automatically,
rollback is \`git revert\`, and actual cluster state is auditable from the repo. The friction is real too: emergency
changes must still go through Git or the controller reverts them, and a bad commit deploys everywhere the controller
watches, which is what sync waves and per-environment progressive delivery exist to contain.` },

    { t: 'h', text: 'Trade-offs' },
    { t: 'tradeoffs',
      gains: [
        'Declarative desired state plus reconciliation means self-healing without human intervention.',
        'Bin-packing raises hardware utilisation from single-digit percentages on dedicated VMs to 50-70%.',
        'One deployment interface for every service, so on-call knowledge transfers across teams.',
        'Canary with automated analysis catches latency regressions that no test suite would.',
        'Expand/migrate/contract makes schema change routine rather than a maintenance window.',
        'GitOps gives you an audit trail, drift correction and `git revert` as a rollback mechanism.'
      ],
      costs: [
        'A large operational surface with genuinely non-obvious failure modes -- throttling, OOMKill, probe cascades.',
        'Every deploy runs two code versions at once, so backwards compatibility is a permanent constraint on schema and API design, and a column rename becomes four deploys over days.',
        'Requests and limits are guesses until you have production data, and both directions of error are expensive.',
        'Containers are not a security boundary, so untrusted workloads need extra isolation.',
        'Canary requires per-version metrics, a defined analysis and enough traffic for the sample to mean anything.',
        'GitOps means emergency changes are slower, and one bad commit can reach every watched cluster.'
      ] },
    { t: 'failures',
      items: [
        { mode: 'Liveness probe checks the database', blast: 'A 30-second database blip kills every pod at once; cold starts stampede the database and the restart loop becomes self-sustaining. A brief degradation becomes a 20-minute outage.', fix: 'Liveness is process-local only. Dependency checks go in readiness, where failure sheds traffic without killing the pod.' },
        { mode: 'CPU limit throttling a multi-threaded service', blast: 'p99 latency has an ~90 ms floor while average CPU reads 40%, so every dashboard says there is headroom and the cause is invisible.', fix: 'Alert on `container_cpu_cfs_throttled_seconds_total`; remove CPU limits for latency-sensitive services and size requests from observed usage.' },
        { mode: 'Memory limit below real working set', blast: 'OOMKill with exit 137, no stack trace, in-flight requests dropped; `CrashLoopBackOff` under exactly the load you needed to handle.', fix: 'Size from observed p99 RSS plus headroom, and tell the runtime its ceiling (`MaxRAMPercentage`, `--max-old-space-size`).' },
        { mode: 'No preStop hook', blast: '502s on every single deploy because endpoint removal has not propagated before the process exits.', fix: '`preStop` sleep of 5-15 s, return 503 from readiness on SIGTERM, drain in-flight, and a grace period exceeding preStop plus your longest request.' },
        { mode: 'Column renamed in one migration', blast: 'Old pods query a column that no longer exists; 100% errors on that path until the rollout completes, and rollback is impossible.', fix: 'Expand/migrate/contract: add, dual-write, backfill, switch reads, stop writing, drop -- four deploys, each independently reversible.' },
        { mode: 'Backfill as one big `UPDATE`, or DDL queued behind a long transaction', blast: 'Millions of row locks push replication lag into minutes; or a pending `ACCESS EXCLUSIVE` lock queues every subsequent `SELECT` and the table goes offline while the migration appears to be merely waiting.', fix: 'Bounded PK-ordered batches with a resumable high-water mark and a lag-gated throttle; `SET lock_timeout = \'3s\'` before DDL so it fails fast and retries.' },
        { mode: 'HPA on CPU for an IO-bound service', blast: 'Latency triples while CPU sits at 20%, so no scaling happens and the autoscaler looks perfectly healthy.', fix: 'Scale on RPS per pod or in-flight concurrency; for consumers, scale on queue lag via KEDA.' },
        { mode: 'PDB `minAvailable` equal to replica count', blast: 'Node drains never complete, cluster upgrades hang indefinitely, and the platform team escalates.', fix: 'Set `minAvailable` below the replica count to what you genuinely need to serve, and keep HPA `minReplicas` above it.' }
      ] },

    { t: 'staff',
      md: `Deployment questions are where interviewers find out whether someone has been paged during a rollout. The probe
answer and the migration answer are the two highest-signal moments.

- "Whose liveness probe checks the database? That is the outage. A database blip fails liveness on
  every pod, Kubernetes kills the whole fleet, and the cold-start stampede makes the database worse.
  Restarting my app does not fix the database, so restarting cannot be the right response -- that
  check belongs in readiness."
- "I would remove the CPU limit and keep the memory limit. CPU requests already give me
  proportional-share fairness, and a limit just adds CFS throttling: eight threads with a 1-core
  limit burn the 100 ms quota in 12 ms and then freeze for 88, which puts a floor under my p99
  while average CPU reads 40%. Memory cannot be reclaimed by throttling, so that limit stays."
- "You cannot rename that column. Rolling deploys mean both versions run at once, so it is four
  deploys: add nullable columns, dual-write, backfill in batches, switch reads, stop writing the
  old one, then drop it days later. Each step has to be independently reversible."
- "The backfill is the risky part, not the DDL. A single \`UPDATE\` over 40 million rows bloats
  WAL and pushes replication lag into minutes, which breaks every replica-backed read in the
  product. Bounded batches in primary-key order, a resumable high-water mark, and a throttle
  gated on replication lag."
- "I would set \`lock_timeout\` before any DDL. An \`ALTER TABLE\` waiting for
  \`ACCESS EXCLUSIVE\` queues every subsequent \`SELECT\` behind it, so one long analytics query
  turns a metadata change into a full table outage."
- "The 502s on deploy are not normal. Endpoint removal and SIGTERM happen concurrently, so I need
  a preStop sleep of about 10 seconds to let the removal propagate, readiness returning 503
  immediately on SIGTERM, and a grace period that exceeds preStop plus my longest request."
- "Canary, not blue-green, because the regression I actually expect is a 40% p99 increase that
  crashes nothing and passes every probe -- and I compare against the stable version running
  concurrently so time-of-day effects cancel. This service is also IO-bound, so a CPU-based HPA
  would never fire; I would scale on requests per second per pod, and check whether the real
  bottleneck is the database, because scaling the stateless tier into a saturated database just
  makes the incident arrive faster."

The pattern: name the mechanism, name the metric that reveals it, and name the specific configuration value you
would change. "Add monitoring" is not an answer; "\`container_cpu_cfs_throttled_seconds_total\`" is.` },

    { t: 'quiz',
      items: [
        {
          q: 'Your `/health` endpoint checks database connectivity and is used for both readiness and liveness. The database has a 30-second blip. What happens?',
          options: ['Pods are removed from load balancing and return when the database recovers.', 'Every pod fails liveness and is killed simultaneously, and the cold-start stampede prolongs the incident well past 30 seconds.', 'Kubernetes detects the shared cause and suppresses the restarts.', 'Only pods with active database connections restart.'],
          answer: 1,
          why: 'Liveness failure means kill and restart, and since the cause is shared, it happens to the entire fleet at once. You then get empty caches, a connection stampede against the already-struggling database, and JIT warm-up on every request -- so the probe re-fails and the loop sustains itself. A 30-second degradation becomes a 20-minute outage caused by your own health check. Liveness must only detect process-local wedges that a restart genuinely fixes; dependency checks belong in readiness, where failure sheds traffic without killing anything.' },
        {
          q: 'A Go service with `limits.cpu: "1"` and 8 goroutine workers shows p99 latency of 95 ms and average CPU utilisation of 40%. Most likely cause?',
          options: ['The service needs more memory.', 'CFS throttling: 8 threads burn the 100 ms quota in ~12 ms, then all freeze until the next period.', 'Network latency to the database.', 'The HPA has scaled down too far.'],
          answer: 1,
          why: 'A CPU limit is a quota per 100 ms period and parallel threads consume it in parallel -- eight threads each running 12.5 ms exhausts a 1-core quota, after which every thread is descheduled for the remaining 87.5 ms. That puts a ~90 ms floor under your tail latency while *average* utilisation reads 40% and suggests headroom. The revealing metric is `container_cpu_cfs_throttled_seconds_total`; the fix is to remove the CPU limit (requests still provide fair-share) or raise it above peak parallel demand.' },
        {
          q: 'You need to rename `full_name` to `first_name` and `last_name` in a 40M-row table with rolling deploys and no downtime. What is the minimum safe sequence?',
          options: ['`ALTER TABLE ... RENAME COLUMN` in a migration that runs before the new code.', 'Add nullable columns, deploy dual-write, backfill in batches, deploy read-new, deploy stop-writing-old, then drop the old column.', 'Blue-green deploy with the rename applied at cutover.', 'A short maintenance window with the rename and a single `UPDATE`.'],
          answer: 1,
          why: 'Rolling deploys guarantee both code versions serve simultaneously, so any schema the old version cannot read is an outage for as long as the rollout takes -- and rollback becomes impossible. Expand/migrate/contract keeps every intermediate state readable by both versions, and critically each step is a separate deploy that is independently reversible. Blue-green does not help because the database is shared between blue and green. The batched, throttled backfill matters as much as the DDL: a single `UPDATE` over 40M rows bloats WAL and pushes replication lag into minutes.' },
        {
          q: 'Every deploy produces a burst of 502s for about two seconds. Pods start correctly and probes pass. Most likely cause?',
          options: ['The readiness probe interval is too long.', 'No preStop hook -- the process exits on SIGTERM before endpoint removal has propagated to all proxies.', 'The image pull is slow.', '`maxSurge` is set too high.'],
          answer: 1,
          why: 'SIGTERM delivery and endpoint removal are concurrent and independent, and removal must propagate to every kube-proxy and ingress controller, which takes hundreds of milliseconds to seconds. A process that exits promptly on SIGTERM leaves a window where load balancers still route to a closed socket. The fix is a preStop sleep of 5-15 seconds so the pod keeps serving during propagation, a SIGTERM handler that immediately returns 503 from readiness, in-flight draining, and a grace period exceeding preStop plus your longest request.'
        }
      ] },

    { t: 'details',
      title: 'Related topics and how they connect',
      blocks: [{ t: 'prose',
        md: `Canary analysis is only as good as the SLIs behind it -- see **Observability, SLOs & Error Budgets** for burn-rate
alerting and why per-version metrics matter. Graceful shutdown and connection draining connect to pooling in
**Anatomy of a Backend Request** and to timeout budgets in **Resilience: Timeouts, Retries & Backpressure**.
Expand/migrate/contract is the same overlap-then-switch discipline as resharding in **Sharding & Partitioning**, and
the backfill throttle depends on replication lag from **Replication & Consistency Models**. Workload identity and
short-lived secret injection are covered in **Backend Security & Identity**.`
      }]
    }
  ],

  flashcards: [
    { q: 'What does the Kubernetes scheduler bin-pack by?', a: 'By `requests` only -- not by actual usage and not by limits. So requests are the entire input to capacity planning: set too high and you pay for idle nodes, too low and the scheduler overcommits the node into starvation.' },
    { q: 'Why is a CPU limit dangerous for a latency-sensitive service?', a: 'It is a CFS quota per 100 ms period, consumed in parallel by all threads. Eight threads with a 1-core limit burn the quota in 12.5 ms and then freeze for 87.5 ms, putting a ~90 ms floor under p99 while average CPU reads 40%. Watch `container_cpu_cfs_throttled_seconds_total`.' },
    { q: 'Why must a memory limit be set even though a CPU limit often should not?', a: 'Memory is incompressible -- there is no way to give a process less than it is using, so the kernel OOM-kills instead of throttling. Exit 137 with no stack trace and dropped in-flight requests. CPU can be throttled; memory cannot, so the limit is the only bound.' },
    { q: 'What must a liveness probe never check, and why?', a: 'Any external dependency. Liveness failure kills the container, and restarting your app does not fix someone else\'s database -- so a shared dependency blip kills the entire fleet at once and the cold-start stampede sustains the loop. Dependency checks belong in readiness.' },
    { q: 'Why do you need a preStop hook?', a: 'SIGTERM delivery and endpoint removal happen concurrently, and removal takes time to propagate to every proxy. A preStop sleep of 5-15 seconds keeps the pod serving during propagation, which is what eliminates the deploy-time 502s.' },
    { q: 'What should an HPA scale on for an IO-bound service?', a: 'Requests per second per pod or in-flight concurrency -- CPU stays flat at 20% while latency triples, so a CPU-based HPA never fires. Queue consumers should scale on consumer lag via KEDA. Scale up fast, scale down slowly (~300 s stabilisation).' },
    { q: 'What does expand/migrate/contract mean and why is it required?', a: 'Add the new schema (expand), run code that writes both and backfill, switch reads, stop writing the old, then drop it (contract). Required because rolling deploys run both code versions simultaneously, so every intermediate state must be readable by both and independently reversible.' },
    { q: 'How do you backfill 40M rows safely, and why set `lock_timeout` before DDL?', a: 'Bounded PK-ordered batches with a resumable high-water mark, short transactions so replicas keep up, and a throttle gated on replication lag. Set `lock_timeout` because DDL waiting for `ACCESS EXCLUSIVE` queues every subsequent query including plain `SELECT`s, so one long transaction turns a metadata change into a table outage.' },
    { q: 'What does canary catch that rolling and blue-green do not?', a: 'Performance regressions -- a deploy that crashes nothing, passes every probe, and is 40% slower at p99. Compare against the stable version running concurrently so time-of-day effects cancel, require a minimum sample size, and route by a sticky session key.' }
  ],

  drills: [
    {
      prompt: 'Your checkout service runs 20 pods on Kubernetes. Deploys produce a 2-second burst of 502s that the team treats as normal. Separately, p99 is 340 ms against a 200 ms SLO while average CPU sits at 35%, and last week a 40-second RDS failover caused a 25-minute full outage. Diagnose all three and fix them.',
      probes: [
        'Which of these three is the same root cause as another, and which are independent?',
        'Why did a 40-second database event cause a 25-minute outage?',
        'What metric would confirm your latency hypothesis, and would it be on a default dashboard?',
        'What exactly would you change in the manifest, and what are the new risks?',
        'How would you verify each fix before shipping it?'
      ],
      strong: [
        'Attributes the 502s to missing preStop plus immediate exit on SIGTERM, and prescribes a 10-second preStop sleep, readiness returning 503 on SIGTERM, in-flight draining, and a grace period exceeding preStop plus the longest request.',
        'Diagnoses the latency as CFS throttling from a CPU limit, does the quota arithmetic explicitly, and names `container_cpu_cfs_throttled_seconds_total` while noting it is not on default dashboards.',
        'Identifies the 25-minute outage as a liveness probe checking the database: the whole fleet is killed at once and the cold-start stampede sustains the loop long after the failover completed.',
        'Separates probes properly -- process-local liveness with a generous failure threshold, dependency-aware readiness, and a startup probe for slow initialisation.',
        'Discusses the risk of removing the CPU limit (non-deterministic performance, no hard bound on a runaway) and keeps the memory limit because memory cannot be throttled.',
        'Verification plan is concrete: a canary with per-version latency analysis, a deliberate pod-deletion test to confirm zero 502s, and a dependency-failure game day to confirm no mass restart.',
        'Checks that PDB `minAvailable` and HPA `minReplicas` are consistent so drains still complete.'
      ],
      weak: [
        'Treats deploy-time 502s as unavoidable, or fixes them by retrying at the client.',
        'Responds to high p99 with more replicas or a larger CPU limit without recognising throttling.',
        'Leaves the database check in liveness, or adds it to both probes for thoroughness.',
        'Removes the memory limit along with the CPU limit.',
        'No verification step, so the fixes are hypotheses shipped to production.'
      ] },
    {
      prompt: 'You must split a 60M-row `orders.shipping_address` text column into five structured columns, with no downtime, on a service that deploys twice a day via rolling updates. The table takes 4,000 writes/sec at peak and has two async read replicas whose lag currently sits under 200 ms and is relied upon by the customer-facing order history page.',
      probes: [
        'How many deploys is this, and what is the rollback target at each step?',
        'Which DDL statements are safe online on Postgres and which are not?',
        'How do you keep the backfill from breaking the order history page?',
        'What happens if you need to roll back after the contract step?',
        'How do you verify the backfill was correct before switching reads?'
      ],
      strong: [
        'Lays out four deploys and two migrations, naming the rollback target at each step and confirming each is independently reversible.',
        'Knows that adding nullable columns without a default is metadata-only and instant on modern Postgres, and that `NOT NULL` and foreign keys need the `NOT VALID` then `VALIDATE CONSTRAINT` two-step.',
        'Sets `lock_timeout` before DDL and checks `pg_stat_activity` for long transactions so the lock does not queue behind one and take the table offline.',
        'Designs the backfill as bounded PK-ordered batches with a resumable high-water mark, short transactions, and a throttle explicitly gated on replica lag -- pausing when lag exceeds a threshold because the order history page reads from replicas.',
        'Verifies with a checksum or row-count comparison between old and new representations before switching reads, and runs a shadow read comparing both for a period.',
        'States plainly that after the contract step the old column is gone and rollback past it is not possible, so contract happens days later once Deploy 3 is proven stable.',
        'Handles the parsing ambiguity of splitting free-text addresses: records unparseable rows for manual review rather than silently writing wrong data.'
      ],
      weak: [
        'Proposes a single migration with a rename or a one-shot `UPDATE`.',
        'Runs the backfill without throttling or without any regard for replica lag.',
        'Drops the old column in the same release that stops writing it.',
        'No verification of backfill correctness before switching reads.',
        'Assumes a maintenance window is available, or ignores that both code versions run concurrently.'
      ]
    }
  ]
};
