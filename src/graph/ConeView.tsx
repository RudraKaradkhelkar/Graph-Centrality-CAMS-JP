// Blast Radius in 3D: one asset's blast cone on its own, drawn by the same scene code as the main graph (same
// spheres, edges, rings and hop labels). It turns and zooms around the cone's middle but never moves (no panning).
import { useMemo, useState } from 'react';
import { css } from '../components/css';
import { Icon } from '../components/ui';
import type { GraphTheme } from './graph-theme';
import { GraphView, type TipContent } from './GraphView';
import { DEFAULT_YAW } from './layout';
import { H, W, type SceneData } from './scene';

/** The cone opens to the right and a little towards the viewer in the default camera, almost level (tilt 10). */
const DIR_DEG = -DEFAULT_YAW - 25;
const CONE_DIR: [number, number] = [Math.cos(DIR_DEG * Math.PI / 180), Math.sin(DIR_DEG * Math.PI / 180)];
const BTN = 'width: 36px; height: 32px; display: flex; align-items: center; justify-content: center; border: 0; background: transparent; color: var(--text-2); cursor: pointer';
const OVERLAY = 'pointer-events: auto; background: var(--overlay-94); box-shadow: var(--overlay-shadow); border: 1px solid var(--border)';

/** Scene data for asset x and the assets in its blast radius only (indices renumbered, x first). */
export function coneData(D: SceneData, x: number): SceneData {
  const members = [x, ...D.rings[x].flat().map((m) => m[0])];
  const at = new Map(members.map((a, i) => [a, i]));
  const E: number[] = [];
  for (let i = 0; i < D.E.length; i += 4) {
    const a = at.get(D.E[i]), b = at.get(D.E[i + 1]);
    if (a != null && b != null) E.push(a, b, D.E[i + 2], D.E[i + 3]);
  }
  return {
    // Every asset starts at the origin; the cone layout places them (the asset stays at the apex).
    N: members.map((a) => ({ ...D.N[a], x: 0, y: 0, z: 0 })),
    E,
    NM: members.map((a) => D.NM[a]),
    rings: members.map((_, i) => (i === 0 ? D.rings[x].map((r) => r.map((m) => [at.get(m[0])!, at.get(m[1])!, ...m.slice(2)])) : [])),
    CX: W / 2, CY: H / 2, FLOOR: 0, GX: [1, 0], GZ: [1, 0], // no floor grid
    coneDir: CONE_DIR, coneTilt: 10, pivotOnCone: true,
  };
}

interface Props {
  data: SceneData;
  /** The asset whose cone is shown (index in data). */
  x: number;
  theme: GraphTheme;
  from: number;
  to: number;
  weighted: boolean;
  showLevels: boolean;
  sizeByScore: boolean;
  height: number | string;
  ariaLabel: (k: number) => string;
  tip: (k: number) => TipContent;
}

export function ConeView(p: Props) {
  const cd = useMemo(() => coneData(p.data, p.x), [p.data, p.x]);
  const members = useMemo(() => [p.x, ...p.data.rings[p.x].flat().map((m) => m[0])], [p.data, p.x]);
  // Reset: a fresh view, framed again around the cone.
  const [fresh, setFresh] = useState(0);
  return (
    <GraphView key={fresh}
      data={cd} fitZ={1} startZoom={1} height={p.height} theme={p.theme} sel={0} from={p.from} to={p.to}
      weighted={p.weighted} showLevels={p.showLevels} sizeByScore={p.sizeByScore} gatherCone blastTargets={[0]}
      frameKey={`cone-${p.x}-${cd.rings[0].map((r) => r.length).join(',')}`} view="3d" labelStyle="inside" pannable={false}
      ariaLabel={(i) => p.ariaLabel(members[i])} tip={(i) => p.tip(members[i])} onSelect={() => {}}
      overlay={(info, c) => (
        <div style={css('position: absolute; inset: 12px; pointer-events: none; display: flex; align-items: flex-end; justify-content: space-between; gap: 8px')}>
          <div data-ui="1" style={css(`${OVERLAY}; padding: 6px 12px; border-radius: 6px; font-size: 14px; line-height: 18px; color: var(--text-2); cursor: default`)}>
            Drag to turn · Ctrl + scroll or pinch to zoom
          </div>
          <div data-ui="1" style={css(`display: flex; ${OVERLAY}; border-radius: 6px; overflow: hidden`)}>
            <button type="button" aria-label="Zoom out" onClick={c.zoomOut} style={css(BTN)}><Icon name="minus" width={2} /></button>
            <span aria-live="polite" style={css('min-width: 48px; border-left: 1px solid var(--border); border-right: 1px solid var(--border); font-size: 14px; line-height: 32px; font-weight: 600; text-align: center; color: var(--text); font-variant-numeric: tabular-nums')}>{info.zoomPct}</span>
            <button type="button" aria-label="Zoom in" onClick={c.zoomIn} style={css(BTN)}><Icon name="plus" width={2} /></button>
            <button type="button" aria-label="Reset the 3D view" title="Reset the view" onClick={() => setFresh(fresh + 1)} style={css(`${BTN}; border-left: 1px solid var(--border)`)}><Icon name="reset" /></button>
          </div>
        </div>
      )}
    />
  );
}
