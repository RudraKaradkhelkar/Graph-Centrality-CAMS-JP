// Port of the V3 reference _scene(): turns camera + data into absolutely positioned style strings
// (CSS spheres, cylinder edges with arrowheads, floor grid, blast cone, labels, gizmo).
// Pure function: no DOM access. Geometry and styling are the reference's; the only extension is that
// the blast cone takes one ring per hop for depths 1-4, several assets can each have their own cone, and every
// cone points away from the graph's centre (two cones are kept at least 90 degrees apart so they never overlap).
import type { GraphTheme } from './graph-theme';
import { DIST, K } from './layout';

export const W = 1400;
export const H = 1200;

export interface SceneNode {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Shading bin 0-3 (from analyze()). */
  bin: number;
  /** Position in the ranking Order, 1 = best (drives top-k highlight and name tiers). */
  pos: number;
  /** Sphere size 0-1 (from analyze()). */
  size: number;
  /** Asset importance 1-3. */
  lv: number;
}

export interface SceneData {
  N: SceneNode[];
  /** Flat [source, target, importance, typeIndex] per link. */
  E: number[];
  NM: string[];
  /** Blast reach per asset: rings of [asset, parent, ...] (ring h = first reached at hop h + 1). */
  rings: (readonly number[])[][][];
  CX: number;
  CY: number;
  FLOOR: number;
  GX: [number, number];
  GZ: [number, number];
}

export interface SceneState {
  view: '3d' | 'flat';
  z: number;
  px: number;
  py: number;
  yaw: number;
  pitch: number;
  weighted: boolean;
  showLevels: boolean;
  sizeByScore: boolean;
  gatherCone: boolean;
  sel: number;
  from: number;
  to: number;
  labelStyle: 'inside' | 'badge';
  hover: number | null;
  /** Blast layout morph: from the cones of assets gFrom to those of gTo (empty = no cone), progress mt 0-1. */
  gFrom: number[];
  gTo: number[];
  mt: number;
  /** Virtual height of the viewport (width is always W). The drawing stays centred; default H. */
  vh?: number;
}

export interface Scene {
  grid: string[];
  cones: { op: string; fill: string; discs: string[]; dashes: string[]; labels: { t: string; s: string }[] }[];
  edges: { s: string; a: string }[];
  elabels: { t: string; s: string }[];
  nodes: { k: number; lab: string; ls: string; s: string }[];
  names: { id: string; nm: string; s: string; is: string; ns: string }[];
  nameTier: number;
  tip: { k: number; s: string } | null;
  gizmo: { l: string; s: string; t: string }[];
  /** Screen box [x0, y0, x1, y1] (virtual 1400 x 1200 units) around the blast assets and their cones, if any. */
  focus: [number, number, number, number] | null;
}

interface Gathered {
  rings: number[][];
  inBlast: Set<number>;
  par: Record<number, number>;
  pos: Record<number, [number, number, number]>;
  S: [number, number, number];
  d: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  tn: number;
  L: number[];
  Lend: number;
}

/** Keyed by asset and cone direction. */
export type GatherCache = Map<string, Gathered>;

interface P2 { x: number; y: number; d: number; s: number; r: number }

const LV = ['', 'L', 'M', 'H'];
/** Blast cones point away from the centre and tilt this far upwards. */
const CONE_TILT = 35 * Math.PI / 180;

