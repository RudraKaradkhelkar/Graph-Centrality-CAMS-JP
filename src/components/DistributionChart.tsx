// Distribution chart: how many assets are highly, moderately and weakly central.
// It only draws. Every bar, zone count, tick and exclusion count comes from distribution() in carma_metrics.py.
// Zone cut-offs are calculated (equal thirds of the assets shown), never set by hand.
import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Band, ChartOptions, DistBar, Distribution, ExclusionRule } from '../analysis-types';
import { css } from './css';
import { Icon, Segmented } from './ui';

interface Props {
  dist: Distribution;
  options: ChartOptions;
  onOptions(o: ChartOptions): void;
  criticalLeft: boolean;
  onCriticalLeft(v: boolean): void;
  /** Numeric ticks follow the dashboard's Show values toggle. */
  showNumbers: boolean;
  variantLabel: string;
  kFrom: number;
  kTo: number;
  busy: boolean;
  /** Re-reads colours when the theme changes. */
  theme: string;
  /** Chart only, no controls (snapshots). */
  bare?: boolean;
}

const VB_W = 1000, VB_H = 360, PL = 70, PR = 20, PT = 22, PB = 268;
const FONT = "'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif";
const BANDS: Band[] = ['Low', 'Medium', 'High'];
const SMALL_BTN = 'height: 32px; padding: 0 12px; display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 12px; font-weight: 600; color: var(--text); cursor: pointer';
const INPUT = 'height: 32px; width: 76px; padding: 0 8px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 12px; color: var(--text); font-variant-numeric: tabular-nums; box-sizing: border-box';

/** Theme colours as literal values, so an exported SVG/PNG keeps them. */
function readColours() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    bg: v('--surface'), text: v('--text'), text2: v('--text-2'), text3: v('--text-3'), axis: v('--hist-axis'), grid: v('--divider'),
    other: v('--hist-other'), top: v('--orange'), handle: v('--text-2'), select: v('--info-icon'),
    zone: { High: v('--band-high-bg'), Medium: v('--band-medium-bg'), Low: v('--band-low-bg') } as Record<Band, string>,
    zoneText: { High: v('--band-high'), Medium: v('--band-medium'), Low: v('--band-low') } as Record<Band, string>,
  };
}

const fmt = (v: number) => (v === 0 ? '0' : Math.abs(v) < 0.001 ? v.toExponential(1) : String(+v.toFixed(4)));

function countTicks(max: number): number[] {
  const m = Math.max(1, max);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => m / s <= 5) ?? Math.ceil(m / 5);
  const out: number[] = [];
  for (let t = 0; t <= m + step - 1 && out.length < 8; t += step) out.push(t);
  return out;
}

