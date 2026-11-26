import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Field, inputClass, Button } from '../ui/Field';
import { PasswordInput } from '../ui/PasswordInput';

// Seeded accounts, shown only in development builds to make testing roles quick
const DEMO_ACCOUNTS = [
  { email: 'sarah.connor@handlemydesk.internal', label: 'Sarah Connor', role: 'Admin' },
  { email: 'marcus.vance@handlemydesk.internal', label: 'Marcus Vance', role: 'Project manager' },
  { email: 'maya.patel@handlemydesk.internal', label: 'Maya Patel', role: 'Member' },
];

// Only the email is remembered, never the password, and only when the person ticks the box
const REMEMBER_KEY = 'hmd.rememberedEmail';
const readRemembered = () => {
  try {
    return localStorage.getItem(REMEMBER_KEY) ?? '';
  } catch {
    return '';
  }
};
const writeRemembered = (email: string | null) => {
  try {
    if (email) localStorage.setItem(REMEMBER_KEY, email);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // Private window or blocked storage: nothing to remember
  }
};

export const LoginView: React.FC = () => {
  const { login } = useApp();
  const [email, setEmail] = useState(readRemembered);
  const [remember, setRemember] = useState(() => readRemembered() !== '');
  const [password, setPassword] = useState('');
  // An error sent back from company sign-in arrives in the address: #/sso-error/<message>
  const [error, setError] = useState<string | null>(() => {
    const m = window.location.hash.match(/^#\/sso-error\/(.+)$/);
    if (!m) return null;
    window.history.replaceState(null, '', '#/');
    return decodeURIComponent(m[1]);
  });
  const [sso, setSso] = useState<{ enabled: boolean; label?: string }>({ enabled: false });

  useEffect(() => {
    api
      .get<{ enabled: boolean; label?: string }>('/api/auth/sso/config')
      .then(setSso)
      .catch(() => {});
  }, []);
  const [submitting, setSubmitting] = useState(false);
  // Same email and password in more than one office: the person picks which to open
  const [offices, setOffices] = useState<Array<{ id: string; name: string }> | null>(null);

  const signIn = async (officeId?: string) => {
    setError(null);
    setSubmitting(true);
    try {
      writeRemembered(remember ? email.trim() : null);
      await login(email.trim(), password, officeId);
    } catch (err: any) {
      if (err.data?.code === 'CHOOSE_OFFICE') setOffices(err.data.offices);
      else setError(err.message || 'Sign-in failed');
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setOffices(null);
    signIn();
  };

  // "Forgot password?": asks whoever can reset it (office admin, or HandleMyDesk for admins)
  const [forgot, setForgot] = useState<'closed' | 'open' | 'sent'>('closed');
  const askForReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/api/auth/forgot', { email: email.trim() });
      setForgot('sent');
    } catch (err: any) {
      setError(err.message || 'Could not send the request');
    } finally {
      setSubmitting(false);
    }
  };

  if (forgot !== 'closed') {
    return (
      <main className="min-h-full w-full flex items-center justify-center bg-canvas px-4 py-12">
        <div className="w-full max-w-[340px]">
          <h1 className="text-2xl font-semibold tracking-tight text-fg mb-1">Forgot your password?</h1>
          {forgot === 'sent' ? (
            <div className="space-y-4">
              <p className="text-sm text-fg-muted" role="status">
                Done. If <strong className="text-fg">{email.trim()}</strong> has an account, the people who can reset it have been told: your office administrator, or
                HandleMyDesk if you are the administrator. They will give you a new password, usually by phone or message.
              </p>
              <Button className="w-full h-9" onClick={() => setForgot('closed')}>
                Back to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={askForReset} className="space-y-4" noValidate>
              <p className="text-sm text-fg-muted">Enter your work email. We'll ask the person who can reset your password to do it.</p>
              {error && (
                <div role="alert" className="flex items-start gap-2 p-2.5 rounded-md bg-tone-red-bg text-sm text-tone-red-fg">
                  <AlertCircle size={15} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              <Field label="Email">
                <input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
              </Field>
              <Button type="submit" className="w-full h-9" disabled={submitting || !email.trim()}>
                {submitting ? 'Sending…' : 'Ask for a password reset'}
              </Button>
              <button type="button" onClick={() => setForgot('closed')} className="w-full text-sm text-fg-muted hover:text-fg">
                Back to sign in
              </button>
            </form>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-full w-full flex items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-[340px]">
        <div className="mb-8">
          <span className="w-8 h-8 rounded-md bg-fg text-canvas text-sm font-bold flex items-center justify-center mb-6" aria-hidden="true">
            H
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Sign in to HandleMyDesk</h1>
          <p className="text-sm text-fg-muted mt-1">{sso.enabled ? `Use your ${sso.label} account, or your HandleMyDesk password.` : 'Use your work email and password.'}</p>
        </div>

        {sso.enabled && (
          <>
            <a
              href="/api/auth/sso/start"
              className="flex items-center justify-center w-full h-9 rounded-md border border-line-strong bg-surface hover:bg-hover text-sm font-medium text-fg"
            >
              Continue with {sso.label}
            </a>
            <div className="flex items-center gap-3 my-5 text-xs text-fg-faint" role="separator">
              <span className="flex-1 h-px bg-line" />
              or with your password
              <span className="flex-1 h-px bg-line" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error && (
            <div role="alert" className="flex items-start gap-2 p-2.5 rounded-md bg-tone-red-bg text-sm text-tone-red-fg">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <Field label="Email">
            <input type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" autoComplete="username" required autoFocus={!email} value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="you@company.com" />
          </Field>
          <label className="-mt-1 flex items-center gap-2 text-[13px] text-fg-muted cursor-pointer">
            <input type="checkbox" className="accent-accent" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember my email on this device
          </label>
          <PasswordInput label="Password" autoComplete="current-password" required autoFocus={!!email} value={password} onChange={setPassword} />
          <div className="-mt-2 text-right">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setForgot('open');
              }}
              className="text-[13px] text-fg-muted hover:text-fg hover:underline underline-offset-2"
            >
              Forgot password?
            </button>
          </div>
          {offices ? (
            <div className="space-y-2" role="group" aria-label="Choose your office">
              <p className="text-sm text-fg-muted">You have accounts in more than one office. Which one do you want to open?</p>
              {offices.map((o) => (
                <Button key={o.id} variant="secondary" className="w-full h-9 justify-start" disabled={submitting} onClick={() => signIn(o.id)}>
                  {o.name}
                </Button>
              ))}
            </div>
          ) : (
            <Button type="submit" className="w-full h-9" disabled={submitting || !email.trim() || !password}>
              {submitting ? 'Signing in…' : 'Continue'}
            </Button>
          )}
        </form>

        {import.meta.env.DEV && (
          <div className="mt-10 pt-5 border-t border-line text-[13px] text-fg-muted space-y-2.5">
            <p>
              Development accounts (password <code className="font-mono text-fg">handlemydesk123</code>):
            </p>
            <div className="flex flex-col gap-1">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  onClick={() => {
                    setEmail(a.email);
                    setPassword('handlemydesk123');
                  }}
                  className="flex justify-between h-8 px-2.5 items-center rounded-md border border-line hover:bg-hover text-left"
                >
                  <span className="text-fg">{a.label}</span>
                  <span className="text-fg-faint">{a.role}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
};
