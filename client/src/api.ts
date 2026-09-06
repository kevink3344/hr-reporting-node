import type {
  GenericReportRun,
  LoginSession,
  PersonFavorite,
  PersonFavoriteCheck,
  PersonPage,
  PersonRecord,
  PositionDetails,
  ReportDefinition,
  ReportSection,
  ReportView,
  ReportViewComment,
  ReportViewInvite,
  School,
  ViewDefinition,
} from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const code = (body as { error?: string }).error ?? `HTTP_${response.status}`;
    throw new Error(code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function adminHeaders(session: LoginSession | null | undefined): Record<string, string> {
  if (!session) return {};
  return {
    'x-user-roles': session.user.roles.join(','),
    'x-user-name': session.user.displayName,
    'x-user-id': session.user.wakeId ?? session.user.id,
    'x-user-email': session.user.email ?? ''
  };
}

function viewHeaders(session: LoginSession | null | undefined): Record<string, string> {
  if (!session) return {};
  return {
    'x-user-roles': session.user.roles.join(','),
    'x-user-name': session.user.displayName,
    'x-user-id': session.user.wakeId ?? session.user.id,
    'x-user-email': session.user.email ?? ''
  };
}

export function getSchools(): Promise<School[]> {
  return request<School[]>('/api/schools');
}

export function getPeople(search: string, schoolId: string): Promise<PersonPage> {
  const params = new URLSearchParams({ page: '1', pageSize: '50' });
  if (search.trim()) params.set('search', search.trim());
  if (schoolId) params.set('schoolId', schoolId);
  return request<PersonPage>(`/api/people?${params.toString()}`);
}

export async function login(wakeId: string, employeeId: string): Promise<LoginSession> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wakeId, employeeId })
  });
  if (!response.ok) throw new Error(response.status === 401 ? 'INVALID_CREDENTIALS' : 'LOGIN_FAILED');
  return response.json() as Promise<LoginSession>;
}

export function getPersonRecord(personId: string): Promise<PersonRecord> {
  return request<PersonRecord>(`/api/people/${encodeURIComponent(personId)}/record`);
}

// Position Details — read-only view of a single position (incumbent null when vacant).
export function getPositionDetails(organization: string, posNumber: string): Promise<PositionDetails> {
  const query = new URLSearchParams({ organization });
  return request<PositionDetails>(`/api/positions/${encodeURIComponent(posNumber)}?${query.toString()}`);
}

// ---- Configurable reports (Settings page) ----

export function getReportSections(session?: LoginSession | null, includeInactive = false): Promise<ReportSection[]> {
  const suffix = includeInactive ? '?includeInactive=1' : '';
  return request<ReportSection[]>(`/api/report-sections${suffix}`, { headers: adminHeaders(session) });
}

export function createReportSection(session: LoginSession, input: { title: string; sortOrder?: number; isActive?: boolean }): Promise<ReportSection> {
  return request<ReportSection>('/api/report-sections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...adminHeaders(session) },
    body: JSON.stringify(input)
  });
}

export function updateReportSection(session: LoginSession, id: string, patch: { title?: string; sortOrder?: number; isActive?: boolean }): Promise<ReportSection> {
  return request<ReportSection>(`/api/report-sections/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...adminHeaders(session) },
    body: JSON.stringify(patch)
  });
}

export function deleteReportSection(session: LoginSession, id: string): Promise<void> {
  return request<void>(`/api/report-sections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: adminHeaders(session)
  });
}

export function getReports(session?: LoginSession | null, sectionId?: string, includeInactive = false): Promise<ReportDefinition[]> {
  const params = new URLSearchParams();
  if (sectionId) params.set('sectionId', sectionId);
  if (includeInactive) params.set('includeInactive', '1');
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request<ReportDefinition[]>(`/api/reports${suffix}`, { headers: adminHeaders(session) });
}

export function getReport(session: LoginSession | null | undefined, id: string): Promise<ReportDefinition> {
  return request<ReportDefinition>(`/api/reports/${encodeURIComponent(id)}`, { headers: adminHeaders(session) });
}