function ruleText(e: ExclusionRule & { count: number }, isScore: boolean): string {
  const n = `${e.count} ${e.count === 1 ? 'asset' : 'assets'}`;
  switch (e.rule) {
    case 'zero': return `${n} with score 0`;
    case 'below': return `${n} below ${fmt(e.value)}`;
    case 'above': return `${n} above ${fmt(e.value)}`;
    case 'range': return `${n} in ${fmt(e.lo)}–${fmt(e.hi)}`;
    case 'front': return `${n} on front ${e.value}`;
    default: return isScore ? n : n;
  }
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function DistributionChart(p: Props) {
  const { dist, options } = p;
  const C = useMemo(readColours, [p.theme]); // eslint-disable-line react-hooks/exhaustive-deps
  const isScore = dist.axis === 'score';
  const log = isScore && dist.scale === 'log';
  const svgRef = useRef<SVGSVGElement>(null);
  const [xTitle, setXTitle] = useState<string | null>(null);
  const [yTitle, setYTitle] = useState<string | null>(null);
  const [zoomSel, setZoomSel] = useState<{ x0: number; x1: number } | null>(null);
  const [pick, setPick] = useState<{ x: number; y: number; bar: DistBar; kind: 'zero' | 'bar'; last: boolean } | null>(null);
  const [ruleKind, setRuleKind] = useState<'' | 'zero' | 'below' | 'above'>('');
  const [ruleValue, setRuleValue] = useState('');

  const defaultX = isScore ? `Degree centrality score, ${p.variantLabel}` : `Pareto front (1 = most critical), ${p.variantLabel}`;
  const X_TITLE = xTitle ?? defaultX, Y_TITLE = yTitle ?? 'Number of assets';

  // ---- Horizontal layout: main bars, plus the zero bar at the low-score end. --------------------------
  const zero = isScore && dist.zero_bar && !dist.zero_bar.excluded ? dist.zero_bar : null;
  const ZW = zero ? 36 : 0, GAP = zero ? 16 : 0;
  const zeroAtRight = !!zero && p.criticalLeft; // most critical left means low scores (and 0) on the right
  const mainL = PL + (zero && !zeroAtRight ? ZW + GAP : 0), mainR = VB_W - PR - (zeroAtRight ? ZW + GAP : 0), mainW = mainR - mainL;
  const zeroX = zeroAtRight ? VB_W - PR - ZW : PL;
  const dom = dist.domain;
  const tx = (v: number) => (log ? Math.log10(Math.max(v, 1e-300)) : v);
  const [ta, tb] = dom ? [tx(dom[0]), tx(dom[1])] : [0, 1];
  const fLo = dom ? dom[0] : 1, slots = dom ? dom[1] - dom[0] + 1 : 1, sw = mainW / slots;
  // Value -> x. Scores: continuous; fronts: slot centres (cuts may fall between fronts, e.g. 3.5).
  const xOf = (v: number): number => {
    if (isScore) {
      const t = tb > ta ? (tx(v) - ta) / (tb - ta) : 0.5;
      return p.criticalLeft ? mainR - t * mainW : mainL + t * mainW;
    }
    const off = (v - fLo + 0.5) * sw;
    return p.criticalLeft ? mainL + off : mainR - off;
  };
  const vOf = (x: number): number => {
    if (isScore) {
      const t = p.criticalLeft ? (mainR - x) / mainW : (x - mainL) / mainW;
      const tv = ta + t * (tb - ta);
      return log ? 10 ** tv : tv;
    }
    const off = p.criticalLeft ? x - mainL : mainR - x;
    return off / sw + fLo - 0.5;
  };
  const clampX = (x: number) => Math.max(mainL, Math.min(mainR, x));

  // ---- Vertical scale ---------------------------------------------------------------------------------
  const yTicks = countTicks(dist.y_max);
  const yTop = yTicks[yTicks.length - 1] || 1;
  const yOf = (c: number) => PB - (c / yTop) * (PB - PT);

  // ---- Zones (shaded behind the bars): thirds of the assets shown, so they re-split as you magnify -----
  const [c1, c2] = [Math.min(...dist.zone_cuts), Math.max(...dist.zone_cuts)];
  const lowEnd = isScore ? (dom ? dom[0] : 0) : fLo - 0.5;
  const highEnd = isScore ? (dom ? dom[1] : 1) : (dom ? dom[1] : 1) + 0.5;
  const clampV = (v: number) => Math.max(lowEnd, Math.min(highEnd, v));
  // Value ranges per band (fronts: lower is better).
  const zoneRange: Record<Band, [number, number]> = isScore
    ? { Low: [lowEnd, clampV(c1)], Medium: [clampV(c1), clampV(c2)], High: [clampV(c2), highEnd] }
    : { High: [lowEnd, clampV(c1)], Medium: [clampV(c1), clampV(c2)], Low: [clampV(c2), highEnd] };
  const zoneX = (b: Band): [number, number] | null => {
    const [lo, hi] = zoneRange[b];
    if (!(hi > lo) || !dom) return null;
    const xa = xOf(lo), xb = xOf(hi);
    return [Math.min(xa, xb), Math.max(xa, xb)];
  };
  const zeroBand: Band = 0 >= c2 ? 'High' : 0 >= c1 ? 'Medium' : 'Low';

  // ---- Interaction ------------------------------------------------------------------------------------
  const svgPoint = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * VB_W, y: (e.clientY - r.top) / r.height * VB_H };
  };
  const set = (patch: Partial<ChartOptions>) => p.onOptions({ ...options, ...patch });
  const startZoom = (e: RPointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const x = clampX(svgPoint(e).x);
    setZoomSel({ x0: x, x1: x });
    setPick(null);
  };
  const moveZoom = (e: RPointerEvent) => { if (zoomSel) setZoomSel({ ...zoomSel, x1: clampX(svgPoint(e).x) }); };
  const endZoom = () => {
    if (!zoomSel) return;
    const { x0, x1 } = zoomSel;
    setZoomSel(null);
    if (Math.abs(x1 - x0) < 8 || !dom) return;
    let a = vOf(Math.min(x0, x1)), b = vOf(Math.max(x0, x1));
    if (a > b) [a, b] = [b, a];
    set({ zoom: isScore ? [a, b] : [Math.max(fLo, Math.round(a)), Math.round(b)] });
  };
  const exclude = (rule: ExclusionRule) => { set({ exclude: [...(options.exclude ?? []), rule] }); setPick(null); };
  const removeRule = (k: number) => set({ exclude: (options.exclude ?? []).filter((_, j) => j !== k) });

  const serialize = () => new XMLSerializer().serializeToString(svgRef.current!);
  const exportSvg = () => download(new Blob([serialize()], { type: 'image/svg+xml' }), 'carma-distribution.svg');
  const exportPng = () => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = VB_W * 2; canvas.height = VB_H * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => b && download(b, 'carma-distribution.png'), 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serialize());
  };

  // ---- Bars -------------------------------------------------------------------------------------------
  const barRects = dist.bars.map((b, k) => {
    const [xa, xb] = isScore ? [xOf(b.lo), xOf(b.hi)] : [xOf(b.lo) - sw / 2, xOf(b.lo) + sw / 2];
    const x = Math.min(xa, xb) + 1.5, w = Math.max(1, Math.abs(xb - xa) - 3);
    return { b, k, x, w, last: k === dist.bars.length - 1 };
  });
  const barTitle = (b: DistBar, kind: 'zero' | 'bar') => {
    const where = kind === 'zero' ? 'Score 0' : isScore ? `${fmt(b.lo)}–${fmt(b.hi)}` : `Front ${b.lo}`;
    return `${where}: ${b.count} ${b.count === 1 ? 'asset' : 'assets'}${b.top_count ? ` (${b.top_count} in ranks ${p.kFrom}–${p.kTo})` : ''}`;
  };
  const stack = (x: number, w: number, b: DistBar) => {
    const total = yOf(b.count), topH = b.count ? (PB - total) * b.top_count / b.count : 0;
    return (
      <>
        <rect x={x} y={total + topH} width={w} height={PB - total - topH} fill={C.other} />
        {b.top_count > 0 && <rect x={x} y={total} width={w} height={topH} fill={C.top} />}
      </>
    );
  };

  const hasRules = (options.exclude ?? []).length > 0 || !!options.zoom;
  const isDefault = !hasRules && !options.bins && (options.scale ?? 'linear') === 'linear';

  return (
    <div>
      {!p.bare && <div style={css('display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 16px')}>
        <span style={css('display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2)')}>Most critical
          <Segmented label="Most critical side" value={p.criticalLeft ? 'left' : 'right'} onChange={(v) => p.onCriticalLeft(v === 'left')}
            options={[{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }]} />
        </span>
        {isScore && (
          <span style={css('display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2)')}>Scale
            <Segmented label="Scale" value={dist.scale} onChange={(v) => set({ scale: v })} options={[{ id: 'linear', label: 'Linear' }, { id: 'log', label: 'Log' }]} />
            {dist.suggest_log && dist.scale === 'linear' && <span style={css('font-size: 12px; color: var(--info-icon)')}>Log suggested: scores span 2+ orders of magnitude</span>}
          </span>
        )}
        {isScore && (
          <span role="group" aria-label="Number of bins" style={css('display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2)')}>Bins
            <button type="button" aria-label="Fewer bins" disabled={dist.bars.length <= 3} onClick={() => set({ bins: Math.max(3, dist.bars.length - 1) })} style={css(SMALL_BTN + '; width: 32px; padding: 0; justify-content: center')}>−</button>
            <span style={css('min-width: 24px; text-align: center; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums')}>{dist.bars.length}</span>
            <button type="button" aria-label="More bins" disabled={dist.bars.length >= 60} onClick={() => set({ bins: Math.min(60, dist.bars.length + 1) })} style={css(SMALL_BTN + '; width: 32px; padding: 0; justify-content: center')}>+</button>
          </span>
        )}
        {isScore && (
          <span style={css('display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-2)')}>
            <select aria-label="Exclude assets by rule" value={ruleKind} onChange={(e) => {
              const k = e.target.value as typeof ruleKind;
              if (k === 'zero') { exclude({ rule: 'zero' }); setRuleKind(''); } else setRuleKind(k);
            }} style={css(INPUT + '; width: auto; padding: 0 8px')}>
              <option value="">Exclude…</option>
              <option value="zero">Score 0</option>
              <option value="below">Below a value</option>
              <option value="above">Above a value</option>
            </select>
            {(ruleKind === 'below' || ruleKind === 'above') && (
              <>
                <input aria-label="Value" type="number" step="any" value={ruleValue} onChange={(e) => setRuleValue(e.target.value)} style={css(INPUT)} />
                <button type="button" disabled={!Number.isFinite(Number(ruleValue)) || ruleValue === ''} onClick={() => { exclude({ rule: ruleKind, value: Number(ruleValue) }); setRuleKind(''); setRuleValue(''); }} style={css(SMALL_BTN)}>Exclude</button>
              </>
            )}
          </span>
        )}
        <span style={css('margin-left: auto; display: inline-flex; gap: 8px')}>
          <button type="button" disabled={isDefault} onClick={() => p.onOptions({})} style={css(SMALL_BTN)}><Icon name="reset" size={14} />Reset chart</button>
          <button type="button" onClick={exportPng} style={css(SMALL_BTN)}><Icon name="download" size={14} />PNG</button>
          <button type="button" onClick={exportSvg} style={css(SMALL_BTN)}><Icon name="download" size={14} />SVG</button>
        </span>
      </div>}

      {(hasRules || dist.hidden > 0) && (
        <div style={css('margin-top: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px')}>
          {dist.excluded.map((e, k) => (
            <span key={k} style={css('display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 4px 0 12px; border-radius: 6px; background: var(--subtle); border: 1px solid var(--border); font-size: 12px; color: var(--text)')}>
              Excluded: {ruleText(e, isScore)}
              <button type="button" aria-label={`Remove exclusion: ${ruleText(e, isScore)}`} onClick={() => removeRule(k)} style={css('width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; background: transparent; color: var(--text-3); cursor: pointer')}><Icon name="close" size={12} width={2.2} /></button>
            </span>
          ))}
          {options.zoom && (
            <span style={css('display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 4px 0 12px; border-radius: 6px; background: var(--blue-soft-bg); font-size: 12px; color: var(--blue-soft-text)')}>
              Zoomed to {isScore ? `${fmt(options.zoom[0])}–${fmt(options.zoom[1])}` : `fronts ${options.zoom[0]}–${options.zoom[1]}`} · {dist.outside_zoom} outside
              <button type="button" aria-label="Reset zoom" onClick={() => set({ zoom: null })} style={css('width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer')}><Icon name="close" size={12} width={2.2} /></button>
            </span>
          )}
          <span style={css('font-size: 12px; color: var(--text-3)')}>Showing {dist.shown} of {dist.total} assets. Chart zones re-split the assets shown; bands in the lists stay on the full range.</span>
        </div>
      )}

      <div style={css('position: relative; margin-top: 12px')}>
        {p.busy && <span style={css('position: absolute; right: 8px; top: 4px; font-size: 12px; color: var(--text-3)')}>Updating…</span>}
        <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${VB_W} ${VB_H}`} width={VB_W} height={VB_H} fontFamily={FONT}
          role="img" aria-label={`${X_TITLE}: ${dist.zones.map((z) => `${z.band} ${z.count}`).join(', ')}`}
          style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none' }}
          onPointerMove={moveZoom} onPointerUp={endZoom}>
          <rect x={0} y={0} width={VB_W} height={VB_H} fill={C.bg} />
          {/* Zones */}
          {BANDS.map((b) => { const z = zoneX(b); return z && <rect key={b} x={z[0]} y={PT} width={z[1] - z[0]} height={PB - PT} fill={C.zone[b]} opacity={0.7} />; })}
          {zero && <rect x={zeroX - 4} y={PT} width={ZW + 8} height={PB - PT} fill={C.zone[zeroBand]} opacity={0.7} />}
          {/* Grid and y axis */}
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PL} x2={VB_W - PR} y1={yOf(t)} y2={yOf(t)} stroke={C.grid} strokeWidth={1} />
              <text x={PL - 8} y={yOf(t) + 4} textAnchor="end" fontSize={12} fill={C.text3}>{t}</text>
            </g>
          ))}
          <text x={16} y={(PT + PB) / 2} textAnchor="middle" fontSize={12} fontWeight={600} fill={C.text2} transform={`rotate(-90 16 ${(PT + PB) / 2})`}>{Y_TITLE}</text>
          {/* Bars */}
          {barRects.map(({ b, k, x, w, last }) => (
            <g key={k} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); if (b.count) setPick({ x: x + w / 2, y: yOf(b.count), bar: b, kind: 'bar', last }); }}>
              <title>{barTitle(b, 'bar')}</title>
              <rect x={x} y={PT} width={w} height={PB - PT} fill="transparent" />
              {b.excluded
                ? <rect x={x} y={PB - 24} width={w} height={24} fill="none" stroke={C.axis} strokeDasharray="3 3" />
                : stack(x, w, b)}
            </g>
          ))}
          {zero && (
            <g style={{ cursor: 'pointer' }} onClick={() => zero.count && setPick({ x: zeroX + ZW / 2, y: yOf(zero.count), bar: zero, kind: 'zero', last: false })}>
              <title>{barTitle(zero, 'zero')}</title>
              <rect x={zeroX} y={PT} width={ZW} height={PB - PT} fill="transparent" />
              {stack(zeroX + 2, ZW - 4, zero)}
              <line x1={zeroAtRight ? zeroX - GAP / 2 : zeroX + ZW + GAP / 2} x2={zeroAtRight ? zeroX - GAP / 2 : zeroX + ZW + GAP / 2} y1={PT} y2={PB} stroke={C.axis} strokeDasharray="2 4" />
            </g>
          )}
          {[c1, c2].map((v, k) => dom && v > lowEnd && v < highEnd && (
            <line key={k} x1={xOf(v)} x2={xOf(v)} y1={PT} y2={PB} stroke={C.axis} strokeWidth={1} strokeDasharray="4 4" pointerEvents="none" />
          ))}
          <line x1={PL} x2={VB_W - PR} y1={PB} y2={PB} stroke={C.axis} strokeWidth={1} />
          {/* Axis band: zone row, numeric row; drag across it to zoom */}
          <rect x={PL} y={PB} width={VB_W - PL - PR} height={56} fill="transparent" style={{ cursor: 'col-resize' }}
            onPointerDown={startZoom}><title>Drag across to zoom into a range</title></rect>
          {BANDS.map((b) => {
            const z = zoneX(b), zone = dist.zones.find((q) => q.band === b)!;
            if (!z) return null;
            const mid = (z[0] + z[1]) / 2, wide = z[1] - z[0] > 70;
            return (
              <text key={b} x={mid} y={PB + 20} textAnchor="middle" fontSize={12} fontWeight={600} fill={C.zoneText[b]} pointerEvents="none">
                {wide ? `${b} · ${zone.count}` : b[0]}
              </text>
            );
          })}
          {zero && <text x={zeroX + ZW / 2} y={PB + 20} textAnchor="middle" fontSize={12} fill={C.text3} pointerEvents="none">score 0</text>}
          {p.showNumbers && (
            <g pointerEvents="none">
              {/* With the zero bar shown, its own "0" label replaces a 0 tick on the main axis. */}
              {dist.ticks.filter((t) => !(zero && t === 0)).map((t) => <text key={t} x={xOf(t)} y={PB + 42} textAnchor="middle" fontSize={12} fill={C.text3}>{fmt(t)}</text>)}
              {zero && <text x={zeroX + ZW / 2} y={PB + 42} textAnchor="middle" fontSize={12} fontWeight={600} fill={C.text2}>0</text>}
            </g>
          )}
          {zoomSel && <rect x={Math.min(zoomSel.x0, zoomSel.x1)} y={PT} width={Math.abs(zoomSel.x1 - zoomSel.x0)} height={PB - PT + 56} fill={C.select} opacity={0.12} pointerEvents="none" />}
          <text x={(PL + VB_W - PR) / 2} y={VB_H - 10} textAnchor="middle" fontSize={12} fontWeight={600} fill={C.text2}>{X_TITLE}</text>
        </svg>
        {pick && (
          <div role="dialog" aria-label="Bar actions" style={{ position: 'absolute', left: `${pick.x / VB_W * 100}%`, top: `${pick.y / VB_H * 100}%`, transform: 'translate(-50%, calc(-100% - 8px))', zIndex: 2 }}>
            <div style={css('padding: 8px 12px; background: var(--popover-bg); border: 1px solid var(--popover-border); border-radius: 6px; box-shadow: var(--popover-shadow); white-space: nowrap; display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--text)')}>
              {barTitle(pick.bar, pick.kind)}
              <button type="button" style={css(SMALL_BTN + '; height: 24px')} onClick={() => exclude(
                pick.kind === 'zero' ? { rule: 'zero' }
                  : isScore ? { rule: 'range', lo: pick.bar.lo, hi: pick.bar.hi, closed: pick.last } : { rule: 'front', value: pick.bar.lo },
              )}>Exclude</button>
              <button type="button" aria-label="Close" onClick={() => setPick(null)} style={css('border: 0; background: transparent; color: var(--text-3); cursor: pointer')}><Icon name="close" size={12} width={2.2} /></button>
            </div>
          </div>
        )}
      </div>

      {!p.bare && <details style={css('margin-top: 8px; font-size: 12px; color: var(--text-2)')}>
        <summary style={css('cursor: pointer')}>Axis titles</summary>
        <div style={css('margin-top: 8px; display: flex; flex-wrap: wrap; gap: 12px')}>
          <label style={css('display: flex; align-items: center; gap: 8px')}>X <input value={X_TITLE} onChange={(e) => setXTitle(e.target.value)} style={css(INPUT + '; width: 360px')} /></label>
          <label style={css('display: flex; align-items: center; gap: 8px')}>Y <input value={Y_TITLE} onChange={(e) => setYTitle(e.target.value)} style={css(INPUT + '; width: 200px')} /></label>
          {(xTitle != null || yTitle != null) && <button type="button" onClick={() => { setXTitle(null); setYTitle(null); }} style={css(SMALL_BTN)}>Default titles</button>}
        </div>
      </details>}
    </div>
  );
}
