export default {
  id: 'studios',
  short: 'st',
  name: 'Studios',
  tagline: 'End-to-end interview questions. Concepts applied, not restated.',
  blurb: `These are the night-before pages. Each studio is one classic loop question. It does
not re-teach HTTP or Kafka -- it spends the page on the one mechanism that decides the offer,
then links back to the concept topics.`,
  topics: [
    { id: 'url-shortener', title: 'Design a URL shortener', level: 'core', minutes: 28, summary: 'Key space, 301 vs 302, uniqueness at write QPS, and why recycling a slug is a security bug.', tags: ['keys', 'cache', 'redirects', 'uniqueness'], load: () => import('./url-shortener.js') },
    { id: 'news-feed-backend', title: 'Design a news feed (backend)', level: 'staff', minutes: 30, summary: 'Push vs pull fanout, the celebrity problem, and the timeline store that actually has to exist.', tags: ['fanout', 'timeline', 'cache', 'Kafka'], load: () => import('./news-feed-backend.js') },
    { id: 'news-feed-frontend', title: 'Design a news feed (frontend)', level: 'staff', minutes: 28, summary: 'Virtualization, cursor pagination, optimistic reactions, and the "N new posts" banner.', tags: ['virtualization', 'pagination', 'optimistic UI'], load: () => import('./news-feed-frontend.js') },
    { id: 'search-as-you-type', title: 'Design search-as-you-type', level: 'core', minutes: 24, summary: 'Debounce, in-flight cancel, request coalescing, and ranking freshness under 100 ms.', tags: ['autocomplete', 'debounce', 'cancel'], load: () => import('./search-as-you-type.js') },
    { id: 'youtube-watch-page', title: 'Design a YouTube watch page', level: 'staff', minutes: 28, summary: 'MSE/ABR, buffer policy, captions, and what the user sees when the network cliffs.', tags: ['MSE', 'ABR', 'video', 'CDN'], load: () => import('./youtube-watch-page.js') },
    { id: 'chat-system', title: 'Design chat / WhatsApp', level: 'staff', minutes: 30, summary: 'Delivery receipts, per-conversation ordering, offline outbox, and presence that does not melt the server.', tags: ['chat', 'ordering', 'presence', 'offline'], load: () => import('./chat-system.js') },
    { id: 'uber-matching', title: 'Design Uber matching', level: 'staff', minutes: 28, summary: 'Geo indexes, dispatch races, idempotent accept, and surge as a queueing problem.', tags: ['geo', 'matching', 'idempotency'], load: () => import('./uber-matching.js') },
    { id: 'dropbox-sync', title: 'Design Dropbox sync', level: 'staff', minutes: 28, summary: 'Content-defined chunking, conflict, notify vs poll, and upload that survives a flaky laptop.', tags: ['sync', 'chunking', 'conflict'], load: () => import('./dropbox-sync.js') },
    { id: 'ticketmaster', title: 'Design ticket checkout', level: 'staff', minutes: 26, summary: 'Holds, payment timeouts, oversell, and why a unique seat id is not enough.', tags: ['inventory', 'holds', 'contention'], load: () => import('./ticketmaster.js') },
    { id: 'web-crawler-search', title: 'Design a crawler and search', level: 'staff', minutes: 28, summary: 'Frontier, politeness, inverted index, and the serving path that cannot wait for crawl.', tags: ['crawler', 'index', 'search'], load: () => import('./web-crawler-search.js') },
    { id: 'rag-product', title: 'Design permissioned RAG', level: 'staff', minutes: 28, summary: 'ACL at retrieval, citations, eval harness, and a cost envelope a VP will sign.', tags: ['RAG', 'ACL', 'evals', 'cost'], load: () => import('./rag-product.js') },
    { id: 'coding-agent', title: 'Design a coding agent', level: 'staff', minutes: 28, summary: 'Repo index, sandboxed tools, step budgets, and a review loop that is allowed to say no.', tags: ['agents', 'sandbox', 'tools'], load: () => import('./coding-agent.js') }
  ]
};
