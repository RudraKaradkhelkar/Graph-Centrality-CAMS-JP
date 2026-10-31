// Reads uploaded Excel/CSV files into a Dataset and checks their structure. Runs in the browser only;
// nothing is sent anywhere. Calculations stay in metrics/carma_metrics.py.
import * as XLSX from 'xlsx';
import type { LinkRow } from '../analysis-types';

export const MAX_FILE_BYTES = 100e6;

export interface AssetRow {
  id: string;
  name: string;
  /** Asset type: from a type column, or else from the ID suffix (see Dataset.typeSource). */
  type?: string;
  /** Importance from the asset list (cross-checked against the links, which win). */
  importance?: number;
  /** Abbreviation as on the architecture diagram, when the asset list has one. */
  abbr?: string;
  /** Preset position (the sample carries the reference layout's coordinates). */
  x?: number;
  y?: number;
  z?: number;
}

export interface SourceFile {
  name: string;
  size: number;
  format: 'Excel workbook' | 'CSV file';
  /** Sheets read from this file and what they were used for. */
  sheets: { name: string; rows: number; role: 'links' | 'assets' }[];
}

export interface Dataset {
  files: SourceFile[];
  links: LinkRow[];
  assets: AssetRow[];
  hasTypes: boolean;
  /** Where asset types came from: a type column, or (without one) the first or last segment of the ID. */
  typeSource: 'column' | 'id-prefix' | 'id-suffix' | null;
  hasAbbr: boolean;
  hasPositions: boolean;
  sample: boolean;
}

export type IssueLevel = 'error' | 'warning' | 'info' | 'ok';
export interface Issue {
  level: IssueLevel;
  title: string;
  detail: string;
}

export interface ParseResult {
  /** Null when the files could not be read at all; otherwise filled even if there are errors (for the preview). */
  dataset: Dataset | null;
  issues: Issue[];
  /** Set when a workbook holds more than one complete links sheet: the choices and the ones in use. */
  sheetChoice?: { links: string[]; assets: string[]; chosen: { links: string; assets: string } };
}

/** One sheet as rows of cells. `text` holds Excel's displayed text, `raw` the stored values. */
export interface Table {
  name: string;
  /** Excel row number of the first row in `text`/`raw`. */
  firstRow: number;
  text: (string | null)[][];
  raw: unknown[][];
}

interface FieldSpec {
  label: string;
  /** Normalized header names; the first is the canonical one. */
  names: string[];
  required: boolean;
}

const LINK_FIELDS = {
  source: { label: 'Source', names: ['source', 'from', 'sourceid', 'sourceasset', 'sourceassetid', 'start'], required: true },
  target: { label: 'Target', names: ['target', 'to', 'targetid', 'targetasset', 'targetassetid', 'end'], required: true },
  type: { label: 'Edge type', names: ['edgetype', 'linktype', 'type', 'category', 'connectiontype'], required: true },
  importance: { label: 'Edge importance', names: ['edgeimportance', 'linkimportance', 'importance', 'weight', 'edgeweight', 'linkweight'], required: true },
  source_importance: { label: 'Source asset importance', names: ['sourceassetimportance', 'sourceimportance', 'sourceedgeimportance', 'fromimportance'], required: true },
  target_importance: { label: 'Target asset importance', names: ['targetassetimportance', 'targetimportance', 'targetedgeimportance', 'toimportance'], required: true },
} satisfies Record<string, FieldSpec>;

const ASSET_FIELDS = {
  id: { label: 'Asset ID', names: ['assetid', 'id', 'nodeid', 'asset', 'node', 'assetcode', 'code'], required: true },
  name: { label: 'Asset name', names: ['assetname', 'name', 'nodename', 'meaning', 'description', 'fullname'], required: false },
  type: { label: 'Asset type', names: ['assettype', 'type', 'nodetype', 'category', 'class', 'assetclass', 'group'], required: false },
  importance: { label: 'Asset importance', names: ['assetimportance', 'nodeimportance', 'importance'], required: false },
  abbr: { label: 'Abbreviation', names: ['abbreviation', 'abbr', 'abbrev', 'shortname', 'label', 'acronym'], required: false },
  x: { label: 'X', names: ['x'], required: false },
  y: { label: 'Y', names: ['y'], required: false },
  z: { label: 'Z', names: ['z'], required: false },
} satisfies Record<string, FieldSpec>;

