# Favorites — Person Favorites with Report Provenance

> **Status:** Plan (for review) — not yet implemented
> **Date:** 2026-09-05
> **Related:** `docs/features/future-features.md` §3 (Favorites, Recent Runs & Saved Parameters), `docs/features/configurable-reports.md`, `docs/plans/row-highlighting.md`

## 1) Objective

Add **person-level Favorites** so staff can pin people they care about **in the context of the report where they found them**. Each favorite captures:

- **Employee ID** (`employeeNumber` / `emp_number`)
- **Person's Name** (`fullName`)
- **Report Name** (`report.title` at time of favorite) + `reportId` for navigation
- **Organization** (the `:organization` scope the report was run under)

**Interactions:**

- Clicking the **person's name** in Favorites opens the **Employee Record drawer** (same drawer used on Home and in Reports).
- Clicking the **report name** navigates to that **report runner** pre-scoped to the saved `organization`.
- When viewing a **report**, any row whose person is already favorited (for that report + organization, or globally — see §3) shows a **subtle pin** next to the name.
- When viewing an **Employee Record**, a **subtle pin badge** in the header indicates the person is favorited and which report(s) they were pinned from.

**Nav change (proposed):** Replace the duplicate **People** menu item with **Favorites**. Today `Home` already *is* the People directory, and the `People` nav item just does `navigate('home')` (`client/src/App.tsx: navigate()`). Replacing it removes duplication and gives Favorites a top-level home. Keep `Home` as the directory; add `Favorites` as a peer to `Reports` and `Settings`.

```
Before:  Home | Reports | People (=Home) | Settings (admin)
After:   Home | Reports | Favorites (★ count) | Settings (admin)
```

If you prefer to keep both, alternative is `Home | People | Reports | Favorites | Settings` — but the duplicate `Home`/`People` is the reason to replace.

---

## 2) Current state (verified 2026-09-05)

- **Home** (`App.tsx` `activeView === 'home'`) renders the People directory: search + school filter + table (`people.map(...)` → `selectPerson(person)` → drawer with `EmployeeRecord`). The drawer is shared with Reports via `openRecordByEmployeeNumber(employeeNumber)` which resolves `Person` by `employeeNumber` and reuses `selectPerson`.
- **Reports** (`ReportsPage.tsx` `GenericReportView`) runs `GET /api/reports/:id/run?organization=` and renders a generic table. Rows are clickable to open the employee record when an `emp_number`/`employeeNumber` column exists (`getEmployeeNumber()` helper, `report-row--clickable`). No per-row favorite action exists yet.
- **Employee Record** (`App.tsx` `EmployeeRecord`) renders sections from `PersonRecord` with a header `record-title` (name + Active badge + close button). No favorite indicator.
- **Auth v1:** `x-user-roles` / `x-user-name` / `x-user-id` / `x-user-email` headers (`client/src/api.ts` `adminHeaders`/`viewHeaders`, `src/app.ts` `callerRoles`/`callerName`). No persistent user table yet; `POST /api/auth/login` returns `LoginSession` from `fixture-auth`.
- **Future-features §3** previously scoped **report-level** favorites (`report_favorites` by `report_id`). This plan is **person-level** with report provenance — a different entity. Both can coexist; this doc scopes person-level only.

---

## 3) Design decisions

1. **Person favorite is scoped to (user, person, report, organization).** The natural key is `(user_id, person_id, report_id, organization)`. This lets the same person be favorited from two different reports (e.g., Contract Report vs Open Position Report) and preserves provenance. For the subtle pin in a report, we show the pin if **any** favorite for that `person_id` exists where `report_id` matches the current report and `organization` matches the current scope. For the Employee Record badge, we show it if **any** favorite for that `person_id` exists (and list the source report(s) in a tooltip).
   - *Alternative considered:* global `(user_id, person_id)` only — simpler but loses "which report" provenance the user explicitly asked for. Rejected.
   - *Alternative considered:* `(user_id, employeeNumber)` — fragile if `employeeNumber` changes; we store both `personId` (stable) and `employeeNumber` (display) and key on `personId`.

