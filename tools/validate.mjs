#!/usr/bin/env node
/* ===========================================================
   validate.mjs — content conformance check.

   Run:  node tools/validate.mjs
   Exits non-zero on errors. Warnings do not fail the build.
   =========================================================== */

import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const BLOCK_TYPES = new Set([
  'h', 'prose', 'note', 'diagram', 'table', 'code', 'grid',
  'steps', 'tradeoffs', 'failures', 'staff', 'numbers', 'quiz', 'details'
]);
const LEVELS = new Set(['foundation', 'core', 'staff']);
const MERMAID_KINDS = /^(flowchart|graph|sequenceDiagram|stateDiagram-v2|classDiagram|erDiagram)\b/;

const { TRACKS, TOPICS } = await import(`file://${root}/content/index.js`);

/* ---------------- manifest ---------------- */

const seenIds = new Set();
for (const t of TOPICS) {
  const key = `${t.track}/${t.id}`;
  if (seenIds.has(t.id)) err(`duplicate topic id: ${t.id}`);
  seenIds.add(t.id);

  for (const f of ['title', 'summary', 'level', 'minutes', 'load']) {
    if (t[f] === undefined) err(`${key}: missing manifest field "${f}"`);
  }
  if (!LEVELS.has(t.level)) err(`${key}: level "${t.level}" is not one of ${[...LEVELS]}`);
  if (typeof t.minutes !== 'number' || t.minutes < 3) err(`${key}: implausible minutes (${t.minutes})`);
  if (t.summary && t.summary.length > 140) warn(`${key}: summary is ${t.summary.length} chars (target <=120)`);
  if (!Array.isArray(t.tags) || !t.tags.length) warn(`${key}: no tags`);

  const file = resolve(root, 'content', t.track, `${t.id}.js`);
  if (!existsSync(file)) err(`${key}: file missing at content/${t.track}/${t.id}.js`);
}

/* ---------------- orphan files ---------------- */

for (const track of TRACKS) {
  const dir = resolve(root, 'content', track.id);
  if (!existsSync(dir)) { err(`missing directory content/${track.id}`); continue; }
  const declared = new Set(track.topics.map(t => `${t.id}.js`));
  for (const f of readdirSync(dir)) {
    if (f === 'index.js' || !f.endsWith('.js')) continue;
    if (!declared.has(f)) warn(`content/${track.id}/${f} exists but is not listed in index.js`);
  }
}

/* ---------------- bodies ---------------- */

let totalBlocks = 0, totalCards = 0, totalDrills = 0, totalQuiz = 0, totalDiagrams = 0;

for (const t of TOPICS) {
  const key = `${t.track}/${t.id}`;
  let mod;
  try {
    mod = (await t.load()).default;
  } catch (e) {
    err(`${key}: failed to import — ${e.message}`);
    continue;
  }
  if (!mod) { err(`${key}: no default export`); continue; }

  const { blocks, flashcards, drills } = mod;

  if (!Array.isArray(blocks) || !blocks.length) { err(`${key}: blocks missing or empty`); continue; }
  totalBlocks += blocks.length;

  const kinds = new Map();
  const walk = (list, depth = 0) => {
    for (const b of list) {
      if (!b || typeof b !== 'object') { err(`${key}: non-object block`); continue; }
      if (!BLOCK_TYPES.has(b.t)) { err(`${key}: unknown block type "${b.t}" (would render as nothing)`); continue; }
      kinds.set(b.t, (kinds.get(b.t) || 0) + 1);
      validateBlock(key, b);
      if (b.t === 'details') {
        if (!Array.isArray(b.blocks)) err(`${key}: details block without a blocks array`);
        else if (depth > 1) warn(`${key}: details nested more than 2 deep`);
        else walk(b.blocks, depth + 1);
      }
    }
  };
  walk(blocks);

  totalQuiz += [...blocks].filter(b => b.t === 'quiz').reduce((n, b) => n + b.items.length, 0);
  totalDiagrams += kinds.get('diagram') || 0;

  // Required shape
  for (const required of ['diagram', 'table', 'tradeoffs', 'failures', 'staff', 'quiz']) {
    if (!kinds.get(required)) err(`${key}: no "${required}" block (required by the schema)`);
  }
  if ((kinds.get('staff') || 0) > 1) warn(`${key}: ${kinds.get('staff')} staff blocks — the schema expects exactly one`);
  if (!kinds.get('h')) warn(`${key}: no headings, so the section outline will be empty`);

  // Flashcards
  if (!Array.isArray(flashcards) || flashcards.length < 5) {
    err(`${key}: needs at least 5 flashcards (has ${flashcards?.length ?? 0})`);
  } else {
    totalCards += flashcards.length;
    flashcards.forEach((c, i) => {
      if (!c?.q || !c?.a) err(`${key}: flashcard ${i} missing q or a`);
      else if (c.a.length < 40) warn(`${key}: flashcard ${i} answer is only ${c.a.length} chars`);
    });
  }

  // Drills
  if (!Array.isArray(drills) || !drills.length) {
    err(`${key}: needs at least 1 drill`);
  } else {
    totalDrills += drills.length;
    drills.forEach((d, i) => {
      if (!d?.prompt) err(`${key}: drill ${i} has no prompt`);
      for (const f of ['probes', 'strong', 'weak']) {
        if (!Array.isArray(d[f]) || !d[f].length) err(`${key}: drill ${i} missing "${f}"`);
      }
    });
  }
}