export function createReport(session: LoginSession, input: { sectionId: string; title: string; description?: string; sqlQuery: string; status?: 'active' | 'inactive'; highlightRules?: unknown; subreportQuery?: string; subreportKeyColumn?: string | null; columns?: string[] }): Promise<ReportDefinition> {
  return request<ReportDefinition>('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...adminHeaders(session) },
    body: JSON.stringify(input)
  });
}

export function updateReport(session: LoginSession, id: string, patch: { sectionId?: string; title?: string; description?: string; sqlQuery?: string; status?: 'active' | 'inactive'; highlightRules?: unknown; subreportQuery?: string; subreportKeyColumn?: string | null; columns?: string[] }): Promise<ReportDefinition> {
  return request<ReportDefinition>(`/api/reports/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...adminHeaders(session) },
    body: JSON.stringify(patch)
  });
}

export function deleteReport(session: LoginSession, id: string): Promise<void> {
  return request<void>(`/api/reports/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: adminHeaders(session)
  });
}

export function validateReportSql(session: LoginSession, sqlQuery: string, subreport = false): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/reports/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...adminHeaders(session) },
    body: JSON.stringify({ sqlQuery, subreport })
  });
}

export function runReport(session: LoginSession | null | undefined, id: string, organization: string): Promise<GenericReportRun> {
  return request<GenericReportRun>(`/api/reports/${encodeURIComponent(id)}/run?organization=${encodeURIComponent(organization)}`, {
    headers: adminHeaders(session)
  });
}

// ---- Report Views (Phase 1 & 2) ----

export function getReportViews(
  session: LoginSession | null | undefined,
  filter?: { reportId?: string; organization?: string }
): Promise<ReportView[]> {
  const params = new URLSearchParams();
  if (filter?.reportId) params.set('reportId', filter.reportId);
  if (filter?.organization) params.set('organization', filter.organization);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request<ReportView[]>(`/api/report-views${suffix}`, { headers: viewHeaders(session) });
}

export function getReportView(session: LoginSession | null | undefined, id: string): Promise<ReportView> {
  return request<ReportView>(`/api/report-views/${encodeURIComponent(id)}`, { headers: viewHeaders(session) });
}

export function createReportView(
  session: LoginSession,
  input: { reportId: string; organization: string; name: string; description?: string; visibility?: 'private' | 'invite_only'; definition: ViewDefinition }
): Promise<ReportView> {
  return request<ReportView>('/api/report-views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...viewHeaders(session) },
    body: JSON.stringify(input)
  });
}

export function updateReportView(
  session: LoginSession,
  id: string,
  patch: { name?: string; description?: string; visibility?: 'private' | 'invite_only'; definition?: ViewDefinition; expectedVersion?: number }
): Promise<ReportView> {
  return request<ReportView>(`/api/report-views/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...viewHeaders(session) },
    body: JSON.stringify(patch)
  });
}

export function deleteReportView(session: LoginSession, id: string): Promise<void> {
  return request<void>(`/api/report-views/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: viewHeaders(session)
  });
}

export function getViewInvites(
  session: LoginSession | null | undefined,
  viewId: string
): Promise<ReportViewInvite[]> {
  return request<ReportViewInvite[]>(`/api/report-views/${encodeURIComponent(viewId)}/invites`, {
    headers: viewHeaders(session)
  });
}

export function getInboxInvites(
  session: LoginSession | null | undefined,
  status?: string
): Promise<ReportViewInvite[]> {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
  return request<ReportViewInvite[]>(`/api/report-views/invites${suffix}`, { headers: viewHeaders(session) });
}

