import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { z } from 'zod';
import { fixtureRepositories } from './repositories/fixture-repository.js';
import { mysqlRepositories } from './repositories/mysql-repository.js';
import { tursoRepositories } from './repositories/turso-repository.js';
import type { Repositories } from './repositories/contracts.js';
import { authenticateFixtureUser } from './repositories/fixture-auth.js';
import { getDataSource } from './config.js';
import { isDbReady } from './db.js';
import { isDbReady as isTursoDbReady } from './db-turso.js';
import { openApiDocument } from './openapi.js';
import { viewDefinitionSchema } from './report-views.js';
import { reportHighlightRulesSchema } from './report-highlight.js';
import { validateSubreportSql } from './reports-sql.js';

const querySchema = z.object({
  search: z.string().trim().optional(),
  schoolId: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
});

const loginSchema = z.object({
  wakeId: z.string().trim().min(1),
  employeeId: z.string().trim().min(1)
});

const openPositionQuerySchema = z.object({
  organization: z.string().trim().min(1)
});

const reportSectionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
  isActive: z.coerce.boolean().optional()
});

const reportSectionPatchSchema = reportSectionSchema.partial();

const reportDefinitionSchema = z.object({
  sectionId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(150),
  description: z.string().trim().max(2000).optional().default(''),
  sqlQuery: z.string().trim().min(1).max(20000),
  status: z.enum(['active', 'inactive']).optional().default('inactive'),
  rowKeyColumn: z.string().trim().min(1).max(64).nullable().optional(),
  highlightRules: reportHighlightRulesSchema.optional(),
  subreportQuery: z.string().trim().max(20000).optional(),
  subreportKeyColumn: z.string().trim().min(1).max(64).nullable().optional(),
  columns: z.array(z.string().trim().min(1).max(64)).max(200).optional()
});

const reportDefinitionPatchSchema = reportDefinitionSchema.partial();

const reportListQuerySchema = z.object({
  sectionId: z.string().trim().optional(),
  includeInactive: z.coerce.boolean().optional().default(false)
});

const reportRunQuerySchema = z.object({
  organization: z.string().trim().min(1)
});

const validateSqlSchema = z.object({
  sqlQuery: z.string().trim().min(1).max(20000),
  subreport: z.boolean().optional()
});

/** Express 5 types route params as string | string[]; our ids are single segments. */
function routeId(value: unknown): string {
  return Array.isArray(value) ? (value[0] ?? '') : String(value ?? '');
}

// Admin identity for v1: the client sends the logged-in user's roles via the
// x-user-roles header (comma-separated). Writes require hr_admin. This keeps
// the fixture login flow working without a token round-trip; a bearer-token
// gate can replace it later without changing route shapes.
function callerRoles(request: express.Request): string[] {
  const header = request.header('x-user-roles') ?? '';
  return header.split(',').map((role) => role.trim()).filter(Boolean);
}

function callerName(request: express.Request): string {
  return request.header('x-user-name')?.trim() || 'admin';
}

function callerId(request: express.Request): string {
  return request.header('x-user-id')?.trim() || request.header('x-user-name')?.trim() || 'anonymous';
}

function callerEmail(request: express.Request): string | undefined {
  return request.header('x-user-email')?.trim() || undefined;
}

function isAdmin(request: express.Request): boolean {
  return callerRoles(request).includes('hr_admin');
}

function requireAdmin(request: express.Request, response: express.Response, next: express.NextFunction) {
  if (!isAdmin(request)) {
    response.status(403).json({ error: 'FORBIDDEN' });
    return;
  }
  next();
}

function stripSqlForReader<T extends { sqlQuery?: string; subreportQuery?: string }>(report: T, admin: boolean): T {
  if (admin) return report;
  const { sqlQuery: _omitted, subreportQuery: _omittedSub, ...rest } = report;
  return rest as T;
}

