/**
 * RFC4180 CSV builder with BOM and 100k row cap.
 */

export const ROW_CAP = 100_000;
export const TRUNCATION_WARNING = '# WARNING: Results truncated at 100,000 rows';

function escapeCell(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsv(headers, rows, options = {}) {
  const { emptyMessage = '# No data for selected scope' } = options;
  const truncated = rows.length > ROW_CAP;
  const dataRows = truncated ? rows.slice(0, ROW_CAP) : rows;

  const lines = [];
  if (truncated) {
    lines.push(TRUNCATION_WARNING);
  }
  if (dataRows.length === 0) {
    lines.push(emptyMessage);
  }

  lines.push(headers.map(escapeCell).join(','));
  for (const row of dataRows) {
    lines.push(headers.map((h) => escapeCell(row[h])).join(','));
  }

  const csv = '\uFEFF' + lines.join('\r\n');
  return {
    csv,
    rowCount: dataRows.length,
    truncated,
    warningHeader: truncated ? TRUNCATION_WARNING : '',
  };
}
