/* ===========================================================
   blocks.js — renders a topic's `blocks` array to HTML.

   THIS FILE IS THE CONTENT SCHEMA. Every block is
   { t: '<type>', ...fields }. Unknown types render nothing
   rather than throwing, so a typo degrades instead of
   blanking the page.

   t = 'h'         { text, id? }                      section heading
   t = 'prose'     { md }                             paragraphs/lists
   t = 'note'      { md, tone?: info|good|warn|danger, title? }
   t = 'diagram'   { code, caption? }                 mermaid source
   t = 'table'     { cols: [], rows: [[]], title? }   cells accept inline md
   t = 'code'      { code, lang?, title? }
   t = 'grid'      { items: [{ b, md }], cols?: 2|3|4, title? }
   t = 'steps'     { items: [md], ordered?: true, title? }
   t = 'tradeoffs' { gains: [md], costs: [md], title? }
   t = 'failures'  { items: [{ mode, blast, fix }], title? }
   t = 'staff'     { md }                             staff interview angle
   t = 'numbers'   { items: [{ v, k, note? }], title? }  back-of-envelope facts
   t = 'quiz'      { items: [{ q, options: [], answer: idx, why }] }
   t = 'details'   { title, blocks: [] }              collapsed nested blocks
   =========================================================== */

import { md, mdBlock, esc } from './md.js';
import { registerDiagram } from './diagram.js';
import { quizResult, setQuizResult } from './store.js';

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const R = {
  h: b => `<h2 id="${esc(b.id || slug(b.text))}">${md(b.text)}</h2>`,

  prose: b => mdBlock(b.md),

  note: b => `<div class="note ${esc(b.tone || 'info')}">${
    b.title ? `<span class="nt">${md(b.title)}</span>` : ''
  }${mdBlock(b.md)}</div>`,

  diagram: b => {
    const id = registerDiagram(b.code);
    return `<figure class="diagram" data-diagram="${id}">`
      + `<div class="loadingdiag">Rendering diagram…</div></figure>`
      + (b.caption ? `<p class="small muted" style="text-align:center;margin-top:-6px">${md(b.caption)}</p>` : '');
  },

  table: b => `${b.title ? `<h4>${md(b.title)}</h4>` : ''}<div class="tablewrap"><table><thead><tr>`
    + b.cols.map(c => `<th>${md(c)}</th>`).join('')
    + `</tr></thead><tbody>`
    + b.rows.map(r => `<tr>${r.map(c => `<td>${md(c)}</td>`).join('')}</tr>`).join('')
    + `</tbody></table></div>`,

  code: b => `${b.title ? `<h4>${md(b.title)}</h4>` : ''}`
    + `<div class="codeblock"><span class="lang">${esc(b.lang || 'text')}</span>`
    + `<pre><code>${esc(b.code)}</code></pre></div>`,

  grid: b => `${b.title ? `<h4>${md(b.title)}</h4>` : ''}`
    + `<div class="grid c${b.cols || 3}">`
    + b.items.map(i => `<div class="mini"><b>${md(i.b)}</b><p>${md(i.md)}</p></div>`).join('')
    + `</div>`,

  steps: b => `${b.title ? `<h4>${md(b.title)}</h4>` : ''}`
    + `<${b.ordered === false ? 'ul' : 'ol'}>`
    + b.items.map(i => `<li>${md(i)}</li>`).join('')
    + `</${b.ordered === false ? 'ul' : 'ol'}>`,

  tradeoffs: b => `${b.title ? `<h4>${md(b.title)}</h4>` : ''}<div class="tradeoffs">`
    + `<div class="tocol gain"><h5>What you gain</h5><ul>${b.gains.map(g => `<li>${md(g)}</li>`).join('')}</ul></div>`
    + `<div class="tocol cost"><h5>What it costs you</h5><ul>${b.costs.map(c => `<li>${md(c)}</li>`).join('')}</ul></div>`
    + `</div>`,

  failures: b => `<h4>${md(b.title || 'Failure modes')}</h4><div class="tablewrap"><table>`
    + `<thead><tr><th>Failure mode</th><th>What the user sees</th><th>Mitigation</th></tr></thead><tbody>`
    + b.items.map(i => `<tr><td>${md(i.mode)}</td><td>${md(i.blast)}</td><td>${md(i.fix)}</td></tr>`).join('')
    + `</tbody></table></div>`,

  staff: b => `<div class="note" style="border-left-color:var(--ai);background:color-mix(in srgb,var(--ai) 9%,transparent)">`
    + `<span class="nt" style="color:var(--ai)">Staff-level angle</span>${mdBlock(b.md)}</div>`,

  numbers: b => `${b.title ? `<h4>${md(b.title)}</h4>` : ''}<div class="grid c4">`
    + b.items.map(i => `<div class="mini"><b style="font-size:19px;letter-spacing:-.02em">${md(i.v)}</b>`
      + `<p>${md(i.k)}${i.note ? `<br><span class="muted small">${md(i.note)}</span>` : ''}</p></div>`).join('')
    + `</div>`,

  quiz: (b, ctx) => b.items.map((q, i) => {
    const idx = `${ctx.topicId}:${ctx.qOffset + i}`;
    const prev = quizResult(ctx.topicId, ctx.qOffset + i);
    return `<div class="quiz" data-quiz="${esc(idx)}" data-answer="${q.answer}">`
      + `<p class="qq">${md(q.q)}</p><div class="opts">`
      + q.options.map((o, j) => `<button class="opt" data-opt="${j}" type="button">`
        + `<span class="ol">${'ABCDE'[j]}</span><span>${md(o)}</span></button>`).join('')
      + `</div><div class="why hidden">${md(q.why)}</div>`
      + (prev !== undefined ? `<p class="small muted" style="margin:8px 0 0">Previously answered ${prev ? 'correctly' : 'incorrectly'}.</p>` : '')
      + `</div>`;
  }).join(''),

  details: (b, ctx) => `<details class="dd"><summary>${md(b.title)}</summary>`
    + `<div class="dd-body">${renderBlocks(b.blocks, ctx)}</div></details>`
};