function validateBlock(key, b) {
  const need = (field, pred, msg) => {
    if (!pred) err(`${key}: ${b.t} block ${msg || `missing/invalid "${field}"`}`);
  };

  switch (b.t) {
    case 'h': need('text', typeof b.text === 'string' && b.text.length > 0); break;

    case 'prose': case 'note': case 'staff':
      need('md', typeof b.md === 'string' && b.md.trim().length > 0);
      if (typeof b.md === 'string') checkMd(key, b.t, b.md);
      if (b.t === 'note' && b.tone && !['info', 'good', 'warn', 'danger'].includes(b.tone)) {
        err(`${key}: note tone "${b.tone}" is not valid`);
      }
      break;

    case 'diagram':
      need('code', typeof b.code === 'string' && b.code.trim().length > 0);
      if (typeof b.code === 'string') checkMermaid(key, b.code);
      break;

    case 'table':
      need('cols', Array.isArray(b.cols) && b.cols.length > 0);
      need('rows', Array.isArray(b.rows) && b.rows.length > 0);
      if (Array.isArray(b.cols) && Array.isArray(b.rows)) {
        b.rows.forEach((r, i) => {
          if (!Array.isArray(r)) err(`${key}: table row ${i} is not an array`);
          else if (r.length !== b.cols.length) err(`${key}: table row ${i} has ${r.length} cells, header has ${b.cols.length}`);
        });
      }
      break;

    case 'code':
      need('code', typeof b.code === 'string' && b.code.length > 0);
      break;

    case 'grid':
      need('items', Array.isArray(b.items) && b.items.length > 0);
      (b.items || []).forEach((i, n) => { if (!i?.b || !i?.md) err(`${key}: grid item ${n} needs both b and md`); });
      if (b.cols && ![2, 3, 4].includes(b.cols)) err(`${key}: grid cols must be 2, 3 or 4`);
      break;

    case 'steps':
      need('items', Array.isArray(b.items) && b.items.length > 0);
      break;

    case 'tradeoffs':
      need('gains', Array.isArray(b.gains) && b.gains.length > 0);
      need('costs', Array.isArray(b.costs) && b.costs.length > 0);
      break;

    case 'failures':
      need('items', Array.isArray(b.items) && b.items.length >= 4, `needs at least 4 items (has ${b.items?.length ?? 0})`);
      (b.items || []).forEach((i, n) => {
        if (!i?.mode || !i?.blast || !i?.fix) err(`${key}: failure ${n} needs mode, blast and fix`);
      });
      break;

    case 'numbers':
      need('items', Array.isArray(b.items) && b.items.length > 0);
      (b.items || []).forEach((i, n) => { if (!i?.v || !i?.k) err(`${key}: numbers item ${n} needs v and k`); });
      break;

    case 'quiz':
      need('items', Array.isArray(b.items) && b.items.length > 0);
      (b.items || []).forEach((q, n) => {
        if (!q?.q) err(`${key}: quiz ${n} has no question`);
        if (!Array.isArray(q?.options) || q.options.length < 2) err(`${key}: quiz ${n} needs 2+ options`);
        if (typeof q?.answer !== 'number' || q.answer < 0 || q.answer >= (q.options?.length ?? 0)) {
          err(`${key}: quiz ${n} answer index ${q?.answer} is out of range`);
        }
        if (!q?.why || q.why.length < 40) warn(`${key}: quiz ${n} explanation is thin`);
        if (Array.isArray(q?.options) && q.options.length > 5) err(`${key}: quiz ${n} has ${q.options.length} options — the renderer labels only A-E`);
      });
      break;

    case 'details':
      need('title', typeof b.title === 'string' && b.title.length > 0);
      break;
  }
}

/**
 * Mermaid constructs that either fail under securityLevel: strict or are
 * version-sensitive enough that they render inconsistently.
 */
