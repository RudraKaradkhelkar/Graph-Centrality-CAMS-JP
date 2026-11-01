// Import network data (port of V3-Upload): read the files, check their structure, preview, then Analyze.
import { useRef, useState } from 'react';
import { navigate } from '../App';
import { css } from '../components/css';
import { APP_TAGLINE, Footer, Icon, LevelChip, LV, ParetoLink, Segmented, ThemeButton } from '../components/ui';
import { downloadTemplate, loadSample } from '../data/dataset';
import { fromTables, hasErrors, parseTwoFiles, readFile, shortName, type Issue, type ParseResult, type SourceFile, type Table } from '../data/parse';
import { LANES, type Lane } from '../graph/seed';
import { useApp, useLoadStatus } from '../state';

const CARD = 'background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 24px; box-shadow: var(--card-shadow)';
const BTN = 'height: 36px; padding: 0 16px; display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 14px; font-weight: 600; color: var(--text); cursor: pointer';
const TH = 'position: sticky; top: 0; background: var(--table-head); padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: 600';
const TH_SUB = 'margin-top: 2px; font-size: 12px; font-weight: 400; color: var(--text-3)';
const TD = 'padding: 12px 16px; border-bottom: 1px solid var(--divider)';
const SELECT = 'height: 32px; padding: 0 32px 0 12px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 13px; color: var(--text); appearance: none; -webkit-appearance: none';

function formatSize(bytes: number) {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function IssueIcon({ level }: { level: Issue['level'] }) {
  const style = 'flex: none; margin-top: 1px';
  if (level === 'ok') return <Icon name="checkCircle" size={20} width={1.8} stroke="var(--green)" style={style} />;
  if (level === 'info') return <Icon name="info" size={20} width={1.8} stroke="var(--info-icon)" style={style} />;
  if (level === 'warning') return <Icon name="warn" size={20} width={1.8} stroke="var(--warn)" style={style} />;
  return <Icon name="error" size={20} stroke="var(--error)" style={style} />;
}

const LEVEL_ORDER: Record<Issue['level'], number> = { error: 0, warning: 1, ok: 2, info: 3 };

function DropZone(props: { id: string; accept: string; title: string; hint: string; compact?: boolean; onFile(f: File): void }) {
  const [over, setOver] = useState(false);
  const zone = 'border: 1.5px dashed ' + (over ? 'var(--info-icon)' : 'var(--drop-border)') + '; border-radius: 6px; background: var(--drop-bg); cursor: pointer';
  const handlers = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) props.onFile(f); },
  };
  const input = (
    <input id={props.id} type="file" accept={props.accept} style={css('position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none')}
      onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onFile(f); e.target.value = ''; }} />
  );
  if (props.compact) {
    return (
      <label htmlFor={props.id} {...handlers} style={css('display: flex; align-items: center; gap: 12px; padding: 16px 16px; ' + zone)}>
        <span style={css('flex: none; width: 36px; height: 36px; color: var(--text-2); display: flex; align-items: center; justify-content: center')}><Icon name="upload" size={18} width={1.8} /></span>
        <span style={css('font-size: 13px; color: var(--text-2)')}>{props.hint}<span style={css('font-weight: 600; color: var(--link)')}>browse</span></span>
        {input}
      </label>
    );
  }
  return (
    <label htmlFor={props.id} {...handlers} style={css('margin-top: 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 28px 24px; text-align: center; ' + zone)}>
      <span style={css('width: 48px; height: 48px; color: var(--text-2); display: flex; align-items: center; justify-content: center')}>
        <Icon name="upload" size={22} width={1.8} />
      </span>
      <span style={css('font-size: 16px; font-weight: 600; color: var(--text)')}>{props.title}</span>
      <span style={css('font-size: 13px; color: var(--text-3)')}>{props.hint}</span>
      <span style={css('margin-top: 4px; height: 36px; padding: 0 16px; display: inline-flex; align-items: center; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font-size: 14px; font-weight: 600; color: var(--text)')}>Browse Files</span>
      {input}
    </label>
  );
}

