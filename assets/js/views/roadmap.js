import { TRACKS, TOPICS, trackTopics, LEVELS } from '../../../content/index.js';
import * as store from '../store.js';
import { frag, fmtMinutes, pct } from '../dom.js';

export default async function roadmap() {
  const total = TOPICS.reduce((n, t) => n + t.minutes, 0);

  const grid = TRACKS.map(t => {
    const list = trackTopics(t.id);
    const n = store.doneCount(list.map(x => x.id));
    return `<div>
      <div class="side-title" style="padding-left:0;font-size:12px">
        <span class="dot" style="background:var(--${t.short})"></span>${t.name}</div>
      <div class="bar ${t.short}" style="margin:0 0 12px"><i style="width:${pct(n, list.length)}%"></i></div>
      ${['foundation', 'core', 'staff'].map(lv => {
        const rows = list.filter(x => x.level === lv);
        if (!rows.length) return '';
        return `<p class="small muted" style="margin:14px 0 5px;font-weight:750;text-transform:uppercase;letter-spacing:.05em">${LEVELS[lv].label}</p>
          ${rows.map(x => `<a class="topicrow" href="#/topic/${t.id}/${x.id}" style="padding:9px 12px;margin:5px 0">
            <span class="num" style="width:22px;height:22px;font-size:11px">${store.isDone(x.id) ? '✓' : x.index + 1}</span>
            <span class="body"><b style="font-size:13.5px">${x.title}</b></span>
            <span class="meta"><span class="tag">${x.minutes}m</span></span></a>`).join('')}`;
      }).join('')}
    </div>`;
  }).join('');

  return frag(`
    <h1>The roadmap</h1>
    <p class="lead">Three tracks, ${TOPICS.length} topics, ${fmtMinutes(total)} of material. Each
    track is ordered as a teaching sequence, so later topics assume the earlier ones. The tiers
    tell you where the interview signal actually is.</p>

    <div class="grid c3">
      <div class="mini"><b>Foundation</b><p>Assumed knowledge. If you can already explain it, skim
      it and move on -- nobody gets an offer for knowing what DNS is.</p></div>
      <div class="mini"><b>Core</b><p>The bulk of a Senior or Staff loop. You need to be fluent
      here, not merely familiar.</p></div>
      <div class="mini"><b>Staff</b><p>Boundaries, migration, ownership, cost and blast radius.
      This tier is where the level distinction is actually made.</p></div>
    </div>

    <h2>Which order?</h2>
    <div class="card">
      <p><b>If you have an interview in under three weeks:</b> read only the Staff tier across all
      three tracks, then live in the question bank and mock interview. Breadth you cannot deploy
      under pressure is worth nothing.</p>
      <p><b>If you are genuinely upskilling:</b> go through one track end to end in order. The
      sequence matters -- caching makes no sense before HTTP, replication makes no sense before
      transactions, and RAG makes no sense before embeddings.</p>
      <p><b>If you are a frontend engineer targeting an AI-enabled role:</b> finish the Frontend
      track, then take the Backend track's data and resilience topics, then the whole AI track.
      The gap that gets flagged in those loops is almost always distributed-systems reasoning,
      not prompt technique.</p>
    </div>

    <h2>All topics</h2>
    <div class="grid c3" style="align-items:start">${grid}</div>

    <div class="note good" style="margin-top:28px">
      <span class="nt">One habit that matters more than the reading order</span>
      After each topic, close the page and explain it out loud as if to a colleague. The moment you
      stall is the thing you have not actually learned, and it is invisible while you are reading.
    </div>
  `);
}
