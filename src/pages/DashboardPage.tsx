// Analysis dashboard (port of V3-Dashboard). Every number comes from the analyze() result.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChartOptions, Dimension, Distribution, ReadyVariant, Scope, VariantKey } from '../analysis-types';
import { navigate } from '../App';
import { css } from '../components/css';
import { DistributionChart } from '../components/DistributionChart';
import { ExitPresent, GraphCaption, GraphLegend, IMPORTANCE_KEY, PresentButton, RingKey, RotateButton } from '../components/GraphChrome';
import { AppBar, BandChip, Footer, GLOSSARY, Icon, InfoTip, LabelWithInfo, LevelChip, LV, LV_FULL, ParetoLink, rankingSubtitle, Segmented, ThemeButton, variantTitle } from '../components/ui';
import { shortName } from '../data/dataset';
import { DARK, LIGHT } from '../graph/graph-theme';
import { GraphView, type CameraInfo, type GraphControls } from '../graph/GraphView';
import { useNetworkView, useOrderPositions, useScene } from '../graph/useNetworkView';
import { distribution } from '../metrics-client';
import { useApp } from '../state';

const CARD = 'background: var(--surface); border: 1px solid var(--border); border-radius: 6px; box-shadow: var(--card-shadow)';
const OVERLAY = 'pointer-events: auto; background: var(--overlay-94); box-shadow: var(--overlay-shadow); border: 1px solid var(--border)';
const NAV_BTN = 'width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); color: var(--text); cursor: pointer';
const TOOL_BTN = 'width: 32px; height: 28px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; background: transparent; color: var(--text-2); cursor: pointer';
const CHECK = 'width: 16px; height: 16px; margin: 0; accent-color: var(--check)';
// Graph height: dragged by the handle under it, remembered in this browser; opens filling the window.
const GRAPH_MIN = 400;
const GRAPH_H_KEY = 'carma-graph-height';
// "How to Read This Dashboard": open until closed once in this browser.
const GUIDE_KEY = 'carma-guide-closed';
const GUIDE = [
  'The graph is your network. Each sphere is an asset and each arrow an edge, pointing to the asset that depends on it. Orange spheres are the highlighted ranks; bigger spheres score higher.',
  'Click a sphere, or a row in the list below the graph, to select an asset. Selected Asset shows its edges, its importance and how many assets depend on it.',
  'To see what an asset could take down, set Scope to Blast Radius in Inputs. A cone covers every affected asset, and the list beside the graph names them ring by ring.',
  'The chart at the bottom shows how many assets have High, Medium and Low criticality. Hover any ⓘ for a definition.',
];

function fmtTuple(t: [number, number]) {
  return `${t[0].toFixed(2)}, ${t[1].toFixed(2)}`;
}

