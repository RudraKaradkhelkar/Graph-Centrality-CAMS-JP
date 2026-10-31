// Compare 1D vs 2D: the same network ranked both ways, side by side. Both graphs share one camera and one
// selection; selecting an asset shows its blast radius on both sides. Every rank comes from analyze().
import { useEffect, useMemo, useState } from 'react';
import type { ReadyVariant } from '../analysis-types';
import { navigate } from '../App';
import { css } from '../components/css';
import { ExitPresent, GraphButtons, GraphCaption, GraphLegend, PresentButton } from '../components/GraphChrome';
import { BandChip, Icon, LV, LV_FULL, ThemeButton } from '../components/ui';
import { DARK, LIGHT } from '../graph/graph-theme';
import { CameraLink, GraphView } from '../graph/GraphView';
import { DEFAULT_PITCH, DEFAULT_YAW } from '../graph/layout';
import { useNetworkView, useOrderPositions, useScene } from '../graph/useNetworkView';
import { useApp } from '../state';

const CARD = 'background: var(--surface); border: 1px solid var(--border); border-radius: 6px; box-shadow: var(--card-shadow)';
const BTN = 'height: 36px; padding: 0 16px; display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 14px; font-weight: 600; color: var(--text); cursor: pointer';
const TH = 'position: sticky; top: 0; z-index: 1; padding: 8px 12px; background: var(--table-head); border-bottom: 1px solid var(--border); font-size: 12px; font-weight: 600; color: var(--text-2)';
const TD = 'padding: 8px 12px; border-bottom: 1px solid var(--divider); font-size: 13px';

