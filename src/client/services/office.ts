import { useEffect, useState } from 'react';
import { api } from './api';
import { applyBrandColor } from './appearance';
import { OfficeBrand } from '../../types';

export interface OfficeInfo extends OfficeBrand {
  // True while the HandleMyDesk owner is inside this office as support
  supportVisit: boolean;
}

let current: OfficeInfo | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<(o: OfficeInfo | null) => void>();

function publish(o: OfficeInfo | null) {
  current = o;
  applyBrandColor(o?.color);
  document.title = o ? `${o.name} · HandleMyDesk` : 'HandleMyDesk';
  listeners.forEach((l) => l(o));
}

/** After an administrator changes the colour, logo or sign-in link. */
export function updateOfficeBrand(brand: OfficeBrand) {
  if (current) publish({ ...current, ...brand, color: brand.color, logoUrl: brand.logoUrl });
}

/** On sign-out: back to the plain HandleMyDesk look. */
export function forgetOffice() {
  loading = null;
  publish(null);
}

/** The office (customer company) this session belongs to, with its branding. */
export function useOffice(enabled = true): OfficeInfo | null {
  const [office, setOffice] = useState<OfficeInfo | null>(current);
  useEffect(() => {
    if (!enabled) return;
    listeners.add(setOffice);
    loading ??= api
      .get<OfficeInfo>('/api/office')
      .then(publish)
      .catch(() => {
        loading = null;
      });
    setOffice(current);
    return () => {
      listeners.delete(setOffice);
    };
  }, [enabled]);
  return office;
}

// "Report a problem" can be opened from anywhere (sidebar, a notification)
export const OPEN_SUPPORT_EVENT = 'handlemydesk-open-support';
export const openSupport = () => window.dispatchEvent(new CustomEvent(OPEN_SUPPORT_EVENT));
