// CSV that opens cleanly in Excel, Numbers and Google Sheets.

type Cell = string | number | boolean | null | undefined;

function cell(value: Cell): string {
  let s = value === null || value === undefined ? '' : String(value);
  // Spreadsheets run cells starting with = + - @ as formulas; prefix them so text stays text
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  // The byte-order mark tells Excel the file is UTF-8, so names with accents display correctly
  return '﻿' + [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function csvFileName(base: string): string {
  const safe = base.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'export';
  return `${safe}-${new Date().toISOString().slice(0, 10)}.csv`;
}
