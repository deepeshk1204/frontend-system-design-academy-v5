export default {
  blocks: [
    {
      t: 'prose',
      md: `A YouTube watch page is a video player glued to a recommendation engine, but the interview
question is really about **adaptive streaming under hostile networks**. The user expects 1080p to
start within 2 seconds on Wi-Fi and to degrade gracefully -- not freeze silently -- when RTT
spikes to 400 ms on a moving train.

The browser does not play an MP4 over HTTP range requests at scale. It uses **MediaSource
Extensions (MSE)** to append fMP4 or WebM **segments** into a \`SourceBuffer\`, while **ABR**
(Adaptive Bitrate) picks the next segment's resolution from buffer health and throughput
estimates. Everything else -- captions, stall UX, CDN cache keys, SEO of the watch URL -- hangs
off that pipeline.`
    },

    { t: 'h', text: 'MSE pipeline and segment model' },
    {
      t: 'prose',
      md: `**HLS** (.m3u8) and **DASH** (.mpd) are manifest formats listing segment URLs at multiple
bitrates. The player downloads a manifest, creates \`MediaSource\` with codec strings like
\`video/mp4; codecs="avc1.640028"\`, opens a \`SourceBuffer\`, and **appends** each segment's
ArrayBuffer. Segments are typically 2-6 seconds; YouTube often uses 4 s for VOD.

MSE is **memory-heavy**: each \`SourceBuffer\` holds decoded-ready media in RAM. A 60-minute watch
session without cleanup can consume 500 MB+ in the tab. Call \`sourceBuffer.remove(start, end)\`
to evict played ranges and \`URL.revokeObjectURL()\` on teardown. Mobile Safari kills background
tabs that exceed memory budgets -- revoke on \`pagehide\`.`
    },
    {
      t: 'diagram',
      code: `flowchart LR
  subgraph Client
    M["Manifest HLS or DASH"]
    ABR["ABR controller"]
    SB["SourceBuffer append"]
    V["video element"]
  end
  subgraph CDN
    S4["1080p seg N"]
    S2["480p seg N"]
  end
  M --> ABR
  ABR --> S4
  ABR --> S2
  S4 --> SB
  S2 --> SB
  SB --> V`,
      caption: 'ABR selects a rendition per segment; MSE appends into one SourceBuffer feeding the video element.'
    },
    {
      t: 'code',
      lang: 'js',
      title: 'Minimal MSE append loop with buffer eviction',
      code: `const ms = new MediaSource();
video.src = URL.createObjectURL(ms);
ms.addEventListener('sourceopen', async () => {
  const sb = ms.addSourceBuffer('video/mp4; codecs="avc1.640028"');
  sb.addEventListener('updateend', () => {
    // Evict played media older than 30 s behind playhead
    if (sb.buffered.length && video.currentTime - sb.buffered.start(0) > 30) {
      sb.remove(0, video.currentTime - 30);
    }
    fetchNextSegment(); // ABR picks URL
  });
});

function appendSegment(buf) {
  if (sb.updating) return queue = buf;
  sb.appendBuffer(buf);
}

addEventListener('pagehide', () => {
  URL.revokeObjectURL(video.src);
  ms.endOfStream();
});`
    },

    { t: 'h', text: 'ABR and buffer health' },
    {
      t: 'prose',
      md: `**Adaptive Bitrate** is a control loop, not a one-time quality picker. Each segment
download updates a throughput estimate -- harmonic mean of last 3-5 downloads, not instantaneous
speed, which swings wildly on cellular. **Buffer health** is seconds of playback ahead of the
playhead: \`buffered.end(0) - currentTime\`.

Rules of thumb from production players: switch **up** only when buffer exceeds 15-20 s and
throughput exceeds 1.5× the next rung's bitrate; switch **down** when buffer drops below 5 s or
throughput falls below 0.8× current bitrate. Aggressive upswitch causes rebuffer; timid downswitch
wastes bandwidth on a fat pipe.

HLS can use **byte-range** within a single TS file; DASH uses separate fMP4 init + media
segments. Both need **CDN cache keys** that include rendition and segment index -- not the watch
page URL. A typical key: \`/v/id/1080p/seg-0042.m4s\` with cache TTL 7-30 days for VOD and
seconds for live edge chunks.`
    },
    {
      t: 'table',
      title: 'ABR decision inputs',
      cols: ['Signal', 'Typical threshold', 'Action'],
      rows: [
        ['**Buffer ahead**', 'Greater than 20 s stable', 'Consider upswitch one rung if throughput supports it.'],
        ['**Buffer ahead**', 'Less than 5 s', 'Downswitch immediately; cancel in-flight higher renditions.'],
        ['**Throughput vs bitrate**', 'Less than 0.8× current', 'Downswitch before rebuffer, not after.'],
        ['**Throughput vs next rung**', 'Greater than 1.5× next', 'Upswitch after 2-3 segments at current level.'],
        ['**Stall event**', 'waiting fired', 'Emergency downswitch plus show stall UX within 200 ms.'],
        ['**Save-Data / metered**', 'navigator.connection.saveData', 'Cap at 480p regardless of throughput.']
      ]
    },

    { t: 'h', text: 'Stall UX and captions' },
    {
      t: 'prose',
      md: `**Rebuffer** is inevitable; hiding it is not. When \`video.waiting\` fires, show a
spinner within 200 ms -- not at 2 s when the user has already checked their Wi-Fi. Display
"Quality reduced to keep playing" when ABR downshifts during a stall so users do not think the
app broke. Track **Time to First Frame (TTFF)** and **Rebuffer Ratio** (seconds rebuffering /
watch time); healthy VOD targets rebuffer under 0.5% of watch time.

**Captions** ship as separate WebVTT or embedded CEA-608 in segments. Render with \`<track
kind="captions">\` for accessibility and SEO text snippets, or burn-in for DRM-locked streams.
Caption files cache independently -- key by \`videoId/lang.vtt\` -- and should load in parallel
with the first video segment, not after playback starts.`
    },
    {
      t: 'note',
      tone: 'warn',
      title: 'MSE memory revoke on navigation',
      md: `SPA watch pages keep the player mounted while comments and related videos swap via
client routing. If you navigate watch-to-watch without tearing down MSE, **SourceBuffers
accumulate** across videos. On each \`videoId\` change: pause, \`sourceBuffer.abort()\`, remove
all buffered ranges, fetch new manifest, or destroy and recreate \`MediaSource\`. Failing this
leaks 200-400 MB per navigation on long sessions.`
    },

    { t: 'h', text: 'SPA watch page vs SSR for SEO' },
    {
      t: 'prose',
      md: `YouTube ships a **hybrid**: SSR or prerendered HTML for the watch URL so crawlers and
unfurl bots get \`<title>\`, \`og:video\`, description, and JSON-LD \`VideoObject\`. The player
itself hydrates client-side via MSE -- crawlers do not execute 40 s of JavaScript to validate
indexability.

For your design: **SSR the shell** (metadata, thumbnail, transcript excerpt, structured data) and
**client-load the stream**. Pure CSR watch pages lose social preview cards and Google video
rich results. Pure SSR of the video bytes is impossible at scale. Use \`link rel="preload"\` on
the manifest or first segment only when LCP is the poster image, not the video frame.`
    },

    { t: 'h', text: 'CDN segment cache keys' },
    {
      t: 'prose',
      md: `Cache the **segment object**, not the page. Keys must vary by **bitrate ladder rung**
and **segment sequence** -- \`/cdn/v/{id}/720p/0042.m4s\`. Include **codec generation** in the
path when you run AV1 alongside H.264 so incompatible buffers never hit the same key. For live,
TTL is 2-6 s at edge; for VOD, immutable segments get \`Cache-Control: public, max-age=31536000,
immutable\`.

**Range requests** on a single large MP4 fight cache efficiency; segmented fMP4 lets each chunk
cache independently and parallelize across HTTP/2 connections. Origin shielding -- one mid-tier
cache per region -- cuts origin egress 90% on viral videos.`
    },

    { t: 'h', text: 'Numbers that anchor the design' },
    {
      t: 'numbers',
      items: [
        { v: '2 s', k: 'TTFF target on broadband -- poster LCP plus first segment append.' },
        { v: '4 s', k: 'Typical VOD segment duration balancing ABR agility vs overhead.' },
        { v: '5 s', k: 'Buffer floor that triggers emergency downswitch before rebuffer.' },
        { v: '0.5%', k: 'Healthy rebuffer ratio -- seconds stalled divided by watch time.' },
        { v: '30 s', k: 'MSE evict window behind playhead to cap RAM on long sessions.' }
      ]
    },

    { t: 'h', text: 'Trade-offs' },
    {
      t: 'tradeoffs',
      gains: [
        'ABR delivers continuous playback across 10:1 bandwidth swings without user intervention.',
        'Segmented CDN caching achieves 95%+ edge hit rate on viral VOD.',
        'MSE enables client-side ad insertion and quality switching mid-stream.',
        'SSR metadata shell preserves SEO and social unfurl while player stays client-side.'
      ],
      costs: [
        'MSE memory management is manual -- leaks crash mobile tabs on long binge sessions.',
        'ABR tuning is content and network dependent; wrong thresholds cause upswitch-rebuffer loops.',
        'Multi-codec ladders multiply storage and transcode cost 2-3×.',
        'Captions, DRM, and ad pods each add parallel buffer management complexity.',
        'SPA navigation without MSE teardown leaks hundreds of megabytes per video change.'
      ]
    },
    {
      t: 'failures',
      items: [
        { mode: 'No SourceBuffer eviction on long plays', blast: 'Tab RAM exceeds 500 MB; mobile OS kills background player; users lose position.', fix: 'remove() played ranges 30 s behind playhead; revokeObjectURL on pagehide; recreate MediaSource on videoId change.' },
        { mode: 'ABR upswitch on instantaneous bandwidth spike', blast: 'Rebuffer loop: upswitch, stall, downswitch, repeat -- watchable but infuriating.', fix: 'Harmonic-mean throughput over 3-5 segments; require 15-20 s buffer before upswitch; 1.5× headroom rule.' },
        { mode: 'Stall with no UI for 2+ seconds', blast: 'Users assume app crash; 8-15% abandon before recovery on cellular.', fix: 'Spinner within 200 ms of waiting event; message when quality drops; track rebuffer ratio in RUM.' },
        { mode: 'CDN cache key omits rendition', blast: '480p segment served to 1080p request -- garbled decode or player error.', fix: 'Key includes videoId, codec, rendition, segment index; immutable long TTL for VOD segments.' },
        { mode: 'Pure CSR watch page', blast: 'Missing og:video and VideoObject; social shares show generic link; video SEO absent.', fix: 'SSR/prerender metadata shell and transcript excerpt; client hydrates MSE player only.' },
        { mode: 'Captions fetched after first segment', blast: 'Deaf users see 4-8 s of uncaptioned audio; accessibility audit failure.', fix: 'Parallel fetch VTT with manifest; default track on for locales with legal requirements.' }
      ]
    },

    {
      t: 'staff',
      md: `Staff signal: you own the **MSE memory lifecycle** and **ABR control loop**, not just
"name HLS."

- "Segments append into SourceBuffer via MSE; I evict played ranges 30 s behind the playhead and
  revokeObjectURL on pagehide. SPA video-to-video navigation recreates MediaSource or I leak 200 MB
  per click."
- "ABR uses harmonic-mean throughput, not last download speed. Upswitch only above 15-20 s buffer
  and 1.5× bitrate headroom; downswitch below 5 s buffer before rebuffer, not after."
- "CDN keys are per segment and rendition -- \`720p/0042.m4s\` -- with immutable TTL on VOD. The
  watch page HTML is a separate cache object."
- "Stall UX at 200 ms: spinner plus 'quality reduced' copy when ABR downshifts. I track rebuffer
  ratio targeting under 0.5% of watch time."
- "SEO: SSR the metadata shell -- title, og:video, JSON-LD VideoObject, transcript excerpt. Player
  hydrates client-side; crawlers never execute the full MSE stack."
- "Captions load in parallel with the first segment, not after playback starts."

Quoting buffer thresholds, eviction windows, and cache-key shape says you debugged players in
production, not slid through on 'use a CDN.'`
    },

    {
      t: 'quiz',
      items: [
        {
          q: 'User binge-watches 20 videos in one SPA session without full page reload. RAM grows 4 GB and tabs crash. Most likely cause?',
          options: [
            'ABR downloaded too many 1080p segments.',
            'MediaSource and SourceBuffers were not torn down on videoId navigation.',
            'CDN sent wrong cache headers.',
            'Captions loaded twice.'
          ],
          answer: 1,
          why: 'Each video appends into MSE buffers that hold media in RAM until explicitly removed. SPA routing that swaps metadata but keeps the player mounted leaks SourceBuffer memory across navigations. Fix: abort, remove buffered ranges, or recreate MediaSource on every videoId change, plus revokeObjectURL on pagehide.'
        },
        {
          q: 'Player upswitches to 1080p, rebuffers 3 seconds later, downshifts, upswitches again. Best fix?',
          options: [
            'Disable upswitching entirely.',
            'Require stable buffer above 15-20 s and harmonic-mean throughput 1.5× next rung before upswitch.',
            'Use larger 30 s segments.',
            'Prefetch entire video at highest quality.'
          ],
          answer: 1,
          why: 'This is an ABR oscillation loop caused by reacting to instantaneous bandwidth spikes. Harmonic mean smooths estimates; buffer and headroom gates prevent upswitch until the connection sustains capacity. Larger segments slow reaction; prefetch at max quality fails on long VOD and wastes bandwidth.'
        },
        {
          q: 'Social share of a watch URL shows title and thumbnail in Slack but Google Video rich results are missing. What is missing?',
          options: [
            'Higher bitrate ladder.',
            'SSR or prerendered JSON-LD VideoObject, og:video tags, and transcript in initial HTML.',
            'WebSocket for live updates.',
            'Service worker cache of segments.'
          ],
          answer: 1,
          why: 'Slack unfurl may hit og: tags from a lightweight bot, but Google video indexing requires structured VideoObject data and crawlable metadata in the first HTML response. Pure CSR watch pages hydrate metadata too late for crawlers. SSR the shell; MSE player stays client-side.'
        }
      ]
    },

    {
      t: 'details',
      title: 'Related topics',
      blocks: [{
        t: 'prose',
        md: `CDN cache strategy connects to **CDN & Edge**. SSR metadata shell overlaps
**Rendering Strategies** and **Web Performance** LCP tuning. MSE memory sits beside **Browser
Rendering** main-thread budgets. Live streaming adds **Realtime Frontend** websocket signaling
for segment availability.`
      }]
    }
  ],

  flashcards: [
    { q: 'What does MSE SourceBuffer hold and why evict?', a: 'SourceBuffer stores demuxed media segments ready for decode in RAM -- 500 MB+ on hour-long sessions without cleanup. Call remove() on played ranges 30 s behind playhead and revokeObjectURL on teardown to prevent mobile tab kills.' },
    { q: 'HLS vs DASH in one sentence each?', a: 'HLS uses m3u8 playlists, historically TS segments, strong Apple support. DASH uses mpd manifests and fMP4 segments, codec-agnostic. Both feed MSE via appendBuffer; ABR logic is the same control loop.' },
    { q: 'ABR upswitch vs downswitch thresholds?', a: 'Upswitch when buffer exceeds 15-20 s and harmonic-mean throughput exceeds 1.5× next rung bitrate. Downswitch when buffer falls below 5 s or throughput drops below 0.8× current -- before rebuffer, not after.' },
    { q: 'Why segment CDN cache keys separately from the watch page?', a: 'Segments are immutable objects keyed by videoId, rendition, codec, and index with long TTL. Watch page HTML carries volatile metadata and social tags -- different cache profile, different key.' },
    { q: 'Stall UX best practice?', a: 'Show spinner within 200 ms of video waiting event; explain quality reduction when ABR downshifts. Track rebuffer ratio targeting under 0.5% of watch time -- hidden stalls drive 8-15% abandonment on cellular.' },
    { q: 'SPA watch page MSE teardown on navigation?', a: 'On videoId change: pause, sourceBuffer.abort(), remove all buffered ranges, fetch new manifest, or destroy MediaSource. Keeping buffers across SPA routes leaks 200-400 MB per navigation.' },
    { q: 'SSR vs CSR for watch page SEO?', a: 'SSR or prerender title, og:video, JSON-LD VideoObject, and transcript excerpt in initial HTML for crawlers and unfurl bots. MSE player hydrates client-side -- crawlers do not execute full streaming stack.' }
  ],

  drills: [
    {
      prompt: 'Design the watch page for a YouTube-scale VOD product: 500M DAU, 1080p-4K ladder with AV1 and H.264, p95 TTFF under 2 s on 4G, rebuffer under 0.5%, accessible captions in 40 languages, and watch URLs must rank in Google Video.',
      probes: [
        'Walk through MSE from manifest fetch to first frame.',
        'User switches videos five times in SPA without reload -- what happens to memory?',
        'CDN cache key and TTL for a 4 s segment vs the HTML shell.',
        'Network drops from 50 Mbps to 2 Mbps mid-play -- ABR behavior?',
        'What is in the SSR HTML vs what loads client-only?'
      ],
      strong: [
        'MSE append loop with 4 s fMP4 segments; evict played buffer 30 s behind playhead; recreate MediaSource on videoId change.',
        'Harmonic-mean ABR: downswitch below 5 s buffer, upswitch above 15-20 s with 1.5× headroom; cancel in-flight higher renditions on downswitch.',
        'CDN keys `/v/{id}/{codec}/{rendition}/{seq}.m4s` immutable 30-day TTL; origin shield; separate HTML cache with og:video and VideoObject JSON-LD.',
        'Stall spinner at 200 ms; quality-reduced message on emergency downswitch; RUM on TTFF and rebuffer ratio.',
        'Captions parallel-fetched VTT per locale with track default on; transcript excerpt in SSR for SEO.',
        'SSR metadata shell, client MSE hydration; preload poster LCP, not first video frame.'
      ],
      weak: [
        'Single MP4 progressive download for all qualities.',
        'Keep one MediaSource across SPA navigations without cleanup.',
        'ABR based on last segment speed only.',
        'Cache watch page URL as the video bytes.',
        'Pure CSR with no structured data.',
        'Load captions after user presses play.'
      ]
    }
  ]
};
