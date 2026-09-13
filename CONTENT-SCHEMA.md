# Content schema

Every topic is one ES module under `content/<track>/<topic-id>.js`. Zero build step, zero
dependencies — the browser imports these directly, so they must be valid ES modules with no
transpilation and no bare imports.

## Track index

Each track owns `content/<track>/index.js`. This is the only place topic *metadata* lives.

```js
export default {
  id: 'backend',
  short: 'be',                  // 'fe' | 'be' | 'ai' | 'px' — drives accent colour
  name: 'Backend & Distributed Systems',
  tagline: 'One sentence shown on the home page.',
  blurb: 'Two or three sentences shown at the top of the track page.',
  topics: [
    {
      id: 'consistency-models',            // must equal the filename without .js
      title: 'Consistency Models',
      level: 'core',                        // 'foundation' | 'core' | 'staff'
      minutes: 18,                          // honest read time
      summary: 'One line, max ~120 chars, shown in lists and search.',
      tags: ['replication', 'consistency', 'CAP'],
      load: () => import('./consistency-models.js')
    }
  ]
};
```

Order `topics` as a teaching sequence — the topic page renders prev/next from this array.

## Topic module

```js
export default {
  blocks: [ /* required — the page body */ ],
  flashcards: [ { q, a } ],     // required, 5-9 per topic
  drills: [ { prompt, probes, strong, weak } ]  // required, 1-2 per topic
};
```

### Blocks

`blocks` is a flat array of `{ t: '<type>', ...fields }`. The renderer is
`assets/js/blocks.js` — it is the authority. Unknown `t` values render nothing.

| `t` | Fields | Use for |
|---|---|---|
| `h` | `text`, `id?` | Section heading. Feeds the "on this page" rail. |
| `prose` | `md` | Paragraphs and lists. |
| `note` | `md`, `tone?` (`info`\|`good`\|`warn`\|`danger`), `title?` | Callout. |
| `diagram` | `code`, `caption?` | Mermaid source. |
| `table` | `cols[]`, `rows[][]`, `title?` | Comparisons. Cells accept inline markdown. |
| `code` | `code`, `lang?`, `title?` | Config, snippets, wire formats. |
| `grid` | `items[{b, md}]`, `cols?` (2\|3\|4), `title?` | 2-4 short parallel concepts. |
| `steps` | `items[md]`, `ordered?`, `title?` | Sequences. |
| `tradeoffs` | `gains[]`, `costs[]`, `title?` | Always include one per topic. |
| `failures` | `items[{mode, blast, fix}]`, `title?` | Always include one per topic. |
| `staff` | `md` | Always include exactly one, near the end. |
| `numbers` | `items[{v, k, note?}]`, `title?` | Back-of-envelope figures. |
| `quiz` | `items[{q, options[], answer, why}]` | 2-4 items, near the end. |
| `details` | `title`, `blocks[]` | Collapsed nested blocks. |

### Markdown subset

`md` fields and table cells support **only**: `**bold**`, `*italic*`, `` `code` ``,
`[text](url)`, `- ` bullets, `1. ` ordered lists, `> ` quote, and blank-line paragraphs.
No headings (use `t: 'h'`), no raw HTML, no tables (use `t: 'table'`), no fenced code
blocks (use `t: 'code'`).

Write `md` as a template literal. Inside one, escape backticks as `` \` ``.

### Mermaid

Keep diagrams under ~14 nodes. `flowchart LR|TB`, `sequenceDiagram`, and `stateDiagram-v2`
only. `securityLevel` is `strict`, so no click handlers or raw HTML in labels — `<br/>` is
the one exception and it is allowed.

## Required shape of every topic

In this order:

1. Opening `prose` — what it is, in plain language, no jargon in the first sentence.
2. `h` **Why it exists** — the problem that forced this to be invented.
3. `h` **How it works** — mechanism, with a `diagram` and/or `steps`. Trace a real request.
4. Concrete specifics — `table`, `code`, `numbers`. Real header names, real commands, real figures.
5. `tradeoffs` — what you gain, what it costs.
6. `failures` — at least 4 rows.
7. `staff` — exactly one, and make it the sharpest block on the page.
8. `quiz` — 2-4 items with a `why` that teaches even when the answer was right.
9. Optional `details` cross-links to sibling topics by title.

## Drills

A drill is an open-ended interview prompt with a grading key. This is what makes the site
interview prep rather than a wiki.

```js
{
  prompt: 'A scenario with real constraints and numbers. 2-4 sentences.',
  probes: ['The follow-ups a good interviewer asks.'],
  strong: ['Specific things a strong answer contains.'],
  weak:   ['Specific tells of a shallow answer.']
}
```

`strong` and `weak` must be concrete and falsifiable. "Understands trade-offs" is useless;
"names request collapsing for the herd at TTL expiry" is useful.

## Voice

- Explain to a smart engineer who has not met this concept. No hype, no "simply", no "just".
- Prefer a real number over an adjective. `~200 ms intercontinental RTT`, not "slow".
- Every claim should survive a Staff engineer reading it. If you are unsure, hedge honestly
  or leave it out.
- Name real technologies (Postgres, Kafka, Envoy, pgvector) where it makes the point land.
- Hyphenate with ` -- ` in prose; the renderer converts it to an em dash.

`content/frontend/cdn-and-edge.js` is the reference implementation. Match its depth.