function repoErrorToStatus(error: unknown): { status: number; body: { error: string } } {
  const code = (error as { code?: string } | null)?.code ?? (error instanceof Error ? error.message : '');
  switch (code) {
    case 'TITLE_REQUIRED':
    case 'TITLE_TOO_LONG':
    case 'SQL_QUERY_REQUIRED':
    case 'SQL_QUERY_TOO_LONG':
    case 'MULTI_STATEMENT_NOT_ALLOWED':
    case 'ONLY_SELECT_ALLOWED':
    case 'FORBIDDEN_KEYWORD':
    case 'ORGANIZATION_SCOPE_REQUIRED':
    case 'SUBREPORT_SCOPE_REQUIRED':
    case 'SQL_EXPLAIN_FAILED':
    case 'SECTION_NOT_FOUND':
    case 'VIEW_NAME_REQUIRED':
    case 'VIEW_DEFINITION_INVALID':
    case 'INVITEE_REQUIRED':
    case 'COMMENT_BODY_REQUIRED':
    case 'HIGHLIGHT_RULE_INVALID':
    case 'PIN_REQUIRED':
      return { status: 400, body: { error: code } };
    case 'SECTION_TITLE_CONFLICT':
    case 'REPORT_TITLE_CONFLICT':
    case 'VIEW_NAME_CONFLICT':
    case 'INVITE_ALREADY_EXISTS':
    case 'VERSION_CONFLICT':
    case 'PIN_EXISTS':
      return { status: 409, body: { error: code } };
    case 'FORBIDDEN':
      return { status: 403, body: { error: code } };
    case 'VIEW_NOT_FOUND':
    case 'INVITE_NOT_FOUND':
    case 'COMMENT_NOT_FOUND':
      return { status: 404, body: { error: code } };
    default:
      return { status: 500, body: { error: 'INTERNAL_SERVER_ERROR' } };
  }
}

const positionPinInputSchema = z.object({
  posNumber: z.string().trim().min(1).max(64),
  posName: z.string().trim().min(1).max(200),
  organization: z.string().trim().min(1).max(200),
  incumbentName: z.string().trim().max(200).nullable().optional(),
  employeeNumber: z.string().trim().max(32).nullable().optional()
});

const positionCommentInputSchema = z.object({
  organization: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000)
});