2. **Denormalize display fields at favorite time.** Store `person_name`, `employee_number`, `report_title`, `organization` as text alongside the FKs. This keeps Favorites readable even if the person is renamed or the report is renamed/deleted. `report_id` remains the navigation key; if the report is deleted, the row still shows the snapshot title with a disabled link and tooltip "Report no longer available".

3. **Favorites are per-user, private, and header-scoped.** No sharing in v1. The server derives `userId` from `x-user-id` (fixture) — same pattern as `report_views` (`created_by`). When real auth lands, swap to `req.user.id` without changing the table.

4. **Pin affordance is per-row in the report, not a separate page action.** Add a small pin/bookmark button in each report row (visible on hover/focus, always visible on mobile cards). Clicking it toggles the favorite for that `(person, report, organization)` tuple. Optimistic update + toast. This is the primary capture point; Favorites page is the management view.

5. **Subtle pin indicators, not noisy badges.** In the report table, a 14px `Bookmark` (filled when favorited, outline when not) in muted gold `#8b6b3e` (light) / `#c9a066` (dark), with `title="Favorited from Contract Report — Test Oak Elementary"`. In the Employee Record header, a small pill `★ Favorited` next to the Active badge, with a tooltip listing source report(s). Both are `aria-label`'d and keyboard accessible.

6. **Reuse existing patterns.** Follow `report_views` / `report_sections` conventions: Turso `TEXT` PK, `created_at` default, `fixture-repository` in-memory array for dev/tests, `turso-repository` with `libsql`, `mysql-repository` delegating to fixture until MySQL migration. Reuse drawer, table, mobile card, and dark-theme patterns.

---

## 4) User stories

- As **staff**, I run Contract Report for Test Oak Elementary, see 17 rows, and pin 3 people I need to follow up with. Later I open **Favorites** and see those 3 people with their Employee IDs and "Contract Report — Test Oak Elementary" as the source.
- As **staff**, in **Favorites** I click **Ava Cooper** → the Employee Record drawer opens. I click **Contract Report** in the same row → I land on Contract Report pre-scoped to Test Oak Elementary, with Ava's row visible (and pinned).
- As **staff**, when I re-open Contract Report for Test Oak Elementary, the 3 people I pinned show a subtle pin next to their names so I can spot them without opening Favorites.
- As **staff**, when I open any Employee Record for a favorited person (from Home search or from a report), the record header shows a subtle "Favorited" pin so I know they're on my list.

---

## 5) Data model

### Turso / SQLite (dev replica)

```sql
-- docs/data/turso/favorites.sql — apply via scripts/apply-turso-sql.mts
CREATE TABLE IF NOT EXISTS person_favorites (
  id                TEXT PRIMARY KEY,            -- uuid
  user_id           TEXT NOT NULL,               -- x-user-id (fixture) / users.id later
  person_id         TEXT NOT NULL,               -- Person.personId (e.g. '10002')
  employee_number   TEXT NOT NULL,               -- denormalized for display
  person_name       TEXT NOT NULL,               -- denormalized fullName at favorite time
  report_id         TEXT NOT NULL,               -- reports.id (FK, but keep row if report deleted)
  report_title      TEXT NOT NULL,               -- denormalized report.title at favorite time
  organization      TEXT NOT NULL,               -- the :organization scope at favorite time
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  -- Optional: keep a snapshot of the row's key for deep-linking to the exact row
  row_key           TEXT,                        -- rowKeyForRow() value if available
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_person_favorites_user ON person_favorites (user_id);
CREATE INDEX IF NOT EXISTS idx_person_favorites_user_report_org ON person_favorites (user_id, report_id, organization);
CREATE INDEX IF NOT EXISTS idx_person_favorites_user_person ON person_favorites (user_id, person_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_person_favorites_unique
  ON person_favorites (user_id, person_id, report_id, organization);
```

