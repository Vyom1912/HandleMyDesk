import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Modal } from './Modal';
import { Button, inputClass } from './Field';

export const ConfirmDialog: React.FC = () => {
  const { confirmState } = useApp();
  const [typed, setTyped] = useState('');

  useEffect(() => setTyped(''), [confirmState?.title]);

  if (!confirmState) return null;
  const { title, message, confirmLabel = 'Confirm', danger, requireText, resolve } = confirmState;
  const blocked = !!requireText && typed !== requireText;

  return (
    <Modal
      open
      onClose={() => resolve(false)}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => resolve(false)}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} disabled={blocked} onClick={() => resolve(true)} data-autofocus={!requireText || undefined}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-fg-muted leading-relaxed">{message}</p>
      {requireText && (
        <label className="block mt-4">
          <span className="block text-[13px] text-fg-muted mb-1">
            Type <strong className="font-mono text-fg">{requireText}</strong> to confirm
          </span>
          <input
            data-autofocus
            className={inputClass}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !blocked && resolve(true)}
          />
        </label>
      )}
    </Modal>
  );
};

export const ToastBanner: React.FC = () => {
  const { toast, dismissToast } = useApp();

  return (
    // Always rendered so screen readers announce changes
    <div aria-live="polite" role="status" className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-5 sm:bottom-5 z-[60] flex justify-center sm:justify-end pointer-events-none">
      {toast && (
        <div
          key={toast.id}
          className="pointer-events-auto animate-fade-in flex items-center gap-2.5 pl-3.5 pr-1.5 py-2 rounded-lg bg-fg text-canvas shadow-[0_8px_24px_rgb(0_0_0/0.2)] text-sm max-w-md"
        >
          {toast.type === 'success' && <CheckCircle2 size={15} className="shrink-0 opacity-80" />}
          {toast.type === 'error' && <AlertCircle size={15} className="shrink-0 text-tone-red-bg" />}
          {toast.type === 'info' && <Info size={15} className="shrink-0 opacity-80" />}
          <span className="flex-1">{toast.message}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.onClick();
                dismissToast();
              }}
              className="px-2 py-1 rounded text-sm font-semibold underline underline-offset-2 hover:opacity-80"
            >
              {toast.action.label}
            </button>
          )}
          <button onClick={dismissToast} className="p-1 rounded opacity-70 hover:opacity-100" aria-label="Dismiss message">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
};
