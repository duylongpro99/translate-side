// The `translate` role → a client (DESIGN.md §4.3.5 Resolve, M1 stub; user decision M1-D13): the
// hard-wired profile (APIBOX by default, M2-D11; the profile's quirks over the connection's, M2-D16), its key from storage.local, and the host
// permission for its origin.
import type { browser } from 'wxt/browser';
import { createClient } from '@/llm/client';
import { DEFAULT_CONNECTION, hasHostPermission, resolveConnection, resolveProfile, withProfileQuirks } from '@/shared/settings';
import type { ClientResult } from './jobs.ts';

type Browser = typeof browser;

/** Message of the "no key yet" stop: the panel shows the settings link for it. */
export const noKeyMessage = (label: string) => `Add your ${label} API key in settings`;
export const NO_KEY_MESSAGE = noKeyMessage(DEFAULT_CONNECTION.label);

export async function translateClient(api: Browser): Promise<ClientResult> {
  const { profile, connection } = resolveProfile('translate');
  const label = { id: connection.id, label: connection.label };
  const conn = await resolveConnection(api, connection);
  if (conn === null) return { ok: false, error: { kind: 'auth', message: noKeyMessage(connection.label) }, connection: label };
  // Checked up front: without it the request fails as `cors` / `permission` anyway (S4 row 1), but
  // only after the job has started.
  if (!(await hasHostPermission(api, conn.baseUrl))) {
    return { ok: false, error: { kind: 'cors', cause: 'permission', message: `No access to ${new URL(conn.baseUrl).hostname}` }, connection: label };
  }
  return { ok: true, client: createClient(withProfileQuirks(conn, profile), profile.model), profile, connection: label };
}
