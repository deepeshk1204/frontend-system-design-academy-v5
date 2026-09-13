/* Timed mock interview: real clock, phased structure, scratchpad,
   self-grade rubric. Everything persists so sessions are comparable. */

import { PHASES, TOTAL_MINUTES, RUBRIC, RUBRIC_DIMS, NINE_QUESTIONS } from '../../../content/practice/frameworks.js';
import { TRACK_BY_ID } from '../../../content/index.js?v=7';
import * as store from '../store.js';
import { frag, on, shuffle, fmtDate, toast, download } from '../dom.js';
import { md } from '../md.js';

let ticker = null;

export default async function mock(questionId) {
  clearInterval(ticker);

  let questions = [];
  try { questions = (await import('../../../content/practice/bank.js')).default; } catch { /* optional */ }

  const chosen = questionId ? questions.find(q => q.id === questionId) : null;
  return chosen ? session(chosen) : landing(questions);
}

/* ---------------- landing ---------------- */

function landing(questions) {
  const past = store.listMocks();

  const view = frag(`
    <h1>Timed mock interview</h1>
    <p class="lead">A ${TOTAL_MINUTES}-minute round with the six phases a real loop actually uses,
    a clock that will not wait for you, and a self-grade rubric at the end. The value is almost
    entirely in the honesty of the self-grade.</p>

    <div class="card">
      <div class="between">
        <div style="flex:1;min-width:220px">
          <b>Pick a question</b>
          <p class="small muted" style="margin:3px 0 0">Choose a track, or take whatever comes up --
          which is closer to the real thing.</p>
        </div>
        <div class="row">
          ${['all', 'frontend', 'backend', 'ai'].map(t =>
            `<button class="btn ghost sm" data-start="${t}">${t === 'all' ? 'Any track' : TRACK_BY_ID[t].name}</button>`).join('')}
        </div>
      </div>
    </div>

    <h2>The six phases</h2>
    <div class="tablewrap"><table>
      <thead><tr><th>Phase</th><th>Time</th><th>What you are being scored on</th></tr></thead>
      <tbody>${PHASES.map(p => `<tr>
        <td><b>${p.name}</b></td><td>${p.minutes} min</td>
        <td>${p.goal}<br><span class="small muted">${p.tell}</span></td></tr>`).join('')}
      </tbody></table></div>

    <h2>The nine questions to answer for any design</h2>
    <div class="card"><ol>${NINE_QUESTIONS.map(q => `<li>${md(q)}</li>`).join('')}</ol></div>

    ${past.length ? `<h2>Your sessions</h2>
      <div class="topiclist">${past.map(s => {
        const score = s.rubric ? Object.values(s.rubric).filter(Boolean).length : 0;
        return `<div class="topicrow">
          <span class="num">${score}</span>
          <span class="body"><b>${s.title}</b>
            <p>${fmtDate(s.startedAt)} · ${s.endedAt ? Math.round((s.endedAt - s.startedAt) / 60000) + ' min' : 'unfinished'}
            · scored ${score}/${RUBRIC.length}</p></span>
          <span class="meta">
            <a class="btn ghost sm" href="#/practice/mock/${s.qid}">Retry</a>
            <button class="btn ghost sm" data-del="${s.id}">Delete</button>
          </span></div>`;
      }).join('')}</div>` : `<div class="note"><span class="nt">No sessions yet</span>
        Sessions are saved locally, so you can see whether the same rubric lines keep failing.
        That pattern is more useful than any single score.</div>`}
  `);

  on(view, '[data-start]', 'click', (e, btn) => {
    const t = btn.dataset.start;
    const pool = t === 'all' ? questions : questions.filter(q => q.track === t);
    if (!pool.length) { toast('No questions available'); return; }
    location.hash = `#/practice/mock/${shuffle(pool)[0].id}`;
  });

  on(view, '[data-del]', 'click', (e, btn) => {
    store.deleteMock(btn.dataset.del);
    location.hash = '#/practice/mock';
    toast('Session deleted');
  });

  return view;
}

/* ---------------- live session ---------------- */

