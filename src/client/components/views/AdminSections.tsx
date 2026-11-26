import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, ImagePlus, RotateCcw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useOffice, updateOfficeBrand } from '../../services/office';
import { BRAND_SWATCHES, applyBrandColor } from '../../services/appearance';
import { OfficeBrand } from '../../../types';
import { Button, Field, inputClass } from '../ui/Field';
import { BrandMark } from '../ui/BrandMark';
import { Bone } from '../ui/Skeleton';

/** Copy text, with a short "Copied" confirmation on the button. */
function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };
  return [copied, copy];
}

/** Logo, colour and the office's own sign-in link. */
export const BrandingSection: React.FC = () => {
  const { showToast } = useApp();
  const office = useOffice();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [slug, setSlug] = useState('');
  const [copied, copy] = useCopy();

  useEffect(() => {
    if (office) setSlug(office.slug);
  }, [office?.slug]);

  const save = async (patch: { color?: string | null; slug?: string }, done?: string) => {
    setBusy(true);
    try {
      updateOfficeBrand(await api.put<OfficeBrand>('/api/office/brand', patch));
      if (done) showToast(done, 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('logo', file);
      updateOfficeBrand(await api.upload<OfficeBrand>('/api/office/brand/logo', form));
      showToast('Logo updated', 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeLogo = async () => {
    setBusy(true);
    try {
      updateOfficeBrand(await api.delete<OfficeBrand>('/api/office/brand/logo'));
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const customTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pickCustom = (color: string) => {
    applyBrandColor(color);
    clearTimeout(customTimer.current);
    customTimer.current = setTimeout(() => save({ color }), 600);
  };

  const signInLink = office ? `${window.location.origin}/?office=${office.slug}` : '';
  const current = office?.color ?? null;

  return (
    <section className="mb-10" aria-labelledby="branding-heading">
      <h2 id="branding-heading" className="text-base font-semibold text-fg">
        Branding
      </h2>
      <p className="text-sm text-fg-muted mt-1">Your logo and colour appear on your sign-in page, in the sidebar and on buttons, for everyone in this office.</p>

      {!office ? (
        <div className="mt-4 space-y-3" role="status" aria-label="Loading branding">
          <Bone className="h-16" />
          <Bone className="h-10" />
        </div>
      ) : (
        <div className="mt-4 space-y-6">
          {/* Logo */}
          <div className="flex flex-wrap items-center gap-4 p-4 rounded-lg border border-line">
            <div className="w-[180px] h-12 flex items-center">
              <BrandMark brand={office} />
            </div>
            <div className="flex-1 min-w-48">
              <div className="text-sm font-medium text-fg">Logo</div>
              <div className="text-xs text-fg-faint">PNG, JPG or WebP up to 1 MB. A wide logo on a transparent background looks best.</div>
            </div>
            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
              />
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                <ImagePlus size={14} /> {office.logoUrl ? 'Change' : 'Upload'}
              </Button>
              {office.logoUrl && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={removeLogo}>
                  Remove
                </Button>
              )}
            </div>
          </div>

          {/* Colour */}
          <div>
            <div className="text-sm font-medium text-fg">Colour</div>
            <div className="mt-2 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Office colour">
              {BRAND_SWATCHES.map((c) => {
                const selected = (current ?? BRAND_SWATCHES[0]) === c;
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={c === BRAND_SWATCHES[0] ? 'HandleMyDesk blue (default)' : c}
                    title={c}
                    disabled={busy}
                    onClick={() => save({ color: c === BRAND_SWATCHES[0] ? null : c })}
                    className={`w-9 h-9 pointer-fine:w-7 pointer-fine:h-7 rounded-full flex items-center justify-center ring-offset-2 ring-offset-canvas ${selected ? 'ring-2 ring-fg' : ''}`}
                    style={{ background: c }}
                  >
                    {selected && <Check size={14} className="text-white" />}
                  </button>
                );
              })}
              <label className="relative inline-flex items-center gap-1.5 h-9 pointer-fine:h-7 px-2.5 rounded-md border border-line-strong text-[13px] text-fg-muted hover:bg-hover cursor-pointer">
                <span className="w-4 h-4 rounded-full border border-line-strong" style={{ background: current ?? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }} aria-hidden="true" />
                Custom…
                <input
                  type="color"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  value={current ?? BRAND_SWATCHES[0]}
                  // Previews while dragging; saved once the colour stops changing
                  onChange={(e) => pickCustom(e.target.value)}
                  aria-label="Custom colour"
                />
              </label>
              {current && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => save({ color: null }, 'Back to the default colour')}>
                  <RotateCcw size={13} /> Default
                </Button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Preview">
              <span className="text-xs text-fg-faint">Preview:</span>
              <span className="inline-flex items-center h-7 px-2.5 rounded-md bg-accent text-on-accent text-[13px] font-medium">Button</span>
              <span className="inline-flex items-center h-7 px-2.5 rounded-md bg-accent-soft text-accent-ink text-[13px] font-medium">Selected</span>
              <span className="text-[13px] text-accent-ink underline underline-offset-2">Link</span>
            </div>
          </div>

          {/* Sign-in link */}
          <div>
            <div className="text-sm font-medium text-fg">Your sign-in page</div>
            <p className="text-xs text-fg-faint mt-0.5">Share this link with your team. It opens the sign-in page with your logo and colour.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="flex-1 min-w-0 h-9 px-2.5 flex items-center rounded-md bg-subtle border border-line font-mono text-[13px] text-fg truncate">{signInLink}</code>
              <Button variant="secondary" size="sm" onClick={() => copy(signInLink)}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                save({ slug }, 'Sign-in link changed. Send the new one to your team.');
              }}
            >
              <Field label="Link name" hint="Lowercase letters, numbers and dashes" className="flex-1 min-w-48">
                <input className={`${inputClass} font-mono`} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={40} />
              </Field>
              <Button type="submit" variant="secondary" disabled={busy || !slug || slug === office.slug} className="mb-[22px]">
                Save
              </Button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Spreadsheets of the office's activity, people, projects and tasks. */
export const ExportSection: React.FC = () => {
  const { showToast } = useApp();
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [busy, setBusy] = useState<string | null>(null);

  const get = async (key: string, url: string, file: string) => {
    setBusy(key);
    try {
      await api.download(url, file);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = isoDay(new Date());
  const presets: Array<{ label: string; days: number | null }> = [
    { label: 'Last 7 days', days: 7 },
    { label: 'Last 30 days', days: 30 },
    { label: 'Last 90 days', days: 90 },
    { label: 'Everything', days: null },
  ];
  const badRange = !!from && !!to && from > to;

  return (
    <section className="mb-10" aria-labelledby="export-heading">
      <h2 id="export-heading" className="text-base font-semibold text-fg">
        Export
      </h2>
      <p className="text-sm text-fg-muted mt-1">Download spreadsheets (CSV) that open in Excel, Google Sheets and Numbers.</p>

      <div className="mt-4 p-4 rounded-lg border border-line space-y-3">
        <div>
          <div className="text-sm font-medium text-fg">Activity</div>
          <div className="text-xs text-fg-faint">Who did what and when, across every project: tasks, files, milestones, team changes.</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setFrom(p.days === null ? '' : isoDay(new Date(Date.now() - p.days * 86400000)));
                setTo(p.days === null ? '' : today);
              }}
              className="h-9 pointer-fine:h-7 px-2.5 rounded-md border border-line text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="From" className="w-40">
            <input type="date" className={inputClass} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" className="w-40">
            <input type="date" className={inputClass} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Button
            disabled={busy !== null || badRange}
            onClick={() => {
              const q = new URLSearchParams({ tz });
              if (from) q.set('from', from);
              if (to) q.set('to', to);
              get('activity', `/api/admin/export/activity.csv?${q}`, `activity${from ? `-${from}` : ''}${to ? `-to-${to}` : ''}.csv`);
            }}
          >
            <Download size={14} /> {busy === 'activity' ? 'Preparing…' : 'Download activity'}
          </Button>
        </div>
        {badRange && <p className="text-xs text-tone-red-fg">The start date is after the end date.</p>}
        <p className="text-xs text-fg-faint">Times are in your time zone ({tz}).</p>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {[
          { key: 'people', label: 'People', hint: 'Roles and workload', url: '/api/admin/export/people.csv', file: `people-${today}.csv` },
          { key: 'projects', label: 'Projects', hint: 'Status, dates, budget', url: '/api/projects/export.csv', file: `projects-${today}.csv` },
          { key: 'tasks', label: 'Tasks', hint: 'Every task in every project', url: '/api/tasks/export.csv', file: `tasks-${today}.csv` },
        ].map((x) => (
          <button
            key={x.key}
            type="button"
            disabled={busy !== null}
            onClick={() => get(x.key, x.url, x.file)}
            className="flex items-center gap-3 p-3 rounded-lg border border-line text-left hover:bg-subtle disabled:opacity-50"
          >
            <Download size={16} className="text-fg-faint shrink-0" />
            <span>
              <span className="block text-sm font-medium text-fg">{busy === x.key ? 'Preparing…' : x.label}</span>
              <span className="block text-xs text-fg-faint">{x.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};
