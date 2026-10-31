// Hidden 16:9 layouts for the deadline snapshots, opened only by scripts/snapshots.mjs at 1920 x 1080:
//   #/snapshot?kind=top10&dim=1d          graph + ranked list + distribution chart
//   #/snapshot?kind=blast&dim=1d&a=ID&b=ID graph with two blast cones + both affected-asset lists
// Same components and analyze() result as the dashboard; weighted, as in demo mode.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dimension, ReadyVariant, RingMember, VariantKey } from '../analysis-types';
import { css } from '../components/css';
import { DistributionChart } from '../components/DistributionChart';
import { GraphCaption, GraphLegend } from '../components/GraphChrome';
import { BandChip, LevelChip, LV_FULL } from '../components/ui';
import { DARK, LIGHT } from '../graph/graph-theme';
import { GraphView } from '../graph/GraphView';
import { useNetworkView, useOrderPositions, useScene } from '../graph/useNetworkView';
import { useApp } from '../state';

const CARD = 'background: var(--surface); border: 1px solid var(--border); border-radius: 6px';
const HEADER_H = 56;

type PairCheck =
  | { ok: true; a: number; b: number }
  | { ok: false; code: 'missing' | 'same' | 'empty' | 'overlap'; text: string; shared?: number; suggestion?: string | null };

type ListItem = { ring: number; count: number } | { m: RingMember };

