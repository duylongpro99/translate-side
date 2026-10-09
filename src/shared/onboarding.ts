// Onboarding state (DESIGN.md §4.3.3 C, plan M4-E13): whether the first-run guide was finished or
// skipped, kept on this device (storage.local: which providers a device has keys for is a
// per-device fact, §4.3.4), and how to open it. It opens by itself once, on install; after that
// the panel offers it only while no route can run, and Settings can always open it again.
import type { browser } from 'wxt/browser';

type Browser = typeof browser;

export const ONBOARDING_KEY = 'onboarding';
export const ONBOARDING_PAGE = '/onboarding.html';

export type OnboardingStatus = 'done' | 'skipped';

export async function readOnboarding(api: Browser): Promise<OnboardingStatus | undefined> {
  const value = (await api.storage.local.get(ONBOARDING_KEY))[ONBOARDING_KEY] as { status?: unknown } | undefined;
  return value?.status === 'done' || value?.status === 'skipped' ? value.status : undefined;
}

export async function markOnboarding(api: Browser, status: OnboardingStatus): Promise<void> {
  await api.storage.local.set({ [ONBOARDING_KEY]: { status, at: Date.now() } });
}

/** Opens the guide in a tab (the options page and the panel link to it). */
export async function openOnboarding(api: Browser): Promise<void> {
  await api.tabs.create({ url: api.runtime.getURL(ONBOARDING_PAGE as never) });
}
