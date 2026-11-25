import React from 'react';

export const inputClass =
  'w-full h-9 px-2.5 bg-surface border border-line-strong rounded-md text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:opacity-60 disabled:bg-subtle';

export const textareaClass =
  'w-full px-2.5 py-2 bg-surface border border-line-strong rounded-md text-sm text-fg placeholder:text-fg-faint focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:opacity-60';

export const selectClass = `${inputClass} pr-8`;

// Compact select used in toolbars
export const toolbarSelectClass =
  'h-8 pl-2.5 pr-7 bg-surface border border-line rounded-md text-[13px] text-fg focus:outline-none focus:border-accent';

// Wrapping the control in the <label> associates them without needing ids
export const Field: React.FC<{ label: string; required?: boolean; hint?: string; className?: string; children: React.ReactNode }> = ({
  label,
  required,
  hint,
  className = '',
  children,
}) => (
  <label className={`block ${className}`}>
    <span className="block text-[13px] font-medium text-fg-muted mb-1">
      {label}
      {required && (
        <span className="text-danger" aria-hidden="true">
          {' '}
          *
        </span>
      )}
    </span>
    {children}
    {hint && <span className="block text-xs text-fg-faint mt-1">{hint}</span>}
  </label>
);

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent hover:bg-accent-hover text-on-accent',
  danger: 'bg-danger hover:bg-danger-hover text-on-accent',
  secondary: 'bg-surface hover:bg-hover text-fg border border-line-strong',
  ghost: 'text-fg-muted hover:text-fg hover:bg-hover',
};

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }> = ({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}) => (
  <button
    type={type}
    className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
      size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-8 px-3 text-sm'
    } ${VARIANTS[variant]} ${className}`}
    {...props}
  />
);

export const IconButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }> = ({
  label,
  danger,
  className = '',
  ...props
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-fg-faint transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      danger ? 'hover:text-tone-red-fg hover:bg-tone-red-bg' : 'hover:text-fg hover:bg-hover'
    } ${className}`}
    {...props}
  />
);

export const SectionHeader: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode }> = ({ title, subtitle, actions }) => (
  <div className="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      {subtitle && <p className="text-[13px] text-fg-muted mt-0.5">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export const EmptyState: React.FC<{ message: string; action?: React.ReactNode }> = ({ message, action }) => (
  <div className="py-12 px-4 text-center text-sm text-fg-muted border border-dashed border-line-strong rounded-lg space-y-3">
    <p>{message}</p>
    {action}
  </div>
);

export const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => (
  <div className={`bg-surface border border-line rounded-lg ${className}`}>{children}</div>
);

export const SearchInput: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string }> = ({
  value,
  onChange,
  placeholder,
  label,
  className = '',
}) => (
  <div className={`relative ${className}`}>
    <svg aria-hidden="true" viewBox="0 0 24 24" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-faint" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
    <input
      type="search"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-8 pl-8 pr-2.5 bg-surface border border-line rounded-md text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:border-accent"
    />
  </div>
);

// Segmented control for small sets of mutually exclusive filters
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-center h-8 p-0.5 bg-subtle border border-line rounded-md">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`h-full px-2.5 rounded text-[13px] transition-colors ${
            value === o.value ? 'bg-surface text-fg font-medium shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-fg-muted hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
