/* ===========================================================
   app.js — hash router, chrome, keyboard shortcuts.

   Hash routing (not History API) is deliberate: it makes the
   site work from file://, from any subdirectory, and on GitHub
   Pages with no server rewrite rules.
   =========================================================== */

import { TRACKS, trackTopics } from '../../content/index.js';
import * as store from './store.js';
import { hydrateDiagrams, retheme } from './diagram.js';
import { openPalette } from './search.js';

import home from './views/home.js';
import track from './views/track.js';
import topic from './views/topic.js';
import bank from './views/bank.js';
import mock from './views/mock.js';
import cards from './views/cards.js';
import drills from './views/drills.js';
import progress from './views/progress.js';
import about from './views/about.js';
import roadmap from './views/roadmap.js';

const view = document.getElementById('view');
const sidebar = document.getElementById('sidebar');

/* ---------------- routes ---------------- */

const ROUTES = [
  [/^\/?$/, () => home()],
  [/^\/track\/([\w-]+)$/, m => track(m[1])],
  [/^\/topic\/([\w-]+)\/([\w-]+)$/, m => topic(m[1], m[2])],
  [/^\/roadmap$/, () => roadmap()],
  [/^\/practice$/, () => bank()],
  [/^\/practice\/bank$/, () => bank()],
  [/^\/practice\/mock\/?([\w-]*)$/, m => mock(m[1] || null)],
  [/^\/practice\/cards$/, () => cards()],
  [/^\/practice\/drills$/, () => drills()],
  [/^\/progress$/, () => progress()],
  [/^\/about$/, () => about()]
];

function parse() {
  const raw = location.hash.replace(/^#/, '');
  const [path, query] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(query || '') };
}

let renderToken = 0;
let lastPath = null;

async function render() {
  const { path, params } = parse();

  // An in-page anchor change should scroll, not re-render the whole view.
  if (path === lastPath && location.hash.split('#')[2]) {
    const el = document.getElementById(location.hash.split('#')[2]);
    if (el) { el.scrollIntoView(); return; }
  }
  lastPath = path;

  const token = ++renderToken;

  for (const [re, handler] of ROUTES) {
    const m = re.exec(path);
    if (!m) continue;

    view.setAttribute('aria-busy', 'true');
    let node;
    try {
      node = await handler(m, params);
    } catch (err) {
      console.error('[router]', err);
      node = errorView(err);
    }
    if (token !== renderToken) return;   // a newer navigation won

    view.replaceChildren(node);
    view.removeAttribute('aria-busy');
    afterRender(path);
    return;
  }

  view.replaceChildren(notFound(path));
  afterRender(path);
}

function afterRender(path) {
  buildSidebar(path);
  markActiveNav(path);
  hydrateDiagrams(view);
  document.body.classList.remove('sidenav');

  // Restore the in-page anchor if there is one, otherwise go to the top.
  const anchor = location.hash.split('#')[2];
  if (anchor) {
    const el = document.getElementById(anchor);
    if (el) { el.scrollIntoView(); return; }
  }
  window.scrollTo(0, 0);
}

function notFound(path) {
  const el = document.createElement('div');
  el.innerHTML = `<h1>Nothing here</h1>
    <p class="lead">No route matches <code>${path.replace(/[<>&]/g, '')}</code>.</p>
    <p><a class="btn" href="#/">Back to the start</a></p>`;
  return el;
}

function errorView(err) {
  const el = document.createElement('div');
  el.innerHTML = `<h1>This page failed to load</h1>
    <p class="lead">A content module could not be imported. If you are opening this from
    <code>file://</code>, ES modules are blocked by the browser's origin rules -- serve the
    folder over HTTP instead.</p>
    <div class="card"><b>Run a local server</b>
    <pre><code>python3 -m http.server 8080</code></pre>
    <p class="small muted">Then open <code>http://localhost:8080</code>.</p></div>
    <details class="dd"><summary>Technical detail</summary><div class="dd-body">
    <pre><code>${String(err && err.stack || err).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</code></pre>
    </div></details>`;
  return el;
}

/* ---------------- chrome ---------------- */

