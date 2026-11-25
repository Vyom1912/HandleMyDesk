import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Task } from '../../../../types';
import { useProject } from '../ProjectContext';
import { Button } from '../../ui/Field';
import { DOT } from '../../ui/Badges';

type CalendarItem =
  | { kind: 'task'; date: string; title: string; done: boolean; task: Task }
  | { kind: 'milestone' | 'deliverable' | 'deadline'; date: string; title: string; done: boolean };

const KIND_STYLE: Record<CalendarItem['kind'], string> = {
  task: 'bg-tone-gray-bg text-tone-gray-fg',
  milestone: 'bg-tone-blue-bg text-tone-blue-fg',
  deliverable: 'bg-tone-green-bg text-tone-green-fg',
  deadline: 'bg-tone-red-bg text-tone-red-fg',
};

const KIND_TONE: Record<CalendarItem['kind'], keyof typeof DOT> = { task: 'gray', milestone: 'blue', deliverable: 'green', deadline: 'red' };

const KIND_LABEL: Record<CalendarItem['kind'], string> = {
  task: 'Task due',
  milestone: 'Milestone',
  deliverable: 'Deliverable due',
  deadline: 'Project target date',
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const CalendarSection: React.FC = () => {
  const { project, tasks, milestones, deliverables, openTaskEditor } = useProject();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const todayIso = iso(new Date());

  const itemsByDate = useMemo(() => {
    const items: CalendarItem[] = [
      { kind: 'deadline' as const, date: project.targetDate, title: 'Project target date', done: project.status === 'completed' },
      ...milestones.map((m) => ({ kind: 'milestone' as const, date: m.targetDate, title: m.title, done: m.status === 'completed' })),
      ...deliverables.map((d) => ({ kind: 'deliverable' as const, date: d.dueDate, title: d.title, done: d.status === 'approved' })),
      ...tasks.map((t) => ({ kind: 'task' as const, date: t.dueDate, title: t.title, done: t.status === 'done', task: t })),
    ];
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      if (!item.date) continue;
      map.set(item.date, [...(map.get(item.date) ?? []), item]);
    }
    return map;
  }, [tasks, milestones, deliverables, project]);

  // Monday-first grid covering the whole month
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, i) => new Date(year, month, i - offset + 1));
  const monthDays = cells.filter((d) => d.getMonth() === month);

  const shift = (delta: number) => setCursor(new Date(year, month + delta, 1));

  const renderItem = (item: CalendarItem, i: number, compact: boolean) => {
    const cls = `block w-full text-left truncate rounded px-1.5 ${compact ? 'h-5 leading-5 text-xs' : 'py-1 text-[13px]'} ${KIND_STYLE[item.kind]} ${item.done ? 'line-through opacity-60' : ''}`;
    const text = `${KIND_LABEL[item.kind]}: ${item.title}`;
    return item.kind === 'task' ? (
      <button key={`t-${item.task.id}`} onClick={() => openTaskEditor(item.task)} className={`${cls} hover:brightness-95`} title={text}>
        {item.title}
      </button>
    ) : (
      <span key={`${item.kind}-${i}`} className={cls} title={text}>
        {item.title}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <h2 className="text-base font-semibold text-fg w-40" aria-live="polite">
            {cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h2>
          <button onClick={() => shift(-1)} className="w-7 h-7 flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-hover" aria-label="Previous month">
            <ChevronLeft size={16} />
          </button>
          <Button variant="secondary" size="sm" onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
            Today
          </Button>
          <button onClick={() => shift(1)} className="w-7 h-7 flex items-center justify-center rounded-md text-fg-muted hover:text-fg hover:bg-hover" aria-label="Next month">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-fg-muted">
          {(Object.keys(KIND_LABEL) as CalendarItem['kind'][]).map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${DOT[KIND_TONE[k]]}`} aria-hidden="true" />
              {KIND_LABEL[k]}
            </span>
          ))}
        </div>
      </div>

      {/* Month grid on larger screens */}
      <div className="hidden md:block border border-line rounded-lg overflow-hidden">
        <div className="grid grid-cols-7 border-b border-line bg-subtle">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 h-8 flex items-center text-xs font-medium text-fg-faint">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d) => {
            const key = iso(d);
            const inMonth = d.getMonth() === month;
            const weekend = d.getDay() === 0 || d.getDay() === 6;
            const items = itemsByDate.get(key) ?? [];
            return (
              <div key={key} className={`group min-h-[112px] p-1 border-r border-b border-line [&:nth-child(7n)]:border-r-0 ${!inMonth ? 'bg-subtle' : weekend ? 'bg-subtle/50' : ''}`}>
                <div className="flex items-center justify-between h-6 mb-0.5">
                  <span
                    className={`text-xs min-w-6 h-6 px-1 flex items-center justify-center rounded-full tabular-nums ${
                      key === todayIso ? 'bg-accent text-on-accent font-semibold' : inMonth ? 'text-fg-muted' : 'text-fg-faint'
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  {inMonth && (
                    <button
                      onClick={() => openTaskEditor(undefined, { dueDate: key })}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-5 h-5 flex items-center justify-center rounded text-fg-faint hover:text-fg hover:bg-hover"
                      aria-label={`Add task due ${d.toLocaleDateString()}`}
                    >
                      <Plus size={12} />
                    </button>
                  )}
                </div>
                <div className="space-y-0.5">
                  {items.slice(0, 3).map((item, i) => renderItem(item, i, true))}
                  {items.length > 3 && <span className="block text-xs text-fg-faint px-1.5">+{items.length - 3} more</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Agenda list on phones */}
      <ul className="md:hidden space-y-4">
        {monthDays.filter((d) => itemsByDate.has(iso(d))).length === 0 && <li className="text-sm text-fg-muted py-8 text-center">Nothing scheduled this month.</li>}
        {monthDays
          .filter((d) => itemsByDate.has(iso(d)))
          .map((d) => (
            <li key={iso(d)}>
              <div className={`text-[13px] font-medium mb-1.5 ${iso(d) === todayIso ? 'text-accent-ink' : 'text-fg-muted'}`}>
                {d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
              <div className="space-y-1">{itemsByDate.get(iso(d))!.map((item, i) => renderItem(item, i, false))}</div>
            </li>
          ))}
      </ul>
    </div>
  );
};