function session(q) {
  const id = `m${Date.now()}`;
  const state = {
    id, qid: q.id, title: q.title,
    startedAt: Date.now(), endedAt: null,
    notes: '', rubric: {}
  };

  // Cumulative phase boundaries in seconds.
  let acc = 0;
  const bounds = PHASES.map(p => ({ ...p, start: acc, end: (acc += p.minutes * 60) }));
  const totalSec = acc;

  const view = frag(`
    <div class="crumbs"><a href="#/practice/mock">Mock interview</a> › <span>In session</span></div>

    <div class="between" style="margin-bottom:6px">
      <div style="flex:1;min-width:240px">
        <span class="pill ${TRACK_BY_ID[q.track].short}">${TRACK_BY_ID[q.track].name}</span>
        <h1 style="margin:8px 0 0;font-size:27px">${md(q.title)}</h1>
      </div>
      <div style="text-align:right">
        <div class="timer" id="clock">00:00</div>
        <div class="small muted" id="phaselabel">Not started</div>
      </div>
    </div>

    <div class="card" style="background:var(--bg-sunken)">
      <p style="margin:0">${md(q.prompt)}</p>
    </div>

    <div class="row" style="margin:14px 0">
      <button class="btn" id="startbtn">Start the clock</button>
      <button class="btn ghost" id="pausebtn" disabled>Pause</button>
      <button class="btn ghost" id="finishbtn">Finish &amp; self-grade</button>
      <span class="small muted" id="advice">The clock runs whether you are ready or not. That is the point.</span>
    </div>

    <div class="mockgrid">
      <div>
        <h3 style="margin-top:0">Scratchpad</h3>
        <p class="small muted" style="margin-top:0">Type the way you would talk. If you cannot write
        it in a sentence, you cannot say it under pressure.</p>
        <textarea class="pad" id="pad" placeholder="Scope and non-goals…

Requirements and numbers…

High-level design…

Deep dive…

Failure modes and trade-offs…

What I would not build…"></textarea>
        <p class="small muted" id="saved">Saved locally as you type.</p>
      </div>

      <div>
        <h3 style="margin-top:0">Phases</h3>
        <div id="phases">${bounds.map((p, i) => `<div class="phase" data-phase="${i}">
          <span class="pn">${i + 1}</span>
          <span class="pb"><b>${p.name}</b><span>${p.minutes} min</span></span>
        </div>`).join('')}</div>

        <div class="note" id="phasehint" style="font-size:13.5px">
          <span class="nt">Current focus</span>
          <span id="hinttext">Press start. Phase one is scoping -- do not draw anything yet.</span>
        </div>

        <details class="dd"><summary>The nine questions</summary><div class="dd-body">
          <ol class="small" style="padding-left:18px;margin:0">${NINE_QUESTIONS.map(x => `<li>${md(x)}</li>`).join('')}</ol>
        </div></details>

        <details class="dd"><summary>Clarifying questions worth asking</summary><div class="dd-body">
          <ul class="small" style="padding-left:18px;margin:0">${q.clarify.map(x => `<li>${md(x)}</li>`).join('')}</ul>
          <p class="small muted" style="margin-bottom:0">Opening this during the round is cheating,
          and you already know that.</p>
        </div></details>
      </div>
    </div>

    <div id="gradearea"></div>
  `);

  const clock = view.querySelector('#clock');
  const phaseLabel = view.querySelector('#phaselabel');
  const hint = view.querySelector('#hinttext');
  const pad = view.querySelector('#pad');

  let elapsed = 0, running = false;

  function paintPhase() {
    const cur = bounds.findIndex(p => elapsed < p.end);
    const i = cur === -1 ? bounds.length - 1 : cur;
    view.querySelectorAll('[data-phase]').forEach((n, j) => {
      n.classList.toggle('on', j === i && running);
      n.classList.toggle('past', j < i);
    });
    const p = bounds[i];
    const left = Math.max(0, p.end - elapsed);
    phaseLabel.textContent = running
      ? `${p.name} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left in phase`
      : 'Paused';
    hint.innerHTML = `<b>${p.name}.</b> ${p.goal}<ul style="margin:6px 0 0;padding-left:17px">${
      p.prompts.map(x => `<li>${md(x)}</li>`).join('')}</ul>`;
  }

  function tick() {
    elapsed++;
    const over = elapsed > totalSec;
    clock.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
    clock.classList.toggle('over', over);
    if (over) phaseLabel.textContent = `${elapsed - totalSec}s over time`;
    else paintPhase();
  }

  view.querySelector('#startbtn').addEventListener('click', e => {
    if (running) return;
    running = true;
    e.target.disabled = true;
    view.querySelector('#pausebtn').disabled = false;
    view.querySelector('#advice').textContent = 'Talk out loud. Silent thinking scores zero.';
    clearInterval(ticker);
    ticker = setInterval(tick, 1000);
    paintPhase();
    pad.focus();
  });

  view.querySelector('#pausebtn').addEventListener('click', e => {
    running = !running;
    e.target.textContent = running ? 'Pause' : 'Resume';
    clearInterval(ticker);
    if (running) ticker = setInterval(tick, 1000);
    paintPhase();
  });

  let saveTimer;
  pad.addEventListener('input', () => {
    state.notes = pad.value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      store.saveMock(state);
      view.querySelector('#saved').textContent = `Saved · ${state.notes.split(/\s+/).filter(Boolean).length} words`;
    }, 600);
  });

  view.querySelector('#finishbtn').addEventListener('click', () => {
    running = false;
    clearInterval(ticker);
    state.endedAt = Date.now();
    state.notes = pad.value;
    store.saveMock(state);
    renderGrade(view, state, q, elapsed);
  });

  // A session left by navigating away must not keep ticking in the background.
  const stopOnLeave = () => {
    clearInterval(ticker);
    state.notes = pad.value;
    if (state.notes.trim()) store.saveMock(state);
    removeEventListener('hashchange', stopOnLeave);
  };
  addEventListener('hashchange', stopOnLeave);

  paintPhase();
  return view;
}

