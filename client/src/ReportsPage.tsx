import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Bookmark,
  Building2,
  Columns3,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  FileText,
  MessageSquare,
  Search,
  Settings,
  Share2,
  X
} from 'lucide-react';
import {
  checkFavorites,
  createFavorite,
  createReportView,
  createViewComment,
  createViewInvite,
  deleteFavoriteByKey,
  deleteReportView,
  getPeople,
  getReportViews,
  getReports,
  getReportSections,
  getViewComments,
  getViewInvites,
  runReport,
  updateReportView
} from './api';
import { exportGenericReport } from './reportExport';
import { exportGenericReportToPdf } from './reportPdf';
import { SchoolCombobox } from './SchoolCombobox';
import { loadLastReport, loadLastSchool, saveLastReport, saveLastSchool } from './lastRun';
import { formatRelativeTime, loadRecentRuns, recordRecentRun } from './recentRuns';
import type { RecentRun } from './recentRuns';
import {
  applyFilter,
  applySort,
  defaultViewDefinition,
  isViewDirty,
  normalizeViewDefinition,
  rowKeyForRow
} from './reportViews';
import type {
  GenericReportRun,
  HighlightColorId,
  LoginSession,
  ReportDefinition,
  ReportHighlightRule,
  ReportSection,
  ReportView,
  ReportViewComment,
  ReportViewInvite,
  School,
  ViewDefinition
} from './types';
import { HIGHLIGHT_PALETTE, resolveHighlightNeedle } from './types';

function ReportOption({ report, isAdmin, onOpen }: { report: ReportDefinition; isAdmin: boolean; onOpen: (report: ReportDefinition) => void }) {
  const active = report.status === 'active';
  return <button className="report-option" onClick={() => onOpen(report)} disabled={!active && !isAdmin} title={active ? 'Open report' : isAdmin ? 'Preview inactive report' : 'Report inactive'}>
    <span className="report-option-icon"><FileText size={19} /></span>
    <span className="report-option-copy"><strong>{report.title}</strong><span>{report.description}</span></span>
    <span className="report-option-meta">{active ? <span className="ready-badge">Ready</span> : <span className="pending-badge">Inactive</span>}</span>
    <ChevronRight className="report-option-arrow" size={18} aria-hidden="true" />
  </button>;
}

function draftStorageKey(reportId: string, organization: string): string {
  return `hr-report-view-draft:${reportId}:${organization}`;
}