export function SnapshotPage({ params }: { params: URLSearchParams }) {
  const app = useApp();
  const result = app.result!;
  const ds = app.dataset!;
  const T = app.theme === 'dark' ? DARK : LIGHT;
  const dim: Dimension = params.get('dim') === '2d' ? '2d' : '1d';
  const blast = params.get('kind') === 'blast';

  const key: VariantKey = `${dim}-${blast ? 'blast' : 'direct'}-w`;
  const chosen = result.variants[key];
  const pending = chosen.status === 'pending';
  const V = (pending ? result.variants[chosen.fallback] : chosen) as ReadyVariant;
  const posOf = useOrderPositions(V);
  const net = useNetworkView(result, ds, app.laneByType);
  const { labels, names, geo } = net;
  const sceneData = useScene(net, result, V, posOf);
  const from = V.k_from, to = V.k_to;
  const band = V.distribution.band;
  const range = V.order.slice(from - 1, to);
  const depth = result.options.depth;
  const way = result.options.blast_direction === 'against' ? 'upstream' : 'downstream';
  const showValues = app.showValues;

  const scoreText = (i: number) => V.kind === 'scalar' ? V.score![i].toFixed(3) : `${V.normalized![i][0].toFixed(2)}, ${V.normalized![i][1].toFixed(2)}`;
  const rankText = (i: number) => V.kind === 'scalar' ? `Rank ${V.rank[i]}` : `Front ${V.front![i]}`;
  const reachCount = (x: number) => result.blast[x].rings.reduce((t, r) => t + r.length, 0);

  // The pair must be two different assets with completely separate blast radii (same rule as the dashboard).
  const check = useMemo<PairCheck | null>(() => {
    if (!blast) return null;
    const find = (q: string | null) => {
      if (!q) return -1;
      const i = result.ids.indexOf(q);
      return i >= 0 ? i : labels.indexOf(q);
    };
    const a = find(params.get('a')), b = find(params.get('b'));
    if (a < 0 || b < 0) return { ok: false, code: 'missing', text: `The ${a < 0 ? 'first' : 'second'} asset is not in this network.` };
    if (a === b) return { ok: false, code: 'same', text: 'Pick two different assets.' };
    const reach = (x: number) => new Set([x, ...result.blast[x].rings.flat().map((m) => m[0])]);
    for (const x of [a, b]) {
      if (!result.blast[x].rings.length) return { ok: false, code: 'empty', text: `${labels[x]} has no ${way} assets within ${depth} hops.` };
    }
    const ra = reach(a);
    let shared = 0;
    reach(b).forEach((k) => { if (ra.has(k)) shared++; });
    if (!shared) return { ok: true, a, b };
    const s = V.order.find((k) => {
      if (k === a || !result.blast[k].rings.length) return false;
      for (const x of reach(k)) if (ra.has(x)) return false;
      return true;
    });
    return {
      ok: false, code: 'overlap', shared, suggestion: s == null ? null : result.ids[s],
      text: `${labels[b]} shares ${shared} affected ${shared === 1 ? 'asset' : 'assets'} with ${labels[a]}.`,
    };
  }, [blast, params, result, labels, V, way, depth]);
  const pair = check?.ok ? [check.a, check.b] : [];

  // Lists that don't fit are cut at the last whole row, with a "+N more" line; measured once after layout.
  const listRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const [cut, setCut] = useState<(number | null)[]>([null, null]);
  const [measured, setMeasured] = useState(false);
  useLayoutEffect(() => {
    setCut(listRefs.map((r) => {
      const el = r.current;
      if (!el || el.scrollHeight <= el.clientHeight) return null;
      const rows = [...el.children] as HTMLElement[];
      const k = rows.findIndex((row) => row.offsetTop + row.offsetHeight > el.clientHeight - 28);
      return k < 0 ? null : k;
    }));
    setMeasured(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const items = (x: number): ListItem[] => result.blast[x].rings.flatMap((ring, h) => [{ ring: h, count: ring.length }, ...ring.map((m) => ({ m }))]);
  const hidden = pair.map((x, j) => cut[j] == null ? 0 : items(x).slice(cut[j]!).filter((it) => 'm' in it).length);

  const metricTitle = chosen.label;
  const pendingNote = pending ? ' · 2D blast-radius score pending supervisor; ranks are 2D direct' : '';
  const caption = blast
    ? (check?.ok ? `Blast radii of ${labels[check.a]} and ${labels[check.b]} · ${depth} ${depth === 1 ? 'hop' : 'hops'} ${way}${pendingNote}` : 'Blast radius')
    : `Ranks ${from}–${to} highlighted`;

  if (check && !check.ok) {
    return (
      <div data-snap-ready="1" data-snap-error={check.code} data-snap-shared={check.shared ?? ''} data-snap-suggestion={check.suggestion ?? ''}
        style={css('min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--page); color: var(--text); font-size: 14px')}>
        {check.text}
      </div>
    );
  }

  const header = (
    <div style={css(`flex: none; height: ${HEADER_H}px; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; gap: 24px; background: var(--surface); border-bottom: 1px solid var(--border)`)}>
      <div style={css('min-width: 0; display: flex; align-items: baseline; gap: 16px')}>
        <span style={css('font-size: 20px; font-weight: 600; color: var(--text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis')}>{app.analysisName || 'Untitled analysis'}</span>
        <span style={css('font-size: 13px; color: var(--text-3); white-space: nowrap')}>Degree centrality · {result.n} assets · {result.m} directed links</span>
      </div>
      <span style={css('font-size: 13px; font-weight: 600; color: var(--text-3)')}>CARMA</span>
    </div>
  );

  // Key statistics: which ones is still to be confirmed by the supervisor (CLAUDE.md), so only the space is kept.
  const statsSpace = (
    <div data-snap-placeholder="stats" style={css('flex: none; height: 64px; display: flex; align-items: center; justify-content: center; border: 1px dashed var(--border); border-radius: 6px; font-size: 12px; color: var(--text-3)')}>
      Key statistics · to be confirmed with the supervisor
    </div>
  );

  const rankedList = (
    <section aria-label="Highlighted assets" style={css(`flex: none; ${CARD}; overflow: hidden`)}>
      <div style={css('padding: 16px 20px; border-bottom: 1px solid var(--divider)')}>
        <h2 style={css('margin: 0; font-size: 16px; line-height: 20px; font-weight: 600; color: var(--text-strong)')}>Highlighted assets</h2>
        <p style={css('margin: 2px 0 0; font-size: 12px; color: var(--text-3)')}>Ranks {from}–{to} by {metricTitle}</p>
      </div>
      <div aria-hidden="true" style={css('display: grid; grid-template-columns: 30px minmax(0, 1fr) 64px 76px; gap: 12px; padding: 8px 20px; font-size: 12px; font-weight: 600; color: var(--text-3); border-bottom: 1px solid var(--divider)')}>
        <span style={css('text-align: right')}>#</span><span>Asset</span><span style={css('text-align: center')}>Importance</span><span style={css('text-align: right')}>{showValues ? 'Score' : 'Centrality'}</span>
      </div>
      <ol style={css('list-style: none; margin: 0; padding: 4px 8px')}>
        {range.map((i, j) => (
          <li key={i} style={css('height: 40px; display: grid; grid-template-columns: 30px minmax(0, 1fr) 64px 76px; align-items: center; gap: 12px; padding: 0 12px')}>
            <span style={css('text-align: right; font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums')}>{V.kind === 'scalar' ? V.rank[i] : from + j}</span>
            <span style={css('min-width: 0')}>
              <span style={css('display: block; font-size: 13px; font-weight: 600; color: var(--text)')}>{labels[i]}</span>
              <span style={css('display: block; font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap')}>{V.kind === 'pareto' ? `Front ${V.front![i]} · ` : ''}{names[i]}</span>
            </span>
            <span style={css('justify-self: center')}><LevelChip lv={result.importance[i]} /></span>
            <span style={css('justify-self: end; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap')}>{showValues ? scoreText(i) : <BandChip band={band[i]} />}</span>
          </li>
        ))}
      </ol>
    </section>
  );

  const chart = (
    <section aria-label="Distribution" style={css(`flex: none; ${CARD}; padding: 16px 20px 12px`)}>
      <div style={css('display: flex; align-items: baseline; justify-content: space-between; gap: 16px')}>
        <h2 style={css('margin: 0; font-size: 16px; line-height: 20px; font-weight: 600; color: var(--text-strong)')}>{V.distribution.axis === 'score' ? 'Score distribution' : 'Pareto front distribution'}</h2>
        <div style={css('display: flex; gap: 16px; font-size: 12px; color: var(--text-2)')}>
          <span style={css('display: flex; align-items: center; gap: 8px')}><span style={css('width: 12px; height: 12px; border-radius: 2px; background: var(--orange)')} />Ranks {from}–{to}</span>
          <span style={css('display: flex; align-items: center; gap: 8px')}><span style={css('width: 12px; height: 12px; border-radius: 2px; background: var(--hist-other)')} />Other assets</span>
        </div>
      </div>
      <DistributionChart bare dist={V.distribution} options={{}} onOptions={() => {}} criticalLeft onCriticalLeft={() => {}}
        showNumbers={showValues} variantLabel={V.label} kFrom={from} kTo={to} busy={false} theme={app.theme} />
    </section>
  );

  const blastList = (x: number, j: number) => {
    const all = items(x), shown = cut[j] == null ? all : all.slice(0, cut[j]!), total = reachCount(x);
    return (
      <section key={x} aria-label={`Blast radius of ${labels[x]}`} style={css(`flex: 1 1 0; min-width: 0; min-height: 0; ${CARD}; display: flex; flex-direction: column; overflow: hidden`)}>
        <div style={css('flex: none; padding: 16px 16px 12px; border-bottom: 1px solid var(--divider)')}>
          <div style={css('display: flex; align-items: center; gap: 8px')}>
            <span style={css('font-size: 16px; font-weight: 600; color: var(--text-strong)')}>{labels[x]}</span>
            <span style={css('padding: 2px 8px; border-radius: 6px; background: var(--orange-soft-bg); font-size: 12px; font-weight: 600; color: var(--orange-text)')}>{rankText(x)}</span>
          </div>
          <div style={css('margin-top: 2px; font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap')}>{names[x]}</div>
          <div style={css('margin-top: 8px; font-size: 13px; font-weight: 600; color: var(--text)')}>{total} affected {total === 1 ? 'asset' : 'assets'} · {Math.round(total / (result.n - 1) * 100)}% of network</div>
        </div>
        <div ref={listRefs[j]} data-snap-list={j} data-snap-hidden={hidden[j]} style={css('position: relative; flex: 1; min-height: 0; overflow: hidden; padding: 0 8px')}>
          {shown.map((it) => 'm' in it ? (
            <div key={`a${it.m[0]}`} style={css('height: 32px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 0 8px')}>
              <span style={css('min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px')}>
                <span style={css('font-weight: 600; color: var(--text)')}>{labels[it.m[0]]}</span>
                <span style={css('color: var(--text-3)')}> · {names[it.m[0]]}</span>
              </span>
              {showValues
                ? <span style={css('font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums')}>{scoreText(it.m[0])}</span>
                : <BandChip band={band[it.m[0]]} size="sm" />}
            </div>
          ) : (
            <div key={`r${it.ring}`} style={css('height: 32px; display: flex; align-items: flex-end; padding: 0 8px 4px; box-sizing: border-box; font-size: 12px; font-weight: 600; color: var(--text-2)')}>
              Ring {it.ring + 1} · {it.ring + 1} {it.ring ? 'hops' : 'hop'}<span style={css('font-weight: 500; color: var(--text-3)')}>&nbsp;· {it.count} {it.count === 1 ? 'asset' : 'assets'}</span>
            </div>
          ))}
        </div>
        {hidden[j] > 0 && (
          <div style={css('flex: none; padding: 8px 16px; border-top: 1px solid var(--divider); font-size: 12px; color: var(--text-3)')}>
            +{hidden[j]} more not shown · full list in the dashboard's CSV
          </div>
        )}
      </section>
    );
  };

  return (
    <div data-snap-ready={measured ? '1' : undefined} style={css('width: 100vw; height: 100vh; overflow: hidden; display: flex; flex-direction: column; background: var(--page); color: var(--text)')}>
      {header}
      <div style={css('flex: 1; min-height: 0; display: flex')}>
        <div style={css(`flex: none; width: calc((100vh - ${HEADER_H}px) * 1400 / 1200); border-right: 1px solid var(--border)`)}>
          <GraphView
            data={sceneData} fitZ={geo.fitZ} startZoom={geo.fitZ} theme={T} sel={blast ? pair[0] : V.order[0]} from={from} to={to} weighted showLevels
            sizeByScore gatherCone blastTargets={pair} frameKey={pair.join('-')} view="3d" labelStyle="inside"
            ariaLabel={(i) => `${labels[i]}, ${names[i]}, ${rankText(i).toLowerCase()}`}
            tip={(i) => ({ title: `${labels[i]} · ${names[i]}`, line: `${rankText(i)} · Importance ${LV_FULL[result.importance[i]]}` })}
            onSelect={() => {}}
            overlay={() => (
              <>
                <GraphCaption big title={metricTitle} sub={caption} />
                <GraphLegend T={T} from={from} to={to} levels blast={blast} />
              </>
            )}
          />
        </div>
        <div style={css('flex: 1; min-width: 0; padding: 24px; box-sizing: border-box; display: flex; flex-direction: column; gap: 16px')}>
          {blast ? (
            <div style={css('flex: 1; min-height: 0; display: flex; gap: 16px')}>{pair.map((x, j) => blastList(x, j))}</div>
          ) : (
            <>
              {rankedList}
              {chart}
              <div style={css('flex: 1')} />
            </>
          )}
          {statsSpace}
        </div>
      </div>
    </div>
  );
}
