import { useEffect, useRef, useState } from 'preact/hooks';
import { i18n } from '#i18n';
import type { Segment } from '@/engine/types';
import type { LLMErrorKind } from '@/llm/types';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import type { Speech } from './read-aloud.ts';
import { blockName } from './SegmentList.tsx';
import { failureText } from './status.ts';

/**
 * Read aloud's panel strip: while a block is read, its first words and Stop; after a failure, why
 * (no voice for the language: where to get one). Esc anywhere in the panel stops the reading,
 * unless something else (an editor, a menu) used it. A polite live region says when reading
 * starts and stops.
 */
export function ReadStrip({ speech, segments, onSettings }: { speech: Speech; segments: readonly Segment[]; onSettings(): void }) {
  const { speaking, error, stop } = speech;
  const reading = speaking !== undefined;

  useEffect(() => {
    if (!reading) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      stop();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [reading, stop]);

  // Said once per change: "Reading aloud" when it starts, "Stopped reading" when it ends.
  const [announce, setAnnounce] = useState('');
  const was = useRef(false);
  useEffect(() => {
    if (reading !== was.current) setAnnounce(i18n.t(reading ? 'panel.read.started' : 'panel.read.stopped'));
    was.current = reading;
  }, [reading]);

  const seg = speaking ? segments.find((s) => s.id === speaking.id) : undefined;
  return (
    <>
      {seg ? (
        <div class="read-strip" data-testid="read-strip">
          <span class="read-strip__label">{i18n.t('panel.read.now', [blockName(seg)])}</span>
          <Button data-testid="read-stop" aria-keyshortcuts="Escape" onClick={stop}>
            {i18n.t('panel.read.stop')}
          </Button>
        </div>
      ) : null}
      {error && !reading ? (
        <Notice tone="warn" class="read-error" data-testid="read-error">
          {error.kind === 'no-voice' ? i18n.t('panel.read.noVoice') : i18n.t('panel.read.failed', [failureText({ kind: error.kind as LLMErrorKind, message: error.message })])}{' '}
          <Button data-testid="read-settings" onClick={onSettings}>
            {i18n.t('panel.read.settings')}
          </Button>
        </Notice>
      ) : null}
      <span class="sr-only" role="status" data-testid="read-status">
        {announce}
      </span>
    </>
  );
}
