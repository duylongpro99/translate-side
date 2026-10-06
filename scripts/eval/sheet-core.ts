// The human scoring sheet (plan M2-E8): a markdown file the user fills in, one `## <passage id>` section per passage
// with source and translation side by side and four `dimension:` lines to fill. `parseHumanSheet` reads it back.
import { DIMENSIONS, rubricMarkdown } from './rubric.ts';
import type { Passage } from './passages.ts';
import { runLabel, type OutputItem, type RunSummary } from './runs.ts';

const quote = (prefix: string, text: string): string => text.split('\n').map((l) => `${prefix} ${l}`).join('\n');

/** Pairs each source segment with its translation. Code is shown once; a missing translation says so. */
export function renderPassageBlock(p: Passage, items: OutputItem[]): string {
  const rows = items.map((it) => (it.kind === 'code' || !it.translate ? quote('CODE |', it.source) : `${quote('EN |', it.source)}\n${quote('VI |', it.text ?? '(no translation)')}`));
  return [`## ${p.meta.id}`, `${p.meta.category} · ${p.meta.title} · ${p.meta.url}`, '', rows.join('\n\n'), '', ...DIMENSIONS.map((d) => `${d}: `), 'notes: ', ''].join('\n');
}

export function renderHumanSheet(summary: RunSummary, blocks: string[]): string {
  return [
    `# Human scoring sheet: ${runLabel(summary)}`,
    '',
    `Run \`${summary.run}\`, target language \`${summary.target}\`. Fill in a score from 1 to 5 (whole numbers; halves are accepted) after each dimension in every passage section. Leave a line empty to skip it. Lines starting with \`EN |\` / \`VI |\` / \`CODE |\` are the passage; code is kept as is and not scored. Do not edit the \`## <id>\` headings: the report finds your scores by them.`,
    '',
    '### Rubric (1–5)',
    '',
    'A 2 sits between the 1 and 3 anchors, a 4 between the 3 and 5 anchors.',
    '',
    rubricMarkdown(),
    '',
    '---',
    '',
    blocks.join('\n---\n\n'),
  ].join('\n');
}
