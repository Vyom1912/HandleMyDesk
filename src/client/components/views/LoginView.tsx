import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Field, inputClass, Button } from '../ui/Field';

// Seeded accounts, shown only in development builds to make testing roles quick
const DEMO_ACCOUNTS = [
  { email: 'sarah.connor@handlemydesk.internal', label: 'Sarah Connor', role: 'Admin' },
  { email: 'marcus.vance@handlemydesk.internal', label: 'Marcus Vance', role: 'Project manager' },
  { email: 'maya.patel@handlemydesk.internal', label: 'Maya Patel', role: 'Member' },
];

export const LoginView: React.FC = () => {
  const { login } = useApp();
  const [email, setEmail] = useState('');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err: any) {
      setError(err.message || 'Sign-in failed');
      setSubmitting(false);
    }
  };

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
            <input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="you@handlemydesk.internal" />
          </Field>
          <Field label="Password">
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </Field>
          <Button type="submit" className="w-full h-9" disabled={submitting || !email || !password}>
            {submitting ? 'Signing in…' : 'Continue'}
          </Button>
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
