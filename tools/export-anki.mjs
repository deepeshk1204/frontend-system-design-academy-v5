#!/usr/bin/env node
/* Tab-separated deck for Anki: File → Import → this TSV. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { TOPICS } = await import(`file://${root}/content/index.js`);

function tsv(s) {
  return String(s ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
}

const rows = ['#separator:tab', '#html:true', 'Front\tBack\tTags'];
let n = 0;
for (const t of TOPICS) {
  const mod = (await t.load()).default;
  for (const c of mod.flashcards || []) {
    const tags = [t.track, t.id, ...(t.tags || [])].map(x => String(x).replace(/\s+/g, '-')).join(' ');
    rows.push(`${tsv(c.q)}\t${tsv(c.a)}\t${tags}`);
    n++;
  }
}
mkdirSync(resolve(root, 'docs/practice'), { recursive: true });
writeFileSync(resolve(root, 'docs/practice/anki.tsv'), rows.join('\n') + '\n');
console.log(`exported ${n} cards → docs/practice/anki.tsv`);
