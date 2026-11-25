// Remembers which getting-started steps someone has tried, per person and per browser.
export type OnboardingStep = 'search' | 'shortcuts' | 'notifications' | 'dismissed';

const key = (userId: string) => `novadesk_onboarding_${userId}`;
export const ONBOARDING_EVENT = 'novadesk:onboarding';

export function readOnboarding(userId: string): Partial<Record<OnboardingStep, boolean>> {
  try {
    return JSON.parse(localStorage.getItem(key(userId)) || '{}');
  } catch {
    return {};
  }
}

export function markOnboarding(userId: string | undefined, step: OnboardingStep) {
  if (!userId) return;
  const state = readOnboarding(userId);
  if (state[step]) return;
  try {
    localStorage.setItem(key(userId), JSON.stringify({ ...state, [step]: true }));
  } catch {
    // Storage unavailable: the checklist just won't remember
  }
  window.dispatchEvent(new CustomEvent(ONBOARDING_EVENT));
}
