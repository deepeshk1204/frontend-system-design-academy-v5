import { loadTopic, neighbours, TRACK_BY_ID, LEVELS } from '../../../content/index.js';
import { renderBlocks, bindQuizzes, outline } from '../blocks.js';
import * as store from '../store.js';
import { frag, el } from '../dom.js';
import { md } from '../md.js';

export default async function topic(trackId, topicId) {
  const t = await loadTopic(trackId, topicId);
  if (!t) return frag(`<h1>Unknown topic</h1><p><a href="#/track/${trackId}">Back to track</a></p>`);

  const track = TRACK_BY_ID[trackId];
  const { prev, next } = neighbours(trackId, topicId);
  const heads = outline(t.blocks);
  const done = store.isDone(topicId);

  const view = frag(`
    <div class="crumbs">
      <a href="#/">Home</a> › <a href="#/track/${trackId}">${track.name}</a> › <span>${t.title}</span>
    </div>

    <div class="topic-head">
      <div class="row" style="margin-bottom:10px">
        <span class="pill ${track.short}">${LEVELS[t.level].label}</span>
        <span class="tag">${t.minutes} min read</span>
        <span class="tag">Topic ${t.index + 1} of ${track.topics.length}</span>
      </div>
      <h1>${t.title}</h1>
      <p class="lead">${md(t.summary)}</p>
      <div class="tags" style="margin-top:12px">${(t.tags || []).map(x => `<span class="tag">${x}</span>`).join('')}</div>
    </div>

    ${heads.length > 2 ? `<details class="dd" style="margin:18px 0">
      <summary>On this page — ${heads.length} sections</summary>
      <div class="dd-body"><ul style="columns:2;margin:0">
        ${heads.map(h => `<li><a href="#${location.hash.split('#')[1]}#${h.id}">${md(h.text)}</a></li>`).join('')}
      </ul></div></details>` : ''}

    <div class="blocks">${renderBlocks(t.blocks, { topicId })}</div>

    ${renderDrills(t.drills)}
    ${renderCards(t.flashcards)}

    <div class="card" style="margin-top:34px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <label class="row" style="flex:1;cursor:pointer;font-weight:650">
        <input type="checkbox" id="markdone" ${done ? 'checked' : ''} style="width:17px;height:17px">
        <span>I could explain this to another engineer without notes</span>
      </label>
      <a class="btn ghost sm" href="#/practice/cards">Review cards</a>
    </div>

    <div class="topic-foot">
      ${prev ? `<a class="navcard" href="#/topic/${trackId}/${prev.id}"><span>← Previous</span><b>${prev.title}</b></a>` : '<span style="flex:1"></span>'}
      ${next
        ? `<a class="navcard next" href="#/topic/${trackId}/${next.id}"><span>Next →</span><b>${next.title}</b></a>`
        : `<a class="navcard next" href="#/track/${trackId}"><span>Track complete →</span><b>Back to ${track.name}</b></a>`}
    </div>

    <p class="small muted" style="text-align:center;margin-top:26px">
      <kbd>j</kbd> next topic · <kbd>k</kbd> previous · <kbd>/</kbd> search
    </p>
  `);

  bindQuizzes(view, topicId);
  bindDrills(view);

  view.querySelector('#markdone').addEventListener('change', e => {
    store.setDone(topicId, e.target.checked);
  });

  return view;
}

function renderDrills(drills) {
  if (!drills?.length) return '';
  return `<h2 id="drill">Interview drill</h2>
    <p class="lead">Answer this out loud, on a timer, before you read the key. Reading the key
    first feels productive and teaches you almost nothing.</p>
    ${drills.map((d, i) => `<div class="drill">
      <p class="dq">${md(d.prompt)}</p>
      ${d.probes?.length ? `<p class="small muted" style="margin:10px 0 0"><b>The interviewer will push on:</b></p>
        <ul class="small" style="margin:4px 0;color:var(--text-soft)">${d.probes.map(p => `<li>${md(p)}</li>`).join('')}</ul>` : ''}
      <button class="btn ghost sm" data-revealdrill="${i}" style="margin-top:10px">Reveal grading key</button>
      <div class="lvls hidden" data-drillkey="${i}">
        <div class="s"><b>A strong answer contains</b><ul>${(d.strong || []).map(x => `<li>${md(x)}</li>`).join('')}</ul></div>
        <div class="w"><b>Tells of a shallow answer</b><ul>${(d.weak || []).map(x => `<li>${md(x)}</li>`).join('')}</ul></div>
      </div>
    </div>`).join('')}`;
}

function bindDrills(view) {
  view.querySelectorAll('[data-revealdrill]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = view.querySelector(`[data-drillkey="${btn.dataset.revealdrill}"]`);
      key.classList.toggle('hidden');
      btn.textContent = key.classList.contains('hidden') ? 'Reveal grading key' : 'Hide grading key';
    });
  });
}

function renderCards(cards) {
  if (!cards?.length) return '';
  return `<h2 id="recall">Recall check</h2>
    <p class="lead">These ${cards.length} cards enter your spaced-repetition queue. Try to answer
    before expanding.</p>
    ${cards.map(c => `<details class="dd"><summary>${md(c.q)}</summary>
      <div class="dd-body">${md(c.a)}</div></details>`).join('')}`;
}
