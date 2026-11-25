import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Link as LinkIcon, Trash2, Pencil, Plus, Check } from 'lucide-react';
import { Task, TaskComment, User } from '../../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useProject } from './ProjectContext';
import { useDialogBehavior } from '../ui/Modal';
import { Avatar, formatDate, isOverdue, timeAgo } from '../ui/Badges';
import { Button, IconButton, textareaClass } from '../ui/Field';
import { Markdown } from '../ui/Markdown';
import { TASK_STATUS_OPTIONS } from './sections/TasksSection';

const propSelect =
  'h-10 pointer-fine:h-8 w-full pl-2 pr-7 bg-transparent border border-transparent hover:border-line rounded-md text-base pointer-fine:text-sm text-fg focus:outline-none focus:border-accent';

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-2 min-h-9">
    <span className="text-[13px] text-fg-faint">{label}</span>
    <div className="min-w-0">{children}</div>
  </div>
);

const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g;

/** Comment text with @mentions highlighted and links clickable. Built as React nodes, never HTML. */
const CommentText: React.FC<{ text: string; mentionNames: string[] }> = ({ text, mentionNames }) => {
  const escaped = mentionNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const splitter = escaped.length ? new RegExp(`(@(?:${escaped.join('|')}))`, 'g') : null;
  const parts = splitter ? text.split(splitter) : [text];
  return (
    <div className="text-sm text-fg leading-relaxed whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        splitter && mentionNames.some((n) => part === `@${n}`) ? (
          <span key={i} className="px-0.5 rounded bg-accent-soft text-accent-ink font-medium">
            {part}
          </span>
        ) : (
          part.split(URL_PATTERN).map((piece, j) =>
            /^https?:\/\//.test(piece) ? (
              <a key={`${i}-${j}`} href={piece} target="_blank" rel="noopener noreferrer" className="text-accent-ink underline underline-offset-2 break-all">
                {piece}
              </a>
            ) : (
              <React.Fragment key={`${i}-${j}`}>{piece}</React.Fragment>
            )
          )
        )
      )}
    </div>
  );
};

