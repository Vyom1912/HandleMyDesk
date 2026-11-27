import React, { useEffect, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Field, inputClass, Button, Segmented } from '../ui/Field';
import { Avatar, label } from '../ui/Badges';
import { PasswordInput, guessableWords } from '../ui/PasswordInput';

/** Your photo, name, title, phone and status. Email and role are set by an administrator. */
const ProfileSection: React.FC = () => {
  const { currentUser, updateProfile, uploadAvatar, removeAvatar, showToast } = useApp();
  const [form, setForm] = useState({ name: currentUser?.name ?? '', title: currentUser?.title ?? '', phone: currentUser?.phone ?? '' });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentUser) setForm({ name: currentUser.name, title: currentUser.title, phone: currentUser.phone });
  }, [currentUser?.id]);

  if (!currentUser) return null;
  const dirty = form.name !== currentUser.name || form.title !== currentUser.title || form.phone !== currentUser.phone;

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile(form);
      showToast('Profile saved', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const pickPhoto = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return showToast('Choose an image up to 2 MB', 'error');
    setUploading(true);
    try {
      await uploadAvatar(file);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section aria-labelledby="profile-heading" className="pb-5 mb-5 border-b border-line space-y-4">
      <h3 id="profile-heading" className="sr-only">
        Profile
      </h3>
      <div className="flex items-center gap-4">
        <Avatar src={currentUser.avatar} name={currentUser.name} size={56} />
        <div className="min-w-0 flex-1">
          <div className="text-meta text-fg-muted truncate">{currentUser.email}</div>
          <div className="text-meta text-fg-faint">{label(currentUser.role)} · set by an administrator</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" tabIndex={-1} onChange={(e) => pickPhoto(e.target.files?.[0])} />
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : currentUser.avatar ? 'Change photo' : 'Add photo'}
            </Button>
            {currentUser.avatar && (
              <Button size="sm" variant="ghost" onClick={() => removeAvatar().catch((err) => showToast(err.message, 'error'))}>
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      <div>
        <span className="block text-meta font-medium text-fg-muted mb-1">Status</span>
        <Segmented
          label="Status"
          value={currentUser.status}
          onChange={(status) => updateProfile({ status }).catch((err) => showToast(err.message, 'error'))}
          options={[
            { value: 'active', label: 'Available' },
            { value: 'busy', label: 'Busy' },
            { value: 'away', label: 'Away' },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name">
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Job title">
          <input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Phone">
          <input type="tel" className={inputClass} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
      </div>
      {dirty && (
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving || !form.name.trim()}>
            {saving ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      )}
    </section>
  );
};

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
      size="lg"
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
      <ProfileSection />


      <form id="password-form" onSubmit={handleChangePassword} className="space-y-3">
        <h3 className="text-sm font-semibold text-fg">Change password</h3>
        <p className="text-meta text-fg-muted">This also signs you out on your other devices.</p>
        {error && (
          <p role="alert" className="text-sm text-tone-red-fg">
            {error}
          </p>
        )}
        <PasswordInput label="Current password" autoComplete="current-password" required value={currentPassword} onChange={setCurrentPassword} />
        <PasswordInput label="New password" hint="At least 8 characters" autoComplete="new-password" required meter avoid={guessableWords(currentUser)} value={newPassword} onChange={setNewPassword} />
        <PasswordInput label="Confirm new password" autoComplete="new-password" required matchWith={newPassword} value={confirmPassword} onChange={setConfirmPassword} />
      </form>

      <div className="mt-6 pt-4 border-t border-line flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">Signed in somewhere else?</h3>
          <p className="text-meta text-fg-muted">End every session on every device, for example after using a shared computer.</p>
        </div>
        <Button variant="secondary" onClick={handleSignOutEverywhere}>
          Sign out of all devices
        </Button>
      </div>
    </Modal>
  );
};
