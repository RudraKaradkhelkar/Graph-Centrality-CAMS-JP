import { describe, expect, it } from 'vitest';
import { LOOKALIKE_LINKS_CSV, LOOKALIKE_NODES_CSV } from './__fixtures__/lookalike';
import { buildDataset, fromTables, idCategoryEnd, idSegment, parseLevel, parseTwoFiles, readFile, type Table } from './parse';

const csv = (text: string, name: string) => new File([text], name, { type: 'text/csv' });
const table = (name: string, rows: unknown[][]): Table => ({
  name, firstRow: 1, raw: rows, text: rows.map((r) => r.map((c) => (c == null ? null : String(c)))),
});
const errors = (issues: { level: string; title: string }[]) => issues.filter((i) => i.level === 'error').map((i) => i.title);

describe('made-up network with parser quirks', () => {
  it('reads the links and node table without errors', async () => {
    const r = await parseTwoFiles(csv(LOOKALIKE_LINKS_CSV, 'links.csv'), csv(LOOKALIKE_NODES_CSV, 'nodes.csv'));
    expect(errors(r.issues)).toEqual([]);
    const d = r.dataset!;
    expect(d.links).toHaveLength(20);
    expect(d.assets).toHaveLength(16);
    // Header with a line break and a bracketed alias maps to the asset importance columns.
    expect(d.links[0]).toEqual({ source: 'XD_AA', target: 'XS_Q', type: 'Type A', importance: 1, source_importance: 2, target_importance: 2 });
    expect(r.issues.find((i) => i.title.startsWith('Links: all 6'))!.detail)
      .toContain('Source edge importance (Source asset importance) → Source asset importance');
    // Node table: ID, quoted name with commas, importance cross-checked against the links.
    expect(d.assets[2]).toMatchObject({ id: 'XD_AC', name: 'Invented endpoint, misc., charlie', importance: 2 });
    expect(r.issues.map((i) => i.title)).toContain('Asset importance matches the asset list');
    // No type column: the IDs' first segment (XD / XS / XR) splits them into the fewest groups.
    expect(d.typeSource).toBe('id-prefix');
    expect([...new Set(d.assets.map((a) => a.type))]).toEqual(['XD', 'XS', 'XR']);
  });

  it('picks the links and asset sheets out of a workbook with other tables', async () => {
    const links = (await readFile(csv(LOOKALIKE_LINKS_CSV, 'l.csv'))).tables[0];
    const nodes = (await readFile(csv(LOOKALIKE_NODES_CSV, 'n.csv'))).tables[0];
    const tables = [
      { ...nodes, name: 'Asset table' },
      { ...links, name: 'Link table' },
      table('Other links', [['Source', 'Target', 'Notes', 'Priority'], ['XD_AA', 'XS_Q', 'spare', 'Middle']]),
      table('ID list', [['No.', 'Node ID'], [0, 'XD_AA']]),
      table('Matrix', [['row', 'id', 0, 1], ['row', 'id', 'XD_AA', 'XD_AB'], [0, 'XD_AA', 0, 1]]),
      table('Lookup', [['source', 'target', 'ok'], ['Invented endpoint alpha', 'Invented hub Q', 'TRUE']]),
    ];
    const r = fromTables({ name: 'network.xlsx', size: 1, format: 'Excel workbook' }, tables);
    expect(errors(r.issues)).toEqual([]);
    expect(r.dataset!.files[0].sheets.map((s) => s.name)).toEqual(['Link table', 'Asset table']);
    expect(r.issues.map((i) => i.title)).toContain('Using sheets Link table and Asset table');
    expect(r.sheetChoice).toBeUndefined(); // only one complete links table, so no picker
  });

  it('offers a choice when a workbook holds two complete networks', async () => {
    const links = (await readFile(csv(LOOKALIKE_LINKS_CSV, 'l.csv'))).tables[0];
    const nodes = (await readFile(csv(LOOKALIKE_NODES_CSV, 'n.csv'))).tables[0];
    const tables = [{ ...nodes, name: 'Nodes' }, { ...links, name: 'Network 1' }, { ...links, name: 'Network 2' }];
    const meta = { name: 'two.xlsx', size: 1, format: 'Excel workbook' as const };
    const r = fromTables(meta, tables);
    expect(r.sheetChoice).toEqual({ links: ['Network 1', 'Network 2'], assets: ['Nodes'], chosen: { links: 'Network 1', assets: 'Nodes' } });
    expect(fromTables(meta, tables, false, { links: 'Network 2', assets: 'Nodes' }).dataset!.files[0].sheets[0].name).toBe('Network 2');
  });
});

describe('asset importance in the asset list', () => {
  const head = ['Source', 'Target', 'Edge type', 'Edge importance', 'Source asset importance', 'Target asset importance'];
  const files = [{ name: 't.xlsx', size: 1, format: 'Excel workbook' as const, sheets: [] }];

  it('warns when it differs from the links, which win', () => {
    const r = buildDataset(table('Links', [head, ['A', 'B', 'P', 1, 3, 2]]), table('Nodes', [['Node ID', 'Node importance'], ['A', 1], ['B', 2]]), files);
    expect(errors(r.issues)).toEqual([]);
    expect(r.issues.find((i) => i.level === 'warning')!.title).toBe('1 asset: asset list importance differs from the Links sheet');
  });

  it('accepts Middle as a word for 2', () => {
    expect(['Middle', 'mid', 'MIDDLE'].map(parseLevel)).toEqual([2, 2, 2]);
  });
});

describe('category from the ID', () => {
  it('uses the end of the ID that gives the fewest groups', () => {
    expect(idSegment('XD_AB_T2', 'first')).toBe('XD');
    expect(idSegment('XD_AB_T2', 'last')).toBe('T');
    expect(idSegment('PLAIN', 'last')).toBeNull();
    expect(idCategoryEnd(['XD_AA', 'XD_AB', 'XS_P', 'XS_Q'])).toBe('first');
    expect(idCategoryEnd(['A_SW', 'B_SW', 'C_RTR', 'D_RTR'])).toBe('last');
    expect(idCategoryEnd(['A_SW', 'A_RTR', 'B_SW'])).toBe('last'); // tie: suffix
    expect(idCategoryEnd(['ALPHA', 'BETA', 'X_1'])).toBeNull();
  });
});
