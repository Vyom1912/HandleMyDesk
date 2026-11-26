import React, { useId, useState } from 'react';
import { Eye, EyeOff, ArrowBigUp, Check, X, Sparkles } from 'lucide-react';
import { inputClass } from './Field';

/*
 * One password box for every screen:
 *  - show / hide button (keeps the cursor in the box)
 *  - Caps Lock warning
 *  - optional strength meter for new passwords
 *  - optional "passwords match" check for the repeat box
 *  - optional "Suggest" button that fills in a strong random password
 */

const COMMON = ['password', '12345678', '123456789', '1234567890', 'qwerty', 'qwertyuiop', 'abc12345', 'letmein', 'welcome', 'iloveyou', 'admin123', 'handlemydesk', 'passw0rd', '11111111', '00000000'];

export type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string; tip?: string };

/** A rough, friendly estimate. It never blocks: the server only requires 8+ characters. */
export function passwordStrength(pw: string, avoid: string[] = []): Strength {
  if (pw.length < 8) return { score: 0, label: 'Too short', tip: `${8 - pw.length} more character${8 - pw.length === 1 ? '' : 's'} needed` };
  const lower = pw.toLowerCase();
  const guessable =
    COMMON.some((c) => lower.includes(c)) ||
    /^(.)\1+$/.test(pw) ||
    avoid.some((w) => w.length >= 3 && lower.includes(w.toLowerCase()));
  if (guessable) return { score: 1, label: 'Easy to guess', tip: 'Avoid common words, your name or your email' };
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  let score = 1;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (variety >= 2) score++;
  if (variety >= 3) score++;
  const s = Math.min(4, score) as Strength['score'];
  const label = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][s];
  const tip = s <= 2 ? 'Make it longer, or mix in capitals, numbers and symbols' : undefined;
  return { score: s, label, tip };
}

/** A person's name parts and email name, which make a password easy to guess. */
export function guessableWords(person?: { name?: string; email?: string } | null): string[] {
  if (!person) return [];
  const words = (person.name ?? '').split(/\s+/);
  const local = (person.email ?? '').split('@')[0];
  return [...words, ...local.split(/[._-]/), local].filter((w) => w.length >= 3);
}

// No look-alike characters (0/O, 1/l/I) so it can be read out over the phone
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** e.g. "Kq7m-Xp4t-Rw9z": about 69 bits of randomness, easy to read and type. */
export function suggestPassword(): string {
  for (;;) {
    const bytes = new Uint32Array(12);
    crypto.getRandomValues(bytes);
    const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
    if (/[a-z]/.test(chars) && /[A-Z]/.test(chars) && /\d/.test(chars)) return chars.match(/.{4}/g)!.join('-');
  }
}

const METER_TONE = ['bg-line-strong', 'bg-tone-red-fg', 'bg-tone-amber-fg', 'bg-tone-green-fg', 'bg-tone-green-fg'];
const TEXT_TONE = ['text-fg-faint', 'text-tone-red-fg', 'text-tone-amber-fg', 'text-tone-green-fg', 'text-tone-green-fg'];

export const PasswordInput: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  required?: boolean;
  autoFocus?: boolean;
  /** Focused first when it sits in a Modal */
  modalAutofocus?: boolean;
  /** Show the strength meter (new passwords) */
  meter?: boolean;
  /** Words that make a password easy to guess here, e.g. the person's name and email */
  avoid?: string[];
  /** For the "repeat password" box: the password it must match */
  matchWith?: string;
  /** Offer a "Suggest" button (when someone chooses a password for another person) */
  suggest?: boolean;
  /** Start with the text visible (an admin typing a password to pass on) */
  defaultVisible?: boolean;
  className?: string;
}> = ({ label, value, onChange, autoComplete, hint, required, autoFocus, modalAutofocus, meter, avoid, matchWith, suggest, defaultVisible = false, className = '' }) => {
  const id = useId();
  const [visible, setVisible] = useState(defaultVisible);
  const [capsLock, setCapsLock] = useState(false);
  const checkCaps = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // getModifierState is missing on some virtual keyboards; treat that as "off"
    setCapsLock(typeof e.getModifierState === 'function' && e.getModifierState('CapsLock'));
  };

  const strength = meter && value ? passwordStrength(value, avoid) : null;
  const mismatch = matchWith !== undefined && value.length > 0 && value !== matchWith;
  const matches = matchWith !== undefined && value.length > 0 && value === matchWith;
  const describedBy = [hint && !strength && `${id}-hint`, strength && `${id}-strength`, matchWith !== undefined && value && `${id}-match`, capsLock && `${id}-caps`].filter(Boolean).join(' ') || undefined;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <label htmlFor={id} className="block text-[13px] font-medium text-fg-muted">
          {label}
          {required && (
            <span className="text-danger" aria-hidden="true">
              {' '}
              *
            </span>
          )}
        </label>
        {suggest && (
          <button
            type="button"
            onClick={() => {
              onChange(suggestPassword());
              setVisible(true);
            }}
            className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline underline-offset-2"
          >
            <Sparkles size={13} aria-hidden="true" /> Suggest a strong one
          </button>
        )}
      </div>

      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required={required}
          autoFocus={autoFocus}
          data-autofocus={modalAutofocus || undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={checkCaps}
          onKeyUp={checkCaps}
          onBlur={() => setCapsLock(false)}
          aria-invalid={mismatch || undefined}
          aria-describedby={describedBy}
          className={`${inputClass} pr-11 pointer-fine:pr-9 ${visible && value ? 'font-mono' : ''} ${mismatch ? 'border-danger focus:border-danger' : ''}`}
        />
        <button
          type="button"
          // Keep the cursor in the box when clicking the eye with a mouse
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          title={visible ? 'Hide password' : 'Show password'}
          className="absolute right-0 top-0 h-full w-11 pointer-fine:w-9 flex items-center justify-center rounded-r-md text-fg-faint hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      {capsLock && (
        <p id={`${id}-caps`} role="status" className="flex items-center gap-1 mt-1 text-xs text-tone-amber-fg">
          <ArrowBigUp size={13} aria-hidden="true" /> Caps Lock is on
        </p>
      )}

      {strength && (
        <div id={`${id}-strength`} className="mt-1.5">
          <div className="flex gap-1" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={`h-1 flex-1 rounded-full transition-colors ${strength.score >= i ? METER_TONE[strength.score] : 'bg-line'}`} />
            ))}
          </div>
          <p className="mt-1 text-xs">
            <span className={`font-medium ${TEXT_TONE[strength.score]}`}>{strength.label}</span>
            {strength.tip && <span className="text-fg-faint">. {strength.tip}</span>}
          </p>
        </div>
      )}

      {matchWith !== undefined && value && (
        <p id={`${id}-match`} className={`flex items-center gap-1 mt-1 text-xs ${matches ? 'text-tone-green-fg' : 'text-tone-red-fg'}`}>
          {matches ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
          {matches ? 'Passwords match' : 'Passwords don’t match yet'}
        </p>
      )}

      {hint && !strength && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-fg-faint">
          {hint}
        </p>
      )}
    </div>
  );
};
