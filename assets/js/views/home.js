import { TRACKS, TOPICS, trackTopics, allCards } from '../../../content/index.js';
import { FRAMEWORKS } from '../../../content/practice/frameworks.js';
import * as store from '../store.js';
import { frag, pct, fmtMinutes, plural } from '../dom.js';

export default async function home() {
  const totalMinutes = TOPICS.reduce((n, t) => n + t.minutes, 0);
  const doneAll = store.doneCount(TOPICS.map(t => t.id));
  const s = store.streak();

  const trackCards = TRACKS.map(t => {
    const list = trackTopics(t.id);
    const n = store.doneCount(list.map(x => x.id));
    return `<a class="trackcard ${t.short}" href="#/track/${t.id}">
      <h3>${t.name}</h3>
      <p>${t.tagline}</p>
      <div class="bar ${t.short}"><i style="width:${pct(n, list.length)}%"></i></div>
      <p class="small muted" style="margin:8px 0 0;min-height:0">
        ${n} of ${list.length} topics · ${fmtMinutes(list.reduce((a, x) => a + x.minutes, 0))}</p>
    </a>`;
  }).join('');

  const view = frag(`
    <div class="hero">
      <h1>Learn the system, not the flashcard.</h1>
      <p>A concept-first curriculum and practice loop for <b>Staff-level</b> engineering
      interviews across frontend systems, distributed backends and AI engineering. Every topic
      answers the same six questions: what it is, why it exists, how it actually works, what it
      costs you, how it fails, and what a strong candidate says out loud.</p>
      <div class="tags" style="margin:18px 0 22px">
        <span class="tag">${TOPICS.length} topics</span>
        <span class="tag">${fmtMinutes(totalMinutes)} of reading</span>
        <span class="tag" id="cardcount">flashcards with spaced repetition</span>
        <span class="tag">timed mock interviews</span>
        <span class="tag">no account, no tracking</span>
      </div>
      <div class="row">
        <a class="btn ghost" href="#/roadmap">Start with the roadmap</a>
        <a class="btn ghost" href="#/practice/mock">Run a mock interview</a>
      </div>
    </div>

    <div class="trackcards">
      ${trackCards}
      <a class="trackcard px" href="#/practice">
        <h3>Practice</h3>
        <p>Question bank, open-ended drills with grading keys, flashcards, and a timed mock round.</p>
        <div class="bar px"><i style="width:0%"></i></div>
        <p class="small muted" style="margin:8px 0 0;min-height:0" id="practicestat">—</p>
      </a>
    </div>

    <div class="statgrid">
      <div class="stat"><div class="v">${doneAll}<span class="muted" style="font-size:17px">/${TOPICS.length}</span></div><div class="k">Topics read</div></div>
      <div class="stat"><div class="v" id="duecount">—</div><div class="k">Cards due</div></div>
      <div class="stat"><div class="v">${s.days || 0}</div><div class="k">Day streak</div></div>
      <div class="stat"><div class="v">${store.listMocks().length}</div><div class="k">Mocks logged</div></div>
    </div>

    <h2>How to actually use this</h2>
    <p class="lead">Reading alone does not move interview performance. The loop that does is
    read once, explain it out loud, then get tested on it a week later when you have forgotten it.</p>

    <div class="grid c3">
      <div class="mini"><b>1. Read a topic</b><p>Work through a track in order. Mark it complete only when you could teach it to a junior engineer without notes.</p></div>
      <div class="mini"><b>2. Do the drill</b><p>Each topic ends with an open-ended scenario and a grading key. Answer out loud, then grade yourself against the key honestly.</p></div>
      <div class="mini"><b>3. Review the cards</b><p>Flashcards are scheduled by spaced repetition. Ten minutes a day beats a four-hour cram, and the schedule enforces that.</p></div>
      <div class="mini"><b>4. Run a timed mock</b><p>45 minutes, six phases, a real clock. The scratchpad and self-grade rubric are saved so you can compare sessions.</p></div>
      <div class="mini"><b>5. Attack the bank</b><p>66 questions with clarifying questions, solution skeletons, deep-dive follow-ups and the red flags for each.</p></div>
      <div class="mini"><b>6. Find the gap</b><p>The progress page shows which rubric dimensions you keep failing. That is your study list, not the topic order.</p></div>
    </div>

    <h2>Three frameworks worth memorising</h2>
    <div class="grid c3">
      ${FRAMEWORKS.map(f => `<div class="mini">
        <b>${f.name}</b>
        <p style="margin-bottom:8px">${f.when}</p>
        <ul class="small" style="padding-left:17px;margin:0;color:var(--text-soft)">
          ${f.steps.map(s => `<li>${s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')}</li>`).join('')}
        </ul></div>`).join('')}
    </div>

    <div class="note good" style="margin-top:26px">
      <span class="nt">What "Staff" actually means in a loop</span>
      A Senior candidate designs the system correctly. A Staff candidate does that and then
      chooses the boundaries, names the migration path, says which team owns what, quantifies the
      blast radius of being wrong, and tells you what they would deliberately not build. The
      diagrams are the easy half.
    </div>
  `);

  // Card counts need the content modules, so fill them in once loaded.
  allCards().then(cards => {
    const { due, seen, mature } = store.srsStats(cards.map(c => c.id));
    view.querySelector('#cardcount').textContent = `${cards.length} flashcards`;
    view.querySelector('#duecount').textContent = String(due);
    view.querySelector('#practicestat').textContent =
      `${plural(due, 'card')} due · ${mature} mature · ${seen} seen`;
  }).catch(() => {});

  return view;
}
