#!/usr/bin/env node
/* Generate GitHub-readable markdown from topic modules. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { TRACKS, TOPICS } = await import(`file://${root}/content/index.js`);
const bank = (await import(`file://${root}/content/practice/bank.js`)).default;
const SITE = 'https://deepeshk1204.github.io/staff-engineer-academy';

function cell(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function blocksToMd(blocks, depth = 2) {
  const out = [];
  for (const b of blocks || []) {
    switch (b?.t) {
      case 'h':
        out.push(`${'#'.repeat(depth)} ${b.text}\n`);
        break;
      case 'prose':
        out.push(`${b.md.trim()}\n`);
        break;
      case 'note':
        out.push(`> **${b.title || (b.tone === 'warn' ? 'Warning' : 'Note')}**  \n> ${String(b.md).trim().replace(/\n/g, '\n> ')}\n`);
        break;
      case 'staff':
        out.push(`> **Staff-level angle**  \n> ${String(b.md).trim().replace(/\n/g, '\n> ')}\n`);
        break;
      case 'diagram':
        out.push('```mermaid');
        out.push(String(b.code).trim());
        out.push('```');
        if (b.caption) out.push(`\n*${b.caption}*\n`);
        else out.push('');
        break;
      case 'table': {
        const cols = b.cols || [];
        out.push(b.title ? `**${b.title}**\n` : '');
        out.push(`| ${cols.map(cell).join(' | ')} |`);
        out.push(`| ${cols.map(() => '---').join(' | ')} |`);
        for (const row of b.rows || []) out.push(`| ${row.map(cell).join(' | ')} |`);
        out.push('');
        break;
      }
      case 'code':
        out.push(b.title ? `**${b.title}**\n` : '');
        out.push('```' + (b.lang || ''));
        out.push(String(b.code).replace(/\n$/, ''));
        out.push('```\n');
        break;
      case 'grid':
        out.push(b.title ? `**${b.title}**\n` : '');
        for (const i of b.items || []) out.push(`- **${i.b}** — ${i.md}`);
        out.push('');
        break;
      case 'steps':
        out.push(b.title ? `**${b.title}**\n` : '');
        (b.items || []).forEach((s, i) => out.push(`${i + 1}. ${s}`));
        out.push('');
        break;
      case 'tradeoffs':
        out.push(`**${b.title || 'Trade-offs'}**\n`);
        out.push('What you gain:');
        for (const g of b.gains || []) out.push(`- ${g}`);
        out.push('\nWhat it costs you:');
        for (const c of b.costs || []) out.push(`- ${c}`);
        out.push('');
        break;
      case 'failures':
        out.push(`**${b.title || 'Failure modes'}**\n`);
        out.push('| Failure mode | What the user sees | Mitigation |');
        out.push('| --- | --- | --- |');
        for (const i of b.items || []) out.push(`| ${cell(i.mode)} | ${cell(i.blast)} | ${cell(i.fix)} |`);
        out.push('');
        break;
      case 'numbers':
        out.push(b.title ? `**${b.title}**\n` : '');
        for (const i of b.items || []) out.push(`- **${i.v}** — ${i.k}${i.note ? ` (${i.note})` : ''}`);
        out.push('');
        break;
      case 'quiz':
        out.push('**Check**\n');
        for (const q of b.items || []) {
          out.push(`${q.q}`);
          (q.options || []).forEach((o, i) => {
            const mark = i === q.answer ? ' **(answer)**' : '';
            out.push(`- ${'ABCD'[i]}. ${o}${mark}`);
          });
          if (q.why) out.push(`\n  ${q.why}`);
          out.push('');
        }
        break;
      case 'details':
        out.push(`<details><summary>${b.title}</summary>\n`);
        out.push(blocksToMd(b.blocks, depth + 1));
        out.push('</details>\n');
        break;
      default:
        break;
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

mkdirSync(resolve(root, 'docs'), { recursive: true });
for (const tr of TRACKS) mkdirSync(resolve(root, 'docs', tr.id), { recursive: true });
mkdirSync(resolve(root, 'docs', 'cheatsheets'), { recursive: true });
mkdirSync(resolve(root, 'docs', 'practice'), { recursive: true });

const indexLines = [
  '# Curriculum (markdown export)',
  '',
  'Generated from `content/` by `node tools/export-md.mjs`. Do not edit by hand.',
  `Interactive site: ${SITE}`,
  ''
];

const cheat = {};

for (const t of TOPICS) {
  const mod = (await t.load()).default;
  const live = `${SITE}/${t.href}`;
  const body = [
    `# ${t.title}`,
    '',
    `> ${t.summary}`,
    '',
    `- Track: **${t.trackName}** · Level: **${t.level}** · ~${t.minutes} min`,
    `- [Open in the academy](${live})`,
    '',
    blocksToMd(mod.blocks)
  ];
  if (mod.flashcards?.length) {
    body.push('## Flashcards\n');
    for (const c of mod.flashcards) body.push(`- **${c.q}** — ${c.a}`);
    body.push('');
  }
  if (mod.drills?.length) {
    body.push('## Drills\n');
    for (const d of mod.drills) {
      body.push(`### Drill\n`);
      body.push(`${d.prompt}\n`);
      if (d.probes?.length) {
        body.push('Probes:\n');
        for (const p of d.probes) body.push(`- ${p}`);
        body.push('');
      }
      if (d.strong?.length) {
        body.push('Strong answer contains:\n');
        for (const s of d.strong) body.push(`- ${s}`);
        body.push('');
      }
      if (d.weak?.length) {
        body.push('Weak answer tells:\n');
        for (const s of d.weak) body.push(`- ${s}`);
        body.push('');
      }
    }
  }
  const rel = `${t.track}/${t.id}.md`;
  writeFileSync(resolve(root, 'docs', rel), body.join('\n'));
  indexLines.push(`- [${t.title}](${rel}) — ${t.level}, ~${t.minutes} min`);

  const staff = (mod.blocks || []).find(b => b.t === 'staff');
  if (staff) {
    cheat[t.track] ??= [];
    cheat[t.track].push(`## ${t.title}\n\n${staff.md.trim()}\n`);
  }
}

writeFileSync(resolve(root, 'docs/README.md'), indexLines.join('\n') + '\n');

for (const tr of TRACKS) {
  const parts = [
    `# ${tr.name} — Staff cheatsheet`,
    '',
    'Spoken-answer fragments from each topic. Generated; the full argument is in the topic.',
    ''
  ].concat(cheat[tr.id] || []);
  writeFileSync(resolve(root, 'docs/cheatsheets', `${tr.id}.md`), parts.join('\n'));
}

const staff66 = ['# Staff 66', '', 'Interview prompts from the in-app bank. Open a mock from the live site.', ''];
for (const track of ['frontend', 'backend', 'ai']) {
  staff66.push(`## ${track}`, '');
  for (const q of bank.filter(x => x.track === track)) {
    staff66.push(`- [${q.difficulty}] [${q.title}](${SITE}/#/practice/mock/${q.id})`);
  }
  staff66.push('');
}
writeFileSync(resolve(root, 'docs/practice/STAFF-66.md'), staff66.join('\n'));

console.log(`exported ${TOPICS.length} topics + cheatsheets + Staff 66`);
