import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Archive, CheckCircle2, GripVertical, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { createReport, createReportSection, getReports, getReportSections, runReport, updateReport, updateReportSection, validateReportSql } from './api';
import type { HighlightColorId, HighlightOperator, LoginSession, ReportDefinition, ReportHighlightRule, ReportSection, School } from './types';
import { HIGHLIGHT_PALETTE, resolveHighlightNeedle } from './types';

type Tab = 'sections' | 'reports';

function errorMessage(failure: unknown, fallback: string): string {
  if (failure instanceof Error) {
    switch (failure.message) {
      case 'FORBIDDEN': return 'Admin access is required.';
      case 'TITLE_REQUIRED': return 'A title is required.';
      case 'SECTION_TITLE_CONFLICT': return 'A section with that title already exists.';
      case 'REPORT_TITLE_CONFLICT': return 'A report with that title already exists in this section.';
      case 'SECTION_NOT_FOUND': return 'The selected section no longer exists.';
      case 'SECTION_HAS_REPORTS': return 'This section still has reports. Move or archive them first.';
      case 'REPORT_NOT_FOUND': return 'The report no longer exists.';
      case 'SQL_REQUIRED': return 'A SQL query is required.';
      case 'SQL_QUERY_TOO_LONG': return 'The SQL query is too long.';
      case 'ONLY_SELECT_ALLOWED': return 'Only a single SELECT or WITH query is allowed.';
      case 'MULTI_STATEMENT_NOT_ALLOWED': return 'Multiple statements are not allowed.';
      case 'FORBIDDEN_KEYWORD': return 'The query uses a forbidden keyword (e.g. INSERT, UPDATE, DELETE, DROP).';
      case 'ORGANIZATION_SCOPE_REQUIRED': return 'The query must reference the :organization bind parameter.';
      default: return failure.message.startsWith('HTTP_') ? fallback : failure.message;
    }
  }
  return fallback;
}

