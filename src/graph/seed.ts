// Starting positions for networks without X/Y/Z, laid out in the reference's lanes:
// top lane (like control), middle lane (like power, upstream on the left), right lane (like end devices).
// The ported _layout() (layout.ts) then spreads and relaxes these clusters exactly as for the sample.
import type { LinkRow } from '../analysis-types';
import type { AssetRow } from '../data/parse';
import type { LayoutInput } from './layout';

export type Lane = 'top' | 'middle' | 'right';

export const LANES: { id: Lane; label: string }[] = [
  { id: 'top', label: 'Top (like control)' },
  { id: 'middle', label: 'Middle (like power)' },
  { id: 'right', label: 'Right (like end devices)' },
];

/** Role of each asset: only sends links -> top; sends nothing (only receives, or unlinked) -> right; both -> middle. */
export function assetRoles(ids: string[], links: LinkRow[]): Lane[] {
  const out = new Map<string, number>(), inn = new Map<string, number>();
  links.forEach((l) => { out.set(l.source, (out.get(l.source) ?? 0) + 1); inn.set(l.target, (inn.get(l.target) ?? 0) + 1); });
  return ids.map((id) => (!out.get(id) ? 'right' : !inn.get(id) ? 'top' : 'middle'));
}

/** Lane per asset type: the role most of its assets have (ties go to the middle). */
export function defaultTypeLanes(assets: AssetRow[], links: LinkRow[]): Record<string, Lane> {
  const roles = assetRoles(assets.map((a) => a.id), links);
  const tally = new Map<string, Record<Lane, number>>();
  assets.forEach((a, i) => {
    const t = tally.get(a.type ?? '') ?? { top: 0, middle: 0, right: 0 };
    t[roles[i]]++;
    tally.set(a.type ?? '', t);
  });
  const out: Record<string, Lane> = {};
  for (const [type, t] of tally) {
    const best = Math.max(t.top, t.middle, t.right);
    out[type] = t.middle === best ? 'middle' : t.top === best ? 'top' : 'right';
  }
  return out;
}

/** Hops from the nearest top-lane asset along the links (0 for unreachable assets). */
function flowLevels(ids: string[], links: LinkRow[], roles: Lane[]): number[] {
  const index = new Map(ids.map((id, i) => [id, i]));
  const next: number[][] = ids.map(() => []);
  links.forEach((l) => next[index.get(l.source)!]?.push(index.get(l.target)!));
  const level = ids.map(() => -1);
  let frontier = roles.flatMap((r, i) => (r === 'top' ? [i] : []));
  frontier.forEach((i) => { level[i] = 0; });
  for (let h = 1; frontier.length; h++) {
    const nf: number[] = [];
    for (const u of frontier) for (const v of next[u]) if (level[v] < 0) { level[v] = h; nf.push(v); }
    frontier = nf;
  }
  return level.map((l) => Math.max(0, l));
}

const GA = Math.PI * (3 - Math.sqrt(5));
const LANE_GEOMETRY: Record<Lane, { from: [number, number]; to: [number, number] }> = {
  // [x, y] at the start and end of each lane, in the reference's world units.
  top: { from: [-2.8, 1.0], to: [0.8, 1.0] },
  middle: { from: [-2.8, -0.55], to: [1.2, -0.55] },
  right: { from: [2.4, -0.6], to: [2.4, 1.0] },
};

/**
 * Deterministic starting positions. With asset types, each type is one cluster placed in its lane; without,
 * each role is one cluster and the middle lane is ordered left to right by distance from the senders.
 */
export function seedLayout(assets: AssetRow[], links: LinkRow[], laneByType: Record<string, Lane> | null): LayoutInput {
  const ids = assets.map((a) => a.id);
  const roles = assetRoles(ids, links);
  const level = flowLevels(ids, links, roles);
  const maxLevel = Math.max(1, ...level);
  const byType = laneByType != null;
  const group = assets.map((a, i) => (byType ? `type:${a.type ?? ''}` : `role:${roles[i]}`));
  const laneOf = (g: string): Lane => (byType ? laneByType![g.slice(5)] ?? 'middle' : (g.slice(5) as Lane));

  const members = new Map<string, number[]>();
  group.forEach((g, i) => (members.get(g) ?? members.set(g, []).get(g)!).push(i));
  const meanLevel = (g: string) => members.get(g)!.reduce((s, i) => s + level[i], 0) / members.get(g)!.length;
  const centre = new Map<string, [number, number]>();
  for (const lane of ['top', 'middle', 'right'] as Lane[]) {
    const gs = [...members.keys()].filter((g) => laneOf(g) === lane).sort((a, b) => meanLevel(a) - meanLevel(b) || (a < b ? -1 : 1));
    const { from, to } = LANE_GEOMETRY[lane];
    gs.forEach((g, k) => {
      const t = (k + 0.5) / gs.length;
      centre.set(g, [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
    });
  }

  const pos: [number, number, number][] = ids.map(() => [0, 0, 0]);
  let gi = 0;
  for (const [g, idx] of members) {
    // One-asset clusters get their own depth (_layout spreads only around cluster centres), so the floor
    // never collapses to zero depth and the graph is not stretched tall.
    const lone = (((gi++ * 0.618034) % 1) - 0.5) * 4;
    const [cx, cy] = centre.get(g)!;
    const rMax = Math.max(0.15, 0.09 * Math.sqrt(idx.length));
    const spreadByLevel = !byType && laneOf(g) === 'middle';
    idx.forEach((i, m) => {
      const r = idx.length === 1 ? 0 : rMax * Math.sqrt((m + 0.5) / idx.length), ph = m * GA;
      const dy = (((m * 0.618034) % 1) - 0.5) * 0.3;
      const x = spreadByLevel
        ? LANE_GEOMETRY.middle.from[0] + (LANE_GEOMETRY.middle.to[0] - LANE_GEOMETRY.middle.from[0]) * level[i] / maxLevel + 0.3 * r * Math.cos(ph)
        : cx + 0.8 * r * Math.cos(ph);
      pos[i] = [x, cy + dy, idx.length === 1 ? lone : r * Math.sin(ph)];
    });
  }
  // _layout() squares the floor and scales height by the same factor, so a network that doesn't span the
  // lanes' full width would come out stretched tall. Spread the starting x across the reference width.
  const xs = pos.map((p) => p[0]), lo = Math.min(...xs), hi = Math.max(...xs);
  const X0 = LANE_GEOMETRY.top.from[0], X1 = LANE_GEOMETRY.right.from[0];
  if (hi > lo) pos.forEach((p) => { p[0] = X0 + (p[0] - lo) / (hi - lo) * (X1 - X0); });
  return { pos, type: group };
}
