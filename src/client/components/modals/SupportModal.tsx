import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { SupportTicket, SupportCategory } from '../../../types';
import { api } from '../../services/api';
import { OPEN_SUPPORT_EVENT } from '../../services/office';
import { useApp } from '../../context/AppContext';
import { Modal, useDirty } from '../ui/Modal';
import { Field, inputClass, selectClass, textareaClass, Button, EmptyState } from '../ui/Field';
import { Tag, timeAgo, formatDateTime } from '../ui/Badges';
import { CATEGORY_LABEL, CATEGORY_TONE } from '../owner/OwnerConsole';

/**
 * "Report a problem": goes straight to HandleMyDesk. Only the person who reports it and HandleMyDesk
 * see it, so it is safe to report a problem with a colleague or manager.
 */
export const SupportModal: React.FC = () => {
  const { showToast } = useApp();
  const [open, setOpen] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [view, setView] = useState<'list' | 'new' | string>('list');
  const [form, setForm] = useState<{ category: SupportCategory; subject: string; message: string }>({ category: 'technical', subject: '', message: '' });
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useDirty({ form, reply }, open);

  const load = useCallback(() => {
    api
      .get<SupportTicket[]>('/api/support/tickets')
      .then((t) => {
        setTickets(t);
        if (t.length === 0) setView('new');
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setView('list');
      setError(null);
      load();
    };
    window.addEventListener(OPEN_SUPPORT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SUPPORT_EVENT, onOpen);
  }, [load]);

  const selected = tickets?.find((t) => t.id === view) ?? null;

  useEffect(() => {
    if (selected?.unreadByCustomer) {
      api
        .post<SupportTicket>(`/api/support/tickets/${selected.id}/read`)
        .then((t) => setTickets((all) => all?.map((x) => (x.id === t.id ? t : x)) ?? null))
        .catch(() => undefined);
    }
  }, [selected?.id, selected?.unreadByCustomer]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const t = await api.post<SupportTicket>('/api/support/tickets', form);
      setTickets((all) => [t, ...(all ?? [])]);
      setForm({ category: 'technical', subject: '', message: '' });
      setView(t.id);
      showToast('Sent to HandleMyDesk. You will get a notification when they reply.', 'success');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async () => {
    if (!selected || !reply.trim()) return;
    setBusy(true);
    try {
      const t = await api.post<SupportTicket>(`/api/support/tickets/${selected.id}/messages`, { text: reply });
      setTickets((all) => all?.map((x) => (x.id === t.id ? t : x)) ?? null);
      setReply('');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const close = () => setOpen(false);

  return (
    <Modal
      open={open}
      onClose={close}
      dirty={dirty && !busy}
      title={view === 'new' ? 'Report a problem' : selected ? selected.subject : 'Your reports'}
      description={
        view === 'new'
          ? 'This goes straight to HandleMyDesk. Only you and HandleMyDesk can see it, not your colleagues or managers.'
          : selected
            ? undefined
            : 'Problems you have sent to HandleMyDesk, and their replies.'
      }
      size="lg"
      footer={
        view === 'new' ? (
          <>
            <Button variant="secondary" onClick={() => (tickets?.length ? setView('list') : close())}>
              {tickets?.length ? 'Back' : 'Cancel'}
            </Button>
            <Button type="submit" form="support-form" disabled={busy}>
              {busy ? 'Sending…' : 'Send'}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        )
      }
    >
      {error && (
        <p role="alert" className="text-sm text-tone-red-fg mb-3">
          {error}
        </p>
      )}

      {view === 'new' ? (
        <form id="support-form" onSubmit={submit} className="space-y-3">
          <Field label="What kind of problem?">
            <select className={selectClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as SupportCategory })}>
              <option value="technical">Something isn't working (technical)</option>
              <option value="people">A problem between people (conflict, complaint)</option>
              <option value="other">Something else</option>
            </select>
          </Field>
          <Field label="Subject" required>
            <input data-autofocus required maxLength={200} className={inputClass} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="In a few words" />
          </Field>
          <Field label="What happened?" required>
            <textarea required rows={5} maxLength={5000} className={textareaClass} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </Field>
        </form>
      ) : selected ? (
        <div className="space-y-3">
          <button onClick={() => setView('list')} className="flex items-center gap-1 text-[13px] text-fg-muted hover:text-fg">
            <ArrowLeft size={14} /> Your reports
          </button>
          <div className="flex items-center gap-2">
            <Tag tone={CATEGORY_TONE[selected.category]}>{CATEGORY_LABEL[selected.category]}</Tag>
            {selected.status === 'resolved' ? <Tag tone="green">Resolved</Tag> : <Tag tone="amber">Open</Tag>}
          </div>
          <ol className="space-y-3">
            {selected.messages.map((m) => (
              <li key={m.id} className={`max-w-[85%] ${m.from === 'customer' ? 'ml-auto' : ''}`}>
                <div className={`px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words ${m.from === 'customer' ? 'bg-accent-soft' : 'bg-subtle'}`}>{m.text}</div>
                <div className={`text-[11px] text-fg-faint mt-0.5 ${m.from === 'customer' ? 'text-right' : ''}`}>
                  {m.from === 'customer' ? 'You' : m.name} · {formatDateTime(m.at)}
                </div>
              </li>
            ))}
          </ol>
          <textarea rows={3} className={textareaClass} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Add more details or answer HandleMyDesk…" aria-label="Reply" />
          <div className="flex justify-end">
            <Button onClick={sendReply} disabled={busy || !reply.trim()}>
              Send
            </Button>
          </div>
        </div>
      ) : !tickets ? (
        <p className="text-sm text-fg-muted" role="status">
          Loading…
        </p>
      ) : (
        <div className="space-y-3">
          <Button onClick={() => setView('new')}>
            <Plus size={15} /> Report a new problem
          </Button>
          {tickets.length === 0 ? (
            <EmptyState message="You haven't reported anything yet." />
          ) : (
            <ul className="border border-line rounded-lg divide-y divide-line">
              {tickets.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setView(t.id)} className="w-full text-left px-3 py-2.5 hover:bg-hover">
                    <div className="flex items-center gap-2">
                      {t.unreadByCustomer && <span className="w-2 h-2 rounded-full bg-accent shrink-0" aria-label="New reply" />}
                      <span className={`text-sm truncate flex-1 ${t.unreadByCustomer ? 'font-semibold' : ''}`}>{t.subject}</span>
                      {t.status === 'resolved' ? <Tag tone="green">Resolved</Tag> : <Tag tone="amber">Open</Tag>}
                    </div>
                    <div className="text-xs text-fg-faint mt-0.5">Updated {timeAgo(t.updatedAt)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
};