export function ComparePage() {
  const app = useApp();
  const result = app.result!;
  const ds = app.dataset!;
  const T = app.theme === 'dark' ? DARK : LIGHT;
  const V1 = result.variants['1d-direct-w'] as ReadyVariant;
  const V2 = result.variants['2d-direct-w'] as ReadyVariant;
  const net = useNetworkView(result, ds, app.laneByType);
  const pos1 = useOrderPositions(V1), pos2 = useOrderPositions(V2);
  const scene1 = useScene(net, result, V1, pos1), scene2 = useScene(net, result, V2, pos2);
  const { labels, names, geo } = net;
  // One camera for both graphs, opened fitted so both halves show the whole network.
  const link = useMemo(() => new CameraLink({ z: geo.fitZ }), [geo]);
  const [sel, setSel] = useState<number | null>(null);
  // Entering or leaving Present mode starts from the fitted, centred view.
  useEffect(() => {
    Object.assign(link.ref.current, { yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH, z: geo.fitZ, px: 0, py: 0 });
  }, [app.present, link, geo.fitZ]);
  const [all, setAll] = useState(false);
  const blastTargets = sel != null ? [sel] : [];
  const depth = result.options.depth, against = result.options.blast_direction === 'against';
  const affected = sel != null ? result.blast[sel].rings.reduce((t, r) => t + r.length, 0) : 0;

  const rank1 = (i: number) => V1.rank[i];
  const rank2 = (i: number) => pos2[i]; // 2D rank = Order position (unique); its front is shown beside it
  const change = (i: number) => {
    const d = rank1(i) - rank2(i);
    return d === 0 ? <span style={css('color: var(--text-3); font-weight: 400')}>0</span> : `${d > 0 ? '▲ +' : '▼ −'}${Math.abs(d)}`;
  };
  const changeLabel = (i: number) => { const d = rank1(i) - rank2(i); return d === 0 ? 'no change' : `${d > 0 ? 'up' : 'down'} ${Math.abs(d)}`; };
  const inTop = (V: ReadyVariant, pos: number[], i: number) => pos[i] >= V.k_from && pos[i] <= V.k_to;
  const exportBlast = (x: number) => {
    const cell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const head = ['Ring', 'Asset ID', 'Asset name', 'Reached via (asset ID)', 'Link type', 'Link importance',
      '1D (weighted) rank', '2D (weighted) rank', '2D Pareto front', 'Change (1D rank - 2D rank)'];
    const body = result.blast[x].rings.flatMap((ring, h) => ring.map(([a, p, t, w]) => [
      `Ring ${h + 1}`, result.ids[a], names[a], result.ids[p], result.link_types[t], LV_FULL[w], rank1(a), rank2(a), V2.front![a], rank1(a) - rank2(a),
    ]));
    const text = [[`# Blast radius of ${result.ids[x]} (${depth} ${depth === 1 ? 'hop' : 'hops'}${against ? ', against links' : ''}), ranked by 1D (weighted) and 2D (weighted)`], head, ...body]
      .map((r) => r.map(cell).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    link.download = `carma-blast-radius-1d-vs-2d-${result.ids[x]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const rows = useMemo(() => {
    const keep = new Set(all ? result.ids.map((_, i) => i) : [...V1.top_k, ...V2.top_k]);
    return [...keep].sort((a, b) => pos1[a] - pos1[b]);
  }, [all, result.ids, V1, V2, pos1]);

  // lead: the side that frames the blast cone after a selection (the camera is shared, so one side is enough).
  const side = (V: ReadyVariant, data: typeof scene1, pos: number[], present: boolean, lead: boolean) => {
    const title = V.label;
    const sub = `${V.kind === 'scalar' ? 'Ranked by score' : 'Ranked by Pareto front, then node importance'} · ranks ${V.k_from}–${V.k_to} highlighted${sel != null ? ` · blast radius of ${labels[sel]} (${affected} ${affected === 1 ? 'asset' : 'assets'})` : ''}`;
    return (
      <GraphView
        data={data} fitZ={geo.fitZ} startZoom={geo.fitZ} link={link} theme={T} sel={sel ?? -1} from={V.k_from} to={V.k_to}
        weighted showLevels sizeByScore gatherCone blastTargets={blastTargets} view="3d" labelStyle="inside"
        frameKey={lead && sel != null ? `${sel}-${present}` : ''}
        ariaLabel={(i) => `${labels[i]}, ${names[i]}, ${V.kind === 'scalar' ? `rank ${V.rank[i]}` : `order ${pos[i]}, front ${V.front![i]}`}`}
        tip={(i) => ({
          title: `${labels[i]} · ${names[i]}`,
          line: `${V.kind === 'scalar' ? `Rank ${V.rank[i]}` : `Order ${pos[i]} · Front ${V.front![i]}`} · Centrality ${V.band[i]} · Importance ${LV_FULL[result.importance[i]]}`,
        })}
        onSelect={(k) => setSel(k)}
        overlay={(_, c) => (
          <>
            <GraphCaption title={title} sub={sub} big={present} />
            <GraphLegend T={T} from={V.k_from} to={V.k_to} levels blast={sel != null} />
            {!present && <GraphButtons c={c} />}
          </>
        )}
      />
    );
  };

  if (app.present) {
    return (
      <div style={css('position: fixed; inset: 0; z-index: 50; background: var(--graph-bg); display: flex; align-items: center; justify-content: center')}>
        <ExitPresent />
        {[[V1, scene1, pos1], [V2, scene2, pos2]].map(([V, data, pos], k) => (
          <div key={k} style={{ width: 'min(50vw, calc(100vh * 1400 / 1200))' }}>{side(V as ReadyVariant, data as typeof scene1, pos as number[], true, k === 0)}</div>
        ))}
      </div>
    );
  }

  const list = (V: ReadyVariant, pos: number[]) => (
    <ol style={css('list-style: none; margin: 0; padding: 4px 8px; max-height: 340px; overflow-y: auto')}>
      {V.order.slice(V.k_from - 1, V.k_to).map((i) => (
        <li key={i}>
          <button type="button" aria-pressed={i === sel} onClick={() => setSel(i)} style={css(`width: 100%; display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 8px 12px; border: 0; border-radius: 6px; font: inherit; text-align: left; color: var(--text); cursor: pointer; background: ${i === sel ? 'var(--row-selected)' : 'transparent'}`)}>
            <span style={css('text-align: right; font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums')}>{V.kind === 'scalar' ? V.rank[i] : `${pos[i]} · F${V.front![i]}`}</span>
            <span style={css('min-width: 0')}>
              <span style={css('display: block; font-size: 13px; font-weight: 600')}>{labels[i]}</span>
              <span style={css('display: block; font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap')}>{names[i]}</span>
            </span>
            {app.showValues
              ? <span style={css('font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums')}>{V.kind === 'scalar' ? V.score![i].toFixed(3) : V.normalized![i].map((x) => x.toFixed(2)).join(', ')}</span>
              : <BandChip band={V.band[i]} size="sm" />}
          </button>
        </li>
      ))}
    </ol>
  );

  return (
    <div style={css('min-height: 100vh; background: var(--page); color: var(--text)')}>
      <div style={css('background: var(--surface); border-bottom: 1px solid var(--border); padding: 16px 24px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px')}>
        <div style={css('min-width: 0')}>
          <nav aria-label="Breadcrumb" style={css('display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-3)')}>
            <a href="#/upload" style={css('color: var(--text-3); text-decoration: none')}>Analyses</a>
            <span aria-hidden="true">/</span>
            <a href="#/dashboard" style={css('color: var(--text-3); text-decoration: none')}>{app.analysisName || 'Untitled analysis'}</a>
            <span aria-hidden="true">/</span>
            <span>Compare 1D vs 2D</span>
          </nav>
          <h1 style={css('margin: 2px 0 0; font-size: 20px; line-height: 28px; font-weight: 600; color: var(--text-strong)')}>Compare 1D vs 2D</h1>
          <div style={css('margin-top: 2px; font-size: 13px; color: var(--text-3)')}>
            Same network, ranked two ways. Both graphs move together; select an asset to see its blast radius ({depth} {depth === 1 ? 'hop' : 'hops'}{against ? ', against links' : ''}) on both.
          </div>
        </div>
        <div style={css('margin-left: auto; display: flex; flex-wrap: wrap; gap: 8px')}>
          <button type="button" onClick={() => navigate('/dashboard')} style={css(BTN)}><Icon name="chevronLeft" size={14} width={2.2} />Back to dashboard</button>
          <PresentButton />
          <ThemeButton />
        </div>
      </div>

      {sel != null && (
        <div role="status" style={css('margin: 16px 24px 0; padding: 8px 12px; display: flex; align-items: center; gap: 12px; border: 1px solid var(--blast-box-border); border-radius: 6px; background: var(--blast-box-bg); font-size: 13px')}>
          <span>Selected <strong>{labels[sel]}</strong> · {names[sel]} · 1D rank {rank1(sel)} · 2D rank {rank2(sel)} (front {V2.front![sel]}) · blast radius {affected} {affected === 1 ? 'asset' : 'assets'}</span>
          <button type="button" aria-label="Clear selection" onClick={() => setSel(null)} style={css('margin-left: auto; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; background: transparent; color: var(--text-3); cursor: pointer')}><Icon name="close" size={14} width={2.2} /></button>
        </div>
      )}

      <div style={css('padding: 16px 24px 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(560px, 100%), 1fr)); gap: 16px')}>
        {([[V1, scene1, pos1], [V2, scene2, pos2]] as const).map(([V, data, pos]) => (
          <section key={V.key} aria-label={V.label} style={css(`${CARD}; overflow: hidden`)}>
            {side(V, data, pos, false, V === V1)}
            <div style={css('padding: 12px 16px 4px; font-size: 13px; font-weight: 600')}>{V.label} · ranks {V.k_from}–{V.k_to}</div>
            {list(V, pos)}
          </section>
        ))}
      </div>

      {sel != null && (
        <section aria-labelledby="blastcmp-h" style={css(`margin: 0 24px 16px; ${CARD}; overflow: hidden`)}>
          <div style={css('padding: 16px 16px; display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; border-bottom: 1px solid var(--divider)')}>
            <div>
              <h2 id="blastcmp-h" style={css('margin: 0; font-size: 16px; font-weight: 600; color: var(--text-strong)')}>
                Blast radius of {labels[sel]}: {affected} {affected === 1 ? 'asset' : 'assets'}, ranked by 1D and 2D
              </h2>
              <p style={css('margin: 2px 0 0; font-size: 12px; color: var(--text-3)')}>
                The same assets are affected under both methods ({depth} {depth === 1 ? 'hop' : 'hops'}{against ? ' against the links' : ' downstream'}); what differs is how critical each one is.
                {' '}In ranks {V1.k_from}–{V1.k_to}: {result.blast[sel].rings.flat().filter(([a]) => inTop(V1, pos1, a)).length} in 1D, {result.blast[sel].rings.flat().filter(([a]) => inTop(V2, pos2, a)).length} in 2D.
              </p>
            </div>
            <button type="button" aria-label={`Download the blast radius of ${labels[sel]} as CSV`} onClick={() => exportBlast(sel)} style={css(BTN + '; height: 32px; font-size: 13px')}><Icon name="download" size={14} />CSV</button>
          </div>
          <div style={css('max-height: 420px; overflow: auto')}>
            <table style={css('width: 100%; border-collapse: collapse; color: var(--text)')}>
              <thead>
                <tr>
                  <th scope="col" style={css(TH + '; text-align: left')}>Asset</th>
                  <th scope="col" style={css(TH + '; text-align: left')}>Reached via</th>
                  <th scope="col" style={css(TH + '; text-align: right')}>1D (weighted) rank</th>
                  <th scope="col" style={css(TH + '; text-align: right')}>2D (weighted) rank</th>
                  <th scope="col" style={css(TH + '; text-align: right')}>Change</th>
                </tr>
              </thead>
              {result.blast[sel].rings.map((ring, h) => (
                <tbody key={h} style={css('font-variant-numeric: tabular-nums')}>
                  <tr><th colSpan={5} scope="rowgroup" style={css('padding: 8px 12px 4px; text-align: left; font-size: 12px; font-weight: 600; color: var(--text-2); background: var(--surface)')}>
                    Ring {h + 1} · {h + 1} {h ? 'hops' : 'hop'} <span style={css('font-weight: 500; color: var(--text-3)')}>· {ring.length} {ring.length === 1 ? 'asset' : 'assets'}</span>
                  </th></tr>
                  {ring.map(([a, p, t, w]) => (
                    <tr key={a} onClick={() => setSel(a)} style={{ cursor: 'pointer' }}>
                      <td style={css(TD)}><span style={css('font-weight: 600')}>{labels[a]}</span> <span style={css('color: var(--text-3)')}>{names[a]}</span></td>
                      <td style={css(TD + '; color: var(--text-2)')}>{labels[p]} ({result.link_types[t]}, {LV[w]})</td>
                      <td style={css(TD + '; text-align: right')}>{rank1(a)}{!app.showValues && <> <BandChip band={V1.band[a]} size="sm" /></>}</td>
                      <td style={css(TD + '; text-align: right')}>{rank2(a)} <span style={css('color: var(--text-3)')}>(front {V2.front![a]})</span>{!app.showValues && <> <BandChip band={V2.band[a]} size="sm" /></>}</td>
                      <td style={css(TD + '; text-align: right; font-weight: 600')} aria-label={changeLabel(a)}>{change(a)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
            {!result.blast[sel].rings.length && <p style={css('margin: 0; padding: 12px 16px; font-size: 13px; color: var(--text-3)')}>No assets are affected within {depth} {depth === 1 ? 'hop' : 'hops'}.</p>}
          </div>
        </section>
      )}

      <section aria-labelledby="change-h" style={css(`margin: 0 24px 32px; ${CARD}; overflow: hidden`)}>
        <div style={css('padding: 16px 16px; display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; border-bottom: 1px solid var(--divider)')}>
          <div>
            <h2 id="change-h" style={css('margin: 0; font-size: 16px; font-weight: 600; color: var(--text-strong)')}>Rank change, 1D (weighted) to 2D (weighted)</h2>
            <p style={css('margin: 2px 0 0; font-size: 12px; color: var(--text-3)')}>
              Change = 1D rank − 2D rank: ▲ moves up (more critical) in 2D, ▼ moves down. Word labels (“Rises strongly” …) await the supervisor’s thresholds.
            </p>
          </div>
          <label style={css('display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer')}>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} style={css('width: 16px; height: 16px; margin: 0; accent-color: var(--check)')} />
            All assets <span style={css('color: var(--text-3)')}>(otherwise the highlighted ranks of either side)</span>
          </label>
        </div>
        <div style={css('max-height: 480px; overflow: auto')}>
          <table style={css('width: 100%; border-collapse: collapse; color: var(--text)')}>
            <thead>
              <tr>
                <th scope="col" style={css(TH + '; text-align: left')}>Asset</th>
                <th scope="col" style={css(TH + '; text-align: right')}>1D (weighted) rank</th>
                <th scope="col" style={css(TH + '; text-align: right')}>2D (weighted) rank</th>
                <th scope="col" style={css(TH + '; text-align: right')}>Change</th>
              </tr>
            </thead>
            <tbody style={css('font-variant-numeric: tabular-nums')}>
              {rows.map((i) => {
                return (
                  <tr key={i} onClick={() => setSel(i)} style={{ cursor: 'pointer', background: i === sel ? 'var(--row-selected)' : undefined }}>
                    <td style={css(TD)}><span style={css('font-weight: 600')}>{labels[i]}</span> <span style={css('color: var(--text-3)')}>{names[i]}</span></td>
                    <td style={css(TD + '; text-align: right')}>{rank1(i)}</td>
                    <td style={css(TD + '; text-align: right')}>{rank2(i)} <span style={css('color: var(--text-3)')}>(front {V2.front![i]})</span></td>
                    <td style={css(TD + '; text-align: right; font-weight: 600')} aria-label={changeLabel(i)}>{change(i)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
