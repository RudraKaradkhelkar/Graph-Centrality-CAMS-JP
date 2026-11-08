// Landing page: upload the Asset Sheet and the Link Sheet, check them, then open the dashboard.
import { useRef, useState } from 'react';
import { navigate } from '../App';
import { css } from '../components/css';
import { APP_TAGLINE, Copyright, Credits, Icon, LevelChip, LV, ThemeButton } from '../components/ui';
import { downloadTemplate, loadSample } from '../data/dataset';
import { hasErrors, parsePair, readFile, shortName, type FileRead, type Issue } from '../data/parse';
import { LANES, type Lane } from '../graph/seed';
import { useApp, useLoadStatus } from '../state';

const CARD = 'background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 24px; box-shadow: var(--card-shadow); box-sizing: border-box';
const BTN = 'height: 36px; padding: 0 16px; display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 14px; font-weight: 600; color: var(--text); cursor: pointer';
const TH = 'position: sticky; top: 0; background: var(--table-head); padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: 600';
const TH_SUB = 'margin-top: 2px; font-size: 12px; font-weight: 400; color: var(--text-3)';
const TD = 'padding: 12px 16px; border-bottom: 1px solid var(--divider)';
const SELECT = 'height: 32px; padding: 0 32px 0 12px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 13px; color: var(--text); appearance: none; -webkit-appearance: none';
const H3 = 'margin: 20px 0 0; font-size: 16px; line-height: 24px; font-weight: 600; color: var(--text-strong)';
const UL = 'margin: 8px 0 0; padding: 0 0 0 20px; display: flex; flex-direction: column; gap: 6px; font-size: 15px; line-height: 22px; color: var(--text-2)';

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

type Part = 'assets' | 'links';
/** One upload: the file, and either what was read from it or why it couldn't be read. */
interface Slot { file: File; read?: FileRead; error?: string }
const PARTS: [Part, string][] = [['assets', 'Asset Sheet'], ['links', 'Link Sheet']];

