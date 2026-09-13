# Staff Engineer Academy

A static, zero-build study platform for **Staff-level engineering interviews and upskilling**
across three tracks: frontend systems, distributed backends, and AI engineering.

No accounts, no backend, no analytics, no build step. Clone it, serve the folder, done.

## What it is

Most interview-prep sites are either a list of links or a wall of diagrams. This one is built
around the loop that actually changes interview performance:

| | |
|---|---|
| **Read** | Every topic answers the same six questions — what it is, why it exists, how it actually works, what it costs, how it fails, and what a strong candidate says out loud. |
| **Drill** | Each topic ends with an open-ended scenario plus a grading key listing what a strong answer contains and the tells of a shallow one. |
| **Recall** | Flashcards scheduled by SM-2 spaced repetition, so you are tested a week later when you have actually forgotten. |
| **Simulate** | A timed 45-minute mock interview with the six phases a real loop uses, a scratchpad, and a 16-line self-grade rubric. |
| **Diagnose** | Self-grades across sessions are aggregated into a table of the rubric dimensions you consistently miss. That is your study list. |

## Running it

ES modules are blocked over `file://`, so serve the folder:

```bash
python3 -m http.server 8080    # then open http://localhost:8080
# or
npx serve .
```

Deploying to GitHub Pages needs no configuration — push the repo, enable Pages on the branch
root, and it works. `.nojekyll` is present so the `assets/` directory is served as-is.

## Validating content

```bash
node tools/validate.mjs
```

This checks every topic against the schema: required block types, table row/column agreement,
quiz answer indices in range, mermaid syntax that survives `securityLevel: strict`, markdown
that the mini-renderer cannot handle, minimum flashcard and drill counts, and question-bank
`topicIds` that point at topics which exist. It exits non-zero on errors.

## Structure

```
index.html                  app shell — chrome only, no content
assets/css/app.css          design tokens, light/dark, print styles
assets/js/
  app.js                    hash router, chrome, keyboard shortcuts
  store.js                  all persistence: progress, SRS, mocks, theme
  blocks.js                 THE CONTENT SCHEMA — renders typed blocks
  md.js                     deliberately tiny markdown subset
  diagram.js                lazy Mermaid, viewport-triggered, fails soft
  search.js                 command palette over the whole corpus
  dom.js                    small shared helpers
  views/                    one module per route
content/
  index.js                  curriculum registry — metadata + lazy loaders
  frontend|backend|ai/
    index.js                track metadata and its ordered topic list
    <topic-id>.js           one topic body per file
  practice/
    bank.js                 the question bank
    frameworks.js           mock interview phases, rubric, frameworks
tools/validate.mjs          content conformance check
CONTENT-SCHEMA.md           how to write a topic
```

Two design decisions worth knowing:

**Hash routing, not the History API.** It means the site works from any subdirectory, from a
`file://`-hosted copy of the assets, and on GitHub Pages with no server rewrite rules.

**Content as data, not markup.** A topic is an array of typed blocks (`prose`, `diagram`,
`table`, `tradeoffs`, `failures`, `staff`, `quiz`, …) rendered by `assets/js/blocks.js`. That is
what makes the search index, the flashcard extraction, the outline rail and the validator
possible at all — none of which you can do against a wall of HTML.

## Adding a topic

1. Copy `content/frontend/cdn-and-edge.js` — it is the reference implementation.
2. Save it as `content/<track>/<your-topic-id>.js`.
3. Add a metadata entry to `content/<track>/index.js`, positioned where it belongs in the
   teaching sequence.
4. `node tools/validate.mjs`

Read `CONTENT-SCHEMA.md` first. The schema is enforced, not advisory.

## Keyboard shortcuts

`⌘K` / `Ctrl+K` / `/` search · `j` `k` next/previous topic · `space` reveal flashcard ·
`1`–`4` grade a card · `?` shortcuts

## Progress and privacy

Everything is in `localStorage` under the `sea.v2` key: completed topics, spaced-repetition
schedules, quiz results, question-bank status, and mock interview notes and self-grades. Nothing
is transmitted anywhere. Export and import as JSON from the Progress page if you switch machines.

The one network request the site makes is for Mermaid from jsDelivr, and only when a diagram
scrolls into view. If that fetch fails, the diagram source is shown instead and nothing else
breaks.

## Content accuracy

Figures are order-of-magnitude guides for reasoning in an interview, not benchmarks — measure
your own system. Corrections are more valuable than additions.
