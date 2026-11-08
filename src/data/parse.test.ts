import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildDataset, findSheet, fromTables, matchColumns, parseLevel, parsePair, readFile, rowList, sheetFor, tablesFromWorkbook, type Table } from './parse';

const HEAD = ['Source', 'Target', 'Edge type', 'Edge importance', 'Source asset importance', 'Target asset importance'];
const table = (name: string, rows: unknown[][], firstRow = 1): Table => ({
  name, firstRow, raw: rows, text: rows.map((r) => r.map((c) => (c == null ? null : String(c)))),
});
const files = [{ name: 'test.xlsx', size: 1, format: 'Excel workbook' as const, sheets: [] }];
const assets = (...ids: string[]) => table('Assets', [['Asset ID', 'Asset name'], ...ids.map((id) => [id, `Asset ${id}`])]);
const titles = (r: ReturnType<typeof buildDataset>, level: string) => r.issues.filter((i) => i.level === level).map((i) => i.title);

describe('column matching', () => {
  it('ignores case, spaces and punctuation and prefers canonical names over synonyms', () => {
    const cols = matchColumns(['FROM', 'to', 'Type', 'Importance', 'source_importance', 'Target Importance'], {
      source: { label: 'Source', names: ['source', 'from'], required: true },
      target: { label: 'Target', names: ['target', 'to'], required: true },
    });
    expect(cols).toEqual({ source: 0, target: 1 });
  });

  it('maps common synonyms for every link column', () => {
    const r = buildDataset(table('Links', [['From', 'To', 'Link type', 'Weight', 'Source importance', 'Target importance'], ['A', 'B', 'Power', 3, 2, 1]]), assets('A', 'B'), files);
    expect(titles(r, 'error')).toEqual([]);
    expect(r.dataset!.links).toEqual([{ source: 'A', target: 'B', type: 'Power', importance: 3, source_importance: 2, target_importance: 1 }]);
    expect(r.issues.find((i) => i.title.startsWith('Link Sheet: all 6'))!.detail).toContain('From → Source');
  });

  it('reports missing link columns as an error', () => {
    const r = buildDataset(table('Links', [['Source', 'Target', 'Edge importance'], ['A', 'B', 1]]), assets('A', 'B'), files);
    expect(r.dataset).toBeNull();
    expect(r.issues[0]).toMatchObject({ level: 'error', title: 'Link Sheet: 3 required columns missing' });
    expect(r.issues[0].detail).toContain('Edge type, Source asset importance, Target asset importance');
  });
});

describe('importance values', () => {
  it('accepts 1-3 and Low/Medium/High in any case', () => {
    expect([1, '2', ' 3 ', 2.0, '3.0', 'High', 'l', 'MEDIUM', 'med'].map(parseLevel)).toEqual([1, 2, 3, 2, 3, 3, 1, 2, 2]);
    expect([0, 4, 2.5, '', null, 'very high'].map(parseLevel)).toEqual([null, null, null, null, null, null]);
  });
});

describe('row checks', () => {
  const links = table('Links', [
    HEAD,
    ['A', 'B', 'Power', 3, 3, 2],
    [null, null, null, null, null, null], // blank row: skipped, row numbers keep counting
    ['A', 'A', 'Power', 1, 3, 3], // row 4: self-link
    ['A', 'B', 'Power', 2, 3, 2], // row 5: duplicate
    ['B', 'C', 'Power', 5, 2, 1], // row 6: bad importance
    ['C', 'X', 'Control', 1, 1, 1], // row 7: X not in the asset list
    ['', 'C', 'Power', 1, 1, 1], // row 8: missing source
  ]);
  const r = buildDataset(links, assets('A', 'B', 'C'), files);

  it('lists each problem with its Excel row numbers', () => {
    const byTitle = Object.fromEntries(r.issues.filter((i) => i.level === 'error').map((i) => [i.title, i.detail]));
    expect(byTitle['1 edge from an asset to itself']).toContain('row 4');
    expect(byTitle['1 duplicate edge']).toContain('row 5');
    expect(byTitle['1 Edge importance value not L, M, H or 1, 2, 3']).toContain('row 6');
    expect(byTitle['1 asset ID in the Link Sheet missing from the Asset Sheet']).toMatch(/^X is used in the Link Sheet \(row 7\)/);
    expect(byTitle['1 edge without a Source or Target']).toContain('row 8');
  });

  it('names the bad importance values, Excel errors and near-miss IDs', () => {
    const res = buildDataset(table('Links', [
      HEAD,
      ['A', 'b', 'Power', 'Critical', 'h', 'm'], // row 2: bad level, and "b" is "B" in the Asset Sheet
      ['A', 'B', 'Power', 'L', '#N/A', 'H'], // row 3: Excel error
    ]), assets('A', 'B'), files);
    const byTitle = Object.fromEntries(res.issues.filter((i) => i.level === 'error').map((i) => [i.title, i.detail]));
    expect(byTitle['1 Edge importance value not L, M, H or 1, 2, 3']).toContain('Found “Critical” on row 2');
    expect(byTitle['1 row with Excel errors in the Link Sheet']).toContain('#N/A in Source asset importance (row 3)');
    expect(byTitle['1 asset ID in the Link Sheet missing from the Asset Sheet']).toContain('Close matches in the Asset Sheet: b → B');
  });

  it('rejects duplicate and missing asset IDs', () => {
    const res = buildDataset(table('Links', [HEAD, ['A', 'B', 'P', 1, 1, 1]]), table('Assets', [['ID', 'Name'], ['A', 'a'], ['B', 'b'], ['A', 'again'], ['', 'no id'], ['C', 'c']]), files);
    expect(titles(res, 'error')).toEqual(['1 asset row without an Asset ID', '1 asset ID listed more than once']);
  });

  it('warns about conflicting importance, unlinked assets and blank edge types', () => {
    const res = buildDataset(table('Links', [HEAD, ['A', 'B', 'P', 1, 1, 2], ['B', 'C', '', 1, 3, 1]]), assets('A', 'B', 'C', 'D'), files);
    expect(titles(res, 'error')).toEqual([]);
    expect(titles(res, 'warning')).toEqual(['1 edge without an edge type', '1 asset with conflicting importance values', '1 asset without any edges']);
    expect(res.dataset!.links[1].type).toBe('Unspecified');
  });

  it('formats row lists', () => {
    expect(rowList([4])).toBe('row 4');
    expect(rowList([4, 9, 15])).toBe('rows 4, 9 and 15');
    expect(rowList([1, 2, 3, 4, 5, 6, 7])).toBe('rows 1, 2, 3, 4, 5 and 2 more');
  });
});

