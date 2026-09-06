function sanitizeFilename(value: string): string {
  return value.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'school';
}

const HIGHLIGHT_EXCEL_RGB: Record<string, string> = {
  pastel_red: 'FFFFD6D6',
  pastel_yellow: 'FFFFF3C4',
  pastel_green: 'FFD1F0D6',
  pastel_blue: 'FFD6E6FF',
  pastel_pink: 'FFFFD6E8',
  pastel_orange: 'FFFFE4C4',
};

function resolveNeedle(value: string): string {
  const t = (value ?? '').trim();
  if (t === 'THISYEAR') return String(new Date().getFullYear());
  if (t === 'NEXTYEAR') return String(new Date().getFullYear() + 1);
  return t;
}

function highlightColorForRow(
  row: Record<string, unknown>,
  rules?: { column: string; operator: string; value: string; color: string }[]
): string | null {
  if (!rules || rules.length === 0) return null;
  for (const rule of rules) {
    const raw = row[rule.column];
    const cell = raw === null || raw === undefined ? '' : String(raw).trim();
    const needle = resolveNeedle(rule.value);
    let match = false;
    switch (rule.operator) {
      case 'eq': match = cell.toLowerCase() === needle.toLowerCase(); break;
      case 'neq': match = cell.toLowerCase() !== needle.toLowerCase(); break;
      case 'contains': match = cell.toLowerCase().includes(needle.toLowerCase()); break;
      case 'not_contains': match = !cell.toLowerCase().includes(needle.toLowerCase()); break;
      case 'is_empty': match = cell === ''; break;
      case 'is_not_empty': match = cell !== ''; break;
    }
    if (match) return HIGHLIGHT_EXCEL_RGB[rule.color] ?? null;
  }
  return null;
}

/**
 * Generic export for any configurable report run: uses the run's own
 * `columns` as the header row and stringifies each cell.
 * When highlightRules are present, matching rows get a solid fill.
 * When the report has a nested subreport, a second "Subreport" sheet is
 * appended with each child row keyed by its parent (keyColumn) value.
 */
export async function exportGenericReport(run: {
  report: { title: string };
  organization: string;
  columns: string[];
  rows: (Record<string, unknown> & { __subreport?: { keyColumn: string; columns: string[]; rows: Record<string, unknown>[] } })[];
  highlightRules?: { column: string; operator: string; value: string; color: string }[];
  subreport?: { keyColumn: string } | null;
}): Promise<void> {
  const { utils, writeFile } = await import('./vendor/xlsx.mjs');
  const header = run.columns;
  const body = run.rows.map((row) => header.map((column) => {
    const value = row[column];
    return value === null || value === undefined ? '' : String(value);
  }));
  const sheet = utils.aoa_to_sheet([header, ...body]);
  // Per-row fills for highlighted rows (row 0 is header, so data rows start at 1)
  if (run.highlightRules && run.highlightRules.length > 0) {
    for (let r = 0; r < run.rows.length; r++) {
      const rgb = highlightColorForRow(run.rows[r], run.highlightRules);
      if (!rgb) continue;
      const excelRow = r + 1; // 0-indexed header + 1
      for (let c = 0; c < header.length; c++) {
        const addr = utils.encode_cell({ r: excelRow, c });
        const cell = (sheet as Record<string, unknown>)[addr] as { s?: unknown } | undefined;
        if (!cell) continue;
        (cell as { s: unknown }).s = { fill: { patternType: 'solid', fgColor: { rgb } } };
      }
    }
  }
  sheet['!cols'] = header.map((label, index) => {
    const longest = Math.max(label.length, ...run.rows.map((row) => String(row[header[index]] ?? '').length));
    return { wch: Math.min(Math.max(longest + 2, 10), 40) };
  });
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, sheet, run.report.title.slice(0, 31) || 'Report');

  // Subreport sheet: repeat the parent key per child row.
  if (run.subreport) {
    const keyColumn = run.subreport.keyColumn;
    const firstSub = run.rows.find((row) => row.__subreport && row.__subreport.rows.length > 0)?.__subreport;
    const subColumns = firstSub?.columns ?? [];
    const subHeader = [keyColumn, ...subColumns];
    const subBody: (string)[][] = [];
    for (const row of run.rows) {
      const sub = row.__subreport;
      if (!sub || sub.rows.length === 0) continue;
      const parentKey = String(row[keyColumn] ?? '');
      for (const child of sub.rows) {
        subBody.push([parentKey, ...subColumns.map((col) => {
          const value = child[col];
          return value === null || value === undefined ? '' : String(value);
        })]);
      }
    }
    if (subBody.length > 0) {
      const subSheet = utils.aoa_to_sheet([subHeader, ...subBody]);
      subSheet['!cols'] = subHeader.map((label, index) => {
        const longest = Math.max(label.length, ...subBody.map((row) => String(row[index] ?? '').length));
        return { wch: Math.min(Math.max(longest + 2, 10), 40) };
      });
      utils.book_append_sheet(workbook, subSheet, 'Subreport');
    }
  }

  const slug = run.report.title.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'report';
  writeFile(workbook, `${slug}-${sanitizeFilename(run.organization)}.xlsx`, { compression: true });
}