export function buildScene(D: SceneData, st: SceneState, T: GraphTheme, cache: GatherCache): Scene {
  const VH = st.vh ?? H, CX = D.CX, CY = D.CY + (VH - H) / 2, FLOOR = D.FLOOR;
  const flat = st.view === 'flat', zoom = st.z, weighted = st.weighted && st.showLevels, sel = st.sel;
  const yaw = st.yaw * Math.PI / 180, pit = (flat ? -90 : st.pitch) * Math.PI / 180;
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pit), sp = Math.sin(pit);
  const proj = (x: number, y: number, z: number): P2 => {
    const x1 = x * cyw - z * syw, z1 = x * syw + z * cyw;
    const y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
    const sc = flat ? 1 : DIST / (DIST + z2);
    return { x: CX + st.px + x1 * sc * K * zoom, y: CY + st.py - y1 * sc * K * zoom, d: z2, s: sc, r: 0 };
  };
  const pc = (v: number, t: number) => (v / t * 100).toFixed(3) + '%';
  const seg = (a: { x: number; y: number }, b: { x: number; y: number }, w: number, bg: string, extra?: string) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    return 'position: absolute; left: ' + pc(a.x, W) + '; top: ' + pc(a.y, VH) + '; width: ' + pc(Math.sqrt(dx * dx + dy * dy), W) + '; height: ' + w + 'px; margin-top: -' + (w / 2) + 'px; background: ' + bg + '; transform-origin: 0 50%; transform: rotate(' + (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(2) + 'deg)' + (extra || '');
  };
  const N = D.N, E = D.E;
  let i: number, j: number;

  // Cone direction on the floor plane for each blast asset: away from the footprint's centre (0, 0).
  // Two cones closer than 90 degrees are turned apart symmetrically so they can't overlap. gather() then tilts the
  // cone CONE_TILT upwards.
  const coneDirs = (targets: number[]): Map<number, [number, number]> => {
    const dirs = targets.map((x): [number, number] => {
      const hx = N[x].x, hz = N[x].z, l = Math.hypot(hx, hz);
      return l > 1e-6 ? [hx / l, hz / l] : [0.57, 0.82];
    });
    if (dirs.length === 2) {
      const a0 = Math.atan2(dirs[0][1], dirs[0][0]), a1 = Math.atan2(dirs[1][1], dirs[1][0]);
      let gap = a1 - a0;
      gap = Math.atan2(Math.sin(gap), Math.cos(gap));
      if (Math.abs(gap) < Math.PI / 2) {
        const mid = a0 + gap / 2, side = gap >= 0 ? 1 : -1;
        dirs[0] = [Math.cos(mid - side * Math.PI / 4), Math.sin(mid - side * Math.PI / 4)];
        dirs[1] = [Math.cos(mid + side * Math.PI / 4), Math.sin(mid + side * Math.PI / 4)];
      }
    }
    return new Map(targets.map((x, k) => [x, dirs[k]]));
  };

  // Blast layout: each blast asset stays where it is, and every asset it affects gathers into a cone
  // in front of it (ring 1 nearest, outer rings further out).
  const gather = (x: number, hd: [number, number]): Gathered => {
    const key = `${x}|${hd[0].toFixed(4)}|${hd[1].toFixed(4)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const rings = D.rings[x].map((r) => r.map((m) => m[0]));
    const par: Record<number, number> = {};
    const inBlast = new Set<number>();
    D.rings[x].forEach((r) => r.forEach((m) => { par[m[0]] = m[1]; inBlast.add(m[0]); }));
    const sx = N[x].x, sy = N[x].y, sz = N[x].z;
    const nr = rings.length, counts = rings.map((r) => r.length);
    const nLast = nr >= 2 ? counts[nr - 1] : 0;
    const Lfar = Math.max(2.2, Math.min(4.1, 2 + 0.09 * nLast)) * (nr > 2 ? 1 + 0.35 * (nr - 2) : 1);
    const L = nr >= 2 ? counts.map((_, h) => Lfar * (0.46 + 0.54 * h / (nr - 1))) : [0.46 * Lfar];
    const Lend = nr >= 2 ? Lfar + 0.7 : L[0] + 0.55;
    const dx = hd[0] * Math.cos(CONE_TILT), dy = Math.sin(CONE_TILT), dz = hd[1] * Math.cos(CONE_TILT);
    let vx = -dy * dx, vy = 1 - dy * dy, vz = -dy * dz;
    const vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
    vx /= vl; vy /= vl; vz /= vl;
    const ux = dy * vz - dz * vy, uy = dz * vx - dx * vz, uz = dx * vy - dy * vx;
    const n1 = counts[0] || 0;
    let th = Math.atan(Math.max(0.22, n1 * 0.4 / (2 * Math.PI)) / 0.8 / L[0]);
    for (let h = 1; h < nr; h++) th = Math.max(th, Math.atan((0.2 * Math.sqrt(counts[h]) + 0.25) / 0.8 / L[h]));
    if (nr < 2) th = Math.max(th, Math.atan(0.25 / 0.8 / Lfar));
    th = Math.max(11 * Math.PI / 180, Math.min(24 * Math.PI / 180, th));
    const tn = Math.tan(th);
    const at = (t: number, r: number, ph: number): [number, number, number] => {
      const cs = Math.cos(ph) * r, sn = Math.sin(ph) * r;
      return [sx + dx * t + ux * cs + vx * sn, sy + dy * t + uy * cs + vy * sn, sz + dz * t + uz * cs + vz * sn];
    };
    const pos: Record<number, [number, number, number]> = {}, ang: Record<number, number> = {}, GA = Math.PI * (3 - Math.sqrt(5));
    const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (nr) {
      const Rc1 = L[0] * tn;
      rings[0].forEach((q, m) => {
        let ph = Math.PI / 2 + m / Math.max(1, n1) * Math.PI * 2, r = n1 <= 1 ? 0 : 0.78 * Rc1;
        if (n1 > 10) { r = 0.84 * Rc1 * Math.sqrt((m + 0.5) / n1); ph = Math.PI / 2 + m * GA; }
        pos[q] = at(L[0], r, ph); ang[q] = norm(ph);
      });
    }
    for (let h = 1; h < nr; h++) {
      const nh = counts[h], Rc = L[h] * tn, pts: [number, number][] = [];
      for (let k = 0; k < nh; k++) {
        const r2 = nh <= 1 ? 0 : (nh <= 7 ? 0.78 * Rc : 0.86 * Rc * Math.sqrt((k + 0.5) / nh));
        const p2 = nh <= 7 ? Math.PI / 2 + k / nh * Math.PI * 2 : k * GA;
        pts.push([r2, norm(p2)]);
      }
      pts.sort((p, q) => p[1] - q[1]);
      const o2 = rings[h].slice().sort((p, q) => (ang[par[p]] - ang[par[q]]) || (p - q));
      o2.forEach((q, m) => { pos[q] = at(L[h], pts[m][0], pts[m][1]); ang[q] = pts[m][1]; });
    }
    pos[x] = [sx, sy, sz];
    const g: Gathered = { rings, inBlast, par, pos, S: [sx, sy, sz], d: [dx, dy, dz], u: [ux, uy, uz], v: [vx, vy, vz], tn, L, Lend };
    cache.set(key, g);
    return g;
  };

  const mt = st.mt, e = mt < 0.5 ? 4 * mt * mt * mt : 1 - Math.pow(-2 * mt + 2, 3) / 2;
  const gathersOf = (targets: number[]) => { const dirs = coneDirs(targets); return new Map(targets.map((x) => [x, gather(x, dirs.get(x)!)])); };
  const fromG = gathersOf(st.gFrom), toG = gathersOf(st.gTo);
  const focus = toG.size ? (fromG.size ? 1 : e) : (fromG.size ? 1 - e : 0);
  // Highlighting follows the cones being shown (or, while they fade out, the previous ones).
  const targets = st.gTo.length ? st.gTo : st.gFrom, BLs = [...(st.gTo.length ? toG : fromG).values()], blastOn = BLs.length > 0;
  const gatheredAt = (gs: Map<number, Gathered>, i: number) => { for (const G of gs.values()) if (G.pos[i]) return G.pos[i]; return null; };

  const P: P2[] = [];
  let dmin = 1e9, dmax = -1e9;
  for (i = 0; i < N.length; i++) {
    const base: [number, number, number] = [N[i].x, N[i].y, N[i].z];
    const A0 = (st.gatherCone && gatheredAt(fromG, i)) || base;
    const B0 = (st.gatherCone && gatheredAt(toG, i)) || base;
    const p = proj(A0[0] + (B0[0] - A0[0]) * e, A0[1] + (B0[1] - A0[1]) * e, A0[2] + (B0[2] - A0[2]) * e);
    p.r = (10 + 16 * (st.sizeByScore ? N[i].size : 0.5)) * p.s * Math.pow(zoom, 0.6);
    P.push(p);
    if (p.d < dmin) dmin = p.d;
    if (p.d > dmax) dmax = p.d;
  }
  const depth = (d: number) => dmax > dmin ? (d - dmin) / (dmax - dmin) : 0;
  const inRange = (k: number) => N[k].pos >= st.from && N[k].pos <= st.to;
  const inBlast = (k: number) => blastOn && (targets.includes(k) || BLs.some((G) => G.inBlast.has(k)));

  const grid: string[] = [];
  let g: number, A: P2, B: P2;
  const GX = D.GX, GZ = D.GZ;
  for (g = GX[0]; g <= GX[1] + 0.001; g += 0.5) { A = proj(g, FLOOR, GZ[0]); B = proj(g, FLOOR, GZ[1]); grid.push(seg(A, B, 1, 'rgba(' + T.grid + ')')); }
  for (g = GZ[0]; g <= GZ[1] + 0.001; g += 0.5) { A = proj(GX[0], FLOOR, g); B = proj(GX[1], FLOOR, g); grid.push(seg(A, B, 1, 'rgba(' + T.grid + ')')); }

  const edges: Scene['edges'] = [], elabels: Scene['elabels'] = [], placed: number[][] = [];
  for (i = 0; i < N.length; i++) placed.push([P[i].x - P[i].r, P[i].y - P[i].r, P[i].x + P[i].r, P[i].y + P[i].r]);
  const hit = (bx: number[]) => {
    for (let m = 0; m < placed.length; m++) { const o = placed[m]; if (bx[0] < o[2] && o[0] < bx[2] && bx[1] < o[3] && o[1] < bx[3]) return true; }
    return false;
  };
  for (i = 0; i < E.length; i += 4) {
    const a = E[i], b = E[i + 1], lv = E[i + 2];
    // A blast edge joins a ring member and its parent (along the links parent -> member, against member -> parent).
    const blastEdge = blastOn && BLs.some((G) => G.par[b] === a || G.par[a] === b);
    const touchesTarget = targets.includes(a) || targets.includes(b);
    const isH1 = blastOn ? blastEdge && touchesTarget : a === sel, isH2 = blastEdge && !touchesTarget;
    const inner = blastOn && inBlast(a) && inBlast(b);
    const pal = isH1 ? T.e1 : (isH2 ? T.e2 : T.e0);
    const w = st.weighted ? [0, 2.6, 3.8, 5][lv] : 3.4;
    const base = 0.9 - 0.5 * depth((P[a].d + P[b].d) / 2);
    const op = isH1 || isH2 ? 1 : (inner ? base + (0.5 - base) * focus : base + (0.07 - base) * focus);
    const grad = 'linear-gradient(to bottom, ' + pal[0] + ' 0%, ' + pal[1] + ' 55%, ' + pal[2] + ' 100%)';
    const aw = 7 + w * 1.5, ah = 6 + w * 1.3;
    edges.push({
      s: seg(P[a], P[b], w, grad, '; border-radius: ' + w + 'px; opacity: ' + op.toFixed(2)),
      a: 'position: absolute; right: ' + (P[b].r + 0.5).toFixed(1) + 'px; top: 50%; width: ' + aw.toFixed(1) + 'px; height: ' + ah.toFixed(1) + 'px; margin-top: -' + (ah / 2).toFixed(1) + 'px; clip-path: polygon(0 0, 100% 50%, 0 100%); background: ' + grad,
    });
    if (weighted && (focus < 0.5 || isH1 || isH2)) {
      const mx = (P[a].x + P[b].x) / 2, my = (P[a].y + P[b].y) / 2, ex = P[b].x - P[a].x, ey = P[b].y - P[a].y;
      if (Math.sqrt(ex * ex + ey * ey) > P[a].r + P[b].r + 22 && mx > 0 && mx < W && my > 0 && my < VH) {
        const bx = [mx - 9, my - 9, mx + 9, my + 9];
        if (!hit(bx)) {
          placed.push(bx);
          elabels.push({ t: LV[lv], s: 'position: absolute; left: ' + pc(mx, W) + '; top: ' + pc(my, VH) + '; width: 15px; height: 15px; margin: -7.5px 0 0 -7.5px; border-radius: 50%; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; line-height: 1; background: ' + T.lblBg + '; border: 1px solid ' + (isH1 || isH2 ? T.lblHop : T.lblBorder) + '; color: ' + T.lblText + '; opacity: ' + Math.max(op, 0.75).toFixed(2) });
        }
      }
    }
  }

  const ord: number[] = [];
  for (i = 0; i < N.length; i++) ord.push(i);
  ord.sort((u, v) => P[v].d - P[u].d);
  const nodes = ord.map((k) => {
    const q = P[k], n = N[k], on = inRange(k), isSel = k === sel || targets.includes(k), ctx = blastOn && !inBlast(k);
    const c = on ? T.org : T.sph[n.bin];
    const op0 = on || isSel ? 1 : 1 - 0.3 * depth(q.d);
    const op = ctx ? op0 + ((on ? 0.45 : 0.16) - op0) * focus : op0;
    const sh = T.shadow + (on && T.glow && !ctx ? ', ' + T.glow : '') + (isSel ? ', 0 0 0 2px ' + T.ringGap + ', 0 0 0 4px ' + T.ring + ', 0 0 0 12px ' + T.halo : '');
    let lab = '', ls = 'display: none';
    if (weighted && !(ctx && focus > 0.5)) {
      if (st.labelStyle === 'badge') {
        lab = LV[n.lv];
        ls = 'position: absolute; right: -4px; top: -4px; width: 14px; height: 14px; border-radius: 50%; box-sizing: border-box; display: flex; align-items: center; justify-content: center; font-size: 8.5px; font-weight: 700; line-height: 1; background: ' + T.badgeBg + '; color: ' + T.badgeText + '; border: 1.5px solid ' + T.bg;
      } else if (q.r >= 6.5) {
        lab = LV[n.lv];
        ls = 'font-size: ' + Math.max(8, Math.min(17, q.r * 0.9)).toFixed(1) + 'px; font-weight: 700; line-height: 1; color: ' + c[3] + '; pointer-events: none';
      }
    }
    return {
      k, lab, ls,
      s: 'position: absolute; left: ' + pc(q.x, W) + '; top: ' + pc(q.y, VH) + '; width: ' + (2 * q.r).toFixed(1) + 'px; height: ' + (2 * q.r).toFixed(1) + 'px; margin: -' + q.r.toFixed(1) + 'px 0 0 -' + q.r.toFixed(1) + 'px; padding: 0; border: 0; border-radius: 50%; background: radial-gradient(circle at 34% 30%, ' + c[0] + ' 0%, ' + c[1] + ' 46%, ' + c[2] + ' 100%); box-shadow: ' + sh + '; opacity: ' + op.toFixed(2) + '; display: flex; align-items: center; justify-content: center; cursor: pointer',
    };
  });

  // Asset names follow zoom: zoomed out only the top-ranked assets are named, zooming in reveals the rest.
  const tierN = zoom < 0.7 ? 5 : (zoom < 1.4 ? 10 : (zoom < 2.2 ? 30 : N.length)), showNm = zoom >= 2.2;
  const cand: number[] = [];
  for (i = 0; i < N.length; i++) cand.push(i);
  cand.sort((u, v) => ((u === sel ? -1 : 0) - (v === sel ? -1 : 0)) || (N[u].pos - N[v].pos));
  const taken: number[][] = [], names: Scene['names'] = [];
  const clash = (bx: number[]) => {
    for (let m = 0; m < taken.length; m++) { const o = taken[m]; if (bx[0] < o[2] && o[0] < bx[2] && bx[1] < o[3] && o[1] < bx[3]) return true; }
    return false;
  };
  cand.forEach((k) => {
    const q = P[k], n = N[k], isSel = k === sel;
    if (!isSel && n.pos > tierN) return;
    if (blastOn && !inBlast(k) && focus > 0.5) return;
    if (q.x < -40 || q.x > W + 40 || q.y < -20 || q.y > VH + 20) return;
    const nm = D.NM[k], lw = Math.max(6.6 * n.id.length, showNm ? 5.9 * nm.length : 0) + 6, lh = showNm ? 30 : 16;
    const Rb = [q.x + q.r + 5, q.y - lh / 2, q.x + q.r + 5 + lw, q.y + lh / 2], Lb = [q.x - q.r - 5 - lw, q.y - lh / 2, q.x - q.r - 5, q.y + lh / 2];
    let left = false;
    if (clash(Rb)) { if (!clash(Lb)) left = true; else if (!isSel) return; }
    taken.push(left ? Lb : Rb);
    const lead = isSel || n.pos <= 10;
    names.push({
      id: n.id, nm,
      s: 'position: absolute; left: ' + pc(left ? q.x - q.r - 5 : q.x + q.r + 5, W) + '; top: ' + pc(q.y, VH) + '; transform: translate(' + (left ? '-100%' : '0') + ', -50%); white-space: nowrap; line-height: 1.25; text-align: ' + (left ? 'right' : 'left') + '; text-shadow: 0 0 2px ' + T.nameHalo + ', 0 0 4px ' + T.nameHalo + ', 0 0 8px ' + T.nameHalo,
      is: 'display: block; font-size: ' + (lead ? '11.5px; font-weight: 600; color: ' + T.nameTop : '10.5px; font-weight: 500; color: ' + T.nameRest),
      ns: showNm ? 'display: block; font-size: 10.5px; font-weight: 400; color: ' + T.nameRest : 'display: none',
    });
  });

  let focusBox: [number, number, number, number] | null = null;
  const grow = (x: number, y: number, r = 0) => {
    focusBox = focusBox ? [Math.min(focusBox[0], x - r), Math.min(focusBox[1], y - r), Math.max(focusBox[2], x + r), Math.max(focusBox[3], y + r)] : [x - r, y - r, x + r, y + r];
  };
  if (blastOn) for (i = 0; i < N.length; i++) if (inBlast(i)) grow(P[i].x, P[i].y, P[i].r);

  const cones: Scene['cones'] = [];
  for (const [tx, G0] of toG) {
    if (!G0.rings.length || !G0.rings[0].length) continue;
    const cone: Scene['cones'][number] = { op: '0', fill: '', discs: [], dashes: [], labels: [] };
    const S0 = G0.S, d0 = G0.d, u0 = G0.u, v0 = G0.v, nr = G0.rings.length;
    const ring = (t: number, cnt: number) => {
      const res: P2[] = [], rr = t * G0.tn;
      for (let m = 0; m < cnt; m++) {
        const ph = m / cnt * Math.PI * 2, cs = Math.cos(ph) * rr, sn = Math.sin(ph) * rr;
        res.push(proj(S0[0] + d0[0] * t + u0[0] * cs + v0[0] * sn, S0[1] + d0[1] * t + u0[1] * cs + v0[1] * sn, S0[2] + d0[2] * t + u0[2] * cs + v0[2] * sn));
      }
      return res;
    };
    const axis = (t: number) => proj(S0[0] + d0[0] * t, S0[1] + d0[1] * t, S0[2] + d0[2] * t);
    const poly = (pts: P2[]) => 'polygon(' + pts.map((q) => pc(q.x, W) + ' ' + pc(q.y, VH)).join(', ') + ')';
    const Lend = G0.Lend;
    const apex = proj(S0[0], S0[1], S0[2]), R = G0.L.map((t) => ring(t, 48)), rend = ring(Lend, 48);
    rend.forEach((q) => grow(q.x, q.y));
    const all: number[][] = [[apex.x, apex.y, 0] as number[]].concat(rend.map((q) => [q.x, q.y, 1])).sort((u, v) => u[0] - v[0] || u[1] - v[1]);
    const cross = (o: number[], a2: number[], b2: number[]) => (a2[0] - o[0]) * (b2[1] - o[1]) - (a2[1] - o[1]) * (b2[0] - o[0]);
    const lower: number[][] = [], upper: number[][] = [];
    for (j = 0; j < all.length; j++) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], all[j]) <= 0) lower.pop(); lower.push(all[j]); }
    for (j = all.length - 1; j >= 0; j--) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], all[j]) <= 0) upper.pop(); upper.push(all[j]); }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    // Shade along the cone's axis: strongest at the asset, fading to nothing past the last ring.
    const cEnd = axis(Lend);
    const gx = cEnd.x - apex.x, gy = cEnd.y - apex.y, ga = Math.atan2(gx, -gy), sa = Math.sin(ga), ca = Math.cos(ga);
    const glen = Math.abs(W * sa) + Math.abs(VH * ca), sX = W / 2 - sa * glen / 2, sY = VH / 2 + ca * glen / 2;
    const at2 = (q: { x: number; y: number }) => (((q.x - sX) * sa - (q.y - sY) * ca) / glen * 100).toFixed(2) + '%';
    const CA = T.coneA, col = (al: number) => 'rgba(' + T.cone + ', ' + al + ')';
    const stops = [col(CA[0]) + ' ' + at2(apex), col(CA[1]) + ' ' + at2(axis(G0.L[0]))];
    if (nr >= 2) for (let h = 1; h < nr; h++) stops.push(col(+(CA[1] + (CA[2] - CA[1]) * h / (nr - 1)).toFixed(3)) + ' ' + at2(axis(G0.L[h])));
    else stops.push(col(CA[2]) + ' ' + at2(cEnd));
    stops.push(col(0) + ' ' + at2(cEnd));
    cone.op = (fromG.get(tx) === G0 ? 1 : e).toFixed(2); // fade in new (or turned) cones
    cone.fill = 'position: absolute; inset: 0; clip-path: polygon(' + hull.map((q) => pc(q[0], W) + ' ' + pc(q[1], VH)).join(', ') + '); background: linear-gradient(' + (ga * 180 / Math.PI).toFixed(2) + 'deg, ' + stops.join(', ') + ')';
    for (let h = nr - 1; h >= 0; h--) cone.discs.push('position: absolute; inset: 0; clip-path: ' + poly(R[h]) + '; background: ' + col(h === 0 ? CA[3] : +(CA[4] * Math.pow(0.8, h - 1)).toFixed(3)));
    for (j = 0; j < 48; j += 2) {
      for (let h = 0; h < nr; h++) {
        cone.dashes.push(h === 0 ? seg(R[0][j], R[0][j + 1], 1.8, col(0.95)) : seg(R[h][j], R[h][j + 1], 1.5, col(+(0.75 * Math.pow(0.85, h - 1)).toFixed(3))));
      }
    }
    for (j = 0; j < hull.length; j++) {
      const ha = hull[j], hb = hull[(j + 1) % hull.length];
      if (ha[2] !== hb[2]) {
        const fa = ha[2] === 0 ? ha : hb, fb = ha[2] === 0 ? hb : ha;
        cone.dashes.push(seg({ x: fa[0], y: fa[1] }, { x: fb[0], y: fb[1] }, 1.4, 'linear-gradient(to right, ' + col(0.75) + ', ' + col(0) + ')'));
      }
    }
    const topOf = (pts: P2[]) => { let tq = pts[0]; pts.forEach((q) => { if (q.y < tq.y) tq = q; }); return tq; };
    for (let h = 0; h < nr; h++) {
      const t = topOf(R[h]), c = G0.rings[h].length;
      cone.labels.push({ t: (h + 1) + (h === 0 ? ' Hop · ' : ' Hops · ') + c + (c === 1 ? ' Asset' : ' Assets'), s: 'position: absolute; left: ' + pc(t.x, W) + '; top: ' + pc(t.y, VH) + '; transform: translate(-50%, -135%); opacity: ' + cone.op });
    }
    cones.push(cone);
  }

  let tip: Scene['tip'] = null;
  if (st.hover != null && st.hover >= 0) {
    const hq = P[st.hover];
    tip = { k: st.hover, s: 'position: absolute; left: ' + pc(hq.x + hq.r + 10, W) + '; top: ' + pc(hq.y, VH) + '; transform: translateY(-50%); pointer-events: none' };
  }

  const axisDir = (x: number, y: number, z: number) => {
    const x1 = x * cyw - z * syw, z1 = x * syw + z * cyw;
    return { x: 15 * x1, y: -15 * (y * cp - z1 * sp), d: y * sp + z1 * cp };
  };
  const gizmo = ([['X', axisDir(1, 0, 0), T.gx[0]], ['Y', axisDir(0, 1, 0), T.gx[1]], ['Z', axisDir(0, 0, 1), T.gx[2]]] as const).map((q) => {
    const ev = q[1], back = ev.d > 0.2;
    return {
      l: q[0],
      s: 'position: absolute; left: 25px; top: 25px; width: ' + Math.sqrt(ev.x * ev.x + ev.y * ev.y).toFixed(1) + 'px; height: 1.8px; margin-top: -0.9px; border-radius: 1px; background: rgba(' + q[2] + ', ' + (back ? 0.45 : 1) + '); transform-origin: 0 50%; transform: rotate(' + (Math.atan2(ev.y, ev.x) * 180 / Math.PI).toFixed(1) + 'deg)',
      t: 'position: absolute; left: ' + (25 + ev.x * 1.4 - 3).toFixed(1) + 'px; top: ' + (25 + ev.y * 1.4 - 6).toFixed(1) + 'px; font-size: 8px; font-weight: 600; line-height: 12px; color: rgba(' + T.gizmoText + ', ' + (back ? 0.5 : 1) + ')',
    };
  });
  return { grid, edges, elabels, nodes, names, nameTier: tierN < N.length ? tierN : 0, cones, tip, gizmo, focus: focusBox };
}
