// Port of the V3 reference _layout(). Spreads assets out in all three directions: each asset type keeps
// its place in the lanes, its cluster is enlarged, the floor footprint is made square (8.4 x 8.4 world units),
// assets are pushed apart in 3D, and anything that still overlaps from the default camera is nudged apart.
// The graph is larger than the frame at 100%; Fit to screen zooms out to fitZ.

export interface LayoutInput {
  /** Starting position per asset (the sample's preset X/Y/Z). */
  pos: [number, number, number][];
  /** Asset type per asset; each type forms one cluster. */
  type: string[];
}

export interface Layout {
  pos: [number, number, number][];
  CX: number;
  CY: number;
  fitZ: number;
  floor: number;
  gx: [number, number];
  gz: [number, number];
}

export const K = 208.75;
/** Above this many assets the overlap passes use a spatial grid instead of checking every pair. */
const GRID_MIN = 400;

/** Calls visit(i, j) (i < j) for every pair closer than `cell` along each axis, using a uniform grid. */
function nearPairs(pts: number[][], dims: 2 | 3, cell: number, visit: (i: number, j: number) => void) {
  const c = (v: number) => Math.max(-1000, Math.min(1000, Math.floor(v / cell)));
  const key = (a: number, b: number, d: number) => ((a + 1024) * 2048 + (b + 1024)) * 2048 + (d + 1024);
  const ci = pts.map((p) => [c(p[0]), c(p[1]), dims === 3 ? c(p[2]) : 0]);
  const cells = new Map<number, number[]>();
  ci.forEach((q, i) => { const k = key(q[0], q[1], q[2]); (cells.get(k) ?? cells.set(k, []).get(k)!).push(i); });
  const dzs = dims === 3 ? [-1, 0, 1] : [0];
  for (let i = 0; i < pts.length; i++) {
    const q = ci[i];
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of dzs) {
      const bucket = cells.get(key(q[0] + dx, q[1] + dy, q[2] + dz));
      if (bucket) for (const j of bucket) if (j > i) visit(i, j);
    }
  }
}
export const DIST = 14;
export const DEFAULT_YAW = -22;
export const DEFAULT_PITCH = -14;