- `ON DELETE SET NULL` for `report_id` preserves the favorite row with its `report_title` snapshot even if the report is deleted (link becomes disabled).
- Unique index enforces one favorite per `(user, person, report, organization)` — toggling is idempotent.

### MySQL (prod, when migrated)

Same shape with `VARCHAR(36)` PK, `DATETIME DEFAULT CURRENT_TIMESTAMP`, `UNIQUE KEY`.

### Fixture (dev/tests, no DB)

In-memory `Map<string, PersonFavorite>` keyed by `id`, with secondary index by `userId`. Same unique constraint enforced in code. Seed empty.

### TypeScript

```ts
// src/types.ts and client/src/types.ts (shared)
export type PersonFavorite = {
  id: string;
  userId: string;
  personId: string;
  employeeNumber: string;
  personName: string;
  reportId: string | null;      // null if report deleted (title still present)
  reportTitle: string;          // snapshot at favorite time
  organization: string;
  rowKey?: string | null;
  createdAt: string;            // ISO
};
```

---

## 6) API contract

All endpoints require a session (header auth v1). `userId` is derived server-side from `x-user-id` / `x-user-name`; the client never sends it.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/favorites` | any | List caller's favorites. Query: `?reportId=&organization=&search=&page=&pageSize=` (default 50, max 100). Returns `PersonFavorite[]` sorted `created_at DESC`. |
| `POST` | `/api/favorites` | any | Create favorite. Body: `{ personId, employeeNumber, personName, reportId, reportTitle, organization, rowKey? }`. Validates `personId` exists, `reportId` exists (or allow null for Home-originated favorites — see open question), `organization` non-empty. Returns 201 `PersonFavorite`. 409 `FAVORITE_EXISTS` if unique violation (client treats as success). |
| `DELETE` | `/api/favorites/:id` | any | Delete own favorite. 404 if not found or not owned. 204 on success. |
| `GET` | `/api/favorites/check` | any | Batch check for pin indicators. Query: `?reportId=&organization=&personIds=10002,10005` (comma-separated, max 100). Returns `{ favoritedPersonIds: string[], favoritesByPersonId: Record<string, PersonFavorite> }` scoped to caller + report + org. Used by report view to render pins without fetching all favorites. |
| `DELETE` | `/api/favorites/by-key` | any | Convenience: delete by natural key. Query: `?personId=&reportId=&organization=`. Deletes the matching favorite for the caller. 204 or 404. Alternative to `DELETE /:id` when the client only has the natural key. |

**Validation (Zod):**

```ts
const favoriteInputSchema = z.object({
  personId: z.string().trim().min(1).max(64),
  employeeNumber: z.string().trim().min(1).max(64),
  personName: z.string().trim().min(1).max(120),
  reportId: z.string().trim().min(1).max(64).nullable().optional(),
  reportTitle: z.string().trim().min(1).max(150),
  organization: z.string().trim().min(1).max(255),
  rowKey: z.string().trim().max(128).nullable().optional(),
});
```

**Errors:** `PERSON_NOT_FOUND` 404, `REPORT_NOT_FOUND` 404 (if strict), `ORGANIZATION_REQUIRED` 400, `FAVORITE_EXISTS` 409, `NOT_FAVORITE_OWNER` 403.

**Audit:** No PII beyond `personId`/`employeeNumber`/`organization` already in the system. Favorites are not audit-logged in v1.

---

## 7) Client — UX and components

### 7.1 Navigation

- **Replace People with Favorites** in `App.tsx` `side-navigation`:
  ```tsx
  <button className={activeView === 'favorites' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('favorites')}>
    <Bookmark size={18} /><span>Favorites</span>{count > 0 && <span className="nav-count">{count}</span>}
  </button>
  ```
  Keep `Home` as the directory. Remove the duplicate `People` button that currently does `navigate('home')`.
- `activeView` becomes `'home' | 'reports' | 'favorites' | 'settings'`.
- Favorites count badge: fetched via `GET /api/favorites` on session load and after each toggle; cached in `App.tsx` state and passed to nav. Badge is muted (e.g., `background: #edf3ee; color: #2e5e56`).