function checkMermaid(key, code) {
  const first = code.trim().split('\n')[0].trim();
  if (!MERMAID_KINDS.test(first)) {
    err(`${key}: diagram does not start with a known mermaid kind — got "${first.slice(0, 40)}"`);
    return;
  }
  const kind = first.split(/\s/)[0];

  if (/<(?!br\s*\/?>)[a-z]/i.test(code)) {
    err(`${key}: diagram contains HTML other than <br/>, which strict mode rejects`);
  }

  // Unquoted punctuation in a node label is the most common strict-mode parse
  // failure. Mermaid's own shape delimiters are not labels: A[(cylinder)],
  // A[[subroutine]], A[/parallelogram/], A(round), A{{hexagon}}.
  const SHAPE = /^[([/\\{]|[)\]/\\}]$/;
  for (const [, label] of code.matchAll(/\[([^\]"]+)\]/g)) {
    const inner = label.replace(/^[([/\\{]+|[)\]/\\}]+$/g, '');
    if (SHAPE.test(label[0]) || SHAPE.test(label.at(-1))) continue;
    if (/[(){}:;]/.test(inner)) {
      err(`${key}: node label "${label.slice(0, 40)}" has unquoted punctuation — wrap it as ["..."]`);
    }
  }

  const lines = code.split('\n').length;
  if (lines > 26) warn(`${key}: diagram has ${lines} lines — consider splitting it`);
  if (kind === 'graph') warn(`${key}: "graph" is the legacy keyword — prefer "flowchart"`);
}

/** Catch markdown that the mini renderer will not handle. */
function checkMd(key, where, md) {
  const ticks = (md.match(/`/g) || []).length;
  if (ticks % 2) err(`${key}: ${where} md has an odd number of backticks (${ticks}) — an unclosed code span`);

  if (/^\s*#{1,6}\s/m.test(md)) err(`${key}: ${where} md contains a "#" heading — use a t:'h' block`);
  if (/^\s*\|/m.test(md)) err(`${key}: ${where} md contains a markdown table — use a t:'table' block`);
  if (/```/.test(md)) err(`${key}: ${where} md contains a fenced code block — use a t:'code' block`);

  // Angle brackets inside a code span are intentional -- `<head>` is how you write
  // about a tag. Only flag markup that looks like the author expected it to render.
  const outsideCode = md.replace(/`[^`]*`/g, '');
  const intentional = outsideCode.match(/<\/?(?:b|i|em|strong|br|p|ul|ol|li|span|a|div|code|h[1-6])\b[^>]*>/gi);
  if (intentional) {
    err(`${key}: ${where} md contains formatting HTML (${intentional[0]}) outside a code span — it will be escaped and shown literally`);
  }
}

/* ---------------- question bank ---------------- */

let bankCount = 0;
const bankPath = resolve(root, 'content/practice/bank.js');
if (existsSync(bankPath)) {
  const bank = (await import(`file://${bankPath}`)).default;
  if (!Array.isArray(bank)) err('bank.js does not default-export an array');
  else {
    bankCount = bank.length;
    const ids = new Set();
    for (const q of bank) {
      if (ids.has(q.id)) err(`bank: duplicate id ${q.id}`);
      ids.add(q.id);
      for (const f of ['id', 'title', 'track', 'difficulty', 'pattern', 'prompt']) {
        if (typeof q[f] !== 'string' || !q[f]) err(`bank ${q.id}: missing "${f}"`);
      }
      if (!['frontend', 'backend', 'ai'].includes(q.track)) err(`bank ${q.id}: bad track "${q.track}"`);
      if (!['warmup', 'core', 'hard'].includes(q.difficulty)) err(`bank ${q.id}: bad difficulty "${q.difficulty}"`);
      for (const f of ['clarify', 'approach', 'redflags']) {
        if (!Array.isArray(q[f]) || !q[f].length) err(`bank ${q.id}: missing "${f}"`);
        else for (const s of q[f]) if (typeof s !== 'string' || s.includes('\n')) err(`bank ${q.id}: "${f}" must be single-line strings`);
      }
      if (!Array.isArray(q.deepdives) || q.deepdives.length < 2) err(`bank ${q.id}: needs 2+ deepdives`);
      else for (const d of q.deepdives) if (!d?.q || !d?.a) err(`bank ${q.id}: deepdive missing q or a`);
      for (const id of q.topicIds || []) {
        if (!seenIds.has(id)) err(`bank ${q.id}: topicId "${id}" does not exist`);
      }
    }
  }
} else {
  warn('content/practice/bank.js not found — the question bank page will show an error');
}

/* ---------------- report ---------------- */

const line = '─'.repeat(64);
console.log(line);
console.log(`Tracks      ${TRACKS.length}`);
console.log(`Topics      ${TOPICS.length}`);
console.log(`Blocks      ${totalBlocks}`);
console.log(`Diagrams    ${totalDiagrams}`);
console.log(`Quiz items  ${totalQuiz}`);
console.log(`Flashcards  ${totalCards}`);
console.log(`Drills      ${totalDrills}`);
console.log(`Bank Qs     ${bankCount}`);
console.log(line);

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  ~ ${w}`);
}
if (errors.length) {
  console.log(`\n${errors.length} error(s):`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  console.log('');
  process.exit(1);
}
console.log('\n✓ content valid\n');
