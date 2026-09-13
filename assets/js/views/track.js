import { TRACK_BY_ID, trackTopics, LEVELS } from '../../../content/index.js?v=7';
import * as store from '../store.js';
import { frag, pct, fmtMinutes } from '../dom.js';
import { mdBlock } from '../md.js';

export default async function track(trackId) {
  const t = TRACK_BY_ID[trackId];
  if (!t) return frag(`<h1>Unknown track</h1><p><a href="#/">Back</a></p>`);

  const list = trackTopics(trackId);
  const done = store.doneCount(list.map(x => x.id));
  const minutes = list.reduce((a, x) => a + x.minutes, 0);

  const groups = ['foundation', 'core', 'staff'].map(level => {
    const rows = list.filter(x => x.level === level);
    if (!rows.length) return '';
    return `<h2 id="${level}">${LEVELS[level].label}
        <span class="pill plain" style="vertical-align:middle;margin-left:8px">${rows.length} topics</span></h2>
      <p class="muted small" style="margin-top:-4px">${LEVELS[level].hint}</p>
      <div class="topiclist">
        ${rows.map(x => {
          const d = store.isDone(x.id);
          return `<a class="topicrow ${d ? 'done' : ''}" href="#/topic/${trackId}/${x.id}">
            <span class="num">${d ? '✓' : x.index + 1}</span>
            <span class="body"><b>${x.title}</b><p>${x.summary}</p></span>
            <span class="meta">
              <span class="tag">${x.minutes} min</span>
              <span class="pill ${t.short}">${LEVELS[x.level].label}</span>
            </span></a>`;
        }).join('')}
      </div>`;
  }).join('');

  return frag(`
    <div class="crumbs"><a href="#/">Home</a> › <span>${t.name}</span></div>
    <h1>${t.name}</h1>
    <div class="lead">${mdBlock(t.blurb)}</div>

    <div class="card" style="display:flex;align-items:center;gap:18px">
      <div class="ring" style="--v:${pct(done, list.length)}" data-pct="${pct(done, list.length)}%"></div>
      <div style="flex:1;min-width:0">
        <b>${done} of ${list.length} topics complete</b>
        <div class="bar ${t.short}" style="margin:8px 0 6px"><i style="width:${pct(done, list.length)}%"></i></div>
        <span class="small muted">${fmtMinutes(minutes)} of material · ${fmtMinutes(minutes - list.filter(x => store.isDone(x.id)).reduce((a, x) => a + x.minutes, 0))} remaining</span>
      </div>
      <a class="btn" href="#/topic/${trackId}/${(list.find(x => !store.isDone(x.id)) || list[0]).id}">
        ${done ? 'Continue' : 'Start'} →</a>
    </div>

    ${groups}
  `);
}
