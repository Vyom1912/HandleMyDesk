import React, { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Task } from '../../../types';
import { api } from '../../services/api';
import { Avatar, PriorityBadge, StatusBadge, formatDate, isOverdue } from '../ui/Badges';
import { SearchInput, Segmented, toolbarSelectClass } from '../ui/Field';
import { PageShell } from '../layout/PageShell';

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
const today = () => new Date().toISOString().split('T')[0];
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().split('T')[0];

// Group open work the way people plan their day
function bucketOf(t: Task): string {
  if (t.status === 'done') return 'Done';
  if (t.dueDate < today()) return 'Overdue';
  if (t.dueDate === today()) return 'Today';
  if (t.dueDate <= inDays(7)) return 'Next 7 days';
  return 'Later';
}
const BUCKETS = ['Overdue', 'Today', 'Next 7 days', 'Later', 'Done'];

export const GlobalTasksView: React.FC = () => {
  const { openProject, showToast } = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<'assigned_to_me' | 'all'>('assigned_to_me');
  const [statusFilter, setStatusFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (filter === 'assigned_to_me') params.set('filter', 'assigned_to_me');
    if (statusFilter !== 'all' && statusFilter !== 'open') params.set('status', statusFilter);
    setLoading(true);
    api
      .get<Task[]>(`/api/tasks/global?${params.toString()}`)
      .then((data) => !cancelled && setTasks(data))
      .catch((err) => !cancelled && showToast(err.message, 'error'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filter, statusFilter, showToast]);

  const toggle = async (task: Task) => {
    const nextStatus = task.status === 'done' ? 'todo' : 'done';
    setTasks((list) => list.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));
    try {
      await api.put(`/api/projects/${task.projectId}/tasks/${task.id}`, { status: nextStatus });
    } catch (err: any) {
      setTasks((list) => list.map((t) => (t.id === task.id ? task : t)));
      showToast(err.message || 'Failed to update task', 'error');
    }
  };

  const q = search.toLowerCase();
  const visible = tasks
    .filter((t) => statusFilter !== 'open' || t.status !== 'done')
    .filter((t) => !q || t.title.toLowerCase().includes(q) || (t.projectName ?? '').toLowerCase().includes(q))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);

  const groups = BUCKETS.map((b) => ({ name: b, items: visible.filter((t) => bucketOf(t) === b) })).filter((g) => g.items.length > 0);

  return (
    <PageShell title="My tasks" description="Your work across every project, by due date" width="narrow">
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Segmented
          label="Whose tasks"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'assigned_to_me', label: 'Assigned to me' },
            { value: 'all', label: 'Everyone' },
          ]}
        />
        <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={toolbarSelectClass}>
          <option value="open">Open</option>
          <option value="all">All statuses</option>
          <option value="backlog">Backlog</option>
          <option value="todo">To do</option>
          <option value="in_progress">In progress</option>
          <option value="in_review">In review</option>
          <option value="done">Done</option>
        </select>
        <SearchInput value={search} onChange={setSearch} placeholder="Search tasks or projects" label="Search tasks" className="w-full sm:w-64 sm:ml-auto" />
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-fg-muted" role="status">
          Loading tasks…
        </div>
      ) : groups.length === 0 ? (
        <div className="py-16 text-center text-sm text-fg-muted border border-dashed border-line-strong rounded-lg">No tasks here. Nice work.</div>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.name} aria-labelledby={`bucket-${g.name}`}>
              <h2 id={`bucket-${g.name}`} className={`text-[13px] font-medium mb-1.5 ${g.name === 'Overdue' ? 'text-tone-red-fg' : 'text-fg-muted'}`}>
                {g.name} <span className="text-fg-faint font-normal">{g.items.length}</span>
              </h2>
              <ul className="border border-line rounded-lg divide-y divide-line">
                {g.items.map((task) => (
                  <li key={task.id} className="flex items-center gap-3 px-3 py-2 hover:bg-subtle">
                    <button
                      onClick={() => toggle(task)}
                      role="checkbox"
                      aria-checked={task.status === 'done'}
                      aria-label={`Mark “${task.title}” as ${task.status === 'done' ? 'not done' : 'done'}`}
                      className={`w-4 h-4 shrink-0 rounded-[4px] border flex items-center justify-center ${
                        task.status === 'done' ? 'bg-accent border-accent text-on-accent' : 'border-line-strong hover:border-fg-faint bg-surface'
                      }`}
                    >
                      {task.status === 'done' && <Check size={11} strokeWidth={3} />}
                    </button>
                    <button onClick={() => openProject(task.projectId, 'tasks', task.id)} className="flex-1 min-w-0 text-left">
                      <span className={`block text-sm truncate ${task.status === 'done' ? 'line-through text-fg-faint' : 'text-fg'}`}>{task.title}</span>
                      <span className="block text-xs text-fg-faint truncate">
                        {task.projectName}
                        {filter === 'all' && ` · ${task.assigneeName}`}
                      </span>
                    </button>
                    <span className="hidden sm:block shrink-0">
                      <StatusBadge status={task.status} />
                    </span>
                    {filter === 'all' && <Avatar src={task.assigneeAvatar} name={task.assigneeName} size={20} />}
                    <span className={`text-[13px] tabular-nums w-14 text-right shrink-0 ${isOverdue(task.dueDate, task.status === 'done') ? 'text-tone-red-fg' : 'text-fg-muted'}`}>{formatDate(task.dueDate)}</span>
                    <span className="hidden sm:block shrink-0 w-16">
                      <PriorityBadge priority={task.priority} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </PageShell>
  );
};
