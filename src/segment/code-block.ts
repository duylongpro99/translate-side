/**
 * Code blocks: `pre`, and code-editor surfaces that hold code as one div per line, e.g. MDN's
 * interactive examples (CodeMirror 6 `.cm-content`; CodeMirror 5 `.CodeMirror-code`). Its own
 * module so compose.ts can use it without importing the segmenter.
 */
export const CODE_BLOCK = 'pre, .cm-content, .CodeMirror-code';