export function createApp(repositories: Repositories = fixtureRepositories) {
  const application = express();
  application.use(express.json());

  application.post('/api/auth/login', async (request, response, next) => {
    try {
      const credentials = loginSchema.parse(request.body);
      const session = await authenticateFixtureUser(credentials.wakeId, credentials.employeeId);
      if (!session) {
        response.status(401).json({ error: 'INVALID_CREDENTIALS' });
        return;
      }
      response.json(session);
    } catch (error) {
      next(error);
    }
  });

  application.get('/api/health', async (_request, response) => {
    const dataSource = repositories === mysqlRepositories ? 'mysql' : repositories === tursoRepositories ? 'turso' : 'fixtures';
    const dbReady = dataSource === 'mysql' ? await isDbReady() : dataSource === 'turso' ? await isTursoDbReady() : false;
    response.json({ ok: true, dataSource, dbReady });
  });

  application.get('/api/people', async (request, response, next) => {
    try {
      const query = querySchema.parse(request.query);
      const search = query.search?.toLowerCase();
      const people = (await repositories.people.list()).filter((person) => {
        const matchesSearch = !search || [person.fullName, person.employeeNumber, person.organization]
          .some((value) => value.toLowerCase().includes(search));
        return matchesSearch && (!query.schoolId || person.organizationId === query.schoolId);
      });
      const start = (query.page - 1) * query.pageSize;
      response.json({
        data: people.slice(start, start + query.pageSize),
        page: query.page,
        pageSize: query.pageSize,
        total: people.length
      });
    } catch (error) {
      next(error);
    }
  });

  application.get('/api/people/:personId', async (request, response, next) => {
    try {
      const person = (await repositories.people.list()).find((candidate) => candidate.personId === request.params.personId);
      if (!person) {
        response.status(404).json({ error: 'PERSON_NOT_FOUND' });
        return;
      }
      response.json(person);
    } catch (error) {
      next(error);
    }
  });

  application.get('/api/people/:personId/record', async (request, response, next) => {
    try {
      const record = await repositories.personRecords.getByPersonId(request.params.personId);
      if (!record) {
        response.status(404).json({ error: 'PERSON_RECORD_NOT_FOUND' });
        return;
      }
      response.json(record);
    } catch (error) {
      next(error);
    }
  });

  application.get('/api/schools', async (_request, response, next) => {
    try {
      response.json(await repositories.schools.list());
    } catch (error) {
      next(error);
    }
  });

  application.get('/api/reports/open-positions', async (request, response, next) => {
    try {
      const query = openPositionQuerySchema.parse(request.query);
      const rows = await repositories.reports.openPositions(query.organization);
      response.json({
        organization: query.organization,
        columns: [
          'Pos. Starting', 'Pos. Ending', 'Name', 'Number', 'Account Code',
          'Months Available', 'Months Used', 'Classroom Assignment', 'Employee', 'Mailstop'
        ],
        rows
      });
    } catch (error) {
      next(error);
    }
  });

  // Read-only Position Details — any authenticated staff can view a position by
  // its 7-digit pos_number. Organization is required to scope the lookup.
  application.get('/api/positions/:posNumber', async (request, response, next) => {
    try {
      const query = openPositionQuerySchema.parse(request.query);
      const posNumber = routeId(request.params.posNumber);
      const details = await repositories.positions.getPositionDetails(posNumber, query.organization);
      if (!details) {
        response.status(404).json({ error: 'POSITION_NOT_FOUND' });
        return;
      }
      response.json(details);
    } catch (error) {
      next(error);
    }
  });

  // ---- Configurable reports (Settings page) ----

  application.get('/api/report-sections', async (request, response, next) => {
    try {
      const includeInactive = request.query.includeInactive === '1' && isAdmin(request);
      response.json(await repositories.reportSections.list(includeInactive));
    } catch (error) {
      next(error);
    }
  });

  application.post('/api/report-sections', requireAdmin, async (request, response, next) => {
    try {
      const input = reportSectionSchema.parse(request.body);
      const created = await repositories.reportSections.create({
        title: input.title,
        sortOrder: input.sortOrder,
        isActive: input.isActive
      });
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.patch('/api/report-sections/:id', requireAdmin, async (request, response, next) => {
    try {
      const patch = reportSectionPatchSchema.parse(request.body);
      const updated = await repositories.reportSections.update(routeId(request.params.id), {
        title: patch.title,
        sortOrder: patch.sortOrder,
        isActive: patch.isActive
      });
      if (!updated) {
        response.status(404).json({ error: 'SECTION_NOT_FOUND' });
        return;
      }
      response.json(updated);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.delete('/api/report-sections/:id', requireAdmin, async (request, response, next) => {
    try {
      const result = await repositories.reportSections.delete(routeId(request.params.id));
      if (!result.deleted) {
        response.status(result.reason === 'HAS_REPORTS' ? 409 : 404).json({
          error: result.reason === 'HAS_REPORTS' ? 'SECTION_HAS_REPORTS' : 'SECTION_NOT_FOUND'
        });
        return;
      }
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  application.get('/api/reports', async (request, response, next) => {
    try {
      const filter = reportListQuerySchema.parse(request.query);
      const admin = isAdmin(request);
      const reports = await repositories.reportDefinitions.list({
        sectionId: filter.sectionId,
        includeInactive: admin && (filter.includeInactive || request.query.includeInactive === '1')
      });
      response.json(reports.map((report) => stripSqlForReader(report, admin)));
    } catch (error) {
      next(error);
    }
  });

  application.post('/api/reports/validate', requireAdmin, async (request, response, next) => {
    try {
      const input = validateSqlSchema.parse(request.body);
      const result = input.subreport
        ? validateSubreportSql(input.sqlQuery)
        : await repositories.reportDefinitions.explain(input.sqlQuery);
      if (!result.ok) {
        response.status(400).json({ error: result.error });
        return;
      }
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  application.post('/api/reports', requireAdmin, async (request, response, next) => {
    try {
      const input = reportDefinitionSchema.parse(request.body);
      const created = await repositories.reportDefinitions.create({
        sectionId: input.sectionId,
        title: input.title,
        description: input.description ?? '',
        sqlQuery: input.sqlQuery,
        status: input.status ?? 'inactive',
        rowKeyColumn: input.rowKeyColumn ?? null,
        highlightRules: input.highlightRules,
        subreportQuery: input.subreportQuery,
        subreportKeyColumn: input.subreportKeyColumn ?? null,
        columns: input.columns,
        createdBy: callerName(request)
      });
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.get('/api/reports/:id', async (request, response, next) => {
    try {
      const report = await repositories.reportDefinitions.getById(routeId(request.params.id));
      if (!report) {
        response.status(404).json({ error: 'REPORT_NOT_FOUND' });
        return;
      }
      response.json(stripSqlForReader(report, isAdmin(request)));
    } catch (error) {
      next(error);
    }
  });

  application.patch('/api/reports/:id', requireAdmin, async (request, response, next) => {
    try {
      const patch = reportDefinitionPatchSchema.parse(request.body);
      const updated = await repositories.reportDefinitions.update(routeId(request.params.id), {
        sectionId: patch.sectionId,
        title: patch.title,
        description: patch.description,
        sqlQuery: patch.sqlQuery,
        status: patch.status,
        rowKeyColumn: patch.rowKeyColumn,
        highlightRules: patch.highlightRules,
        subreportQuery: patch.subreportQuery,
        subreportKeyColumn: patch.subreportKeyColumn ?? null,
        columns: patch.columns
      });
      if (!updated) {
        response.status(404).json({ error: 'REPORT_NOT_FOUND' });
        return;
      }
      response.json(updated);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.delete('/api/reports/:id', requireAdmin, async (request, response, next) => {
    try {
      const deleted = await repositories.reportDefinitions.delete(routeId(request.params.id));
      if (!deleted) {
        response.status(404).json({ error: 'REPORT_NOT_FOUND' });
        return;
      }
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  application.get('/api/reports/:id/run', async (request, response, next) => {
    try {
      const runQuery = reportRunQuerySchema.parse(request.query);
      const runId = routeId(request.params.id);
      const definition = await repositories.reportDefinitions.getById(runId);
      if (!definition) {
        response.status(404).json({ error: 'REPORT_NOT_FOUND' });
        return;
      }
      if (definition.status !== 'active' && !isAdmin(request)) {
        response.status(403).json({ error: 'REPORT_INACTIVE' });
        return;
      }
      const result = await repositories.reportDefinitions.run(runId, runQuery.organization);
      if (!result) {
        response.status(404).json({ error: 'REPORT_NOT_FOUND' });
        return;
      }
      response.json(result);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  // ---- Report Views (Phase 2) ----

  const reportViewCreateSchema = z.object({
    reportId: z.string().trim().min(1),
    organization: z.string().trim().min(1),
    name: z.string().trim().min(3).max(60),
    description: z.string().trim().max(200).optional().default(''),
    visibility: z.enum(['private', 'invite_only']).optional().default('private'),
    definition: viewDefinitionSchema
  });

  const reportViewPatchSchema = z.object({
    name: z.string().trim().min(3).max(60).optional(),
    description: z.string().trim().max(200).optional(),
    visibility: z.enum(['private', 'invite_only']).optional(),
    definition: viewDefinitionSchema.optional(),
    expectedVersion: z.number().int().min(1).optional()
  });

  const reportViewListQuerySchema = z.object({
    reportId: z.string().trim().optional(),
    organization: z.string().trim().optional()
  });

  const inviteCreateSchema = z.object({
    inviteeId: z.string().trim().optional(),
    inviteeEmail: z.string().trim().email().optional(),
    inviteeName: z.string().trim().min(1).max(120),
    role: z.enum(['viewer', 'commenter', 'editor'])
  });

  const inviteStatusSchema = z.object({
    status: z.enum(['accepted', 'declined', 'revoked'])
  });

  const commentCreateSchema = z.object({
    body: z.string().trim().min(1).max(2000),
    rowKey: z.string().trim().max(500).nullable().optional(),
    parentId: z.string().trim().min(1).nullable().optional()
  });

  const commentPatchSchema = z.object({
    body: z.string().trim().min(1).max(2000)
  });

  application.get('/api/report-views', async (request, response, next) => {
    try {
      const filter = reportViewListQuerySchema.parse(request.query);
      const views = await repositories.reportViews.list({
        reportId: filter.reportId,
        organization: filter.organization,
        callerId: callerId(request),
        callerEmail: callerEmail(request)
      });
      response.json(views);
    } catch (error) {
      next(error);
    }
  });

  application.post('/api/report-views', async (request, response, next) => {
    try {
      const input = reportViewCreateSchema.parse(request.body);
      const report = await repositories.reportDefinitions.getById(input.reportId);
      if (!report) {
        response.status(404).json({ error: 'REPORT_NOT_FOUND' });
        return;
      }
      const created = await repositories.reportViews.create({
        reportId: input.reportId,
        organization: input.organization,
        name: input.name,
        description: input.description ?? '',
        visibility: input.visibility ?? 'private',
        definition: input.definition,
        ownerId: callerId(request),
        ownerName: callerName(request)
      });
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.get('/api/report-views/invites', async (request, response, next) => {
    try {
      const status = request.query.status as string | undefined;
      const allowed = status === undefined || ['pending', 'accepted', 'declined', 'revoked'].includes(status);
      if (!allowed) {
        response.status(400).json({ error: 'VALIDATION_ERROR' });
        return;
      }
      const invites = await repositories.reportViewInvites.listInbox(
        callerId(request),
        callerEmail(request),
        status as import('./types.js').ReportViewInviteStatus | undefined
      );
      response.json(invites);
    } catch (error) {
      next(error);
    }
  });

  application.get('/api/report-views/:id', async (request, response, next) => {
    try {
      const view = await repositories.reportViews.getById(routeId(request.params.id), callerId(request), callerEmail(request));
      if (!view) {
        response.status(404).json({ error: 'VIEW_NOT_FOUND' });
        return;
      }
      response.json(view);
    } catch (error) {
      next(error);
    }
  });

  application.patch('/api/report-views/:id', async (request, response, next) => {
    try {
      const patch = reportViewPatchSchema.parse(request.body);
      const updated = await repositories.reportViews.update(routeId(request.params.id), patch, callerId(request));
      if (!updated) {
        response.status(404).json({ error: 'VIEW_NOT_FOUND' });
        return;
      }
      response.json(updated);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.delete('/api/report-views/:id', async (request, response, next) => {
    try {
      const deleted = await repositories.reportViews.delete(routeId(request.params.id), callerId(request));
      if (!deleted) {
        response.status(404).json({ error: 'VIEW_NOT_FOUND' });
        return;
      }
      response.status(204).end();
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.get('/api/report-views/:id/invites', async (request, response, next) => {
    try {
      const viewId = routeId(request.params.id);
      const view = await repositories.reportViews.getById(viewId, callerId(request), callerEmail(request));
      if (!view) {
        response.status(404).json({ error: 'VIEW_NOT_FOUND' });
        return;
      }
      const invites = await repositories.reportViewInvites.listByView(viewId, callerId(request));
      response.json(invites);
    } catch (error) {
      next(error);
    }
  });

  application.post('/api/report-views/:id/invites', async (request, response, next) => {
    try {
      const viewId = routeId(request.params.id);
      const view = await repositories.reportViews.getById(viewId, callerId(request), callerEmail(request));
      if (!view) {
        response.status(404).json({ error: 'VIEW_NOT_FOUND' });
        return;
      }
      if (view.ownerId !== callerId(request)) {
        response.status(403).json({ error: 'FORBIDDEN' });
        return;
      }
      const input = inviteCreateSchema.parse(request.body);
      if (!input.inviteeId && !input.inviteeEmail) {
        response.status(400).json({ error: 'INVITEE_REQUIRED' });
        return;
      }
      const created = await repositories.reportViewInvites.create({
        viewId,
        inviterId: callerId(request),
        inviteeId: input.inviteeId ?? null,
        inviteeEmail: input.inviteeEmail ?? null,
        inviteeName: input.inviteeName,
        role: input.role
      });
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.patch('/api/report-views/:id/invites/:inviteId', async (request, response, next) => {
    try {
      const input = inviteStatusSchema.parse(request.body);
      const updated = await repositories.reportViewInvites.updateStatus(
        routeId(request.params.id),
        routeId(request.params.inviteId),
        input.status,
        callerId(request),
        callerEmail(request)
      );
      if (!updated) {
        response.status(404).json({ error: 'INVITE_NOT_FOUND' });
        return;
      }
      response.json(updated);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.delete('/api/report-views/:id/invites/:inviteId', async (request, response, next) => {
    try {
      const removed = await repositories.reportViewInvites.remove(routeId(request.params.id), routeId(request.params.inviteId), callerId(request));
      if (!removed) {
        response.status(404).json({ error: 'INVITE_NOT_FOUND' });
        return;
      }
      response.status(204).end();
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.get('/api/report-views/:id/comments', async (request, response, next) => {
    try {
      const viewId = routeId(request.params.id);
      const limit = request.query.limit ? Number(request.query.limit) : 50;
      const comments = await repositories.reportViewComments.list(viewId, callerId(request), callerEmail(request), limit);
      response.json(comments);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.post('/api/report-views/:id/comments', async (request, response, next) => {
    try {
      const viewId = routeId(request.params.id);
      const view = await repositories.reportViews.getById(viewId, callerId(request), callerEmail(request));
      if (!view) {
        response.status(404).json({ error: 'VIEW_NOT_FOUND' });
        return;
      }
      // canComment: owner or invite with commenter/editor
      const isOwner = view.ownerId === callerId(request);
      let canComment = isOwner;
      if (!canComment) {
        const invites = await repositories.reportViewInvites.listByView(viewId, callerId(request));
        const invite = invites.find(
          (candidate) =>
            candidate.status === 'accepted' &&
            ((candidate.inviteeId !== null && candidate.inviteeId === callerId(request)) ||
              (candidate.inviteeEmail !== null && callerEmail(request) !== undefined && candidate.inviteeEmail.toLowerCase() === callerEmail(request)!.toLowerCase()))
        );
        canComment = !!invite && (invite.role === 'commenter' || invite.role === 'editor');
      }
      if (!canComment) {
        response.status(403).json({ error: 'FORBIDDEN' });
        return;
      }
      const input = commentCreateSchema.parse(request.body);
      const created = await repositories.reportViewComments.create({
        viewId,
        authorId: callerId(request),
        authorName: callerName(request),
        body: input.body,
        rowKey: input.rowKey ?? null,
        parentId: input.parentId ?? null
      });
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.patch('/api/report-views/:id/comments/:commentId', async (request, response, next) => {
    try {
      const input = commentPatchSchema.parse(request.body);
      const updated = await repositories.reportViewComments.update(
        routeId(request.params.id),
        routeId(request.params.commentId),
        input.body,
        callerId(request)
      );
      if (!updated) {
        response.status(404).json({ error: 'COMMENT_NOT_FOUND' });
        return;
      }
      response.json(updated);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  application.delete('/api/report-views/:id/comments/:commentId', async (request, response, next) => {
    try {
      const deleted = await repositories.reportViewComments.delete(routeId(request.params.id), routeId(request.params.commentId), callerId(request));
      if (!deleted) {
        response.status(404).json({ error: 'COMMENT_NOT_FOUND' });
        return;
      }
      response.status(204).end();
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) {
        response.status(mapped.status).json(mapped.body);
        return;
      }
      next(error);
    }
  });

  // ---- Position Pins (one per position per user) ----
  application.get('/api/pins', async (request, response, next) => {
    try {
      const userId = callerId(request);
      const organization = typeof request.query.organization === 'string' ? request.query.organization.trim() || undefined : undefined;
      const search = typeof request.query.search === 'string' ? request.query.search.trim() || undefined : undefined;
      const page = request.query.page ? Number(request.query.page) : 1;
      const pageSize = request.query.pageSize ? Number(request.query.pageSize) : 50;
      const result = await repositories.positionPins.list(userId, { organization, search, page, pageSize });
      response.json(result);
    } catch (error) { next(error); }
  });

  application.get('/api/pins/check', async (request, response, next) => {
    try {
      const userId = callerId(request);
      const raw = typeof request.query.keys === 'string' ? request.query.keys : '';
      const keys = raw.split(';').map((chunk) => {
        const [posNumber, organization] = chunk.split(':').map((s) => s.trim());
        return { posNumber, organization };
      }).filter((k) => k.posNumber && k.organization).slice(0, 100);
      const result = await repositories.positionPins.check(userId, keys);
      response.json(result);
    } catch (error) { next(error); }
  });

  application.post('/api/pins', async (request, response, next) => {
    try {
      const userId = callerId(request);
      const input = positionPinInputSchema.parse(request.body);
      const created = await repositories.positionPins.create(userId, {
        posNumber: input.posNumber,
        posName: input.posName,
        organization: input.organization,
        incumbentName: input.incumbentName ?? null,
        employeeNumber: input.employeeNumber ?? null
      });
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.delete('/api/pins/by-key/:posNumber', async (request, response, next) => {
    try {
      const userId = callerId(request);
      const posNumber = routeId(request.params.posNumber);
      const organization = typeof request.query.organization === 'string' ? request.query.organization.trim() : '';
      const removed = await repositories.positionPins.deleteByKey(userId, posNumber, organization);
      if (!removed) { response.status(404).json({ error: 'PIN_NOT_FOUND' }); return; }
      response.status(204).end();
    } catch (error) { next(error); }
  });

  application.delete('/api/pins/:id', async (request, response, next) => {
    try {
      const userId = callerId(request);
      const removed = await repositories.positionPins.delete(userId, routeId(request.params.id));
      if (!removed) { response.status(404).json({ error: 'PIN_NOT_FOUND' }); return; }
      response.status(204).end();
    } catch (error) { next(error); }
  });

  // ---- Position Notes (comments on a position) ----
  application.get('/api/positions/:posNumber/comments', async (request, response, next) => {
    try {
      const posNumber = routeId(request.params.posNumber);
      const organization = typeof request.query.organization === 'string' ? request.query.organization.trim() : '';
      const comments = await repositories.positionComments.list(posNumber, organization);
      response.json(comments);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.post('/api/positions/:posNumber/comments', async (request, response, next) => {
    try {
      const posNumber = routeId(request.params.posNumber);
      const input = positionCommentInputSchema.parse(request.body);
      // The path posNumber is the source of truth for which position gets the note.
      const created = await repositories.positionComments.create({
        posNumber,
        organization: input.organization,
        authorId: callerId(request),
        authorName: callerName(request),
        body: input.body
      });
      response.status(201).json(created);
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.delete('/api/positions/:posNumber/comments/:commentId', async (request, response, next) => {
    try {
      const posNumber = routeId(request.params.posNumber);
      const commentId = routeId(request.params.commentId);
      const removed = await repositories.positionComments.delete(commentId, callerId(request));
      if (!removed) { response.status(404).json({ error: 'COMMENT_NOT_FOUND' }); return; }
      response.status(204).end();
    } catch (error) {
      const mapped = repoErrorToStatus(error);
      if (mapped.status !== 500) { response.status(mapped.status).json(mapped.body); return; }
      next(error);
    }
  });

  application.get('/api/docs.json', (_request, response) => {
    response.json(openApiDocument);
  });
  application.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  application.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({ error: 'VALIDATION_ERROR', details: error.issues });
      return;
    }
    response.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
  });

  return application;
}

// Default `app` uses fixtures — deterministic, no network. Tests import this.
export const app = createApp();

// Server bootstrap: honors DATA_SOURCE (mysql | turso vs fixtures) so the
// running server can switch to a live/synthetic DB while tests stay on fixtures.
export function createRuntimeApp(): ReturnType<typeof createApp> {
  const dataSource = getDataSource();
  const repositories = dataSource === 'mysql' ? mysqlRepositories : dataSource === 'turso' ? tursoRepositories : fixtureRepositories;
  return createApp(repositories);
}
