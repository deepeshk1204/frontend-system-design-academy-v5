export default {
  blocks: [
    {
      t: 'prose',
      md: `The backend feed API returns a cursor-paginated JSON array. The Staff frontend interview
starts when you open the app: **10,000 posts exist, 8 are visible**, scroll position must survive
background polling, and a like must feel instant even on a 400 ms RTT. The mechanisms that decide
the offer are **windowed virtualization** (not "use react-window"), **cursor pagination** (why offset
is dead), **optimistic likes with rollback**, the **"N new posts" banner** instead of viewport jump,
**image lazy-load** without layout thrash, and recovery when the **session is stale** after sleep.
This page is those interactions with numbers -- not a React tutorial.`
    },

    { t: 'h', text: 'Windowed list and virtualization' },
    {
      t: 'prose',
      md: `Rendering 500 fetched posts as 500 DOM subtrees costs ~50-100 ms script and megabytes of
layout memory. Users only see ~8-12 cards. **Virtualization** mounts DOM for visible rows plus a
small overscan buffer (3-5 rows above/below), recycling nodes on scroll.

Staff details interviewers probe:

- **Variable row height:** Text posts 120 px, image posts 400 px, quote tweets differ. Fixed-height
virtualizers mis-scroll. Use measured cache (\`ResizeObserver\` per row id) or estimated height with
correction pass -- TanStack Virtual's \`measureElement\` pattern.
- **Scroll anchor when height changes:** Image load expands row below fold -- fine; image above
viewport expands and **jumps scroll** unless you adjust \`scrollTop\` by delta height (CSS
\`content-visibility: auto\` helps below-fold).
- **Focus and a11y:** Keyboard nav must move focus into newly mounted rows; aria \`setsize\` /
\`posinset\` from total loaded count, not DOM child count.

Target: **60 fps scroll** on mid Android -- budget 8 ms per frame for scroll handler; if
\`onScroll\` triggers setState every event, you miss frames. Throttle range calculation to
\`requestAnimationFrame\` or use passive listeners with ref-based scrollTop.`
    },
    {
      t: 'diagram',
      code: `flowchart TB
  DS["Feed data: 500 items in memory"]
  DS --> WIN["Virtual window: indices 40-55"]
  WIN --> DOM["~16 mounted PostCard nodes"]
  SC["Scroll event"] --> WIN
  DOM --> RO["ResizeObserver updates height cache"]
  RO --> WIN`,
      caption: 'Data layer holds full fetched list; DOM layer holds only the visible window plus overscan.'
    },
    {
      t: 'numbers',
      title: 'Frontend feed budgets',
      items: [
        { v: '8-12', k: 'Visible post cards', note: 'Determines virtual window size' },
        { v: '500', k: 'Typical in-memory cap', note: 'Discard tail or persist to IndexedDB optionally' },
        { v: '16 ms', k: 'Frame budget at 60 fps', note: 'Scroll work must stay under ~8 ms' },
        { v: '400 ms', k: 'Optimistic UI RTT tolerance', note: 'User perceives instant if UI updates <100 ms' },
        { v: '0', k: 'Acceptable viewport jumps on poll', note: 'Use banner, not prepend + scroll fix fight' }
      ]
    },

    { t: 'h', text: 'Cursor pagination, not offset' },
    {
      t: 'prose',
      md: `\`GET /feed?offset=40&limit=20\` breaks under live feeds: new post arrives at top, your
offset 40 now points at what was offset 39 -- **duplicate or skip**. Backend uses opaque cursor
(\`next_cursor=eyJpZCI6...}\` encoding \`(created_at, post_id)\`).

Client contract:

- **Initial load:** \`GET /feed?limit=20\` → items + \`next_cursor\`.
- **Scroll near end:** \`GET /feed?cursor={next}&limit=20\` append to in-memory list, extend virtualizer count.
- **Poll for new:** \`GET /feed?since_cursor={newest_seen}\` or \`min_id\` returns only posts newer than viewport top -- **do not merge with pagination cursor** interchangeably.

Store \`newestItemId\` and \`oldestFetchedCursor\` separately. Deduplicate by \`post_id\` on append
(Suspense / strict mode double-fetch, retry). Cap in-memory list at 500 -- drop tail with scroll
position check so user does not lose place.

**Prefetch:** when virtualizer within 5 rows of end and \`hasMore\`, fetch next page; single-flight
in-flight guard prevents duplicate requests.`
    },
    {
      t: 'table',
      cols: ['Param', 'Purpose', 'Pitfall'],
      rows: [
        ['`cursor`', 'Paginate older posts', 'Reusing same cursor after prepend duplicates'],
        ['`since_id` / `since_cursor`', 'Fetch only newer posts for poll', 'Applying to scroll-up load pulls wrong direction'],
        ['`limit`', 'Page size 20-30', 'Too large hurts TTFB and virtualizer cold start'],
        ['Stable `post_id`', 'Dedup key', 'Client-generated temp ids on optimistic post must map on confirm']
      ]
    },

    { t: 'h', text: 'Optimistic likes with rollback' },
    {
      t: 'prose',
      md: `Like button must toggle in **<100 ms** regardless of network. Pattern:

1. **Optimistic update:** On click, immediately flip local state (\`liked: true\`, \`likeCount++\`),
disable double-tap briefly.
2. **Request:** \`POST /posts/{id}/like\` with idempotency key \`like:{postId}:{userId}\` or DELETE to unlike.
3. **Confirm:** 204 → keep optimistic state; reconcile if server returns canonical count.
4. **Rollback:** 409/403/5xx → revert UI, toast "Couldn't like -- try again", re-enable button.

State ownership: colocate in **query cache** (TanStack Query \`onMutate\` snapshot + rollback) or
normalized store (\`posts[id].liked\`). Do not duplicate liked state in component \`useState\` and
cache -- they diverge on scroll recycle in virtualizer.

**Ordering:** If user likes post A, scrolls away, scrolls back -- recycled row reads from cache, not
initial props. Virtualizer \`key={post.id}\` on row, not index.

Offline: queue mutation in outbox (see **Offline & sync**); show pending visual until sync. Conflicts
rare for likes; server wins on unlike if post deleted.`
    },
    {
      t: 'code',
      lang: 'javascript',
      title: 'Optimistic like with TanStack Query shape',
      code: `useMutation({
  mutationFn: (postId) => api.post(\`/posts/\${postId}/like\`),
  onMutate: async (postId) => {
    await queryClient.cancelQueries({ queryKey: ['post', postId] });
    const prev = queryClient.getQueryData(['post', postId]);
    queryClient.setQueryData(['post', postId], (p) => ({
      ...p, liked: true, likeCount: p.likeCount + 1
    }));
    return { prev };
  },
  onError: (_err, postId, ctx) => {
    queryClient.setQueryData(['post', postId], ctx.prev);
    toast.error('Like failed');
  },
  onSettled: (_d, _e, postId) => {
    queryClient.invalidateQueries({ queryKey: ['post', postId] });
  }
});`
    },

    { t: 'h', text: '"N new posts" banner -- not viewport jump' },
    {
      t: 'prose',
      md: `Background poll every 30-60 s (or SSE "feed_updated") detects posts newer than
\`viewportTopItem.created_at\`. **Wrong UX:** prepend 40 posts to list and reset scroll -- user loses
reading position, rage quit. **Right UX:** increment \`pendingNewCount\`, show sticky banner "37 new
posts -- tap to refresh" above feed; on tap, prepend batch and **preserve anchor post** -- find
first visible \`post_id\`, after prepend locate it in new list, \`scrollIntoView\` or set
\`scrollTop\` to keep it at same offset from top.

Twitter/Instagram pattern. Banner clears when user taps or optionally when they scroll to top
(with pull-to-refresh gesture).

With virtualization: prepend increases \`count\` and shifts indices -- virtualizer must accept
\`scrollOffset\` adjustment: \`scrollTop += sum(heights of prepended items)\` if you auto-prepend
without banner (only for user-at-top detection: \`scrollTop < 50\` auto-prepend is OK).

**SSE vs poll:** SSE gives lower latency for banner; still fetch post bodies via \`since_id\` batch
when user taps. Connection drops on mobile sleep -- fall back to poll on \`visibilitychange\`.`
    },
    {
      t: 'diagram',
      code: `stateDiagram-v2
  [*] --> Idle
  Idle --> BannerShown: poll finds N new posts
  BannerShown --> Idle: user ignores scroll continues
  BannerShown --> Prepended: user taps banner
  Prepended --> Idle: scroll anchor restored
  Idle --> AutoPrepend: scrollTop near 0
  AutoPrepend --> Idle: prepend without banner`,
      caption: 'Banner is default when user is mid-feed; auto-prepend only when already at top.'
    },

    { t: 'h', text: 'Image lazy-load without layout thrash' },
    {
      t: 'prose',
      md: `Feed images dominate LCP and bandwidth. Strategy:

- **Reserved aspect ratio box** from API metadata (\`width\`, \`height\` or \`aspect_ratio\`) -- render
placeholder with \`padding-bottom: 56.25%\` before load. No vertical jump when bytes arrive.
- **Native \`loading="lazy"\`** for below-fold; **priority hint** \`fetchpriority="high"\` for first
visible image only (one LCP candidate).
- **IntersectionObserver** with \`rootMargin: 200px\` to start fetch before enter viewport -- reduces
white flash on fast scroll.
- **Responsive srcset** from CDN -- never ship 4000 px image to 390 px card.
- **Blurhash / LQIP** in JSON for instant perceptual fill; swap to full res on load.

Virtualizer interaction: row height **must include placeholder height** before image load; when
image loads, height should not change if aspect ratio was correct. Wrong API metadata →
ResizeObserver correction → scroll jump -- fix metadata pipeline, not CSS hacks.

Decode off main thread where possible (\`decode()\` promise before swap). Cap concurrent image loads
(6-8) or fast scroll triggers hundreds of aborted requests -- prioritize visible window.`
    },

    { t: 'h', text: 'Stale session recovery' },
    {
      t: 'prose',
      md: `User backgrounds app 2 hours; access token expired; returns to feed showing cached
posts from memory/disk. **Failure modes:**

- Scroll triggers pagination → **401** on cursor fetch.
- Optimistic like → 401, rollback looks like bug.
- Stale feed data shown as fresh -- user misses posts, no banner.

**Pattern:**

1. **Proactive refresh on \`visibilitychange\` / \`focus\`:** if \`document.visibilityState ===
'visible'\` and idle > 5 min, silent \`POST /auth/refresh\` then \`GET /feed?since_id=...\` to
update banner count without blocking UI.
2. **401 interceptor:** queue in-flight requests, refresh token once (single-flight), replay or hard
redirect login if refresh fails. Feed shows skeleton overlay "Reconnecting..." not frozen stale UI.
3. **Query cache \`staleTime\`:** feed list \`staleTime: 30_000\` -- refetch on focus; \`gcTime\`
longer for instant paint. Show **timestamp** "Updated 2h ago" when offline/stale so user trusts banner.
4. **WebSocket/SSE reconnect** with exponential backoff; on reconnect, full \`since_id\` diff not
replay entire feed.

Do not infinite-spinner on token refresh -- bounded 3 s then login prompt.`
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      title: 'Virtualized cursor feed with optimistic UI vs simple infinite scroll',
      gains: [
        'Virtualization holds DOM ~16 nodes for 500-item list -- smooth scroll on low-end devices.',
        'Cursor pagination avoids duplicate/skip when new posts arrive during scroll.',
        'Optimistic likes meet <100 ms perceived latency without waiting on 400 ms RTT.',
        'New-posts banner preserves reading position -- higher session depth than auto-prepend.',
        'Aspect-ratio placeholders eliminate image load layout shift (CLS).'
      ],
      costs: [
        'Variable-height virtualization is materially harder to test and debug than static lists.',
        'Separate cursor vs since_id poll params -- easy to wire wrong and get silent bugs.',
        'Optimistic rollback UX must be designed -- bare revert feels like app glitch.',
        'Banner adds state machine (idle / pending / prepending) and anchor math on tap.',
        'Session refresh logic is easy to get wrong -- thundering refresh on every tab focus.'
      ]
    },

    {
      t: 'failures',
      items: [
        { mode: 'Offset pagination on live feed', blast: 'Duplicate posts or gaps when polling prepends while user paginates down.', fix: 'Opaque cursor on `(created_at, id)`; dedupe by post_id; separate since_id for poll.' },
        { mode: 'Auto-prepend on poll while user mid-scroll', blast: 'Viewport jumps; user loses place in long thread; accidental mis-taps.', fix: '"N new posts" banner; prepend only when scrollTop < threshold or user taps.' },
        { mode: 'Optimistic like without rollback', blast: 'Silent failure on 403/500 -- UI shows liked, refresh reveals unlike; trust broken.', fix: 'onMutate snapshot + onError revert + toast; idempotent server endpoint.' },
        { mode: 'Virtualizer keyed by index after prepend', blast: 'Wrong post flashes in row slot; liked state attaches to wrong card.', fix: 'key={post.id}; state in normalized cache keyed by id, not row index.' },
        { mode: 'Images without reserved height', blast: 'CLS 0.2+; scroll position drift as images load above fold.', fix: 'API aspect_ratio; fixed placeholder; ResizeObserver only for text expand.' },
        { mode: '401 on pagination with no refresh single-flight', blast: 'Ten simultaneous login redirects; feed stuck error state.', fix: 'Axios/fetch interceptor queues requests; one refresh; replay or logout once.' }
      ]
    },

    {
      t: 'staff',
      md: `Draw the **banner state machine** before the component tree. Interviewers care about scroll
anchor math, not library names.

- "500 posts in memory, 16 DOM nodes -- TanStack Virtual with measured heights and 4-row overscan.
Scroll handler on rAF, not each pixel event."
- "Pagination is cursor from API, not offset. Poll uses \`since_id\` of newest visible -- separate
params. Dedupe on post_id when prepending."
- "Like: optimistic update in query cache, rollback on error, \`key={post.id}\` on row so recycle
does not swap liked state between posts."
- "Poll finds 37 new -- banner, no prepend until tap. On tap, prepend and add sum of prepended
heights to scrollTop so anchor post stays fixed. Auto-prepend only if scrollTop < 50."
- "Images: aspect ratio from API, lazy below fold, fetchpriority high on first card only. Wrong
metadata is a backend bug causing CLS -- I would metric it."
- "On visibility after 5 min idle, refresh token single-flight then since_id poll for banner. 401
queues behind one refresh, not ten login modals."

Say **viewport jump** unprompted -- it signals you have shipped infinite feeds.`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'Poll returns 25 posts newer than the viewport top. User is reading post 200px from top of a long card. Best UX?',
          options: [
            'Prepend 25 posts immediately and scroll to previous offset + estimated height',
            'Show "25 new posts" banner; prepend on tap with scroll anchor to current visible post_id',
            'Replace entire feed with fresh fetch',
            'Append new posts at bottom'
          ],
          answer: 1,
          why: 'Mid-feed prepend without anchor restoration jumps the viewport and disorients the reader. Banner preserves position until explicit user action. On tap, anchor the first visible post_id and adjust scrollTop by prepended height sum. Replace-all is heavy and loses scroll; new posts belong at top not bottom.'
        },
        {
          q: 'Virtualized feed uses array index as React key. User likes post A, scrolls, new posts prepend. What breaks?',
          options: [
            'Nothing -- React reconciles by position',
            'Row components reuse wrong post data; like state may appear on a different post',
            'Virtualizer stops scrolling',
            'Only affects accessibility'
          ],
          answer: 1,
          why: 'Index keys tie component identity to slot position. Prepend shifts indices -- the component at slot 5 now represents a different post but keeps old internal state. Stable post.id keys plus normalized cache for liked/count fix this. This is a common production bug in virtualized lists.'
        },
        {
          q: 'Why separate `cursor` pagination from `since_id` polling?',
          options: [
            'They are interchangeable; two names reduce cache hits',
            'Cursor walks older history; since_id fetches newer items since a boundary -- opposite directions with different merge rules',
            'since_id is only for WebSocket',
            'Backend requirement with no frontend reason'
          ],
          answer: 1,
          why: 'Pagination cursor encodes the oldest item in the current list to fetch the next page down. Poll since_id encodes the newest seen item to fetch updates above. Mixing them causes duplicates or wrong chronology. Dedup and separate state variables (nextCursor vs newestId) keep merges correct.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Concept topics this studio applies',
      blocks: [{
        t: 'prose',
        md: `Virtualization and scroll performance are covered in **Web performance** and **React at
scale**. Cursor vs offset pagination aligns with **API & BFF** contract design. Optimistic mutations
and cache rollback live in **State management** and **Caching layers** (query cache). Background
poll and SSE reconnect use **Realtime frontend** patterns. Token refresh single-flight touches
**Frontend security**. Image priority and CDN srcset connect to **CDN & Edge Delivery**. Offline
like queueing extends **Offline & sync**.`
      }]
    }
  ],

  flashcards: [
    { q: 'Why virtualize a feed if you only fetch 20 posts at a time?', a: 'Clients accumulate pages in memory (often 200-500 items) as user scrolls. Mounting hundreds of PostCard subtrees costs tens of ms and memory. Virtualization renders ~16 visible+overscan nodes regardless of list length, keeping 60 fps scroll.' },
    { q: 'What is wrong with offset pagination for live feeds?', a: 'New posts insert at top, shifting indices. offset=40 after prepend points at wrong items -- duplicates or skips. Cursor on (timestamp, id) is stable across concurrent inserts at the head.' },
    { q: 'Describe optimistic like with rollback.', a: 'Immediately update UI liked state and count in query cache; send POST async. On success, reconcile; on error, restore snapshot, toast failure, re-enable button. Requires idempotent server endpoint and stable row keys by post.id.' },
    { q: 'Why use "N new posts" banner instead of auto-prepend?', a: 'Prepending while user reads mid-feed jumps viewport unless scroll anchor math is perfect. Banner defers merge until user chooses, preserving reading position and reducing disorientation.' },
    { q: 'How prevent image load layout shift in feeds?', a: 'Reserve space with aspect ratio from API metadata before image bytes load. Use loading=lazy below fold, fetchpriority=high on first visible only. Wrong metadata causes height correction -- fix upstream, metric CLS.' },
    { q: 'What happens on 401 during scroll pagination with expired token?', a: 'Without single-flight refresh, parallel requests each trigger logout or error. Interceptor queues requests, runs one token refresh, replays successes or redirects login once. Proactive refresh on visibility after idle reduces mid-scroll failures.' },
    { q: 'Variable height virtualization pitfall?', a: 'Fixed row height estimators mis-scroll with mixed text/image posts. Measure with ResizeObserver per post.id, cache heights, adjust scrollTop when above-viewport row grows to prevent jump.' }
  ],

  drills: [
    {
      prompt: 'Build the feed UI for a mobile web app: infinite scroll, 400 ms RTT, likes, images, background poll every 45 s. User reads mid-feed when 30 new posts arrive. Walk through virtualization, pagination, poll UX, and likes.',
      probes: [
        'DOM node count vs items in memory at scroll depth 300',
        'Exact API params for initial, paginate, and poll',
        'What happens visually when 30 new posts detected mid-read',
        'Like flow on flaky network with one failed request',
        'First visible image LCP strategy'
      ],
      strong: [
        'Virtualizer ~16 nodes, 500 item cap, measured heights, rAF scroll.',
        'cursor for older pages; since_id poll separate; dedupe post_id.',
        'Banner "30 new posts"; anchor restore on tap with scrollTop adjustment.',
        'Optimistic like, rollback toast, idempotency key, cache keyed by post.id.',
        'Aspect ratio placeholder, lazy below fold, fetchpriority high on first card.',
        'visibilitychange refresh if idle >5 min before poll.'
      ],
      weak: [
        'Render all fetched items in DOM.',
        'offset=20 pagination.',
        'Auto-prepend on poll without banner.',
        'useState liked flag on row without cache.',
        'Full-size images without srcset or placeholders.'
      ]
    },
    {
      prompt: 'Users report likes "stick" to wrong posts after heavy scrolling. You use react-window with index keys and useState for liked inside PostCard. Diagnose and fix.',
      probes: [
        'Why index keys cause this specifically with virtualization',
        'Where should liked state live',
        'How to verify fix in test'
      ],
      strong: [
        'Index keys reuse component instance for different post when list prepends or recycles.',
        'Move to post.id keys and normalized query cache / store keyed by postId.',
        'Lift liked state out of row local state; virtualizer row is pure function of post id.',
        'Test: prepend items, scroll, like, assert id stable after recycle.',
        'Optional: mention TanStack Query onMutate pattern.'
      ],
      weak: [
        'Increase overscan without key fix.',
        'Force remount with random key -- destroys performance.',
        'Disable virtualization.',
        'Blame backend out of sync without examining keys.'
      ]
    }
  ]
};