export function createViewInvite(
  session: LoginSession,
  viewId: string,
  input: { inviteeId?: string; inviteeEmail?: string; inviteeName: string; role: 'viewer' | 'commenter' | 'editor' }
): Promise<ReportViewInvite> {
  return request<ReportViewInvite>(`/api/report-views/${encodeURIComponent(viewId)}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...viewHeaders(session) },
    body: JSON.stringify(input)
  });
}

export function updateViewInvite(
  session: LoginSession,
  viewId: string,
  inviteId: string,
  status: 'accepted' | 'declined' | 'revoked'
): Promise<ReportViewInvite> {
  return request<ReportViewInvite>(`/api/report-views/${encodeURIComponent(viewId)}/invites/${encodeURIComponent(inviteId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...viewHeaders(session) },
    body: JSON.stringify({ status })
  });
}

export function removeViewInvite(session: LoginSession, viewId: string, inviteId: string): Promise<void> {
  return request<void>(`/api/report-views/${encodeURIComponent(viewId)}/invites/${encodeURIComponent(inviteId)}`, {
    method: 'DELETE',
    headers: viewHeaders(session)
  });
}

export function getViewComments(
  session: LoginSession | null | undefined,
  viewId: string,
  limit = 50
): Promise<ReportViewComment[]> {
  return request<ReportViewComment[]>(`/api/report-views/${encodeURIComponent(viewId)}/comments?limit=${limit}`, {
    headers: viewHeaders(session)
  });
}

export function createViewComment(
  session: LoginSession,
  viewId: string,
  input: { body: string; rowKey?: string | null; parentId?: string | null }
): Promise<ReportViewComment> {
  return request<ReportViewComment>(`/api/report-views/${encodeURIComponent(viewId)}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...viewHeaders(session) },
    body: JSON.stringify(input)
  });
}

export function updateViewComment(
  session: LoginSession,
  viewId: string,
  commentId: string,
  body: string
): Promise<ReportViewComment> {
  return request<ReportViewComment>(`/api/report-views/${encodeURIComponent(viewId)}/comments/${encodeURIComponent(commentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...viewHeaders(session) },
    body: JSON.stringify({ body })
  });
}

export function deleteViewComment(session: LoginSession, viewId: string, commentId: string): Promise<void> {
  return request<void>(`/api/report-views/${encodeURIComponent(viewId)}/comments/${encodeURIComponent(commentId)}`, {
    method: 'DELETE',
    headers: viewHeaders(session)
  });
}

// ---- Person Favorites (one per person per user, first report wins) ----

export function getFavorites(
  session: LoginSession | null | undefined,
  filter?: { reportId?: string; organization?: string; search?: string; page?: number; pageSize?: number }
): Promise<{ data: PersonFavorite[]; total: number }> {
  const params = new URLSearchParams();
  if (filter?.reportId) params.set('reportId', filter.reportId);
  if (filter?.organization) params.set('organization', filter.organization);
  if (filter?.search) params.set('search', filter.search);
  if (filter?.page) params.set('page', String(filter.page));
  if (filter?.pageSize) params.set('pageSize', String(filter.pageSize));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request<{ data: PersonFavorite[]; total: number }>(`/api/favorites${suffix}`, { headers: viewHeaders(session) });
}

export function checkFavorites(
  session: LoginSession | null | undefined,
  personIds: string[]
): Promise<PersonFavoriteCheck[]> {
  if (personIds.length === 0) return Promise.resolve([]);
  const params = new URLSearchParams({ personIds: personIds.join(',') });
  return request<PersonFavoriteCheck[]>(`/api/favorites/check?${params.toString()}`, { headers: viewHeaders(session) });
}

export function createFavorite(
  session: LoginSession,
  input: { personId: string; employeeNumber?: string; personName: string; reportId?: string | null; reportTitle: string; organization: string; rowKey?: string | null }
): Promise<PersonFavorite> {
  return request<PersonFavorite>('/api/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...viewHeaders(session) },
    body: JSON.stringify(input)
  });
}

export function deleteFavorite(session: LoginSession, id: string): Promise<void> {
  return request<void>(`/api/favorites/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: viewHeaders(session)
  });
}

export function deleteFavoriteByKey(session: LoginSession, personId: string): Promise<void> {
  return request<void>(`/api/favorites/by-key/${encodeURIComponent(personId)}`, {
    method: 'DELETE',
    headers: viewHeaders(session)
  });
}
