/* Flashcards with SM-2 style spaced repetition. */

import { allCards, TRACK_BY_ID } from '../../../content/index.js';
import * as store from '../store.js';
import { frag, shuffle, relative, loading, plural } from '../dom.js';
import { md } from '../md.js';

const GRADES = [
  { g: 0, label: 'Again', sub: 'blanked', cls: 'g0', key: '1' },
  { g: 1, label: 'Hard', sub: 'struggled', cls: 'g1', key: '2' },
  { g: 2, label: 'Good', sub: 'recalled it', cls: 'g2', key: '3' },
  { g: 3, label: 'Easy', sub: 'instant', cls: 'g3', key: '4' }
];

let trackFilter = 'all';

export default async function cards() {
  const view = frag(`<h1>Flashcards</h1><div id="body"></div>`);
  const body = view.querySelector('#body');
  body.appendChild(loading('Loading cards…'));

  const all = await allCards();
  if (!all.length) {
    body.replaceChildren(frag(`<div class="note warn"><span class="nt">No cards</span>
      Content modules have not loaded.</div>`));
    return view;
  }

  let queue = [], current = null, revealed = false, reviewed = 0;

  function buildQueue() {
    const pool = trackFilter === 'all' ? all : all.filter(c => c.track === trackFilter);
    const due = pool.filter(c => store.isDue(c.id));
    // New cards first when nothing is overdue, so a fresh user has something to do.
    queue = shuffle(due);
  }

  function paint() {
    const pool = trackFilter === 'all' ? all : all.filter(c => c.track === trackFilter);
    const stats = store.srsStats(pool.map(c => c.id));

    if (!current) {
      body.innerHTML = `
        ${filterBar(stats)}
        <div class="card" style="text-align:center;padding:46px">
          ${queue.length
            ? `<h3 style="margin:0">${plural(queue.length, 'card')} ready</h3>
               <p class="muted">${reviewed ? `${reviewed} reviewed this session. ` : ''}Answer out loud before you reveal.</p>
               <button class="btn" id="begin">${reviewed ? 'Continue' : 'Start review'}</button>`
            : `<h3 style="margin:0">Nothing due${trackFilter === 'all' ? '' : ' in this track'}</h3>
               <p class="muted">${reviewed ? `${plural(reviewed, 'card')} reviewed. ` : ''}Spaced repetition
               works because you stop. Come back when cards come due.</p>
               <button class="btn ghost" id="cram">Cram anyway (${pool.length} cards)</button>`}
        </div>
        ${schedule(pool)}`;

      body.querySelector('#begin')?.addEventListener('click', () => { next(); });
      body.querySelector('#cram')?.addEventListener('click', () => {
        queue = shuffle(pool); next();
      });
      body.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
        trackFilter = c.dataset.value; current = null; buildQueue(); paint();
      }));
      return;
    }

    const t = TRACK_BY_ID[current.track];
    body.innerHTML = `
      <div class="between" style="margin-bottom:12px">
        <span class="small muted">${queue.length + 1} left in queue · ${reviewed} done this session</span>
        <a class="small" href="#/topic/${current.track}/${current.topicId}">${current.topicTitle} →</a>
      </div>
      <div class="fcwrap">
        <div class="fc" id="cardface">
          <span class="pill ${t.short}" style="margin-bottom:14px">${t.name}</span>
          <div class="fq">${md(current.q)}</div>
          ${revealed ? `<div class="fa">${md(current.a)}</div>` : `<div class="hintflip">Click, or press <kbd>space</kbd>, to reveal</div>`}
        </div>
        ${revealed ? `<div class="grades">${GRADES.map(g =>
          `<button class="grade ${g.cls}" data-g="${g.g}">${g.label}<span>${g.sub} · ${g.key}</span></button>`).join('')}</div>`
          : `<div class="row" style="justify-content:center;margin-top:16px">
               <button class="btn" id="reveal">Reveal answer</button>
               <button class="btn ghost" id="stop">End session</button>
             </div>`}
      </div>`;

    body.querySelector('#cardface').addEventListener('click', () => { revealed = true; paint(); });
    body.querySelector('#reveal')?.addEventListener('click', () => { revealed = true; paint(); });
    body.querySelector('#stop')?.addEventListener('click', () => { current = null; buildQueue(); paint(); });
    body.querySelectorAll('[data-g]').forEach(b =>
      b.addEventListener('click', () => grade(+b.dataset.g)));
  }

  function next() {
    current = queue.shift() || null;
    revealed = false;
    paint();
  }

  function grade(g) {
    store.gradeCard(current.id, g);
    reviewed++;
    if (g === 0) queue.push(current);   // see it again before the session ends
    next();
  }

  function onKey(e) {
    if (!current || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); revealed = true; paint(); return; }
    if (revealed && '1234'.includes(e.key)) { e.preventDefault(); grade(+e.key - 1); }
  }
  addEventListener('keydown', onKey);
  // The router replaces children, so clean up when this node leaves the DOM.
  new MutationObserver((_, obs) => {
    if (!document.body.contains(view)) { removeEventListener('keydown', onKey); obs.disconnect(); }
  }).observe(document.getElementById('view'), { childList: true });

  buildQueue();
  paint();
  return view;
}

function filterBar(stats) {
  return `<p class="lead">Cards are scheduled by spaced repetition: recall it easily and you will
  not see it for weeks, blank on it and it comes back in minutes. Grade yourself honestly --
  the schedule is only as good as your input.</p>
  <div class="statgrid">
    <div class="stat"><div class="v">${stats.due}</div><div class="k">Due now</div></div>
    <div class="stat"><div class="v">${stats.seen}</div><div class="k">Seen</div></div>
    <div class="stat"><div class="v">${stats.mature}</div><div class="k">Mature (21d+)</div></div>
    <div class="stat"><div class="v">${stats.total}</div><div class="k">Total</div></div>
  </div>
  <div class="filters">
    ${['all', 'frontend', 'backend', 'ai'].map(v =>
      `<button class="chip ${trackFilter === v ? 'on' : ''}" data-value="${v}">${
        v === 'all' ? 'All tracks' : TRACK_BY_ID[v].name}</button>`).join('')}
  </div>`;
}

function schedule(pool) {
  const upcoming = pool
    .map(c => ({ c, s: store.cardState(c.id) }))
    .filter(x => x.s.due > Date.now())
    .sort((a, b) => a.s.due - b.s.due)
    .slice(0, 8);
  if (!upcoming.length) return '';
  return `<h2>Coming up</h2><div class="topiclist">${upcoming.map(({ c, s }) =>
    `<div class="topicrow"><span class="num">${s.interval}d</span>
      <span class="body"><b>${md(c.q)}</b><p>${c.topicTitle}</p></span>
      <span class="meta"><span class="tag">${relative(s.due)}</span></span></div>`).join('')}</div>`;
}
