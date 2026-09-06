const HIGHLIGHT_PDF_RGB: Record<string, [number, number, number]> = {
  pastel_red: [255, 214, 214],
  pastel_yellow: [255, 243, 196],
  pastel_green: [209, 240, 214],
  pastel_blue: [214, 230, 255],
  pastel_pink: [255, 214, 232],
  pastel_orange: [255, 228, 196],
};

function resolveNeedle(value: string): string {
  const t = (value ?? '').trim();
  if (t === 'THISYEAR') return String(new Date().getFullYear());
  if (t === 'NEXTYEAR') return String(new Date().getFullYear() + 1);
  return t;
}

function highlightPdfColorForRow(
  row: Record<string, unknown>,
  rules?: { column: string; operator: string; value: string; color: string }[]
): [number, number, number] | null {
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
    if (match) return HIGHLIGHT_PDF_RGB[rule.color] ?? null;
  }
  return null;
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'report';
}

export async function exportGenericReportToPdf(run: {
  report: { title: string; sectionTitle?: string };
  organization: string;
  columns: string[];
  rows: Record<string, unknown>[];
  truncated?: boolean;
  highlightRules?: { column: string; operator: string; value: string; color: string }[];
}): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const landscape = run.columns.length > 5;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;
  const today = new Date().toISOString().slice(0, 10);

  // Header
  doc.setFontSize(8);
  doc.setTextColor(139, 107, 62);
  doc.setFont('helvetica', 'bold');
  doc.text('HR REPORTING', margin, 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(today, pageW - margin, 10, { align: 'right' });

  doc.setFontSize(13);
  doc.setTextColor(38, 35, 31);
  doc.setFont('helvetica', 'bold');
  doc.text(run.report.title, margin, 17);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(117, 111, 102);
  const subtitle = [run.report.sectionTitle, run.organization].filter(Boolean).join(' — ');
  if (subtitle) doc.text(subtitle, margin, 22);
  const metaY = subtitle ? 27 : 22;
  doc.setFontSize(7);
  doc.text(`${run.rows.length} rows${run.truncated ? ' (truncated to 2000)' : ''}  •  ${run.columns.length} columns`, margin, metaY);

  const head = [run.columns];
  const body = run.rows.map((row) =>
    run.columns.map((col) => {
      const v = row[col];
      return v === null || v === undefined ? '' : String(v);
    }),
  );

  autoTable(doc, {
    startY: metaY + 4,
    head,
    body,
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: [46, 94, 86], textColor: 255, fontStyle: 'bold', fontSize: 6.5 },
    alternateRowStyles: { fillColor: [245, 241, 232] },
    margin: { left: margin, right: margin, top: margin, bottom: 12 },
    didParseCell(data) {
      if (data.section !== 'body' || !run.highlightRules?.length) return;
      const rowIndex = data.row.index;
      const row = run.rows[rowIndex];
      if (!row) return;
      const rgb = highlightPdfColorForRow(row, run.highlightRules);
      if (rgb) data.cell.styles.fillColor = rgb as unknown as string;
    },
    didDrawPage(data) {
      // Footer on every page
      const str = `Page ${data.pageNumber}  •  Confidential — HR Reporting  •  ${today}`;
      doc.setFontSize(6.5);
      doc.setTextColor(140, 133, 122);
      doc.setFont('helvetica', 'normal');
      doc.text(str, pageW / 2, pageH - 6, { align: 'center' });
    },
  });

  const slug = sanitizeFilename(run.report.title.toLowerCase());
  const org = sanitizeFilename(run.organization);
  doc.save(`${slug}-${org}-${today}.pdf`);
}