export function layout(input: LayoutInput): Layout {
  const n = input.pos.length;
  let i: number, j: number, k: number;
  const yw = DEFAULT_YAW * Math.PI / 180, pt = DEFAULT_PITCH * Math.PI / 180;
  const cy = Math.cos(yw), sy = Math.sin(yw), cp = Math.cos(pt), sp = Math.sin(pt);
  const rv = [cy, 0, -sy], uv = [-sp * sy, cp, -sp * cy];
  const pj = (q: number[]) => {
    const x1 = q[0] * cy - q[2] * sy, z1 = q[0] * sy + q[2] * cy, y1 = q[1] * cp - z1 * sp, z2 = q[1] * sp + z1 * cp, s = DIST / (DIST + z2);
    return [x1 * s, y1 * s, s];
  };
  const G = [1.5, 2.3, 1], F = [1.5, 2.7, 11], grp: Record<string, number[]> = {}, P: number[][] = [];
  for (i = 0; i < n; i++) { const t = input.type[i]; (grp[t] = grp[t] || []).push(i); P.push([]); }
  Object.keys(grp).forEach((t) => {
    const ix = grp[t], c = [0, 0, 0];
    ix.forEach((m) => { for (let b = 0; b < 3; b++) c[b] += input.pos[m][b] / ix.length; });
    ix.forEach((m) => { P[m] = [0, 1, 2].map((b) => c[b] * G[b] + (input.pos[m][b] - c[b]) * F[b]); });
  });
  const relax3 = (D3: number) => {
    for (let it = 0; it < 300; it++) {
      const mv = P.map(() => [0, 0, 0]);
      let moved = false;
      const visit = (i: number, j: number) => {
        let dx = P[j][0] - P[i][0], dy = P[j][1] - P[i][1], dz = P[j][2] - P[i][2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < D3) {
          if (d < 1e-6) { dx = 1e-3; dy = 0; dz = 1e-3; d = 1.4e-3; }
          const m = (D3 - d) / 2 / d;
          mv[i][0] -= dx * m; mv[i][1] -= dy * m; mv[i][2] -= dz * m; mv[j][0] += dx * m; mv[j][1] += dy * m; mv[j][2] += dz * m; moved = true;
        }
      };
      if (n > GRID_MIN) nearPairs(P, 3, D3, visit);
      else for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) visit(i, j);
      if (!moved) return;
      for (i = 0; i < n; i++) for (k = 0; k < 3; k++) P[i][k] += mv[i][k];
    }
  };
  const relax = () => {
    for (let it = 0; it < 300; it++) {
      const S = P.map(pj), mv = P.map(() => [0, 0]);
      let moved = false;
      const visit = (i: number, j: number) => {
        let dx = S[j][0] - S[i][0], dy = S[j][1] - S[i][1], d = Math.sqrt(dx * dx + dy * dy);
        const Dij = 0.2 * (S[i][2] + S[j][2]) / 2;
        if (d < Dij) {
          if (d < 1e-6) { dx = 1e-3; dy = 0; d = 1e-3; }
          const m2 = (Dij - d) / 2 / d;
          mv[i][0] -= dx * m2; mv[i][1] -= dy * m2; mv[j][0] += dx * m2; mv[j][1] += dy * m2; moved = true;
        }
      };
      if (n > GRID_MIN) nearPairs(S, 2, 0.2 * Math.max(...S.map((q) => q[2])), visit);
      else for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) visit(i, j);
      if (!moved) return;
      for (i = 0; i < n; i++) { const ax = mv[i][0] / S[i][2], ay = mv[i][1] / S[i][2]; for (k = 0; k < 3; k++) P[i][k] += ax * rv[k] + ay * uv[k]; }
    }
  };
  const fit = () => {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    P.map(pj).forEach((q) => { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); });
    return { k: Math.min(1240 / ((x1 - x0) * K), 980 / ((y1 - y0) * K)), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  };
  const square = (A: number) => {
    // Square floor: x and z get the same half-width A around the footprint's centre.
    const lo = [1e9, 1e9], hi = [-1e9, -1e9];
    P.forEach((q) => { lo[0] = Math.min(lo[0], q[0]); hi[0] = Math.max(hi[0], q[0]); lo[1] = Math.min(lo[1], q[2]); hi[1] = Math.max(hi[1], q[2]); });
    // (|| 1 guards a zero-width footprint, e.g. a network of two assets; the reference data never has one.)
    const cx = (lo[0] + hi[0]) / 2, cz = (lo[1] + hi[1]) / 2, sx = 2 * A / ((hi[0] - lo[0]) || 1), sz = 2 * A / ((hi[1] - lo[1]) || 1), sv = (sx + sz) / 2;
    P.forEach((q) => { q[0] = (q[0] - cx) * sx; q[1] *= sv; q[2] = (q[2] - cz) * sz; });
  };
  square(4.2); relax3(0.7); square(4.2); relax();
  const f2 = fit(), mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  P.forEach((q) => { for (let b = 0; b < 3; b++) { mn[b] = Math.min(mn[b], q[b]); mx[b] = Math.max(mx[b], q[b]); } });
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const gh = Math.ceil(Math.max(-mn[0], mx[0], -mn[2], mx[2]) * 2) / 2 + 0.5;
  return {
    pos: P.map((q) => [r3(q[0]), r3(q[1]), r3(q[2])]),
    CX: 700 - f2.cx * K, CY: 600 + f2.cy * K, fitZ: r3(f2.k * 0.95), floor: r3(mn[1] - 0.18),
    gx: [-gh, gh], gz: [-gh, gh],
  };
}
