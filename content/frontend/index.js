export default {
  id: 'frontend',
  short: 'fe',
  name: 'Frontend Systems',
  tagline: 'From URL to pixels, then from one app to a hundred teams.',
  blurb: `Frontend system design at Staff level is rarely about components. It is about what you
push to an adversarial, unreliable client you do not control, how you keep a hundred engineers
shipping to one URL, and what the user sees when a dependency fails. Work through this in order
-- each topic assumes the previous ones.`,
  topics: [
    { id: 'web-foundations', title: 'Web Foundations: URL to Pixels', level: 'foundation', minutes: 16, summary: 'DNS, TCP, TLS and HTTP as one traceable path you can reason about end to end.', tags: ['DNS', 'TLS', 'HTTP', 'latency'], load: () => import('./web-foundations.js') },
    { id: 'browser-rendering', title: 'Browser & Rendering Pipeline', level: 'foundation', minutes: 18, summary: 'DOM, CSSOM, layout, paint, composite -- and the main thread you keep blocking.', tags: ['rendering', 'main thread', 'reflow', 'compositing'], load: () => import('./browser-rendering.js') },
    { id: 'http-and-networking', title: 'HTTP, HTTP/2 & HTTP/3', level: 'foundation', minutes: 16, summary: 'Idempotency, status semantics, multiplexing, QUIC, and why retries are dangerous.', tags: ['HTTP', 'QUIC', 'idempotency', 'retries'], load: () => import('./http-and-networking.js') },
    { id: 'cdn-and-edge', title: 'CDN & Edge Delivery', level: 'core', minutes: 20, summary: 'Cache keys, TTL policy, invalidation, shields, edge compute -- and the leak that ends careers.', tags: ['CDN', 'caching', 'edge', 'security'], load: () => import('./cdn-and-edge.js') },
    { id: 'caching-layers', title: 'The Caching Stack', level: 'core', minutes: 18, summary: 'Seven layers between a pixel and a disk read, and who owns correctness at each.', tags: ['caching', 'invalidation', 'stampede'], load: () => import('./caching-layers.js') },
    { id: 'rendering-strategies', title: 'CSR, SSR, SSG, ISR & Streaming', level: 'core', minutes: 20, summary: 'Where HTML is produced, what it costs, and how to choose per route rather than per app.', tags: ['SSR', 'SSG', 'streaming', 'hydration'], load: () => import('./rendering-strategies.js') },
    { id: 'api-and-bff', title: 'API Contracts & the BFF', level: 'core', minutes: 20, summary: 'REST, GraphQL, gRPC-web and the Backend-for-Frontend as an ownership boundary.', tags: ['REST', 'GraphQL', 'BFF', 'contracts'], load: () => import('./api-and-bff.js') },
    { id: 'state-management', title: 'State: What Belongs Where', level: 'core', minutes: 17, summary: 'Server, URL, session, ephemeral and cross-cutting state -- and the cost of confusing them.', tags: ['state', 'react-query', 'URL state', 'cache'], load: () => import('./state-management.js') },
    { id: 'react-at-scale', title: 'React at Scale', level: 'core', minutes: 19, summary: 'Boundaries, render cost, memoisation economics, and the failure patterns of large apps.', tags: ['React', 'performance', 'architecture'], load: () => import('./react-at-scale.js') },
    { id: 'microfrontends', title: 'Microfrontends', level: 'staff', minutes: 22, summary: 'An organisational scaling technique with technical consequences. When to say no.', tags: ['MFE', 'org design', 'contracts'], load: () => import('./microfrontends.js') },
    { id: 'module-federation', title: 'Module Federation & Runtime Integration', level: 'staff', minutes: 19, summary: 'Hosts, remotes, shared scope negotiation, and the N-1/N/N+1 compatibility problem.', tags: ['Module Federation', 'webpack', 'versioning'], load: () => import('./module-federation.js') },
    { id: 'design-systems', title: 'Design Systems & Frontend Platform', level: 'staff', minutes: 20, summary: 'Tokens, API stability, codemods, adoption metrics, and avoiding the "platform says no" org.', tags: ['design system', 'platform', 'migration'], load: () => import('./design-systems.js') },
    { id: 'realtime-frontend', title: 'Realtime: Polling, SSE & WebSockets', level: 'core', minutes: 18, summary: 'Connection lifecycle, fanout, backpressure, presence and reconnection you must design for.', tags: ['WebSocket', 'SSE', 'realtime', 'presence'], load: () => import('./realtime-frontend.js') },
    { id: 'offline-and-sync', title: 'Offline-First & Sync', level: 'staff', minutes: 19, summary: 'Local source of truth, outbox pattern, conflict resolution, and idempotent mutations.', tags: ['offline', 'IndexedDB', 'outbox', 'sync'], load: () => import('./offline-and-sync.js') },
    { id: 'collaborative-editing', title: 'Collaborative Editing: OT & CRDT', level: 'staff', minutes: 18, summary: 'Why last-write-wins loses edits, and what CRDTs genuinely do and do not solve.', tags: ['CRDT', 'OT', 'collaboration'], load: () => import('./collaborative-editing.js') },
    { id: 'web-performance', title: 'Performance Engineering', level: 'core', minutes: 21, summary: 'Core Web Vitals, RUM vs lab, long tasks, budgets in CI, and tying latency to revenue.', tags: ['performance', 'Core Web Vitals', 'budgets', 'RUM'], load: () => import('./web-performance.js') },
    { id: 'frontend-security', title: 'Frontend Security', level: 'core', minutes: 20, summary: 'XSS, CSRF, CSP, token storage, supply chain -- the browser is an adversarial runtime.', tags: ['XSS', 'CSP', 'CSRF', 'supply chain'], load: () => import('./frontend-security.js') },
    { id: 'frontend-observability', title: 'Frontend Observability', level: 'core', minutes: 17, summary: 'RUM, error tracking, release correlation, session replay and sampling that survives cost review.', tags: ['observability', 'RUM', 'errors', 'tracing'], load: () => import('./frontend-observability.js') },
    { id: 'deployment-and-rollout', title: 'Deployment, Rollout & Migration', level: 'staff', minutes: 20, summary: 'Immutable assets, canary, expand-migrate-contract, and surviving mixed-version fleets.', tags: ['deployment', 'canary', 'migration', 'flags'], load: () => import('./deployment-and-rollout.js') }
  ]
};