function GenericReportView({
  result,
  session,
  onBack,
  onOpenRecord
}: {
  result: GenericReportRun;
  session: LoginSession | null;
  onBack: () => void;
  onOpenRecord?: (employeeNumber: string) => void;
}) {
  const declaredKey = (result as unknown as { report: { rowKeyColumn?: string | null } }).report.rowKeyColumn ?? null;
  const [views, setViews] = useState<ReportView[]>([]);
  const [activeView, setActiveView] = useState<ReportView | null>(null);
  const [draft, setDraft] = useState<ViewDefinition>(() => {
    try {
      const raw = sessionStorage.getItem(draftStorageKey(result.report.id, result.organization));
      if (raw) return normalizeViewDefinition(result.columns, JSON.parse(raw) as unknown);
    } catch { /* ignore */ }
    return defaultViewDefinition(result.columns);
  });
  const [filterInput, setFilterInput] = useState(draft.filterText);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saveVisibility, setSaveVisibility] = useState<'private' | 'invite_only'>('private');
  const [saveError, setSaveError] = useState('');
  const [saveSaving, setSaveSaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareInvitee, setShareInvitee] = useState('');
  const [shareRole, setShareRole] = useState<'viewer' | 'commenter' | 'editor'>('viewer');
  const [shareError, setShareError] = useState('');
  const [shareSaving, setShareSaving] = useState(false);
  const [invites, setInvites] = useState<ReportViewInvite[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<ReportViewComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentRowKey, setCommentRowKey] = useState<string | null>(null);
  const [activeHighlightFilterId, setActiveHighlightFilterId] = useState<string | null>(null);
  const filterDebounce = useRef<number | null>(null);
  const columnsRef = useRef<HTMLDivElement | null>(null);

  // Close the column picker when clicking outside it
  useEffect(() => {
    if (!columnsOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) setColumnsOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [columnsOpen]);

  // Normalize draft when columns change (e.g. report SQL changed)
  useEffect(() => {
    setDraft((prev) => normalizeViewDefinition(result.columns, prev));
  }, [result.columns]);

  // Persist draft to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(draftStorageKey(result.report.id, result.organization), JSON.stringify(draft));
    } catch { /* ignore */ }
  }, [draft, result.report.id, result.organization]);

  // Sync filter input with draft (when view loaded)
  useEffect(() => {
    setFilterInput(draft.filterText);
  }, [draft.filterText]);

  // Debounced filter
  function onFilterChange(value: string) {
    setFilterInput(value);
    if (filterDebounce.current) window.clearTimeout(filterDebounce.current);
    filterDebounce.current = window.setTimeout(() => {
      setDraft((prev) => ({ ...prev, filterText: value }));
    }, 150);
  }

  function clearFilter() {
    setFilterInput('');
    setDraft((prev) => ({ ...prev, filterText: '' }));
  }

  // Fetch views for this report+org
  useEffect(() => {
    if (!session) return;
    getReportViews(session, { reportId: result.report.id, organization: result.organization })
      .then(setViews)
      .catch(() => { /* ignore */ });
  }, [session, result.report.id, result.organization]);

  // Fetch invites/comments when active view changes
  useEffect(() => {
    if (!activeView || !session) {
      setInvites([]);
      setComments([]);
      return;
    }
    getViewInvites(session, activeView.id).then(setInvites).catch(() => setInvites([]));
    getViewComments(session, activeView.id).then(setComments).catch(() => setComments([]));
  }, [activeView, session]);

  const displayColumns = useMemo(
    () => draft.columnOrder.filter((col) => !draft.hiddenColumns.includes(col)),
    [draft.columnOrder, draft.hiddenColumns]
  );

  const hiddenColumns = useMemo(
    () => draft.hiddenColumns.filter((col) => draft.columnOrder.includes(col)),
    [draft.columnOrder, draft.hiddenColumns]
  );

  const sortedRows = useMemo(() => applySort(result.rows, draft.sort), [result.rows, draft.sort]);
  const filteredRows = useMemo(
    () => applyFilter(sortedRows, draft.filterText, displayColumns),
    [sortedRows, draft.filterText, displayColumns]
  );

  // Admin highlight rules for this report (first-match-wins)
  const adminHighlightRules: ReportHighlightRule[] = (result.report as unknown as { highlightRules?: ReportHighlightRule[] }).highlightRules ?? [];

  // Reset highlight filter when report changes or rule no longer exists
  useEffect(() => {
    if (activeHighlightFilterId && !adminHighlightRules.some((r) => r.id === activeHighlightFilterId)) {
      setActiveHighlightFilterId(null);
    }
  }, [adminHighlightRules, activeHighlightFilterId]);
  useEffect(() => {
    setActiveHighlightFilterId(null);
  }, [result.report.id, result.organization]);

  // ---- Favorites: subtle pin indicator + toggle per row (one per person globally, first report wins) ----
  const personIdCache = useRef<Map<string, string>>(new Map());
  const [favoritedPersonIds, setFavoritedPersonIds] = useState<Set<string>>(new Set());
  const [favoriteIdByPersonId, setFavoriteIdByPersonId] = useState<Map<string, string>>(new Map());

  function getEmpNumber(row: Record<string, unknown>): string {
    const raw = row['emp_number'] ?? row['empNumber'] ?? row['employee_number'] ?? row['employeeNumber'] ?? row['employee_no'] ?? row['emp_no'] ?? (() => {
      const k = Object.keys(row).find((c) => c.toLowerCase().replace(/[^a-z0-9]/g, '') === 'empnumber' || c.toLowerCase().replace(/[^a-z0-9]/g, '') === 'employeenumber');
      return k ? row[k] : '';
    })();
    return String(raw ?? '').trim();
  }

  function getPersonName(row: Record<string, unknown>): string {
    const candidates = ['full_name', 'Full name', 'fullName', 'person_name', 'Person', 'Name', 'name'];
    for (const key of candidates) {
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim()) return String(row[key]).trim();
    }
    const nameCol = displayColumns.find((c) => c.toLowerCase().includes('name')) ?? displayColumns[0];
    if (nameCol && row[nameCol] !== undefined) return String(row[nameCol] ?? '').trim();
    return getEmpNumber(row) || 'Unknown';
  }

  useEffect(() => {
    if (!session || result.rows.length === 0) {
      setFavoritedPersonIds(new Set());
      setFavoriteIdByPersonId(new Map());
      return;
    }
    let cancelled = false;
    async function loadFavorites() {
      try {
        const empNumbers = Array.from(new Set(result.rows.map((r) => getEmpNumber(r as Record<string, unknown>)).filter(Boolean)));
        if (empNumbers.length === 0) {
          if (!cancelled) {
            setFavoritedPersonIds(new Set());
            setFavoriteIdByPersonId(new Map());
          }
          return;
        }
        const toResolve = empNumbers.filter((emp) => !personIdCache.current.has(emp));
        await Promise.all(toResolve.map(async (emp) => {
          try {
            const res = await getPeople(emp, '');
            const person = res.data.find((p) => p.employeeNumber === emp) ?? res.data[0];
            if (person) personIdCache.current.set(emp, person.personId);
          } catch { /* ignore */ }
        }));
        const personIds = empNumbers.map((emp) => personIdCache.current.get(emp)).filter(Boolean) as string[];
        if (personIds.length === 0) {
          if (!cancelled) {
            setFavoritedPersonIds(new Set());
            setFavoriteIdByPersonId(new Map());
          }
          return;
        }
        const checks = await checkFavorites(session, personIds);
        if (cancelled) return;
        const favSet = new Set<string>();
        const idMap = new Map<string, string>();
        for (const c of checks) {
          if (c.favorited) {
            favSet.add(c.personId);
            if (c.favoriteId) idMap.set(c.personId, c.favoriteId);
          }
        }
        setFavoritedPersonIds(favSet);
        setFavoriteIdByPersonId(idMap);
      } catch {
        if (!cancelled) {
          setFavoritedPersonIds(new Set());
          setFavoriteIdByPersonId(new Map());
        }
      }
    }
    void loadFavorites();
    return () => { cancelled = true; };
  }, [session, result.rows, result.report.id, result.organization]);

  async function toggleFavorite(row: Record<string, unknown>, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    if (!session) return;
    const empNo = getEmpNumber(row);
    if (!empNo) return;
    let personId = personIdCache.current.get(empNo);
    if (!personId) {
      try {
        const res = await getPeople(empNo, '');
        const person = res.data.find((p) => p.employeeNumber === empNo) ?? res.data[0];
        if (!person) return;
        personId = person.personId;
        personIdCache.current.set(empNo, personId);
      } catch { return; }
    }
    const isFav = favoritedPersonIds.has(personId);
    const personName = getPersonName(row);
    const rowKey = rowKeyForRow(row, result.columns, declaredKey);
    // optimistic
    setFavoritedPersonIds((prev) => {
      const next = new Set(prev);
      if (isFav) next.delete(personId!);
      else next.add(personId!);
      return next;
    });
    try {
      if (isFav) {
        await deleteFavoriteByKey(session, personId);
        setFavoriteIdByPersonId((prev) => {
          const next = new Map(prev);
          next.delete(personId!);
          return next;
        });
      } else {
        const created = await createFavorite(session, {
          personId,
          employeeNumber: empNo,
          personName,
          reportId: result.report.id,
          reportTitle: result.report.title,
          organization: result.organization,
          rowKey
        });
        setFavoriteIdByPersonId((prev) => {
          const next = new Map(prev);
          next.set(personId!, created.id);
          return next;
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (!isFav && msg === 'FAVORITE_EXISTS') return;
      // revert
      setFavoritedPersonIds((prev) => {
        const next = new Set(prev);
        if (isFav) next.add(personId!);
        else next.delete(personId!);
        return next;
      });
    }
  }

  function ruleMatchesRow(rule: ReportHighlightRule, row: Record<string, unknown>): boolean {
    const raw = row[rule.column];
    const cell = raw === null || raw === undefined ? '' : String(raw).trim();
    const needle = resolveHighlightNeedle(rule.value);
    switch (rule.operator) {
      case 'eq': return cell.toLowerCase() === needle.toLowerCase();
      case 'neq': return cell.toLowerCase() !== needle.toLowerCase();
      case 'contains': return cell.toLowerCase().includes(needle.toLowerCase());
      case 'not_contains': return !cell.toLowerCase().includes(needle.toLowerCase());
      case 'is_empty': return cell === '';
      case 'is_not_empty': return cell !== '';
      default: return false;
    }
  }

  const activeHighlightRule = useMemo(
    () => adminHighlightRules.find((r) => r.id === activeHighlightFilterId) ?? null,
    [adminHighlightRules, activeHighlightFilterId]
  );

  const displayRows = useMemo(() => {
    if (!activeHighlightRule) return filteredRows;
    return filteredRows.filter((row) => ruleMatchesRow(activeHighlightRule, row as Record<string, unknown>));
  }, [filteredRows, activeHighlightRule]);

  function toggleHighlightFilter(ruleId: string) {
    setActiveHighlightFilterId((prev) => (prev === ruleId ? null : ruleId));
  }

  const isDirty = useMemo(() => {
    if (!activeView) return draft.filterText !== '' || draft.hiddenColumns.length > 0 || draft.sort !== null || JSON.stringify(draft.columnOrder) !== JSON.stringify(result.columns);
    return isViewDirty(draft, activeView.definition);
  }, [draft, activeView, result.columns]);

  function toggleSort(column: string) {
    setDraft((prev) => {
      if (prev.sort?.column === column) {
        if (prev.sort.dir === 'asc') return { ...prev, sort: { column, dir: 'desc' } };
        return { ...prev, sort: null };
      }
      return { ...prev, sort: { column, dir: 'asc' } };
    });
  }

  function showColumn(column: string) {
    setDraft((prev) => ({ ...prev, hiddenColumns: prev.hiddenColumns.filter((c) => c !== column) }));
  }

  function hideColumn(column: string) {
    setDraft((prev) => ({ ...prev, hiddenColumns: prev.hiddenColumns.includes(column) ? prev.hiddenColumns : [...prev.hiddenColumns, column] }));
  }

  function showAllColumns() {
    setDraft((prev) => ({ ...prev, hiddenColumns: [] }));
  }

  function loadView(view: ReportView) {
    setActiveView(view);
    setDraft(normalizeViewDefinition(result.columns, view.definition));
    setViewsOpen(false);
  }

  function resetToDefault() {
    setActiveView(null);
    setDraft(defaultViewDefinition(result.columns));
  }

  async function handleSaveView() {
    if (!session) return;
    const name = saveName.trim();
    if (name.length < 3) {
      setSaveError('Name must be at least 3 characters.');
      return;
    }
    setSaveSaving(true);
    setSaveError('');
    try {
      if (activeView) {
        const updated = await updateReportView(session, activeView.id, {
          name,
          description: saveDescription.trim(),
          visibility: saveVisibility,
          definition: draft,
          expectedVersion: activeView.version
        });
        setActiveView(updated);
        setViews((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
      } else {
        const created = await createReportView(session, {
          reportId: result.report.id,
          organization: result.organization,
          name,
          description: saveDescription.trim(),
          visibility: saveVisibility,
          definition: draft
        });
        setActiveView(created);
        setViews((prev) => [...prev, created]);
      }
      setSaveOpen(false);
      setSaveName('');
      setSaveDescription('');
    } catch (err) {
      const code = err instanceof Error ? err.message : 'UNKNOWN';
      if (code === 'VIEW_NAME_CONFLICT') setSaveError('A view with that name already exists for this report and organization.');
      else if (code === 'VERSION_CONFLICT') setSaveError('This view was updated elsewhere. Please reload and try again.');
      else setSaveError('Could not save view. Please try again.');
    } finally {
      setSaveSaving(false);
    }
  }

  function openSaveModal() {
    setSaveName(activeView?.name ?? '');
    setSaveDescription(activeView?.description ?? '');
    setSaveVisibility(activeView?.visibility ?? 'private');
    setSaveError('');
    setSaveOpen(true);
  }

  async function handleShare() {
    if (!session || !activeView) return;
    const raw = shareInvitee.trim();
    if (!raw) {
      setShareError('Enter a Wake ID or email.');
      return;
    }
    setShareSaving(true);
    setShareError('');
    try {
      const isEmail = raw.includes('@');
      const invite = await createViewInvite(session, activeView.id, {
        inviteeId: isEmail ? undefined : raw,
        inviteeEmail: isEmail ? raw : undefined,
        inviteeName: raw,
        role: shareRole
      });
      setInvites((prev) => [...prev, invite]);
      setShareInvitee('');
    } catch (err) {
      const code = err instanceof Error ? err.message : 'UNKNOWN';
      if (code === 'INVITE_ALREADY_EXISTS') setShareError('That person has already been invited.');
      else if (code === 'INVITEE_REQUIRED') setShareError('Enter a Wake ID or email.');
      else setShareError('Could not send invite.');
    } finally {
      setShareSaving(false);
    }
  }

  async function handleAddComment() {
    if (!session || !activeView) return;
    const body = commentBody.trim();
    if (!body) return;
    try {
      const created = await createViewComment(session, activeView.id, {
        body,
        rowKey: commentRowKey,
        parentId: null
      });
      setComments((prev) => [...prev, created]);
      setCommentBody('');
      setCommentRowKey(null);
    } catch {
      // ignore
    }
  }

  async function handleDeleteView() {
    if (!session || !activeView) return;
    try {
      await deleteReportView(session, activeView.id);
      setViews((prev) => prev.filter((v) => v.id !== activeView.id));
      resetToDefault();
    } catch { /* ignore */ }
  }

  // Admin highlight: first-match-wins over displayRows (View highlight overrides admin highlight)
  function adminHighlightForRow(row: Record<string, unknown>): { color: HighlightColorId; bg: string; border: string } | null {
    // When a specific highlight filter chip is active, that rule's color takes precedence
    // so the filtered rows are highlighted with the selected chip's color (e.g. clicking
    // "contract_code eq NEXTYEAR" colors those rows green, not the color of an earlier
    // matching rule like "contract_desc eq Terminating").
    if (activeHighlightRule && ruleMatchesRow(activeHighlightRule, row)) {
      const p = HIGHLIGHT_PALETTE[activeHighlightRule.color];
      return p ? { color: activeHighlightRule.color, bg: p.bg, border: p.border } : null;
    }
    // Otherwise first-match-wins across all configured rules
    for (const rule of adminHighlightRules) {
      if (ruleMatchesRow(rule, row)) {
        const p = HIGHLIGHT_PALETTE[rule.color];
        return p ? { color: rule.color, bg: p.bg, border: p.border } : null;
      }
    }
    return null;
  }

  const exportRun = {
    report: result.report,
    organization: result.organization,
    columns: displayColumns,
    rows: displayRows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const col of displayColumns) out[col] = (row as Record<string, unknown>)[col];
      return out;
    }),
    truncated: result.truncated,
    highlightRules: adminHighlightRules
  };

  return <div className="report-view">
    <div className="report-view-toolbar">
      <button className="back-button" onClick={onBack}><ArrowLeft size={17} />All reports</button>
      <div className="report-view-actions">
        <span className="report-view-meta">{displayRows.length} of {result.rows.length} rows{result.truncated ? ' (truncated)' : ''}</span>
        <button className="export-button" onClick={() => void exportGenericReport(exportRun)} aria-label="Export to Excel"><Download size={17} /><span><span className="export-label-long">Export to </span>Excel</span></button>
        <button className="export-button export-button--secondary" onClick={() => void exportGenericReportToPdf(exportRun)} aria-label="Export to PDF"><Download size={17} /><span><span className="export-label-long">Export to </span>PDF</span></button>
      </div>
      <div className="report-view-title"><p className="eyebrow">Report{result.report.sectionTitle ? ` — ${result.report.sectionTitle}` : ''}</p><h2>{result.report.title} <span className="report-scope">{result.organization}</span></h2></div>
    </div>

    {/* Views + filter bar */}
    <div className="report-views-bar">
      {/* Hidden per request — restore Default view / Save view by removing the false && wrapper */}
      {false && (
      <div className="report-views-bar-left">
        <div className="report-views-dropdown">
          <button className="report-views-trigger" onClick={() => setViewsOpen((v) => !v)} aria-expanded={viewsOpen} aria-haspopup="listbox">
            <Bookmark size={15} />
            <span>{activeView?.name ?? 'Default view'}</span>
            <ChevronDown size={14} className={viewsOpen ? 'chevron-open' : ''} />
          </button>
          {viewsOpen && (
            <div className="report-views-menu" role="listbox">
              <button role="option" className={`report-views-option ${!activeView ? 'active' : ''}`} onClick={resetToDefault}>
                <span>Default view</span>
                {!activeView && <Check size={14} />}
              </button>
              {views.length === 0 ? (
                <span className="report-views-empty">No saved views for this report.</span>
              ) : (
                views.map((view) => (
                  <button
                    key={view.id}
                    role="option"
                    className={`report-views-option ${activeView?.id === view.id ? 'active' : ''}`}
                    onClick={() => loadView(view)}
                  >
                    <span>{view.name}</span>
                    {activeView?.id === view.id && <Check size={14} />}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <button className={`export-button ${isDirty ? 'export-button--dirty' : ''}`} onClick={openSaveModal}>
          <Bookmark size={15} />{activeView ? 'Update view' : 'Save view'}{isDirty ? ' •' : ''}
        </button>
        {activeView && (
          <>
            <button className="icon-button subtle" onClick={() => setShareOpen(true)} aria-label="Share view" title="Share view"><Share2 size={16} /></button>
            <button className="icon-button subtle" onClick={() => setCommentsOpen(true)} aria-label="Comments" title="Comments">
              <MessageSquare size={16} />
              {comments.length > 0 && <span className="badge-count">{comments.length}</span>}
            </button>
            <button className="icon-button subtle" onClick={() => void handleDeleteView()} aria-label="Delete view" title="Delete view"><X size={16} /></button>
          </>
        )}
      </div>
      )}
      <div className="report-filter-row">
        <label className="report-filter-input">
          <Search size={15} aria-hidden="true" />
          <input
            placeholder="Filter rows…"
            value={filterInput}
            onChange={(e) => onFilterChange(e.target.value)}
            aria-label="Filter rows"
          />
          {filterInput && (
            <button className="field-clear" onClick={clearFilter} aria-label="Clear filter"><X size={14} /></button>
          )}
        </label>
        <div className="report-columns-dropdown" ref={columnsRef}>
          <button
            className="report-columns-trigger"
            onClick={() => setColumnsOpen((v) => !v)}
            aria-expanded={columnsOpen}
            aria-haspopup="listbox"
            aria-label="Choose columns"
          >
            <Columns3 size={15} />
            <span>Columns</span>
            <ChevronDown size={14} className={columnsOpen ? 'chevron-open' : ''} />
          </button>
          {columnsOpen && (
            <div className="report-columns-menu" role="listbox" aria-label="Columns">
              <div className="report-columns-menu-head">
                <span>{displayColumns.length} of {result.columns.length} shown</span>
                <button className="link-button" onClick={showAllColumns}>Show all</button>
              </div>
              {result.columns.map((column) => {
                const visible = !hiddenColumns.includes(column);
                return (
                  <button
                    key={column}
                    role="option"
                    aria-selected={visible}
                    className={`report-columns-option ${visible ? 'active' : ''}`}
                    onClick={() => (visible ? hideColumn(column) : showColumn(column))}
                  >
                    <span className="report-columns-check">{visible && <Check size={14} />}</span>
                    <span className="report-columns-name">{column}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <span className="report-filter-count">
          {displayRows.length === result.rows.length
            ? `${displayRows.length} rows`
            : `Showing ${displayRows.length} of ${result.rows.length} rows`}
          {activeHighlightRule && (
            <span className="report-filter-highlight-label"> · filtered by <em>{activeHighlightRule.column} {activeHighlightRule.operator} "{activeHighlightRule.value}"</em></span>
          )}
          {displayRows.length === 0 && filterInput && (
            <button className="link-button" onClick={clearFilter}>Clear text filter</button>
          )}
          {displayRows.length === 0 && activeHighlightRule && (
            <button className="link-button" onClick={() => setActiveHighlightFilterId(null)}>Clear highlight filter</button>
          )}
        </span>
      </div>
      {hiddenColumns.length > 0 && (
        <div className="report-hidden-pill">
          <span>Hidden columns ({hiddenColumns.length})</span>
          {hiddenColumns.map((col) => (
            <button key={col} className="report-hidden-chip" onClick={() => showColumn(col)} title={`Show ${col}`}>
              {col} <X size={12} />
            </button>
          ))}
          <button className="link-button" onClick={showAllColumns}>Show all</button>
        </div>
      )}
      {adminHighlightRules.length > 0 && (
        <div className="highlight-legend" aria-label="Row highlighting legend">
          {adminHighlightRules.map((rule) => {
            const p = HIGHLIGHT_PALETTE[rule.color];
            if (!p) return null;
            const label = rule.operator === 'is_empty' || rule.operator === 'is_not_empty'
              ? `${rule.column} ${rule.operator.replace('_', ' ')}`
              : `${rule.column} ${rule.operator} "${rule.value}"`;
            const active = activeHighlightFilterId === rule.id;
            return (
              <button
                key={rule.id}
                type="button"
                className={`highlight-legend-chip ${active ? 'highlight-legend-chip--active' : ''}`}
                data-color={rule.color}
                style={{ background: p.bg, borderColor: p.border }}
                title={active ? `${label} — click to show all rows` : `${label} — click to filter` }
                aria-pressed={active}
                onClick={() => toggleHighlightFilter(rule.id)}
              >
                {label}
              </button>
            );
          })}
          {activeHighlightRule && (
            <button type="button" className="link-button" onClick={() => setActiveHighlightFilterId(null)}>Show all</button>
          )}
        </div>
      )}
    </div>

    {result.columns.length === 0 || (displayRows.length === 0 && !filterInput && !activeHighlightRule)
      ? <div className="empty-state"><BarChart3 size={26} /><p>{filterInput ? 'No rows match your filter.' : 'No rows returned for this organization.'}</p></div>
      : displayRows.length === 0
        ? <div className="empty-state"><BarChart3 size={26} /><p>No rows match your filter.</p>
            {filterInput && <button className="link-button" onClick={clearFilter}>Clear text filter</button>}
            {activeHighlightRule && <button className="link-button" onClick={() => setActiveHighlightFilterId(null)}>Clear highlight filter</button>}
          </div>
        : <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr>
                <th className="report-pin-col-head" aria-hidden="true" />
                {displayColumns.map((column) => (
                  <th
                    key={column}
                    onClick={() => toggleSort(column)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort(column); } }}
                    aria-label={`Sort by ${column}`}
                    title="Click to sort"
                    className="report-th-clickable"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, index) => {
                const key = rowKeyForRow(row as Record<string, unknown>, result.columns, declaredKey);
                const adminHl = adminHighlightForRow(row as Record<string, unknown>);
                const bg = adminHl?.bg;
                const adminClass = adminHl ? ` row-highlight row-highlight--admin row-highlight--${adminHl.color}` : '';
                const record = row as Record<string, unknown>;
                const empNo = getEmpNumber(record);
                const clickable = Boolean(empNo && onOpenRecord);
                const personIdForRow = personIdCache.current.get(empNo);
                const isFavorited = personIdForRow ? favoritedPersonIds.has(personIdForRow) : false;
                const nameCol = displayColumns.find((c) => c.toLowerCase().includes('name')) ?? displayColumns[0];
                return (
                  <tr
                    key={`${key}-${index}`}
                    className={`report-card${adminClass}${clickable ? ' report-row--clickable' : ''}`}
                    style={bg ? { background: bg, borderLeft: `4px solid ${adminHl.border}` } : undefined}
                    title={clickable ? `Open employee record for ${empNo}` : adminHl ? `Highlighted ${adminHl.color}` : undefined}
                    onClick={clickable ? () => onOpenRecord!(empNo) : undefined}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenRecord!(empNo); } } : undefined}
                  >
                    {session && empNo ? (
                      <td className="report-pin-cell" aria-label="Pin to Favorites">
                        <button
                          type="button"
                          className={`report-pin-toggle ${isFavorited ? 'report-pin-toggle--active' : ''}`}
                          onClick={(e) => void toggleFavorite(record, e)}
                          aria-label={isFavorited ? 'Remove from Favorites' : 'Pin to Favorites'}
                          title={isFavorited ? 'Favorited — click to remove' : 'Pin to Favorites'}
                          aria-pressed={isFavorited}
                        >
                          <Bookmark size={16} fill={isFavorited ? 'currentColor' : 'none'} />
                        </button>
                      </td>
                    ) : null}
                    {displayColumns.map((column) => (
                      <td key={column} data-label={column}>
                        <span style={column === nameCol ? { display: 'inline-flex', alignItems: 'center', gap: 6 } : undefined}>
                          {record[column] === null || record[column] === undefined ? '' : String(record[column])}
                        </span>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>}

    {/* Save view modal */}
    {saveOpen && (
      <>
        <button className="settings-drawer-scrim" onClick={() => setSaveOpen(false)} aria-label="Close save view" />
        <div className="settings-editor settings-drawer" role="dialog" aria-modal="true" aria-label="Save view">
          <div className="settings-drawer-heading">
            <h3>{activeView ? 'Update view' : 'Save view'}</h3>
            <button className="icon-button subtle" onClick={() => setSaveOpen(false)} aria-label="Close"><X size={18} /></button>
          </div>
          {saveError && <div className="notice error"><AlertCircle size={16} /><span>{saveError}</span></div>}
          <label className="settings-field">
            View name
            <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. My filtered view" maxLength={60} />
          </label>
          <label className="settings-field">
            Description
            <input value={saveDescription} onChange={(e) => setSaveDescription(e.target.value)} placeholder="Optional" maxLength={200} />
          </label>
          <label className="settings-field">
            Visibility
            <select value={saveVisibility} onChange={(e) => setSaveVisibility(e.target.value as 'private' | 'invite_only')}>
              <option value="private">Private (only you)</option>
              <option value="invite_only">Shared by invite</option>
            </select>
          </label>
          <div className="settings-actions">
            <button className="back-button" onClick={() => setSaveOpen(false)}>Cancel</button>
            <button className="export-button" onClick={() => void handleSaveView()} disabled={saveSaving}>
              {saveSaving ? 'Saving…' : activeView ? 'Update' : 'Save'}
            </button>
          </div>
        </div>
      </>
    )}

    {/* Share modal */}
    {shareOpen && activeView && (
      <>
        <button className="settings-drawer-scrim" onClick={() => setShareOpen(false)} aria-label="Close share" />
        <div className="settings-editor settings-drawer" role="dialog" aria-modal="true" aria-label="Share view">
          <div className="settings-drawer-heading">
            <h3>Share view</h3>
            <button className="icon-button subtle" onClick={() => setShareOpen(false)} aria-label="Close"><X size={18} /></button>
          </div>
          {shareError && <div className="notice error"><AlertCircle size={16} /><span>{shareError}</span></div>}
          <div className="settings-field">
            <span>Invite by Wake ID or email</span>
            <div className="settings-form-row">
              <input value={shareInvitee} onChange={(e) => setShareInvitee(e.target.value)} placeholder="Wake ID or email" style={{ flex: 1 }} />
              <select value={shareRole} onChange={(e) => setShareRole(e.target.value as typeof shareRole)}>
                <option value="viewer">Can view</option>
                <option value="commenter">Can comment</option>
                <option value="editor">Can edit</option>
              </select>
              <button className="export-button" onClick={() => void handleShare()} disabled={shareSaving}>
                {shareSaving ? 'Sending…' : 'Invite'}
              </button>
            </div>
          </div>
          {invites.length > 0 && (
            <div className="settings-preview">
              <h4>Invites</h4>
              <ul className="report-invite-list">
                {invites.map((invite) => (
                  <li key={invite.id} className="report-invite-item">
                    <span>{invite.inviteeName}</span>
                    <span className="report-invite-role">{invite.role}</span>
                    <span className={`report-invite-status report-invite-status--${invite.status}`}>{invite.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </>
    )}

    {/* Comments drawer */}
    {commentsOpen && activeView && (
      <>
        <button className="record-drawer-scrim" onClick={() => setCommentsOpen(false)} aria-label="Close comments" />
        <div className="record-drawer" role="dialog" aria-modal="true" aria-label="Comments">
          <div className="record-drawer-heading">
            <h3>Comments {comments.length > 0 && `(${comments.length})`}</h3>
            <button className="icon-button subtle" onClick={() => setCommentsOpen(false)} aria-label="Close"><X size={18} /></button>
          </div>
          {commentRowKey && (
            <div className="notice"><span>Replying to row: {commentRowKey}</span><button className="field-clear" onClick={() => setCommentRowKey(null)}><X size={14} /></button></div>
          )}
          <div className="report-comments-list">
            {comments.length === 0 ? (
              <p className="report-comments-empty">No comments yet.</p>
            ) : (
              comments.map((comment) => (
                <div key={comment.id} className="report-comment">
                  <div className="report-comment-head">
                    <strong>{comment.authorName}</strong>
                    <span className="report-comment-time">{new Date(comment.createdAt).toLocaleString()}</span>
                  </div>
                  {comment.rowKey && <span className="report-comment-row">↳ Row: {comment.rowKey}</span>}
                  <p className="report-comment-body">{comment.body}</p>
                </div>
              ))
            )}
          </div>
          <div className="report-comment-composer">
            <textarea
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Add a comment…"
              rows={3}
              maxLength={2000}
            />
            <button className="export-button" onClick={() => void handleAddComment()} disabled={!commentBody.trim()}>
              Post comment
            </button>
          </div>
        </div>
      </>
    )}
  </div>;
}

export function ReportsPage({ schools, session, onManage, onOpenRecord, favoritesNav, onFavoritesNavConsumed }: { schools: School[]; session: LoginSession | null; onManage?: () => void; onOpenRecord?: (employeeNumber: string) => void; favoritesNav?: { reportId: string; organization: string } | null; onFavoritesNavConsumed?: () => void }) {
  const [schoolId, setSchoolId] = useState('');
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [reports, setReports] = useState<ReportDefinition[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [activeReport, setActiveReport] = useState<ReportDefinition | null>(null);
  const [result, setResult] = useState<GenericReportRun | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>(() => loadRecentRuns(session?.user.id ?? ''));

  const isAdmin = session?.user.roles.includes('hr_admin') ?? false;
  const selectedSchool = schools.find((school) => school.id === schoolId) ?? null;
  const userId = session?.user.id ?? '';

  // Default to the user's last school (a school is required before a report can run).
  // Prefer the saved school when it still exists in the list; otherwise first school.
  useEffect(() => {
    if (!schoolId && schools.length > 0) {
      const saved = loadLastSchool(userId);
      const savedSchool = saved ? schools.find((school) => school.id === saved) : null;
      setSchoolId(savedSchool?.id ?? schools[0].id);
    }
  }, [schools, schoolId, userId]);

  // Persist the school selection per user.
  useEffect(() => {
    if (schoolId) saveLastSchool(userId, schoolId);
  }, [schoolId, userId]);

  // Persist the newly-opened report per user.
  useEffect(() => {
    if (activeReport) saveLastReport(userId, activeReport.id);
  }, [activeReport, userId]);

  useEffect(() => {
    setCatalogLoading(true);
    setCatalogError('');
    Promise.all([
      getReportSections(session, isAdmin),
      getReports(session, undefined, isAdmin)
    ])
      .then(([nextSections, nextReports]) => {
        setSections(nextSections);
        setReports(nextReports);
      })
      .catch(() => setCatalogError('The report catalog could not be loaded.'))
      .finally(() => setCatalogLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  useEffect(() => {
    if (!activeReport || !selectedSchool) {
      setResult(null);
      return;
    }
    setReportLoading(true);
    setReportError('');
    runReport(session, activeReport.id, selectedSchool.name)
      .then((run) => setResult(run))
      .catch((failure: unknown) => setReportError(failure instanceof Error && failure.message === 'REPORT_INACTIVE'
        ? 'This report is inactive. An admin can preview it from Settings.'
        : 'The report could not be loaded.'))
      .finally(() => setReportLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeReport?.id, selectedSchool?.name]);

  // Record each successful run into the user's recent-runs list (client v0).
  useEffect(() => {
    if (!result) return;
    setRecentRuns(recordRecentRun(userId, {
      reportId: result.report.id,
      reportTitle: result.report.title,
      organization: result.organization
    }));
  }, [result?.report.id, result?.organization, userId]);

  function openReport(reportDefinition: ReportDefinition) {
    setActiveReport(reportDefinition);
    setResult(null);
    setReportError('');
  }

  function backToCatalog() {
    setActiveReport(null);
    setResult(null);
    setReportError('');
  }

  // One-click re-run from the recent-runs strip: locate the report in the catalog
  // (by id) and the school (by name), then open it with that school selected.
  function runFromRecent(run: RecentRun) {
    const definition = reports.find((report) => report.id === run.reportId);
    if (!definition) return;
    const school = schools.find((school) => school.name === run.organization);
    if (school) setSchoolId(school.id);
    setActiveReport(definition);
    setResult(null);
    setReportError('');
  }

  const visibleReports = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return reports;
    return reports.filter((report) => `${report.title} ${report.description}`.toLowerCase().includes(needle));
  }, [reports, filter]);

  if (activeReport) {
    if (reportLoading) return <section className="reports-page"><div className="empty-state"><span className="loader" />Loading {activeReport.title}</div></section>;
    if (reportError) return <section className="reports-page"><div className="notice error"><AlertCircle size={18} /><span>{reportError}</span></div><button className="back-button" onClick={backToCatalog}><ArrowLeft size={17} />All reports</button></section>;
    if (result) return <section className="reports-page"><GenericReportView result={result} session={session} onBack={backToCatalog} onOpenRecord={onOpenRecord} /></section>;
    return <section className="reports-page"><div className="empty-state"><AlertCircle size={26} /><p>Select a school to run the report.</p></div><button className="back-button" onClick={backToCatalog}><ArrowLeft size={17} />All reports</button></section>;
  }

  return <section className="reports-page" aria-labelledby="reports-title">
    <div className="reports-page-heading">
      <div><p className="eyebrow">Report center</p><h2 id="reports-title">Choose a report.</h2><p className="reports-intro">Browse the available HR reports and spreadsheet exports. Select a school to filter report results.</p></div>
      <div className="report-count"><strong>{reports.length}</strong><span>report options</span></div>
    </div>
    {isAdmin && onManage && <div className="notice"><Settings size={18} /><span>Admins configure sections and reports under Settings.</span><button className="back-button" onClick={onManage}>Manage in Settings</button></div>}
    <div className="report-toolbar">
      <SchoolCombobox
        schools={schools}
        value={schoolId}
        onChange={setSchoolId}
        emptyLabel="Select a school…"
        ariaLabel="Select school"
        leadingIcon={<Building2 size={17} aria-hidden="true" />}
      />
      <label className="report-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Filter reports</span><input placeholder="Filter reports" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
    </div>
    {recentRuns.length > 0 && <div className="recent-runs" aria-label="Recently run">
      <div className="recent-runs-title"><span className="recent-runs-icon"><Clock size={16} aria-hidden="true" /></span>Recently run</div>
      <div className="recent-runs-strip">{recentRuns.map((run) => (
        <button className="recent-run-chip" key={`${run.reportId}:${run.organization}`} onClick={() => runFromRecent(run)}>
          <span className="recent-run-name">{run.reportTitle}</span>
          <span className="recent-run-org">{run.organization}</span>
          <span className="recent-run-meta">{formatRelativeTime(run.ranAt)}</span>
        </button>
      ))}</div>
    </div>}
    {catalogError && <div className="notice error"><AlertCircle size={18} /><span>{catalogError}</span></div>}
    {catalogLoading
      ? <div className="empty-state"><span className="loader" />Loading reports</div>
      : <div className="report-categories">{sections.map((section) => {
        const sectionReports = visibleReports.filter((report) => report.sectionId === section.id);
        if (sectionReports.length === 0) return null;
        return <section className="report-category" key={section.id}><div className="report-category-heading"><span className="category-icon"><BarChart3 size={17} /></span><h3>{section.title}</h3><span>{sectionReports.length} options</span></div><div className="report-options">{sectionReports.map((report) => <ReportOption key={report.id} report={report} isAdmin={isAdmin} onOpen={openReport} />)}</div></section>;
      })}</div>}
  </section>;
}
