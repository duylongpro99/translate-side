import type { ComponentChildren } from 'preact';
import type { Segment } from '@/engine/types';
import { parseMarkup, type MarkupNode } from './markup.ts';

// Original segments rendered by kind (plan M0-E7). Everything is rendered as text.

function Markup({ nodes }: { nodes: MarkupNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case 'text':
            return n.text;
          case 'code':
            return <code key={i}>{n.text}</code>;
          case 'em':
            return (
              <em key={i}>
                <Markup nodes={n.children} />
              </em>
            );
          case 'link':
            // Shown as a link, not followed: the panel has no URL for it (markers carry none).
            return (
              <span key={i} class="seg__link">
                <Markup nodes={n.children} />
              </span>
            );
        }
      })}
    </>
  );
}

function Text({ seg }: { seg: Segment }) {
  return <Markup nodes={parseMarkup(seg.inlineMarkup)} />;
}

function Block({ seg }: { seg: Segment }) {
  const common = { 'data-id': seg.id, 'data-kind': seg.kind, class: `seg seg--${seg.kind}${seg.hidden ? ' seg--hidden' : ''}` };
  const hiddenNote = seg.hidden ? <span class="seg__note">hidden on the page (tab or collapsed section)</span> : null;
  switch (seg.kind) {
    case 'heading':
      return (
        <div {...common} role="heading" aria-level={seg.level ?? 2} data-level={seg.level ?? 2}>
          <Text seg={seg} />
          {hiddenNote}
        </div>
      );
    case 'code':
      return (
        <figure {...common}>
          <figcaption class="seg__label">
            {seg.codeLang ? `${seg.codeLang} · ` : ''}code, kept as is{seg.hidden ? ' · hidden on the page' : ''}
          </figcaption>
          <pre>
            <code>{seg.text}</code>
          </pre>
        </figure>
      );
    case 'li':
      return (
        <div {...common} role="listitem">
          <Text seg={seg} />
          {hiddenNote}
        </div>
      );
    case 'quote':
      return (
        <blockquote {...common}>
          <Text seg={seg} />
          {hiddenNote}
        </blockquote>
      );
    default:
      return (
        <p {...common}>
          <Text seg={seg} />
          {hiddenNote}
        </p>
      );
  }
}

/**
 * The table a row segment belongs to: its domPath up to the last table step. Blocks inside a cell
 * (a list, a quote) carry the row's groupId too. Undefined outside tables.
 */
function tableOf(seg: Segment): string | undefined {
  if (!seg.groupId) return undefined;
  // `~table` is a step Readability created (extract/index.ts livePath).
  const steps = seg.domPath.match(/^.*\/~?table\[\d+\]/);
  return steps?.[0] ?? '';
}

/** Consecutive segments of one table, grouped into rows by groupId. */
function Table({ cells }: { cells: Segment[] }) {
  const rows: Segment[][] = [];
  for (const c of cells) {
    const row = rows[rows.length - 1];
    if (row && row[0]?.groupId === c.groupId) row.push(c);
    else rows.push([c]);
  }
  return (
    <div class="seg-table" role="table">
      {rows.map((row) => (
        <div class="seg-row" role="row" key={row[0]?.id} data-group={row[0]?.groupId}>
          {row.map((c) => (
            <div class={`seg seg--table-cell${c.hidden ? ' seg--hidden' : ''}`} role="cell" data-id={c.id} data-kind={c.kind} key={c.id}>
              <Text seg={c} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SegmentList({ segments }: { segments: Segment[] }) {
  const out: ComponentChildren[] = [];
  for (let i = 0; i < segments.length; ) {
    const seg = segments[i] as Segment;
    const table = tableOf(seg);
    if (table !== undefined) {
      let j = i;
      while (j < segments.length && tableOf(segments[j] as Segment) === table) j++;
      out.push(<Table key={seg.id} cells={segments.slice(i, j)} />);
      i = j;
    } else {
      out.push(<Block key={seg.id} seg={seg} />);
      i++;
    }
  }
  return <div class="segments">{out}</div>;
}
