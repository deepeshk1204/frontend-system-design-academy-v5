/* ===========================================================
   md.js — deliberately tiny markdown subset.
   Content is first-party, but we escape anyway so a stray "<"
   in a code sample can never break the page or inject markup.
   Supported: **bold** *em* `code` [text](url) — paragraphs,
   "- " bullets, "1. " ordered lists, "> " callouts.
   =========================================================== */

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Inline-only rendering. Input is escaped first. */
export function md(src) {
  let s = esc(src);
  // code spans first so their contents are not re-processed
  const spans = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${spans.push(`<code>${c}</code>`) - 1}\u0000`);
  s = s
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, h) => `<a href="${h}">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/ -- /g, ' — ');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => spans[+i]);
}

/** Block-level rendering: paragraphs, lists, quotes. */
export function mdBlock(src) {
  const lines = String(src ?? '').split('\n');
  const out = [];
  let list = null, buf = [];

  const flushPara = () => {
    if (buf.length) { out.push(`<p>${md(buf.join(' '))}</p>`); buf = []; }
  };
  const flushList = () => {
    if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${md(i)}</li>`).join('')}</${list.tag}>`); list = null; }
  };

  for (const raw of lines) {
    const line = raw.trim();
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    const bq = /^>\s+(.*)$/.exec(line);

    if (ul) {
      flushPara();
      if (list?.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
      list.items.push(ul[1]);
    } else if (ol) {
      flushPara();
      if (list?.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
      list.items.push(ol[1]);
    } else if (bq) {
      flushPara(); flushList();
      out.push(`<div class="note">${md(bq[1])}</div>`);
    } else if (!line) {
      flushPara(); flushList();
    } else {
      flushList();
      buf.push(line);
    }
  }
  flushPara(); flushList();
  return out.join('');
}

/** Strip all markup — used for search snippets and text indexing. */
export function plain(src) {
  return String(src ?? '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