export function UploadPage() {
  const app = useApp();
  const load = useLoadStatus();
  const [mode, setMode] = useState<'workbook' | 'two'>('workbook');
  const [tab, setTab] = useState<'links' | 'assets'>('links');
  const [pair, setPair] = useState<{ links?: File; assets?: File }>({});
  const [reading, setReading] = useState<string | null>(null);
  const p = app.parsed;
  const d = p?.dataset ?? null;
  // The analysis name follows the loaded file until you type your own.
  const autoName = useRef(app.analysisName);
  const nameFrom = (name: string) => {
    if (app.analysisName === autoName.current) { autoName.current = name; app.setAnalysisName(name); }
  };
  const blocked = p ? hasErrors(p.issues) : true;

  const accept = async (label: string, job: () => Promise<ParseResult>) => {
    setReading(label);
    try {
      app.setParsed(await job());
    } catch (e) {
      app.setParsed({ dataset: null, issues: [{ level: 'error', title: 'The file could not be read', detail: (e as Error).message }] });
    } finally {
      setReading(null);
    }
  };
  // The workbook's sheets stay in memory so a different Links/Assets sheet can be picked without rereading.
  const workbook = useRef<{ meta: Omit<SourceFile, 'sheets'>; tables: Table[] } | null>(null);
  const onWorkbook = (f: File) => {
    void accept(`Reading ${f.name}…`, async () => {
      const { file: meta, tables } = await readFile(f);
      workbook.current = { meta, tables };
      return fromTables(meta, tables);
    });
    nameFrom(f.name.replace(/\.[^.]+$/, ''));
  };
  const onPart = (part: 'links' | 'assets', f: File) => {
    const next = { ...pair, [part]: f };
    setPair(next);
    if (next.links && next.assets) {
      void accept('Reading files…', () => parseTwoFiles(next.links!, next.assets!));
      nameFrom(next.links.name.replace(/\.[^.]+$/, ''));
    }
  };
  const useSample = () => {
    void accept('Loading sample…', loadSample);
    nameFrom('Regional Grid (sample)');
  };
  const clear = () => { app.setParsed(null); setPair({}); workbook.current = null; };
  const pickSheets = (pick: { links: string; assets: string }) => {
    if (workbook.current) app.setParsed(fromTables(workbook.current.meta, workbook.current.tables, false, pick));
  };
  const su = app.setup;
  const kPreset = su.kFrom === 1 && [10, 25, 50].includes(su.kTo) ? su.kTo : 0;
  const onAnalyze = async () => {
    const r = await app.run({ depth: app.depth, k_from: Math.min(su.kFrom, su.kTo), k_to: Math.max(su.kFrom, su.kTo) });
    if (r) navigate('/dashboard');
  };

  const ready = load.stage === 'ready';
  const loadText = load.stage === 'error' ? `Calculations could not load: ${load.message}` : ready ? 'Calculations ready' : `Preparing calculations… ${load.pct}%`;
  const errorCount = p?.issues.filter((i) => i.level === 'error').length ?? 0;
  const issues = p ? [...p.issues].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) : [];
  const types = d?.hasTypes && !d.hasPositions && app.laneByType
    ? [...new Set(d.assets.map((a) => a.type ?? ''))].map((t) => ({ t, count: d.assets.filter((a) => a.type === t).length }))
    : [];

  const sampleLink = (
    <button type="button" onClick={useSample} disabled={!!reading}
      style={css('border: 0; padding: 0; background: none; font: inherit; font-size: 13px; font-weight: 600; color: var(--link); cursor: pointer')}>
      use the sample network
    </button>
  );

  return (
    <div style={css('min-height: 100vh; display: flex; flex-direction: column; background: var(--page); color: var(--text)')}>
      <main style={css('width: 100%; max-width: 1200px; margin: 0 auto; padding: 16px 32px 40px; box-sizing: border-box')}>
        <header style={css('position: relative; padding: 16px 24px 24px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; border-bottom: 1px solid var(--border)')}>
          <div style={css('position: absolute; right: 0; top: 0')}><ThemeButton /></div>
          <h1 style={css('margin: 0; font-size: 32px; line-height: 40px; font-weight: 700; letter-spacing: 0.04em; color: var(--text-strong)')}>CARMA</h1>
          <p style={css('margin: 0; font-size: 16px; line-height: 24px; color: var(--text-2)')}>{APP_TAGLINE}</p>
          <label htmlFor="hero-input" style={css('margin-top: 16px; height: 48px; padding: 0 24px; display: inline-flex; align-items: center; gap: 12px; border-radius: 6px; background: var(--primary); color: var(--primary-text); font-size: 16px; font-weight: 600; cursor: pointer')}>
            <Icon name="upload" size={20} />Upload Your Network Infrastructure File
            <input id="hero-input" type="file" accept=".xlsx,.xls" disabled={!!reading} style={css('position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none')}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) { setMode('workbook'); setPair({}); onWorkbook(f); } e.target.value = ''; }} />
          </label>
          <p style={css('margin: 0; font-size: 13px; line-height: 20px; color: var(--text-3)')}>
            Accepted formats: <span style={css('font-weight: 600; color: var(--text-2)')}>.xlsx</span> or <span style={css('font-weight: 600; color: var(--text-2)')}>.xls</span> (one workbook with Links and Assets sheets),
            or two <span style={css('font-weight: 600; color: var(--text-2)')}>.csv</span> files in UTF-8 (choose Two Files below). Up to 100 MB each.
            <br />Files are read in your browser and never uploaded anywhere.
          </p>
        </header>

        <div style={css('display: flex; flex-wrap: wrap; align-items: flex-start; gap: 24px; margin-top: 24px')}>
          <div style={css('flex: 999 1 560px; min-width: 0; display: flex; flex-direction: column; gap: 24px')}>

            <section aria-labelledby="file-h" style={css(CARD)}>
              <div style={css('display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px 20px')}>
                <div style={css('min-width: 0')}>
                  <h2 id="file-h" style={css('margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; color: var(--text-strong)')}>Data Files</h2>
                  <p style={css('margin: 4px 0 0; font-size: 13px; line-height: 20px; color: var(--text-3)')}>
                    {mode === 'workbook' ? 'One Excel workbook with two sheets: Links (one row per directed link) and Assets (asset IDs and names).' : 'A links file (one row per directed link) and a separate asset list (asset IDs and names).'}
                  </p>
                </div>
                <Segmented label="How your data is packaged" value={mode} onChange={(m) => { setMode(m); setPair({}); }}
                  options={[{ id: 'workbook', label: 'One Workbook' }, { id: 'two', label: 'Two Files' }]} />
              </div>

              <div role="note" aria-label="Accepted file types" style={css('margin-top: 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px 16px; border: 1px solid var(--info-border); border-radius: 6px; background: var(--info-bg)')}>
                <Icon name="info" size={18} stroke="var(--info-icon)" style="flex: none" />
                <span style={css('font-size: 13px; font-weight: 600; color: var(--text)')}>Accepted File Types</span>
                <span style={css('display: flex; flex-wrap: wrap; gap: 8px')}>
                  {['.xlsx', '.xls', '.csv'].map((t) => (
                    <span key={t} style={css(`height: 24px; padding: 0 8px; display: inline-flex; align-items: center; border-radius: 6px; font-size: 12px; font-weight: 600; ${t === '.csv' ? 'background: var(--blue-soft-bg); color: var(--blue-soft-text)' : 'background: var(--green-bg); color: var(--green)'}`)}>{t}</span>
                  ))}
                </span>
                <span style={css('font-size: 13px; color: var(--text-2)')}>Excel workbooks and CSV files (UTF-8), up to 100 MB each</span>
              </div>

              {mode === 'workbook' ? (
                <DropZone id="wb-input" accept=".xlsx,.xls" title="Drag and Drop Your Workbook Here" hint="One Excel file (.xlsx or .xls) with a Links sheet and an Assets sheet" onFile={onWorkbook} />
              ) : (
                <div style={css('margin-top: 16px; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 16px')}>
                  {([['links', 'links-input', '1 · Links File', 'Drop the file with one row per link, or '], ['assets', 'assets-input', '2 · Asset List', 'Drop the file that maps asset IDs to names, or ']] as const).map(([part, id, title, hint]) => (
                    <div key={id} style={css('display: flex; flex-direction: column; gap: 12px')}>
                      <div style={css('display: flex; align-items: baseline; justify-content: space-between; gap: 8px')}>
                        <span style={css('font-size: 13px; font-weight: 600; color: var(--text-label)')}>{title}</span>
                        <span style={css('font-size: 12px; color: var(--text-3)')}>{pair[part] ? pair[part]!.name : '.xlsx, .xls or .csv'}</span>
                      </div>
                      <DropZone compact id={id} accept=".xlsx,.xls,.csv" title={title} hint={hint} onFile={(f) => onPart(part, f)} />
                    </div>
                  ))}
                </div>
              )}
              <div style={css('margin-top: 12px; font-size: 13px; color: var(--text-3); text-align: center')}>No file to hand? You can {sampleLink}.</div>

              {reading && <div role="status" style={css('margin-top: 12px; font-size: 13px; color: var(--text-2)')}>{reading}</div>}

              {d && d.files.map((f) => (
                <div key={f.name} style={css('margin-top: 16px; padding: 16px 16px; border: 1px solid var(--border); border-radius: 6px; background: var(--table-head)')}>
                  <div style={css('display: flex; align-items: center; gap: 16px')}>
                    <span style={css(`flex: none; width: 40px; height: 40px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; border: 1px solid var(--border); color: var(--text-2)`)}>
                      {f.format === 'CSV file' ? 'CSV' : <Icon name="sheet" size={20} width={1.8} />}
                    </span>
                    <div style={css('flex: 1; min-width: 0')}>
                      <div style={css('font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text)')}>{f.name}</div>
                      <div style={css('margin-top: 2px; font-size: 13px; color: var(--text-3)')}>{formatSize(f.size)} · {f.format}{d.sample ? ' · Sample network' : ''}</div>
                    </div>
                    <span style={css(`flex: none; display: inline-flex; align-items: center; gap: 8px; height: 24px; padding: 0 12px; border-radius: 6px; font-size: 12px; font-weight: 600; ${blocked ? 'background: var(--error-bg); color: var(--error)' : 'background: var(--green-bg); color: var(--green)'}`)}>
                      {blocked ? <>Needs Fixes</> : <><Icon name="check" size={14} width={2.2} />Ready</>}
                    </span>
                    <button type="button" aria-label={`Remove ${f.name}`} onClick={clear} style={css('flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; background: transparent; color: var(--text-3); cursor: pointer')}>
                      <Icon name="close" size={18} width={1.8} />
                    </button>
                  </div>
                  {f.sheets.length > 0 && (
                    <div style={css('margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--divider); display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 8px')}>
                      {f.sheets.map((sh) => (
                        <div key={sh.name} style={css('display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: 6px; background: var(--subtle)')}>
                          <Icon name="check" size={16} width={2.2} stroke="var(--green)" style="flex: none" />
                          <span style={css('font-size: 13px; color: var(--text)')}><span style={css('font-weight: 600')}>{f.format === 'CSV file' ? (sh.role === 'links' ? 'Links' : 'Asset List') : sh.name}</span>{f.format === 'CSV file' ? '' : ' sheet'} · {sh.rows} rows</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {p?.sheetChoice && (
                <div style={css('margin-top: 16px; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: 12px')}>
                  {(['links', 'assets'] as const).map((kind) => (
                    <div key={kind} style={css('display: flex; flex-direction: column; gap: 8px')}>
                      <label htmlFor={`pick-${kind}`} style={css('font-size: 13px; font-weight: 600; color: var(--text-label)')}>{kind === 'links' ? 'Network to Analyse (Links Sheet)' : 'Asset List Sheet'}</label>
                      <div style={css('position: relative')}>
                        <select id={`pick-${kind}`} value={p.sheetChoice!.chosen[kind]} onChange={(e) => pickSheets({ ...p.sheetChoice!.chosen, [kind]: e.target.value })} style={css(SELECT + '; width: 100%; height: 36px')}>
                          {p.sheetChoice![kind].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        <Icon name="chevronDown" size={14} width={2} stroke="var(--text-3)" style="position: absolute; right: 10px; top: 11px; pointer-events: none" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {p && (
                <>
                  <h3 style={css('margin: 24px 0 0; font-size: 13px; font-weight: 600; color: var(--text-2)')}>
                    Structure Check{errorCount ? ` · ${errorCount} ${errorCount === 1 ? 'problem' : 'problems'} to fix before analysis` : ''}
                  </h3>
                  <ul style={css('list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column')}>
                    {issues.map((c, i) => (
                      <li key={i} data-level={c.level} style={css(`display: flex; gap: 12px; padding: 10px 0${i < issues.length - 1 ? '; border-bottom: 1px solid var(--divider)' : ''}`)}>
                        <IssueIcon level={c.level} />
                        <div style={css('min-width: 0')}>
                          <div style={css(`font-size: 14px; font-weight: 600; color: ${c.level === 'error' ? 'var(--error)' : 'var(--text)'}`)}>{c.title}</div>
                          <div style={css('margin-top: 2px; font-size: 13px; color: var(--text-3)')}>{c.detail}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {types.length > 0 && (
                <>
                  <h3 style={css('margin: 20px 0 0; font-size: 13px; font-weight: 600; color: var(--text-2)')}>Graph Lanes</h3>
                  <p style={css('margin: 4px 0 0; font-size: 13px; color: var(--text-3)')}>Each asset type is drawn as one cluster. Suggested lanes follow how its assets link: mostly sending, mostly receiving, or both.</p>
                  <div style={css('margin-top: 12px; border: 1px solid var(--border); border-radius: 6px; overflow-x: auto')}>
                    <table style={css('width: 100%; border-collapse: collapse; font-size: 13px; color: var(--text)')}>
                      <thead><tr style={css('background: var(--table-head); text-align: left')}><th scope="col" style={css(TH)}>Asset Type</th><th scope="col" style={css(TH + '; text-align: right')}>Assets</th><th scope="col" style={css(TH)}>Lane</th></tr></thead>
                      <tbody>
                        {types.map(({ t, count }) => (
                          <tr key={t}>
                            <td style={css(TD + '; font-weight: 600')}>{t}</td>
                            <td style={css(TD + '; text-align: right; font-variant-numeric: tabular-nums')}>{count}</td>
                            <td style={css(TD)}>
                              <div style={css('position: relative; display: inline-block')}>
                                <label htmlFor={`lane-${t}`} className="sr-only">Lane for {t}</label>
                                <select id={`lane-${t}`} value={app.laneByType![t]} onChange={(e) => app.setLaneByType({ ...app.laneByType!, [t]: e.target.value as Lane })} style={css(SELECT)}>
                                  {LANES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                                </select>
                                <Icon name="chevronDown" size={14} width={2} stroke="var(--text-3)" style="position: absolute; right: 10px; top: 9px; pointer-events: none" />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>

            {d && (
              <section aria-labelledby="prev-h" style={css(CARD)}>
                <div style={css('display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px 20px')}>
                  <div>
                    <h2 id="prev-h" style={css('margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; color: var(--text-strong)')}>Preview</h2>
                    <p style={css('margin: 4px 0 0; font-size: 13px; color: var(--text-3)')}>{tab === 'links' ? `First 5 of ${d.links.length} links read` : `First 5 of ${d.assets.length} assets`}</p>
                  </div>
                  <Segmented role="tablist" label="Preview" value={tab} onChange={setTab}
                    options={[{ id: 'links', label: 'Links' }, { id: 'assets', label: 'Assets' }]} />
                </div>
                {tab === 'links' ? (
                  <div style={css('margin-top: 16px; border: 1px solid var(--border); border-radius: 6px; overflow-x: auto')}>
                    <table style={css('width: 100%; min-width: 760px; border-collapse: collapse; font-size: 13px; color: var(--text)')}>
                      <thead>
                        <tr style={css('background: var(--table-head); text-align: left; vertical-align: top')}>
                          {[['Source', 'Asset ID'], ['Target', 'Asset ID'], ['Edge Type', 'Category'], ['Edge Importance', '1–3'], ['Source Asset Importance', '1–3'], ['Target Asset Importance', '1–3']].map(([h, sub]) => (
                            <th key={h} scope="col" style={css(TH + (sub === '1–3' ? '; text-align: right' : ''))}>{h}<div style={css(TH_SUB)}>{sub}</div></th>
                          ))}
                        </tr>
                      </thead>
                      <tbody style={css('font-variant-numeric: tabular-nums')}>
                        {d.links.slice(0, 5).map((r, i) => (
                          <tr key={i}>
                            <td style={css(TD + '; font-weight: 600')}>{r.source}</td>
                            <td style={css(TD + '; font-weight: 600')}>{r.target}</td>
                            <td style={css(TD + '; color: var(--text-2)')}>{r.type}</td>
                            {[r.importance, r.source_importance, r.target_importance].map((v, j) => (
                              <td key={j} style={css(TD + '; text-align: right')}><span style={css('display: inline-flex; align-items: center; gap: 8px')}>{v}<LevelChip lv={LV[v]} /></span></td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={css('margin-top: 16px; border: 1px solid var(--border); border-radius: 6px; overflow-x: auto')}>
                    <table style={css('width: 100%; min-width: 640px; border-collapse: collapse; font-size: 13px; color: var(--text)')}>
                      <thead>
                        <tr style={css('background: var(--table-head); text-align: left; vertical-align: top')}>
                          {[['Asset ID', 'Matches Source and Target'], ...(d.hasAbbr ? [['Abbreviation', 'Graph label']] : []), ['Asset Name', 'As uploaded'], ...(d.hasTypes ? [['Asset Type', d.typeSource === 'id-prefix' ? 'From the ID prefix' : d.typeSource === 'id-suffix' ? 'From the ID suffix' : 'Graph cluster']] : []), ['Shown in Legend', 'Up to 5 words']].map(([h, sub]) => (
                            <th key={h} scope="col" style={css(TH)}>{h}<div style={css(TH_SUB)}>{sub}</div></th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {d.assets.slice(0, 5).map((a) => {
                          const s = shortName(a.name);
                          return (
                            <tr key={a.id}>
                              <td style={css(TD + '; font-weight: 600; font-variant-numeric: tabular-nums')}>{a.id}</td>
                              {d.hasAbbr && <td style={css(TD)}>{a.abbr ?? '—'}</td>}
                              <td style={css(TD)}>{a.name}</td>
                              {d.hasTypes && <td style={css(TD + '; color: var(--text-2)')}>{a.type}</td>}
                              <td style={css(TD + `; color: ${s.cut ? 'var(--name-cut)' : 'var(--text-2)'}`)}>{s.text}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </div>

          <aside style={css('flex: 1 1 340px; min-width: 0; display: flex; flex-direction: column; gap: 24px')}>
            <section aria-labelledby="set-h" style={css(CARD)}>
              <h2 id="set-h" style={css('margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; color: var(--text-strong)')}>Analysis Setup</h2>
              <div style={css('margin-top: 20px; display: flex; flex-direction: column; gap: 8px')}>
                <label htmlFor="name-input" style={css('font-size: 13px; font-weight: 600; color: var(--text-label)')}>Analysis Name</label>
                <input id="name-input" type="text" value={app.analysisName} onChange={(e) => app.setAnalysisName(e.target.value)} placeholder="For example: Network review Q4"
                  style={css('height: 40px; padding: 0 12px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 14px; color: var(--text); box-sizing: border-box')} />
              </div>
              <div style={css('margin-top: 20px; display: flex; flex-direction: column; gap: 8px')}>
                <label htmlFor="setup-measure" style={css('font-size: 13px; font-weight: 600; color: var(--text-label)')}>Metric</label>
                <div style={css('position: relative')}>
                  <select id="setup-measure" defaultValue="degree" style={css('width: 100%; height: 40px; padding: 0 36px 0 12px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 14px; color: var(--text); appearance: none; -webkit-appearance: none')}>
                    <option value="degree">Degree Centrality</option>
                    <option disabled>Betweenness Centrality - In Development</option>
                  </select>
                  <Icon name="chevronDown" size={16} width={2} stroke="var(--text-3)" style="position: absolute; right: 12px; top: 11px; pointer-events: none" />
                </div>
              </div>
              <div style={css('margin-top: 20px; display: flex; flex-direction: column; gap: 8px')}>
                <span id="setup-dim" style={css('font-size: 13px; font-weight: 600; color: var(--text-label)')}>Dimension</span>
                <Segmented fill labelledBy="setup-dim" value={su.dim} onChange={(dim) => app.setSetup({ ...su, dim })}
                  options={[{ id: '1d', label: '1D' }, { id: '2d', label: '2D' }]} />
                <span style={css('font-size: 12px; line-height: 20px; color: var(--text-3)')}>
                  {su.dim === '1d' ? 'One score per asset from its links.' : <>Two values per asset (asset importance and link importance), ranked by <ParetoLink text="Pareto fronts" />.</>}
                </span>
              </div>
              <div style={css('margin-top: 20px; display: flex; flex-direction: column; gap: 8px')}>
                <span id="setup-w" style={css('font-size: 13px; font-weight: 600; color: var(--text-label)')}>Weights</span>
                <Segmented fill labelledBy="setup-w" value={su.weighted ? 'w' : 'u'} onChange={(v) => app.setSetup({ ...su, weighted: v === 'w' })}
                  options={[{ id: 'u', label: 'Unweighted' }, { id: 'w', label: 'Weighted' }]} />
              </div>
              <div style={css('margin-top: 20px; display: flex; flex-direction: column; gap: 8px')}>
                <span id="setup-k" style={css('font-size: 13px; font-weight: 600; color: var(--text-label)')}>Highlight Ranks</span>
                <Segmented fill labelledBy="setup-k" value={kPreset as 0 | 10 | 25 | 50} onChange={(k) => app.setSetup({ ...su, kFrom: 1, kTo: k || su.kTo })}
                  options={[{ id: 10, label: 'Top 10' }, { id: 25, label: 'Top 25' }, { id: 50, label: 'Top 50' }, { id: 0, label: 'Custom' }]} />
                {!kPreset && (
                  <div style={css('display: flex; align-items: flex-end; gap: 12px')}>
                    {([['setup-from', 'From Rank', 'kFrom'], ['setup-to', 'To Rank', 'kTo']] as const).map(([id, label, key], j) => (
                      <div key={id} style={css('flex: 1; display: flex; align-items: flex-end; gap: 12px')}>
                        {j === 1 && <span aria-hidden="true" style={css('padding-bottom: 8px; color: var(--text-3)')}>–</span>}
                        <div style={css('flex: 1; display: flex; flex-direction: column; gap: 4px')}>
                          <label htmlFor={id} style={css('font-size: 12px; color: var(--text-2)')}>{label}</label>
                          <input id={id} type="number" min={1} value={su[key]} onChange={(e) => app.setSetup({ ...su, [key]: Math.max(1, Number(e.target.value) || 1) })}
                            style={css('height: 36px; padding: 0 12px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 14px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; box-sizing: border-box; width: 100%')} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={css('margin-top: 20px; display: flex; flex-direction: column; gap: 8px')}>
                <label htmlFor="depth-select" style={css('font-size: 13px; font-weight: 600; color: var(--text-label)')}>Blast Radius Depth</label>
                <div style={css('position: relative')}>
                  <select id="depth-select" value={app.depth} onChange={(e) => app.setDepth(Number(e.target.value))}
                    style={css('width: 100%; height: 40px; padding: 0 36px 0 12px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 14px; color: var(--text); appearance: none; -webkit-appearance: none')}>
                    <option value={2}>2 Hops (Recommended)</option>
                    <option value={1}>1 Hop</option>
                    <option value={3}>3 Hops</option>
                    <option value={4}>4 Hops</option>
                  </select>
                  <Icon name="chevronDown" size={16} width={2} stroke="var(--text-3)" style="position: absolute; right: 12px; top: 11px; pointer-events: none" />
                </div>
                <span style={css('font-size: 12px; line-height: 20px; color: var(--text-3)')}>How far downstream a failure can spread from an asset. You can change this later.</span>
              </div>
              <div style={css('margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--divider); display: flex; flex-direction: column; gap: 12px')}>
                <button type="button" onClick={onAnalyze} disabled={!app.dataset || app.busy || load.stage === 'error'}
                  style={css('height: 40px; display: flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 6px; background: var(--primary); color: var(--primary-text); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer')}>
                  {app.busy ? 'Analyzing…' : 'Analyze'}
                  <Icon name="arrowRight" size={16} width={2} />
                </button>
                <button type="button" onClick={clear} disabled={!p} style={css('height: 40px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 14px; font-weight: 600; color: var(--text); cursor: pointer')}>Cancel</button>
                <div role="status" aria-live="polite" style={css(`font-size: 12px; color: ${load.stage === 'error' || app.error ? 'var(--warn)' : 'var(--text-3)'}`)}>
                  {app.error ? `Analysis failed: ${app.error}`
                    : !p ? `Load a network to analyze it. ${loadText}.`
                      : blocked ? `Fix the problems in the structure check, then upload the file again. ${loadText}.` : loadText}
                </div>
              </div>
            </section>

            <section aria-labelledby="req-h" style={css(CARD)}>
              <h2 id="req-h" style={css('margin: 0; font-size: 16px; line-height: 24px; font-weight: 600; color: var(--text-strong)')}>Expected Format</h2>
              <p style={css('margin: 4px 0 0; font-size: 13px; line-height: 20px; color: var(--text-3)')}>Excel (.xlsx, .xls) or CSV (UTF-8). Column names are matched automatically, ignoring case and spaces.</p>
              <h3 style={css('margin: 20px 0 0; font-size: 13px; font-weight: 600; color: var(--text-label)')}>Links · One Row per Directed Link</h3>
              <dl style={css('margin: 12px 0 0; display: flex; flex-direction: column; gap: 12px')}>
                {[['Source', 'Required. The asset ID the link starts from.'], ['Target', 'Required. The asset ID that depends on the source.'], ['Edge Type', 'Required. Groups links for filtering, such as Power or Control.'], ['Edge Importance', 'Required. 1, 2, 3 or Low, Medium, High. Used by the weighted metrics.'], ['Source and Target Asset Importance', 'Required. 1, 2, 3 or Low, Medium, High. Used by the 2D metrics.']].map(([t, dd]) => (
                  <div key={t}><dt style={css('font-size: 13px; font-weight: 600; color: var(--text)')}>{t}</dt><dd style={css('margin: 2px 0 0; font-size: 12px; line-height: 20px; color: var(--text-2)')}>{dd}</dd></div>
                ))}
              </dl>
              <h3 style={css('margin: 20px 0 0; padding-top: 16px; border-top: 1px solid var(--divider); font-size: 13px; font-weight: 600; color: var(--text-label)')}>Asset List · One Row per Asset</h3>
              <dl style={css('margin: 12px 0 0; display: flex; flex-direction: column; gap: 12px')}>
                {[['Asset ID', 'Required. Every ID used in Source and Target must be listed.'], ['Asset Name', 'Optional. The legend shows up to 5 words.'], ['Abbreviation', 'Optional. Labels on the graph, matching the architecture diagram.'], ['Asset Type', 'Optional. Groups assets into clusters on the graph.']].map(([t, dd]) => (
                  <div key={t}><dt style={css('font-size: 13px; font-weight: 600; color: var(--text)')}>{t}</dt><dd style={css('margin: 2px 0 0; font-size: 12px; line-height: 20px; color: var(--text-2)')}>{dd}</dd></div>
                ))}
              </dl>
              <div style={css('margin-top: 20px; display: flex; align-items: center; gap: 12px; padding: 12px 12px; border-radius: 6px; background: var(--subtle); font-size: 12px; color: var(--text-2)')}>
                <span style={css('display: flex; gap: 4px')} aria-hidden="true">{[1, 2, 3].map((v) => <LevelChip key={v} lv={v} alt />)}</span>
                Importance 1, 2, 3 appears as Low, Medium, High.
              </div>
              <div style={css('margin-top: 20px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px')}>
                <button type="button" onClick={downloadTemplate} style={css(BTN)}><Icon name="download" size={16} />Download Template</button>
              </div>
            </section>
          </aside>
        </div>
      </main>
      <Footer />
    </div>
  );
}
