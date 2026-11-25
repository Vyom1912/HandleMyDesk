import React, { useEffect, useRef, useState } from 'react';
import { Plus, MoreHorizontal, Copy, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { User } from '../../../types';
import { Avatar, Tag, label } from '../ui/Badges';
import { Button, Field, inputClass, selectClass, SearchInput, toolbarSelectClass } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { PageShell } from '../layout/PageShell';

const STATUS_DOT = { active: 'bg-tone-green-fg', busy: 'bg-tone-red-fg', away: 'bg-tone-amber-fg' } as const;
const STATUS_LABEL = { active: 'Available', busy: 'Busy', away: 'Away' } as const;

const ROLE_HELP: Record<User['role'], string> = {
  admin: 'Everything, including people, roles and backups',
  pm: 'Creates projects and manages the ones they lead',
  member: 'Works on the projects they are added to',
};

type PersonForm = { name: string; email: string; title: string; department: string; role: User['role']; phone: string; status: User['status'] };
const EMPTY: PersonForm = { name: '', email: '', title: '', department: '', role: 'member', phone: '', status: 'active' };

/** Shows a temporary password once, with a copy button, so the admin can pass it on. */
const TemporaryPasswordDialog: React.FC<{ value: { name: string; email: string; password: string } | null; onClose: () => void }> = ({ value, onClose }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [value]);
  if (!value) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value.password);
      setCopied(true);
    } catch {
      // Clipboard blocked: the password is still visible to copy by hand
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Temporary password"
      size="sm"
      footer={
        <Button onClick={onClose} data-autofocus>
          Done
        </Button>
      }
    >
      <p className="text-sm text-fg-muted">
        Give this to <strong className="text-fg">{value.name}</strong> in person or by phone. They sign in with <span className="text-fg">{value.email}</span> and
        will be asked to choose their own password.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <code className="flex-1 h-10 px-3 flex items-center rounded-md bg-subtle border border-line font-mono text-base text-fg tracking-wide select-all">{value.password}</code>
        <Button variant="secondary" className="h-10" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="text-xs text-fg-faint mt-3">It won't be shown again. If it's lost, reset the password.</p>
    </Modal>
  );
};