const LINK_SHEETS = ['links', 'link', 'edges', 'edge', 'linklist', 'edgelist'];
const ASSET_SHEETS = ['assets', 'asset', 'nodes', 'node', 'assetlist', 'nodelist'];

export const normalize = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------------------
// Reading files
// ---------------------------------------------------------------------------

export function tablesFromWorkbook(wb: XLSX.WorkBook): Table[] {
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = ws['!ref'];
    if (!ref) return { name, firstRow: 1, text: [], raw: [] };
    const firstRow = XLSX.utils.decode_range(ref).s.r + 1;
    const opts = { header: 1 as const, blankrows: true, defval: null };
    return {
      name,
      firstRow,
      text: XLSX.utils.sheet_to_json<(string | null)[]>(ws, { ...opts, raw: false }),
      raw: XLSX.utils.sheet_to_json<unknown[]>(ws, { ...opts, raw: true }),
    };
  });
}

export async function readFile(file: File): Promise<{ file: Omit<SourceFile, 'sheets'>; tables: Table[] }> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 100 MB.`);
  const csv = /\.csv$/i.test(file.name);
  if (!csv && !/\.xlsx?$/i.test(file.name)) throw new Error(`${file.name} is not an .xlsx, .xls or .csv file.`);
  const buf = await file.arrayBuffer();
  // CSV: read as UTF-8 text and keep every cell as typed (IDs like 001 stay 001).
  const wb = csv
    ? XLSX.read(new TextDecoder('utf-8').decode(buf), { type: 'string', raw: true })
    : XLSX.read(buf, { type: 'array' });
  const tables = tablesFromWorkbook(wb);
  if (csv && tables.length) tables[0].name = file.name;
  return { file: { name: file.name, size: file.size, format: csv ? 'CSV file' : 'Excel workbook' }, tables };
}

// ---------------------------------------------------------------------------
// Column and sheet matching
// ---------------------------------------------------------------------------

/** A header's normalized forms: the whole text, and for "Name (Alias)" also "Name" and "Alias". */
function headerForms(h: unknown): string[] {
  const text = String(h ?? '');
  const forms = [normalize(text)];
  const m = text.match(/^([^(]*)\(([^)]*)\)\s*$/);
  if (m) forms.push(normalize(m[1]), normalize(m[2]));
  return forms.filter(Boolean);
}

/** Header text for messages (line breaks inside a cell shown as spaces). */
const showHeader = (h: unknown) => String(h ?? '').replace(/\s+/g, ' ').trim();

function headerRowIndex(t: Table): number {
  return t.text.findIndex((r) => r.some((c) => c != null && String(c).trim() !== ''));
}

/** Column index per field. Canonical names win over synonyms; each column is used once. */
export function matchColumns<F extends Record<string, FieldSpec>>(headers: unknown[], fields: F): Partial<Record<keyof F, number>> {
  const forms = headers.map(headerForms);
  const taken = new Set<number>();
  const out: Partial<Record<keyof F, number>> = {};
  const keys = Object.keys(fields) as (keyof F)[];
  for (const pass of [0, 1]) {
    for (const key of keys) {
      if (out[key] != null) continue;
      const names = pass === 0 ? fields[key].names.slice(0, 1) : fields[key].names.slice(1);
      for (const name of names) {
        const i = forms.findIndex((f, j) => f.includes(name) && !taken.has(j));
        if (i >= 0) { out[key] = i; taken.add(i); break; }
      }
    }
  }
  return out;
}

/**
 * How well a sheet fits as the Links or Assets table: the number of recognised columns, plus a bonus when
 * its name says so (Links/Edges, Assets/Nodes). -1 when it doesn't qualify at all.
 */
function sheetScore(t: Table, kind: 'links' | 'assets'): number {
  const h = headerRowIndex(t);
  const named = (kind === 'links' ? LINK_SHEETS : ASSET_SHEETS).includes(normalize(t.name));
  if (h < 0) return named ? 0 : -1;
  const links = matchColumns(t.text[h], LINK_FIELDS);
  const nameHint = named || (kind === 'links' ? /edge|link/i : /node|asset/i).test(t.name) ? 0.5 : 0;
  if (kind === 'links') {
    if (!named && (links.source == null || links.target == null)) return -1;
    return Object.keys(links).length + nameHint;
  }
  const assets = matchColumns(t.text[h], ASSET_FIELDS);
  if (!named && (assets.id == null || links.source != null)) return -1;
  return Object.keys(assets).length + nameHint;
}

/** Sheets that qualify as Links or Assets, best fit first (ties keep workbook order). */
export function sheetCandidates(tables: Table[], kind: 'links' | 'assets'): Table[] {
  return tables.map((t, i) => ({ t, i, s: sheetScore(t, kind) })).filter((c) => c.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i).map((c) => c.t);
}

export function findSheet(tables: Table[], kind: 'links' | 'assets'): Table | null {
  return sheetCandidates(tables, kind)[0] ?? null;
}

const isCompleteLinks = (t: Table) => {
  const h = headerRowIndex(t);
  return h >= 0 && Object.keys(matchColumns(t.text[h], LINK_FIELDS)).length === Object.keys(LINK_FIELDS).length;
};

// ---------------------------------------------------------------------------
// Cell parsing
// ---------------------------------------------------------------------------

const LEVEL_WORDS: Record<string, number> = { l: 1, low: 1, m: 2, medium: 2, med: 2, middle: 2, mid: 2, h: 3, high: 3 };

/** 1, 2 or 3 from a number or Low/Medium (Middle)/High (L/M/H) in any case; null if invalid or blank. */
export function parseLevel(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 3 ? v : null;
  const s = String(v ?? '').trim().toLowerCase();
  if (/^[123](\.0+)?$/.test(s)) return Number(s);
  return LEVEL_WORDS[s] ?? null;
}

const cellText = (t: Table, r: number, c: number | undefined) => (c == null ? '' : String(t.text[r]?.[c] ?? '').trim());
const isBlankRow = (row: unknown[] | undefined) => !row || row.every((c) => c == null || String(c).trim() === '');

/** "row 4", "rows 4, 9 and 15", "rows 4, 9, 15, 20, 31 and 12 more" */
export function rowList(rows: number[]): string {
  if (rows.length === 1) return `row ${rows[0]}`;
  const shown = rows.slice(0, 5);
  const more = rows.length - shown.length;
  return more > 0 ? `rows ${shown.join(', ')} and ${more} more` : `rows ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const examples = (ids: string[]) => ids.slice(0, 3).join(', ') + (ids.length > 3 ? ` and ${ids.length - 3} more` : '');

