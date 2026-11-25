import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Field, inputClass, Button } from '../ui/Field';

// Shown after signing in with a temporary password (a new account or an admin reset)
export const SetPasswordView: React.FC = () => {
  const { currentUser, changePassword, logout } = useApp();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 8) return setError('Use at least 8 characters');
    if (next !== confirm) return setError('The two new passwords do not match');
    setSaving(true);
    try {
      await changePassword(current, next);
    } catch (err: any) {
      setError(err.message || 'Could not set the password');
      setSaving(false);
    }
  };

  return (
    <main className="min-h-full w-full flex items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-[340px]">
        <div className="mb-8">
          <span className="w-8 h-8 rounded-md bg-fg text-canvas text-sm font-bold flex items-center justify-center mb-6" aria-hidden="true">
            H
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Choose your password</h1>
          <p className="text-sm text-fg-muted mt-1">
            Welcome{currentUser ? `, ${currentUser.name.split(' ')[0]}` : ''}. You signed in with a temporary password; replace it with one only you know.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && (
            <div role="alert" className="flex items-start gap-2 p-2.5 rounded-md bg-tone-red-bg text-sm text-tone-red-fg">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <Field label="Temporary password">
            <input type="password" autoComplete="current-password" autoFocus required value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <input type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Repeat new password">
            <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
          </Field>
          <Button type="submit" className="w-full h-9" disabled={saving || !current || !next || !confirm}>
            {saving ? 'Saving…' : 'Save and continue'}
          </Button>
          <button type="button" onClick={logout} className="w-full text-[13px] text-fg-muted hover:text-fg">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
};
