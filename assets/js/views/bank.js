import { TOPIC_BY_ID, TRACK_BY_ID } from '../../../content/index.js?v=7';
import { FRAMEWORKS } from '../../../content/practice/frameworks.js';
import * as store from '../store.js';
import { frag, on, shuffle } from '../dom.js';
import { md } from '../md.js';

const DIFF = { warmup: 'Warm-up', core: 'Core', hard: 'Hard' };
const STATUS_LABEL = { todo: 'Not started', doing: 'In progress', done: 'Done' };

let filters = { track: 'all', difficulty: 'all', status: 'all' };

export default async function bank() {
  let questions;
  try {
    questions = (await import('../../../content/practice/bank.js')).default;
  } catch {
    return frag(`<h1>Question bank</h1>
      <div class="note warn"><span class="nt">Not available</span>
      <code>content/practice/bank.js</code> could not be loaded.</div>`);
  }

  const view = frag(`
    <h1>Question bank</h1>
    <p class="lead">${questions.length} system-design questions with the clarifying questions worth
    asking, a solution skeleton, the deep-dive follow-ups an interviewer pushes on, and the red
    flags for each. Expand one only <i>after</i> you have sketched your own answer -- reading
    solutions is the least effective way to use this page.</p>

    <div class="card" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <b>Practice properly</b>
        <p class="small muted" style="margin:3px 0 0">Pick a random question, set a 45-minute timer,
        and use the mock interview scratchpad. Then compare against the skeleton.</p>
      </div>
      <button class="btn ghost sm" id="random">Random question</button>
      <a class="btn sm" href="#/practice/mock">Open mock interview</a>
    </div>

    <div class="filters" id="filters">
      ${chipGroup('track', ['all', 'frontend', 'backend', 'ai'], id => id === 'all' ? 'All tracks' : TRACK_BY_ID[id].name)}
    </div>
    <div class="filters">
      ${chipGroup('difficulty', ['all', 'warmup', 'core', 'hard'], id => id === 'all' ? 'All levels' : DIFF[id])}
      ${chipGroup('status', ['all', 'todo', 'doing', 'done'], id => id === 'all' ? 'Any status' : STATUS_LABEL[id])}
    </div>

    <p class="small muted" id="tally"></p>
    <div id="rows"></div>

    <h2>Frameworks to structure the answer</h2>
    <div class="grid c3">
      ${FRAMEWORKS.map(f => `<div class="mini"><b>${f.name}</b>
        <p style="margin-bottom:7px">${f.when}</p>
        <ul class="small" style="padding-left:17px;margin:0;color:var(--text-soft)">
          ${f.steps.map(s => `<li>${md(s)}</li>`).join('')}</ul></div>`).join('')}
    </div>
  `);

  const rows = view.querySelector('#rows');
  const tally = view.querySelector('#tally');

  function visible() {
    return questions.filter(q =>
      (filters.track === 'all' || q.track === filters.track) &&
      (filters.difficulty === 'all' || q.difficulty === filters.difficulty) &&
      (filters.status === 'all' || store.bankStatus(q.id) === filters.status));
  }

  function paint() {
    const list = visible();
    const doneN = questions.filter(q => store.bankStatus(q.id) === 'done').length;
    tally.innerHTML = `Showing <b>${list.length}</b> of ${questions.length} · ${doneN} marked done`;
    rows.innerHTML = list.length
      ? list.map(row).join('')
      : `<div class="empty">No questions match those filters.</div>`;
    view.querySelectorAll('#filters .chip, .filters .chip').forEach(c => {
      c.classList.toggle('on', filters[c.dataset.group] === c.dataset.value);
    });
  }

  function row(q) {
    const st = store.bankStatus(q.id);
    return `<div class="qrow" data-q="${q.id}">
      <button class="qhead" type="button" data-toggle>
        <span class="qn">${st === 'done' ? '✓' : st === 'doing' ? '◐' : '○'}</span>
        <span class="qt">${md(q.title)}</span>
        <span class="pill ${TRACK_BY_ID[q.track].short}">${DIFF[q.difficulty]}</span>
        <span class="tag">${md(q.pattern)}</span>
      </button>
      <div class="qbody hidden">
        <p>${md(q.prompt)}</p>

        <h5>Clarify first</h5>
        <ul>${q.clarify.map(x => `<li>${md(x)}</li>`).join('')}</ul>

        <h5>Solution skeleton</h5>
        <ol>${q.approach.map(x => `<li>${md(x)}</li>`).join('')}</ol>

        <h5>Deep dives you will be pushed on</h5>
        ${q.deepdives.map(d => `<details class="dd"><summary>${md(d.q)}</summary>
          <div class="dd-body">${md(d.a)}</div></details>`).join('')}

        <h5>Red flags</h5>
        <ul>${q.redflags.map(x => `<li>${md(x)}</li>`).join('')}</ul>

        ${q.topicIds?.length ? `<h5>Read first</h5><div class="tags">${
          q.topicIds.filter(id => TOPIC_BY_ID[id]).map(id => {
            const t = TOPIC_BY_ID[id];
            return `<a class="tag" href="#/topic/${t.track}/${t.id}">${t.title}</a>`;
          }).join('')}</div>` : ''}

        <div class="row" style="margin-top:16px">
          <button class="btn ghost sm" data-cycle>Mark: ${STATUS_LABEL[st]}</button>
          <a class="btn ghost sm" href="#/practice/mock/${q.id}">Run this as a timed mock →</a>
        </div>
      </div>
    </div>`;
  }

  on(view, '[data-toggle]', 'click', (e, btn) => {
    btn.parentElement.querySelector('.qbody').classList.toggle('hidden');
  });

  on(view, '[data-cycle]', 'click', (e, btn) => {
    const id = btn.closest('.qrow').dataset.q;
    const next = store.cycleBankStatus(id);
    btn.textContent = `Mark: ${STATUS_LABEL[next]}`;
    btn.closest('.qrow').querySelector('.qn').textContent =
      next === 'done' ? '✓' : next === 'doing' ? '◐' : '○';
  });

  on(view, '.chip', 'click', (e, chip) => {
    filters[chip.dataset.group] = chip.dataset.value;
    paint();
  });

  view.querySelector('#random').addEventListener('click', () => {
    const list = visible();
    if (!list.length) return;
    const pick = shuffle(list)[0];
    paint();
    const node = rows.querySelector(`[data-q="${pick.id}"]`);
    node.querySelector('.qbody').classList.remove('hidden');
    node.scrollIntoView({ block: 'center' });
  });

  paint();
  return view;
}

function chipGroup(group, values, label) {
  return values.map(v =>
    `<button class="chip" data-group="${group}" data-value="${v}">${label(v)}</button>`).join('');
}