/* ---------------- self-grade ---------------- */

function renderGrade(view, state, q, elapsed) {
  const area = view.querySelector('#gradearea');

  area.innerHTML = `<hr>
    <h2 id="grade">Self-grade</h2>
    <p class="lead">Tick only what you genuinely did, out loud, unprompted. An inflated score here
    costs you a real offer later.</p>

    <div class="card">
      ${RUBRIC_DIMS.map(dim => `<h4 style="margin-top:16px">${dim}</h4>
        <div class="rubric">${RUBRIC.filter(r => r.dim === dim).map(r =>
          `<label class="rubitem"><input type="checkbox" data-rub="${r.id}"><span>${md(r.text)}</span></label>`).join('')}
        </div>`).join('')}
      <div class="between" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line)">
        <div><b id="score">0 / ${RUBRIC.length}</b>
          <span class="small muted" id="verdict"> — tick what applies</span></div>
        <div class="row">
          <button class="btn ghost sm" id="copymd">Copy scorecard</button>
          <button class="btn ghost sm" id="exportmd">Export as markdown</button>
          <a class="btn sm" href="#/practice/mock">Done</a>
        </div>
      </div>
    </div>

    <h2>Compare against the skeleton</h2>
    <div class="card">
      <h4 style="margin-top:0">Solution skeleton</h4>
      <ol>${q.approach.map(x => `<li>${md(x)}</li>`).join('')}</ol>
      <h4>Deep dives</h4>
      ${q.deepdives.map(d => `<details class="dd"><summary>${md(d.q)}</summary>
        <div class="dd-body">${md(d.a)}</div></details>`).join('')}
      <h4>Red flags</h4>
      <ul>${q.redflags.map(x => `<li>${md(x)}</li>`).join('')}</ul>
    </div>`;

  const scoreEl = area.querySelector('#score');
  const verdictEl = area.querySelector('#verdict');

  on(area, '[data-rub]', 'change', (e, box) => {
    state.rubric[box.dataset.rub] = box.checked;
    const n = Object.values(state.rubric).filter(Boolean).length;
    scoreEl.textContent = `${n} / ${RUBRIC.length}`;
    verdictEl.textContent = n >= 14 ? ' — strong Staff signal'
      : n >= 11 ? ' — solid Senior, close to Staff'
      : n >= 7 ? ' — Senior range; the gaps are your study list'
      : ' — go back to the phase prompts and run it again';
    store.saveMock(state);
  });

  const scorecard = () => {
    const ticked = RUBRIC.filter(r => state.rubric[r.id]);
    const missed = RUBRIC.filter(r => !state.rubric[r.id]);
    return `# Mock interview — ${q.title}\n\n`
      + `- Date: ${new Date(state.startedAt).toISOString()}\n`
      + `- Duration: ${Math.round(elapsed / 60)} min\n`
      + `- Score: ${ticked.length}/${RUBRIC.length}\n\n`
      + `## Prompt\n\n${q.prompt}\n\n## My notes\n\n${state.notes || '_(empty)_'}\n\n`
      + `## Did\n\n${ticked.map(r => `- [x] ${r.text}`).join('\n') || '_none_'}\n\n`
      + `## Missed\n\n${missed.map(r => `- [ ] ${r.text}`).join('\n') || '_none_'}\n`;
  };

  area.querySelector('#copymd').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(scorecard());
      area.querySelector('#copymd').textContent = 'Copied';
    } catch {
      area.querySelector('#copymd').textContent = 'Copy failed';
    }
  });

  area.querySelector('#exportmd').addEventListener('click', () => {
    download(`mock-${q.id}-${new Date(state.startedAt).toISOString().slice(0, 10)}.md`, scorecard());
  });

  area.querySelector('#grade').scrollIntoView({ behavior: 'smooth' });
}
