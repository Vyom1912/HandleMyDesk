import React, { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Task, TaskSubtask } from '../../../types';
import { api } from '../../services/api';
import { useApp } from '../../context/AppContext';
import { useProject } from './ProjectContext';
import { Modal, useDirty } from '../ui/Modal';
import { Field, inputClass, selectClass, textareaClass, Button, IconButton } from '../ui/Field';
import { TASK_STATUS_OPTIONS } from './sections/TasksSection';

interface Props {
  open: boolean;
  task?: Task;
  defaults?: Partial<Task>;
  onClose: () => void;
}

const inAWeek = () => new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

export const TaskEditorModal: React.FC<Props> = ({ open, task, defaults, onClose }) => {
  const { currentUser, showToast } = useApp();
  const { projectId, teamMembers, setTasks, updateTask, deleteTask, reload } = useProject();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<Task['status']>('todo');
  const [priority, setPriority] = useState<Task['priority']>('medium');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState(inAWeek());
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [subtasks, setSubtasks] = useState<TaskSubtask[]>([]);
  const [subtaskInput, setSubtaskInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = useDirty({ title, description, status, priority, assigneeId, dueDate, tags, subtasks, tagInput, subtaskInput }, open);

  useEffect(() => {
    if (!open) return;
    const source = { ...defaults, ...task };
    setTitle(source.title ?? '');
    setDescription(source.description ?? '');
    setStatus(source.status ?? 'todo');
    setPriority(source.priority ?? 'medium');
    setAssigneeId(source.assigneeId ?? (teamMembers.some((m) => m.id === currentUser?.id) ? currentUser!.id : teamMembers[0]?.id ?? ''));
    setDueDate(source.dueDate ?? inAWeek());
    setTags(source.tags ?? []);
    setSubtasks(source.subtasks ?? []);
    setTagInput('');
    setSubtaskInput('');
    setError(null);
  }, [open, task, defaults, teamMembers, currentUser]);

  const addTag = () => {
    const parts = tagInput.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
    if (parts.length) setTags((prev) => [...new Set([...prev, ...parts])]);
    setTagInput('');
  };

  const addSubtask = () => {
    if (!subtaskInput.trim()) return;
    setSubtasks((prev) => [...prev, { id: `sub-${Date.now()}`, title: subtaskInput.trim(), completed: false }]);
    setSubtaskInput('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('Give the task a title');
    setError(null);
    // Include anything still typed in the tag/subtask boxes
    const pendingTags = tagInput.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean);
    const payload = {
      title: title.trim(),
      description,
      status,
      priority,
      assigneeId,
      dueDate,
      tags: [...new Set([...tags, ...pendingTags])],
      subtasks: subtaskInput.trim() ? [...subtasks, { id: `sub-${Date.now()}`, title: subtaskInput.trim(), completed: false }] : subtasks,
    };

    setSaving(true);
    try {
      if (task) {
        await updateTask(task, payload);
      } else {
        const created = await api.post<Task>(`/api/projects/${projectId}/tasks`, payload);
        setTasks((list) => [created, ...list]);
        reload('project', 'activity').catch(() => {});
        showToast('Task created', 'success');
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save task');
    } finally {
      setSaving(false);
    }
  };

  const doneCount = subtasks.filter((s) => s.completed).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      dirty={dirty && !saving}
      title={task ? 'Edit task' : 'New task'}
      size="lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div>
            {task && (
              <Button
                variant="ghost"
                className="text-tone-red-fg hover:text-tone-red-fg hover:bg-tone-red-bg"
                onClick={() => {
                  onClose();
                  deleteTask(task);
                }}
              >
                <Trash2 size={14} /> Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="task-editor-form" disabled={saving}>
              {saving ? 'Saving…' : task ? 'Save changes' : 'Create task'}
            </Button>
          </div>
        </div>
      }
    >
      <form id="task-editor-form" onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-tone-red-fg">
            {error}
          </p>
        )}
        <input
          data-autofocus
          aria-label="Task title"
          className="w-full text-lg font-semibold text-fg bg-transparent placeholder:text-fg-faint focus:outline-none"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
          maxLength={300}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Status">
            <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as Task['status'])}>
              {TASK_STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select className={selectClass} value={priority} onChange={(e) => setPriority(e.target.value as Task['priority'])}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </Field>
          <Field label="Assignee">
            <select className={selectClass} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <input type="date" className={inputClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>

        <Field label="Description">
          <textarea rows={4} className={textareaClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details, acceptance criteria, links…" />
        </Field>

        <div>
          <Field label="Tags" hint="Press Enter or comma to add">
            <input
              className={inputClass}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="e.g. frontend, api"
            />
          </Field>
          {tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 mt-2" aria-label="Tags">
              {tags.map((t) => (
                <li key={t} className="flex items-center gap-0.5 h-6 pl-2 pr-0.5 rounded bg-tone-gray-bg text-[13px] text-tone-gray-fg">
                  {t}
                  <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} className="w-5 h-5 flex items-center justify-center rounded hover:bg-selected" aria-label={`Remove tag ${t}`}>
                    <X size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <fieldset>
          <legend className="block text-[13px] font-medium text-fg-muted mb-1.5">
            Checklist {subtasks.length > 0 && <span className="text-fg-faint font-normal">{doneCount}/{subtasks.length}</span>}
          </legend>
          <ul className="space-y-0.5">
            {subtasks.map((s) => (
              <li key={s.id} className="group flex items-center gap-2 h-8 px-1 rounded hover:bg-subtle">
                <input
                  type="checkbox"
                  checked={s.completed}
                  onChange={() => setSubtasks(subtasks.map((x) => (x.id === s.id ? { ...x, completed: !x.completed } : x)))}
                  className="w-4 h-4 accent-[var(--accent)]"
                  aria-label={s.title}
                />
                <input
                  className={`flex-1 bg-transparent text-sm focus:outline-none ${s.completed ? 'line-through text-fg-faint' : 'text-fg'}`}
                  value={s.title}
                  onChange={(e) => setSubtasks(subtasks.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)))}
                  aria-label="Checklist item"
                />
                <IconButton label={`Remove “${s.title}”`} danger onClick={() => setSubtasks(subtasks.filter((x) => x.id !== s.id))} className="opacity-0 group-hover:opacity-100 focus:opacity-100">
                  <X size={13} />
                </IconButton>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 mt-1.5">
            <input
              className={inputClass}
              value={subtaskInput}
              onChange={(e) => setSubtaskInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSubtask();
                }
              }}
              placeholder="Add an item and press Enter"
              aria-label="New checklist item"
            />
            <Button variant="secondary" className="h-9" onClick={addSubtask} aria-label="Add checklist item">
              <Plus size={14} />
            </Button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
};
