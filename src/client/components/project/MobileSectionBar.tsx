import React, { useRef, useState } from 'react';
import {
  LayoutDashboard,
  SquareCheck,
  Columns3,
  CalendarDays,
  Flag,
  PackageCheck,
  Paperclip,
  StickyNote,
  Link as LinkIcon,
  MessageCircle,
  Users,
  Activity,
  Settings,
  Ellipsis,
  FileText,
  Copy,
  X,
} from 'lucide-react';
import { ProjectSection } from '../../../types';
import { useDialogBehavior } from '../ui/Modal';

export const SECTION_ICONS: Record<string, React.ElementType> = {
  overview: LayoutDashboard,
  tasks: SquareCheck,
  kanban: Columns3,
  calendar: CalendarDays,
  timeline: Flag,
  deliverables: PackageCheck,
  files: Paperclip,
  notes: StickyNote,
  links: LinkIcon,
  chat: MessageCircle,
  team: Users,
  activity: Activity,
  settings: Settings,
  report: FileText,
};

// What people use most on a phone; everything else is one tap away under "More"
const PRIMARY: ProjectSection[] = ['overview', 'tasks', 'chat', 'files'];

type SectionItem = { id: ProjectSection; label: string; count?: number };

/**
 * Project navigation for phones: four big tabs with icons, and "More" for the other sections,
 * shown as a panel of labelled tiles instead of a long sideways-scrolling row.
 */
export const MobileSectionBar: React.FC<{
  sections: SectionItem[];
  active: ProjectSection;
  onOpen: (s: ProjectSection) => void;
  onCopyLink: () => void;
}> = ({ sections, active, onOpen, onCopyLink }) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  useDialogBehavior(moreOpen, () => setMoreOpen(false), sheetRef);

  const primary = PRIMARY.map((id) => sections.find((s) => s.id === id)!).filter(Boolean);
  const rest = sections.filter((s) => !PRIMARY.includes(s.id));
  const activeInMore = rest.find((s) => s.id === active) ?? (active === 'report' ? { id: 'report' as ProjectSection, label: 'Summary' } : undefined);

  const tab = (s: SectionItem | { id: ProjectSection; label: string; count?: number }, isActive: boolean, onClick: () => void, Icon: React.ElementType, extra?: string) => (
    <button
      key={s.id + (extra ?? '')}
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      aria-label={s.count ? `${s.label}, ${s.count}` : s.label}
      className={`relative flex-1 min-w-0 h-14 flex flex-col items-center justify-center gap-0.5 text-tiny font-medium ${isActive ? 'text-accent-ink' : 'text-fg-muted'}`}
    >
      <span className="relative">
        <Icon size={19} strokeWidth={isActive ? 2.2 : 1.8} />
        {!!s.count && s.count > 0 && (
          <span className="absolute -top-1.5 -right-3 min-w-4 h-4 px-1 rounded-full bg-subtle border border-line text-micro text-fg-muted flex items-center justify-center tabular-nums">{s.count > 99 ? '99+' : s.count}</span>
        )}
      </span>
      <span className="truncate max-w-full px-1">{s.label}</span>
      {isActive && <span aria-hidden="true" className="absolute left-3 right-3 -bottom-px h-0.5 bg-accent rounded-full" />}
    </button>
  );

  return (
    <>
      <nav aria-label="Project sections" className="md:hidden flex border-b border-line -mx-4">
        {primary.map((s) => tab(s, active === s.id, () => onOpen(s.id), SECTION_ICONS[s.id]))}
        {activeInMore
          ? tab({ ...activeInMore, count: undefined }, true, () => setMoreOpen(true), SECTION_ICONS[activeInMore.id] ?? Ellipsis, '-more')
          : tab({ id: 'settings', label: 'More' }, false, () => setMoreOpen(true), Ellipsis, '-more')}
      </nav>

      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-overlay flex items-end animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && setMoreOpen(false)}>
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="More project sections"
            tabIndex={-1}
            className="w-full bg-surface rounded-t-2xl shadow-[0_-8px_32px_rgb(0_0_0/0.18)] focus:outline-none"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
          >
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <h2 className="text-base font-semibold text-fg">More in this project</h2>
              <button onClick={() => setMoreOpen(false)} className="w-10 h-10 flex items-center justify-center rounded-md text-fg-muted hover:bg-hover" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 px-4">
              {[...rest, { id: 'report' as ProjectSection, label: 'Client summary' }].map((s: SectionItem) => {
                const Icon = SECTION_ICONS[s.id] ?? Ellipsis;
                const isActive = s.id === active;
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      setMoreOpen(false);
                      onOpen(s.id);
                    }}
                    className={`relative h-20 rounded-xl border flex flex-col items-center justify-center gap-1.5 text-meta font-medium ${
                      isActive ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-surface text-fg hover:bg-hover'
                    }`}
                  >
                    <Icon size={20} />
                    {s.label}
                    {!!s.count && s.count > 0 && <span className="absolute top-1.5 right-2 text-tiny text-fg-faint tabular-nums">{s.count}</span>}
                  </button>
                );
              })}
            </div>
            <div className="px-4 pt-3">
              <button
                onClick={() => {
                  setMoreOpen(false);
                  onCopyLink();
                }}
                className="w-full h-11 rounded-xl border border-line flex items-center justify-center gap-2 text-sm text-fg hover:bg-hover"
              >
                <Copy size={16} /> Copy link to this project
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