### 7.2 Favorites page (`client/src/FavoritesPage.tsx` — new)

**Layout:** Reuses `reports-page` / `directory-panel` styling. No new design system.

- **Header:** `eyebrow: Favorites` + `h2: Your pinned people` + `hero-stat: {count} pinned` + `report-count` style.
- **Toolbar:** search input (filters by person name / employee number / report title) + organization filter dropdown (populated from `schools` + distinct `organization` values in favorites) + sort (Newest / Name A–Z / Report).
- **Table (desktop):** columns `Person | Employee ID | Report | Organization | Pinned on | Actions`
  - **Person** cell: `fullName` as a button (opens Employee Record drawer via `onOpenRecord(personId)`), with subtle pin icon `Bookmark` filled (12–14px) before the name when favorited. `employeeNumber` shown as secondary line or in its own column.
  - **Report** cell: `reportTitle` as a button/link that calls `onOpenReport(reportId, organization)` → navigates to `ReportsPage` and auto-runs `GET /api/reports/:id/run?organization=`. If `reportId` is null (deleted report), render as plain text with tooltip "Report no longer available".
  - **Actions:** `Unpin` (icon button `BookmarkX` or `X`) with confirm-less optimistic delete + undo toast (optional).
- **Cards (mobile ≤680px):** same `report-card` pattern as Reports: each favorite is a card with `data-label` attributes, stacked fields, and two primary actions: `View record` and `Open report`.
- **Empty state:** "No favorites yet. Run a report and pin people you want to track." with CTA `Browse reports →`.
- **Pagination:** 25 per page, same as People directory.

**Data flow:**

```ts
// client/src/api.ts — new
export function getFavorites(session: LoginSession, params?: { reportId?: string; organization?: string; search?: string }): Promise<PersonFavorite[]>
export function createFavorite(session: LoginSession, input: Omit<PersonFavorite,'id'|'userId'|'createdAt'>): Promise<PersonFavorite>
export function deleteFavorite(session: LoginSession, id: string): Promise<void>
export function deleteFavoriteByKey(session: LoginSession, key: { personId: string; reportId: string; organization: string }): Promise<void>
export function checkFavorites(session: LoginSession, reportId: string, organization: string, personIds: string[]): Promise<{ favoritedPersonIds: string[] }>
```

### 7.3 Report row — subtle pin

In `ReportsPage.tsx` `GenericReportView`:

- After `result` loads, collect `personIds` from rows via `getEmployeeNumber` → resolve to `personId` (requires a lookup; see §7.5). Call `GET /api/favorites/check?reportId=&organization=&personIds=` to get `favoritedPersonIds` for the current user + report + org.
- In the table `tbody` row render, if `personId` is in `favoritedPersonIds`, render a subtle pin next to the name:
  ```tsx
  <td data-label="Full name">
    <span style={{display:'inline-flex', alignItems:'center', gap:6}}>
      {isFavorited && <Bookmark size={13} className="report-pin" aria-label={`Favorited from ${result.report.title}`} />}
      <span>{fullName}</span>
    </span>
  </td>
  ```
  Style: `.report-pin { color: #8b6b3e; opacity: .85 }` (light), `#c9a066` (dark), `flex: 0 0 auto`. Not a button — just an indicator. The **toggle** is a separate pin button at the end of the row (see §7.4).
- For accessibility, add `title` and `aria-label` with report + org.

### 7.4 Report row — pin toggle (capture point)

Add a pin toggle button at the end of each report row (next to the `ArrowUpRight` open-record affordance):

