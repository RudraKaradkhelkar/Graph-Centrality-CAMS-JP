// The made-up sample network and the downloadable template. Uploaded files go through the same parser.
import * as XLSX from 'xlsx';
import { fromTables, tablesFromWorkbook, type ParseResult } from './parse';

export { shortName, type AssetRow, type Dataset } from './parse';

export const SAMPLE_FILE = 'regional-grid.xlsx';

export async function loadSample(): Promise<ParseResult> {
  const res = await fetch(`${import.meta.env.BASE_URL}sample/${SAMPLE_FILE}`);
  if (!res.ok) throw new Error(`Could not load the sample network (${res.status}).`);
  const buf = await res.arrayBuffer();
  return fromTables({ name: SAMPLE_FILE, size: buf.byteLength, format: 'Excel workbook' }, tablesFromWorkbook(XLSX.read(buf)), true);
}

/** Empty workbook with the expected sheets and columns. */
export function downloadTemplate(): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[
    'Source', 'Target', 'Edge type', 'Edge importance', 'Source asset importance', 'Target asset importance',
  ]]), 'Links');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Asset ID', 'Asset name', 'Asset type', 'Abbreviation']]), 'Assets');
  XLSX.writeFile(wb, 'carma-network-template.xlsx');
}
