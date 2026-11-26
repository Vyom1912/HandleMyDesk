import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, LifeBuoy, ScrollText, LogOut, Plus, LogIn, Pause, Play, Pencil, ArrowLeft, KeyRound, RefreshCw, Copy } from 'lucide-react';
import { OfficeSummary, OwnerProfile, OwnerLogEntry, SupportTicket, SupportCategory } from '../../../types';
import { api, setStoredToken, enterOfficeAsSupport, UNAUTHORIZED_EVENT } from '../../services/api';
import { Modal } from '../ui/Modal';
import { Field, inputClass, textareaClass, Button, Segmented, EmptyState } from '../ui/Field';
import { Tag, timeAgo, formatDateTime } from '../ui/Badges';

/*
 * HandleMyDesk owner console: every customer office in one place. The owner can add offices,
 * pause them, go inside one as support to fix or maintain things, and answer "Report a problem".
 */

export const CATEGORY_LABEL: Record<SupportCategory, string> = { people: 'Between people', technical: 'Technical', other: 'Other' };
export const CATEGORY_TONE: Record<SupportCategory, 'orange' | 'blue' | 'gray'> = { people: 'orange', technical: 'blue', other: 'gray' };

type Tab = 'offices' | 'problems' | 'log';

function signOut() {
  setStoredToken(null);
  window.location.hash = '#/';
  window.location.reload();
}

