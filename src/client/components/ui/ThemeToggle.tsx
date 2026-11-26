import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { ThemePreference } from '../../services/appearance';

const ORDER: ThemePreference[] = ['light', 'dark', 'system'];
const META: Record<ThemePreference, { label: string; icon: React.ElementType }> = {
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
  system: { label: 'Same as device', icon: Monitor },
};

/** One button that switches Light → Dark → Same as device. */
export const ThemeToggle: React.FC<{ theme: ThemePreference; setTheme: (t: ThemePreference) => void; className?: string }> = ({ theme, setTheme, className = '' }) => {
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  const Icon = META[theme].icon;
  const label = `Theme: ${META[theme].label}. Switch to ${META[next].label.toLowerCase()}`;
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center w-10 h-10 pointer-fine:w-8 pointer-fine:h-8 rounded-md text-fg-muted hover:text-fg hover:bg-hover ${className}`}
    >
      <Icon size={16} />
    </button>
  );
};
