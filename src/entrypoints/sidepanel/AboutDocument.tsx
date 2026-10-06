import { Fragment } from 'preact';
import { languageLabel, type DocumentBrief } from '@/engine/index';

// "About this document" (plan M2 §2, M2-E1): the brief from the analyze stage, collapsed by
// default. It is model output, so it is rendered as text only (DESIGN.md §5.6, §8).

const ROWS = [
  ['genre', 'Genre'],
  ['audience', 'Audience'],
  ['purpose', 'Purpose'],
  ['tone', 'Tone'],
] as const;

export function AboutDocument({ brief, sourceLang }: { brief: DocumentBrief; sourceLang: string }) {
  const rows = ROWS.filter(([key]) => brief[key] !== '');
  return (
    <details class="about" data-testid="about">
      <summary class="about__summary">About this document</summary>
      <dl class="about__list">
        {sourceLang ? (
          <>
            <dt>Language</dt>
            <dd>{languageLabel(sourceLang)}</dd>
          </>
        ) : null}
        {rows.map(([key, label]) => (
          <Fragment key={key}>
            <dt>{label}</dt>
            <dd data-field={key}>{brief[key]}</dd>
          </Fragment>
        ))}
        {brief.glossary.length ? (
          <>
            <dt>Key terms</dt>
            <dd>
              <ul class="about__terms" data-field="glossary">
                {brief.glossary.map((g) => (
                  <li key={g.term}>
                    <span class="about__term">{g.term}</span>
                    {g.rendering !== g.term ? <> → {g.rendering}</> : null}
                    {g.note ? <span class="about__note"> · {g.note}</span> : null}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        ) : null}
      </dl>
    </details>
  );
}