const Toast: React.FC<{ message: string | null; error?: boolean }> = ({ message, error }) =>
  message ? (
    <div role="status" className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] max-w-[90vw] px-4 py-2.5 rounded-lg shadow-lg text-sm animate-fade-in ${error ? 'bg-tone-red-bg text-tone-red-fg' : 'bg-fg text-canvas'}`}>
      {message}
    </div>
  ) : null;

export const OwnerConsole: React.FC = () => {
  const [me, setMe] = useState<OwnerProfile | null>(null);
  const [tab, setTab] = useState<Tab>('offices');
  const [offices, setOffices] = useState<OfficeSummary[] | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);

  const notifyUser = useCallback((message: string, error = false) => {
    setToast({ message, error });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [o, t] = await Promise.all([api.get<OfficeSummary[]>('/api/owner/offices'), api.get<SupportTicket[]>('/api/owner/tickets')]);
      setOffices(o);
      setTickets(t);
    } catch (err: any) {
      notifyUser(err.message, true);
    }
  }, [notifyUser]);

  useEffect(() => {
    // An expired or revoked owner sign-in goes back to the sign-in screen
    const onUnauthorized = () => signOut();
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    api
      .get<{ owner: OwnerProfile }>('/api/owner/me')
      .then((r) => setMe(r.owner))
      .catch(() => signOut());
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => {
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
      clearInterval(timer);
    };
  }, [refresh]);

  const unreadProblems = tickets?.filter((t) => t.unreadByOwner).length ?? 0;

  const enter = async (office: OfficeSummary) => {
    try {
      const r = await api.post<{ token: string }>(`/api/owner/offices/${office.id}/enter`);
      enterOfficeAsSupport(r.token);
    } catch (err: any) {
      notifyUser(err.message, true);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-canvas text-fg" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <header className="sticky top-0 z-30 bg-canvas/95 backdrop-blur border-b border-line">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <span className="w-7 h-7 rounded bg-fg text-canvas text-xs font-bold flex items-center justify-center shrink-0" aria-hidden="true">
            H
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-tight truncate">HandleMyDesk owner console</div>
            <div className="text-xs text-fg-faint leading-tight truncate">{me ? `${me.name} · ${me.email}` : ' '}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={refresh} aria-label="Refresh">
            <RefreshCw size={14} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPasswordOpen(true)} aria-label="Change password">
            <KeyRound size={14} />
            <span className="hidden sm:inline">Password</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={signOut}>
            <LogOut size={14} />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
        <nav className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto no-scrollbar" aria-label="Owner console">
          {(
            [
              ['offices', 'Offices', Building2, offices?.length ?? 0],
              ['problems', 'Problems', LifeBuoy, unreadProblems],
              ['log', 'Log', ScrollText, 0],
            ] as const
          ).map(([value, text, Icon, count]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              aria-current={tab === value ? 'page' : undefined}
              className={`flex items-center gap-1.5 h-10 px-3 border-b-2 text-sm whitespace-nowrap ${
                tab === value ? 'border-fg text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'
              }`}
            >
              <Icon size={15} />
              {text}
              {value === 'problems' && count > 0 && (
                <span className="min-w-5 h-[18px] px-1.5 rounded-full bg-accent text-on-accent text-[11px] font-semibold flex items-center justify-center">{count}</span>
              )}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5">
        {tab === 'offices' && <OfficesTab offices={offices} tickets={tickets} onChanged={refresh} onEnter={enter} notify={notifyUser} />}
        {tab === 'problems' && <ProblemsTab tickets={tickets} offices={offices} onChanged={refresh} onEnter={enter} notify={notifyUser} />}
        {tab === 'log' && <LogTab />}
      </main>

      <PasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} notify={notifyUser} />
      <Toast message={toast?.message ?? null} error={toast?.error} />
    </div>
  );
};

// ==========================================
// OFFICES
// ==========================================

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: 'red' }> = ({ label, value, tone }) => (
  <div className="min-w-0">
    <div className={`text-base font-semibold tabular-nums ${tone === 'red' ? 'text-tone-red-fg' : 'text-fg'}`}>{value}</div>
    <div className="text-xs text-fg-faint truncate">{label}</div>
  </div>
);

const OfficesTab: React.FC<{
  offices: OfficeSummary[] | null;
  tickets: SupportTicket[] | null;
  onChanged: () => void;
  onEnter: (o: OfficeSummary) => void;
  notify: (m: string, error?: boolean) => void;
}> = ({ offices, onChanged, onEnter, notify }) => {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<OfficeSummary | null>(null);
  const [pausing, setPausing] = useState<OfficeSummary | null>(null);

  if (!offices) return <p className="text-sm text-fg-muted" role="status">Loading offices…</p>;

  const totals = offices.reduce(
    (t, o) => ({ people: t.people + o.people, overdue: t.overdue + o.overdueTasks, problems: t.problems + o.openTickets }),
    { people: 0, overdue: 0, problems: 0 }
  );

  const setStatus = async (office: OfficeSummary, status: 'active' | 'suspended') => {
    try {
      await api.put(`/api/owner/offices/${office.id}`, { status });
      notify(status === 'active' ? `${office.name} is active again` : `${office.name} is paused`);
      onChanged();
    } catch (err: any) {
      notify(err.message, true);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-lg font-semibold">Offices</h1>
          <p className="text-sm text-fg-muted">Every customer company. Each one only ever sees its own people and work.</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus size={15} /> Add office
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5 p-3 rounded-lg border border-line bg-surface">
        <Stat label="Offices" value={offices.length} />
        <Stat label="People" value={totals.people} />
        <Stat label="Overdue tasks" value={totals.overdue} tone={totals.overdue ? 'red' : undefined} />
        <Stat label="Open problems" value={totals.problems} tone={totals.problems ? 'red' : undefined} />
      </div>

      <ul className="grid gap-3 md:grid-cols-2">
        {offices.map((o) => (
          <li key={o.id} className={`p-4 rounded-lg border bg-surface ${o.status === 'suspended' ? 'border-tone-amber-fg/40' : 'border-line'}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-[15px] font-semibold truncate">{o.name}</h2>
                  {o.status === 'suspended' ? <Tag tone="amber">Paused</Tag> : <Tag tone="green">Active</Tag>}
                  {o.id === 'main' && <Tag>First office</Tag>}
                </div>
                <p className="text-xs text-fg-faint mt-0.5 truncate">
                  {o.admins.length ? `Admin: ${o.admins.map((a) => `${a.name} (${a.email})`).join(', ')}` : 'No administrator'}
                </p>
              </div>
              <button onClick={() => setEditing(o)} className="w-8 h-8 flex items-center justify-center rounded-md text-fg-faint hover:bg-hover hover:text-fg" aria-label={`Edit ${o.name}`}>
                <Pencil size={14} />
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2 mt-3">
              <Stat label="People" value={o.people} />
              <Stat label="Projects" value={o.activeProjects} />
              <Stat label="Overdue" value={o.overdueTasks} tone={o.overdueTasks ? 'red' : undefined} />
              <Stat label="Problems" value={o.openTickets} tone={o.openTickets ? 'red' : undefined} />
            </div>
            {o.notes && <p className="text-[13px] text-fg-muted mt-3 whitespace-pre-line">{o.notes}</p>}

            <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-line">
              <Button size="sm" onClick={() => onEnter(o)}>
                <LogIn size={14} /> Open office
              </Button>
              {o.status === 'active' ? (
                <Button size="sm" variant="secondary" onClick={() => setPausing(o)}>
                  <Pause size={14} /> Pause
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setStatus(o, 'active')}>
                  <Play size={14} /> Resume
                </Button>
              )}
              <span className="ml-auto text-xs text-fg-faint">{o.lastActivity ? `Active ${timeAgo(o.lastActivity)}` : 'No activity yet'}</span>
            </div>
          </li>
        ))}
      </ul>

      <AddOfficeModal open={adding} onClose={() => setAdding(false)} onAdded={onChanged} notify={notify} />
      <EditOfficeModal office={editing} onClose={() => setEditing(null)} onSaved={onChanged} notify={notify} />
      <Modal
        open={!!pausing}
        onClose={() => setPausing(null)}
        title={`Pause ${pausing?.name ?? ''}?`}
        description="Nobody in this office can sign in or use HandleMyDesk until you resume it. Their data stays safe, and you can still open the office."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPausing(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pausing) setStatus(pausing, 'suspended');
                setPausing(null);
              }}
            >
              Pause office
            </Button>
          </>
        }
      >
        {null}
      </Modal>
    </>
  );
};

