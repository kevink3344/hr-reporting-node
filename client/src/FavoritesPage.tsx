import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bookmark, Building2, Search, Trash2, X } from 'lucide-react';
import { deleteFavorite, getFavorites } from './api';
import type { LoginSession, PersonFavorite, School } from './types';

export function FavoritesPage({
  session,
  schools,
  onOpenRecord,
  onOpenReport
}: {
  session: LoginSession | null;
  schools: School[];
  onOpenRecord: (employeeNumber: string) => void;
  onOpenReport: (reportId: string, organization: string) => void;
}) {
  const [favorites, setFavorites] = useState<PersonFavorite[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  async function load() {
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      const res = await getFavorites(session, {
        search: search.trim() || undefined,
        organization: orgFilter || undefined,
        page,
        pageSize
      });
      setFavorites(res.data);
      setTotal(res.total);
    } catch {
      setError('Could not load favorites.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [session, orgFilter, page]);

  // Debounced search
  useEffect(() => {
    const t = window.setTimeout(() => {
      setPage(1);
      void load();
    }, 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function handleUnpin(fav: PersonFavorite) {
    if (!session) return;
    try {
      await deleteFavorite(session, fav.id);
      setFavorites((prev) => prev.filter((f) => f.id !== fav.id));
      setTotal((t) => Math.max(0, t - 1));
    } catch {
      setError('Could not remove favorite.');
    }
  }

  const orgOptions = useMemo(() => schools.map((s) => s.name), [schools]);

  return (
    <section className="favorites-page">
      <div className="favorites-header">
        <div>
          <p className="eyebrow">Favorites</p>
          <h2>Your pinned people</h2>
          <p className="favorites-copy">One favorite per person — first report where you pinned them is remembered. Click a name to open the employee record, or the report to re-run it.</p>
        </div>
        <span className="result-count">{total} {total === 1 ? 'favorite' : 'favorites'}</span>
      </div>

      <div className="favorites-toolbar">
        <label className="search-field favorites-search">
          <Search size={16} aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, employee number, or report"
            aria-label="Search favorites"
          />
          {search && <button className="field-clear" onClick={() => setSearch('')} aria-label="Clear search"><X size={14} /></button>}
        </label>
        <label className="select-field">
          <Building2 size={16} aria-hidden="true" />
          <select value={orgFilter} onChange={(e) => { setOrgFilter(e.target.value); setPage(1); }}>
            <option value="">All organizations</option>
            {orgOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>

      {error && <div className="notice error"><AlertCircle size={16} /><span>{error}</span></div>}

      {loading ? (
        <div className="empty-state"><span className="loader" />Loading favorites</div>
      ) : favorites.length === 0 ? (
        <div className="empty-state">
          <Bookmark size={28} />
          <h3>No favorites yet</h3>
          <p>Run a report and click the bookmark icon next to a person to pin them here.</p>
        </div>
      ) : (
        <>
          <div className="table-wrap favorites-table-wrap">
            <table className="favorites-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Employee no.</th>
                  <th>Report</th>
                  <th>Organization</th>
                  <th>Pinned</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {favorites.map((fav) => (
                  <tr key={fav.id}>
                    <td>
                      <button className="link-button favorites-person-link" onClick={() => onOpenRecord(fav.employeeNumber)} title={`Open record for ${fav.personName}`}>
                        <Bookmark size={13} className="favorites-pin-inline" aria-hidden="true" />
                        <strong>{fav.personName}</strong>
                      </button>
                    </td>
                    <td className="mono">{fav.employeeNumber || '—'}</td>
                    <td>
                      {fav.reportId ? (
                        <button className="link-button" onClick={() => onOpenReport(fav.reportId!, fav.organization)} title={`Open ${fav.reportTitle}`}>
                          {fav.reportTitle}
                        </button>
                      ) : (
                        <span>{fav.reportTitle}</span>
                      )}
                    </td>
                    <td>{fav.organization}</td>
                    <td className="mono" style={{ fontSize: '12px' }}>{new Date(fav.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button className="icon-button subtle" onClick={() => void handleUnpin(fav)} aria-label={`Remove ${fav.personName}`} title="Remove favorite">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="favorites-cards">
            {favorites.map((fav) => (
              <div key={fav.id} className="favorites-card">
                <div className="favorites-card-head">
                  <button className="link-button favorites-person-link" onClick={() => onOpenRecord(fav.employeeNumber)}>
                    <Bookmark size={13} className="favorites-pin-inline" />
                    <strong>{fav.personName}</strong>
                  </button>
                  <button className="icon-button subtle" onClick={() => void handleUnpin(fav)} aria-label="Remove"><Trash2 size={15} /></button>
                </div>
                <div className="favorites-card-meta">
                  <span className="mono">{fav.employeeNumber || '—'}</span>
                  <span>{fav.organization}</span>
                </div>
                <div className="favorites-card-report">
                  {fav.reportId ? (
                    <button className="link-button" onClick={() => onOpenReport(fav.reportId!, fav.organization)}>{fav.reportTitle}</button>
                  ) : (
                    <span>{fav.reportTitle}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="favorites-pagination">
              <button className="back-button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
              <span className="mono" style={{ fontSize: '13px' }}>Page {page} of {totalPages}</span>
              <button className="back-button" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
