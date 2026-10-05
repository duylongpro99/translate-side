// The few cross-runtime globals engine/ may use. They exist in browsers, workers and Node, but
// ES2022's lib doesn't declare them, and engine/ has no DOM lib (see ./tsconfig.json).
// Excluded from the root tsconfig, where the DOM lib provides the full types.

interface AbortSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  throwIfAborted(): void;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}