/** The asset legend shows the first 5 words of long names. */
/**
 * Category implied by an ID like XD_AB_T2: its first ("XD") or last ("T") underscore segment, without trailing
 * digits. Null for IDs without an underscore.
 */
export function idSegment(id: string, end: 'first' | 'last'): string | null {
  if (!id.includes('_')) return null;
  const parts = id.split('_');
  return (end === 'first' ? parts[0] : parts[parts.length - 1]).replace(/\d+$/, '') || null;
}

/**
 * Which end of the IDs carries the asset category: the one that splits the assets into the fewest groups
 * (at least 2). Ties go to the last segment. Null when neither gives 2 or more groups.
 */
export function idCategoryEnd(ids: string[]): 'first' | 'last' | null {
  const groups = (end: 'first' | 'last') => new Set(ids.map((id) => idSegment(id, end)).filter(Boolean)).size;
  const last = groups('last'), first = groups('first');
  if (last < 2 && first < 2) return null;
  if (last < 2) return 'first';
  if (first < 2) return 'last';
  return first < last ? 'first' : 'last';
}

export function shortName(name: string): { text: string; cut: boolean } {
  const w = name.split(' ');
  return w.length > 5 ? { text: `${w.slice(0, 5).join(' ')}…`, cut: true } : { text: name, cut: false };
}

