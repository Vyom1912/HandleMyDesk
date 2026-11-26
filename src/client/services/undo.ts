/**
 * Ids of things deleted with "Undo" still showing. Live refreshes leave them out, so a teammate's
 * change arriving during those seconds doesn't bring them back on screen.
 */
export const pendingDeletes = new Set<string>();

export const withoutPending = <T extends { id: string }>(list: T[]): T[] => (pendingDeletes.size ? list.filter((x) => !pendingDeletes.has(x.id)) : list);
