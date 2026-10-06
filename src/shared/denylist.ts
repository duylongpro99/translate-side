// Pages the extension never reads (DESIGN.md §8, plan M0-E5). Checked by the worker before it
// injects and again by the content script before it extracts.

export type UrlVerdict = { ok: true } | { ok: false; reason: 'restricted' | 'denylisted' };

// Chrome never lets extensions script these, so don't try (the "can't read this page" state).
const READABLE_SCHEMES = new Set(['http:', 'https:', 'file:']);

// Built-in denylist: webmail and sign-in pages. Matched on the host and its subdomains.
// Banking can't be listed exhaustively here; per-site rules arrive with settings (M4+).
export const DENYLISTED_HOSTS = [
  'mail.google.com',
  'accounts.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'login.live.com',
  'login.microsoftonline.com',
  'mail.yahoo.com',
  'mail.proton.me',
  'account.proton.me',
  'app.fastmail.com',
  'mail.aol.com',
  'mail.zoho.com',
  'icloud.com',
];

const matchesHost = (host: string, entry: string) => host === entry || host.endsWith(`.${entry}`);

export function classifyUrl(url: string | undefined): UrlVerdict {
  if (!url) return { ok: false, reason: 'restricted' };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: 'restricted' };
  }
  if (!READABLE_SCHEMES.has(u.protocol)) return { ok: false, reason: 'restricted' };
  const host = u.hostname.toLowerCase();
  // The Chrome Web Store, old and new.
  if (host === 'chromewebstore.google.com' || (host === 'chrome.google.com' && u.pathname.startsWith('/webstore'))) {
    return { ok: false, reason: 'restricted' };
  }
  if (DENYLISTED_HOSTS.some((entry) => matchesHost(host, entry))) return { ok: false, reason: 'denylisted' };
  return { ok: true };
}