// ---------------------------------------------------------------------------
// Building the dataset
// ---------------------------------------------------------------------------

/**
 * Turns the Links and Assets tables into a Dataset plus the structure-check list.
 * Any issue with level 'error' blocks Analyze.
 */
export function buildDataset(linksTable: Table | null, assetsTable: Table | null, files: SourceFile[], sample = false): ParseResult {
  const issues: Issue[] = [];
  const err = (title: string, detail: string) => issues.push({ level: 'error', title, detail });
  const warn = (title: string, detail: string) => issues.push({ level: 'warning', title, detail });
  const ok = (title: string, detail: string) => issues.push({ level: 'ok', title, detail });
  const info = (title: string, detail: string) => issues.push({ level: 'info', title, detail });

  if (!linksTable) err('Links sheet not found', 'Expected a sheet called Links (or one with Source and Target columns).');
  if (!assetsTable) err('Asset list not found', 'An asset list is required: a sheet called Assets (or one with an Asset ID column), or a second file in Two files mode.');
  if (!linksTable || !assetsTable) return { dataset: null, issues };

  // --- Links ---
  const lh = headerRowIndex(linksTable);
  const lc = lh >= 0 ? matchColumns(linksTable.text[lh], LINK_FIELDS) : {};
  const missingLink = (Object.keys(LINK_FIELDS) as (keyof typeof LINK_FIELDS)[]).filter((k) => lc[k] == null);
  if (missingLink.length) {
    err(`Links: ${plural(missingLink.length, 'column')} not found`,
      `Missing ${missingLink.map((k) => LINK_FIELDS[k].label).join(', ')}. Columns found: ${lh >= 0 ? linksTable.text[lh].filter((c) => c != null).map(showHeader).join(', ') : 'none'}.`);
  }

  // --- Assets ---
  const ah = headerRowIndex(assetsTable);
  const ac = ah >= 0 ? matchColumns(assetsTable.text[ah], ASSET_FIELDS) : {};
  if (ac.id == null) {
    err('Asset list: Asset ID column not found', `Columns found: ${ah >= 0 ? assetsTable.text[ah].filter((c) => c != null).map(showHeader).join(', ') : 'none'}.`);
  }
  if (missingLink.length || ac.id == null) return { dataset: null, issues };

  const assets: AssetRow[] = [];
  const assetIndex = new Map<string, number>();
  const missingIdRows: number[] = [], dupIdRows: number[] = [], badNodeLevel: number[] = [];
  let positions = ac.x != null && ac.y != null && ac.z != null;
  for (let r = ah + 1; r < assetsTable.text.length; r++) {
    if (isBlankRow(assetsTable.text[r])) continue;
    const row = assetsTable.firstRow + r;
    const id = cellText(assetsTable, r, ac.id);
    if (!id) { missingIdRows.push(row); continue; }
    if (assetIndex.has(id)) { dupIdRows.push(row); continue; }
    const a: AssetRow = { id, name: cellText(assetsTable, r, ac.name) || id };
    if (ac.type != null) a.type = cellText(assetsTable, r, ac.type) || 'Unspecified';
    if (ac.abbr != null) a.abbr = cellText(assetsTable, r, ac.abbr) || undefined;
    if (ac.importance != null) {
      const v = parseLevel(assetsTable.raw[r]?.[ac.importance]);
      if (v == null) badNodeLevel.push(row); else a.importance = v;
    }
    if (positions) {
      const xyz = [ac.x, ac.y, ac.z].map((c) => Number(assetsTable.raw[r]?.[c!]));
      if (xyz.some((v) => !Number.isFinite(v))) positions = false;
      else [a.x, a.y, a.z] = xyz;
    }
    assetIndex.set(id, assets.length);
    assets.push(a);
  }
  if (missingIdRows.length) err(`${plural(missingIdRows.length, 'asset row')} without an Asset ID`, `Fill in the Asset ID on ${rowList(missingIdRows)} of the asset list.`);
  if (dupIdRows.length) err(`${plural(dupIdRows.length, 'asset ID')} listed more than once`, `Remove the repeated IDs on ${rowList(dupIdRows)} of the asset list.`);

  const links: LinkRow[] = [];
  const missingEnds: number[] = [], selfLinks: number[] = [], dupLinks: number[] = [], blankType: number[] = [];
  const badLevel = new Map<string, number[]>();
  const pairs = new Set<string>();
  const unknown = new Map<string, number[]>();
  const levelsOf = new Map<string, Set<number>>();
  for (let r = lh + 1; r < linksTable.text.length; r++) {
    if (isBlankRow(linksTable.text[r])) continue;
    const row = linksTable.firstRow + r;
    const s = cellText(linksTable, r, lc.source), t = cellText(linksTable, r, lc.target);
    if (!s || !t) { missingEnds.push(row); continue; }
    const levels = (['importance', 'source_importance', 'target_importance'] as const).map((k) => {
      const v = parseLevel(linksTable.raw[r]?.[lc[k]!]);
      if (v == null) (badLevel.get(LINK_FIELDS[k].label) ?? badLevel.set(LINK_FIELDS[k].label, []).get(LINK_FIELDS[k].label)!).push(row);
      return v;
    });
    if (s === t) { selfLinks.push(row); continue; }
    const key = `${s}\u0000${t}`;
    if (pairs.has(key)) { dupLinks.push(row); continue; }
    pairs.add(key);
    for (const id of [s, t]) if (!assetIndex.has(id)) (unknown.get(id) ?? unknown.set(id, []).get(id)!).push(row);
    let type = cellText(linksTable, r, lc.type);
    if (!type) { blankType.push(row); type = 'Unspecified'; }
    if (levels.some((v) => v == null)) continue;
    const [importance, si, ti] = levels as number[];
    (levelsOf.get(s) ?? levelsOf.set(s, new Set()).get(s)!).add(si);
    (levelsOf.get(t) ?? levelsOf.set(t, new Set()).get(t)!).add(ti);
    links.push({ source: s, target: t, type, importance, source_importance: si, target_importance: ti });
  }

  const linksRows = links.length;
  const renamed = (Object.keys(LINK_FIELDS) as (keyof typeof LINK_FIELDS)[])
    .filter((k) => normalize(linksTable.text[lh][lc[k]!]) !== LINK_FIELDS[k].names[0])
    .map((k) => `${showHeader(linksTable.text[lh][lc[k]!])} → ${LINK_FIELDS[k].label}`);
  if (missingEnds.length) err(`${plural(missingEnds.length, 'link')} without a Source or Target`, `Fill in both IDs on ${rowList(missingEnds)} of the Links sheet.`);
  for (const [label, rows] of badLevel) err(`${plural(rows.length, `${label} value`)} not 1, 2 or 3`, `Use 1, 2, 3 or Low, Medium, High on ${rowList(rows)} of the Links sheet.`);
  if (selfLinks.length) err(`${plural(selfLinks.length, 'link')} from an asset to itself`, `Remove ${rowList(selfLinks)} of the Links sheet (Source and Target are the same).`);
  if (dupLinks.length) err(`${plural(dupLinks.length, 'duplicate link')}`, `The same Source → Target pair appears again on ${rowList(dupLinks)} of the Links sheet. Keep one row per pair.`);
  if (unknown.size) {
    const ids = [...unknown.keys()];
    err(`${plural(ids.length, 'link ID')} missing from the asset list`, `${examples(ids)} ${ids.length === 1 ? 'is' : 'are'} used in Links (${rowList([...new Set([...unknown.values()].flat())].sort((a, b) => a - b))}) but not in the asset list.`);
  }
  if (!issues.some((i) => i.level === 'error')) {
    ok(`Links: all 6 columns matched · ${plural(linksRows, 'directed link')}`,
      `Each row is read as Source → Target: the target depends on the source.${renamed.length ? ` Matched ${renamed.join(', ')}.` : ''}`);
    ok(`Asset list: ${plural(assets.length, 'asset')}, every link matched`, 'All IDs used in Source and Target appear in the asset list.');
    ok('Importance values are all 1, 2 or 3', 'Shown on the graph as L (1, Low), M (2, Medium) and H (3, High).');
  }
  if (blankType.length) warn(`${plural(blankType.length, 'link')} without an edge type`, `${rowList(blankType)} of the Links sheet will be grouped as “Unspecified”.`);

  const typeCounts = new Map<string, number>();
  links.forEach((l) => typeCounts.set(l.type, (typeCounts.get(l.type) ?? 0) + 1));
  if (typeCounts.size) info(`${plural(typeCounts.size, 'edge type')} detected`, `${[...typeCounts].map(([t, c]) => `${t} (${c})`).join(', ')}. You can filter by type during analysis.`);

  if (ac.importance != null) {
    // The links' asset importance wins; the asset list's own importance column is a cross-check.
    const col = showHeader(assetsTable.text[ah][ac.importance]);
    const differs = assets.filter((a) => a.importance != null && levelsOf.has(a.id)
      && (levelsOf.get(a.id)!.size > 1 || !levelsOf.get(a.id)!.has(a.importance))).map((a) => a.id);
    if (badNodeLevel.length) warn(`${plural(badNodeLevel.length, `${col} value`)} not 1, 2 or 3`, `Ignored on ${rowList(badNodeLevel)} of the asset list; the links' asset importance is used.`);
    if (differs.length) warn(`${plural(differs.length, 'asset')}: asset list importance differs from the links`, `${examples(differs)}. The highest value is used.`);
    else if (!badNodeLevel.length) ok('Asset importance matches the asset list', `${col} agrees with the source and target asset importance in the links for every asset.`);
  }

  const conflicts = [...levelsOf].filter(([, v]) => v.size > 1).map(([id]) => id);
  if (conflicts.length) warn(`${plural(conflicts.length, 'asset')} with conflicting importance values`, `${examples(conflicts)} appear${conflicts.length === 1 ? 's' : ''} with different importance levels across rows. The highest level will be used.`);

  const linked = new Set(links.flatMap((l) => [l.source, l.target]));
  const unlinked = assets.filter((a) => !linked.has(a.id)).map((a) => a.id);
  if (unlinked.length) warn(`${plural(unlinked.length, 'asset')} without any links`, `${examples(unlinked)} ${unlinked.length === 1 ? 'is' : 'are'} in the asset list but in no link. ${unlinked.length === 1 ? 'It still counts' : 'They still count'} in the network size (n), which every score is divided by.`);

  if (ac.abbr != null) {
    const seen = new Map<string, number>();
    assets.forEach((a) => a.abbr && seen.set(a.abbr, (seen.get(a.abbr) ?? 0) + 1));
    const dup = [...seen].filter(([, c]) => c > 1).map(([v]) => v);
    const missing = assets.filter((a) => !a.abbr).length;
    if (dup.length) warn(`${plural(dup.length, 'abbreviation')} used by more than one asset`, `${examples(dup)}. Labels should match the architecture diagram one-to-one.`);
    if (missing) warn(`${plural(missing, 'asset')} without an abbreviation`, 'These assets are labelled with their ID instead.');
    if (!dup.length && !missing) ok('Abbreviations: one per asset', `Graph labels use the ${ASSET_FIELDS.abbr.label.toLowerCase()} column, matching the architecture diagram.`);
  }

  const long = assets.filter((a) => shortName(a.name).cut);
  if (long.length) info(`${plural(long.length, 'name')} longer than 5 words`, `The asset legend shows the first 5 words, for example “${shortName(long[0].name).text}”. Full names stay in tooltips and exports.`);

  // Without a type column, the category encoded in the IDs (first or last underscore segment) is the type.
  let typeSource: Dataset['typeSource'] = ac.type != null ? 'column' : null;
  const end = typeSource ? null : idCategoryEnd(assets.map((a) => a.id));
  if (end) {
    typeSource = end === 'first' ? 'id-prefix' : 'id-suffix';
    assets.forEach((a) => { a.type = idSegment(a.id, end) ?? 'No underscore'; });
  }

  if (ac.x != null && !positions) warn('Positions incomplete', 'Some assets have no X, Y or Z value, so the graph places all assets automatically.');
  info(positions ? 'Graph positions found'
    : typeSource === 'column' ? 'Graph grouped by asset type'
      : typeSource === 'id-prefix' ? 'Graph grouped by ID prefix' : typeSource === 'id-suffix' ? 'Graph grouped by ID suffix' : 'Graph grouped by role in the network',
  positions ? 'The X, Y and Z columns place each asset on the graph.'
    : typeSource === 'column' ? 'Each asset type forms one cluster. Choose the lane for each type below.'
      : typeSource ? `No asset type column, so the part of each ID ${typeSource === 'id-prefix' ? 'before the first' : 'after the last'} underscore (without a trailing number) is used as its type; that end splits the assets into the fewest groups. Check the types and lanes below.`
        : 'No asset type column: assets that only send links go in the top lane, assets that only receive go on the right, the rest in the middle.');

  return {
    dataset: { files, links, assets, hasTypes: typeSource != null, typeSource, hasAbbr: ac.abbr != null, hasPositions: positions, sample },
    issues,
  };
}

