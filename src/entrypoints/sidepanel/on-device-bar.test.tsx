// @vitest-environment jsdom
// The job bar when on-device translation can't run yet: the turn-on button, the download, and the
// reasons it can't run, each with the way to a provider. No on-device stop ends without a message.
import { render } from 'preact';
import { describe, expect, it } from 'vitest';
import type { LLMError } from '@/llm/types';
import { JobBar, type JobActions } from './JobBar.tsx';
import { ModelSwitcher } from './ModelSwitcher.tsx';
import type { JobView } from './jobs.ts';
import { uiError } from './status.ts';

function view(over: Partial<JobView>): JobView {
  return { status: 'stopped', paused: false, model: '', targetLang: 'vi', sourceLang: 'en', segments: [], segs: new Map(), counts: { total: 2, final: 0, failed: 0 }, usage: { input: 0, cachedInput: 0, output: 0 }, cost: undefined, unmetered: 0, startedAt: 0, ...over };
}
function actions(): JobActions & { calls: string[] } {
  const calls: string[] = [];
  const log = (name: string) => (...args: unknown[]) => void calls.push([name, ...args.filter((x) => typeof x === 'string')].join(' '));
  return { calls, cancel: log('cancel'), resume: log('resume'), translateRest: log('rest'), openOptions: log('options'), retrySegment: log('retry'), retranslateSegment: log('retranslate'), explainSegment: log('explain'), retranslatePage: log('page'), grantAccess: log('grant'), continuePastLimit: log('limit'), turnOnDevice: log('turnOn'), cancelOnDevice: log('cancelOnDevice'), setUpProvider: log('setUp') };
}
function show(v: JobView, a = actions()) {
  const root = document.createElement('div');
  render(<JobBar job={v} actions={a} />, root);
  const button = (id: string) => root.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  return { root, a, button };
}
const stop = (ui: Parameters<typeof uiError>[2], args: string[]): LLMError => uiError('bad_request', 'x', ui, args);

describe('JobBar: on-device translation', () => {
  it('a pair to turn on: the reason, Turn on (calls the action in the click), and Set up a provider', () => {
    const { root, a, button } = show(view({ stopError: stop('onDeviceSetup', ['translator', 'en', 'vi']) }));
    expect(root.querySelector('[data-testid="on-device-setup"]')?.textContent).toContain('English → Vietnamese');
    button('on-device-turn-on')?.click();
    expect(a.calls).toEqual(['turnOn translator en vi']);
    button('on-device-set-up')?.click();
    expect(a.calls).toContain('setUp');
  });

  it('a Nano setup names the download size', () => {
    const { root } = show(view({ stopError: stop('onDeviceSetup', ['nano', 'ja', 'en']) }));
    expect(root.textContent).toContain('4 GB');
  });

  it('the download: its percent, a progress bar and Cancel; a failure says why and offers Try again', () => {
    const { root, a, button } = show(view({ stopError: stop('onDeviceSetup', ['translator', 'en', 'vi']), onDeviceDownload: { engine: 'translator', from: 'en', to: 'vi', loaded: 0.42 } }));
    expect(root.textContent).toContain('42%');
    expect(root.querySelector('progress')?.getAttribute('value')).toBe('42');
    button('on-device-cancel')?.click();
    expect(a.calls).toEqual(['cancelOnDevice']);
    const failed = show(view({ stopError: stop('onDeviceSetup', ['translator', 'en', 'vi']), onDeviceDownload: { engine: 'translator', from: 'en', to: 'vi', loaded: 0, error: 'NetworkError: offline' } }));
    expect(failed.root.textContent).toContain('NetworkError: offline');
    failed.button('on-device-turn-on')?.click();
    expect(failed.a.calls).toEqual(['turnOn translator en vi']);
  });

  it.each([
    ['onDeviceUnavailable', ['no-api', 'en', 'vi'], 'needs desktop Chrome 138 or later'],
    ['onDeviceUnavailable', ['pair', 'en', 'vi'], "can't translate English → Vietnamese"],
    ['onDeviceUnavailable', ['setting', 'en', 'vi'], 'Set it to Auto'],
    ['onDeviceNoSource', [], "page's language is not known"],
  ] as const)('%s %j: says why, with Set up a provider', (ui, args, text) => {
    const { root, button } = show(view({ stopError: stop(ui, [...args]) }));
    expect(root.textContent).toContain(text);
    expect(button('on-device-set-up')).not.toBeNull();
  });

  it('Chrome downloading on its own: says so and offers Check again', () => {
    const { root, a } = show(view({ stopError: stop('onDeviceDownloading', ['translator', 'en', 'vi']) }));
    expect(root.textContent).toContain('Chrome is downloading');
    root.querySelector<HTMLButtonElement>('button')?.click();
    expect(a.calls).toEqual(['resume']);
  });

  it('a second language found mid-run asks for its own click', () => {
    const { root, a, button } = show(view({ status: 'done', counts: { total: 2, final: 1, failed: 1 }, onDeviceSetup: { engine: 'translator', from: 'fr', to: 'vi' } }));
    expect(root.querySelector('[data-testid="on-device-second-pair"]')?.textContent).toContain('French');
    button('on-device-turn-on')?.click();
    expect(a.calls).toEqual(['turnOn translator fr vi']);
  });
});

describe('the switcher on the device', () => {
  const render1 = (state: Parameters<typeof ModelSwitcher>[0]['state']) => {
    const root = document.createElement('div');
    render(<ModelSwitcher state={state} model="Chrome Translator" onChoose={() => {}} onMakeDefault={() => {}} />, root);
    return root;
  };

  it('names Chrome on-device, not the keyless default, whether or not there is anything to switch to', () => {
    const keyless = { id: 'apibox-qwen', model: 'qwen3.8-flash', connection: 'APIBOX', usable: false, local: false };
    expect(render1({ options: [keyless], defaultId: 'apibox-qwen', currentId: 'apibox-qwen', currentUsable: false, onDevice: 'translator' }).textContent).toBe('Chrome on-device');
    const ollama = { id: 'ollama-q', model: 'qwen3:8b', connection: 'Ollama', usable: true, local: true };
    const many = render1({ options: [keyless, ollama], defaultId: 'apibox-qwen', currentId: 'apibox-qwen', currentUsable: false, onDevice: 'translator' });
    expect(many.querySelector('option[value=""]')?.textContent).toBe('Chrome on-device');
  });
});