function csvCell(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function DashboardPage() {
  const app = useApp();
  const result = app.result!;
  const ds = app.dataset!;
  const T = app.theme === 'dark' ? DARK : LIGHT;

  const [dim, setDim] = useState<Dimension>(app.setup.dim);
  const [scope, setScope] = useState<Scope>('direct');
  const [weightedChoice, setWeighted] = useState(app.setup.weighted);
  const weighted = weightedChoice; // opens weighted; Unweighted is one click away, also in demo mode
  const showValues = app.showValues;
  const [view, setView] = useState<'3d' | 'flat'>('3d');
  const [fromTxt, setFromTxt] = useState(String(result.options.k_from));
  const [toTxt, setToTxt] = useState(String(result.options.k_to));
  const [sel, setSel] = useState<number | null>(null);
  // Two blast radii side by side: the pinned asset and a second one whose blast radius doesn't overlap it.
  const [pinA, setPinA] = useState<number | null>(null);
  const [pairB, setPairB] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ k: number; a: number; shared: number } | null>(null);
  // Distribution chart: options per variant (cut-offs, scale, bins, exclusions, zoom) and the latest counts.
  const [chartOpts, setChartOpts] = useState<Partial<Record<VariantKey, ChartOptions>>>({});
  const [criticalLeft, setCriticalLeft] = useState(true);
  const [chartRes, setChartRes] = useState<{ v: ReadyVariant; optsKey: string; dist: Distribution } | null>(null);
  const [chartBusy, setChartBusy] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(() => { try { return localStorage.getItem(GUIDE_KEY) !== '1'; } catch { return true; } });
  const showGuide = (on: boolean) => {
    setGuideOpen(on);
    try { if (on) localStorage.removeItem(GUIDE_KEY); else localStorage.setItem(GUIDE_KEY, '1'); } catch { /* storage unavailable */ }
  };
  const [q, setQ] = useState('');
  const [sizeByScore, setSizeByScore] = useState(true);
  const [showLevels, setShowLevels] = useState(true);
  const [gatherCone, setGatherCone] = useState(true);
  const [depth, setDepth] = useState(result.options.depth);
  const [spread, setSpread] = useState(result.options.blast_direction);
  const graphWrap = useRef<HTMLDivElement>(null);
  const [graphBox, setGraphBox] = useState({ w: 0, top: 0 });
  const [savedH, setSavedH] = useState<number | null>(() => {
    try { const v = Number(localStorage.getItem(GRAPH_H_KEY)); return v > 0 ? v : null; } catch { return null; }
  });
  const resizeFrom = useRef<{ y: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = graphWrap.current;
    if (!el) return;
    const measure = () => { const r = el.getBoundingClientRect(); setGraphBox({ w: r.width, top: r.top + scrollY }); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [app.present, guideOpen]);
  useEffect(() => {
    try { if (savedH == null) localStorage.removeItem(GRAPH_H_KEY); else localStorage.setItem(GRAPH_H_KEY, String(savedH)); } catch { /* storage unavailable */ }
  }, [savedH]);
  const graphMax = Math.max(GRAPH_MIN, graphBox.w * 1200 / 1400);
  const clampH = (h: number) => Math.round(Math.min(graphMax, Math.max(GRAPH_MIN, h)));
  const graphH = graphBox.w ? clampH(savedH ?? innerHeight - graphBox.top - 13) : undefined; // 13 = the handle
  const allTypes = useMemo(() => Object.keys(result.edge_types), [result.edge_types]);
  const [types, setTypes] = useState<string[] | null>(result.options.edge_types);

  // Live recompute: depth, edge types and the highlighted rank range are analyze() options.
  const k = { from: Number(fromTxt) || 1, to: Number(toTxt) || 1 };
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    const t = setTimeout(() => {
      void app.run({ depth, blast_direction: spread, edge_types: types, k_from: Math.min(k.from, k.to), k_to: Math.max(k.from, k.to) });
    }, 150);
    return () => clearTimeout(t);
  }, [depth, spread, types, k.from, k.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const key: VariantKey = `${dim}-${scope}-${weighted ? 'w' : 'u'}`;
  const chosen = result.variants[key];
  const pending = chosen.status === 'pending';
  const V = (pending ? result.variants[chosen.fallback] : chosen) as ReadyVariant;
  const blast = scope === 'blast';
  const n = result.n;
  const from = V.k_from, to = V.k_to;
  const posOf = useOrderPositions(V);
  const s = sel ?? V.order[0];

  // Chart-only changes are counted by distribution() in Python (fast); defaults come with the analysis.
  const chartOpt = chartOpts[V.key] ?? {};
  const optsKey = JSON.stringify(chartOpt);
  useEffect(() => {
    if (optsKey === '{}') { setChartRes(null); return; }
    let live = true;
    setChartBusy(true);
    const values = V.kind === 'scalar' ? V.score! : V.front!;
    distribution(values, V.kind === 'scalar' ? 'score' : 'front', { ...chartOpt, top: V.top_k })
      .then((d) => { if (live) setChartRes({ v: V, optsKey, dist: d }); })
      .catch(() => { /* keep the last chart */ })
      .finally(() => { if (live) setChartBusy(false); });
    return () => { live = false; };
  }, [V, optsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dist = chartRes && chartRes.v === V && chartRes.optsKey === optsKey ? chartRes.dist : V.distribution;
  // Bands everywhere follow the chart's cut-offs (never its exclusions or zoom).
  const band = dist.band;

  // Each asset's blast radius as a set (itself included). Two assets can be shown together only when these
  // don't overlap at all, so every affected asset belongs to exactly one cone and one list.
  const reach = useMemo(() => result.blast.map((b, x) => new Set([x, ...b.rings.flat().map((m) => m[0])])), [result]);
  const sharedCount = (a: number, b: number) => { let c = 0; reach[b].forEach((k) => { if (reach[a].has(k)) c++; }); return c; };
  const suggestFor = (a: number) => V.order.find((k) => k !== a && result.blast[k].rings.length > 0 && sharedCount(a, k) === 0) ?? null;
  const select = (k: number, shift = false) => {
    const a = blast && shift && pinA == null ? s : pinA;
    if (blast && shift && pinA == null) setPinA(s);
    setSel(k);
    if (!blast || a == null || k === a) { setPairB(null); setNotice(null); return; }
    const shared = sharedCount(a, k);
    if (shared === 0) { setPairB(k); setNotice(null); } else { setPairB(null); setNotice({ k, a, shared }); }
  };
  const unpin = () => { setPinA(null); setPairB(null); setNotice(null); };
  // A new result (depth, direction, filters) can make the pair overlap: fall back to one cone with a note.
  useEffect(() => {
    if (pinA != null && pairB != null) {
      const shared = sharedCount(pinA, pairB);
      if (shared > 0) { setPairB(null); setNotice({ k: pairB, a: pinA, shared }); }
    }
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps
  const pair = blast && pinA != null && pairB != null;
  const blastTargets = blast ? (pair ? [pinA!, pairB!] : [s]) : [];

  const net = useNetworkView(result, ds, app.laneByType);
  const { assetsById, names, labels, geo } = net;
  const sceneData = useScene(net, result, V, posOf);

  const scoreText = (i: number) => V.kind === 'scalar' ? V.score![i].toFixed(3) : fmtTuple(V.normalized![i]);
  const rankText = (i: number) => V.kind === 'scalar' ? `Rank ${V.rank[i]}` : `Front ${V.front![i]}`;
  // Chip beside an asset's name: its place in the ranking (2D: Order position, the list's # column).
  const chipText = (i: number) => `Rank #${V.kind === 'scalar' ? V.rank[i] : posOf[i]}`;
  const vLabel = variantTitle(V.label);

  const range = V.order.slice(from - 1, to);
  const pos = range.indexOf(s);
  const navPos = pos >= 0 ? `${pos + 1} of ${range.length}` : 'Outside range';
  const step = (dir: number) => () => {
    if (!range.length) return;
    setSel(pos < 0 ? (dir > 0 ? range[0] : range[range.length - 1]) : range[(pos + dir + range.length) % range.length]);
  };

  const rings = result.blast[s].rings;
  const down = rings.reduce((a, r) => a + r.length, 0);
  const pct = Math.round(down / (n - 1) * 100) + '%';
  const Way = spread === 'against' ? 'Upstream' : 'Downstream';
  const hopBreakdown = Array.from({ length: depth }, (_, h) => `${rings[h]?.length ?? 0} at ${h + 1} ${h ? 'hops' : 'hop'}`).join(', ');
  const linksOf = (x: number) => result.out_links[x] + result.in_links[x];
  const reachCount = (x: number) => result.blast[x].rings.reduce((t, r) => t + r.length, 0);
  const navStat = pair ? `${labels[pinA!]}: ${reachCount(pinA!)} · ${labels[pairB!]}: ${reachCount(pairB!)} ${Way}`
    : blast ? (down ? `${down} ${Way} · ${pct} of Network` : `No ${Way} Assets`) : `${linksOf(s)} ${linksOf(s) === 1 ? 'Direct Edge' : 'Direct Edges'}`;

  const variantCell = (vk: VariantKey) => {
    const v = result.variants[vk];
    if (v.status === 'pending') return { v: 'Pending', r: 'supervisor' };
    const r = v.kind === 'scalar' ? `#${v.rank[s]}` : `#${v.order.indexOf(s) + 1}`;
    if (!showValues) return { v: (vk === V.key ? band : v.band)[s], r };
    return { v: v.kind === 'scalar' ? v.score![s].toFixed(3) : `Front ${v.front![s]}`, r };
  };

  const metricTitle = variantTitle(chosen.label);
  const dimTxt = dim === '1d'
    ? 'Scores each asset by all its edges, incoming and outgoing.'
    : <>Ranks each asset on two values: the importance of the assets at both ends of its edges, and {weighted ? 'the importance of the edges' : 'the number of edges'}. Assets that are not beaten on both share a <ParetoLink />.</>;
  const scopeTxt = blast
    ? `Extends to every asset ${spread === 'against' ? 'upstream (against the edges)' : 'downstream'} within ${depth} ${depth === 1 ? 'hop' : 'hops'}${dim === '2d' ? '; each adds its own 2D values' : ''}${weighted ? ', weakened at each hop by edge importance' : ''}.`
    : 'Counts only its own edges.';
  const weightTxt = weighted ? 'Each edge counts by its importance (Low 1, Medium 2, High 3).' : 'Every edge counts equally.';
  const pendingTxt = pending ? ' The 2D blast-radius score is pending the supervisor; ranks shown are 2D direct.' : '';

  const legendRows = useMemo(() => {
    const ql = q.toLowerCase();
    return result.ids.map((_, i) => i).sort((a, b) => (result.ids[a] < result.ids[b] ? -1 : 1))
      .filter((i) => !ql || result.ids[i].toLowerCase().includes(ql) || labels[i].toLowerCase().includes(ql) || names[i].toLowerCase().includes(ql));
  }, [q, result.ids, labels, names]);

  const exportCsv = () => {
    const abbr = ds.hasAbbr ? ['Abbreviation'] : [];
    const head = V.kind === 'scalar'
      ? ['Order', 'Rank', 'Asset ID', ...abbr, 'Asset Name', 'Assigned Importance', 'Criticality Band', 'Score']
      : ['Order', 'Pareto Front', 'Asset ID', ...abbr, 'Asset Name', 'Assigned Importance', 'Criticality Band', 'Degree Tuple (Node-Importance, Edge-Importance)', 'Normalized Tuple'];
    const rows = range.map((i, j) => {
      const who = [result.ids[i], ...(ds.hasAbbr ? [assetsById.get(result.ids[i])?.abbr ?? ''] : []), names[i], LV_FULL[result.importance[i]], band[i]];
      return V.kind === 'scalar'
        ? [from + j, V.rank[i], ...who, V.score![i]]
        : [from + j, V.front![i], ...who, `(${V.raw![i].join(', ')})`, `(${V.normalized![i].map((x) => x.toFixed(6)).join(', ')})`];
    });
    const text = [[`# ${metricTitle}, Ranks ${from}-${to}`], head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = `carma-${key}-ranks-${from}-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const sortMax = Math.max(...V.sort_value) || 1;
  const noLinks = result.ids.filter((_, i) => linksOf(i) === 0).length;

  const sphere = (i: number) => {
    const on = posOf[i] >= from && posOf[i] <= to, c = on ? T.org : T.sph[V.shade_bin[i]];
    return c[1];
  };

  const exportBlast = (x: number) => {
    const head = ['Ring', 'Hops', 'Asset ID', ...(ds.hasAbbr ? ['Abbreviation'] : []), 'Asset Name', 'Asset Type', 'Reached Via (Asset ID)', 'Edge Type',
      'Edge Importance', 'Criticality Band', V.kind === 'scalar' ? 'Rank' : 'Pareto Front', V.kind === 'scalar' ? 'Score' : 'Normalized Tuple'];
    const rows = result.blast[x].rings.flatMap((ring, h) => ring.map(([a, p, t, w]) => [
      `Ring ${h + 1}`, h + 1, result.ids[a], ...(ds.hasAbbr ? [assetsById.get(result.ids[a])?.abbr ?? ''] : []), names[a],
      assetsById.get(result.ids[a])?.type ?? '', result.ids[p], result.link_types[t], LV_FULL[w], band[a],
      V.kind === 'scalar' ? V.rank[a] : V.front![a], V.kind === 'scalar' ? V.score![a] : `(${V.normalized![a].map((v) => v.toFixed(6)).join(', ')})`,
    ]));
    const text = [[`# Blast Radius of ${result.ids[x]} (${depth} ${depth === 1 ? 'Hop' : 'Hops'}${spread === 'against' ? ', Against Edges' : ''}), Ranked by ${vLabel}`], head, ...rows]
      .map((r) => r.map(csvCell).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    link.download = `carma-blast-radius-${result.ids[x]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // Pinning hint or the overlap note at the top of the affected-assets panel.
  const blastPanelHint = () => {
    const a = notice ? notice.a : pinA;
    if (a == null) {
      return <p style={css('margin: 0; padding: 12px 16px; font-size: 12px; line-height: 20px; color: var(--text-3); border-bottom: 1px solid var(--divider)')}>Pin an asset (or Shift-click a second one) to show two separate blast radii side by side.</p>;
    }
    if (pair && !notice) return null;
    const sug = suggestFor(a);
    return (
      <div role="status" style={css(`padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; line-height: 20px; border-bottom: 1px solid var(--divider); background: ${notice ? 'var(--band-medium-bg)' : 'var(--subtle)'}; color: var(--text)`)}>
        <span>
          {notice
            ? `${labels[notice.k]} shares ${notice.shared} affected ${notice.shared === 1 ? 'asset' : 'assets'} with ${labels[a]}, so they can't be shown side by side. Showing ${labels[notice.k]} only.`
            : `Pinned ${labels[a]}. Click another asset to show its blast radius next to it; only assets with a completely separate blast radius can be paired.`}
        </span>
        {sug != null && (
          <button type="button" onClick={() => select(sug)} style={css('align-self: flex-start; height: 28px; padding: 0 12px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 12px; font-weight: 600; color: var(--text); cursor: pointer')}>
            Show {labels[a]} with {labels[sug]} ({chipText(sug)})
          </button>
        )}
        {sug == null && <span style={css('color: var(--text-3)')}>No asset has a blast radius separate from {labels[a]} at this depth.</span>}
      </div>
    );
  };

  // One list per cone: every affected asset grouped by ring, with counts in the headers.
  const blastList = (x: number) => {
    const rs = result.blast[x].rings, total = reachCount(x);
    return (
      <section key={x} aria-label={`Blast radius of ${labels[x]}`} style={css('flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; border-bottom: 1px solid var(--divider)')}>
        <div style={css('padding: 12px 16px 12px; display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; border-bottom: 1px solid var(--divider)')}>
          <div style={css('min-width: 0')}>
            <div style={css('font-size: 13px; font-weight: 600; color: var(--text)')}>Blast Radius of {labels[x]}: {total} {total === 1 ? 'Asset' : 'Assets'}</div>
            <div style={css('margin-top: 2px; font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap')}>{names[x]} · {chipText(x)} · {depth} {depth === 1 ? 'Hop' : 'Hops'} {Way} · {vLabel}</div>
          </div>
          <button type="button" aria-label={`Download the blast radius of ${labels[x]} as CSV`} onClick={() => exportBlast(x)} style={css('flex: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); color: var(--text-2); cursor: pointer')}><Icon name="download" size={14} /></button>
        </div>
        <div style={css('flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 8px')}>
          {rs.map((ring, h) => (
            <div key={h}>
              <div style={css('position: sticky; top: 0; z-index: 1; padding: 8px 8px 4px; background: var(--surface); font-size: 12px; font-weight: 600; color: var(--text-2)')}>
                Ring {h + 1} · {h + 1} {h ? 'Hops' : 'Hop'}{h === 0 ? ' (Inner)' : ''} <span style={css('font-weight: 500; color: var(--text-3)')}>· {ring.length} {ring.length === 1 ? 'Asset' : 'Assets'}</span>
              </div>
              {ring.map(([a, p, t, w]) => (
                <button key={a} type="button" onClick={(e) => select(a, e.shiftKey)} title={`${labels[a]} · ${names[a]}`}
                  style={css(`width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; align-items: center; padding: 8px 8px; border: 0; border-radius: 6px; background: ${a === s ? 'var(--row-selected)' : 'transparent'}; font: inherit; text-align: left; color: var(--text); cursor: pointer`)}>
                  <span style={css('font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap')}>{labels[a]}</span>
                  <span style={css('justify-self: end')}>{showValues ? <span style={css('font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums')}>{scoreText(a)}</span> : <BandChip band={band[a]} size="sm" />}</span>
                  <span style={css('font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap')}>
                    {names[a]}{assetsById.get(result.ids[a])?.type ? ` · ${assetsById.get(result.ids[a])!.type}` : ''} · via {labels[p]} ({result.link_types[t]}, {LV[w]})
                  </span>
                  <span style={css('justify-self: end; font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums')}>{rankText(a)}</span>
                </button>
              ))}
            </div>
          ))}
          {!rs.length && <div style={css('padding: 12px 8px; font-size: 13px; color: var(--text-3)')}>No assets are affected within {depth} {depth === 1 ? 'hop' : 'hops'}.</div>}
        </div>
      </section>
    );
  };

  const overlay = (info: CameraInfo, c: GraphControls) => (
    <>
      <div style={css('position: absolute; left: 20px; right: 20px; top: 20px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 12px; pointer-events: none')}>
        <div style={css('min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 12px')}>
          <div data-ui="1" style={css(`max-width: 100%; box-sizing: border-box; ${OVERLAY}; padding: 12px 16px; border-radius: 6px; cursor: default`)}>
            <div style={css('font-size: 12px; color: var(--text-3); white-space: nowrap')}>Degree Centrality · Ranks {from}–{to} Highlighted</div>
            <div style={css('margin-top: 2px; font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap')}>{metricTitle}</div>
          </div>
          <div data-ui="1" style={css(`width: 252px; max-width: 100%; ${OVERLAY}; background: var(--overlay-96); border-radius: 6px; overflow: hidden; cursor: default`)}>
            <button type="button" aria-expanded={legendOpen} onClick={() => setLegendOpen(!legendOpen)} style={css('width: 100%; height: 40px; padding: 0 12px; display: flex; align-items: center; justify-content: space-between; border: 0; background: transparent; font: inherit; font-size: 13px; font-weight: 600; color: var(--text); cursor: pointer')}>
              <span style={css('display: flex; align-items: center; gap: 8px')}>Asset Legend <span style={css('font-size: 12px; font-weight: 500; color: var(--text-3)')}>{n}</span></span>
              <Icon name="chevronDown" size={14} width={2} stroke="var(--text-3)" style={`transition: transform 150ms; transform: rotate(${legendOpen ? 180 : 0}deg)`} />
            </button>
            {legendOpen && (
              <>
                <div style={css('padding: 0 12px 8px; border-bottom: 1px solid var(--divider)')}>
                  <label htmlFor="legend-q" className="sr-only">Search assets</label>
                  <input id="legend-q" type="search" placeholder="Search ID or name" value={q} onChange={(e) => setQ(e.target.value)}
                    style={css('width: 100%; height: 32px; padding: 0 12px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--search-bg); font: inherit; font-size: 12px; color: var(--text); box-sizing: border-box')} />
                </div>
                <div style={css('max-height: 300px; overflow-y: auto; padding: 4px 0')}>
                  {legendRows.map((i) => (
                    <button key={i} type="button" onClick={(e) => select(i, e.shiftKey)} style={css(`width: 100%; display: grid; grid-template-columns: 10px 58px minmax(0, 1fr); align-items: center; gap: 8px; padding: 8px 12px; border: 0; background: ${i === s ? 'var(--row-selected)' : 'transparent'}; font: inherit; font-size: 12px; text-align: left; color: var(--text); cursor: pointer`)}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: sphere(i) }} />
                      <span style={css('font-weight: 600; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis')}>{labels[i]}</span>
                      <span style={css('color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap')}>{shortName(names[i]).text}</span>
                    </button>
                  ))}
                  {!legendRows.length && <div style={css('padding: 12px 12px; font-size: 12px; color: var(--text-3)')}>No assets match.</div>}
                </div>
              </>
            )}
          </div>
        </div>

        <div data-ui="1" role="group" aria-label="Selected asset" style={css('justify-self: center; min-width: 0; max-width: 100%; pointer-events: auto; min-height: 44px; padding: 6px 8px 6px 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; background: var(--overlay-97); border: 1px solid var(--border); border-radius: 6px; box-shadow: var(--selbar-shadow); white-space: nowrap; box-sizing: border-box; cursor: default')}>
          <span style={css(`display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: var(--text-2)`)}>
            <span aria-hidden="true" style={css(blast ? 'width: 16px; height: 12px; clip-path: polygon(0 50%, 100% 0, 100% 100%); background: var(--orange)' : 'width: 16px; height: 3px; border-radius: 2px; background: var(--score-bar)')} />
            {blast ? 'Blast Radius' : 'Direct Edges'}
          </span>
          <div style={css('display: flex; align-items: center; gap: 2px')}>
            <button type="button" aria-label="Previous asset in range" onClick={step(-1)} style={css(NAV_BTN)}><Icon name="chevronLeft" size={14} width={2.2} /></button>
            <span aria-live="polite" style={css('min-width: 76px; text-align: center; font-size: 12px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums')}>{navPos}</span>
            <button type="button" aria-label="Next asset in range" onClick={step(1)} style={css(NAV_BTN)}><Icon name="chevronRight" size={14} width={2.2} /></button>
          </div>
          <span aria-hidden="true" style={css('width: 1px; height: 24px; background: var(--border)')} />
          <span style={css('display: flex; align-items: center; gap: 8px')}>
            <span aria-hidden="true" style={{ width: 12, height: 12, flex: 'none', borderRadius: '50%', background: sphere(s), boxShadow: `0 0 0 1.5px ${T.ringGap}, 0 0 0 3px ${T.ring}` }} />
            <span style={css('font-size: 13px; font-weight: 600; color: var(--text)')}>{labels[s]}</span>
            <span className="gv-narrow-hide" title={names[s]} style={css('max-width: 150px; overflow: hidden; text-overflow: ellipsis; font-size: 13px; color: var(--text-3)')}>{names[s]}</span>
          </span>
          <span style={css('padding: 2px 8px; border-radius: 6px; background: var(--orange-soft-bg); font-size: 12px; font-weight: 600; color: var(--orange-text)')}>{chipText(s)}</span>
          <span style={css('padding-right: 8px; font-size: 12px; color: var(--text-2); font-variant-numeric: tabular-nums')}>{navStat}</span>
          {blast && (pinA == null ? (
            <button type="button" onClick={() => { setPinA(s); setNotice(null); }} title="Keep this asset's blast radius and pick a second asset (or Shift-click one)"
              style={css('height: 28px; padding: 0 12px; margin-right: 8px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 12px; font-weight: 600; color: var(--text); cursor: pointer')}>Pin</button>
          ) : (
            <span style={css('display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 4px 0 12px; margin-right: 8px; border-radius: 6px; background: var(--orange-soft-bg); font-size: 12px; font-weight: 600; color: var(--orange-text)')}>
              Pinned {labels[pinA]}
              <button type="button" aria-label={`Unpin ${labels[pinA]}`} onClick={unpin} style={css('width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 5px; background: transparent; color: inherit; cursor: pointer')}><Icon name="close" size={12} width={2.2} /></button>
            </span>
          ))}
        </div>

        <div data-ui="1" className="gv-tools" style={css('justify-self: end; display: flex; gap: 8px; pointer-events: auto; cursor: default')}>
          <div role="group" aria-label="View mode" style={css(`display: flex; gap: 2px; padding: 4px; ${OVERLAY}; border-radius: 6px`)}>
            {(['3d', 'flat'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                style={css(`height: 28px; padding: 0 12px; border: 0; border-radius: 6px; background: ${view === v ? 'var(--view-on-bg)' : 'transparent'}; color: ${view === v ? 'var(--view-on-text)' : 'var(--view-off-text)'}; font: inherit; font-size: 12px; font-weight: ${view === v ? 600 : 500}; cursor: pointer`)}>
                {v === '3d' ? '3D' : 'Top-Down'}
              </button>
            ))}
          </div>
          <div style={css(`display: flex; padding: 4px; gap: 2px; ${OVERLAY}; border-radius: 6px`)}>
            <button type="button" aria-label="Reset view" onClick={c.resetView} style={css(TOOL_BTN)}><Icon name="reset" /></button>
            <button type="button" aria-label="Fit to screen" onClick={c.fitView} style={css(TOOL_BTN)}><Icon name="fit" /></button>
            <button type="button" aria-label="Full screen" onClick={c.fullScreen} style={css(TOOL_BTN)}><Icon name="fullscreen" /></button>
          </div>
        </div>
      </div>

      <div style={css('position: absolute; left: 20px; right: 20px; bottom: 20px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: end; gap: 12px; pointer-events: none')}>
        <div data-ui="1" style={css(`justify-self: start; box-sizing: border-box; ${OVERLAY}; padding: 12px 16px; border-radius: 6px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: var(--text-2); white-space: nowrap; cursor: default`)}>
          <div style={css('display: flex; align-items: center; gap: 16px')}>
            <span style={css('display: flex; align-items: center; gap: 8px')}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: T.sph[1][1] }} />
              <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: '50%', background: T.sph[1][1] }} />
              Size = Score
            </span>
            <span style={css('display: flex; align-items: center; gap: 8px')}>
              <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: '50%', background: T.org[1] }} />
              Ranks {from}–{to}
            </span>
            <span style={css('display: flex; align-items: center; gap: 8px')}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', border: `2px solid ${T.ring}` }} />Selected</span>
            <span style={css('display: flex; align-items: center; gap: 8px')}>
              <span aria-hidden="true" style={{ position: 'relative', width: 20, height: 4, borderRadius: 2, background: T.e0[1] }}>
                <span style={{ position: 'absolute', right: -3, top: '50%', width: 7, height: 8, marginTop: -4, clipPath: 'polygon(0 0, 100% 50%, 0 100%)', background: T.e0[2] }} />
              </span>
              Depends On
            </span>
          </div>
          {blast && (
            <div style={css('display: flex; align-items: center; gap: 8px')}>
              <span aria-hidden="true" style={{ width: 22, height: 12, clipPath: 'polygon(0 50%, 100% 0, 100% 100%)', background: `rgba(${T.cone}, 0.6)` }} />
              Blast Cone: {app.theme === 'dark' ? 'Brightest' : 'Darkest'} at the Asset
            </div>
          )}
          {blast && <RingKey depth={depth} T={T} />}
          {weighted && showLevels && (
            <div style={css('display: flex; align-items: center; gap: 8px')}>
              <span aria-hidden="true" style={css('display: flex; gap: 4px')}>{[1, 2, 3].map((v) => <LevelChip key={v} lv={v} size={15} />)}</span>
              {IMPORTANCE_KEY} (On Spheres and Edges)
            </div>
          )}
        </div>

        <div data-ui="1" className="gv-narrow-hide" style={css(`justify-self: center; min-width: 0; max-width: 100%; box-sizing: border-box; overflow: hidden; text-overflow: ellipsis; ${OVERLAY}; padding: 8px 16px; border-radius: 6px; font-size: 12px; white-space: nowrap; color: var(--text-3); cursor: default`)}>
          {info.nameTier ? `Top ${info.nameTier} named, zoom in for more` : 'All assets named'} · Click to select · Drag to rotate · Ctrl + scroll to zoom
        </div>

        <div data-ui="1" style={css('justify-self: end; pointer-events: auto; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; cursor: default')}>
          <div role="img" aria-label="Orientation of the X, Y and Z axes" style={css(`position: relative; width: 52px; height: 52px; border-radius: 50%; ${OVERLAY}; box-sizing: border-box`)}>
            {info.gizmo.map((a) => (
              <span key={a.l}><span style={css(a.s)} /><span style={css(a.t)}>{a.l}</span></span>
            ))}
          </div>
          <div style={css(`display: flex; ${OVERLAY}; border-radius: 6px; overflow: hidden`)}>
            <button type="button" aria-label="Rotate left" onClick={c.rotL} style={css('width: 36px; height: 32px; display: flex; align-items: center; justify-content: center; border: 0; background: transparent; color: var(--text-2); cursor: pointer')}><Icon name="reset" /></button>
            <button type="button" aria-label={info.auto ? 'Stop auto-rotate' : 'Start auto-rotate'} aria-pressed={info.auto} onClick={c.toggleAuto}
              style={css(`width: 36px; height: 32px; display: flex; align-items: center; justify-content: center; border: 0; border-left: 1px solid var(--border); border-right: 1px solid var(--border); background: ${info.auto ? 'var(--toggle-on-bg)' : 'transparent'}; color: ${info.auto ? 'var(--toggle-on-text)' : 'var(--text-2)'}; cursor: pointer`)}>
              {info.auto
                ? <Icon name="pause" />
                : <Icon name="play" />}
            </button>
            <button type="button" aria-label="Rotate right" onClick={c.rotR} style={css('width: 36px; height: 32px; display: flex; align-items: center; justify-content: center; border: 0; background: transparent; color: var(--text-2); cursor: pointer')}><Icon name="rotateRight" /></button>
          </div>
          <div style={css(`display: flex; flex-direction: column; align-items: stretch; ${OVERLAY}; border-radius: 6px; overflow: hidden`)}>
            <button type="button" aria-label="Zoom in" onClick={c.zoomIn} style={css('width: 44px; height: 32px; display: flex; align-items: center; justify-content: center; border: 0; background: transparent; color: var(--text-2); cursor: pointer')}><Icon name="plus" width={2} /></button>
            <span aria-live="polite" style={css('padding: 4px 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); font-size: 12px; font-weight: 600; color: var(--text); text-align: center; font-variant-numeric: tabular-nums')}>{info.zoomPct}</span>
            <button type="button" aria-label="Zoom out" onClick={c.zoomOut} style={css('width: 44px; height: 32px; display: flex; align-items: center; justify-content: center; border: 0; background: transparent; color: var(--text-2); cursor: pointer')}><Icon name="minus" width={2} /></button>
          </div>
        </div>
      </div>
    </>
  );

  const presets = [10, 25, 50].map((nn) => ({ id: nn, label: `Top ${nn}` }));
  const preset = from === 1 && [10, 25, 50].includes(to) ? to : null;
  const ringPct = (c: number) => (down ? Math.round(c / down * 100) : 0);

  // Present mode: only the graph, fitted and centred, with a caption; the affected-assets lists stay beside it
  // while a blast cone is shown.
  if (app.present) {
    const panel = blast && blastTargets.length > 0;
    const caption = pair ? `Blast Radii of ${labels[pinA!]} and ${labels[pairB!]}` : blast ? `Blast Radius of ${labels[s]}` : `Ranks ${from}–${to} Highlighted`;
    return (
      <div style={css('position: fixed; inset: 0; z-index: 50; background: var(--graph-bg); display: flex; align-items: center; justify-content: center')}>
        <ExitPresent />
        <div style={{ width: `min(calc(100vw - ${panel ? 380 : 0}px), calc(100vh * 1400 / 1200))` }}>
          <GraphView
            data={sceneData} fitZ={geo.fitZ} fitH={geo.fitH} startZoom="fit" autoRotate rotateSpeed={6} theme={T} sel={s} from={from} to={to} weighted={weighted} showLevels={showLevels}
            sizeByScore={sizeByScore} gatherCone={gatherCone} blastTargets={blastTargets} frameKey={blast ? blastTargets.join('-') : ''} view={view} labelStyle="inside"
            ariaLabel={(i) => `${labels[i]}, ${names[i]}, ${rankText(i).toLowerCase()}`}
            tip={(i) => ({ title: `${labels[i]} · ${names[i]}`, line: `${rankText(i)} · ${showValues ? `Score ${scoreText(i)}` : `Criticality ${band[i]}`} · Assigned Importance ${LV_FULL[result.importance[i]]}` })}
            onSelect={select}
            overlay={(info, c) => (
              <>
                <GraphCaption big title={metricTitle} sub={caption} />
                <GraphLegend T={T} from={from} to={to} levels={weighted && showLevels} blast={blast} depth={depth} />
                <RotateButton info={info} c={c} />
              </>
            )}
          />
        </div>
        {panel && (
          <aside aria-label="Affected assets" style={css('flex: none; width: 380px; height: 100vh; display: flex; flex-direction: column; border-left: 1px solid var(--border); background: var(--surface)')}>
            {blastPanelHint()}
            {blastTargets.map((x) => blastList(x))}
          </aside>
        )}
      </div>
    );
  }

  return (
    <div style={css('min-height: 100vh; display: flex; flex-direction: column; background: var(--page); color: var(--text)')}>
      <AppBar />
      <div style={css('background: var(--surface); border-bottom: 1px solid var(--border); padding: 16px 24px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px')}>
        <div style={css('min-width: 0')}>
          <nav aria-label="Breadcrumb" style={css('display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-3)')}>
            <a href="#/upload" style={css('color: var(--text-3); text-decoration: none')}>Analyses</a>
            <span aria-hidden="true">/</span>
            <span>{app.analysisName || 'Untitled Analysis'}</span>
          </nav>
          <h1 style={css('margin: 2px 0 0; font-size: 20px; line-height: 28px; font-weight: 600; color: var(--text-strong)')}>{app.analysisName || 'Untitled Analysis'}</h1>
          <div style={css('margin-top: 2px; display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 13px; color: var(--text-3)')}>
            <span>{ds.files.map((f) => f.name).join(' + ')}</span>
            <span>{n} Assets</span>
            <span>{result.m} Directed Edges{result.options.edge_types ? ' (Filtered)' : ''}</span>
          </div>
        </div>
        <div style={css('margin-left: auto; display: flex; flex-wrap: wrap; gap: 8px')}>
          {!app.demo && (
            <span title="Unweighted variants are shown. Remove ?research from the address for demo mode."
              style={css('height: 36px; padding: 0 12px; display: inline-flex; align-items: center; border-radius: 6px; background: var(--blue-soft-bg); color: var(--blue-soft-text); font-size: 13px; font-weight: 600')}>Research Mode</span>
          )}
          {!guideOpen && (
            <button type="button" onClick={() => showGuide(true)} style={css('height: 36px; padding: 0 16px; display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 14px; font-weight: 600; color: var(--text); cursor: pointer')}><Icon name="info" size={16} />How to Read This Dashboard</button>
          )}
          <button type="button" onClick={() => navigate('/upload')} style={css('height: 36px; padding: 0 16px; display: inline-flex; align-items: center; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 14px; font-weight: 600; color: var(--text); cursor: pointer')}>Replace Data</button>
          <button type="button" onClick={() => navigate('/compare')} style={css('height: 36px; padding: 0 16px; display: inline-flex; align-items: center; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 14px; font-weight: 600; color: var(--text); cursor: pointer')}>Compare 1D vs 2D</button>
          <PresentButton />
          <ThemeButton />
        </div>
      </div>

      {guideOpen && (
        <section aria-labelledby="guide-h" style={css('padding: 12px 24px 16px; display: flex; align-items: flex-start; gap: 16px; background: var(--surface); border-bottom: 1px solid var(--border)')}>
          <div style={css('flex: 1; min-width: 0')}>
            <h2 id="guide-h" style={css('margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; color: var(--text-strong)')}>How to Read This Dashboard</h2>
            <ol style={css('margin: 8px 0 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 8px 24px; font-size: 13px; line-height: 20px; color: var(--text-2)')}>
              {GUIDE.map((t, k) => (
                <li key={k} style={css('display: flex; gap: 8px')}><span style={css('flex: none; font-weight: 600; color: var(--text-strong); font-variant-numeric: tabular-nums')}>{k + 1}.</span><span>{t}</span></li>
              ))}
            </ol>
          </div>
          <button type="button" aria-label="Close the guide" title="Close the guide (reopen it from the header)" onClick={() => showGuide(false)} style={css('flex: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; background: transparent; color: var(--text-3); cursor: pointer')}><Icon name="close" size={16} /></button>
        </section>
      )}
      <div style={css('display: flex; align-items: flex-start')}>
      <div ref={graphWrap} style={css('flex: 1; min-width: 0')}>
      <GraphView
          data={sceneData} fitZ={geo.fitZ} fitH={geo.fitH} startZoom={ds.hasPositions ? 1 : 'fit'} height={graphH} theme={T} sel={s} from={from} to={to} weighted={weighted} showLevels={showLevels}
          sizeByScore={sizeByScore} gatherCone={gatherCone} blastTargets={blastTargets} frameKey={blast ? blastTargets.join('-') : ''} view={view} labelStyle="inside"
          ariaLabel={(i) => `${labels[i]}, ${names[i]}, ${rankText(i).toLowerCase()}`}
          tip={(i) => ({ title: `${labels[i]} · ${names[i]}`, line: `${labels[i] !== result.ids[i] ? `ID ${result.ids[i]} · ` : ''}${rankText(i)} · ${showValues ? `Score ${scoreText(i)}` : `Criticality ${band[i]}`} · Assigned Importance ${LV_FULL[result.importance[i]]}` })}
          onSelect={select} overlay={overlay}
        />
        <div role="separator" aria-orientation="horizontal" aria-label="Graph height" tabIndex={0}
          aria-valuemin={GRAPH_MIN} aria-valuemax={Math.round(graphMax)} aria-valuenow={graphH}
          title="Drag to change the graph's height · double-click to reset"
          onPointerDown={(e) => { if (graphH == null) return; e.currentTarget.setPointerCapture(e.pointerId); resizeFrom.current = { y: e.clientY, h: graphH }; }}
          onPointerMove={(e) => { const r = resizeFrom.current; if (r) setSavedH(clampH(r.h + e.clientY - r.y)); }}
          onPointerUp={() => { resizeFrom.current = null; }}
          onDoubleClick={() => setSavedH(null)}
          onKeyDown={(e) => {
            if (graphH == null || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
            e.preventDefault();
            setSavedH(clampH(graphH + (e.key === 'ArrowUp' ? -24 : 24)));
          }}
          style={css('height: 12px; display: flex; align-items: center; justify-content: center; background: var(--surface); border-bottom: 1px solid var(--border); cursor: row-resize; touch-action: none')}>
          <span aria-hidden="true" style={css('width: 40px; height: 4px; border-radius: 2px; background: var(--control-border)')} />
        </div>
      </div>
      {blast && (
        // Beside the graph so both cones and both lists fit one screen (deliverable 2).
        <aside aria-label="Affected assets" style={css('position: relative; flex: none; width: 380px; align-self: stretch; border-left: 1px solid var(--border); border-bottom: 1px solid var(--border); background: var(--surface)')}>
          <div style={css('position: absolute; inset: 0; display: flex; flex-direction: column')}>
            {blastPanelHint()}
            {blastTargets.map((x) => blastList(x))}
          </div>
        </aside>
      )}
      </div>

      <div style={css('padding: 24px; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 24px')}>
        <aside aria-labelledby="inputs-h" style={css(`flex: 1 1 320px; min-width: 0; ${CARD}; padding: 20px; box-sizing: border-box; display: flex; flex-direction: column; gap: 24px`)}>
          <div>
            <h2 id="inputs-h" style={css('margin: 0; font-size: 16px; line-height: 20px; font-weight: 600; color: var(--text-strong)')}>Inputs</h2>
            <p role="status" aria-live="polite" style={css(`margin: 2px 0 0; font-size: 12px; color: ${app.error ? 'var(--warn)' : 'var(--text-3)'}`)}>
              {app.error ? `Analysis failed: ${app.error}` : app.busy ? 'Updating results…' : 'Choose what to measure and which assets to highlight.'}
            </p>
          </div>

          <div style={css('display: flex; flex-direction: column; gap: 8px')}>
            <LabelWithInfo term="Degree Centrality"><label htmlFor="measure" style={css('font-size: 12px; font-weight: 600; color: var(--text-3)')}>Centrality Measure</label></LabelWithInfo>
            <div style={css('position: relative')}>
              <select id="measure" defaultValue="degree" style={css('width: 100%; height: 36px; padding: 0 36px 0 12px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 14px; font-weight: 600; color: var(--text); appearance: none; -webkit-appearance: none')}>
                <option value="degree">Degree Centrality</option>
                <option disabled>Betweenness Centrality - In Development</option>
              </select>
              <Icon name="chevronDown" size={16} width={2} stroke="var(--text-3)" style="position: absolute; right: 11px; top: 10px; pointer-events: none" />
            </div>
          </div>

          <section aria-labelledby="variant-h" style={css('display: flex; flex-direction: column; gap: 16px')}>
            <h3 id="variant-h" style={css('margin: 0; font-size: 12px; font-weight: 600; color: var(--text-3)')}>Variant</h3>
            <div style={css('display: flex; flex-direction: column; gap: 8px')}>
              <LabelWithInfo term="Dimension"><span id="dim-l" style={css('font-size: 13px; font-weight: 600; color: var(--text-label)')}>Dimension</span></LabelWithInfo>
              <Segmented fill labelledBy="dim-l" value={dim} onChange={setDim} options={[{ id: '1d', label: '1D' }, { id: '2d', label: '2D' }]} />
            </div>
            <div style={css('display: flex; flex-direction: column; gap: 8px')}>
              <LabelWithInfo term="Scope"><span id="scope-l" style={css('font-size: 13px; font-weight: 600; color: var(--text-label)')}>Scope</span></LabelWithInfo>
              <Segmented fill wrap labelledBy="scope-l" value={scope} onChange={setScope} options={[{ id: 'direct', label: 'Asset Importance Rankings' }, { id: 'blast', label: 'Blast Radius' }]} />
              {blast && (
                <div style={css('margin-top: 4px; display: flex; align-items: center; justify-content: space-between; gap: 8px')}>
                  <LabelWithInfo term="Blast Radius Depth"><span id="depth-l" style={css('font-size: 13px; color: var(--text-2)')}>Blast Radius Depth</span></LabelWithInfo>
                  <div role="group" aria-labelledby="depth-l" style={css('display: flex; align-items: center; border: 1px solid var(--control-border); border-radius: 6px; overflow: hidden')}>
                    <button type="button" aria-label="Fewer hops" disabled={depth <= 1} onClick={() => setDepth(depth - 1)} style={css('width: 32px; height: 32px; border: 0; background: var(--control-bg); color: var(--text-2); font: inherit; font-size: 16px; cursor: pointer')}>−</button>
                    <span aria-live="polite" style={css('min-width: 64px; text-align: center; font-size: 13px; font-weight: 600; color: var(--text); background: var(--control-bg); border-left: 1px solid var(--border); border-right: 1px solid var(--border); line-height: 32px')}>{depth} {depth === 1 ? 'Hop' : 'Hops'}</span>
                    <button type="button" aria-label="More hops" disabled={depth >= 4} onClick={() => setDepth(depth + 1)} style={css('width: 32px; height: 32px; border: 0; background: var(--control-bg); color: var(--text-2); font: inherit; font-size: 16px; cursor: pointer')}>+</button>
                  </div>
                </div>
              )}
              {blast && (
                <div style={css('margin-top: 4px; display: flex; flex-direction: column; gap: 8px')}>
                  <LabelWithInfo term="Spreads"><span id="spread-l" style={css('font-size: 13px; color: var(--text-2)')}>Spreads</span></LabelWithInfo>
                  <Segmented fill labelledBy="spread-l" value={spread} onChange={setSpread}
                    options={[{ id: 'follow', label: 'Along Edges' }, { id: 'against', label: 'Against Edges' }]} />
                </div>
              )}
            </div>
            <div style={css('display: flex; flex-direction: column; gap: 8px')}>
              <LabelWithInfo term="Weights"><span id="weight-l" style={css('font-size: 13px; font-weight: 600; color: var(--text-label)')}>Weights</span></LabelWithInfo>
              <Segmented fill labelledBy="weight-l" value={weighted ? 'w' : 'u'} onChange={(v) => setWeighted(v === 'w')} options={[{ id: 'u', label: 'Unweighted' }, { id: 'w', label: 'Weighted' }]} />
            </div>
            <div style={css('padding: 12px 16px; background: var(--subtle); border-radius: 6px')}>
              <div style={css('font-size: 13px; font-weight: 600; color: var(--text)')}>{metricTitle}</div>
              <p style={css('margin: 4px 0 0; font-size: 12px; line-height: 20px; color: var(--text-2); text-wrap: pretty')}>{dimTxt} {scopeTxt} {weightTxt}{pendingTxt}</p>
            </div>
          </section>

          <section aria-labelledby="ranks-h" style={css('display: flex; flex-direction: column; gap: 12px')}>
            <LabelWithInfo term="Highlight Ranks"><h3 id="ranks-h" style={css('margin: 0; font-size: 12px; font-weight: 600; color: var(--text-3)')}>Highlight Ranks</h3></LabelWithInfo>
            <Segmented fill label="Quick ranges" value={preset} onChange={(nn) => { setFromTxt('1'); setToTxt(String(nn)); setSel(null); }} options={presets} />
            <div style={css('display: flex; align-items: flex-end; gap: 12px')}>
              {([['rank-from', 'From Rank', fromTxt, setFromTxt], ['rank-to', 'To Rank', toTxt, setToTxt]] as const).map(([id, label, val, set], j) => (
                <div key={id} style={css('flex: 1; display: flex; align-items: flex-end; gap: 12px')}>
                  {j === 1 && <span aria-hidden="true" style={css('padding-bottom: 8px; color: var(--text-3)')}>–</span>}
                  <div style={css('flex: 1; display: flex; flex-direction: column; gap: 4px')}>
                    <label htmlFor={id} style={css('font-size: 12px; color: var(--text-2)')}>{label}</label>
                    <input id={id} type="number" min={1} max={n} value={val} onChange={(e) => set(e.target.value)}
                      style={css('height: 36px; padding: 0 12px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 14px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; box-sizing: border-box; width: 100%')} />
                  </div>
                </div>
              ))}
            </div>
            <p style={css('margin: 0; font-size: 12px; line-height: 20px; color: var(--text-3)')}>{range.length} assets shown in orange. Use the arrows above the graph to step through them one at a time.</p>
          </section>

          <section aria-labelledby="display-h" style={css('display: flex; flex-direction: column; gap: 12px')}>
            <h3 id="display-h" style={css('margin: 0; font-size: 12px; font-weight: 600; color: var(--text-3)')}>Display</h3>
            {([['Importance Value', showValues, app.setShowValues], ['Size Spheres by Score', sizeByScore, setSizeByScore], ['Show L / M / H When Weighted', showLevels, setShowLevels], ['Gather Affected Assets into the Blast Cone', gatherCone, setGatherCone]] as const).map(([label, val, set]) => (
              <label key={label} style={css('display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--text); cursor: pointer')}>
                <input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)} style={css(CHECK)} />{label}
              </label>
            ))}
          </section>

          <section aria-labelledby="types-h" style={css('display: flex; flex-direction: column; gap: 8px')}>
            <div style={css('display: flex; align-items: center; justify-content: space-between')}>
              <LabelWithInfo term="Edge Types"><h3 id="types-h" style={css('margin: 0; font-size: 12px; font-weight: 600; color: var(--text-3)')}>Edge Types</h3></LabelWithInfo>
              {types && (
                <button type="button" onClick={() => setTypes(null)} style={css('border: 0; padding: 0; background: none; font: inherit; font-size: 12px; font-weight: 600; color: var(--link); cursor: pointer')}>Reset</button>
              )}
            </div>
            {allTypes.map((t) => {
              const on = !types || types.includes(t);
              return (
                <label key={t} style={css('display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--text); cursor: pointer')}>
                  <input type="checkbox" checked={on} style={css(CHECK)} onChange={() => {
                    const cur = types ?? allTypes;
                    const next = on ? cur.filter((x) => x !== t) : [...cur, t];
                    setTypes(next.length === allTypes.length ? null : allTypes.filter((x) => next.includes(x)));
                  }} />
                  <span style={css('flex: 1; font-variant-numeric: tabular-nums')}>
                    Edge Type: <span style={css('font-weight: 600')}>{t}</span>
                    <span style={css('color: var(--text-3)')}> | Assets: {result.edge_type_assets[t]} | Edges: {result.edge_types[t]}</span>
                  </span>
                </label>
              );
            })}
            {types && <p style={css('margin: 0; font-size: 12px; line-height: 20px; color: var(--text-3)')}>Filtered: rankings use only the checked edge types. All {n} assets still count.</p>}
          </section>
        </aside>

        {/* At most two columns (list and selected asset), each half the width; one column below 2 x 340px. */}
        <div aria-label="Outputs" style={css('flex: 999 1 640px; min-width: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(max(340px, calc((100% - 24px) / 2)), 100%), 1fr)); gap: 24px; align-items: start')}>
          <section aria-labelledby="rank-list-h" style={css(`min-width: 0; ${CARD}; overflow: hidden`)}>
            <div style={css('padding: 16px 20px 16px; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--divider)')}>
              <div style={css('min-width: 0')}>
                <h2 id="rank-list-h" style={css('margin: 0; font-size: 16px; line-height: 20px; font-weight: 600; color: var(--text-strong)')}>List of Most Important Critical Assets</h2>
                <p style={css('margin: 2px 0 0; font-size: 12px; color: var(--text-3)')}>{rankingSubtitle(V, from, to, depth, spread === 'against')}</p>
                <p style={css('margin: 2px 0 0; font-size: 12px; color: var(--text-3)')}>{IMPORTANCE_KEY}</p>
                {V.kind === 'pareto' && <p style={css('margin: 2px 0 0; font-size: 12px; line-height: 18px; color: var(--text-3)')}>Front: {GLOSSARY.Front}</p>}
              </div>
              <button type="button" aria-label="Download ranking as CSV" onClick={exportCsv} style={css('flex: none; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); color: var(--text-2); cursor: pointer')}><Icon name="download" /></button>
            </div>
            <div style={css('display: grid; grid-template-columns: 30px minmax(0, 1fr) 80px 76px; align-items: end; gap: 12px; padding: 8px 20px; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--text-3); border-bottom: 1px solid var(--divider)')}>
              <span style={css('text-align: right')}>#</span><span>Asset</span>
              <span style={css('justify-self: center; text-align: center')}>Assigned Importance <InfoTip term="Assigned Importance" /></span>
              <span style={css('justify-self: end; text-align: right')}>{showValues ? 'Score' : <>Criticality <InfoTip term="Criticality" /></>}</span>
            </div>
            <ol style={css('list-style: none; margin: 0; padding: 4px 8px; max-height: 528px; overflow-y: auto')}>
              {range.map((i, j) => (
                <li key={i}>
                  <button type="button" aria-pressed={i === s} onClick={(e) => select(i, e.shiftKey)} style={css(`width: 100%; height: 44px; display: grid; grid-template-columns: 30px minmax(0, 1fr) 80px 76px; align-items: center; gap: 12px; padding: 0 12px; border: 0; border-radius: 6px; font: inherit; text-align: left; color: var(--text); cursor: pointer; background: ${i === s ? 'var(--row-selected)' : 'transparent'}`)}>
                    <span style={css('text-align: right; font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums')}>{V.kind === 'scalar' ? V.rank[i] : from + j}</span>
                    <span style={css('min-width: 0')}>
                      <span style={css('display: block; font-size: 13px; font-weight: 600; color: var(--text)')}>{labels[i]}</span>
                      <span style={css('display: block; font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap')}>{V.kind === 'pareto' ? `Front ${V.front![i]} · ` : ''}{names[i]}</span>
                    </span>
                    <span style={css('justify-self: center')}><LevelChip lv={result.importance[i]} size={20} /></span>
                    {showValues ? (
                      <span style={css('display: flex; flex-direction: column; align-items: flex-end; gap: 4px')}>
                        <span style={css('font-size: 13px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; white-space: nowrap')}>{scoreText(i)}</span>
                        <span style={css('width: 64px; height: 4px; border-radius: 2px; background: var(--divider); overflow: hidden; display: block')}><span style={{ display: 'block', height: '100%', width: `${Math.round(V.sort_value[i] / sortMax * 100)}%`, borderRadius: 2, background: 'var(--score-bar)' }} /></span>
                      </span>
                    ) : (
                      <span style={css('justify-self: end')}><BandChip band={band[i]} /></span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="sel-h" style={css(`min-width: 0; ${CARD}; padding: 16px 20px 20px; display: flex; flex-direction: column; gap: 16px`)}>
            <div style={css('display: flex; align-items: center; justify-content: space-between; gap: 8px')}>
              <h2 id="sel-h" style={css('margin: 0; font-size: 16px; line-height: 20px; font-weight: 600; color: var(--text-strong)')}>Selected Asset</h2>
              <div style={css('display: flex; align-items: center; gap: 2px')}>
                <button type="button" aria-label="Previous asset in range" onClick={step(-1)} style={css(NAV_BTN)}><Icon name="chevronLeft" size={14} width={2.2} /></button>
                <span style={css('min-width: 86px; text-align: center; font-size: 12px; font-weight: 600; color: var(--text-2); font-variant-numeric: tabular-nums')}>{navPos}</span>
                <button type="button" aria-label="Next asset in range" onClick={step(1)} style={css(NAV_BTN)}><Icon name="chevronRight" size={14} width={2.2} /></button>
              </div>
            </div>
            <div>
              <div style={css('display: flex; align-items: center; gap: 8px')}>
                <span style={css('font-size: 16px; font-weight: 600; color: var(--text-strong)')}>{labels[s]}</span>
                <span style={css('padding: 2px 8px; border-radius: 6px; background: var(--orange-soft-bg); font-size: 12px; font-weight: 600; color: var(--orange-text)')}>{chipText(s)}</span>
              </div>
              <div style={css('margin-top: 2px; font-size: 13px; color: var(--text-3)')}>{names[s]}{labels[s] !== result.ids[s] ? ` · ID ${result.ids[s]}` : ''}</div>
            </div>
            <dl style={css('margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px')}>
              {([['Outgoing Edges', result.out_links[s]], ['Incoming Edges', result.in_links[s]], ['Assigned Importance', `${LV_FULL[result.importance[s]]} (${result.importance[s]})`], [showValues ? `Importance (Centrality) · ${V.kind === 'scalar' ? 'Score' : 'Normalized Tuple'}` : 'Importance (Centrality)', showValues ? scoreText(s) : band[s]]] as const).map(([dt, dd], k) => (
                <div key={dt} style={css('padding: 8px 12px; border-radius: 6px; background: var(--subtle)')}><dt style={css('font-size: 12px; color: var(--text-3)')}>{dt}{k >= 2 && <> <InfoTip term={k === 2 ? 'Assigned Importance' : 'Criticality'} /></>}</dt><dd style={css('margin: 2px 0 0; font-size: 16px; font-weight: 600; color: var(--text-strong); font-variant-numeric: tabular-nums')}>{dd}</dd></div>
              ))}
            </dl>
            <div style={css('padding: 12px 16px; border: 1px solid var(--blast-box-border); border-radius: 6px; background: var(--blast-box-bg); display: flex; flex-direction: column; gap: 8px')}>
              <div style={css('display: flex; align-items: baseline; justify-content: space-between; gap: 8px')}>
                <span style={css('font-size: 13px; font-weight: 600; color: var(--text)')}>Blast Radius ({depth} {depth === 1 ? 'Hop' : 'Hops'}) <InfoTip term="Blast Radius" /></span>
                <span style={css('font-size: 12px; font-weight: 600; color: var(--orange-text)')}>{pct} of Network</span>
              </div>
              {Array.from({ length: depth }, (_, h) => {
                const c = rings[h]?.length ?? 0;
                return (
                  <div key={h} style={css('display: flex; align-items: center; gap: 8px; font-size: 12px')}>
                    <span style={css('width: 52px; color: var(--text-2)')}>{h + 1} {h ? 'Hops' : 'Hop'}</span>
                    <span style={css('flex: 1; height: 8px; border-radius: 4px; background: var(--blast-track); overflow: hidden')}><span style={{ display: 'block', height: '100%', width: `${ringPct(c)}%`, background: h ? 'var(--blast-bar-2)' : 'var(--blast-bar-1)', borderRadius: 4 }} /></span>
                    <span style={css('width: 64px; text-align: right; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums')}>{c} {c === 1 ? 'Asset' : 'Assets'}</span>
                  </div>
                );
              })}
              <div style={css('font-size: 12px; color: var(--text-2)')}>
                <span style={css('font-weight: 600; color: var(--text)')}>{down ? `${down} ${down === 1 ? 'Asset' : 'Assets'} ${Way}` : `No Assets ${Way}`}</span>
                {down > 0 && ` (${hopBreakdown})`} · {result.blast[s].high} with High Assigned Importance
              </div>
            </div>
            <table style={css('width: 100%; border-collapse: separate; border-spacing: 3px; table-layout: fixed; font-size: 12px; color: var(--text)')}>
              <caption style={css('caption-side: top; text-align: left; padding: 0 4px 4px; font-size: 12px; font-weight: 600; color: var(--text-2)')}>All Degree Variants · Score and Rank</caption>
              <colgroup><col style={{ width: '30%' }} /><col /><col /><col /><col /></colgroup>
              <thead>
                <tr>
                  <td />
                  {['1D', '2D'].map((h) => <th key={h} scope="colgroup" colSpan={2} style={css('padding: 2px 0; font-size: 12px; font-weight: 600; color: var(--text-2); text-align: center; border-bottom: 1px solid var(--border)')}>{h}</th>)}
                </tr>
                <tr>
                  <td />
                  {['Unwtd', 'Wtd', 'Unwtd', 'Wtd'].map((h, j) => <th key={j} scope="col" style={css('padding: 2px 0; font-size: 12px; font-weight: 500; color: var(--text-3); text-align: center')}>{h}</th>)}
                </tr>
              </thead>
              <tbody style={css('font-variant-numeric: tabular-nums')}>
                {(['direct', 'blast'] as const).map((sc) => (
                  <tr key={sc}>
                    <th scope="row" style={css('padding: 0 4px 0 0; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--text-2); text-align: left')}>{sc === 'direct' ? 'Asset Importance Rankings' : 'Blast Radius'}</th>
                    {(['1d-u', '1d-w', '2d-u', '2d-w'] as const).map((dw) => {
                      const [d, w] = dw.split('-');
                      const vk = `${d}-${sc}-${w}` as VariantKey;
                      const cell = variantCell(vk);
                      const on = vk === key;
                      return (
                        <td key={vk} title={result.variants[vk].label} style={css(on ? 'padding: 8px 2px; text-align: center; border-radius: 6px; background: var(--cell-on-bg); box-shadow: inset 0 0 0 1.5px var(--cell-on-ring); color: var(--cell-on-text)' : 'padding: 8px 2px; text-align: center; border-radius: 6px; background: var(--subtle); color: var(--text)')}>
                          <div style={css('font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis')}>{cell.v}</div>
                          <div style={css('font-size: 12px; color: var(--text-3)')}>{cell.r}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="dist-h" style={css(`grid-column: 1 / -1; min-width: 0; ${CARD}; padding: 20px 24px 24px; box-sizing: border-box`)}>
            <div style={css('display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px 16px')}>
              <div>
                <h2 id="dist-h" style={css('margin: 0; font-size: 16px; line-height: 20px; font-weight: 600; color: var(--text-strong)')}>Importance Statistics for Network Assets</h2>
                <p style={css('margin: 2px 0 0; font-size: 12px; color: var(--text-3)')}>How many assets are highly, moderately and weakly critical · {vLabel}</p>
              </div>
              <div style={css('display: flex; gap: 16px; font-size: 12px; color: var(--text-2)')}>
                <span style={css('display: flex; align-items: center; gap: 8px')}><span style={css('width: 12px; height: 12px; border-radius: 2px; background: var(--orange)')} />Ranks {from}–{to}</span>
                <span style={css('display: flex; align-items: center; gap: 8px')}><span style={css('width: 12px; height: 12px; border-radius: 2px; background: var(--hist-other)')} />Other Assets</span>
              </div>
            </div>
            <DistributionChart key={V.key} dist={dist} options={chartOpt} onOptions={(o) => setChartOpts({ ...chartOpts, [V.key]: o })}
              criticalLeft={criticalLeft} onCriticalLeft={setCriticalLeft} showNumbers={showValues} variantLabel={vLabel}
              kFrom={from} kTo={to} busy={chartBusy} theme={app.theme} />
            <dl style={css('margin: 20px 0 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 12px')}>
              {([
                [`Ranks ${from}–${to} Share of Total Score`, V.summary.top_share == null ? 'Not defined for 2D' : `${(V.summary.top_share * 100).toFixed(1)}%`],
                !showValues
                  ? ['Criticality in Selection', (['High', 'Medium', 'Low'] as const).filter((b) => range.some((i) => band[i] === b)).join(' to ').replace(/ to .* to /, ' to ')]
                  : [V.kind === 'scalar' ? 'Score Range in Selection' : 'Fronts in Selection', V.kind === 'scalar' ? `${V.summary.range[0].toFixed(3)}–${V.summary.range[1].toFixed(3)}` : `${V.summary.range[0]}–${V.summary.range[1]}`],
                ['Assets with No Edges', String(noLinks)],
              ] as const).map(([dt, dd]) => (
                <div key={dt} style={css('padding: 12px 16px; border-radius: 6px; background: var(--subtle)')}><dt style={css('font-size: 12px; color: var(--text-3)')}>{dt}</dt><dd style={css('margin: 4px 0 0; font-size: 20px; font-weight: 600; color: var(--text-strong); font-variant-numeric: tabular-nums')}>{dd}</dd></div>
              ))}
            </dl>
          </section>
        </div>
      </div>
      <Footer />
    </div>
  );
}

