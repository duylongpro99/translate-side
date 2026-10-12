import type { ComponentChildren } from 'preact';

/**
 * A translated message with elements in it: `{name}` places `parts.name` (a bold name, a link) where the
 * translation wants it, so word order stays the translator's. A name with no part is left as written.
 */
export function slots(text: string, parts: Record<string, ComponentChildren>): ComponentChildren[] {
  return text.split(/(\{\w+\})/).map((piece) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return name !== undefined && name in parts ? parts[name] : piece;
  });
}
