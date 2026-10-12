// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary.tsx';

function Broken(): never {
  throw new TypeError('cannot read the text "Project Nightingale figures"');
}

describe('the panel error boundary', () => {
  it('shows a way out instead of a blank panel, and logs only the error class and the component', async () => {
    const crash = vi.fn(() => Promise.resolve());
    const reload = vi.fn();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = document.createElement('div');
    document.body.append(root);
    act(() =>
      render(
        <ErrorBoundary name="App" log={{ crash }} version="1.2.3" reload={reload}>
          <Broken />
        </ErrorBoundary>,
        root,
      ),
    );
    await act(() => Promise.resolve());
    expect(root.querySelector('[data-testid=panel-crash]')).not.toBeNull();
    expect(crash).toHaveBeenCalledWith('App', 'TypeError');
    expect(root.textContent).not.toContain('Nightingale');

    act(() => root.querySelector<HTMLButtonElement>('[data-testid=panel-reload]')?.click());
    expect(reload).toHaveBeenCalledOnce();
    await act(async () => root.querySelector<HTMLButtonElement>('[data-testid=panel-copy]')?.click());
    expect(writeText).toHaveBeenCalledWith('Translate Side 1.2.3: TypeError in App');
    expect(root.querySelector('[data-testid=panel-crash-details]')?.textContent).toContain('(copied)');
    quiet.mockRestore();
    root.remove();
  });

  it('logs "Error" for an error whose name is not a short identifier, or for a thrown non-error', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const thrown of [Object.assign(new Error('x'), { name: 'Failed for https://intranet.example.com/q3' }), 'a plain string']) {
      const crash = vi.fn(() => Promise.resolve());
      const Throws = (): never => {
        throw thrown;
      };
      const root = document.createElement('div');
      act(() =>
        render(
          <ErrorBoundary name="App" log={{ crash }}>
            <Throws />
          </ErrorBoundary>,
          root,
        ),
      );
      await act(() => Promise.resolve());
      expect(crash).toHaveBeenCalledWith('App', 'Error');
      expect(root.querySelector('[data-testid=panel-crash-details]')?.textContent).toBe('Translate Side: Error in App');
    }
    quiet.mockRestore();
  });

  it('renders its children while nothing throws', () => {
    const root = document.createElement('div');
    act(() =>
      render(
        <ErrorBoundary name="App" log={{ crash: () => Promise.resolve() }}>
          <p>fine</p>
        </ErrorBoundary>,
        root,
      ),
    );
    expect(root.textContent).toBe('fine');
  });
});
