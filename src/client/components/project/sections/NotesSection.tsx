import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, FileText } from 'lucide-react';
import { ProjectNote } from '../../../../types';
import { api } from '../../../services/api';
import { useApp } from '../../../context/AppContext';
import { useProject } from '../ProjectContext';
import { formatDateTime, label, timeAgo } from '../../ui/Badges';
import { Button, IconButton, selectClass, textareaClass } from '../../ui/Field';
import { Markdown } from '../../ui/Markdown';
import { OPEN_NOTE_KEY } from '../../modals/QuickProjectPickerModal';

const CATEGORIES: ProjectNote['category'][] = ['meeting', 'architecture', 'spec', 'feedback'];

export const NotesSection: React.FC = () => {
  const { projectId, notes, setNotes, canManage, reload } = useProject();
  const { currentUser, showToast, deleteWithUndo } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    // Opened from search: show that note
    try {
      const wanted = sessionStorage.getItem(OPEN_NOTE_KEY);
      sessionStorage.removeItem(OPEN_NOTE_KEY);
      if (wanted && notes.some((n) => n.id === wanted)) return wanted;
    } catch {
      // Storage unavailable
    }
    return notes[0]?.id ?? null;
  });
  // null = viewing; 'new' = creating; otherwise the id being edited
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<ProjectNote['category']>('meeting');
  const [saving, setSaving] = useState(false);

  const selected = notes.find((n) => n.id === selectedId) ?? notes[0] ?? null;
  const canEdit = (n: ProjectNote) => n.authorId === currentUser?.id || canManage;

  useEffect(() => {
    if (selectedId && !notes.some((n) => n.id === selectedId)) setSelectedId(notes[0]?.id ?? null);
  }, [notes, selectedId]);

  const startEdit = (note: ProjectNote | null) => {
    setEditing(note ? note.id : 'new');
    setTitle(note?.title ?? '');
    setContent(note?.content ?? '');
    setCategory(note?.category ?? 'meeting');
  };

  const save = async () => {
    if (!title.trim()) return showToast('Give the note a title', 'error');
    setSaving(true);
    try {
      if (editing === 'new') {
        const note = await api.post<ProjectNote>(`/api/projects/${projectId}/notes`, { title, content, category });
        setNotes((list) => [note, ...list]);
        setSelectedId(note.id);
      } else if (editing) {
        const note = await api.put<ProjectNote>(`/api/projects/${projectId}/notes/${editing}`, { title, content, category });
        setNotes((list) => list.map((n) => (n.id === note.id ? note : n)));
      }
      setEditing(null);
      reload('activity').catch(() => {});
    } catch (err: any) {
      showToast(err.message || 'Failed to save note', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = (note: ProjectNote) => {
    deleteWithUndo({
      id: note.id,
      message: `Deleted note “${note.title}”`,
      hide: () => setNotes((list) => list.filter((n) => n.id !== note.id)),
      restore: () => setNotes((list) => (list.some((n) => n.id === note.id) ? list : [note, ...list])),
      commit: () => api.delete(`/api/projects/${projectId}/notes/${note.id}`),
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-6 min-h-[480px]">
      {/* Page list, like a mini sidebar */}
      <div className="md:border-r md:border-line md:pr-4">
        <Button variant="secondary" className="w-full mb-2" onClick={() => startEdit(null)}>
          <Plus size={14} /> New note
        </Button>
        <ul className="space-y-px" aria-label="Notes">
          {notes.map((note) => {
            const active = editing !== 'new' && selected?.id === note.id;
            return (
              <li key={note.id}>
                <button
                  onClick={() => {
                    setEditing(null);
                    setSelectedId(note.id);
                  }}
                  aria-current={active}
                  className={`w-full text-left px-2 py-1.5 rounded-md ${active ? 'bg-selected' : 'hover:bg-hover'}`}
                >
                  <div className="flex items-center gap-2 text-sm text-fg">
                    <FileText size={14} className="text-fg-faint shrink-0" />
                    <span className="truncate">{note.title}</span>
                  </div>
                  <div className="text-xs text-fg-faint pl-[22px] truncate">
                    {label(note.category)} · {timeAgo(note.updatedAt)}
                  </div>
                </button>
              </li>
            );
          })}
          {notes.length === 0 && <li className="px-2 py-2 text-[13px] text-fg-faint">No notes yet.</li>}
        </ul>
      </div>

      {/* Document */}
      <article className="min-w-0">
        {editing ? (
          <div className="space-y-3">
            <input
              autoFocus
              aria-label="Note title"
              className="w-full text-2xl font-semibold tracking-tight text-fg bg-transparent placeholder:text-fg-faint focus:outline-none"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled"
            />
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-fg-faint">Type</span>
              <select aria-label="Note type" className={`${selectClass} w-40 h-8`} value={category} onChange={(e) => setCategory(e.target.value as ProjectNote['category'])}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {label(c)}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              rows={18}
              aria-label="Note content"
              className={`${textareaClass} font-mono text-[13px] leading-relaxed`}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && save()}
              placeholder="Write in Markdown: ## headings, - lists, - [ ] checklists, **bold**, links…"
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? 'Saving…' : editing === 'new' ? 'Publish' : 'Save'}
              </Button>
            </div>
          </div>
        ) : selected ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-2xl font-semibold tracking-tight text-fg">{selected.title}</h2>
              {canEdit(selected) && (
                <div className="flex gap-0.5 shrink-0">
                  <IconButton label="Edit note" onClick={() => startEdit(selected)}>
                    <Pencil size={14} />
                  </IconButton>
                  <IconButton label="Delete note" danger onClick={() => remove(selected)}>
                    <Trash2 size={14} />
                  </IconButton>
                </div>
              )}
            </div>
            <div className="text-[13px] text-fg-faint mt-1 mb-6">
              {label(selected.category)} · {selected.authorName} · edited {formatDateTime(selected.updatedAt)}
            </div>
            {selected.content.trim() ? <Markdown source={selected.content} /> : <p className="text-sm text-fg-faint">This note is empty.</p>}
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-fg-faint">Create a note to capture meetings, decisions and specs.</div>
        )}
      </article>
    </div>
  );
};
