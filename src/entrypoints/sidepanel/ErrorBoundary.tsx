// The panel's last line: an error thrown while rendering shows a way out instead of a blank panel. The
// crash goes into the local diagnostics log (src/shared/diagnostics.ts) as the error's class and the
// component it came out of only; "Copy details" copies just those, never a message or a stack (a message
// can hold page text).
import { Component, type ComponentChildren } from 'preact';
import { i18n } from '#i18n';
import type { DiagnosticsLog } from '@/shared/diagnostics';

interface Props {
  /** The component inside the boundary, as the log names it. */
  name: string;
  log: Pick<DiagnosticsLog, 'crash'>;
  version?: string;
  /** Default: reload the panel page. */
  reload?: () => void;
  children: ComponentChildren;
}

interface State {
  kind?: string;
  copied?: boolean;
}

/** `name` is writable and could carry data: only a short identifier (`TypeError`) is kept, else `Error`. */
const KIND = /^[A-Za-z][\w$]{0,63}$/;
const errorKind = (error: unknown) => (error instanceof Error && KIND.test(error.name) ? error.name : 'Error');

export class ErrorBoundary extends Component<Props, State> {
  override state: State = {};

  override componentDidCatch(error: unknown): void {
    const kind = errorKind(error);
    console.error('[translate-side] the panel crashed', error);
    void this.props.log.crash(this.props.name, kind);
    this.setState({ kind });
  }

  override render() {
    const { kind, copied } = this.state;
    if (kind === undefined) return this.props.children;
    const details = i18n.t('panel.crash.details', { app: i18n.t('panel.appName') + (this.props.version ? ` ${this.props.version}` : ''), kind, name: this.props.name });
    return (
      <main class="panel">
        <div class="state" role="alert" data-testid="panel-crash">
          <p>{i18n.t('panel.crash.message')}</p>
          <p>
            <button type="button" data-testid="panel-reload" onClick={() => (this.props.reload ?? (() => location.reload()))()}>
              {i18n.t('panel.crash.reload')}
            </button>{' '}
            <button
              type="button"
              data-testid="panel-copy"
              onClick={() =>
                void navigator.clipboard.writeText(details).then(
                  () => this.setState({ copied: true }),
                  () => this.setState({ copied: false }),
                )
              }
            >
              {i18n.t('panel.crash.copy')}
            </button>
          </p>
          <p class="state__hint" data-testid="panel-crash-details">
            {details}
            {copied ? ` ${i18n.t('panel.crash.copied')}` : ''}
          </p>
        </div>
      </main>
    );
  }
}