- **Not favorited:** outline `Bookmark` (14px, muted) with `aria-label="Pin to Favorites"` and `title="Pin to Favorites"`.
- **Favorited:** filled `Bookmark` (14px, gold) with `aria-label="Remove from Favorites"` and `title="Favorited from Contract Report — click to remove"`.
- Click handler: `POST /api/favorites` or `DELETE /api/favorites/by-key` with `{ personId, employeeNumber, personName: fullName, reportId: result.report.id, reportTitle: result.report.title, organization: result.organization, rowKey }`. Optimistic update of `favoritedPersonIds` set; on error, revert and show `notice error`.
- Keyboard: `Enter`/`Space` on the button; row click still opens the record (stop propagation on pin button).

### 7.5 Resolving `personId` from report rows

Report rows carry `emp_number` / `employeeNumber` but not always `personId`. To key favorites on `personId` (stable), the client needs to resolve `employeeNumber → personId`. Options:

- **Preferred:** include `person_id` in report SQL where possible (e.g., `ei.person_id AS person_id` in Contract Report). Then `getEmployeeNumber` also returns `personId` and no lookup is needed. Update `docs/sql/contract-report.*.sql` to select `person_id` alongside `emp_number`.
- **Fallback:** if `person_id` not in columns, call `GET /api/people?search={employeeNumber}` once per distinct `employeeNumber` (batched, cached in a `Map<employeeNumber, personId>`). This is the same pattern as `openRecordByEmployeeNumber` already does.

Favorites `POST` should accept either `personId` or `employeeNumber` and resolve server-side via `PeopleRepository` if needed; but prefer `personId` when available.

### 7.6 Employee Record card — subtle pin

In `App.tsx` `EmployeeRecord` header (`record-title`):

```tsx
<div className="record-title">
  <div>
    <p className="eyebrow">Employee record</p>
    <h3>
      {record.identity.fullName}
      {isFavorited && <Bookmark size={14} className="record-pin" aria-label="Favorited" />}
    </h3>
    {favoritedFrom.length > 0 && <span className="record-pin-meta mono">{favoritedFrom.join(' · ')}</span>}
  </div>
  <div className="record-title-actions">…</div>
</div>
```

- `isFavorited` derived from `GET /api/favorites?personId={personId}` or from the global favorites cache filtered by `personId`.
- `favoritedFrom` is the list of `reportTitle — organization` strings for that person (deduped, max 2 shown, rest in tooltip).
- Style: `.record-pin { color: #8b6b3e; margin-left: 8px; vertical-align: middle }`, `.record-pin-meta { font-size: 11px; color: #8c857a }`. Dark theme: `#c9a066` / `#9b9284`.
- The pin is **indicator only** in the record; toggling happens from the report row or Favorites page (avoid adding a toggle in the drawer to keep the drawer focused on the record).

---

## 8) Navigation and deep-linking

- **Favorites → Report:** `onOpenReport(reportId, organization)` sets `activeView='reports'`, then `ReportsPage` auto-selects the report and calls `runReport(reportId, organization)`. URL can optionally reflect `?reportId=&organization=` for shareability (reuse existing `reportId` query pattern if present).
- **Favorites → Person:** `onOpenRecord(personId)` calls `selectPerson(person)` (or `openRecordByEmployeeNumber` if only `employeeNumber` is stored). Drawer opens over the Favorites page (same `drawerOpen` pattern as Home).
- **Report → Favorites:** pin toggle is inline; no navigation.

---

## 9) Security and scoping

- Favorites are **per-user**; every query is filtered by `user_id` derived from the session header. No cross-user read.
- `organization` in a favorite is the scope at capture time; navigating to the report re-enforces `scopeOrganization` (future RBAC v2) — if the user no longer has access to that organization, the report run returns 403 and the UI shows a friendly notice.
- No new PII beyond what the report already returns. `person_name`/`employee_number` are already visible in reports.

---

## 10) File map and implementation steps

