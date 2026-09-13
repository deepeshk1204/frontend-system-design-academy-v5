/* ===========================================================
   diagram.js — lazy Mermaid.

   The old build imported Mermaid on every page load and rendered
   every diagram up front. Here the library is fetched only when a
   diagram actually scrolls into view, and each figure renders once.
   Mermaid stays a soft dependency: if the CDN is unreachable the
   page shows the diagram source instead of breaking.
   =========================================================== */

const SRC = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

const pending = new Map();   // id -> mermaid source
let seq = 0;
let loader = null;
let observer = null;

export function registerDiagram(code) {
  const id = `d${++seq}`;
  pending.set(id, code);
  return id;
}

function loadMermaid() {
  if (loader) return loader;
  loader = import(/* @vite-ignore */ SRC)
    .then(m => {
      const mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'neutral',
        themeVariables: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: '13px' },
        flowchart: { curve: 'basis', useMaxWidth: true },
        sequence: { useMaxWidth: true, mirrorActors: false }
      });
      return mermaid;
    })
    .catch(() => null);
  return loader;
}

async function renderOne(fig) {
  const id = fig.dataset.diagram;
  const code = pending.get(id);
  if (!code || fig.dataset.rendered) return;
  fig.dataset.rendered = '1';

  const mermaid = await loadMermaid();
  if (!mermaid) {
    fig.innerHTML = `<pre style="text-align:left;margin:0">${code
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;
    return;
  }
  try {
    const { svg } = await mermaid.render(`m-${id}-${Date.now()}`, code);
    fig.innerHTML = svg;
  } catch (err) {
    fig.innerHTML = `<p class="small muted">Diagram failed to render.</p>`
      + `<pre style="text-align:left">${code.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;
  }
}

/** Observe every unrendered figure in `root`. Idempotent. */
export function hydrateDiagrams(root = document) {
  const figs = root.querySelectorAll('[data-diagram]:not([data-rendered])');
  if (!figs.length) return;

  if (!('IntersectionObserver' in window)) {
    figs.forEach(renderOne);
    return;
  }
  if (!observer) {
    observer = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) { observer.unobserve(e.target); renderOne(e.target); }
      }
    }, { rootMargin: '350px 0px' });
  }
  figs.forEach(f => observer.observe(f));
}

/** Mermaid bakes theme into the SVG, so a theme flip needs a re-render. */
export function retheme() {
  loader = null;
  document.querySelectorAll('[data-diagram][data-rendered]').forEach(f => {
    delete f.dataset.rendered;
    f.innerHTML = '<div class="loadingdiag">Rendering diagram…</div>';
  });
  hydrateDiagrams();
}
