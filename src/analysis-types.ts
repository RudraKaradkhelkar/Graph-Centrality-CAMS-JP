// Mirrors the dict returned by analyze() in metrics/carma_metrics.py. UI code reads only this result.
// Per-asset arrays are indexed like AnalysisResult.ids.

export type Dimension = '1d' | '2d';
export type Scope = 'direct' | 'blast';
export type Band = 'Low' | 'Medium' | 'High';
export type VariantKey = `${Dimension}-${Scope}-${'u' | 'w'}`;

export interface LinkRow {
  source: string;
  target: string;
  type: string;
  importance: number;
  source_importance: number;
  target_importance: number;
}

export interface AnalyzeOptions {
  direction?: 'out' | 'in' | 'both';
  depth?: number;
  /** Blast radius spreads along the links (Source -> Target) or against them. TODO(supervisor), question 9. */
  blast_direction?: 'follow' | 'against';
  edge_types?: string[] | null;
  k_from?: number;
  k_to?: number;
  front_order?: 'sum' | 'node' | 'edge' | 'id';
  assets?: { id: string; importance?: number }[] | null;
}

/** Rules that hide assets from the distribution chart's bars (bands never change). */
export type ExclusionRule =
  | { rule: 'zero' }
  | { rule: 'below' | 'above'; value: number }
  | { rule: 'range'; lo: number; hi: number; closed?: boolean }
  | { rule: 'front'; value: number };

/** Options for distribution() in carma_metrics.py. */
export interface ChartOptions {
  cuts?: [number, number] | null;
  scale?: 'linear' | 'log';
  bins?: number | null;
  exclude?: ExclusionRule[];
  zoom?: [number, number] | null;
  top?: number[];
}

export interface DistBar {
  lo: number;
  hi: number;
  count: number;
  top_count: number;
  excluded?: boolean;
}

/** Mirrors distribution() in carma_metrics.py: everything the chart draws, already counted. */
export interface Distribution {
  axis: 'score' | 'front';
  scale: 'linear' | 'log';
  domain: [number, number] | null;
  bars: DistBar[];
  zero_bar: (DistBar & { excluded: boolean }) | null;
  ticks: number[];
  /** Band cut-offs on the full range (what asset bands use). */
  cuts: [number, number];
  /** The chart's zone cut-offs: equal thirds of the assets still shown (re-split by exclusions and zoom). */
  zone_cuts: [number, number];
  zones: { band: Band; count: number }[];
  band: Band[];
  excluded: (ExclusionRule & { count: number })[];
  hidden: number;
  outside_zoom: number;
  shown: number;
  total: number;
  y_max: number;
  suggest_log: boolean;
}

interface VariantBase {
  key: VariantKey;
  dimension: Dimension;
  scope: Scope;
  weighted: boolean;
  label: string;
}

export interface PendingVariant extends VariantBase {
  status: 'pending';
  /** Variant whose ranks the UI shows while this one awaits the supervisor. */
  fallback: VariantKey;
}

export interface ReadyVariant extends VariantBase {
  status: 'ok';
  kind: 'scalar' | 'pareto';
  /** Normalized score (scalar variants only). */
  score: number[] | null;
  /** 2D degree tuple, raw and divided by (n - 1) (pareto variants only). */
  raw: [number, number][] | null;
  normalized: [number, number][] | null;
  front: number[] | null;
  /** Rank with ties (1D: competition ranking; 2D: Pareto front). */
  rank: number[];
  /** Asset indices, best first. */
  order: number[];
  /** Value behind sphere shading and size (2D: normalized-tuple sum). */
  sort_value: number[];
  band: Band[];
  shade_bin: number[];
  size: number[];
  top_k: number[];
  k_from: number;
  k_to: number;
  distribution: Distribution;
  summary: { top_share: number | null; range: [number, number] };
}

export type Variant = PendingVariant | ReadyVariant;

/** [asset index, parent index, link type index (into link_types), link importance] */
export type RingMember = [number, number, number, number];

export interface AnalysisResult {
  n: number;
  m: number;
  options: Required<Omit<AnalyzeOptions, 'assets'>>;
  ids: string[];
  importance: number[];
  out_links: number[];
  in_links: number[];
  edge_types: Record<string, number>;
  link_types: string[];
  warnings: { code: 'importance_conflict'; asset: string; values: number[]; used: number }[];
  variants: Record<VariantKey, Variant>;
  blast: { rings: RingMember[][]; high: number }[];
}
