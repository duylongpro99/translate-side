// failureText and noBasicText recognise a few developer messages by their text. These tests take the messages
// from the code that produces them, so rewording one there fails here instead of silently losing its translation.
import { i18n } from '#i18n';
import { describe, expect, it } from 'vitest';
import { BASIC_MISSING_MESSAGE, basicUnavailableMessage, type NoBasicRaw } from '@/engine/index';
import { checkKey, classifyFetchError } from '@/llm/errors';
import type { LLMError } from '@/llm/types';
import { failureText, noBasicText } from './status.ts';

const fetchError = (message: string, hasHostPermission = true): LLMError => {
  const error = classifyFetchError({ error: new TypeError(message), aborted: false, hasHostPermission, baseUrl: 'https://api.example.com/v1' });
  if (error === null) throw new Error('a TypeError is not a cancel');
  return error;
};

describe('failureText', () => {
  it('maps the key-check message to the characters message, and other auth errors to the plain one', () => {
    const bad = checkKey('key☃');
    expect(bad).not.toBeNull();
    expect(failureText(bad as LLMError)).toBe(i18n.t('errors.authCharacters'));
    expect(failureText(fetchError('Failed to execute fetch: String contains non ISO-8859-1 code point.'))).toBe(i18n.t('errors.authCharacters'));
    expect(failureText({ kind: 'auth', message: 'Key invalid or missing' })).toBe(i18n.t('errors.auth'));
    expect(i18n.t('errors.authCharacters')).not.toBe(i18n.t('errors.auth'));
  });

  it('takes the host out of the no-access message', () => {
    const error = fetchError('Failed to fetch', false);
    expect(error).toMatchObject({ kind: 'cors', cause: 'permission' });
    expect(failureText(error)).toBe(i18n.t('errors.noAccess', ['api.example.com']));
  });
});

describe('noBasicText', () => {
  const failed = (basic: string): LLMError => {
    const raw: NoBasicRaw = { reason: 'no-basic', basic };
    return { kind: 'network', message: "Can't reach api.example.com", raw };
  };

  it('maps the missing-translator message', () => {
    expect(noBasicText(failed(BASIC_MISSING_MESSAGE))).toBe(i18n.t('errors.noBasicMissing'));
  });

  it('takes the model and the language pair out of the unavailable-pair message', () => {
    expect(noBasicText(failed(basicUnavailableMessage("Chrome's translator", 'English', 'Vietnamese')))).toBe(i18n.t('errors.noBasicPair', ["Chrome's translator", 'English', 'Vietnamese']));
  });

  it('shows both the failure and why basic could not help', () => {
    const text = failureText(failed(BASIC_MISSING_MESSAGE));
    expect(text).toContain(i18n.t('errors.network').replace(/\.$/, ''));
    expect(text).toContain(i18n.t('errors.noBasicMissing').replace(/\.$/, ''));
  });
});
