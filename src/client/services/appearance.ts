import { useEffect, useState } from 'react';

/*
 * Light / dark theme and the office's brand colour. Kept outside the app state so the sign-in
 * page and the owner console use the same settings, and so the theme is applied before the first
 * paint (no white flash in dark mode).
 */

export type ThemePreference = 'light' | 'dark' | 'system';
const THEME_KEY = 'handlemydesk_theme';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode): the preference just won't persist
  }
}

export const storedTheme = (): ThemePreference => {
  const v = read(THEME_KEY);
  return v === 'dark' || v === 'system' ? v : 'light';
};

export function applyTheme(pref: ThemePreference) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** Theme state for pages outside the main app (owner console). */
export function useThemePreference(): [ThemePreference, (t: ThemePreference) => void] {
  const [theme, setThemeState] = useState<ThemePreference>(storedTheme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);
  const setTheme = (t: ThemePreference) => {
    write(THEME_KEY, t);
    setThemeState(t);
  };
  return [theme, setTheme];
}

export const saveTheme = (t: ThemePreference) => write(THEME_KEY, t);

// ---------- Brand colour ----------

const ACCENT_VARS = ['--accent', '--accent-hover', '--accent-soft', '--accent-ink', '--on-accent'];

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Replaces the blue accent with the office's colour. The lighter/darker shades are mixed with the
 * theme's own colours, so they suit both light and dark mode. Text on buttons turns dark when the
 * colour is light (e.g. yellow), so it stays readable.
 */
export function applyBrandColor(hex: string | null | undefined) {
  const root = document.documentElement.style;
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) {
    ACCENT_VARS.forEach((v) => root.removeProperty(v));
    return;
  }
  const light = luminance(hex) > 0.4;
  root.setProperty('--accent', hex);
  root.setProperty('--accent-hover', `color-mix(in oklab, ${hex} 85%, var(--fg))`);
  root.setProperty('--accent-soft', `color-mix(in oklab, ${hex} 13%, var(--surface))`);
  root.setProperty('--accent-ink', `color-mix(in oklab, ${hex} ${light ? 45 : 65}%, var(--fg))`);
  root.setProperty('--on-accent', light ? '#1f1f1e' : '#ffffff');
}

// The last office brand seen on this device, so its sign-in page looks right on the next visit
const BRAND_KEY = 'hmd.officeBrand';
export const rememberedOfficeSlug = () => read(BRAND_KEY);
export const rememberOfficeSlug = (slug: string | null) => write(BRAND_KEY, slug);

export const BRAND_SWATCHES = ['#2b63d9', '#0f766e', '#15803d', '#7c3aed', '#be185d', '#c2410c', '#b45309', '#1f2937'];
