// Graph inputs shared by the dashboard and the 1D vs 2D comparison: asset labels and names, the layout
// (computed once per network) and the per-variant scene (shading, size and Order come from analyze()).
import { useMemo } from 'react';
import type { AnalysisResult, ReadyVariant } from '../analysis-types';
import { shortName, type Dataset } from '../data/parse';
import { layout } from './layout';
import type { SceneData } from './scene';
import { seedLayout, type Lane } from './seed';

export function useNetworkView(result: AnalysisResult, ds: Dataset, laneByType: Record<string, Lane> | null) {
  const assetsById = useMemo(() => new Map(ds.assets.map((a) => [a.id, a])), [ds]);
  const names = useMemo(() => result.ids.map((id) => assetsById.get(id)?.name ?? id), [result.ids, assetsById]);
  // Graph and list label: the diagram abbreviation when the asset list has one, else the asset ID.
  const labels = useMemo(() => result.ids.map((id) => assetsById.get(id)?.abbr || id), [result.ids, assetsById]);

  // The layout uses every link (not the edge-type filter) so assets stay put while filtering.
  const geo = useMemo(() => {
    const rows = result.ids.map((id) => assetsById.get(id)!);
    return layout(ds.hasPositions
      ? { pos: rows.map((a) => [a.x!, a.y!, a.z!]), type: rows.map((a) => a.type || a.id.split('-')[0]) }
      : seedLayout(rows, ds.links, ds.hasTypes ? laneByType : null));
  }, [result.ids, assetsById, ds, laneByType]);

  // Links drawn on the graph: the ones the analysis used (after the edge-type filter).
  const edges = useMemo(() => {
    const index = new Map(result.ids.map((id, i) => [id, i]));
    const typeIndex = new Map(Object.keys(result.edge_types).map((t, i) => [t, i]));
    const keep = result.options.edge_types ? new Set(result.options.edge_types) : null;
    const E: number[] = [];
    ds.links.forEach((l) => {
      if (keep && !keep.has(l.type)) return;
      E.push(index.get(l.source)!, index.get(l.target)!, l.importance, typeIndex.get(l.type) ?? 0);
    });
    return E;
  }, [result, ds.links]);

  return { assetsById, names, labels, geo, edges };
}

export type NetworkView = ReturnType<typeof useNetworkView>;

/** Order position per asset (1 = best) for a ranking. */
export function useOrderPositions(V: ReadyVariant): number[] {
  return useMemo(() => { const p: number[] = []; V.order.forEach((a, i) => { p[a] = i + 1; }); return p; }, [V]);
}

/** Scene inputs for one ranking variant. */
export function useScene(view: NetworkView, result: AnalysisResult, V: ReadyVariant, posOf: number[]): SceneData {
  const { geo, names, labels, edges } = view;
  return useMemo<SceneData>(() => ({
    N: result.ids.map((_, i) => ({ id: labels[i], x: geo.pos[i][0], y: geo.pos[i][1], z: geo.pos[i][2], bin: V.shade_bin[i], pos: posOf[i], size: V.size[i], lv: result.importance[i] })),
    E: edges, NM: names.map((nm) => shortName(nm).text), rings: result.blast.map((b) => b.rings),
    CX: geo.CX, CY: geo.CY, FLOOR: geo.floor, GX: geo.gx, GZ: geo.gz,
  }), [geo, result, V, posOf, names, labels, edges]);
}