function buildNavLinks() {
  const el = document.getElementById('navlinks');
  el.innerHTML = TRACKS.map(t => `<a href="#/track/${t.id}" data-nav="/track/${t.id}">${t.name}</a>`).join('')
    + `<a href="#/practice" data-nav="/practice">Practice</a>`
    + `<a href="#/roadmap" data-nav="/roadmap">Roadmap</a>`;
}

function markActiveNav(path) {
  document.querySelectorAll('#navlinks a').forEach(a => {
    const base = a.dataset.nav;
    const on = path === base
      || (base !== '/' && path.startsWith(base))
      || (base.startsWith('/track/') && path.startsWith('/topic/' + base.split('/')[2]));
    a.classList.toggle('on', on);
  });
}

function buildSidebar(path) {
  const parts = [];

  for (const t of TRACKS) {
    const list = trackTopics(t.id);
    const n = store.doneCount(list.map(x => x.id));
    parts.push(`<div class="side-group">
      <div class="side-title">
        <span class="dot" style="background:var(--${t.short})"></span>
        <span style="flex:1">${t.name}</span>
        <span style="font-weight:700;color:var(--muted)">${n}/${list.length}</span>
      </div>
      ${list.map(x => {
        const active = path === `/topic/${t.id}/${x.id}`;
        return `<a href="#/topic/${t.id}/${x.id}" class="${active ? 'on' : ''}">
          <span class="tick">${store.isDone(x.id) ? '✓' : ''}</span>
          <span class="lbl">${x.title}</span></a>`;
      }).join('')}
    </div>`);
  }

  parts.push(`<div class="side-group">
    <div class="side-title"><span class="dot" style="background:var(--px)"></span><span>Practice</span></div>
    <a href="#/practice/bank" class="${path.startsWith('/practice/bank') || path === '/practice' ? 'on' : ''}"><span class="tick"></span><span class="lbl">Question bank</span></a>
    <a href="#/practice/mock" class="${path.startsWith('/practice/mock') ? 'on' : ''}"><span class="tick"></span><span class="lbl">Timed mock interview</span></a>
    <a href="#/practice/drills" class="${path === '/practice/drills' ? 'on' : ''}"><span class="tick"></span><span class="lbl">Drills</span></a>
    <a href="#/practice/cards" class="${path === '/practice/cards' ? 'on' : ''}"><span class="tick"></span><span class="lbl">Flashcards</span></a>
    <a href="#/progress" class="${path === '/progress' ? 'on' : ''}"><span class="tick"></span><span class="lbl">Progress</span></a>
  </div>`);

  sidebar.innerHTML = parts.join('');
}

/* ---------------- keyboard ---------------- */

function onKey(e) {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;

  if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
    e.preventDefault(); openPalette(); return;
  }
  if (typing) return;

  if (e.key === '/') { e.preventDefault(); openPalette(); return; }
  if (e.key === '?') { e.preventDefault(); location.hash = '#/about'; return; }

  // j / k move through the current track
  const m = /^\/topic\/([\w-]+)\/([\w-]+)$/.exec(parse().path);
  if (m && (e.key === 'j' || e.key === 'k')) {
    const list = trackTopics(m[1]);
    const i = list.findIndex(t => t.id === m[2]);
    const next = list[i + (e.key === 'j' ? 1 : -1)];
    if (next) location.hash = `#/topic/${m[1]}/${next.id}`;
  }
}

/* ---------------- boot ---------------- */

function boot() {
  store.applyTheme();
  buildNavLinks();

  document.getElementById('theme').addEventListener('click', () => {
    store.setTheme(store.getTheme() === 'dark' ? 'light' : 'dark');
    retheme();
  });

  document.getElementById('opensearch').addEventListener('click', () => openPalette());

  document.getElementById('menu').addEventListener('click', e => {
    const on = document.body.classList.toggle('sidenav');
    e.currentTarget.setAttribute('aria-expanded', String(on));
  });

  addEventListener('hashchange', render);
  addEventListener('keydown', onKey);

  // Keep sidebar ticks in sync when a topic is marked complete.
  store.subscribe(() => buildSidebar(parse().path));

  render();

  // Warm the content cache in the background so search is instant later.
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => import('../../content/index.js').then(m => m.loadAllTopics()));
  }
}

boot();
