/* ===========================================================
   search.js — command palette over the whole corpus.

   Two-stage: topic metadata is available immediately, and the
   full-text index is built the first time the palette opens
   (all content modules are small, and the router pre-warms
   them during idle time anyway).
   =========================================================== */

import { TOPICS, loadAllTopics } from '../../content/index.js?v=7';
import { plain } from './md.js';
import { slug } from './blocks.js';

let index = null;
let building = null;
let scrim = null;

/* ---------------- index ---------------- */

function metaEntries() {
  return TOPICS.map(t => ({
    kind: 'Topic',
    track: t.track,
    title: t.title,
    context: t.summary,
    text: `${t.title} ${t.summary} ${(t.tags || []).join(' ')}`.toLowerCase(),
    href: t.href,
    weight: 3
  }));
}

async function buildIndex() {
  const entries = metaEntries();

  const topics = await loadAllTopics();
  for (const t of topics) {
    // Section headings, with the prose that follows them.
    let currentHead = null, buffer = [];
    const flushSection = () => {
      if (!currentHead) return;
      entries.push({
        kind: 'Section',
        track: t.track,
        title: plain(currentHead.text),
        context: t.title,
        text: `${plain(currentHead.text)} ${buffer.join(' ')}`.toLowerCase(),
        href: `${t.href}#${currentHead.id}`,
        weight: 2
      });
      buffer = [];
    };

    for (const b of t.blocks || []) {
      if (b.t === 'h') { flushSection(); currentHead = { text: b.text, id: b.id || slug(b.text) }; continue; }
      buffer.push(blockText(b));
    }
    flushSection();

    for (const c of t.flashcards || []) {
      entries.push({
        kind: 'Card', track: t.track,
        title: plain(c.q), context: t.title,
        text: `${plain(c.q)} ${plain(c.a)}`.toLowerCase(),
        href: `${t.href}#recall`, weight: 1
      });
    }
  }

  try {
    const bank = (await import('../../content/practice/bank.js')).default;
    for (const q of bank) {
      entries.push({
        kind: 'Question', track: q.track,
        title: plain(q.title), context: `${q.pattern} · ${q.difficulty}`,
        text: `${plain(q.title)} ${plain(q.pattern)} ${plain(q.prompt)}`.toLowerCase(),
        href: `#/practice/bank`, weight: 2
      });
    }
  } catch { /* bank is optional */ }

  return entries;
}

function blockText(b) {
  switch (b?.t) {
    case 'prose': case 'note': case 'staff': return plain(b.md);
    case 'table': return [...(b.cols || []), ...(b.rows || []).flat()].map(plain).join(' ');
    case 'grid': return (b.items || []).map(i => `${plain(i.b)} ${plain(i.md)}`).join(' ');
    case 'steps': return (b.items || []).map(plain).join(' ');
    case 'tradeoffs': return [...(b.gains || []), ...(b.costs || [])].map(plain).join(' ');
    case 'failures': return (b.items || []).map(i => `${plain(i.mode)} ${plain(i.blast)} ${plain(i.fix)}`).join(' ');
    case 'numbers': return (b.items || []).map(i => `${plain(i.v)} ${plain(i.k)}`).join(' ');
    case 'quiz': return (b.items || []).map(i => `${plain(i.q)} ${plain(i.why)}`).join(' ');
    case 'code': return b.code || '';
    case 'details': return `${plain(b.title)} ${(b.blocks || []).map(blockText).join(' ')}`;
    default: return '';
  }
}

/* ---------------- scoring ---------------- */

function search(q) {
  const needle = q.toLowerCase().trim();
  if (!needle) return [];
  const terms = needle.split(/\s+/).filter(Boolean);

  const hits = [];
  for (const e of index) {
    let score = 0, ok = true;
    for (const term of terms) {
      const at = e.text.indexOf(term);
      if (at === -1) { ok = false; break; }
      score += 10;
      if (e.title.toLowerCase().includes(term)) score += 40;
      if (e.title.toLowerCase().startsWith(term)) score += 25;
      if (at < 120) score += 6;
    }
    if (!ok) continue;
    hits.push({ ...e, score: score * e.weight });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 40);
}

function snippet(entry, q) {
  const term = q.toLowerCase().trim().split(/\s+/)[0];
  const src = entry.context || '';
  const at = src.toLowerCase().indexOf(term);
  if (at === -1) return escapeHtml(src.slice(0, 110));
  const from = Math.max(0, at - 34);
  return (from ? '…' : '') + escapeHtml(src.slice(from, from + 110))
    .replace(new RegExp(`(${escapeRe(term)})`, 'i'), '<mark>$1</mark>');
}

function escapeHtml(s) { return String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ---------------- palette ---------------- */

export async function openPalette(initial = '') {
  if (scrim) return;

  scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `
    <div class="palette" role="dialog" aria-modal="true" aria-label="Search">
      <input id="pq" type="search" placeholder="Search topics, sections, flashcards, questions…"
             autocomplete="off" spellcheck="false" value="${escapeHtml(initial)}">
      <div class="results" id="pr"><div class="empty">Building index…</div></div>
      <div class="foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>esc</kbd> close</span>
        <span style="margin-left:auto" id="pcount"></span>
      </div>
    </div>`;
  document.body.appendChild(scrim);

  const input = scrim.querySelector('#pq');
  const results = scrim.querySelector('#pr');
  const countEl = scrim.querySelector('#pcount');
  input.focus();

  if (!index) {
    building = building || buildIndex();
    index = await building;
  }
  countEl.textContent = `${index.length} entries`;

  let sel = 0, current = [];

  function paint() {
    const q = input.value;
    current = search(q);

    if (!q.trim()) {
      results.innerHTML = `<div style="padding:10px 12px" class="small muted">Try
        <b>cache key</b>, <b>quorum</b>, <b>HNSW</b>, <b>prompt injection</b>, <b>idempotency</b>,
        <b>Module Federation</b>, <b>outbox</b>, <b>KV cache</b>.</div>`;
      return;
    }
    if (!current.length) {
      results.innerHTML = `<div class="empty">Nothing matches “${escapeHtml(q)}”.</div>`;
      return;
    }
    sel = Math.min(sel, current.length - 1);
    results.innerHTML = current.map((e, i) => `
      <button class="pres ${i === sel ? 'sel' : ''}" data-i="${i}">
        <span class="pill ${trackShort(e.track)}" style="flex:none">${e.kind}</span>
        <span class="pbody"><b>${highlight(e.title, q)}</b><span>${snippet(e, q)}</span></span>
      </button>`).join('');
    results.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }

  function go(i) {
    const hit = current[i];
    if (!hit) return;
    close();
    location.hash = hit.href;
  }

  function close() {
    scrim?.remove();
    scrim = null;
    removeEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, current.length - 1); paint(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); paint(); return; }
    if (e.key === 'Enter') { e.preventDefault(); go(sel); }
  }

  input.addEventListener('input', () => { sel = 0; paint(); });
  addEventListener('keydown', onKey, true);
  scrim.addEventListener('mousedown', e => { if (e.target === scrim) close(); });
  results.addEventListener('click', e => {
    const b = e.target.closest('.pres');
    if (b) go(+b.dataset.i);
  });

  paint();
}

function trackShort(track) {
  return { frontend: 'fe', backend: 'be', ai: 'ai', studios: 'st' }[track] || 'plain';
}

function highlight(text, q) {
  const term = q.trim().split(/\s+/)[0];
  if (!term) return escapeHtml(text);
  return escapeHtml(text).replace(new RegExp(`(${escapeRe(term)})`, 'i'), '<mark>$1</mark>');
}