export const TeamView: React.FC = () => {
  const { allEmployees, currentUser, refreshEmployees, retryLoad, confirm, showToast } = useApp();
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<PersonForm>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<{ name: string; email: string; password: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isAdmin = currentUser?.role === 'admin';

  // Admins see the latest list (including people added from other devices)
  useEffect(() => {
    if (isAdmin) refreshEmployees();
  }, [isAdmin, refreshEmployees]);

  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenuFor(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuFor(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuFor]);

  const inactiveCount = allEmployees.filter((e) => e.active === false).length;
  const departments = [...new Set(allEmployees.map((e) => e.department))].sort();
  const q = search.toLowerCase();
  const visible = allEmployees
    .filter((e) => showInactive || e.active !== false)
    .filter((e) => (department === 'all' || e.department === department) && (!q || [e.name, e.title, e.email].some((v) => v.toLowerCase().includes(q))))
    .sort((a, b) => Number(a.active === false) - Number(b.active === false) || a.name.localeCompare(b.name));

  const openEditor = (person: User | null) => {
    setMenuFor(null);
    setEditing(person);
    setError(null);
    setForm(
      person
        ? { name: person.name, email: person.email, title: person.title, department: person.department, role: person.role, phone: person.phone, status: person.status }
        : EMPTY
    );
    setEditorOpen(true);
  };

  const set = (patch: Partial<PersonForm>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (editing) {
        await api.put<User>(`/api/employees/${editing.id}`, form);
        showToast('Saved', 'success');
        // Editing yourself (e.g. your role) changes what you can see
        if (editing.id === currentUser?.id) retryLoad();
      } else {
        const res = await api.post<{ user: User; temporaryPassword: string }>('/api/employees', form);
        setTempPassword({ name: res.user.name, email: res.user.email, password: res.temporaryPassword });
      }
      await refreshEmployees();
      setEditorOpen(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async (person: User) => {
    setMenuFor(null);
    const ok = await confirm({
      title: `Reset ${person.name}'s password?`,
      message: 'They will be signed out on every device and must sign in with a new temporary password.',
      confirmLabel: 'Reset password',
    });
    if (!ok) return;
    try {
      const res = await api.post<{ temporaryPassword: string }>(`/api/employees/${person.id}/reset-password`);
      setTempPassword({ name: person.name, email: person.email, password: res.temporaryPassword });
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const setActive = async (person: User, active: boolean) => {
    setMenuFor(null);
    if (!active) {
      const ok = await confirm({
        title: `Deactivate ${person.name}?`,
        message: 'They are signed out immediately and can no longer sign in. Their tasks, files and history stay as they are. You can reactivate them later.',
        confirmLabel: 'Deactivate',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await api.post(`/api/employees/${person.id}/${active ? 'reactivate' : 'deactivate'}`);
      await refreshEmployees();
      showToast(active ? `${person.name} can sign in again` : `${person.name} was deactivated`, 'info');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const columns = isAdmin
    ? 'md:grid-cols-[minmax(0,1fr)_150px_130px_minmax(0,220px)_130px_32px]'
    : 'md:grid-cols-[minmax(0,1fr)_160px_130px_minmax(0,220px)_140px]';

  return (
    <PageShell
      title="Team"
      description={`${allEmployees.length - inactiveCount} people across ${departments.length} departments`}
      actions={
        isAdmin && (
          <Button onClick={() => openEditor(null)}>
            <Plus size={15} /> Add person
          </Button>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, title or email" label="Search people" className="w-full sm:w-72" />
        <select aria-label="Department" value={department} onChange={(e) => setDepartment(e.target.value)} className={toolbarSelectClass}>
          <option value="all">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {isAdmin && inactiveCount > 0 && (
          <label className="flex items-center gap-2 h-8 px-1 text-[13px] text-fg-muted">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-accent" />
            Show deactivated ({inactiveCount})
          </label>
        )}
      </div>

      <div className="border border-line rounded-lg">
        <div className={`hidden md:grid ${columns} gap-3 px-3 h-8 items-center bg-subtle border-b border-line rounded-t-lg text-xs font-medium text-fg-faint`}>
          <span>Name</span>
          <span>Department</span>
          <span>Role</span>
          <span>Email</span>
          <span>Phone</span>
          {isAdmin && <span aria-hidden="true" />}
        </div>
        <ul className="divide-y divide-line">
          {visible.map((emp) => {
            const inactive = emp.active === false;
            return (
              <li key={emp.id} className={`grid grid-cols-[minmax(0,1fr)_auto] ${columns} gap-3 px-3 py-2.5 items-center hover:bg-subtle ${inactive ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <span className="relative shrink-0">
                    <Avatar src={emp.avatar} name={emp.name} size={30} />
                    {!inactive && (
                      <span className={`absolute -bottom-px -right-px w-2.5 h-2.5 rounded-full ring-2 ring-canvas ${STATUS_DOT[emp.status]}`} title={STATUS_LABEL[emp.status]} aria-label={STATUS_LABEL[emp.status]} />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-fg">
                      <span className="truncate">{emp.name}</span>
                      {emp.id === currentUser?.id && <Tag>You</Tag>}
                      {inactive && <Tag tone="red">Deactivated</Tag>}
                    </div>
                    <div className="text-[13px] text-fg-faint truncate">{emp.title}</div>
                  </div>
                </div>
                <span className="hidden md:block text-[13px] text-fg-muted truncate">{emp.department}</span>
                <span className="text-[13px] text-fg-muted justify-self-end md:justify-self-start" title={ROLE_HELP[emp.role]}>
                  {label(emp.role)}
                </span>
                <a href={`mailto:${emp.email}`} className="hidden md:block py-2.5 -my-2.5 pointer-fine:py-0 pointer-fine:my-0 text-[13px] text-fg-muted truncate hover:text-accent-ink hover:underline underline-offset-2">
                  {emp.email}
                </a>
                <a href={`tel:${emp.phone}`} className="hidden md:block py-2.5 -my-2.5 pointer-fine:py-0 pointer-fine:my-0 text-[13px] text-fg-muted tabular-nums hover:text-accent-ink">
                  {emp.phone}
                </a>
                {isAdmin && (
                  <div className="relative col-start-2 row-start-1 md:col-start-auto md:row-start-auto justify-self-end" ref={menuFor === emp.id ? menuRef : undefined}>
                    <button
                      onClick={() => setMenuFor(menuFor === emp.id ? null : emp.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-hover"
                      aria-label={`Actions for ${emp.name}`}
                      aria-haspopup="menu"
                      aria-expanded={menuFor === emp.id}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    {menuFor === emp.id && (
                      <div role="menu" className="absolute right-0 top-8 z-30 w-48 bg-surface border border-line rounded-lg shadow-[0_8px_28px_rgb(0_0_0/0.14)] p-1 animate-fade-in">
                        <button role="menuitem" onClick={() => openEditor(emp)} className="w-full text-left h-8 px-2 rounded-md text-sm text-fg hover:bg-hover">
                          Edit details & role
                        </button>
                        {!inactive && (
                          <button role="menuitem" onClick={() => resetPassword(emp)} className="w-full text-left h-8 px-2 rounded-md text-sm text-fg hover:bg-hover">
                            Reset password
                          </button>
                        )}
                        {emp.id !== currentUser?.id && (
                          <button
                            role="menuitem"
                            onClick={() => setActive(emp, inactive)}
                            className={`w-full text-left h-8 px-2 rounded-md text-sm hover:bg-hover ${inactive ? 'text-fg' : 'text-tone-red-fg'}`}
                          >
                            {inactive ? 'Reactivate' : 'Deactivate'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {visible.length === 0 && <p className="text-center text-sm text-fg-muted py-10">No one matches that search.</p>}

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Add person'}
        description={editing ? undefined : "They'll get a temporary password to sign in with, and choose their own at first sign-in."}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="person-form" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add person'}
            </Button>
          </>
        }
      >
        <form id="person-form" onSubmit={submit} className="space-y-3">
          {error && <p role="alert" className="text-sm text-tone-red-fg">{error}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Full name" required>
              <input data-autofocus required className={inputClass} value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Work email" required>
              <input type="email" required className={inputClass} value={form.email} onChange={(e) => set({ email: e.target.value })} />
            </Field>
            <Field label="Job title">
              <input className={inputClass} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Frontend developer" />
            </Field>
            <Field label="Department">
              <input className={inputClass} list="departments" value={form.department} onChange={(e) => set({ department: e.target.value })} placeholder="e.g. Engineering" />
              <datalist id="departments">
                {departments.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </Field>
            <Field label="Phone">
              <input type="tel" className={inputClass} value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
            </Field>
            {editing && (
              <Field label="Status">
                <select className={selectClass} value={form.status} onChange={(e) => set({ status: e.target.value as User['status'] })}>
                  <option value="active">Available</option>
                  <option value="busy">Busy</option>
                  <option value="away">Away</option>
                </select>
              </Field>
            )}
          </div>
          <fieldset>
            <legend className="block text-[13px] font-medium text-fg-muted mb-1">Role</legend>
            <div className="space-y-1">
              {(['member', 'pm', 'admin'] as const).map((r) => (
                <label key={r} className={`flex items-start gap-2.5 p-2 rounded-md border cursor-pointer ${form.role === r ? 'border-accent bg-accent-soft' : 'border-line hover:bg-hover'}`}>
                  <input type="radio" name="role" value={r} checked={form.role === r} onChange={() => set({ role: r })} className="mt-1 accent-accent" />
                  <span>
                    <span className="block text-sm text-fg">{label(r)}</span>
                    <span className="block text-[13px] text-fg-muted">{ROLE_HELP[r]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </form>
      </Modal>

      <TemporaryPasswordDialog value={tempPassword} onClose={() => setTempPassword(null)} />
    </PageShell>
  );
};
