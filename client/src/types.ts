export type Person = {
  personId: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  organizationId: string;
  organization: string;
  positionName: string;
  costCenter: string;
  objectCode: string;
  activeAssignment: boolean;
};

export type School = {
  id: string;
  schoolNumber: string;
  name: string;
  type: 'school' | 'department';
  active: boolean;
};

export type PersonPage = {
  data: Person[];
  page: number;
  pageSize: number;
  total: number;
};

export type LoginSession = {
  user: {
    id: string;
    wakeId: string;
    displayName: string;
    email: string;
    roles: string[];
    schoolIds: string[];
    canViewAllSchools: boolean;
  };
  person: Person;
  school: School;
};

export type PersonRecord = {
  personId: string;
  identity: { fullName: string; employeeNumber: string; ncUid: string; gender: string; ethnicity: string; dateOfBirth: string; email: string; personalEmail: string };
  contact: { address: string; city: string; state: string; zip: string; phone: string };
  assignment: { organizationId: string; organization: string; classroom: string; months: number; position: string; accountCode: string; tapPercent: number; payGrade: string; group: string; mailStop: string; schoolType: string; supervisor: string };
  compensation: { step: string; proposedSalary: number; fixedSupplement: number; offScale: number; supplement: number; tosState: number; tosSupplement: number; teacherDifferential: number };
  contract: { hireDate: string; continuousDate: string; lastChanged: string; type: string; start: string; end: string; renewalYear: string; changeType: string; boardNumber: string };
  licensure: { type: string; renewalYear: string; expires: string; areas: { area: string; description: string; years: string; status: string; code: string }[] };
  service: { yearsOfService: number; monthsOfService: number; lastUpdated: string };
  leaveBalances: { leaveType: string; carryover: number; accrued: number; used: number; adjustment: number; balance: number; accrualRate: number; lastUpdated: string }[];
};

export type OpenPositionRow = {
  posStart: string;
  posEnding: string;
  posNumber: string;
  posName: string;
  organization: string;
  accountNumber: string;
  monthsAvailable: number | null;
  monthsUsed: number | null;
  fullName: string;
  employeeNumber: string;
  classroom: string;
  mailstop: string;
  tenureCode: string;
  contractId: string;
  contractEnd: string;
  tap: string;
  degree: string;
  nbptsExpire: string;
};

export type OpenPositionReport = {
  organization: string;
  columns: string[];
  rows: OpenPositionRow[];
};

export type ReportSection = {
  id: string;
  title: string;
  sortOrder: number;
  isActive: boolean;
  reportCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type ReportStatus = 'active' | 'inactive';

export type HighlightOperator = 'eq' | 'neq' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty';
export type HighlightColorId = 'pastel_red' | 'pastel_yellow' | 'pastel_green' | 'pastel_blue' | 'pastel_pink' | 'pastel_orange';
export type ReportHighlightRule = { id: string; column: string; operator: HighlightOperator; value: string; color: HighlightColorId };

export const HIGHLIGHT_PALETTE: Record<HighlightColorId, { label: string; bg: string; border: string; excelRgb: string }> = {
  pastel_red: { label: 'Pastel red', bg: '#ffd6d6', border: '#e8a0a0', excelRgb: 'FFFFD6D6' },
  pastel_yellow: { label: 'Pastel yellow', bg: '#fff3c4', border: '#e8d8a0', excelRgb: 'FFFFF3C4' },
  pastel_green: { label: 'Pastel green', bg: '#d1f0d6', border: '#a0c8a8', excelRgb: 'FFD1F0D6' },
  pastel_blue: { label: 'Pastel blue', bg: '#d6e6ff', border: '#a0b8e8', excelRgb: 'FFD6E6FF' },
  pastel_pink: { label: 'Pastel pink', bg: '#ffd6e8', border: '#e8a0c0', excelRgb: 'FFFFD6E8' },
  pastel_orange: { label: 'Pastel orange', bg: '#ffe4c4', border: '#e8c0a0', excelRgb: 'FFFFE4C4' },
};

export function resolveHighlightNeedle(value: string): string {
  const trimmed = value.trim();
  if (trimmed === 'THISYEAR') return String(new Date().getFullYear());
  if (trimmed === 'NEXTYEAR') return String(new Date().getFullYear() + 1);
  return trimmed;
}

export type ReportDefinition = {
  id: string;
  sectionId: string;
  sectionTitle?: string;
  title: string;
  description: string;
  sqlQuery?: string;
  status: ReportStatus;
  rowKeyColumn?: string | null;
  highlightRules?: ReportHighlightRule[];
  subreportQuery?: string;
  subreportKeyColumn?: string | null;
  columns?: string[];
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type GenericReportRow = Record<string, unknown>;

export type GenericSubreportRun = {
  keyColumn: string;
  columns: string[];
  rows: GenericReportRow[];
  truncated: boolean;
};

export type GenericReportRowWithSubreport = GenericReportRow & {
  __subreport?: GenericSubreportRun;
};

export type GenericReportRun = {
  report: { id: string; title: string; description: string; sectionTitle?: string; highlightRules?: ReportHighlightRule[] };
  organization: string;
  columns: string[];
  rows: GenericReportRowWithSubreport[];
  subreport?: { keyColumn: string } | null;
  truncated: boolean;
};

// ---- Report Views (Phase 1 & 2) ----

export type ViewSort = { column: string; dir: 'asc' | 'desc' } | null;

export type ViewHighlight = { rowKey: string; color: 'yellow' | 'green' | 'blue' | 'red'; note?: string };

export type ViewDefinition = {
  columnOrder: string[];
  hiddenColumns: string[];
  filterText: string;
  sort: ViewSort;
  highlights: ViewHighlight[];
};

export type ReportViewVisibility = 'private' | 'invite_only';

export type ReportView = {
  id: string;
  reportId: string;
  organization: string;
  ownerId: string;
  ownerName: string;
  name: string;
  description: string;
  visibility: ReportViewVisibility;
  definition: ViewDefinition;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ReportViewInviteRole = 'viewer' | 'commenter' | 'editor';
export type ReportViewInviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

export type ReportViewInvite = {
  id: string;
  viewId: string;
  inviterId: string;
  inviteeId: string | null;
  inviteeEmail: string | null;
  inviteeName: string;
  role: ReportViewInviteRole;
  status: ReportViewInviteStatus;
  createdAt: string;
  updatedAt: string;
};

export type ReportViewComment = {
  id: string;
  viewId: string;
  authorId: string;
  authorName: string;
  body: string;
  rowKey: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PersonFavorite = {
  id: string;
  userId: string;
  personId: string;
  employeeNumber: string;
  personName: string;
  reportId: string | null;
  reportTitle: string;
  organization: string;
  rowKey: string | null;
  createdAt: string;
};

export type PersonFavoriteCheck = {
  personId: string;
  favorited: boolean;
  favoriteId: string | null;
};
