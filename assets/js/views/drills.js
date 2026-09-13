/* Every topic's open-ended drill in one place, with grading keys hidden. */

import { allDrills, TRACK_BY_ID } from '../../../content/index.js?v=7';
import { frag, on, loading, shuffle } from '../dom.js';
import { md } from '../md.js';

let filter = 'all';

export default async function drills() {
  const view = frag(`
    <h1>Drills</h1>
    <p class="lead">Open-ended scenarios with a grading key -- the closest thing here to a real
    interview question. Set a timer, answer out loud, <i>then</i> reveal the key and grade
    yourself against it. Reading the key first is the single most common way people waste this page.</p>
    <div id="body"></div>`);

  const body = view.querySelector('#body');
  body.appendChild(loading('Loading drills…'));

  const all = await allDrills();

  function paint() {
    const list = filter === 'all' ? all : all.filter(d => d.track === filter);
    body.innerHTML = `
      <div class="filters">
        ${['all', 'frontend', 'backend', 'ai', 'studios'].map(v =>
          `<button class="chip ${filter === v ? 'on' : ''}" data-value="${v}">${
            v === 'all' ? `All ${all.length}` : TRACK_BY_ID[v].name}</button>`).join('')}
        <button class="chip" data-value="__random">Shuffle</button>
      </div>
      ${list.map(d => `<div class="drill">
        <div class="between" style="margin-bottom:8px">
          <span class="pill ${TRACK_BY_ID[d.track].short}">${TRACK_BY_ID[d.track].name}</span>
          <a class="small" href="#/topic/${d.track}/${d.topicId}">${d.topicTitle} →</a>
        </div>
        <p class="dq">${md(d.prompt)}</p>
        ${d.probes?.length ? `<p class="small muted" style="margin:10px 0 0"><b>Expect to be pushed on:</b></p>
          <ul class="small" style="margin:4px 0;color:var(--text-soft)">${d.probes.map(p => `<li>${md(p)}</li>`).join('')}</ul>` : ''}
        <button class="btn ghost sm" data-reveal style="margin-top:10px">Reveal grading key</button>
        <div class="lvls hidden">
          <div class="s"><b>A strong answer contains</b><ul>${(d.strong || []).map(x => `<li>${md(x)}</li>`).join('')}</ul></div>
          <div class="w"><b>Tells of a shallow answer</b><ul>${(d.weak || []).map(x => `<li>${md(x)}</li>`).join('')}</ul></div>
        </div>
      </div>`).join('') || '<div class="empty">No drills in this track yet.</div>'}`;
  }

  on(body, '.chip', 'click', (e, chip) => {
    if (chip.dataset.value === '__random') {
      const one = shuffle(filter === 'all' ? all : all.filter(d => d.track === filter))[0];
      if (one) location.hash = `#/topic/${one.track}/${one.topicId}#drill`;
      return;
    }
    filter = chip.dataset.value;
    paint();
  });

  on(body, '[data-reveal]', 'click', (e, btn) => {
    const key = btn.parentElement.querySelector('.lvls');
    key.classList.toggle('hidden');
    btn.textContent = key.classList.contains('hidden') ? 'Reveal grading key' : 'Hide grading key';
  });

  paint();
  return view;
}
