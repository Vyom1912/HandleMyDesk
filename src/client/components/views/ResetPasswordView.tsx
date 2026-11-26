import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { api, setStoredToken } from '../../services/api';
import { applyBrandColor } from '../../services/appearance';
import { OfficeBrand } from '../../../types';
import { Button } from '../ui/Field';
import { PasswordInput, guessableWords } from '../ui/PasswordInput';
import { BrandMark } from '../ui/BrandMark';

/** Opened from the "Forgot password?" email: #/reset/<secret>. */
export const ResetPasswordView: React.FC<{ token: string }> = ({ token }) => {
  const [info, setInfo] = useState<{ name: string; email: string; office: OfficeBrand } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api
      .post<{ name: string; email: string; office: OfficeBrand }>('/api/auth/reset/check', { token })
      .then((i) => {
        setInfo(i);
        applyBrandColor(i.office.color);
      })
      .catch((err) => setProblem(err.message));
  }, [token]);

  const toSignIn = () => {
    window.location.replace(window.location.pathname + window.location.search);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Use at least 8 characters');
    if (password !== repeat) return setError('The two passwords do not match');
    setSaving(true);
    try {
      const res = await api.post<{ email: string; officeId: string }>('/api/auth/reset', { token, password });
      setDone(true);
      // Sign straight in with the new password, then open the app
      try {
        const signIn = await api.post<{ token: string }>('/api/auth/login', { email: res.email, password, officeId: res.officeId });
        setStoredToken(signIn.token);
      } catch {
        // They can still sign in by hand
      }
      setTimeout(toSignIn, 1200);
    } catch (err: any) {
      setError(err.message || 'Could not change the password');
      setSaving(false);
    }
  };

  return (
    <main className="min-h-full w-full flex items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-[340px]">
        <div className="mb-8">
          <BrandMark brand={info?.office ?? null} className="mb-6" />
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Choose a new password</h1>
          {info && (
            <p className="text-sm text-fg-muted mt-1">
              For <strong className="text-fg">{info.email}</strong> at {info.office.name}.
            </p>
          )}
        </div>

        {problem ? (
          <div className="space-y-4">
            <div role="alert" className="flex items-start gap-2 p-2.5 rounded-md bg-tone-red-bg text-sm text-tone-red-fg">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{problem}</span>
            </div>
            <Button className="w-full h-9" onClick={toSignIn}>
              Back to sign in
            </Button>
          </div>
        ) : done ? (
          <p role="status" className="flex items-center gap-2 text-sm text-tone-green-fg">
            <CheckCircle2 size={16} /> Password changed. Signing you in…
          </p>
        ) : !info ? (
          <div className="space-y-3" aria-busy="true" aria-label="Checking the link">
            <div className="skeleton h-4 w-3/4" />
            <div className="skeleton h-9 w-full" />
            <div className="skeleton h-9 w-full" />
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            {error && (
              <div role="alert" className="flex items-start gap-2 p-2.5 rounded-md bg-tone-red-bg text-sm text-tone-red-fg">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {/* Lets password managers save the new password under the right account */}
            <input type="email" autoComplete="username" value={info.email} readOnly hidden />
            <PasswordInput label="New password" hint="At least 8 characters" autoComplete="new-password" autoFocus required meter avoid={guessableWords(info)} value={password} onChange={setPassword} />
            <PasswordInput label="Repeat new password" autoComplete="new-password" required matchWith={password} value={repeat} onChange={setRepeat} />
            <Button type="submit" className="w-full h-9" disabled={saving || !password || !repeat}>
              {saving ? 'Saving…' : 'Save and sign in'}
            </Button>
            <p className="text-xs text-fg-faint">This signs you out on every other device.</p>
          </form>
        )}
      </div>
    </main>
  );
};
