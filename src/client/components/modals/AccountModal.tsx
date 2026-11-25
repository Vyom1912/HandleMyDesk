import React, { useState } from 'react';
import { LogOut } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Field, inputClass, Button } from '../ui/Field';
import { Avatar, label } from '../ui/Badges';

export const AccountModal: React.FC = () => {
  const { isAccountOpen, setIsAccountOpen, currentUser, logout, changePassword, signOutEverywhere, confirm, showToast } = useApp();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setIsAccountOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) return setError('New password must be at least 8 characters');
    if (newPassword !== confirmPassword) return setError('New passwords do not match');
    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      showToast('Password changed. Your other devices were signed out.', 'success');
      close();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSignOutEverywhere = async () => {
    const ok = await confirm({
      title: 'Sign out of all devices?',
      message: 'Every browser tab and device signed in to your account, including this one, will need to sign in again.',
      confirmLabel: 'Sign out everywhere',
    });
    if (!ok) return;
    close();
    await signOutEverywhere();
  };

  if (!currentUser) return null;

  return (
    <Modal
      open={isAccountOpen}
      onClose={close}
      title="Account"
      footer={
        <div className="flex w-full justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              close();
              logout();
            }}
          >
            <LogOut size={14} /> Sign out
          </Button>
          <Button type="submit" form="password-form" disabled={saving || !currentPassword || !newPassword}>
            {saving ? 'Saving…' : 'Update password'}
          </Button>
        </div>
      }
    >
      <div className="flex items-center gap-3 pb-4 mb-4 border-b border-line">
        <Avatar src={currentUser.avatar} name={currentUser.name} size={44} />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-fg">{currentUser.name}</div>
          <div className="text-[13px] text-fg-muted truncate">{currentUser.email}</div>
          <div className="text-[13px] text-fg-faint">
            {currentUser.title} · {label(currentUser.role)}
          </div>
        </div>
      </div>

      <form id="password-form" onSubmit={handleChangePassword} className="space-y-3">
        <h3 className="text-sm font-semibold text-fg">Change password</h3>
        <p className="text-[13px] text-fg-muted">This also signs you out on your other devices.</p>
        {error && (
          <p role="alert" className="text-sm text-tone-red-fg">
            {error}
          </p>
        )}
        <Field label="Current password">
          <input type="password" autoComplete="current-password" className={inputClass} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </Field>
        <Field label="New password" hint="At least 8 characters">
          <input type="password" autoComplete="new-password" className={inputClass} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
        </Field>
        <Field label="Confirm new password">
          <input type="password" autoComplete="new-password" className={inputClass} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
        </Field>
      </form>

      <div className="mt-6 pt-4 border-t border-line flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">Signed in somewhere else?</h3>
          <p className="text-[13px] text-fg-muted">End every session on every device, for example after using a shared computer.</p>
        </div>
        <Button variant="secondary" onClick={handleSignOutEverywhere}>
          Sign out of all devices
        </Button>
      </div>
    </Modal>
  );
};
