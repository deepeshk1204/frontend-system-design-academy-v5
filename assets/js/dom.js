/* Tiny DOM helpers shared by the views. */

export function el(html) {
  const t = document.createElement('div');
  t.innerHTML = html.trim();
  return t.children.length === 1 ? t.firstElementChild : t;
}

/** A detached container whose children become the view. */
export function frag(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
}

export function on(root, selector, event, handler) {
  root.addEventListener(event, e => {
    const hit = e.target.closest(selector);
    if (hit && root.contains(hit)) handler(e, hit);
  });
}

export function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

export function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

export function fmtMinutes(m) {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function relative(ms) {
  const d = Math.round((ms - Date.now()) / 86400000);
  if (d <= 0) return 'due now';
  if (d === 1) return 'tomorrow';
  if (d < 30) return `in ${d} days`;
  return `in ${Math.round(d / 30)} months`;
}

/** Fisher-Yates, seeded so a session is reproducible when we want it to be. */
export function shuffle(arr, seed = Date.now()) {
  const a = [...arr];
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toast(msg) {
  const t = el(`<div style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:var(--text);color:var(--bg);padding:11px 18px;border-radius:10px;z-index:80;
    font-size:13.5px;font-weight:600;box-shadow:var(--shadow-lg)">${msg}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

export function loading(text = 'Loading…') {
  return el(`<div class="empty">${text}</div>`);
}