| File | Change |
|------|--------|
| `docs/data/turso/favorites.sql` | **New** — `person_favorites` table + indexes |
| `docs/data/turso/schema.sql` | Append `person_favorites` to dev replica schema |
| `src/types.ts` | Add `PersonFavorite` type |
| `client/src/types.ts` | Add `PersonFavorite` type (mirror) |
| `src/repositories/contracts.ts` | Add `PersonFavoritesRepository` interface |
| `src/repositories/fixture-repository.ts` | In-memory `personFavorites` + CRUD + `check` |
| `src/repositories/turso-repository.ts` | `libsql` CRUD + `check` + `list` with filters |
| `src/repositories/mysql-repository.ts` | Delegate to fixture (or add MySQL impl later) |
| `src/app.ts` | Add `GET/POST /api/favorites`, `DELETE /api/favorites/:id`, `GET /api/favorites/check`, `DELETE /api/favorites/by-key` + Zod schemas + `callerId` helper |
| `src/openapi.ts` | Add `PersonFavorite` schema + paths |
| `client/src/api.ts` | Add `getFavorites`, `createFavorite`, `deleteFavorite`, `checkFavorites` |
| `client/src/App.tsx` | Replace `People` nav with `Favorites`, add `activeView='favorites'`, favorites count state, `FavoritesPage` route, shared drawer |
| `client/src/FavoritesPage.tsx` | **New** — table/cards, search, org filter, person→drawer, report→runner, unpin |
| `client/src/ReportsPage.tsx` | Add pin indicator + pin toggle per row, `checkFavorites` on load, optimistic update |
| `client/src/styles.css` | Add `.report-pin`, `.record-pin`, `.record-pin-meta`, `.nav-count`, `.favorites-*` + dark overrides + mobile card styles |
| `docs/sql/contract-report.*.sql` | Optionally add `ei.person_id AS person_id` to expose stable `personId` in report rows |

**Order:** migration → types → repositories → API → client (Favorites page → report pins → record pin → nav) → styles → tests.

---

## 11) Testing

- **Unit:** `src/app.test.ts` — create favorite, list, check, delete, 409 on duplicate, 404 on not-owned delete, `GET /api/favorites/check` returns correct subset.
- **Integration:** Turso `person_favorites` CRUD with unique index, `ON DELETE SET NULL` for report.
- **Client:** `FavoritesPage` empty state, search filter, person→drawer, report→runner, unpin optimistic update; `ReportsPage` pin indicator appears after `check`, toggle creates/deletes favorite.
- **Build:** `npm run build` + `npm --prefix client run build` green; `npm test` 19 + new cases.

---

## 12) Open questions for review

1. **Capture from Home as well?** Should the People directory rows also have a pin button (with `reportTitle: 'People directory'` or `reportId: null`)? Recommendation: **no** in v1 — keep capture in reports only so every favorite has a meaningful `reportTitle`/`reportId`. Home-originated favorites would have `reportId: null` and a generic title; defer until needed.
2. **One favorite per person globally vs per report+org?** This plan uses per `(person, report, org)` so the same person can be pinned from two reports. If you prefer "pin the person once, regardless of report", change the unique index to `(user_id, person_id)` and store the *first* report as provenance. Which do you prefer?
3. **Keep People nav or replace?** Recommendation: **replace** the duplicate `People` item with `Favorites` (Home already is the directory). If you want both, we can keep `People` and add `Favorites` as a fourth item — nav still fits at 280px.
4. **Pin toggle in Employee Record drawer?** This plan shows the pin as indicator only in the drawer. Add a toggle there too? Recommendation: **no** in v1 to keep the drawer focused; toggle lives in the report row and Favorites page.
5. **Report SQL change to include `person_id`?** Adding `person_id` to Contract Report (and other reports) makes favorite keying robust. Approve updating `docs/sql/contract-report.*.sql` and `docs/data/turso/report-config.sql` to select `person_id`?

---

## 13) Out of scope (v1)

- Sharing favorites across users, team favorites, or admin-managed favorites.
- Recent runs / saved parameters (future-features §3 remainder) — separate feature.
- Email or scheduled delivery of favorites.
- Field-level permissions on favorites.

---

*Next step:* Approve the nav replacement and the `(user, person, report, org)` key, then I can implement in the order listed above.