/** Comment box with @mention suggestions from the project team. */
const MentionInput: React.FC<{
  people: User[];
  initial?: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (text: string, mentions: string[]) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
}> = ({ people, initial = '', placeholder, submitLabel, onSubmit, onCancel, autoFocus }) => {
  const [text, setText] = useState(initial);
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const suggestions = query === null ? [] : people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  // An @ at the start or after a space opens suggestions for the text typed after it
  const detect = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at === -1 || (at > 0 && !/\s/.test(before[at - 1]))) return setQuery(null);
    const q = before.slice(at + 1);
    if (q.length > 30 || q.includes('\n')) return setQuery(null);
    setQuery(q);
    setHighlight(0);
  };

  const choose = (person: User) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const at = text.slice(0, caret).lastIndexOf('@');
    const next = `${text.slice(0, at)}@${person.name} ${text.slice(caret)}`;
    setText(next);
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = at + person.name.length + 2;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const mentions = people.filter((p) => value.includes(`@${p.name}`)).map((p) => p.id);
      await onSubmit(value, mentions);
      setText('');
    } catch {
      // The caller already showed the error; keep the text so nothing is lost
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        rows={3}
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (suggestions.length) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => (h + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              choose(suggestions[highlight]);
              return;
            }
            if (e.key === 'Escape') {
              e.stopPropagation();
              setQuery(null);
              return;
            }
          }
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        className={`${textareaClass} resize-y`}
      />
      {suggestions.length > 0 && (
        <ul role="listbox" aria-label="People to mention" className="absolute left-0 bottom-full mb-1 z-10 w-64 bg-surface border border-line rounded-lg shadow-[0_8px_28px_rgb(0_0_0/0.14)] p-1">
          {suggestions.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              className={`flex items-center gap-2 h-8 px-2 rounded-md cursor-pointer text-sm ${i === highlight ? 'bg-hover' : ''}`}
            >
              <Avatar src={p.avatar} name={p.name} size={18} />
              <span className="truncate text-fg">{p.name}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <span className="text-xs text-fg-faint">Type @ to mention someone · Ctrl+Enter to send</span>
        <div className="flex gap-1.5">
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={submit} disabled={!text.trim() || busy}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

export const TaskPanel: React.FC<{ taskId: string; onClose: () => void }> = ({ taskId, onClose }) => {
  const { currentUser, allEmployees, subscribe, showToast, confirm } = useApp();
  const { projectId, project, tasks, teamMembers, updateTask, deleteTask, canManage } = useProject();
  const task = tasks.find((t) => t.id === taskId);
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehavior(true, onClose, ref);

  const [title, setTitle] = useState(task?.title ?? '');
  const [editingDescription, setEditingDescription] = useState(false);
  const [description, setDescription] = useState('');
  const [newItem, setNewItem] = useState('');
  const [newTag, setNewTag] = useState('');
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [editingComment, setEditingComment] = useState<string | null>(null);

  useEffect(() => setTitle(task?.title ?? ''), [task?.title]);

  const base = `/api/projects/${projectId}/tasks/${taskId}/comments`;
  const loadComments = useCallback(() => {
    api.get<TaskComment[]>(base).then(setComments).catch(() => {});
  }, [base]);

  useEffect(() => loadComments(), [loadComments]);

  // Comments from teammates arrive live
  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'reconnected' || (event.type === 'project-updated' && event.projectId === projectId && event.resource === 'tasks')) loadComments();
      }),
    [subscribe, projectId, loadComments]
  );

  const nameById = useMemo(() => new Map(allEmployees.map((u) => [u.id, u.name])), [allEmployees]);

  if (!task) {
    return (
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Task" className="fixed inset-y-0 right-0 z-40 w-full sm:w-[560px] bg-surface border-l border-line shadow-[0_0_40px_rgb(0_0_0/0.12)] flex flex-col">
        <div className="h-12 px-4 flex items-center justify-end border-b border-line">
          <IconButton label="Close task" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="flex-1 flex items-center justify-center text-sm text-fg-muted px-6 text-center">This task doesn't exist any more, or was moved.</div>
      </div>
    );
  }

  const patch = (p: Partial<Task>) => updateTask(task, p);
  const overdue = isOverdue(task.dueDate, task.status === 'done');
  const doneItems = task.subtasks.filter((s) => s.completed).length;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('Link to this task copied', 'success');
    } catch {
      showToast('Could not copy the link', 'error');
    }
  };

  const saveTitle = () => {
    const t = title.trim();
    if (!t) return setTitle(task.title);
    if (t !== task.title) patch({ title: t });
  };

  const addItem = () => {
    if (!newItem.trim()) return;
    patch({ subtasks: [...task.subtasks, { id: `sub-${Date.now()}`, title: newItem.trim(), completed: false }] });
    setNewItem('');
  };

  const addTag = () => {
    const tags = newTag.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
    if (tags.length) patch({ tags: [...new Set([...task.tags, ...tags])] });
    setNewTag('');
  };

  const postComment = async (text: string, mentions: string[]) => {
    try {
      const c = await api.post<TaskComment>(base, { text, mentions });
      setComments((list) => [...list, c]);
    } catch (err: any) {
      showToast(err.message || 'Could not post the comment', 'error');
      throw err;
    }
  };

  const saveComment = async (id: string, text: string, mentions: string[]) => {
    try {
      const c = await api.put<TaskComment>(`${base}/${id}`, { text, mentions });
      setComments((list) => list.map((x) => (x.id === id ? c : x)));
      setEditingComment(null);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const removeComment = async (c: TaskComment) => {
    const ok = await confirm({ title: 'Delete comment?', message: 'This comment will be removed for everyone.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.delete(`${base}/${c.id}`);
      setComments((list) => list.filter((x) => x.id !== c.id));
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-30 bg-overlay/40 sm:bg-transparent" onMouseDown={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-panel-title"
        tabIndex={-1}
        className="fixed inset-y-0 right-0 z-40 w-full sm:w-[580px] bg-surface border-l border-line shadow-[0_0_40px_rgb(0_0_0/0.12)] flex flex-col animate-fade-in focus:outline-none"
      >
        <div className="h-12 shrink-0 px-4 flex items-center justify-between gap-2 border-b border-line">
          <span className="text-[13px] text-fg-faint truncate">
            <span className="font-mono">{project.code}</span> · Task
          </span>
          <div className="flex items-center gap-0.5">
            <button onClick={copyLink} className="h-10 pointer-fine:h-7 px-2.5 pointer-fine:px-2 flex items-center gap-1.5 rounded-md text-[13px] text-fg-muted hover:bg-hover hover:text-fg">
              <LinkIcon size={14} /> Copy link
            </button>
            <IconButton
              label="Delete task"
              danger
              onClick={() => {
                onClose();
                deleteTask(task);
              }}
            >
              <Trash2 size={15} />
            </IconButton>
            <IconButton label="Close task (Esc)" onClick={onClose}>
              <X size={16} />
            </IconButton>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-6" style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>
          <textarea
            id="task-panel-title"
            rows={1}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            aria-label="Task title"
            className="w-full resize-none bg-transparent text-lg sm:text-xl font-semibold text-fg leading-snug focus:outline-none [field-sizing:content]"
          />

          <div className="space-y-0.5">
            <Row label="Status">
              <select aria-label="Status" className={propSelect} value={task.status} onChange={(e) => patch({ status: e.target.value as Task['status'] })}>
                {TASK_STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Assignee">
              <select aria-label="Assignee" className={propSelect} value={task.assigneeId} onChange={(e) => patch({ assigneeId: e.target.value })}>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Due date">
              <input
                type="date"
                aria-label="Due date"
                value={task.dueDate}
                onChange={(e) => e.target.value && patch({ dueDate: e.target.value })}
                className={`${propSelect} pr-2 ${overdue ? 'text-tone-red-fg' : ''}`}
              />
            </Row>
            <Row label="Priority">
              <select aria-label="Priority" className={propSelect} value={task.priority} onChange={(e) => patch({ priority: e.target.value as Task['priority'] })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </Row>
            <Row label="Tags">
              <div className="flex flex-wrap items-center gap-1 py-1">
                {task.tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-0.5 h-6 pl-2 pr-0.5 rounded bg-tone-gray-bg text-[13px] text-tone-gray-fg">
                    {t}
                    <button onClick={() => patch({ tags: task.tags.filter((x) => x !== t) })} className="w-8 h-8 -my-1.5 -mr-1 pointer-fine:w-5 pointer-fine:h-5 pointer-fine:my-0 pointer-fine:mr-0 flex items-center justify-center rounded hover:bg-selected" aria-label={`Remove tag ${t}`}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  onBlur={addTag}
                  placeholder={task.tags.length ? 'Add…' : 'Add a tag'}
                  aria-label="Add a tag"
                  className="h-10 pointer-fine:h-6 w-28 px-1 bg-transparent text-base pointer-fine:text-[13px] text-fg placeholder:text-fg-faint focus:outline-none"
                />
              </div>
            </Row>
            <Row label="Created">
              <span className="text-[13px] text-fg-muted">{formatDate(task.createdAt)}</span>
            </Row>
          </div>

          <section aria-labelledby="desc-heading">
            <div className="flex items-center justify-between mb-1.5">
              <h3 id="desc-heading" className="text-[13px] font-medium text-fg-muted">
                Description
              </h3>
              {!editingDescription && (
                <button
                  onClick={() => {
                    setDescription(task.description);
                    setEditingDescription(true);
                  }}
                  className="h-10 pointer-fine:h-7 px-2.5 pointer-fine:px-2 flex items-center gap-1.5 rounded-md text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
                >
                  <Pencil size={13} /> Edit
                </button>
              )}
            </div>
            {editingDescription ? (
              <div className="space-y-2">
                <textarea
                  autoFocus
                  rows={6}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      patch({ description });
                      setEditingDescription(false);
                    }
                  }}
                  className={`${textareaClass} font-mono text-[13px]`}
                  placeholder="Details, acceptance criteria, links… Markdown supported."
                  aria-label="Description"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditingDescription(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      patch({ description });
                      setEditingDescription(false);
                    }}
                  >
                    Save
                  </Button>
                </div>
              </div>
            ) : task.description.trim() ? (
              <Markdown source={task.description} className="text-sm" />
            ) : (
              <p className="text-sm text-fg-faint">No description.</p>
            )}
          </section>

          <section aria-labelledby="checklist-heading">
            <h3 id="checklist-heading" className="text-[13px] font-medium text-fg-muted mb-1.5">
              Checklist {task.subtasks.length > 0 && <span className="text-fg-faint font-normal">{doneItems}/{task.subtasks.length}</span>}
            </h3>
            {task.subtasks.length > 0 && (
              <div className="h-1 rounded-full bg-hover overflow-hidden mb-2" aria-hidden="true">
                <div className="h-full bg-accent transition-all" style={{ width: `${(doneItems / task.subtasks.length) * 100}%` }} />
              </div>
            )}
            <ul className="space-y-px">
              {task.subtasks.map((s) => (
                <li key={s.id} className="group flex items-center gap-2 h-11 pointer-fine:h-8 px-1 rounded hover:bg-subtle">
                  <button
                    role="checkbox"
                    aria-checked={s.completed}
                    aria-label={s.title}
                    onClick={() => patch({ subtasks: task.subtasks.map((x) => (x.id === s.id ? { ...x, completed: !x.completed } : x)) })}
                    className={`w-[18px] h-[18px] pointer-fine:w-4 pointer-fine:h-4 shrink-0 rounded-[4px] border flex items-center justify-center outline-offset-[10px] pointer-fine:outline-offset-1 relative before:absolute before:-inset-3 pointer-fine:before:hidden ${s.completed ? 'bg-accent border-accent text-on-accent' : 'border-line-strong bg-surface'}`}
                  >
                    {s.completed && <Check size={11} strokeWidth={3} />}
                  </button>
                  <span className={`flex-1 text-sm ${s.completed ? 'line-through text-fg-faint' : 'text-fg'}`}>{s.title}</span>
                  <IconButton
                    label={`Remove “${s.title}”`}
                    danger
                    onClick={() => patch({ subtasks: task.subtasks.filter((x) => x.id !== s.id) })}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                  >
                    <X size={13} />
                  </IconButton>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2 h-11 pointer-fine:h-8 px-1">
              <Plus size={14} className="text-fg-faint shrink-0" />
              <input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addItem()}
                placeholder="Add an item"
                aria-label="Add a checklist item"
                className="flex-1 h-full bg-transparent text-sm text-fg placeholder:text-fg-faint focus:outline-none"
              />
            </div>
          </section>

          <section aria-labelledby="comments-heading" className="pt-5 border-t border-line">
            <h3 id="comments-heading" className="text-[13px] font-medium text-fg-muted mb-3">
              Comments {comments.length > 0 && <span className="text-fg-faint font-normal">{comments.length}</span>}
            </h3>
            <ul className="space-y-4 mb-4">
              {comments.map((c) => {
                const mine = c.authorId === currentUser?.id;
                return (
                  <li key={c.id} className="group flex gap-3">
                    <Avatar src={c.authorAvatar} name={c.authorName} size={26} className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-fg">{mine ? 'You' : c.authorName}</span>
                        <time className="text-xs text-fg-faint" dateTime={c.createdAt} title={new Date(c.createdAt).toLocaleString()}>
                          {timeAgo(c.createdAt)}
                          {c.editedAt && ' · edited'}
                        </time>
                        {(mine || canManage) && editingComment !== c.id && (
                          <span className="ml-auto flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                            {mine && (
                              <IconButton label="Edit comment" onClick={() => setEditingComment(c.id)}>
                                <Pencil size={13} />
                              </IconButton>
                            )}
                            <IconButton label="Delete comment" danger onClick={() => removeComment(c)}>
                              <Trash2 size={13} />
                            </IconButton>
                          </span>
                        )}
                      </div>
                      {editingComment === c.id ? (
                        <div className="mt-1">
                          <MentionInput
                            people={teamMembers}
                            initial={c.text}
                            placeholder="Edit comment"
                            submitLabel="Save"
                            autoFocus
                            onCancel={() => setEditingComment(null)}
                            onSubmit={(text, mentions) => saveComment(c.id, text, mentions)}
                          />
                        </div>
                      ) : (
                        <CommentText text={c.text} mentionNames={c.mentions.map((id) => nameById.get(id)).filter((n): n is string => !!n)} />
                      )}
                    </div>
                  </li>
                );
              })}
              {comments.length === 0 && <li className="text-sm text-fg-faint">No comments yet. Ask a question or share an update.</li>}
            </ul>
            <MentionInput people={teamMembers.filter((m) => m.id !== currentUser?.id)} placeholder="Write a comment" submitLabel="Comment" onSubmit={postComment} />
          </section>
        </div>
      </div>
    </>
  );
};
