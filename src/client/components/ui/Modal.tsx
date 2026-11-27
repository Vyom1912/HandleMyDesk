import React, { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Closes on Escape, keeps Tab focus inside the dialog, and returns focus to whatever
 * opened it. Shared by modals, drawers and the project picker.
 */
export function useDialogBehavior(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the first field (or the dialog itself) once it has rendered
    const raf = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el || el.contains(document.activeElement)) return;
      // On touchscreens only focus fields marked for it: focusing anything else shows a stray
      // focus ring, and focusing a text field pops the keyboard over the dialog.
      const touch = window.matchMedia('(pointer: coarse)').matches;
      const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? (touch ? null : el.querySelector<HTMLElement>(FOCUSABLE));
      (first ?? el).focus({ preventScroll: true });
    });

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab' && ref.current) {
        const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleKey);
      previouslyFocused?.focus?.();
    };
  }, [open, ref]);
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  children: React.ReactNode;
  footer?: React.ReactNode;
  /**
   * Something typed hasn't been saved. Esc, ✕ and clicking outside then ask before throwing it
   * away, and the browser warns before the page is closed or reloaded.
   */
  dirty?: boolean;
}

const SIZES = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-xl', xl: 'sm:max-w-3xl' };

/**
 * True when `value` (a form's fields) differs from how it looked just after the dialog opened.
 * The snapshot is taken a moment after opening, once the form has been filled in for editing.
 */
export function useDirty(value: unknown, open: boolean): boolean {
  const json = JSON.stringify(value);
  const latest = useRef(json);
  latest.current = json;
  const [baseline, setBaseline] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setBaseline(null);
      return;
    }
    const t = setTimeout(() => setBaseline(latest.current), 0);
    return () => clearTimeout(t);
  }, [open]);
  return open && baseline !== null && json !== baseline;
}

/** Browser warning when leaving the page with unsaved changes. */
export function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers need returnValue set
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);
}

export const Modal: React.FC<ModalProps> = ({ open, onClose, title, description, size = 'md', children, footer, dirty = false }) => {
  const ref = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!open || !dirty) setAsking(false);
  }, [open, dirty]);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);
  useLeaveWarning(open && dirty);

  // Esc / ✕ / outside click: close, or ask first when there are unsaved changes
  const requestClose = () => {
    if (!dirty) onClose();
    else setAsking((a) => !a);
  };
  useDialogBehavior(open, requestClose, ref);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-overlay z-50 flex items-end sm:items-start justify-center sm:pt-[10vh] sm:px-4 animate-fade-in"
      onMouseDown={(e) => e.target === e.currentTarget && requestClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`bg-surface border border-line rounded-t-xl sm:rounded-lg shadow-[0_16px_48px_rgb(0_0_0/0.18)] w-full ${SIZES[size]} max-h-[88vh] flex flex-col overflow-hidden focus:outline-none`}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-body font-semibold text-fg">
              {title}
            </h2>
            {description && (
              <p id={descId} className="text-meta text-fg-muted mt-0.5">
                {description}
              </p>
            )}
          </div>
          <button onClick={requestClose} className="-mr-2 -mt-1 w-10 h-10 pointer-fine:w-7 pointer-fine:h-7 pointer-fine:-mr-1 pointer-fine:mt-0 flex items-center justify-center shrink-0 rounded-md text-fg-faint hover:text-fg hover:bg-hover" aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {asking ? (
          <div role="alert" className="px-5 py-3 border-t border-line bg-tone-amber-bg flex flex-wrap items-center justify-end gap-2 animate-fade-in">
            <span className="flex-1 min-w-40 text-sm text-tone-amber-fg font-medium">Discard your unsaved changes?</span>
            <button
              ref={keepRef}
              type="button"
              onClick={() => setAsking(false)}
              className="h-11 pointer-fine:h-8 px-3 rounded-md text-sm font-medium bg-surface text-fg border border-line-strong hover:bg-hover"
            >
              Keep editing
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking(false);
                onClose();
              }}
              className="h-11 pointer-fine:h-8 px-3 rounded-md text-sm font-medium bg-danger text-on-accent hover:bg-danger-hover"
            >
              Discard
            </button>
          </div>
        ) : (
          footer && <div className="px-5 py-3 border-t border-line bg-subtle flex flex-wrap justify-end gap-2">{footer}</div>
        )}
      </div>
    </div>
  );
};
