import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUpRight, BarChart3, Building2, Check, ChevronDown, ChevronUp, FileText, GripVertical, Home, LogOut, Menu, MessageSquare, Moon, Palette, Pin, PinOff, Search, Send, Settings2, SlidersHorizontal, Sun, Trash2, Users, X } from 'lucide-react';
import { checkPositionPins, createPositionComment, createPositionPin, deletePositionComment, deletePositionPin, deletePositionPinByKey, getPeople, getPersonRecord, getPositionComments, getPositionDetails, getPositionPins, getSchools, login } from './api';
import type { LoginSession, Person, PersonRecord, PositionComment, PositionDetails, School } from './types';
import { PositionsPage } from './PositionsPage';
import { ReportsPage } from './ReportsPage';
import { SettingsPage } from './SettingsPage';
import { UserSettingsPage } from './UserSettingsPage';
import { DEFAULT_RECORD_LAYOUT, RECORD_SECTION_TITLES, arraysEqual, loadRecordLayout, resetRecordLayout, saveRecordLayout } from './recordLayout';
import type { RecordSectionId } from './recordLayout';
import { DEFAULT_SECTION_COLORS, SECTION_COLOR_OPTIONS, clearSectionColor, loadSectionColors, saveSectionColor } from './sectionColors';
import { loadHomePage, saveHomePage } from './homePage';
import type { HomePage } from './homePage';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function RecordField({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return <div className="record-field"><span>{label}</span><strong className={mono ? 'mono' : ''}>{value || 'Not provided'}</strong></div>;
}

// Proposed salary toggle — the stored value is ANNUAL, but it is displayed as a
// monthly figure by default. Clicking the field toggles between monthly and
// yearly (yearly = monthly × 12).
function SalaryToggleField({ annual, view, onToggle }: { annual: number; view: 'monthly' | 'yearly'; onToggle: () => void }) {
  const monthly = annual / 12;
  const isMonthly = view === 'monthly';
  const display = isMonthly ? money.format(monthly) : money.format(annual);
  const suffix = isMonthly ? 'monthly' : 'yearly';
  return (
    <div
      className="record-field salary-toggle"
      role="button"
      tabIndex={0}
      aria-pressed={!isMonthly}
      title={isMonthly ? 'Show yearly salary' : 'Show monthly salary'}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
    >
      <span>Proposed salary</span>
      <strong>{display} <em className="salary-period">{suffix}</em></strong>
    </div>
  );
}

// Inline pastel color picker for a section header. Opens a small popover of
// swatches; picking one applies it to the header and persists it via the
// onSelect callback. The overall start color appears as a dot on the palette
// button.
function SectionColorPicker({ value, defaultColor, onSelect }: { value: string; defaultColor: string; onSelect: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  function choose(color: string) {
    onSelect(color);
    setOpen(false);
  }
  return (
    <span className="record-color-picker" onClick={(e) => e.stopPropagation()}>
      <button
        className={`record-color-btn ${open ? 'open' : ''}`}
        aria-label="Change section color"
        title="Change section color"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <Palette size={13} />
      </button>
      {open && (
        <span className="record-color-menu" role="listbox" aria-label="Section color">
          {SECTION_COLOR_OPTIONS.map((option) => (
            <button
              key={option.id}
              className={`record-color-swatch ${value === option.value ? 'selected' : ''}`}
              title={option.name}
              aria-label={option.name}
              aria-pressed={value === option.value}
              style={{ background: option.value }}
              onClick={(e) => { e.stopPropagation(); choose(option.value); }}
            />
          ))}
          <button
            className="record-color-reset"
            title={`Reset to default (${defaultColor})`}
            aria-label="Reset to default color"
            onClick={(e) => { e.stopPropagation(); choose(defaultColor); }}
          >
            Reset
          </button>
        </span>
      )}
    </span>
  );
}

function DraggableRecordSection({
  id,
  title,
  tone = '',
  headerColor,
  customColor,
  defaultColor,
  onColorChange,
  index,
  total,
  isDragging,
  isDropTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMoveUp,
  onMoveDown,
  children,
}: {
  id: RecordSectionId;
  title: string;
  tone?: string;
  headerColor: string;
  customColor: string | null;
  defaultColor: string;
  onColorChange: (color: string) => void;
  index: number;
  total: number;
  isDragging: boolean;
  isDropTarget: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  children: React.ReactNode;
}) {
  return <section
    className={`record-section ${tone} ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drag-over' : ''}`}
    draggable
    onDragStart={onDragStart}
    onDragOver={onDragOver}
    onDrop={onDrop}
    onDragEnd={onDragEnd}
    aria-label={`${title} section, position ${index + 1} of ${total}, draggable`}
  >
    <h4 draggable onDragStart={onDragStart} style={customColor ? { background: headerColor } : undefined}>
      <GripVertical size={14} className="record-drag-handle" aria-hidden="true" />
      <span className="record-section-title">{title}</span>
      <span className="record-section-actions">
        <SectionColorPicker value={headerColor} defaultColor={defaultColor} onSelect={onColorChange} />
        <button className="record-move-btn" onClick={onMoveUp} disabled={index === 0} aria-label={`Move ${title} up`} title="Move up"><ChevronUp size={14} /></button>
        <button className="record-move-btn" onClick={onMoveDown} disabled={index === total - 1} aria-label={`Move ${title} down`} title="Move down"><ChevronDown size={14} /></button>
      </span>
    </h4>
    <div className="record-grid">{children}</div>
  </section>;
}

function EmployeeRecord({
  record,
  layout,
  userId,
  onClose,
  onReorder,
  onMoveUp,
  onMoveDown,
  onOpenPosition,
}: {
  record: PersonRecord;
  layout: RecordSectionId[];
  userId: string | null;
  onClose: () => void;
  onReorder: (from: number, to: number) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onOpenPosition: (posNumber: string, organization: string) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [salaryView, setSalaryView] = useState<'monthly' | 'yearly'>('monthly');
  const [sectionColors, setSectionColors] = useState<Partial<Record<RecordSectionId, string>>>(() => loadSectionColors(userId));

  function handleColorChange(id: RecordSectionId, color: string) {
    const defaultColor = DEFAULT_SECTION_COLORS[id];
    if (color === defaultColor) {
      setSectionColors((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      clearSectionColor(userId, id);
    } else {
      setSectionColors((prev) => ({ ...prev, [id]: color }));
      saveSectionColor(userId, id, color);
    }
  }

  function handleDragStart(e: React.DragEvent, index: number) {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }
  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) setDropIndex(index);
  }
  function handleDrop(e: React.DragEvent, index: number) {
    e.preventDefault();
    const from = dragIndex ?? Number(e.dataTransfer.getData('text/plain'));
    if (!Number.isNaN(from) && from !== index) onReorder(from, index);
    setDragIndex(null);
    setDropIndex(null);
  }
  function handleDragEnd() {
    setDragIndex(null);
    setDropIndex(null);
  }

  const renderers: Record<RecordSectionId, React.ReactNode> = {
    identity: <><RecordField label="NC UID" value={record.identity.ncUid} mono /><RecordField label="Employee ID" value={record.identity.employeeNumber} mono /><RecordField label="Gender" value={record.identity.gender} /><RecordField label="Ethnicity" value={record.identity.ethnicity} /><RecordField label="Date of birth" value={record.identity.dateOfBirth} /><RecordField label="Email" value={record.identity.email} /><RecordField label="Personal email" value={record.identity.personalEmail} /></>,
    contact: <><RecordField label="Address" value={record.contact.address} /><RecordField label="City" value={record.contact.city} /><RecordField label="State / ZIP" value={`${record.contact.state} ${record.contact.zip}`} mono /><RecordField label="Phone" value={record.contact.phone} mono /></>,
    assignment: <><RecordField label="Location" value={record.assignment.organization} /><RecordField label="Classroom" value={record.assignment.classroom} /><RecordField label="Position" value={record.assignment.positionNumber ? <button className="report-cell-link" onClick={() => onOpenPosition(record.assignment.positionNumber, record.assignment.organization)}>{(record.assignment.positionNumber.trim() ? record.assignment.positionNumber.trim() + ' - ' : '') + record.assignment.position}</button> : record.assignment.position} /><RecordField label="Account" value={record.assignment.accountCode} mono /><RecordField label="Months" value={record.assignment.months} /><RecordField label="TAP" value={`${record.assignment.tapPercent.toFixed(2)}%`} /><RecordField label="Pay grade" value={record.assignment.payGrade} /><RecordField label="Group" value={record.assignment.group} /><RecordField label="Mail stop" value={record.assignment.mailStop} /><RecordField label="School type" value={record.assignment.schoolType} /><RecordField label="Supervisor" value={record.assignment.supervisor} /></>,
    compensation: <><RecordField label="Step" value={record.compensation.step} /><SalaryToggleField annual={record.compensation.proposedSalary} view={salaryView} onToggle={() => setSalaryView((v) => (v === 'monthly' ? 'yearly' : 'monthly'))} /><RecordField label="Fixed supplement" value={money.format(record.compensation.fixedSupplement)} /><RecordField label="Off scale" value={money.format(record.compensation.offScale)} /><RecordField label="Supplement" value={money.format(record.compensation.supplement)} /><RecordField label="TOS state" value={money.format(record.compensation.tosState)} /><RecordField label="TOS supplement" value={money.format(record.compensation.tosSupplement)} /><RecordField label="Teacher differential" value={money.format(record.compensation.teacherDifferential)} /></>,
    contract: <><RecordField label="Hire date" value={record.contract.hireDate} /><RecordField label="Continuous date" value={record.contract.continuousDate} /><RecordField label="Last changed" value={record.contract.lastChanged} /><RecordField label="Type" value={record.contract.type} /><RecordField label="Start" value={record.contract.start} /><RecordField label="End" value={record.contract.end} /><RecordField label="Renewal year" value={record.contract.renewalYear} /><RecordField label="Change type" value={record.contract.changeType} /><RecordField label="Board number" value={record.contract.boardNumber} mono /></>,
    licensure: <><RecordField label="Type" value={record.licensure.type} /><RecordField label="Renewal year" value={record.licensure.renewalYear} /><RecordField label="Expires" value={record.licensure.expires} /><div className="record-table-wrap"><table className="record-table"><thead><tr><th>Area</th><th>Description</th><th>Years</th><th>Status</th><th>Code</th></tr></thead><tbody>{record.licensure.areas.map((area) => <tr key={area.code}><td className="mono">{area.area}</td><td>{area.description}</td><td>{area.years}</td><td>{area.status}</td><td className="mono">{area.code}</td></tr>)}</tbody></table></div></>,
    service: <><RecordField label="Years of service" value={record.service.yearsOfService} /><RecordField label="Months of service" value={record.service.monthsOfService} /><RecordField label="Last updated" value={record.service.lastUpdated} /></>,
    leave: <><div className="record-table-wrap"><table className="record-table leave-table"><thead><tr><th>Leave type</th><th>Carryover</th><th>Accrued</th><th>Used</th><th>Adjustment</th><th>Balance</th><th>Rate</th><th>Updated</th></tr></thead><tbody>{record.leaveBalances.map((leave) => <tr key={leave.leaveType}><td>{leave.leaveType}</td><td>{leave.carryover}</td><td>{leave.accrued}</td><td>{leave.used}</td><td>{leave.adjustment}</td><td><strong>{leave.balance}</strong></td><td>{leave.accrualRate}</td><td>{leave.lastUpdated}</td></tr>)}</tbody></table></div></>,
  };

  const tones: Partial<Record<RecordSectionId, string>> = { leave: 'leave-section' };

  return <div className="employee-record">
    <div className="record-title"><div><p className="eyebrow">Employee record</p><h3>{record.identity.fullName}</h3></div><div className="record-title-actions"><span className="record-active"><span className="status-dot" />Active</span><button className="icon-button" onClick={onClose} aria-label="Close employee record" title="Close employee record"><X size={17} /></button></div></div>
    {layout.map((id, index) => <DraggableRecordSection
      key={id}
      id={id}
      title={RECORD_SECTION_TITLES[id]}
      tone={tones[id] ?? ''}
      headerColor={sectionColors[id] ?? DEFAULT_SECTION_COLORS[id]}
      customColor={sectionColors[id] ?? null}
      defaultColor={DEFAULT_SECTION_COLORS[id]}
      onColorChange={(color) => handleColorChange(id, color)}
      index={index}
      total={layout.length}
      isDragging={dragIndex === index}
      isDropTarget={dropIndex === index}
      onDragStart={(e) => handleDragStart(e, index)}
      onDragOver={(e) => handleDragOver(e, index)}
      onDrop={(e) => handleDrop(e, index)}
      onDragEnd={handleDragEnd}
      onMoveUp={() => onMoveUp(index)}
      onMoveDown={() => onMoveDown(index)}
    >{renderers[id]}</DraggableRecordSection>)}
  </div>;
}

// Read-only Position Details drawer — non-draggable, mirrors the field layout
// of the employee record but never reorders.
function PositionDetailView({ details, onClose, onOpenRecord, pinned, onTogglePin, session }: { details: PositionDetails; onClose: () => void; onOpenRecord: (employeeNumber: string) => void; pinned: boolean; onTogglePin: () => void; session: LoginSession | null }) {
  const [tab, setTab] = useState<'general' | 'notes'>('general');
  const [noteCount, setNoteCount] = useState(0);
  const { position, incumbent, accountNumber, org, vacant } = details;

  // Populate the Notes tab badge on mount. The child notes tab keeps it in sync
  // via onCountChange after any add/delete, regardless of which tab is active.
  useEffect(() => {
    if (!session) { setNoteCount(0); return; }
    let active = true;
    getPositionComments(session, position.posNumber, org)
      .then((comments) => { if (active) setNoteCount(comments.length); })
      .catch(() => { if (active) setNoteCount(0); });
    return () => { active = false; };
  }, [session, position.posNumber, org]);

  return <div className="employee-record">
    <div className="record-title">
      <div>
        <p className="eyebrow">Position details</p>
        <h3>{position.posName || `Position ${position.posNumber}`}</h3>
        <span className={`record-status ${vacant ? 'record-status--vacant' : 'record-status--filled'}`}>
          <span className="status-dot" />{vacant ? 'Vacant' : 'Filled'}
        </span>
      </div>
      <div className="record-title-actions">
        <button className={`icon-button ${pinned ? 'position-pin-toggle--active' : 'position-pin-toggle'}`} onClick={onTogglePin} aria-label={pinned ? 'Unpin position' : 'Pin position'} title={pinned ? 'Unpin position' : 'Pin position'} aria-pressed={pinned}>
          {pinned ? <Pin size={17} fill="currentColor" /> : <PinOff size={17} />}
        </button>
        <button className="icon-button" onClick={onClose} aria-label="Close position details" title="Close position details"><X size={17} /></button>
      </div>
    </div>
    <div className="position-detail-tabs" role="tablist" aria-label="Position details sections">
      <button role="tab" aria-selected={tab === 'general'} className={`position-detail-tab ${tab === 'general' ? 'active' : ''}`} onClick={() => setTab('general')}>
        <FileText size={15} />General
      </button>
      <button role="tab" aria-selected={tab === 'notes'} className={`position-detail-tab ${tab === 'notes' ? 'active' : ''}`} onClick={() => setTab('notes')}>
        <MessageSquare size={15} />Notes{noteCount > 0 ? <span className="position-tab-badge">{noteCount}</span> : null}
      </button>
    </div>
    {tab === 'general' ? (
      <>
        <div className="record-grid">
          <RecordField label="Position number" value={position.posNumber} mono />
          <RecordField label="Account" value={accountNumber} mono />
          <RecordField label="Organization" value={org} />
          <RecordField label="Pos. starting" value={position.posStart} />
          <RecordField label="Pos. ending" value={position.posEnding} />
          <RecordField label="Months" value={position.months} />
          <RecordField label="Fund" value={position.fund} mono />
          <RecordField label="Purpose" value={position.purpose} mono />
          <RecordField label="Program" value={position.program} mono />
          <RecordField label="Object" value={position.object} mono />
          <RecordField label="Level" value={position.level} mono />
          <RecordField label="Cost center" value={position.costCenter} mono />
          <RecordField label="Administrator" value={position.administrator} />
          <RecordField label="Region" value={position.region} />
          <RecordField label="Location type" value={position.locType} />
          <RecordField label="SS200 code" value={position.ss200Code} />
          <RecordField label="Calendar" value={position.calendar} />
        </div>
        <h4 className="record-section-title">Incumbent</h4>
        {incumbent ? (
          <div className="record-grid">
            <RecordField label="Name" value={<button className="report-cell-link" onClick={() => onOpenRecord(incumbent.employeeNumber)}>{incumbent.fullName}</button>} />
            <RecordField label="Employee no." value={<button className="report-cell-link" onClick={() => onOpenRecord(incumbent.employeeNumber)}>{incumbent.employeeNumber}</button>} mono />
            <RecordField label="Tenure code" value={`${incumbent.tenureCode}${incumbent.tenureDesc ? ` — ${incumbent.tenureDesc}` : ''}`} />
            <RecordField label="Contract type" value={incumbent.contractType} />
            <RecordField label="Contract ID" value={incumbent.contractId} mono />
            <RecordField label="Contract start" value={incumbent.contractStart} />
            <RecordField label="Contract end" value={incumbent.contractEnd} />
            <RecordField label="TAP" value={incumbent.tap} />
            <RecordField label="Months" value={incumbent.months} />
            <RecordField label="Classroom" value={incumbent.classroom} />
            <RecordField label="Mail stop" value={incumbent.mailstop} mono />
          </div>
        ) : (
          <div className="detail-placeholder"><Users size={24} /><p>No incumbent is assigned to this position.</p></div>
        )}
      </>
    ) : (
      <PositionNotesTab session={session} posNumber={position.posNumber} org={org} onCountChange={setNoteCount} />
    )}
  </div>;
}

// Notes (position comments) tab for the Position detail drawer.
function PositionNotesTab({ session, posNumber, org, onCountChange }: { session: LoginSession | null; posNumber: string; org: string; onCountChange: (count: number) => void }) {
  const [comments, setComments] = useState<PositionComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!session) { setComments([]); setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const loaded = await getPositionComments(session, posNumber, org);
      setComments(loaded);
      onCountChange(loaded.length);
    } catch {
      setError('Notes could not be loaded.');
      onCountChange(0);
    } finally {
      setLoading(false);
    }
  }, [session, posNumber, org, onCountChange]);

  useEffect(() => { void load(); }, [load]);

  async function submitComment() {
    const body = draft.trim();
    if (!body || !session || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await createPositionComment(session, posNumber, { organization: org, body });
      setDraft('');
      await load();
    } catch {
      setError('The note could not be added.');
    } finally {
      setSubmitting(false);
    }
  }

  async function removeComment(id: string) {
    if (!session) return;
    try {
      await deletePositionComment(session, posNumber, id);
      const next = comments.filter((c) => c.id !== id);
      setComments(next);
      onCountChange(next.length);
    } catch {
      setError('The note could not be deleted.');
    }
  }

  const canPost = Boolean(session) && draft.trim().length > 0 && !submitting;

  return <div className="position-notes">
    <p className="position-notes-intro">Add a shared note for this position. Only the author can delete their own note.</p>
    <div className="position-notes-composer">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Write a note for this position…"
        rows={3}
        maxLength={2000}
        disabled={!session}
      />
      <button className="export-button" onClick={() => void submitComment()} disabled={!canPost}>
        <Send size={15} />{submitting ? 'Adding…' : 'Add note'}
      </button>
    </div>
    {error && <p className="notice error">{error}</p>}
    {loading ? (
      <div className="empty-state"><span className="loader" />Loading notes</div>
    ) : comments.length === 0 ? (
      <div className="report-comments-empty">No notes yet for this position.</div>
    ) : (
      <div className="report-comments-list position-notes-list">
        {comments.map((comment) => (
          <div className="report-comment" key={comment.id}>
            <div className="report-comment-head">
              <strong>{comment.authorName}</strong>
              <span className="report-comment-time">{formatCommentTime(comment.createdAt)}</span>
            </div>
            <div className="report-comment-body">{comment.body}</div>
            {session && comment.authorId === session.user.wakeId && (
              <button className="link-button position-note-delete" onClick={() => void removeComment(comment.id)}>
                <Trash2 size={13} />Delete
              </button>
            )}
          </div>
        ))}
      </div>
    )}
  </div>;
}

function formatCommentTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function App() {
  const [session, setSession] = useState<LoginSession | null>(null);
  const [rememberMe, setRememberMe] = useState(() => {
    try { return window.localStorage.getItem('hr-report-remember-me') === '1'; } catch { return false; }
  });
  const [wakeId, setWakeId] = useState(() => {
    try {
      if (window.localStorage.getItem('hr-report-remember-me') === '1') {
        const raw = window.localStorage.getItem('hr-report-credentials');
        if (raw) { const parsed = JSON.parse(raw) as { wakeId?: string }; return parsed.wakeId ?? ''; }
      }
    } catch { /* ignore */ }
    return '';
  });
  const [employeeId, setEmployeeId] = useState(() => {
    try {
      if (window.localStorage.getItem('hr-report-remember-me') === '1') {
        const raw = window.localStorage.getItem('hr-report-credentials');
        if (raw) { const parsed = JSON.parse(raw) as { employeeId?: string }; return parsed.employeeId ?? ''; }
      }
    } catch { /* ignore */ }
    return '';
  });
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);
  const [schools, setSchools] = useState<School[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [personRecord, setPersonRecord] = useState<PersonRecord | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordError, setRecordError] = useState('');
  const [positionDetails, setPositionDetails] = useState<PositionDetails | null>(null);
  const [positionLoading, setPositionLoading] = useState(false);
  const [positionError, setPositionError] = useState('');
  const [positionPin, setPositionPin] = useState<{ pinned: boolean; pinId: string | null }>({ pinned: false, pinId: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeView, setActiveView] = useState<'home' | 'reports' | 'positions' | 'settings'>('home');
  const [homePage, setHomePage] = useState<HomePage>('home');
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const [positionPinsCount, setPositionPinsCount] = useState(0);
  const isAdmin = session?.user.roles.includes('hr_admin') ?? false;
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = window.localStorage.getItem('hr-report-theme');
    return saved === 'dark' ? 'dark' : 'light';
  });
  const [recordLayout, setRecordLayout] = useState<RecordSectionId[]>(() => loadRecordLayout(null));
  const savedLayoutRef = useRef<RecordSectionId[]>(loadRecordLayout(null));
  const [layoutNotice, setLayoutNotice] = useState('');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('hr-report-theme', theme);
  }, [theme]);

  useEffect(() => {
    const next = loadRecordLayout(session?.user.id ?? null);
    setRecordLayout(next);
    savedLayoutRef.current = next;
  }, [session?.user.id]);

  // On user change (login / auto-login), restore their saved home page and land there.
  const sessionUserId = session?.user.id ?? null;
  useEffect(() => {
    const page = sessionUserId ? loadHomePage(sessionUserId) : 'home';
    setHomePage(page);
    if (page === 'reports' || page === 'positions') {
      setActiveView(page);
    } else {
      setActiveView('home');
    }
  }, [sessionUserId]);

  function changeHomePage(page: HomePage) {
    setHomePage(page);
    if (session) saveHomePage(session.user.id, page);
  }

  // Auto-login: if user previously checked "Stay signed in", restore session without showing login form.
  useEffect(() => {
    if (session || autoLoginAttempted) return;
    let cancelled = false;
    try {
      const shouldRemember = window.localStorage.getItem('hr-report-remember-me') === '1';
      const raw = window.localStorage.getItem('hr-report-credentials');
      if (!shouldRemember || !raw) { setAutoLoginAttempted(true); return; }
      const parsed = JSON.parse(raw) as { wakeId?: string; employeeId?: string };
      const w = parsed.wakeId?.trim();
      const e = parsed.employeeId?.trim();
      if (!w || !e) { setAutoLoginAttempted(true); return; }
      setLoggingIn(true);
      login(w, e).then((nextSession) => {
        if (cancelled) return;
        setSession(nextSession);
        setWakeId(w);
        setEmployeeId(e);
        setRememberMe(true);
      }).catch(() => {
        if (cancelled) return;
        try {
          window.localStorage.removeItem('hr-report-credentials');
          window.localStorage.removeItem('hr-report-remember-me');
        } catch { /* ignore */ }
      }).finally(() => {
        if (cancelled) return;
        setLoggingIn(false);
        setAutoLoginAttempted(true);
      });
    } catch {
      setAutoLoginAttempted(true);
    }
    return () => { cancelled = true; };
  }, [session, autoLoginAttempted]);

  function reorderRecordSection(from: number, to: number) {
    setRecordLayout((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }
  function moveRecordSectionUp(index: number) {
    if (index <= 0) return;
    reorderRecordSection(index, index - 1);
  }
  function moveRecordSectionDown(index: number) {
    setRecordLayout((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(index + 1, 0, moved);
      return next;
    });
  }
  function saveRecordLayoutState() {
    saveRecordLayout(session?.user.id ?? null, recordLayout);
    savedLayoutRef.current = [...recordLayout];
    setLayoutNotice('Layout saved');
    window.setTimeout(() => setLayoutNotice(''), 2000);
  }
  function resetRecordLayoutState() {
    resetRecordLayout(session?.user.id ?? null);
    setRecordLayout([...DEFAULT_RECORD_LAYOUT]);
    savedLayoutRef.current = [...DEFAULT_RECORD_LAYOUT];
    setLayoutNotice('Layout reset');
    window.setTimeout(() => setLayoutNotice(''), 2000);
  }
  const isLayoutDirty = !arraysEqual(recordLayout, savedLayoutRef.current);

  async function submitLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError('');
    try {
      const nextSession = await login(wakeId, employeeId);
      setSession(nextSession);
      try {
        if (rememberMe) {
          window.localStorage.setItem('hr-report-remember-me', '1');
          window.localStorage.setItem('hr-report-credentials', JSON.stringify({ wakeId, employeeId }));
        } else {
          window.localStorage.removeItem('hr-report-remember-me');
          window.localStorage.removeItem('hr-report-credentials');
        }
      } catch { /* ignore */ }
    } catch (loginFailure) {
      setLoginError(loginFailure instanceof Error && loginFailure.message === 'INVALID_CREDENTIALS'
        ? 'Wake ID and Employee ID did not match a test account.'
        : 'The sign-in service is unavailable.');
    } finally {
      setLoggingIn(false);
    }
  }

  function signOut() {
    setSession(null);
    setSelectedPerson(null);
    setPeople([]);
    setActiveView('home');
    setMenuOpen(false);
    try {
      window.localStorage.removeItem('hr-report-remember-me');
      window.localStorage.removeItem('hr-report-credentials');
    } catch { /* ignore */ }
  }

  function navigate(view: 'home' | 'reports' | 'positions' | 'settings') {
    if (view === 'settings' && !isAdmin) return;
    setActiveView(view);
    setMenuOpen(false);
  }

  // Keep pinned-position count fresh for nav badge
  useEffect(() => {
    if (!session) { setPositionPinsCount(0); return; }
    getPositionPins(session, { page: 1, pageSize: 1 }).then((res) => setPositionPinsCount(res.total)).catch(() => {});
  }, [session, activeView]);

  // Position pin state for the currently-open position drawer.
  const [positionPinId, setPositionPinId] = useState<string | null>(null);
  const [positionPinned, setPositionPinned] = useState(false);
  useEffect(() => {
    if (!session || !positionDetails) { setPositionPinned(false); setPositionPinId(null); return; }
    const posNumber = positionDetails.position.posNumber;
    const org = positionDetails.org;
    checkPositionPins(session, [{ posNumber, organization: org }]).then((checks) => {
      setPositionPinned(checks[0]?.pinned ?? false);
      setPositionPinId(checks[0]?.pinId ?? null);
    }).catch(() => { setPositionPinned(false); setPositionPinId(null); });
  }, [session, positionDetails]);

  async function togglePositionPin() {
    if (!session || !positionDetails) return;
    const posNumber = positionDetails.position.posNumber;
    const org = positionDetails.org;
    const posName = positionDetails.position.posName || `Position ${posNumber}`;
    const incumbent = positionDetails.incumbent;
    try {
      if (positionPinned) {
        if (positionPinId) await deletePositionPin(session, positionPinId);
        else await deletePositionPinByKey(session, posNumber, org);
        setPositionPinned(false);
        setPositionPinId(null);
      } else {
        const created = await createPositionPin(session, {
          posNumber,
          posName,
          organization: org,
          incumbentName: incumbent?.fullName ?? null,
          employeeNumber: incumbent?.employeeNumber ?? null
        });
        setPositionPinned(true);
        setPositionPinId(created.id);
      }
      getPositionPins(session, { page: 1, pageSize: 1 }).then((res) => setPositionPinsCount(res.total)).catch(() => {});
    } catch {
      // no-op; keep current state on failure
    }
  }

  useEffect(() => {
    if (!session) return;
    void Promise.all([getSchools(), getPeople('', '')])
      .then(([nextSchools, nextPeople]) => {
        setSchools(nextSchools);
        setPeople(nextPeople.data);
      })
      .catch(() => setError('The lookup service is unavailable. Check that the API is running.'))
      .finally(() => setLoading(false));
  }, [session]);

  async function runSearch() {
    setLoading(true);
    setError('');
    try {
      const result = await getPeople(search, schoolId);
      setPeople(result.data);
      setSelectedPerson(null);
      setPersonRecord(null);
    } catch {
      setError('The lookup could not be completed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function selectPerson(person: Person) {
    setSelectedPerson(person);
    setPersonRecord(null);
    setRecordError('');
    setRecordLoading(true);
    try {
      setPersonRecord(await getPersonRecord(person.personId));
    } catch {
      setRecordError('The complete employee record could not be loaded.');
    } finally {
      setRecordLoading(false);
    }
  }

  async function openRecordByEmployeeNumber(employeeNumber: string) {
    const trimmed = employeeNumber.trim();
    if (!trimmed) return;
    setPositionDetails(null);
    setPositionError('');
    let person = people.find((candidate) => candidate.employeeNumber === trimmed);
    if (!person) {
      try {
        const result = await getPeople(trimmed, '');
        person = result.data.find((candidate) => candidate.employeeNumber === trimmed) ?? result.data[0] ?? null;
        if (!person) {
          setSelectedPerson({ personId: trimmed, employeeNumber: trimmed } as Person);
          setPersonRecord(null);
          setRecordError(`No employee record found for ${trimmed}.`);
          setRecordLoading(false);
          return;
        }
      } catch {
        setSelectedPerson({ personId: trimmed, employeeNumber: trimmed } as Person);
        setPersonRecord(null);
        setRecordError('The complete employee record could not be loaded.');
        setRecordLoading(false);
        return;
      }
    }
    await selectPerson(person);
  }

  async function openPositionByNumber(posNumber: string, organization: string) {
    const trimmed = posNumber.trim();
    if (!trimmed) return;
    setSelectedPerson(null);
    setPersonRecord(null);
    setRecordError('');
    setPositionDetails(null);
    setPositionError('');
    setPositionLoading(true);
    try {
      setPositionDetails(await getPositionDetails(organization, trimmed));
    } catch {
      setPositionError('The position details could not be loaded.');
    } finally {
      setPositionLoading(false);
    }
  }

  const drawerOpen = Boolean(selectedPerson || recordLoading || recordError || personRecord || positionDetails || positionLoading || positionError);
  function closeRecord() {
    setSelectedPerson(null);
    setPersonRecord(null);
    setRecordError('');
    setPositionDetails(null);
    setPositionLoading(false);
    setPositionError('');
    setPositionPinned(false);
    setPositionPinId(null);
  }

  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') closeRecord(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  function clearSearch() {
    setSearch('');
    setSchoolId('');
    void getPeople('', '').then((result) => setPeople(result.data));
  }

  if (!session) {
    return <main className="login-shell">
      <section className="login-art" aria-hidden="true"><div className="login-art-mark"><FileText size={26} /></div><p className="eyebrow">Human Resources</p><h1>Reporting workspace</h1><p>Clearer records. Faster decisions.</p></section>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-panel-inner">
          <p className="eyebrow">Secure access</p><h2 id="login-title">Welcome back.</h2><p className="login-copy">Sign in with your Wake credentials to continue to HR Reporting.</p>
          <form className="login-form" onSubmit={submitLogin}>
            <label>Wake ID<input value={wakeId} onChange={(event) => setWakeId(event.target.value)} placeholder="your Wake ID" autoComplete="username" required /></label>
            <label>Employee ID<input value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} placeholder="your employee ID" inputMode="numeric" autoComplete="off" required /></label>
            <label className="remember-row"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /> Stay signed in on this device</label>
            {loginError && <div className="notice error"><AlertCircle size={18} /><span>{loginError}</span></div>}
            <button className="primary-button login-button" disabled={loggingIn}>{loggingIn ? 'Signing in...' : 'Sign in'}<ArrowUpRight size={17} /></button>
          </form>
          <p className="fixture-note">Local testing uses synthetic fixture accounts. Production sign-in will connect to the approved Wake identity provider.</p>
        </div>
      </section>
    </main>;
  }

  return (
    <main className="app-shell">
      {menuOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside className={`side-navigation ${menuOpen ? 'open' : ''}`} aria-label="Main navigation">
        <div className="side-navigation-heading"><span className="brand-mark"><FileText size={18} /></span><strong>HR Reporting</strong><button className="icon-button" onClick={() => setMenuOpen(false)} aria-label="Close navigation" title="Close navigation"><X size={17} /></button></div>
        <nav><button className={activeView === 'home' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('home')}><Home size={18} /><span>Home</span></button><button className={activeView === 'reports' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('reports')}><BarChart3 size={18} /><span>Reports</span></button><button className={activeView === 'positions' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('positions')}><Pin size={18} /><span>Positions</span>{positionPinsCount > 0 && <span className="nav-count">{positionPinsCount}</span>}</button>{isAdmin && <button className={activeView === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('settings')}><SlidersHorizontal size={18} /><span>Report Configuration</span></button>}</nav>
      </aside>
      <header className="topbar">
        <button className="icon-button menu-trigger" onClick={() => setMenuOpen(true)} aria-label="Open navigation" title="Open navigation"><Menu size={21} /></button>
        <div className="brand-lockup">
          <div>
            <p className="eyebrow">Human Resources</p>
            <h1>Reporting workspace</h1>
          </div>
        </div>
        <div className="topbar-meta">
          <div className="welcome-block"><strong>Welcome, {session.person.firstName}</strong><span>{session.person.positionName}, {session.school.name}</span></div>
          <button className="icon-button subtle settings-toggle" onClick={() => setUserSettingsOpen((open) => !open)} aria-label="Open settings" title="Settings" aria-expanded={userSettingsOpen}>
            <Settings2 size={18} />
          </button>
          <button className="icon-button subtle theme-toggle" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')} aria-label="Toggle light or dark mode" title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}>
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button className="icon-button subtle logout-button" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
        </div>
      </header>

      {activeView === 'reports' ? <ReportsPage schools={schools} session={session} onManage={isAdmin ? () => navigate('settings') : undefined} onOpenRecord={openRecordByEmployeeNumber} onOpenPosition={openPositionByNumber} /> : activeView === 'positions' ? <PositionsPage session={session} schools={schools} onOpenPosition={openPositionByNumber} /> : activeView === 'settings' ? (isAdmin && session ? <SettingsPage session={session} schools={schools} /> : <section className="reports-page"><div className="notice error"><AlertCircle size={18} /><span>Access denied. Admin access is required.</span></div></section>) : <>
      <section className="hero-band">
        <div>
          <p className="eyebrow">People directory</p>
          <h2>Find the right record quickly.</h2>
          <p className="hero-copy">Search employee records by name, employee number, or organization.</p>
        </div>
        <div className="hero-stat"><Users size={18} /><strong>{people.length}</strong><span>visible records</span></div>
      </section>

      <section className="workspace-grid" aria-label="People lookup">
        <div className="directory-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Directory</p>
              <h3>People lookup</h3>
            </div>
            <span className="result-count">{people.length} results</span>
          </div>

          <div className="search-row">
            <label className="search-field">
              <Search size={18} aria-hidden="true" />
              <span className="sr-only">Search people</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void runSearch(); }} placeholder="Name, employee number, or organization" />
              {search && <button className="field-clear" onClick={() => setSearch('')} aria-label="Clear search" title="Clear search"><X size={15} /></button>}
            </label>
            <label className="select-field">
              <Building2 size={17} aria-hidden="true" />
              <span className="sr-only">Filter by school</span>
              <select value={schoolId} onChange={(event) => setSchoolId(event.target.value)}>
                <option value="">All schools and departments</option>
                {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </label>
            <button className="primary-button" onClick={() => void runSearch()}><Search size={17} />Search</button>
          </div>

          {error && <div className="notice error"><AlertCircle size={18} /><span>{error}</span></div>}
          {loading ? <div className="empty-state"><span className="loader" />Loading directory</div> : people.length === 0 ? <div className="empty-state">No people match the current filters.</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Person</th><th>Organization</th><th>Position</th><th>Employee no.</th><th><span className="sr-only">Open</span></th></tr></thead>
                <tbody>{people.map((person) => <tr key={person.personId} className={selectedPerson?.personId === person.personId ? 'selected' : ''} onClick={() => void selectPerson(person)}>
                  <td><strong>{person.fullName}</strong><span>{person.email}</span></td>
                  <td>{person.organization}</td><td>{person.positionName}</td><td className="mono">{person.employeeNumber}</td>
                  <td><ArrowUpRight size={17} aria-hidden="true" /></td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
        </div>

        <div className="detail-panel detail-panel--placeholder" aria-hidden={drawerOpen ? 'true' : undefined}>
          <div className="detail-placeholder"><Users size={28} /><h3>Select a person</h3><p>Choose a record from the directory to inspect the complete employee report.</p></div>
        </div>
      </section>
      </>}
      {drawerOpen && <>
        <button className="record-drawer-scrim" aria-label="Close drawer" onClick={closeRecord} />
        <aside className="record-drawer" role="dialog" aria-modal="true" aria-label={positionDetails || positionLoading || positionError ? 'Position details' : 'Employee record'}>
          {positionLoading ? <div className="empty-state"><span className="loader" />Loading position details</div> : positionError ? <div className="empty-state"><AlertCircle size={26} /><p>{positionError}</p></div> : positionDetails ? (
            <PositionDetailView details={positionDetails} onClose={closeRecord} onOpenRecord={openRecordByEmployeeNumber} pinned={positionPinned} onTogglePin={() => void togglePositionPin()} session={session} />
          ) : recordLoading ? <div className="empty-state"><span className="loader" />Loading employee record</div> : recordError ? <div className="empty-state"><AlertCircle size={26} /><p>{recordError}</p></div> : personRecord ? <>
            <div className="record-layout-toolbar">
              <span className="record-layout-hint">Drag sections to reorder</span>
              <span className="record-layout-actions">
                <button className="back-button" onClick={resetRecordLayoutState}>Reset to default</button>
                <button className="export-button" onClick={saveRecordLayoutState} disabled={!isLayoutDirty}><Check size={14} />Save layout</button>
              </span>
            </div>
            {layoutNotice && <div className="notice success" role="status" aria-live="polite">{layoutNotice}</div>}
            <div aria-live="polite" className="sr-only">{layoutNotice}</div>
            <EmployeeRecord record={personRecord} layout={recordLayout} userId={session?.user.id ?? null} onClose={closeRecord} onReorder={reorderRecordSection} onMoveUp={moveRecordSectionUp} onMoveDown={moveRecordSectionDown} onOpenPosition={openPositionByNumber} />
          </> : <div className="detail-placeholder"><Users size={28} /><h3>Select a person</h3><p>Choose a record from the directory to inspect the complete employee report.</p></div>}
        </aside>
      </>}
      {userSettingsOpen && <>
        <button className="record-drawer-scrim" aria-label="Close settings" onClick={() => setUserSettingsOpen(false)} />
        <UserSettingsPage homePage={homePage} onChangeHomePage={changeHomePage} onClose={() => setUserSettingsOpen(false)} />
      </>}
    </main>
  );
}
