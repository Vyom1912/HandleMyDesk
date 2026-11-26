import { useEffect, useState } from 'react';
import { api } from './api';

export interface OfficeInfo {
  id: string;
  name: string;
  // True while the HandleMyDesk owner is inside this office as support
  supportVisit: boolean;
}

let cache: Promise<OfficeInfo> | null = null;

/** The office (customer company) this session belongs to. */
export function useOffice(enabled = true): OfficeInfo | null {
  const [office, setOffice] = useState<OfficeInfo | null>(null);
  useEffect(() => {
    if (!enabled) return;
    cache ??= api.get<OfficeInfo>('/api/office').catch((err) => {
      cache = null;
      throw err;
    });
    let live = true;
    cache.then((o) => live && setOffice(o)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [enabled]);
  return office;
}

// "Report a problem" can be opened from anywhere (sidebar, a notification)
export const OPEN_SUPPORT_EVENT = 'handlemydesk-open-support';
export const openSupport = () => window.dispatchEvent(new CustomEvent(OPEN_SUPPORT_EVENT));