const AddOfficeModal: React.FC<{ open: boolean; onClose: () => void; onAdded: () => void; notify: (m: string, e?: boolean) => void }> = ({ open, onClose, onAdded }) => {
  const [form, setForm] = useState({ name: '', adminName: '', adminEmail: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ name: string; adminEmail: string; temporaryPassword: string } | null>(null);

  const close = () => {
    setForm({ name: '', adminName: '', adminEmail: '', notes: '' });
    setError(null);
    setCreated(null);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const r = await api.post<{ office: OfficeSummary; adminEmail: string; temporaryPassword: string }>('/api/owner/offices', form);
      setCreated({ name: r.office.name, adminEmail: r.adminEmail, temporaryPassword: r.temporaryPassword });
      onAdded();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const details = created ? `HandleMyDesk: ${window.location.origin}\nEmail: ${created.adminEmail}\nTemporary password: ${created.temporaryPassword}` : '';

  return (
    <Modal
      open={open}
      onClose={close}
      title={created ? `${created.name} is ready` : 'Add an office'}
      description={created ? undefined : 'A new customer company. It starts empty, with one administrator who adds their own staff.'}
      footer={
        created ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" form="add-office-form" disabled={saving}>
              {saving ? 'Adding…' : 'Add office'}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">Send these sign-in details to the office administrator. They choose their own password the first time they sign in. The temporary password is shown only once.</p>
          <pre className="p-3 rounded-md bg-subtle border border-line text-[13px] whitespace-pre-wrap break-all font-mono">{details}</pre>
          <Button variant="secondary" size="sm" onClick={() => navigator.clipboard?.writeText(details)}>
            <Copy size={14} /> Copy
          </Button>
        </div>
      ) : (
        <form id="add-office-form" onSubmit={submit} className="space-y-3">
          {error && (
            <p role="alert" className="text-sm text-tone-red-fg">
              {error}
            </p>
          )}
          <Field label="Office (company) name" required>
            <input data-autofocus required className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Acme Studio" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Administrator's name" required>
              <input required className={inputClass} value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
            </Field>
            <Field label="Administrator's email" required>
              <input required type="email" className={inputClass} value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
            </Field>
          </div>
          <Field label="Notes (only you see these)">
            <textarea rows={2} className={textareaClass} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Plan, contact phone, anything to remember" />
          </Field>
        </form>
      )}
    </Modal>
  );
};

const EditOfficeModal: React.FC<{ office: OfficeSummary | null; onClose: () => void; onSaved: () => void; notify: (m: string, e?: boolean) => void }> = ({
  office,
  onClose,
  onSaved,
  notify,
}) => {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setName(office?.name ?? '');
    setNotes(office?.notes ?? '');
    setError(null);
  }, [office]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!office) return;
    try {
      await api.put(`/api/owner/offices/${office.id}`, { name, notes });
      notify('Saved');
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <Modal
      open={!!office}
      onClose={onClose}
      title={`Edit ${office?.name ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-office-form">
            Save
          </Button>
        </>
      }
    >
      <form id="edit-office-form" onSubmit={submit} className="space-y-3">
        {error && (
          <p role="alert" className="text-sm text-tone-red-fg">
            {error}
          </p>
        )}
        <Field label="Office (company) name" required>
          <input data-autofocus required className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Notes (only you see these)">
          <textarea rows={3} className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
};

// ==========================================
// PROBLEMS ("Report a problem")
// ==========================================

const ProblemsTab: React.FC<{
  tickets: SupportTicket[] | null;
  offices: OfficeSummary[] | null;
  onChanged: () => void;
  onEnter: (o: OfficeSummary) => void;
  notify: (m: string, error?: boolean) => void;
}> = ({ tickets, offices, onChanged, onEnter, notify }) => {
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const list = useMemo(() => (tickets ?? []).filter((t) => filter === 'all' || t.status === filter), [tickets, filter]);
  const selected = tickets?.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    if (selected?.unreadByOwner) api.post(`/api/owner/tickets/${selected.id}/read`).then(onChanged).catch(() => undefined);
  }, [selected?.id, selected?.unreadByOwner, onChanged]);

  if (!tickets) return <p className="text-sm text-fg-muted" role="status">Loading…</p>;

  const send = async () => {
    if (!selected || !reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/api/owner/tickets/${selected.id}/messages`, { text: reply });
      setReply('');
      notify('Reply sent. They get a notification.');
      onChanged();
    } catch (err: any) {
      notify(err.message, true);
    } finally {
      setSending(false);
    }
  };

  const setStatus = async (status: 'open' | 'resolved') => {
    if (!selected) return;
    try {
      await api.put(`/api/owner/tickets/${selected.id}`, { status });
      notify(status === 'resolved' ? 'Marked resolved' : 'Reopened');
      onChanged();
    } catch (err: any) {
      notify(err.message, true);
    }
  };

  const officeOf = (t: SupportTicket) => offices?.find((o) => o.id === t.officeId);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
      <section className={selected ? 'hidden lg:block' : ''}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h1 className="text-lg font-semibold">Problems</h1>
          <Segmented
            label="Filter problems"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'resolved', label: 'Resolved' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
        {list.length === 0 ? (
          <EmptyState message={filter === 'open' ? 'No open problems. All offices are happy.' : 'Nothing here.'} />
        ) : (
          <ul className="border border-line rounded-lg divide-y divide-line bg-surface overflow-hidden">
            {list.map((t) => (
              <li key={t.id}>
                <button onClick={() => setSelectedId(t.id)} className={`w-full text-left px-3 py-2.5 hover:bg-hover ${selectedId === t.id ? 'bg-accent-soft' : ''}`}>
                  <div className="flex items-center gap-2">
                    {t.unreadByOwner && <span className="w-2 h-2 rounded-full bg-accent shrink-0" aria-label="New" />}
                    <span className={`text-sm truncate flex-1 ${t.unreadByOwner ? 'font-semibold' : 'font-medium'}`}>{t.subject}</span>
                    <span className="text-xs text-fg-faint shrink-0">{timeAgo(t.updatedAt)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-fg-muted">
                    <Tag tone={CATEGORY_TONE[t.category]}>{CATEGORY_LABEL[t.category]}</Tag>
                    <span className="truncate">
                      {t.officeName} · {t.userName}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={selected ? '' : 'hidden lg:block'}>
        {!selected ? (
          <div className="h-full min-h-40 flex items-center justify-center text-sm text-fg-faint border border-dashed border-line rounded-lg">Choose a problem to read and answer it.</div>
        ) : (
          <div className="border border-line rounded-lg bg-surface">
            <div className="p-4 border-b border-line">
              <button onClick={() => setSelectedId(null)} className="lg:hidden flex items-center gap-1 text-[13px] text-fg-muted mb-2">
                <ArrowLeft size={14} /> All problems
              </button>
              <div className="flex items-start gap-2 flex-wrap">
                <h2 className="text-base font-semibold flex-1 min-w-0">{selected.subject}</h2>
                {selected.status === 'resolved' ? <Tag tone="green">Resolved</Tag> : <Tag tone="amber">Open</Tag>}
              </div>
              <p className="text-[13px] text-fg-muted mt-1">
                <Tag tone={CATEGORY_TONE[selected.category]}>{CATEGORY_LABEL[selected.category]}</Tag> {selected.officeName} · {selected.userName} ({selected.userEmail})
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {officeOf(selected) && (
                  <Button size="sm" variant="secondary" onClick={() => onEnter(officeOf(selected)!)}>
                    <LogIn size={14} /> Open their office
                  </Button>
                )}
                {selected.status === 'open' ? (
                  <Button size="sm" variant="secondary" onClick={() => setStatus('resolved')}>
                    Mark resolved
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setStatus('open')}>
                    Reopen
                  </Button>
                )}
              </div>
            </div>
            <ol className="p-4 space-y-3">
              {selected.messages.map((m) => (
                <li key={m.id} className={`max-w-[85%] ${m.from === 'owner' ? 'ml-auto' : ''}`}>
                  <div className={`px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words ${m.from === 'owner' ? 'bg-accent-soft text-fg' : 'bg-subtle text-fg'}`}>{m.text}</div>
                  <div className={`text-[11px] text-fg-faint mt-0.5 ${m.from === 'owner' ? 'text-right' : ''}`}>
                    {m.name} · {formatDateTime(m.at)}
                  </div>
                </li>
              ))}
            </ol>
            <div className="p-4 border-t border-line space-y-2">
              <textarea rows={3} className={textareaClass} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Reply to ${selected.userName}…`} aria-label="Reply" />
              <div className="flex justify-end">
                <Button onClick={send} disabled={sending || !reply.trim()}>
                  {sending ? 'Sending…' : 'Send reply'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

// ==========================================
// LOG
// ==========================================

const LogTab: React.FC = () => {
  const [log, setLog] = useState<OwnerLogEntry[] | null>(null);
  useEffect(() => {
    api.get<OwnerLogEntry[]>('/api/owner/log').then(setLog).catch(() => setLog([]));
  }, []);
  if (!log) return <p className="text-sm text-fg-muted" role="status">Loading…</p>;
  return (
    <>
      <h1 className="text-lg font-semibold">Log</h1>
      <p className="text-sm text-fg-muted mb-3">Everything owners did: offices added or paused, visits inside offices, replies.</p>
      {log.length === 0 ? (
        <EmptyState message="Nothing yet." />
      ) : (
        <ul className="border border-line rounded-lg divide-y divide-line bg-surface">
          {log.map((l) => (
            <li key={l.id} className="px-3 py-2 text-sm flex flex-wrap gap-x-2">
              <span className="text-fg-faint text-xs w-36 shrink-0 tabular-nums pt-0.5">{formatDateTime(l.at)}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{l.ownerName}</span> {l.action}
                {l.officeName && <span className="text-fg-muted"> · {l.officeName}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

// ==========================================
// OWNER PASSWORD
// ==========================================

const PasswordModal: React.FC<{ open: boolean; onClose: () => void; notify: (m: string, e?: boolean) => void }> = ({ open, onClose, notify }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setCurrent('');
    setNext('');
    setError(null);
    onClose();
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.post<{ token: string }>('/api/owner/password', { currentPassword: current, newPassword: next });
      setStoredToken(r.token);
      notify('Password changed');
      close();
    } catch (err: any) {
      setError(err.message);
    }
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title="Change owner password"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="owner-password-form">
            Change password
          </Button>
        </>
      }
    >
      <form id="owner-password-form" onSubmit={submit} className="space-y-3">
        {error && (
          <p role="alert" className="text-sm text-tone-red-fg">
            {error}
          </p>
        )}
        <Field label="Current password" required>
          <input data-autofocus type="password" required autoComplete="current-password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" required hint="At least 8 characters">
          <input type="password" required minLength={8} autoComplete="new-password" className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
};