/** One workbook with a Links and an Assets sheet. */
export async function parseWorkbook(file: File): Promise<ParseResult> {
  const { file: meta, tables } = await readFile(file);
  return fromTables(meta, tables);
}

/** Picks the Links and Assets sheets (best fit, or `pick` by sheet name) and builds the dataset. */
export function fromTables(meta: Omit<SourceFile, 'sheets'>, tables: Table[], sample = false, pick?: { links?: string; assets?: string }): ParseResult {
  const linkOptions = sheetCandidates(tables, 'links');
  const lt = tables.find((t) => t.name === pick?.links) ?? linkOptions[0] ?? null;
  const assetOptions = sheetCandidates(tables.filter((t) => t !== lt), 'assets');
  const at = tables.find((t) => t.name === pick?.assets && t !== lt) ?? assetOptions[0] ?? null;
  const res = buildDataset(lt, at, [{ ...meta, sheets: sheetsUsed(lt, at) }], sample);
  const unused = tables.filter((t) => t !== lt && t !== at).map((t) => t.name);
  if (!lt || !at) res.issues.push({ level: 'info', title: 'Sheets in this workbook', detail: tables.map((t) => t.name).join(', ') || 'none' });
  else if (unused.length) res.issues.push({ level: 'info', title: `Using sheets ${lt.name} and ${at.name}`, detail: `Also in this workbook, not used: ${unused.join(', ')}.` });
  const complete = linkOptions.filter(isCompleteLinks);
  if (lt && at && complete.length > 1) {
    res.sheetChoice = { links: complete.map((t) => t.name), assets: assetOptions.map((t) => t.name), chosen: { links: lt.name, assets: at.name } };
  }
  return res;
}

/** A links file and a separate asset list (each .xlsx, .xls or .csv). */
export async function parseTwoFiles(linksFile: File, assetsFile: File): Promise<ParseResult> {
  const [l, a] = await Promise.all([readFile(linksFile), readFile(assetsFile)]);
  const lt = findSheet(l.tables, 'links') ?? l.tables[0] ?? null;
  const at = findSheet(a.tables, 'assets') ?? a.tables[0] ?? null;
  return buildDataset(lt, at, [{ ...l.file, sheets: sheetsUsed(lt, null) }, { ...a.file, sheets: sheetsUsed(null, at) }]);
}

function dataRows(t: Table): number {
  const h = headerRowIndex(t);
  return t.text.slice(h + 1).filter((r) => !isBlankRow(r)).length;
}

function sheetsUsed(lt: Table | null, at: Table | null): SourceFile['sheets'] {
  const out: SourceFile['sheets'] = [];
  if (lt) out.push({ name: lt.name, rows: dataRows(lt), role: 'links' });
  if (at) out.push({ name: at.name, rows: dataRows(at), role: 'assets' });
  return out;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === 'error');
