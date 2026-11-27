import React, { useState } from 'react';
import { Plus, Star, Download } from 'lucide-react';
import { downloadCsv } from '../../services/exports';
import { useApp } from '../../context/AppContext';
import { Avatar, StatusBadge, formatDate, isOverdue } from '../ui/Badges';
import { Button, SearchInput, Segmented, toolbarSelectClass } from '../ui/Field';
import { PageShell } from '../layout/PageShell';

type Scope = 'all' | 'mine' | 'lead';
type SortKey = 'name' | 'due' | 'progress' | 'updated';

export const ProjectDirectoryView: React.FC = () => {
  const { currentUser, projects, favoriteIds, toggleFavorite, openProject, setIsCreateProjectOpen, showToast } = useApp();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [scope, setScope] = useState<Scope>('all');
  const [sort, setSort] = useState<SortKey>('name');

  const canCreate = currentUser?.role === 'admin' || currentUser?.role === 'pm';
  const q = search.toLowerCase();
  const visible = projects
    .filter((p) => (statusFilter === 'all' ? true : statusFilter === 'open' ? p.status === 'active' || p.status === 'on_hold' : p.status === statusFilter))
    .filter((p) => scope === 'all' || (scope === 'lead' ? p.leadId === currentUser?.id : p.leadId === currentUser?.id || p.teamMemberIds.includes(currentUser?.id ?? '')))
    .filter((p) => !q || [p.name, p.code, p.clientName, p.category, p.leadName].some((v) => v.toLowerCase().includes(q)))
    .sort((a, b) => {
      if (sort === 'due') return a.targetDate.localeCompare(b.targetDate);
      if (sort === 'progress') return b.completionPercentage - a.completionPercentage;
      if (sort === 'updated') return b.updatedAt.localeCompare(a.updatedAt);
      return a.name.localeCompare(b.name);
    });

  const scopes: Array<{ value: Scope; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'mine', label: "I'm on" },
    ...(currentUser?.role !== 'member' ? [{ value: 'lead' as const, label: 'I lead' }] : []),
  ];

  return (
    <PageShell
      title="All projects"
      description={`${projects.length} projects you can access`}
      actions={
        <>
          <Button variant="secondary" className="touch-hidden" onClick={() => downloadCsv('/api/projects/export.csv', 'projects').catch((err) => showToast(err.message, 'error'))} title="All projects you can see, as a spreadsheet">
            <Download size={15} /> Export CSV
          </Button>
          {canCreate && (
            <Button onClick={() => setIsCreateProjectOpen(true)}>
              <Plus size={15} /> New project
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by name, code, client or lead" label="Search projects" className="w-full sm:w-72" />
        <Segmented label="Scope" value={scope} onChange={setScope} options={scopes} />
        <select aria-label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={toolbarSelectClass}>
          <option value="open">Active & on hold</option>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="on_hold">On hold</option>
          <option value="completed">Completed</option>
          {currentUser?.role !== 'member' && <option value="archived">Archived</option>}
        </select>
        <select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={`${toolbarSelectClass} sm:ml-auto`}>
          <option value="name">Sort: Name</option>
          <option value="due">Sort: Target date</option>
          <option value="progress">Sort: Progress</option>
          <option value="updated">Sort: Last updated</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="py-16 px-6 text-center text-sm text-fg-muted border border-dashed border-line-strong rounded-lg">
          {projects.length === 0
            ? canCreate
              ? 'No projects yet. Create the first one with New project.'
              : "You're not on any project yet. When a project manager adds you to one, it appears here and in the sidebar."
            : 'No projects match these filters.'}
        </div>
      ) : (
        <div className="border border-line rounded-lg overflow-hidden">
          <div className="hidden lg:grid grid-cols-[28px_minmax(0,1fr)_150px_110px_160px_100px_90px] gap-3 px-3 h-8 items-center bg-subtle border-b border-line text-xs font-medium text-fg-faint">
            <span aria-hidden="true" />
            <span>Project</span>
            <span>Client</span>
            <span>Status</span>
            <span>Lead</span>
            <span>Target</span>
            <span>Progress</span>
          </div>
          <ul className="divide-y divide-line">
            {visible.map((p) => {
              const fav = favoriteIds.includes(p.id);
              const late = isOverdue(p.targetDate, p.status === 'completed' || p.status === 'archived');
              return (
                <li key={p.id} className="group grid grid-cols-[28px_minmax(0,1fr)_auto] lg:grid-cols-[28px_minmax(0,1fr)_150px_110px_160px_100px_90px] gap-x-3 gap-y-1 px-3 py-2.5 items-center hover:bg-subtle">
                  <button
                    onClick={() => toggleFavorite(p.id)}
                    className={`w-10 h-10 -m-2 pointer-fine:w-6 pointer-fine:h-6 pointer-fine:m-0 flex items-center justify-center rounded hover:bg-hover ${fav ? 'text-tone-amber-fg' : 'text-fg-faint opacity-40 group-hover:opacity-100 focus:opacity-100'}`}
                    aria-label={fav ? `Remove ${p.name} from favorites` : `Add ${p.name} to favorites`}
                    aria-pressed={fav}
                  >
                    <Star size={14} fill={fav ? 'currentColor' : 'none'} />
                  </button>
                  <button onClick={() => openProject(p.id)} className="min-w-0 text-left">
                    <span className="block text-sm font-medium text-fg truncate hover:underline underline-offset-2">{p.name}</span>
                    <span className="block text-xs text-fg-faint truncate">
                      <span className="font-mono">{p.code}</span> · {p.category}
                      <span className="lg:hidden"> · {p.clientName}</span>
                    </span>
                  </button>
                  <span className="hidden lg:block text-meta text-fg-muted truncate">{p.clientName}</span>
                  <span className="justify-self-end lg:justify-self-start">
                    <StatusBadge status={p.status} />
                  </span>
                  <span className="hidden lg:flex items-center gap-1.5 min-w-0 text-meta text-fg-muted">
                    <Avatar src={p.leadAvatar} name={p.leadName} size={18} />
                    <span className="truncate">{p.leadName}</span>
                  </span>
                  <span className={`hidden lg:block text-meta tabular-nums ${late ? 'text-tone-red-fg' : 'text-fg-muted'}`}>{formatDate(p.targetDate)}</span>
                  <span className="hidden lg:flex items-center gap-2">
                    <span className="flex-1 h-1 rounded-full bg-hover overflow-hidden" aria-hidden="true">
                      <span className="block h-full bg-accent" style={{ width: `${p.completionPercentage}%` }} />
                    </span>
                    <span className="text-xs text-fg-faint tabular-nums w-8 text-right">{p.completionPercentage}%</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </PageShell>
  );
};
