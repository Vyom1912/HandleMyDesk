import React, { useEffect, useState } from 'react';

/*
 * Grey placeholder shapes shown while something loads, in the layout it will have, so the page
 * doesn't jump and people can see something is coming.
 */

export const Bone: React.FC<{ className?: string }> = ({ className = '' }) => <div className={`skeleton ${className}`} aria-hidden="true" />;

/** True after `ms` milliseconds; for "this is taking longer than usual" notes. */
export function useTakingLong(ms = 4000): boolean {
  const [long, setLong] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLong(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return long;
}

/**
 * The free server sleeps when nobody uses it and takes up to a minute to wake. Rather than a page
 * that looks stuck, say so.
 */
export const WakingUpNote: React.FC<{ after?: number; className?: string }> = ({ after = 4000, className = '' }) => {
  const long = useTakingLong(after);
  if (!long) return null;
  return (
    <p role="status" className={`text-[13px] text-fg-muted animate-fade-in ${className}`}>
      The server is waking up. This can take up to a minute the first time; please keep this page open.
    </p>
  );
};

/** Rows like a list of projects, tasks or people. */
export const ListSkeleton: React.FC<{ rows?: number; label?: string; className?: string }> = ({ rows = 5, label = 'Loading', className = '' }) => (
  <div role="status" aria-label={label} className={`border border-line rounded-lg divide-y divide-line ${className}`}>
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="flex items-center gap-3 px-3 py-3">
        <Bone className="w-7 h-7 rounded-full shrink-0" />
        <div className="flex-1 space-y-1.5">
          <Bone className={`h-3.5 ${["w-2/3", "w-1/2", "w-3/4"][i % 3]}`} />
          <Bone className={`h-3 ${i % 2 ? 'w-1/3' : 'w-1/2'}`} />
        </div>
        <Bone className="w-16 h-5 shrink-0" />
      </div>
    ))}
  </div>
);

/** Cards like the owner console's offices. */
export const CardsSkeleton: React.FC<{ cards?: number; label?: string }> = ({ cards = 3, label = 'Loading' }) => (
  <div role="status" aria-label={label} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {Array.from({ length: cards }, (_, i) => (
      <div key={i} className="border border-line rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Bone className="w-8 h-8" />
          <Bone className="h-4 w-1/2" />
        </div>
        <Bone className="h-3 w-3/4" />
        <div className="grid grid-cols-3 gap-2">
          <Bone className="h-10" />
          <Bone className="h-10" />
          <Bone className="h-10" />
        </div>
      </div>
    ))}
  </div>
);

/** The whole workspace (sidebar + page) while it first loads. */
export const WorkspaceSkeleton: React.FC = () => (
  <div className="flex h-full w-full bg-canvas" role="status" aria-label="Loading your workspace">
    <div className="hidden lg:flex flex-col w-[248px] shrink-0 bg-sidebar border-r border-line p-3 gap-3">
      <div className="flex items-center gap-2">
        <Bone className="w-6 h-6" />
        <Bone className="h-4 flex-1" />
      </div>
      <Bone className="h-8 mt-2" />
      {Array.from({ length: 6 }, (_, i) => (
        <Bone key={i} className={`h-4 ${i % 3 === 2 ? 'w-2/3' : 'w-5/6'}`} />
      ))}
    </div>
    <div className="flex-1 min-w-0 p-6 lg:p-10 space-y-6">
      <div className="space-y-2">
        <Bone className="h-7 w-48" />
        <Bone className="h-4 w-72 max-w-full" />
      </div>
      <WakingUpNote />
      <div className="grid gap-3 sm:grid-cols-3">
        <Bone className="h-20" />
        <Bone className="h-20" />
        <Bone className="h-20" />
      </div>
      <ListSkeleton rows={5} label="Loading your workspace" />
    </div>
  </div>
);

/** A project while it opens: header, tabs and task rows. */
export const ProjectSkeleton: React.FC = () => (
  <div className="flex-1 p-4 lg:p-6 space-y-5" role="status" aria-label="Loading project">
    <div className="space-y-2">
      <Bone className="h-6 w-64 max-w-full" />
      <Bone className="h-4 w-40" />
    </div>
    <div className="flex gap-2">
      {Array.from({ length: 6 }, (_, i) => (
        <Bone key={i} className="h-7 w-20" />
      ))}
    </div>
    <ListSkeleton rows={6} label="Loading project" />
  </div>
);
