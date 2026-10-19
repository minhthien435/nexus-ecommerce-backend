import { readFile } from 'node:fs/promises';

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(value);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = '';
    } else value += ch;
  }
  if (quoted) throw new Error('CSV_UNCLOSED_QUOTE');
  row.push(value);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ''));
  return rows
    .slice(1)
    .map((cells) =>
      Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ''])),
    );
}

export async function parseDataset(
  path: string,
): Promise<Record<string, unknown>[]> {
  const text = await readFile(path, 'utf8');
  if (path.toLowerCase().endsWith('.json')) {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) throw new Error('JSON_ROOT_MUST_BE_ARRAY');
    return value as Record<string, unknown>[];
  }
  if (!path.toLowerCase().endsWith('.csv'))
    throw new Error('UNSUPPORTED_DATASET_FORMAT');
  return parseCsv(text);
}
