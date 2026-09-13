import { TRACKS, TOPICS, trackTopics, allCards } from '../../../content/index.js';
import { RUBRIC, RUBRIC_DIMS } from '../../../content/practice/frameworks.js';
import * as store from '../store.js';
import { frag, pct, fmtDate, download, toast, fmtMinutes } from '../dom.js';

export default async function progress() {
  const s = store.snapshot();
  const mocks = store.listMocks();
  const doneAll = store.doneCount(TOPICS.map(t => t.id));
  const st = store.streak();

  // Which rubric lines do you keep failing across sessions?
  const graded = mocks.filter(m => m.rubric && Object.keys(m.rubric).length);
  const weak = RUBRIC.map(r => {
    const hit = graded.filter(m => m.rubric[r.id]).length;
    return { ...r, hit, total: graded.length, rate: graded.length ? hit / graded.length : null };
  }).filter(r => r.rate !== null).sort((a, b) => a.rate - b.rate);

  const quizTotals = Object.values(s.quiz || {}).flatMap(o => Object.values(o));
  const quizRight = quizTotals.filter(Boolean).length;

  const view = frag(`
    <h1>Progress</h1>
    <p class="lead">Everything here lives in this browser's localStorage. No account, no server,
    no telemetry. Export it if you switch machines.</p>

    <div class="statgrid">
      <div class="stat"><div class="v">${doneAll}<span class="muted" style="font-size:17px">/${TOPICS.length}</span></div><div class="k">Topics complete</div></div>
      <div class="stat"><div class="v" id="cardsdue">—</div><div class="k">Cards due</div></div>
      <div class="stat"><div class="v">${st.days || 0}<span class="muted" style="font-size:15px"> best ${st.best || 0}</span></div><div class="k">Day streak</div></div>
      <div class="stat"><div class="v">${quizTotals.length ? pct(quizRight, quizTotals.length) + '%' : '—'}</div><div class="k">Quiz accuracy</div></div>
    </div>

    <h2>By track</h2>
    ${TRACKS.map(t => {
      const list = trackTopics(t.id);
      const n = store.doneCount(list.map(x => x.id));
      const mins = list.filter(x => !store.isDone(x.id)).reduce((a, x) => a + x.minutes, 0);
      return `<div class="card" style="display:flex;gap:16px;align-items:center">
        <div class="ring" style="--v:${pct(n, list.length)}" data-pct="${pct(n, list.length)}%"></div>
        <div style="flex:1;min-width:0">
          <b>${t.name}</b>
          <div class="bar ${t.short}" style="margin:8px 0 5px"><i style="width:${pct(n, list.length)}%"></i></div>
          <span class="small muted">${n}/${list.length} topics · ${fmtMinutes(mins)} left</span>
        </div>
        <a class="btn ghost sm" href="#/track/${t.id}">Open</a>
      </div>`;
    }).join('')}

    ${graded.length >= 2 ? `<h2>Your recurring gaps</h2>
      <p class="lead">Across ${graded.length} self-graded mock sessions, these are the lines you tick
      least often. This is a better study list than the topic order.</p>
      <div class="tablewrap"><table>
        <thead><tr><th>Dimension</th><th>Behaviour</th><th>Hit rate</th></tr></thead>
        <tbody>${weak.slice(0, 8).map(r => `<tr>
          <td><span class="pill plain">${r.dim}</span></td>
          <td>${r.text}</td>
          <td style="white-space:nowrap"><b style="color:${r.rate < 0.34 ? 'var(--danger)' : r.rate < 0.67 ? 'var(--warn)' : 'var(--good)'}">${Math.round(r.rate * 100)}%</b>
            <span class="small muted"> ${r.hit}/${r.total}</span></td></tr>`).join('')}
        </tbody></table></div>` : mocks.length ? `<div class="note"><span class="nt">Gap analysis</span>
        Complete and self-grade at least two mock sessions and this page will show which rubric
        dimensions you consistently miss.</div>` : ''}

    ${mocks.length ? `<h2>Mock sessions</h2>
      <div class="topiclist">${mocks.map(m => {
        const n = m.rubric ? Object.values(m.rubric).filter(Boolean).length : 0;
        return `<div class="topicrow"><span class="num">${n}</span>
          <span class="body"><b>${m.title}</b><p>${fmtDate(m.startedAt)} · ${n}/${RUBRIC.length} · ${
            (m.notes || '').split(/\s+/).filter(Boolean).length} words of notes</p></span>
          <span class="meta"><a class="btn ghost sm" href="#/practice/mock/${m.qid}">Retry</a></span></div>`;
      }).join('')}</div>` : ''}

    <h2>Your data</h2>
    <div class="card">
      <p>Progress, spaced-repetition schedules, quiz results and mock sessions are stored under the
      <code>sea.v2</code> key in this browser. Clearing site data erases them.</p>
      <div class="row">
        <button class="btn ghost sm" id="export">Export JSON</button>
        <button class="btn ghost sm" id="import">Import JSON</button>
        <button class="btn ghost sm" id="reset" style="border-color:var(--danger);color:var(--danger)">Reset everything</button>
        <input type="file" id="file" accept="application/json" class="hidden">
      </div>
    </div>

    <h2>Study plans</h2>
    <div class="grid c3">
      <div class="mini"><b>2 weeks — loop next week</b>
        <p>Staff-level topics only across all three tracks, the 20 <i>hard</i> bank questions, and one
        timed mock every day. Skip the foundation tier entirely; you either know it or you do not.</p></div>
      <div class="mini"><b>8 weeks — deliberate prep</b>
        <p>One track per fortnight in order, ten flashcards daily, two mocks a week, and the drill at
        the end of every topic. Use the gap table above to pick the fourth fortnight.</p></div>
      <div class="mini"><b>Ongoing — upskilling</b>
        <p>One topic per working day plus the daily card queue. Ignore the mock interviews until you
        have finished a track; the value is in the reading and the drills.</p></div>
    </div>
  `);

  allCards().then(cs => {
    view.querySelector('#cardsdue').textContent = String(store.srsStats(cs.map(c => c.id)).due);
  }).catch(() => {});

  view.querySelector('#export').addEventListener('click', () => {
    download(`staff-academy-progress-${new Date().toISOString().slice(0, 10)}.json`, store.exportJSON());
  });

  const file = view.querySelector('#file');
  view.querySelector('#import').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      store.importJSON(await f.text());
      toast('Progress imported');
      location.reload();
    } catch (err) {
      toast('That file could not be read');
    }
  });

  view.querySelector('#reset').addEventListener('click', () => {
    if (!confirm('Erase all progress, card schedules and mock sessions? This cannot be undone.')) return;
    store.resetAll();
    toast('Everything reset');
    location.reload();
  });

  return view;
}
