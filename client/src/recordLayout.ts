export const RECORD_SECTION_IDS = [
  'identity',
  'contact',
  'assignment',
  'compensation',
  'contract',
  'licensure',
  'service',
  'leave',
] as const;

export type RecordSectionId = (typeof RECORD_SECTION_IDS)[number];

export const RECORD_SECTION_TITLES: Record<RecordSectionId, string> = {
  identity: 'Identity',
  contact: 'Contact',
  assignment: 'Assignment',
  compensation: 'Compensation',
  contract: 'Contract',
  licensure: 'Licensure',
  service: 'Service summary',
  leave: 'Leave balances',
};

export const DEFAULT_RECORD_LAYOUT: RecordSectionId[] = [...RECORD_SECTION_IDS];

const STORAGE_PREFIX = 'hr-report-record-layout:';

function storageKey(userId: string | null): string {
  return `${STORAGE_PREFIX}${userId ?? 'anon'}`;
}

export function normalizeLayout(layout: unknown): RecordSectionId[] {
  const known = new Set<string>(RECORD_SECTION_IDS);
  if (!Array.isArray(layout)) return [...DEFAULT_RECORD_LAYOUT];
  const seen = new Set<string>();
  const filtered: RecordSectionId[] = [];
  for (const item of layout) {
    if (typeof item !== 'string') continue;
    if (!known.has(item)) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    filtered.push(item as RecordSectionId);
  }
  for (const id of RECORD_SECTION_IDS) {
    if (!seen.has(id)) filtered.push(id);
  }
  return filtered;
}

export function loadRecordLayout(userId: string | null): RecordSectionId[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [...DEFAULT_RECORD_LAYOUT];
    const parsed: unknown = JSON.parse(raw);
    return normalizeLayout(parsed);
  } catch {
    return [...DEFAULT_RECORD_LAYOUT];
  }
}

export function saveRecordLayout(userId: string | null, layout: RecordSectionId[]): void {
  const normalized = normalizeLayout(layout);
  window.localStorage.setItem(storageKey(userId), JSON.stringify(normalized));
}

export function resetRecordLayout(userId: string | null): void {
  window.localStorage.removeItem(storageKey(userId));
}

export function arraysEqual(a: RecordSectionId[], b: RecordSectionId[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
