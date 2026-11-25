import React, { useState, useEffect } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { Client } from '../../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { Modal } from '../ui/Modal';
import { Field, inputClass, selectClass, textareaClass, Button, IconButton, SearchInput, toolbarSelectClass } from '../ui/Field';
import { StatusBadge } from '../ui/Badges';
import { PageShell } from '../layout/PageShell';

type ClientForm = Pick<Client, 'name' | 'company' | 'industry' | 'contactPerson' | 'email' | 'phone' | 'status' | 'website' | 'notes'> & {
  totalBilled: string;
};

const EMPTY: ClientForm = { name: '', company: '', industry: '', contactPerson: '', email: '', phone: '', status: 'active', website: '', notes: '', totalBilled: '0' };

export const ClientsView: React.FC = () => {
  const { currentUser, projects, openProject, showToast } = useApp();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState<Client | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<ClientForm>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canEdit = currentUser?.role === 'admin' || currentUser?.role === 'pm';
  const isAdmin = currentUser?.role === 'admin';

  useEffect(() => {
    api
      .get<Client[]>('/api/clients')
      .then(setClients)
      .catch((err) => showToast(err.message, 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  const openEditor = (client: Client | null) => {
    setEditing(client);
    setError(null);
    setForm(
      client
        ? {
            name: client.name,
            company: client.company,
            industry: client.industry,
            contactPerson: client.contactPerson,
            email: client.email,
            phone: client.phone,
            status: client.status,
            website: client.website,
            notes: client.notes,
            totalBilled: String(client.totalBilled),
          }
        : EMPTY
    );
    setEditorOpen(true);
  };

  const set = (patch: Partial<ClientForm>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const website = form.website.trim() && !/^https?:\/\//i.test(form.website.trim()) ? `https://${form.website.trim()}` : form.website.trim();
    const body = { ...form, website, totalBilled: isAdmin ? Number(form.totalBilled) : undefined };
    try {
      if (editing) {
        const updated = await api.put<Client>(`/api/clients/${editing.id}`, body);
        setClients((list) => list.map((c) => (c.id === updated.id ? updated : c)));
        showToast('Client updated', 'success');
      } else {
        const created = await api.post<Client>('/api/clients', body);
        setClients((list) => [created, ...list]);
        showToast(`Added ${created.name}`, 'success');
      }
      setEditorOpen(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const q = search.toLowerCase();
  const visible = clients
    .filter((c) => status === 'all' || c.status === status)
    .filter((c) => !q || [c.name, c.company, c.contactPerson, c.industry, c.email].some((v) => v.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <PageShell
      title="Clients"
      description="Accounts, contacts and their projects"
      actions={
        canEdit && (
          <Button onClick={() => openEditor(null)}>
            <Plus size={15} /> New client
          </Button>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search clients or contacts" label="Search clients" className="w-full sm:w-72" />
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={toolbarSelectClass}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="prospect">Prospect</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-fg-muted" role="status">
          Loading clients…
        </div>
      ) : visible.length === 0 ? (
        <div className="py-16 text-center text-sm text-fg-muted border border-dashed border-line-strong rounded-lg">No clients found.</div>
      ) : (
        <div className="border border-line rounded-lg overflow-hidden">
          <div className="hidden lg:grid grid-cols-[minmax(0,1fr)_minmax(0,200px)_100px_minmax(0,220px)_110px_32px] gap-3 px-3 h-8 items-center bg-subtle border-b border-line text-xs font-medium text-fg-faint">
            <span>Client</span>
            <span>Contact</span>
            <span>Status</span>
            <span>Projects</span>
            <span className="text-right">Billed</span>
            <span aria-hidden="true" />
          </div>
          <ul className="divide-y divide-line">
            {visible.map((client) => {
              const clientProjects = projects.filter((p) => p.clientId === client.id);
              return (
                <li key={client.id} className="group grid grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_minmax(0,200px)_100px_minmax(0,220px)_110px_32px] gap-x-3 gap-y-1 px-3 py-2.5 items-center hover:bg-subtle">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-fg truncate">{client.name}</div>
                    <div className="text-xs text-fg-faint truncate">
                      {client.industry}
                      {client.website && (
                        <>
                          {' · '}
                          <a href={client.website} target="_blank" rel="noopener noreferrer" className="hover:text-accent-ink hover:underline underline-offset-2">
                            {client.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="hidden lg:block min-w-0">
                    <div className="text-[13px] text-fg truncate">{client.contactPerson}</div>
                    <a href={`mailto:${client.email}`} className="block text-xs text-fg-faint truncate hover:text-accent-ink hover:underline underline-offset-2">
                      {client.email}
                    </a>
                  </div>
                  <span className="justify-self-end lg:justify-self-start">
                    <StatusBadge status={client.status} />
                  </span>
                  <div className="hidden lg:block min-w-0 text-[13px] text-fg-muted truncate">
                    {clientProjects.length === 0
                      ? <span className="text-fg-faint">None</span>
                      : clientProjects.slice(0, 2).map((p, i) => (
                          <React.Fragment key={p.id}>
                            {i > 0 && ', '}
                            <button onClick={() => openProject(p.id)} className="hover:text-fg hover:underline underline-offset-2">
                              {p.name}
                            </button>
                          </React.Fragment>
                        ))}
                    {clientProjects.length > 2 && <span className="text-fg-faint"> +{clientProjects.length - 2}</span>}
                  </div>
                  <span className="hidden lg:block text-[13px] text-fg tabular-nums text-right">${client.totalBilled.toLocaleString()}</span>
                  <span className="hidden lg:block">
                    {canEdit && (
                      <IconButton label={`Edit ${client.name}`} onClick={() => openEditor(client)} className="opacity-0 group-hover:opacity-100 focus:opacity-100">
                        <Pencil size={14} />
                      </IconButton>
                    )}
                  </span>
                  {/* Compact details on smaller screens */}
                  <div className="lg:hidden col-span-2 flex items-center justify-between gap-2 text-xs text-fg-faint">
                    <span className="truncate">
                      {client.contactPerson} · {clientProjects.length} project{clientProjects.length === 1 ? '' : 's'} · ${client.totalBilled.toLocaleString()}
                    </span>
                    {canEdit && (
                      <button onClick={() => openEditor(client)} className="text-fg-muted hover:text-fg shrink-0">
                        Edit
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'New client'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="client-form" disabled={saving}>
              {saving ? 'Saving…' : 'Save client'}
            </Button>
          </>
        }
      >
        <form id="client-form" onSubmit={submit} className="space-y-3">
          {error && <p role="alert" className="text-sm text-tone-red-fg">{error}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Client name" required>
              <input data-autofocus required className={inputClass} value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Legal company name">
              <input className={inputClass} value={form.company} onChange={(e) => set({ company: e.target.value })} />
            </Field>
            <Field label="Industry">
              <input className={inputClass} value={form.industry} onChange={(e) => set({ industry: e.target.value })} placeholder="e.g. Fintech" />
            </Field>
            <Field label="Status">
              <select className={selectClass} value={form.status} onChange={(e) => set({ status: e.target.value as Client['status'] })}>
                <option value="active">Active</option>
                <option value="prospect">Prospect</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
            <Field label="Primary contact">
              <input className={inputClass} value={form.contactPerson} onChange={(e) => set({ contactPerson: e.target.value })} />
            </Field>
            <Field label="Email" required>
              <input type="email" required className={inputClass} value={form.email} onChange={(e) => set({ email: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input type="tel" className={inputClass} value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
            </Field>
            <Field label="Website">
              <input className={inputClass} value={form.website} onChange={(e) => set({ website: e.target.value })} placeholder="example.com" />
            </Field>
            {isAdmin && (
              <Field label="Total billed ($)" hint="Only administrators can change this">
                <input type="number" min={0} className={inputClass} value={form.totalBilled} onChange={(e) => set({ totalBilled: e.target.value })} />
              </Field>
            )}
          </div>
          <Field label="Notes">
            <textarea rows={3} className={textareaClass} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </form>
      </Modal>
    </PageShell>
  );
};