/** "Upload Asset Sheet" / "Upload Link Sheet": click to browse, or drop a file on it. */
function UploadButton(props: { part: Part; label: string; done: boolean; disabled: boolean; onFile(f: File): void }) {
  const [over, setOver] = useState(false);
  const look = props.done
    ? 'border: 1px solid var(--control-border); background: var(--control-bg); color: var(--text)'
    : 'border: 1px solid var(--primary); background: var(--primary); color: var(--primary-text)';
  return (
    <label htmlFor={`upload-${props.part}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) props.onFile(f); }}
      style={css(`position: relative; flex: 1 1 200px; height: 52px; padding: 0 16px; display: inline-flex; align-items: center; justify-content: center; gap: 10px; border-radius: 6px; font-size: 16px; font-weight: 600; white-space: nowrap; cursor: pointer; box-sizing: border-box; ${look}${over ? '; outline: 2px dashed var(--info-icon); outline-offset: 2px' : ''}`)}>
      <Icon name={props.done ? 'check' : 'upload'} size={20} />Upload {props.label}
      <input id={`upload-${props.part}`} type="file" accept=".xlsx,.xls,.csv" disabled={props.disabled}
        style={css('position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none')}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onFile(f); e.target.value = ''; }} />
    </label>
  );
}

export function UploadPage() {
  const app = useApp();
  const load = useLoadStatus();
  const [tab, setTab] = useState<'links' | 'assets'>('links');
  const [slots, setSlotsRaw] = useState<Partial<Record<Part, Slot>>>({});
  // Kept in a ref too, so two files chosen in quick succession both count.
  const slotsRef = useRef(slots);
  const setSlots = (s: Partial<Record<Part, Slot>>) => { slotsRef.current = s; setSlotsRaw(s); };
  const [reading, setReading] = useState<string | null>(null);
  const p = app.parsed;
  const d = p?.dataset ?? null;
  const blocked = p ? hasErrors(p.issues) : true;

  const onFile = async (part: Part, f: File) => {
    setReading(`Reading ${f.name}…`);
    let slot: Slot;
    try { slot = { file: f, read: await readFile(f) }; } catch (e) { slot = { file: f, error: (e as Error).message }; }
    setReading(null);
    // Replacing the sample starts from an empty pair.
    const next = { ...(d?.sample ? {} : slotsRef.current), [part]: slot };
    setSlots(next);
    if (next.links?.read && next.assets?.read) {
      app.setParsed(parsePair(next.links.read, next.assets.read));
      app.setAnalysisName(next.links.file.name.replace(/\.[^.]+$/, ''));
    } else {
      app.setParsed(null);
    }
  };
  const useSample = async () => {
    setSlots({});
    setReading('Loading sample…');
    try {
      app.setParsed(await loadSample());
      app.setAnalysisName('Regional Grid (sample)');
    } catch (e) {
      app.setParsed({ dataset: null, issues: [{ level: 'error', title: 'The sample could not be loaded', detail: (e as Error).message }] });
    } finally {
      setReading(null);
    }
  };
  const clear = () => { app.setParsed(null); setSlots({}); };
  const remove = (part: Part) => {
    const next = { ...slotsRef.current };
    delete next[part];
    setSlots(d?.sample ? {} : next);
    app.setParsed(null);
  };
  const su = app.setup;
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
  const sheetOf = (part: Part) => d?.files.flatMap((f) => f.sheets.map((sh) => ({ ...sh, file: f.name }))).find((sh) => sh.role === part);
  const missing = PARTS.filter(([part]) => !slots[part] && !d?.sample).map(([, label]) => label);
  const status = app.error ? `Analysis failed: ${app.error}`
    : missing.length ? `Upload the ${missing.join(' and the ')} to continue.`
      : PARTS.some(([part]) => slots[part]?.error) || blocked ? 'Fix the problems shown, then upload the file again.'
        : app.busy ? 'Analyzing…' : '';

  // One line per uploaded file: name, sheet used and whether it's ready.
  const slotRow = (part: Part, label: string) => {
    const s = slots[part], sheet = sheetOf(part);
    if (!s && !sheet) return null;
    const name = s?.file.name ?? sheet!.file;
    const bad = !!s?.error || (!!p && blocked);
    const note = s?.error
      ?? (sheet ? `${sheet.name === name ? '' : `Sheet ${sheet.name} · `}${sheet.rows} rows${bad ? ' · needs fixes, see below' : ' · ready'}`
        : p && bad ? 'Needs fixes, see below'
          : `${formatSize(s!.file.size)} · waiting for the ${part === 'assets' ? 'Link Sheet' : 'Asset Sheet'}`);
    return (
      <li key={part} style={css('display: flex; align-items: flex-start; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--table-head)')}>
        <Icon name={bad ? 'error' : 'checkCircle'} size={20} width={1.8} stroke={bad ? 'var(--error)' : 'var(--green)'} style="flex: none; margin-top: 1px" />
        <div style={css('flex: 1; min-width: 0')}>
          <div style={css('font-size: 14px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap')}>{label}: {name}{d?.sample ? ' (sample)' : ''}</div>
          <div style={css(`margin-top: 2px; font-size: 13px; line-height: 20px; color: ${s?.error ? 'var(--error)' : 'var(--text-3)'}`)}>{note}</div>
        </div>
        <button type="button" aria-label={`Remove the ${label}`} onClick={() => remove(part)} style={css('flex: none; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; background: transparent; color: var(--text-3); cursor: pointer')}>
          <Icon name="close" size={16} width={1.8} />
        </button>
      </li>
    );
  };

  return (
    <div style={css('min-height: 100vh; display: flex; flex-direction: column; background: var(--page); color: var(--text)')}>
      <header style={css('padding: 16px 32px 0; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px')}>
        <Credits />
        <div style={css('display: flex; align-items: center; gap: 12px')}><Copyright /><ThemeButton /></div>
      </header>
      <main style={css('width: 100%; max-width: 1280px; margin: 0 auto; padding: 0 32px 32px; box-sizing: border-box')}>
        <section aria-label="CARMA" style={css('padding: 4px 0 24px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center')}>
          <h1 style={css('margin: 0; font-size: 64px; line-height: 72px; font-weight: 700; letter-spacing: 0.04em; color: var(--text-strong)')}>CARMA</h1>
          <p style={css('margin: 0; font-size: 16px; line-height: 24px; color: var(--text-2)')}>{APP_TAGLINE}</p>
        </section>

        <div style={css('display: flex; flex-wrap: wrap; align-items: stretch; gap: 24px')}>
          <section aria-labelledby="readme-h" style={css(`${CARD}; flex: 3 1 560px; min-width: 0; padding: 28px 32px`)}>
            <div style={css('display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px')}>
              <h2 id="readme-h" style={css('margin: 0; font-size: 28px; line-height: 36px; font-weight: 700; letter-spacing: 0.02em; color: var(--text-strong)')}>README</h2>
              <button type="button" onClick={downloadTemplate} style={css(BTN)}><Icon name="download" size={16} />Download Template</button>
            </div>
            <p style={css('margin: 8px 0 0; font-size: 16px; line-height: 24px; color: var(--text)')}>
              Upload <span style={css('font-weight: 600')}>2 files</span>: an Asset Sheet and a Link Sheet, each .xlsx, .xls or .csv.
            </p>
            <h3 style={css(H3)}>Asset Sheet · one row per asset</h3>
            <ul style={css(UL)}>
              <li><b>Asset ID</b> (required): a unique ID for each asset</li>
              <li><b>Asset Name</b>, <b>Asset Type</b>, <b>Abbreviation</b> (optional)</li>
            </ul>
            <h3 style={css(H3)}>Link Sheet · one row per link, Source → Target</h3>
            <ul style={css(UL)}>
              <li><b>Source</b>, <b>Target</b> (required): asset IDs from the Asset Sheet</li>
              <li><b>Edge Type</b> (required): for example Power, Control or Network</li>
              <li><b>Edge Importance</b> (required): L, M, H or 1, 2, 3</li>
              <li><b>Source</b> and <b>Target Asset Importance</b> (required): L, M, H or 1, 2, 3</li>
            </ul>
            <p style={css('margin: 16px 0 0; display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 20px; color: var(--text-3)')}>
              <span style={css('display: flex; gap: 4px')} aria-hidden="true">{[1, 2, 3].map((v) => <LevelChip key={v} lv={v} alt />)}</span>
              L, M, H = Low, Medium, High (any case). The target depends on the source.
            </p>
          </section>

          <section aria-labelledby="upload-h" style={css(`${CARD}; flex: 2 1 400px; min-width: 0; display: flex; flex-direction: column; gap: 14px`)}>
            <h2 id="upload-h" style={css('margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; color: var(--text-strong)')}>Upload Your Network</h2>
            <div>
              <div style={css('display: flex; flex-wrap: wrap; gap: 12px')}>
                {PARTS.map(([part, label]) => (
                  <UploadButton key={part} part={part} label={label} done={!!slots[part]?.read || !!d?.sample} disabled={!!reading} onFile={(f) => void onFile(part, f)} />
                ))}
              </div>
              <p style={css('margin: 8px 0 0; font-size: 14px; color: var(--text-3)')}>Accepted formats: .xlsx, .xls, .csv</p>
            </div>
            {(PARTS.some(([part]) => slots[part]) || d?.sample) && (
              <ul aria-label="Uploaded files" style={css('margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px')}>
                {PARTS.map(([part, label]) => slotRow(part, label))}
              </ul>
            )}
            {reading && <div role="status" style={css('font-size: 14px; color: var(--text-2)')}>{reading}</div>}
            <div style={css('font-size: 14px; color: var(--text-3)')}>
              No files to hand? You can{' '}
              <button type="button" onClick={() => void useSample()} disabled={!!reading}
                style={css('border: 0; padding: 0; background: none; font: inherit; font-weight: 600; color: var(--link); text-decoration: underline; cursor: pointer')}>use the sample network</button>.
            </div>
            <div role="note" aria-label="Sensitive data" style={css('display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; border: 1px solid var(--warn); border-radius: 6px; background: var(--band-medium-bg)')}>
              <Icon name="warn" size={22} width={1.8} stroke="var(--warn)" style="flex: none; margin-top: 1px" />
              <p style={css('margin: 0; font-size: 17px; line-height: 25px; font-weight: 600; color: var(--text)')}>
                You are entering sensitive proprietary infrastructure data. Only use files you are authorized to work with.
              </p>
            </div>
            <div style={css('margin-top: auto; display: flex; flex-direction: column; gap: 8px')}>
              <button type="button" onClick={onAnalyze} disabled={!app.dataset || app.busy || load.stage === 'error'}
                style={css('height: 52px; display: flex; align-items: center; justify-content: center; gap: 10px; border: 0; border-radius: 6px; background: var(--primary); color: var(--primary-text); font: inherit; font-size: 18px; font-weight: 600; cursor: pointer')}>
                {app.busy ? 'Analyzing…' : 'Know Your Asset Network'}
                <Icon name="arrowRight" size={18} width={2} />
              </button>
              <div role="status" aria-live="polite" style={css(`font-size: 13px; color: ${app.error || (p && blocked) ? 'var(--error)' : 'var(--text-3)'}`)}>
                {status ? `${status} ` : ''}{loadText}.
              </div>
            </div>
          </section>
        </div>

        {p && (
          <section aria-labelledby="check-h" style={css(`${CARD}; margin-top: 24px`)}>
            <div style={css('display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px 16px')}>
              <h2 id="check-h" style={css(`margin: 0; font-size: 18px; line-height: 24px; font-weight: 600; color: ${errorCount ? 'var(--error)' : 'var(--text-strong)'}`)}>
                {errorCount ? `${errorCount} ${errorCount === 1 ? 'problem' : 'problems'} to fix before analysis` : 'Structure Check: ready'}
              </h2>
              <button type="button" onClick={clear} style={css(BTN)}><Icon name="close" size={16} />Clear Files</button>
            </div>
            <ul style={css('list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column')}>
              {issues.map((c, i) => (
                <li key={i} data-level={c.level} style={css(`display: flex; gap: 12px; padding: 10px 0${i < issues.length - 1 ? '; border-bottom: 1px solid var(--divider)' : ''}`)}>
                  <IssueIcon level={c.level} />
                  <div style={css('min-width: 0')}>
                    <div style={css(`font-size: 15px; font-weight: 600; color: ${c.level === 'error' ? 'var(--error)' : 'var(--text)'}`)}>{c.title}</div>
                    <div style={css('margin-top: 2px; font-size: 14px; line-height: 20px; color: var(--text-2)')}>{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>

            {types.length > 0 && (
              <>
                <h3 style={css('margin: 20px 0 0; font-size: 14px; font-weight: 600; color: var(--text-2)')}>Graph Lanes</h3>
                <p style={css('margin: 4px 0 0; font-size: 13px; color: var(--text-3)')}>Each asset type is drawn as one cluster. Suggested lanes follow how its assets connect: mostly sending, mostly receiving, or both.</p>
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
        )}

        {d && (
          <section aria-labelledby="prev-h" style={css(`${CARD}; margin-top: 24px`)}>
            <div style={css('display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px 20px')}>
              <div>
                <h2 id="prev-h" style={css('margin: 0; font-size: 18px; line-height: 24px; font-weight: 600; color: var(--text-strong)')}>Preview</h2>
                <p style={css('margin: 4px 0 0; font-size: 13px; color: var(--text-3)')}>{tab === 'links' ? `First 5 of ${d.links.length} links read` : `First 5 of ${d.assets.length} assets`}</p>
              </div>
              <div role="tablist" aria-label="Preview" style={css('display: flex; gap: 2px; padding: 2px; background: var(--seg-bg); border-radius: 6px')}>
                {([['links', 'Link Sheet'], ['assets', 'Asset Sheet']] as const).map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                    style={css(`height: 32px; padding: 0 12px; border: 0; border-radius: 4px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; ${tab === id ? 'background: var(--seg-on-bg); color: var(--seg-on-text); box-shadow: var(--seg-on-shadow)' : 'background: transparent; color: var(--seg-off-text)'}`)}>{label}</button>
                ))}
              </div>
            </div>
            {tab === 'links' ? (
              <div style={css('margin-top: 16px; border: 1px solid var(--border); border-radius: 6px; overflow-x: auto')}>
                <table style={css('width: 100%; min-width: 760px; border-collapse: collapse; font-size: 13px; color: var(--text)')}>
                  <thead>
                    <tr style={css('background: var(--table-head); text-align: left; vertical-align: top')}>
                      {[['Source', 'Asset ID'], ['Target', 'Asset ID'], ['Edge Type', 'Category'], ['Edge Importance', 'L, M, H'], ['Source Asset Importance', 'L, M, H'], ['Target Asset Importance', 'L, M, H']].map(([h, sub]) => (
                        <th key={h} scope="col" style={css(TH + (sub === 'L, M, H' ? '; text-align: right' : ''))}>{h}<div style={css(TH_SUB)}>{sub}</div></th>
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
                          <td key={j} style={css(TD + '; text-align: right')}><span style={css('display: inline-flex; justify-content: flex-end')}><LevelChip lv={LV[v]} /></span></td>
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
      </main>
    </div>
  );
}