describe('asset list', () => {
  it('reads optional type, abbreviation and positions', () => {
    const at = table('Assets', [['Asset ID', 'Name', 'Category', 'Abbr', 'X', 'Y', 'Z'], ['A', 'Alpha', 'Ctl', 'AL', 0, 1, 2], ['B', 'Beta', 'Pwr', 'BE', 1, 1, 1]]);
    const r = buildDataset(table('Links', [HEAD, ['A', 'B', 'P', 1, 1, 1]]), at, files);
    expect(r.dataset).toMatchObject({ hasTypes: true, hasAbbr: true, hasPositions: true });
    expect(r.dataset!.assets[0]).toEqual({ id: 'A', name: 'Alpha', type: 'Ctl', abbr: 'AL', x: 0, y: 1, z: 2 });
  });

  it('warns when an abbreviation is shared', () => {
    const at = table('Assets', [['Asset ID', 'Abbreviation'], ['A', 'SAME'], ['B', 'SAME']]);
    const r = buildDataset(table('Links', [HEAD, ['A', 'B', 'P', 1, 1, 1]]), at, files);
    expect(titles(r, 'warning')).toContain('1 abbreviation used by more than one asset');
  });

  it('requires an asset list', () => {
    const r = buildDataset(table('Links', [HEAD]), null, files);
    expect(titles(r, 'error')).toEqual(['Asset Sheet not found']);
  });
});

describe('two uploads', () => {
  const read = (name: string, ...tables: Table[]) => ({ file: { name, size: 1, format: 'Excel workbook' as const }, tables });
  const linkFile = read('links.xlsx', table('Links', [HEAD, ['A', 'B', 'P', 1, 1, 1]]));
  const assetFile = read('assets.xlsx', assets('A', 'B'));

  it('accepts the two files', () => {
    expect(titles(parsePair(linkFile, assetFile), 'error')).toEqual([]);
  });

  it('spots the files swapped, an empty file, headers only and a sheet without the columns', () => {
    expect(titles(parsePair(assetFile, linkFile), 'error')).toEqual(['links.xlsx looks like the Link Sheet', 'assets.xlsx looks like the Asset Sheet']);
    expect(sheetFor([table('Sheet1', [])], 'assets', 'a.xlsx').issue!.title).toBe('Asset Sheet: a.xlsx is empty');
    expect(sheetFor([table('Links', [HEAD])], 'links', 'l.xlsx').issue!.title).toBe('Link Sheet: no rows');
    expect(sheetFor([table('Notes', [['Owner', 'Date'], ['x', 'y']])], 'links', 'l.xlsx').issue!.detail).toBe('Expected Source and Target columns. Found: Notes (Owner, Date).');
  });
});

describe('sheets and files', () => {
  it('finds sheets by name first, then by columns', () => {
    const edges = table('Edges', [HEAD]), sheet2 = table('Sheet2', [['Asset ID']]), other = table('Notes', [['Text']]);
    expect(findSheet([other, edges], 'links')).toBe(edges);
    expect(findSheet([other, sheet2], 'assets')).toBe(sheet2);
    expect(findSheet([other], 'links')).toBeNull();
  });

  it('keeps leading zeros in CSV IDs', async () => {
    const csv = new File(['Source,Target\n001,002\n'], 'links.csv');
    const { tables } = await readFile(csv);
    expect(tables[0].text[1]).toEqual(['001', '002']);
  });

  it('reads the committed sample without errors', () => {
    const wb = XLSX.read(fs.readFileSync('public/sample/regional-grid.xlsx'));
    const r = fromTables({ name: 'regional-grid.xlsx', size: 1, format: 'Excel workbook' }, tablesFromWorkbook(wb), true);
    expect(titles(r, 'error')).toEqual([]);
    expect(r.dataset).toMatchObject({ hasTypes: true, hasPositions: true, hasAbbr: false });
    expect(r.dataset!.links).toHaveLength(207);
    expect(r.dataset!.assets).toHaveLength(120);
  });
});

describe('public version', () => {
  it('needs both asset and link importance', () => {
    const noImportance = buildDataset(table('Links', [['Source', 'Target', 'Edge type'], ['A', 'B', 'P']]), assets('A', 'B'), files);
    expect(noImportance.issues[0].detail).toContain('needs both asset importance and link importance');
    const blank = buildDataset(table('Links', [HEAD, ['A', 'B', 'P', '', 2, 2]]), assets('A', 'B'), files);
    expect(blank.issues.find((i) => i.level === 'error')!.detail).toContain('Blank cells aren’t allowed'.replace('’', "'"));
  });
});
