export default {
  blocks: [
    { t: 'prose',
      md: `Uber matching is not a graph problem on a whiteboard. It is a **race on a trip row** under
location streams that arrive ten times a second, a supply index that must stay fresh, and a demand
curve that spikes when rain starts. The interview question is really three coupled decisions: how you
partition space so a dispatch query is milliseconds not seconds, how you assign one driver to one
trip without double-booking, and how you shed load when supply cannot catch demand without lying
about ETAs.` },

    { t: 'h', text: 'Spatial indexes -- geohash, S2, and H3' },
    { t: 'prose',
      md: `You cannot scan every online driver in a city. You need a structure that answers "who is
near this pickup within the next matching radius?" in bounded time. **Geohash** encodes lat/lng into
a string prefix; nearby points often share a prefix, so a Redis \`ZSET\` keyed by geohash cell plus
a secondary distance check works for prototypes. The failure mode is edge cases: two points can be
physically adjacent but sit in different hash cells, so you must query the cell and all eight
neighbours.

**S2** and **H3** partition the sphere into hierarchical cells with stable IDs and explicit
neighbour relationships. H3 in particular gives you a hex grid where \`gridDisk(origin, k)\` returns
exactly the ring of cells to search -- no ambiguous neighbour enumeration. Production systems pick
H3 or S2 when they need consistent cell sizes at latitude and when they do analytics on supply
density by cell. Geohash remains fine when your matching radius is small relative to cell size and
you can afford the neighbour-query hack.` },
    { t: 'table',
      title: 'Spatial index trade-offs for dispatch',
      cols: ['', 'Geohash', 'S2', 'H3'],
      rows: [
        ['Cell shape', 'Rectangles -- distortion at poles', 'Quadrilateral hierarchy', 'Hexagons -- uniform adjacency'],
        ['Neighbour lookup', 'Manual 8-neighbour prefix expansion', 'Built-in', 'Built-in via gridDisk'],
        ['Hot cell risk', 'High -- downtown is one prefix', 'Mitigated by hierarchy', 'Mitigated; still possible at mega-events'],
        ['Typical store', 'Redis ZSET per cell, score = last seen', 'Cell id -> driver set in memory or Redis', 'Same; often paired with streaming ingest'],
        ['Reach for it when', 'MVP, small metro, tight team', 'Google-scale legacy, spherical math already in stack', 'New build, analytics on hex supply maps']
      ] },
    { t: 'diagram',
      code: `flowchart LR
  P["Pickup"] --> H3["H3 cell k=7"]
  H3 --> R["gridDisk k=1"]
  R --> D1["Driver A"]
  R --> D2["Driver B"]
  R --> D3["Driver C"]
  D1 --> ETA["Rank by ETA"]
  D2 --> ETA
  D3 --> ETA
  ETA --> OFF["Push offer to top N"]`,
      caption: 'Search is cell-local first, then rank candidates by road-network ETA -- not straight-line distance alone.' },

    { t: 'h', text: 'Dispatch as compare-and-set on the trip row' },
    { t: 'prose',
      md: `The canonical bug in matching design is treating "assign driver" as a separate RPC after
"find driver". Two dispatchers -- or two retrying clients -- can both pick the same driver, or two
drivers can accept the same trip. The fix is to make **assignment a single atomic transition on the
trip state machine**, not a join table you update later.

Model a trip row with \`status\`: \`SEARCHING -> OFFERED -> ACCEPTED -> EN_ROUTE -> COMPLETED\`.
When a driver taps accept, the server runs something equivalent to:

\`UPDATE trips SET status='ACCEPTED', driver_id=$d WHERE id=$t AND status='OFFERED' AND offered_driver_id=$d\`

If \`rows_affected = 0\`, the accept is stale -- another driver won, the offer expired, or the
client is replaying. Return a deterministic error and refresh UI state. Do not branch on "check
then update" in application code; the database or a strongly consistent row store is your
compare-and-set.

The same pattern handles **two drivers accept**: only the first CAS wins. The loser's app must
show "trip taken" and return them to available without leaving a ghost en-route state.` },
    { t: 'code',
      lang: 'sql',
      title: 'Accept is one conditional write',
      code: `-- Trip must be in OFFERED to this driver; anything else is a lost race.
UPDATE trips
SET status = 'ACCEPTED',
    driver_id = $driver_id,
    accepted_at = now()
WHERE id = $trip_id
  AND status = 'OFFERED'
  AND offered_driver_id = $driver_id
RETURNING *;

-- Driver availability is a second CAS on the driver row:
UPDATE drivers
SET status = 'ON_TRIP', current_trip_id = $trip_id
WHERE id = $driver_id
  AND status = 'AVAILABLE'
RETURNING *;` },

    { t: 'h', text: 'ETA vs matching radius' },
    { t: 'prose',
      md: `Matching radius is not a constant circle on a map. It is the answer to: "how far away can
a driver be and still arrive before the rider churns?" That depends on **road-network ETA**, traffic,
and product SLO -- not haversine distance.

Expand the H3 search ring until you have enough candidates or hit a max ETA ceiling (say 8
minutes). In supply-rich downtown, \`k=1\` may yield twenty drivers under 4 minutes. In a suburb at
2am, you may need \`k=4\` and still find nobody -- that is when surge and queue messaging kick in,
not when you silently widen forever and quote a 25-minute pickup.

Staff signal: say explicitly that **ETA drives the search frontier**, and that straight-line
prefilter plus OSRM/GraphHopper ETA ranking is the usual two-stage pipeline. Cache ETAs briefly;
stale traffic data is better than recomputing a full matrix per ping.` },

    { t: 'h', text: 'Surge as price to shed load' },
    { t: 'prose',
      md: `When offered rides exceed willing supply at the current price, you have queueing theory,
not a microservice problem. **Surge** is a price signal that shifts the demand curve: some riders
wait, some switch modes, some pay more. It is load shedding with a wallet instead of a \`503\`.

Implement surge per H3 cell (or geohash cell) from a smoothed ratio of open requests to available
drivers, with caps and ramp limits so price does not flicker every 30 seconds. The failure mode to
name in the interview: surge without **honest ETA** is worse than no surge -- riders pay 2.4x and
still wait 14 minutes because you matched radius to price instead of supply.

Surge also affects supply: higher earnings pull drivers toward hot cells. That feedback loop is
slow (minutes), so surge is not a substitute for short-term queue management -- it is the economic
layer on top of spatial search and accept CAS.` },

    { t: 'h', text: 'Idempotent accept and mobile retries' },
    { t: 'prose',
      md: `Drivers accept on flaky LTE. The client will retry the accept POST. Without idempotency,
retry can double-assign or flip a driver into an inconsistent state. Require an **idempotency key**
(\`Idempotency-Key: accept-{trip_id}-{driver_id}\` or a client-generated UUID) stored with the
accept outcome for 24 hours.

First accept runs the CAS and caches the result. Retries with the same key return the cached
\`ACCEPTED\` or \`LOST_RACE\` response without re-running side effects (push to rider, payment
pre-auth, etc.). This is the same pattern as payments: timeout on accept is an **unknown outcome**,
so the client must replay safely until it gets a definitive status.` },

    { t: 'h', text: 'Location stream vs poll' },
    { t: 'prose',
      md: `Driver location at dispatch time must be **seconds fresh**. Polling every 5 seconds from
one million drivers is 200k RPS of junk reads and guarantees stale positions during matching.

The production pattern is a **location stream**: drivers publish GPS on a WebSocket or gRPC stream
(typically 1--4 Hz when online, throttled when stationary). Ingest writes to a low-latency store --
Redis with TTL per driver, or a dedicated location service -- and optionally fan out to the spatial
index asynchronously. Dispatch reads the index plus last-known position timestamp; reject candidates
whose location is older than 15--30 seconds.

Poll is acceptable only for the rider app tracking an assigned driver after match, where 2--3
second cadence on a single trip id is cheap. Conflating "how we index supply" with "how we animate
the car on the map" is a common weak answer.` },
    { t: 'diagram',
      code: `sequenceDiagram
  participant D as Driver app
  participant L as Location ingest
  participant I as Spatial index
  participant M as Matcher
  D->>L: GPS stream 2 Hz
  L->>I: Upsert cell membership
  M->>I: Query gridDisk pickup
  I-->>M: Candidate ids
  M->>L: Fetch fresh coords
  M->>D: Push offer
  D->>M: Accept plus idempotency key`,
      caption: 'Matching reads the index; accept is a separate CAS path on the trip row.' },

    { t: 'h', text: 'Trade-offs' },
    { t: 'tradeoffs',
      title: 'Central matcher vs cell-sharded dispatch',
      gains: [
        'Single trip state machine -- CAS on one row is easy to reason about.',
        'Global ranking by ETA when supply is sparse at the edge of a cell.',
        'Simpler idempotency and audit trail for disputes.',
        'H3 hex grid gives predictable neighbour expansion for search rings.'
      ],
      costs: [
        'Hot-city matcher becomes a choke point without horizontal shard by region.',
        'Location stream ingest is a dedicated fleet -- poll does not scale.',
        'Surge smoothed per cell lags sudden demand ( stadium exit ).',
        'Two-stage ETA ranking adds dependency on routing service uptime.',
        'Strict CAS rejects create support load -- "I tapped accept and lost".'
      ] },

    { t: 'failures',
      items: [
        { mode: 'Check-then-set assign without CAS', blast: 'Two drivers marked on one trip; rider sees two cars or payment captures twice.', fix: 'Single conditional UPDATE on trip status; rows_affected=0 means lost race -- never separate find and assign.' },
        { mode: 'Geohash search without neighbour cells', blast: 'Best driver sits across a cell boundary; pickup times out despite nearby supply.', fix: 'Query origin cell plus 8 neighbours, or use H3 gridDisk with explicit k ring.' },
        { mode: 'Stale driver location in index', blast: 'Offer sent to driver who moved away; ETA lies and accept rate collapses.', fix: 'Reject candidates with location older than 15--30 s; stream ingest with TTL eviction.' },
        { mode: 'Accept retry without idempotency key', blast: 'Duplicate side effects -- double push to rider, driver stuck ON_TRIP after cancel.', fix: 'Idempotency-Key on accept; cache outcome; treat timeout as unknown until replay succeeds.' },
        { mode: 'Surge widened radius instead of price', blast: 'Long pickups at high price; supply burnout and rider trust loss.', fix: 'Surge adjusts price; matching radius capped by max ETA SLO, not by multiplier.' },
        { mode: 'Poll-based supply at scale', blast: 'Index always stale; matcher RPS explodes; p99 dispatch exceeds rider patience.', fix: 'Driver GPS stream into Redis or location service; poll only post-match for rider UI.' }
      ] },

    { t: 'staff',
      md: `Most candidates draw a box labeled "matching service." The signal is naming the **trip row
CAS** first, then the spatial index, then surge as economics.

- "Assign is \`UPDATE ... WHERE status=OFFERED\` -- if zero rows, someone else won. I never do find
driver in one service and assign in another without a single atomic transition."
- "Two drivers accepting is the same bug class as double-spend; idempotency keys on accept, and the
driver row gets its own CAS to AVAILABLE -> ON_TRIP."
- "I search H3 rings until I have N candidates under an ETA ceiling, not a fixed 3 km radius --
distance on a sphere is a prefilter, road ETA is the rank key."
- "Surge is load shedding via price; it does not replace honest ETAs or let me widen matching
forever. Cell-level smoothing so multiplier does not flicker when one driver goes offline."
- "Supply location is a stream at 1--4 Hz with TTL; poll is for the rider tracking one trip after
match, not for indexing a million drivers."

What this signals: you have seen race conditions in production, you treat dispatch as distributed
state not an algorithm, and you separate spatial search from the accept transaction.` },

    { t: 'quiz',
      items: [
        {
          q: 'Two drivers tap Accept within 200 ms on the same offer. What must happen?',
          options: [
            'Both get the trip; split fare or reassign later.',
            'First CAS on the trip row wins; second gets rows_affected=0 and a clear lost-race response.',
            'Lock the driver table for the whole metro until one completes.',
            'Whichever request reached the load balancer first wins; database order does not matter.'
          ],
          answer: 1,
          why: 'Without a conditional update on trip status, you get double assignment or inconsistent driver states. CAS makes the winner deterministic at the storage layer regardless of client retry timing. The loser must refresh to AVAILABLE without side effects -- not retry accept blindly.'
        },
        {
          q: 'Why is H3 gridDisk often preferred over raw geohash prefix search for dispatch?',
          options: [
            'H3 strings sort lexicographically by distance.',
            'Hex cells have uniform neighbour relationships -- gridDisk(k) is exact rings without ambiguous 8-neighbour prefix hacks.',
            'H3 eliminates the need for road-network ETA.',
            'Geohash cannot be stored in Redis.'
          ],
          answer: 1,
          why: 'Geohash neighbour queries break at cell boundaries and distort near poles. H3 gives explicit k-ring expansion on a hex grid, which makes matching radius a discrete parameter you can tune per market. You still need ETA ranking afterward -- H3 does not replace routing.'
        },
        {
          q: 'Accept POST times out on the driver phone. The driver taps Accept again. What is the safe server behaviour?',
          options: [
            'Run assign again; duplicate accepts mean the driver really wants the trip.',
            'Return 409 and force logout.',
            'Honor Idempotency-Key: replay the cached ACCEPTED or LOST_RACE outcome without re-running side effects.',
            'Assume failure and leave trip in OFFERED forever.'
          ],
          answer: 2,
          why: 'Timeout is unknown outcome, not failure -- the first accept may have succeeded. Idempotency keys let the client replay until a definitive status without double push, double payment hold, or flipping driver state twice. This is the same contract as payment capture.'
        },
        {
          q: 'Demand spikes in one H3 cell; available drivers are flat. What is surge doing in this design?',
          options: [
            'Increasing matching radius until everyone gets a car.',
            'Raising price to shift demand and attract supply over minutes -- not a substitute for max ETA caps.',
            'Pausing all dispatches until drivers arrive.',
            'Replacing CAS with a queue FIFO for fairness.'
          ],
          answer: 1,
          why: 'Surge is economic load shedding: some riders defer, others pay, drivers reroute toward hot cells on a slower feedback loop. Widening radius instead breaks ETA promises and burns supply. Matching still respects ETA ceiling; surge adjusts willingness to wait and pay.'
        }
      ] },

    { t: 'details',
      title: 'Related topics',
      blocks: [{
        t: 'prose',
        md: `Compare-and-set patterns and idempotency keys are developed in **Transactions & Isolation**
and **API Design & Contracts**. Queueing and shedding under spike load connect to **Rate Limiting &
Multi-Tenancy** and **Resilience Patterns**. Realtime ingest parallels **Queues & Streaming** for
location fanout.`
      }] }
  ],

  flashcards: [
    { q: 'Why is trip assignment modeled as CAS on the trip row?', a: 'So only one accept succeeds under concurrent drivers and retries. A conditional UPDATE on status=OFFERED makes the winner atomic; rows_affected=0 means lost race without a separate find-then-assign race window.' },
    { q: 'What breaks if you geohash-search without neighbour cells?', a: 'Drivers across a cell boundary are invisible despite being physically closest. You must query the origin cell plus neighbours or use H3 gridDisk rings so edge pickups still see adjacent supply.' },
    { q: 'How does surge relate to load shedding?', a: 'Surge raises price to shift demand when supply is insufficient at the current price -- economic shedding rather than HTTP 503. It works on a minutes-scale supply feedback loop and must not replace honest ETAs or unlimited radius expansion.' },
    { q: 'ETA vs matching radius -- which drives the other?', a: 'ETA drives the search frontier: expand H3 rings until you have enough candidates under a max pickup ETA SLO. Fixed km radius ignores traffic and churn; straight-line distance is only a cheap prefilter before road-network ranking.' },
    { q: 'Why idempotency keys on driver accept?', a: 'Mobile networks retry timed-out POSTs; timeout is unknown outcome not failure. Cached accept results per Idempotency-Key prevent duplicate assignment side effects when the client replays until it gets ACCEPTED or LOST_RACE.' },
    { q: 'Location stream vs poll for supply indexing?', a: 'Millions of drivers polling overwhelms the server and leaves stale positions. A 1--4 Hz GPS stream into Redis or a location service keeps the spatial index fresh; poll is fine post-match for one rider tracking one trip.' },
    { q: 'Two drivers accept -- what does the loser\'s app show?', a: 'Lost race from CAS returning zero rows: trip already ACCEPTED by another driver. Driver returns to AVAILABLE without en-route side effects; no silent overwrite of the winner\'s assignment.' }
  ],

  drills: [
    {
      prompt: 'Saturday 1:30 AM: riders in a suburb report 18-minute ETAs despite dots on the map nearby. Surge is 1.0x. Logs show matching finds candidates but 40% of offers expire with no accept. Design the fix and explain what you would measure.',
      probes: [
        'Could spatial index miss boundary drivers?',
        'Are ETAs computed on stale GPS?',
        'Is offer TTL too short for driver attention?',
        'Are you ranking straight-line distance instead of road ETA?',
        'What metrics prove the fix?'
      ],
      strong: [
        'Checks location TTL -- offers to drivers with >30 s stale position.',
        'Verifies H3 neighbour expansion in low-density cells -- k too small.',
        'Separates map dots (last seen) from eligible supply (fresh + AVAILABLE).',
        'Proposes two-stage rank: haversine prefilter then OSRM ETA ceiling.',
        'Names offer funnel metrics: offer->accept rate by cell, expire vs reject vs lost CAS.',
        'Considers driver app background throttling killing the location stream.'
      ],
      weak: [
        'Turn on surge without diagnosing supply freshness.',
        'Widen radius without ETA cap until everyone matches.',
        'Blame driver behavior only; no index or TTL audit.',
        'Add polling without calculating RPS at driver count.'
      ]
    },
    {
      prompt: 'Two datacenters run active-active dispatch for the same city. A network partition lasts 45 seconds. How do you prevent double assignment without killing availability for the whole metro?',
      probes: [
        'Can both sides CAS the same trip row?',
        'Where does trip state live?',
        'What happens to in-flight offers during partition?',
        'How do drivers reconcile after heal?'
      ],
      strong: [
        'Trip state in single-region strongly consistent store or consensus per trip shard.',
        'Partition: one side loses write quorum -- fail offers closed rather than split-brain assign.',
        'Idempotent accept replay after heal returns definitive status.',
        'Driver location is eventually consistent; accept is not.',
        'Mentions fencing tokens or lease on trip partition if using multi-master.'
      ],
      weak: [
        'Merge two accepted drivers after the fact.',
        'Last-write-wins on trip row.',
        'Ignore partition because "it is rare".'
      ]
    }
  ]
};
