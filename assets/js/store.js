/* ===========================================================
   store.js — all persistence. localStorage only, no backend.
   Shape:
   {
     v: 2,
     theme: 'light' | 'dark' | null,
     done: { [topicId]: epochMs },
     quiz: { [topicId]: { [qIdx]: 0|1 } },
     srs:  { [cardId]: { ease, interval, due, reps, lapses } },
     mock: { [sessionId]: { qid, title, startedAt, endedAt, notes, rubric } },
     bank: { [questionId]: 'todo' | 'doing' | 'done' },
     streak: { last: 'YYYY-MM-DD', days: n, best: n }
   }
   =========================================================== */

const KEY = 'sea.v2';
const listeners = new Set();

const BLANK = () => ({
  v: 2, theme: null, done: {}, quiz: {}, srs: {}, mock: {}, bank: {}, streak: { last: null, days: 0, best: 0 }
});

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return migrate(BLANK());
    return migrate({ ...BLANK(), ...JSON.parse(raw) });
  } catch {
    return BLANK();
  }
}

/** Pull forward progress from the v5 single-file version if present. */
function migrate(s) {
  try {
    const legacy = localStorage.getItem('fsd-v5-progress');
    if (legacy && !s._migrated) {
      s._migrated = true;
      s._legacyChecks = JSON.parse(legacy);
    }
  } catch { /* ignore */ }
  return s;
}

let state = read();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ }
  listeners.forEach(fn => { try { fn(state); } catch { /* subscriber bug */ } });
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function snapshot() { return state; }

/* ---------------- theme ---------------- */

export function getTheme() {
  if (state.theme) return state.theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(t) {
  state.theme = t;
  document.documentElement.dataset.theme = t;
  persist();
}

export function applyTheme() { document.documentElement.dataset.theme = getTheme(); }

/* ---------------- topic completion ---------------- */

export function isDone(id) { return !!state.done[id]; }

export function setDone(id, on) {
  if (on) { state.done[id] = Date.now(); touchStreak(); }
  else delete state.done[id];
  persist();
}

export function doneCount(ids) { return ids.filter(id => state.done[id]).length; }

/* ---------------- quiz ---------------- */

export function quizResult(topicId, i) { return state.quiz[topicId]?.[i]; }

export function setQuizResult(topicId, i, correct) {
  state.quiz[topicId] = state.quiz[topicId] || {};
  state.quiz[topicId][i] = correct ? 1 : 0;
  touchStreak();
  persist();
}

/* ---------------- question bank status ---------------- */

export function bankStatus(id) { return state.bank[id] || 'todo'; }

export function cycleBankStatus(id) {
  const order = ['todo', 'doing', 'done'];
  const next = order[(order.indexOf(bankStatus(id)) + 1) % order.length];
  if (next === 'todo') delete state.bank[id]; else state.bank[id] = next;
  touchStreak();
  persist();
  return next;
}

/* ---------------- spaced repetition (SM-2, simplified) ---------------- */

const DAY = 86400000;

export function cardState(id) {
  return state.srs[id] || { ease: 2.5, interval: 0, due: 0, reps: 0, lapses: 0 };
}

export function isDue(id, now = Date.now()) { return cardState(id).due <= now; }

/**
 * grade: 0 again · 1 hard · 2 good · 3 easy
 */
export function gradeCard(id, grade) {
  const c = { ...cardState(id) };
  const now = Date.now();
  if (grade === 0) {
    c.lapses++; c.reps = 0; c.interval = 0;
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.due = now + 60000 * 10;
  } else {
    c.ease = Math.min(3.2, Math.max(1.3, c.ease + (grade === 1 ? -0.15 : grade === 3 ? 0.1 : 0)));
    if (c.reps === 0) c.interval = grade === 1 ? 1 : grade === 3 ? 4 : 2;
    else if (c.reps === 1) c.interval = grade === 1 ? 3 : grade === 3 ? 8 : 6;
    else c.interval = Math.round(c.interval * c.ease * (grade === 1 ? 0.6 : grade === 3 ? 1.25 : 1));
    c.interval = Math.min(c.interval, 365);
    c.reps++;
    c.due = now + c.interval * DAY;
  }
  state.srs[id] = c;
  touchStreak();
  persist();
  return c;
}

export function srsStats(allIds) {
  const now = Date.now();
  let due = 0, seen = 0, mature = 0;
  for (const id of allIds) {
    const c = state.srs[id];
    if (!c) { due++; continue; }
    seen++;
    if (c.interval >= 21) mature++;
    if (c.due <= now) due++;
  }
  return { due, seen, mature, total: allIds.length };
}

/* ---------------- mock interview sessions ---------------- */

export function saveMock(session) {
  state.mock[session.id] = session;
  touchStreak();
  persist();
}

export function listMocks() {
  return Object.values(state.mock).sort((a, b) => b.startedAt - a.startedAt);
}

export function deleteMock(id) { delete state.mock[id]; persist(); }

/* ---------------- streak ---------------- */

function today() { return new Date().toISOString().slice(0, 10); }

function touchStreak() {
  const t = today(), s = state.streak;
  if (s.last === t) return;
  const y = new Date(Date.now() - DAY).toISOString().slice(0, 10);
  s.days = s.last === y ? s.days + 1 : 1;
  s.last = t;
  s.best = Math.max(s.best || 0, s.days);
}

export function streak() { return state.streak; }

/* ---------------- export / import / reset ---------------- */

export function exportJSON() { return JSON.stringify(state, null, 2); }

export function importJSON(text) {
  const next = JSON.parse(text);
  if (typeof next !== 'object' || next === null) throw new Error('Not an object');
  state = { ...BLANK(), ...next };
  persist();
  applyTheme();
}

export function resetAll() {
  state = BLANK();
  persist();
  applyTheme();
}