function SectionsTab({ session, sections, refresh }: { session: LoginSession; sections: ReportSection[]; refresh: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  async function addSection() {
    setNotice('');
    setError('');
    try {
      await createReportSection(session, { title: title.trim(), sortOrder: sections.length + 1 });
      setTitle('');
      setNotice('Section added.');
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure, 'The section could not be added.'));
    }
  }

  async function saveRename(id: string) {
    setNotice('');
    setError('');
    try {
      await updateReportSection(session, id, { title: editingTitle.trim() });
      setEditingId(null);
      setNotice('Section renamed.');
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure, 'The section could not be renamed.'));
    }
  }

  async function archiveSection(id: string) {
    if (!window.confirm('Archive this section? It will be hidden from the catalog. Move or archive its reports first.')) return;
    setNotice('');
    setError('');
    try {
      await updateReportSection(session, id, { isActive: false });
      setNotice('Section archived.');
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure, 'The section could not be archived.'));
    }
  }

  return <div className="settings-panel">
    {notice && <div className="notice success"><CheckCircle2 size={18} /><span>{notice}</span></div>}
    {error && <div className="notice error"><AlertCircle size={18} /><span>{error}</span></div>}
    <div className="settings-form-row">
      <label className="settings-field"><span>New section title</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Attendance" /></label>
      <button className="export-button" onClick={() => void addSection()} disabled={!title.trim()}><Plus size={17} />Add section</button>
    </div>
    <div className="settings-table-wrap">
      <table className="report-table sections-table">
        <thead><tr><th>Title</th><th>Reports</th><th>Order</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{sections.map((section) => <tr key={section.id} className="report-card">
          <td data-label="Title">{editingId === section.id
            ? <input value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} />
            : <span>{section.title}</span>}</td>
          <td data-label="Reports"><span>{section.reportCount ?? 0}</span></td>
          <td data-label="Order"><span>{section.sortOrder}</span></td>
          <td data-label="Status"><span>{section.isActive ? 'Active' : 'Inactive'}</span></td>
          <td data-label="Actions"><span className="settings-actions">
            {editingId === section.id
              ? <><button className="back-button" onClick={() => void saveRename(section.id)}>Save</button><button className="back-button" onClick={() => setEditingId(null)}>Cancel</button></>
              : <button className="back-button" onClick={() => { setEditingId(section.id); setEditingTitle(section.title); }}><Pencil size={15} />Rename</button>}
            <button className="back-button" onClick={() => void archiveSection(section.id)}><Archive size={15} />Archive</button>
          </span></td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

const HIGHLIGHT_OPERATORS: { value: HighlightOperator; label: string }[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
];

function RowHighlightingEditor({
  rules,
  onChange,
  columns,
}: {
  rules: ReportHighlightRule[];
  onChange: (next: ReportHighlightRule[]) => void;
  columns: string[];
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function addRule() {
    if (rules.length >= 10) return;
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    onChange([...rules, { id, column: columns[0] ?? '', operator: 'eq' as HighlightOperator, value: '', color: 'pastel_red' as HighlightColorId }]);
  }

  function updateRule(index: number, patch: Partial<ReportHighlightRule>) {
    const next = rules.slice();
    next[index] = { ...next[index], ...patch } as ReportHighlightRule;
    // Clear value when switching to is_empty / is_not_empty
    if (patch.operator === 'is_empty' || patch.operator === 'is_not_empty') next[index].value = '';
    onChange(next);
  }

  function removeRule(index: number) {
    onChange(rules.filter((_, i) => i !== index));
  }

  function moveRule(from: number, to: number) {
    if (to < 0 || to >= rules.length) return;
    const next = rules.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }

  function onDragStart(index: number) { setDragIndex(index); }
  function onDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
  }
  function onDrop(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    moveRule(dragIndex, index);
    setDragIndex(null);
  }

  if (rules.length === 0) {
    return <div className="highlight-empty">
      <p>No highlighting rules. Rows will render without tint.</p>
      <button className="back-button" onClick={addRule}><Plus size={15} />Add rule</button>
    </div>;
  }

  return <div className="highlight-rules">
    {rules.map((rule, index) => {
      const needsValue = rule.operator !== 'is_empty' && rule.operator !== 'is_not_empty';
      const palette = HIGHLIGHT_PALETTE[rule.color];
      return <div
        key={rule.id}
        className={`highlight-rule ${dragIndex === index ? 'dragging' : ''}`}
        draggable
        onDragStart={() => onDragStart(index)}
        onDragOver={(e) => onDragOver(e, index)}
        onDrop={(e) => onDrop(e, index)}
        onDragEnd={() => setDragIndex(null)}
      >
        <span className="highlight-drag" title="Drag to reorder" aria-hidden="true"><GripVertical size={14} /></span>
        <span className="highlight-when">When</span>
        {columns.length > 0 ? (
          <select value={rule.column} onChange={(e) => updateRule(index, { column: e.target.value })} aria-label="Column">
            {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            {!columns.includes(rule.column) && rule.column ? <option value={rule.column}>{rule.column} (custom)</option> : null}
          </select>
        ) : (
          <input value={rule.column} onChange={(e) => updateRule(index, { column: e.target.value })} placeholder="Column" aria-label="Column" />
        )}
        <select value={rule.operator} onChange={(e) => updateRule(index, { operator: e.target.value as HighlightOperator })} aria-label="Operator">
          {HIGHLIGHT_OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
        </select>
        {needsValue && <input value={rule.value} onChange={(e) => updateRule(index, { value: e.target.value })} placeholder="Value" aria-label="Value" />}
        <label className="highlight-color" title={palette.label}>
          <span className="highlight-color-dot" style={{ background: palette.bg, borderColor: palette.border }} aria-hidden="true" />
          <select value={rule.color} onChange={(e) => updateRule(index, { color: e.target.value as HighlightColorId })} aria-label="Color">
            {(Object.keys(HIGHLIGHT_PALETTE) as HighlightColorId[]).map((cid) => <option key={cid} value={cid}>{HIGHLIGHT_PALETTE[cid].label}</option>)}
          </select>
        </label>
        <button className="icon-button subtle highlight-delete" onClick={() => removeRule(index)} aria-label="Delete rule"><Trash2 size={14} /></button>
        <span className="highlight-move">
          <button className="icon-button subtle" onClick={() => moveRule(index, index - 1)} disabled={index === 0} aria-label="Move up">↑</button>
          <button className="icon-button subtle" onClick={() => moveRule(index, index + 1)} disabled={index === rules.length - 1} aria-label="Move down">↓</button>
        </span>
      </div>;
    })}
    <div className="highlight-actions">
      <button className="back-button" onClick={addRule} disabled={rules.length >= 10}><Plus size={15} />Add rule</button>
      <span className="highlight-hint">First matching rule wins. Drag ⋮⋮ to reorder priority. Max 10.</span>
    </div>
  </div>;
}

function ReportsTab({ session, schools, sections, reports, refresh }: { session: LoginSession; schools: School[]; sections: ReportSection[]; reports: ReportDefinition[]; refresh: () => Promise<void> }) {
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Partial<ReportDefinition> & { id?: string } | null>(null);
  const [editorTab, setEditorTab] = useState<'general' | 'options'>('general');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [validateState, setValidateState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [previewOrg, setPreviewOrg] = useState(schools[0]?.name ?? '');
  const [preview, setPreview] = useState<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return reports;
    return reports.filter((report) => `${report.title} ${report.description} ${report.sectionTitle ?? ''}`.toLowerCase().includes(needle));
  }, [reports, filter]);

  function startNew() {
    setEditing({ sectionId: sections[0]?.id ?? '', title: '', description: '', sqlQuery: 'SELECT 1 AS example WHERE :organization = :organization', status: 'inactive', highlightRules: [] });
    setEditorTab('general');
    setValidateState('idle');
    setPreview(null);
    setError('');
    setNotice('');
  }

  function startEdit(report: ReportDefinition) {
    setEditing({ ...report, highlightRules: report.highlightRules ?? [] });
    setEditorTab('general');
    setValidateState('idle');
    setPreview(null);
    setError('');
    setNotice('');
  }

  useEffect(() => {
    if (!editing) return;
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') setEditing(null); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  async function save() {
    if (!editing) return;
    setNotice('');
    setError('');
    // Client-side highlight validation: block save if any rule is invalid
    const rules = (editing.highlightRules ?? []) as ReportHighlightRule[];
    for (const r of rules) {
      if (!r.column.trim()) { setError('Each highlight rule needs a column.'); setEditorTab('options'); return; }
      const needsValue = r.operator !== 'is_empty' && r.operator !== 'is_not_empty';
      if (needsValue && !r.value.trim()) { setError(`Rule for "${r.column}" needs a value.`); setEditorTab('options'); return; }
      if (!needsValue && r.value.trim()) { setError(`Rule for "${r.column}" must have an empty value for "${r.operator}".`); setEditorTab('options'); return; }
    }
    if (rules.length > 10) { setError('At most 10 highlight rules are allowed.'); setEditorTab('options'); return; }
    try {
      if (editing.id) {
        await updateReport(session, editing.id, {
          sectionId: editing.sectionId,
          title: editing.title,
          description: editing.description,
          sqlQuery: editing.sqlQuery,
          status: editing.status,
          highlightRules: rules
        });
        setNotice('Report updated.');
      } else {
        await createReport(session, {
          sectionId: editing.sectionId ?? '',
          title: editing.title ?? '',
          description: editing.description ?? '',
          sqlQuery: editing.sqlQuery ?? '',
          status: editing.status ?? 'inactive',
          highlightRules: rules
        });
        setNotice('Report created.');
      }
      setEditing(null);
      await refresh();
    } catch (failure) {
      const msg = failure instanceof Error ? failure.message : '';
      if (msg === 'HIGHLIGHT_RULE_INVALID') setEditorTab('options');
      setError(errorMessage(failure, 'The report could not be saved.'));
    }
  }

  async function validate() {
    if (!editing?.sqlQuery) return;
    setValidateState('idle');
    setError('');
    try {
      await validateReportSql(session, editing.sqlQuery);
      setValidateState('ok');
    } catch (failure) {
      setValidateState('fail');
      setError(errorMessage(failure, 'The SQL did not validate.'));
    }
  }

  async function previewRun() {
    if (!editing?.id || !previewOrg) return;
    setError('');
    setPreview(null);
    try {
      const run = await runReport(session, editing.id, previewOrg);
      setPreview({ columns: run.columns, rows: run.rows.slice(0, 5) });
    } catch (failure) {
      setError(errorMessage(failure, 'The preview could not run.'));
    }
  }

  async function archiveReport(report: ReportDefinition) {
    if (report.status === 'inactive') return;
    if (!window.confirm(`Archive "${report.title}"? It will be set to Inactive and hidden from the catalog.`)) return;
    setNotice('');
    setError('');
    try {
      await updateReport(session, report.id, { status: 'inactive' });
      setNotice('Report archived.');
      await refresh();
    } catch (failure) {
      setError(errorMessage(failure, 'The report could not be archived.'));
    }
  }

  return <div className="settings-panel">
    {notice && <div className="notice success"><CheckCircle2 size={18} /><span>{notice}</span></div>}
    {error && <div className="notice error"><AlertCircle size={18} /><span>{error}</span></div>}
    <div className="settings-form-row">
      <label className="settings-field"><span>Filter reports</span><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter by title or section" /></label>
      <button className="export-button" onClick={startNew}><Plus size={17} />New report</button>
    </div>
    <div className="settings-table-wrap">
      <table className="report-table">
        <thead><tr><th>Title</th><th>Section</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{visible.map((report) => <tr key={report.id} className="report-card">
          <td data-label="Title"><span><strong>{report.title}</strong><br />{report.description}</span></td>
          <td data-label="Section"><span>{report.sectionTitle ?? report.sectionId}</span></td>
          <td data-label="Status">{report.status === 'active' ? <span className="ready-badge">Active</span> : <span className="pending-badge">Inactive</span>}</td>
          <td data-label="Actions"><span className="settings-actions">
            <button className="back-button" onClick={() => startEdit(report)}><Pencil size={15} />Edit</button>
            <button className="back-button" onClick={() => void archiveReport(report)} disabled={report.status === 'inactive'} title={report.status === 'inactive' ? 'Already archived' : 'Archive report'}><Archive size={15} />Archive</button>
          </span></td>
        </tr>)}</tbody>
      </table>
    </div>
    {editing && <>
      <button className="settings-drawer-scrim" aria-label="Close report editor" onClick={() => setEditing(null)} />
      <div className="settings-editor settings-drawer" role="dialog" aria-modal="true" aria-label={editing.id ? 'Edit report' : 'New report'}>
      <div className="settings-drawer-heading">
        <h3>{editing.id ? 'Edit report' : 'New report'}</h3>
        <button className="icon-button subtle" aria-label="Close report editor" onClick={() => setEditing(null)}><X size={18} /></button>
      </div>
      <div className="settings-tabs" role="tablist" aria-label="Report editor tabs">
        <button role="tab" aria-selected={editorTab === 'general'} className={editorTab === 'general' ? 'settings-tab active' : 'settings-tab'} onClick={() => setEditorTab('general')}>General</button>
        <button role="tab" aria-selected={editorTab === 'options'} className={editorTab === 'options' ? 'settings-tab active' : 'settings-tab'} onClick={() => setEditorTab('options')}>Options</button>
      </div>
      {editorTab === 'general' ? <>
        <label className="settings-field"><span>Title</span><input value={editing.title ?? ''} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label>
        <label className="settings-field"><span>Description</span><input value={editing.description ?? ''} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label>
        <div className="settings-form-row">
          <label className="settings-field"><span>Section</span>
            <select value={editing.sectionId ?? ''} onChange={(event) => setEditing({ ...editing, sectionId: event.target.value })}>
              {sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
            </select>
          </label>
          <label className="settings-field"><span>Status</span>
            <select value={editing.status ?? 'inactive'} onChange={(event) => setEditing({ ...editing, status: event.target.value as 'active' | 'inactive' })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>
        <label className="settings-field"><span>SQL query (must be a single SELECT referencing :organization)</span>
          <textarea value={editing.sqlQuery ?? ''} onChange={(event) => { setEditing({ ...editing, sqlQuery: event.target.value }); setValidateState('idle'); }} rows={10} spellCheck={false} />
        </label>
        <div className="settings-form-row">
          <button className="back-button" onClick={() => void validate()}><CheckCircle2 size={16} />Validate</button>
          {validateState === 'ok' && <span className="ready-badge">Valid</span>}
          {validateState === 'fail' && <span className="pending-badge">Invalid</span>}
          {editing.id && <>
            <label className="settings-field"><span>Preview organization</span>
              <select value={previewOrg} onChange={(event) => setPreviewOrg(event.target.value)}>
                {schools.map((school) => <option key={school.id} value={school.name}>{school.name}</option>)}
              </select>
            </label>
            <button className="back-button" onClick={() => void previewRun()}><Play size={16} />Preview</button>
          </>}
        </div>
        {preview && <div className="settings-preview">
          <p><strong>Preview</strong> — first {preview.rows.length} of {preview.columns.length} columns</p>
          <div className="report-table-wrap"><table className="report-table">
            <thead><tr>{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>{preview.rows.map((row, index) => {
              const rules = (editing.highlightRules ?? []) as ReportHighlightRule[];
              let bg: string | undefined;
              for (const r of rules) {
                const raw = row[r.column];
                const cell = raw === null || raw === undefined ? '' : String(raw).trim();
                const needle = resolveHighlightNeedle(r.value);
                let match = false;
                switch (r.operator) {
                  case 'eq': match = cell.toLowerCase() === needle.toLowerCase(); break;
                  case 'neq': match = cell.toLowerCase() !== needle.toLowerCase(); break;
                  case 'contains': match = cell.toLowerCase().includes(needle.toLowerCase()); break;
                  case 'not_contains': match = !cell.toLowerCase().includes(needle.toLowerCase()); break;
                  case 'is_empty': match = cell === ''; break;
                  case 'is_not_empty': match = cell !== ''; break;
                }
                if (match) { bg = HIGHLIGHT_PALETTE[r.color]?.bg; break; }
              }
              return <tr key={index} style={bg ? { background: bg } : undefined}>{preview.columns.map((column) => <td key={column}><span>{row[column] === null || row[column] === undefined ? '' : String(row[column])}</span></td>)}</tr>;
            })}</tbody>
          </table></div>
        </div>}
      </> : <>
        <div className="settings-field"><span>Row Highlighting (optional)</span>
          <p className="highlight-desc">When a row matches a rule, the entire row is tinted. First matching rule wins. For the current year use <code>THISYEAR</code> (all caps) and next year use <code>NEXTYEAR</code> (all caps).</p>
          <RowHighlightingEditor
            rules={(editing.highlightRules ?? []) as ReportHighlightRule[]}
            onChange={(next) => setEditing({ ...editing, highlightRules: next })}
            columns={preview?.columns ?? []}
          />
          {preview && (editing.highlightRules ?? []).length > 0 && <div className="settings-preview" style={{ marginTop: 12 }}>
            <p><strong>Preview</strong> — tinted rows</p>
            <div className="report-table-wrap"><table className="report-table">
              <thead><tr>{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
              <tbody>{preview.rows.map((row, index) => {
                const rules = (editing.highlightRules ?? []) as ReportHighlightRule[];
                let bg: string | undefined;
                for (const r of rules) {
                  const raw = row[r.column];
                  const cell = raw === null || raw === undefined ? '' : String(raw).trim();
                  const needle = resolveHighlightNeedle(r.value);
                  let match = false;
                  switch (r.operator) {
                    case 'eq': match = cell.toLowerCase() === needle.toLowerCase(); break;
                    case 'neq': match = cell.toLowerCase() !== needle.toLowerCase(); break;
                    case 'contains': match = cell.toLowerCase().includes(needle.toLowerCase()); break;
                    case 'not_contains': match = !cell.toLowerCase().includes(needle.toLowerCase()); break;
                    case 'is_empty': match = cell === ''; break;
                    case 'is_not_empty': match = cell !== ''; break;
                  }
                  if (match) { bg = HIGHLIGHT_PALETTE[r.color]?.bg; break; }
                }
                return <tr key={index} style={bg ? { background: bg } : undefined}>{preview.columns.map((column) => <td key={column}><span>{row[column] === null || row[column] === undefined ? '' : String(row[column])}</span></td>)}</tr>;
              })}</tbody>
            </table></div>
          </div>}
        </div>
      </>}
      <div className="settings-form-row">
        <button className="export-button" onClick={() => void save()}>Save report</button>
        <button className="back-button" onClick={() => setEditing(null)}>Cancel</button>
      </div>
      </div>
    </>}
  </div>;
}

export function SettingsPage({ session, schools }: { session: LoginSession; schools: School[] }) {
  const [tab, setTab] = useState<Tab>('sections');
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [reports, setReports] = useState<ReportDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function refresh() {
    setError('');
    const [nextSections, nextReports] = await Promise.all([
      getReportSections(session, true),
      getReports(session, undefined, true)
    ]);
    setSections(nextSections);
    setReports(nextReports);
  }

  useEffect(() => {
    setLoading(true);
    refresh()
      .catch(() => setError('Settings could not be loaded.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  if (loading) return <section className="reports-page"><div className="empty-state"><span className="loader" />Loading settings</div></section>;

  return <section className="reports-page" aria-labelledby="settings-title">
    <div className="reports-page-heading">
      <div><p className="eyebrow">Admin</p><h2 id="settings-title">Report settings.</h2><p className="reports-intro">Organize report sections and author the SQL behind each report. Reports stay inactive until their SQL validates and you flip them active.</p></div>
    </div>
    {error && <div className="notice error"><AlertCircle size={18} /><span>{error}</span></div>}
    <div className="settings-tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'reports'} className={tab === 'reports' ? 'settings-tab active' : 'settings-tab'} onClick={() => setTab('reports')}>Reports ({reports.length})</button>
      <button role="tab" aria-selected={tab === 'sections'} className={tab === 'sections' ? 'settings-tab active' : 'settings-tab'} onClick={() => setTab('sections')}>Sections ({sections.length})</button>
    </div>
    {tab === 'sections'
      ? <SectionsTab session={session} sections={sections} refresh={refresh} />
      : <ReportsTab session={session} schools={schools} sections={sections} reports={reports} refresh={refresh} />}
  </section>;
}
