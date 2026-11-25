import React, { useState } from 'react';
import { useProject } from '../ProjectContext';
import { Avatar, formatDateTime } from '../../ui/Badges';
import { EmptyState, Segmented } from '../../ui/Field';
import { ProjectActivity } from '../../../../types';

type Filter = 'all' | ProjectActivity['type'];

const TYPES: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'task', label: 'Tasks' },
  { value: 'milestone', label: 'Milestones' },
  { value: 'file', label: 'Files' },
  { value: 'member', label: 'Team' },
  { value: 'status', label: 'Status' },
];

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export const ActivitySection: React.FC = () => {
  const { activities, activityHasMore, loadMoreActivity } = useProject();
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<Filter>('all');
  const visible = type === 'all' ? activities : activities.filter((a) => a.type === type);
  let lastDay = '';

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="overflow-x-auto no-scrollbar">
        <Segmented label="Filter activity" value={type} onChange={setType} options={TYPES} />
      </div>

      {visible.length === 0 ? (
        <EmptyState message="No activity to show." />
      ) : (
        <ol>
          {visible.map((act) => {
            const day = dayLabel(act.timestamp);
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <React.Fragment key={act.id}>
                {showDay && <li className="text-xs font-medium text-fg-faint pt-4 pb-1.5 first:pt-0">{day}</li>}
                <li className="flex items-start gap-2.5 py-1.5 text-sm">
                  <Avatar src={act.userAvatar} name={act.userName} size={20} className="mt-px" />
                  <span className="flex-1 min-w-0 text-fg-muted">
                    <span className="font-medium text-fg">{act.userName}</span> {act.action}
                  </span>
                  <time dateTime={act.timestamp} className="text-xs text-fg-faint whitespace-nowrap">
                    {formatDateTime(act.timestamp).split(', ').pop()}
                  </time>
                </li>
              </React.Fragment>
            );
          })}
        </ol>
      )}
      {activityHasMore && type === 'all' && (
        <button
          onClick={() => {
            setLoading(true);
            loadMoreActivity().finally(() => setLoading(false));
          }}
          disabled={loading}
          className="h-8 px-3 rounded-md border border-line text-[13px] text-fg-muted hover:text-fg hover:bg-hover disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load older activity'}
        </button>
      )}
    </div>
  );
};