export function renderBlocks(blocks, ctx = {}) {
  const c = { topicId: ctx.topicId || 'x', qOffset: ctx.qOffset || 0 };
  let html = '';
  for (const b of blocks || []) {
    const fn = R[b?.t];
    if (!fn) continue;
    html += fn(b, c);
    if (b.t === 'quiz') c.qOffset += b.items.length;
    if (b.t === 'details') c.qOffset += countQuiz(b.blocks);
  }
  return html;
}

function countQuiz(blocks) {
  let n = 0;
  for (const b of blocks || []) {
    if (b?.t === 'quiz') n += b.items.length;
    if (b?.t === 'details') n += countQuiz(b.blocks);
  }
  return n;
}

/** Delegated quiz handling — call once per rendered view. */
export function bindQuizzes(root, topicId) {
  root.querySelectorAll('.quiz').forEach(q => {
    const answer = +q.dataset.answer;
    const qIdx = +String(q.dataset.quiz).split(':')[1];
    q.querySelectorAll('.opt').forEach(btn => {
      btn.addEventListener('click', () => {
        if (q.dataset.locked) return;
        q.dataset.locked = '1';
        const picked = +btn.dataset.opt;
        q.querySelectorAll('.opt').forEach((b2, j) => {
          b2.disabled = true;
          if (j === answer) b2.classList.add('right');
          else if (j === picked) b2.classList.add('wrong');
        });
        q.querySelector('.why').classList.remove('hidden');
        setQuizResult(topicId, qIdx, picked === answer);
      });
    });
  });
}

/** Headings for the "on this page" rail. */
export function outline(blocks) {
  return (blocks || [])
    .filter(b => b?.t === 'h')
    .map(b => ({ id: b.id || slug(b.text), text: b.text }));
}
