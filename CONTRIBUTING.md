# Contributing

Corrections beat new topics. This curriculum is only useful if the mechanisms are right.

## Factual PRs (highest value)

If a number, failure mode, or Staff recommendation is wrong:

1. Open an issue or PR against the topic file under `content/<track>/`.
2. Cite a source (paper, vendor docs, RFC, measured result).
3. Prefer a one-paragraph fix over a rewrite.

Run `node tools/validate.mjs` before you push. After topic edits, `npm run export` regenerates `docs/` and the Anki TSV.

## New topics

Only after reading `CONTENT-SCHEMA.md`. Copy `content/frontend/cdn-and-edge.js`, register the topic in `content/<track>/index.js` in teaching order, then validate. Padding to hit a line count will be rejected; missing `staff`, `failures`, or drills will fail CI-less validation anyway.

## Scope we will not take

Auth, analytics, LLM tutors, or a backend. Progress stays in the browser.
