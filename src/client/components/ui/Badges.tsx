import React from 'react';

type Tone = 'gray' | 'blue' | 'green' | 'amber' | 'orange' | 'red';

const TONE: Record<Tone, string> = {
  gray: 'bg-tone-gray-bg text-tone-gray-fg',
  blue: 'bg-tone-blue-bg text-tone-blue-fg',
  green: 'bg-tone-green-bg text-tone-green-fg',
  amber: 'bg-tone-amber-bg text-tone-amber-fg',
  orange: 'bg-tone-orange-bg text-tone-orange-fg',
  red: 'bg-tone-red-bg text-tone-red-fg',
};

export const DOT: Record<Tone, string> = {
  gray: 'bg-tone-gray-fg',
  blue: 'bg-tone-blue-fg',
  green: 'bg-tone-green-fg',
  amber: 'bg-tone-amber-fg',
  orange: 'bg-tone-orange-fg',
  red: 'bg-tone-red-fg',
};

const PRIORITY_TONE: Record<string, Tone> = { urgent: 'red', high: 'orange', medium: 'blue', low: 'gray' };

const STATUS_TONE: Record<string, Tone> = {
  // projects
  active: 'green',
  on_hold: 'amber',
  completed: 'blue',
  archived: 'gray',
  // tasks
  backlog: 'gray',
  todo: 'gray',
  in_progress: 'blue',
  in_review: 'amber',
  done: 'green',
  // milestones & deliverables
  pending: 'gray',
  overdue: 'red',
  approved: 'green',
  rejected: 'red',
  // clients
  prospect: 'blue',
  inactive: 'gray',
};

export const STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
  on_hold: 'On hold',
  pm: 'Project manager',
};

export const label = (value: string) =>
  STATUS_LABELS[value] ?? value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export const statusTone = (status: string): Tone => STATUS_TONE[status] ?? 'gray';

export const Tag: React.FC<{ tone?: Tone; children: React.ReactNode; className?: string }> = ({ tone = 'gray', children, className = '' }) => (
  <span className={`inline-flex items-center h-5 px-1.5 rounded text-xs font-medium whitespace-nowrap ${TONE[tone]} ${className}`}>{children}</span>
);

export const PriorityBadge: React.FC<{ priority: string }> = ({ priority }) => <Tag tone={PRIORITY_TONE[priority] ?? 'gray'}>{label(priority)}</Tag>;

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => <Tag tone={statusTone(status)}>{label(status)}</Tag>;

export const StatusDot: React.FC<{ status: string; className?: string }> = ({ status, className = '' }) => (
  <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full shrink-0 ${DOT[statusTone(status)]} ${className}`} />
);

export function isOverdue(date: string, done: boolean): boolean {
  return !done && !!date && date < new Date().toISOString().split('T')[0];
}

export function formatDate(date: string): string {
  if (!date) return '';
  const d = new Date(date.length === 10 ? `${date}T00:00:00` : date);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

export const Avatar: React.FC<{ src?: string; name: string; size?: number; className?: string }> = ({ src, name, size = 24, className = '' }) => {
  const [failed, setFailed] = React.useState(false);
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.4) };
  if (!src || failed) {
    return (
      <span aria-hidden="true" style={style} className={`inline-flex items-center justify-center rounded-full bg-tone-gray-bg text-tone-gray-fg font-medium shrink-0 ${className}`}>
        {initials}
      </span>
    );
  }
  return <img src={src} alt="" style={style} onError={() => setFailed(true)} className={`rounded-full object-cover shrink-0 ${className}`} />;
};
