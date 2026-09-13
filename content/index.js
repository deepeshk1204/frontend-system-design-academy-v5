/* ===========================================================
   content/index.js — the curriculum registry.

   Metadata only. Topic bodies are dynamic imports so the
   initial page load stays small regardless of how much
   content the site grows.
   =========================================================== */

import frontend from './frontend/index.js';
import backend from './backend/index.js';
import ai from './ai/index.js';
import studios from './studios/index.js';

export const TRACKS = [frontend, backend, ai, studios];

export const TRACK_BY_ID = Object.fromEntries(TRACKS.map(t => [t.id, t]));

/** Flat topic list, each annotated with its track and position. */
export const TOPICS = TRACKS.flatMap(track =>
  track.topics.map((topic, i) => ({
    ...topic,
    track: track.id,
    trackName: track.name,
    short: track.short,
    index: i,
    href: `#/topic/${track.id}/${topic.id}`
  }))
);

export const TOPIC_BY_KEY = Object.fromEntries(TOPICS.map(t => [`${t.track}/${t.id}`, t]));

/** Topic ids are unique across tracks, so a bare id resolves too. */
export const TOPIC_BY_ID = Object.fromEntries(TOPICS.map(t => [t.id, t]));

export function trackTopics(trackId) {
  return TOPICS.filter(t => t.track === trackId);
}

export function neighbours(trackId, topicId) {
  const list = trackTopics(trackId);
  const i = list.findIndex(t => t.id === topicId);
  return { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null };
}

export const LEVELS = {
  foundation: { label: 'Foundation', hint: 'Assumed knowledge. Skim if confident.' },
  core: { label: 'Core', hint: 'The bulk of a Senior/Staff loop.' },
  staff: { label: 'Staff', hint: 'Where the signal actually lives.' }
};

/* ---------------- module cache ---------------- */

const cache = new Map();

export async function loadTopic(trackId, topicId) {
  const key = `${trackId}/${topicId}`;
  if (cache.has(key)) return cache.get(key);
  const meta = TOPIC_BY_KEY[key];
  if (!meta) return null;
  const mod = await meta.load();
  const body = { ...meta, ...mod.default };
  cache.set(key, body);
  return body;
}

/**
 * Load every topic body. Used by search indexing and flashcards.
 *
 * A partial result is not memoised: if any import failed -- a network blip on a
 * lazy chunk, say -- the next call retries rather than leaving search and the
 * flashcard deck permanently missing those topics.
 */
let allPromise = null;
export function loadAllTopics() {
  if (!allPromise) {
    allPromise = Promise.all(TOPICS.map(async t => {
      try { return await loadTopic(t.track, t.id); }
      catch (err) {
        console.warn(`[content] ${t.track}/${t.id} failed to load`, err);
        return null;
      }
    })).then(xs => {
      const loaded = xs.filter(Boolean);
      if (loaded.length < TOPICS.length) allPromise = null;
      return loaded;
    });
  }
  return allPromise;
}

/* ---------------- flashcards ---------------- */

/** Stable card ids so SRS scheduling survives content edits elsewhere. */
export async function allCards() {
  const topics = await loadAllTopics();
  return topics.flatMap(t =>
    (t.flashcards || []).map((c, i) => ({
      id: `${t.track}/${t.id}#${i}`,
      q: c.q, a: c.a,
      topicId: t.id, track: t.track, topicTitle: t.title
    }))
  );
}

export async function allDrills() {
  const topics = await loadAllTopics();
  return topics.flatMap(t =>
    (t.drills || []).map((d, i) => ({ ...d, id: `${t.track}/${t.id}!${i}`, topicTitle: t.title, track: t.track, topicId: t.id }))
  );
}
