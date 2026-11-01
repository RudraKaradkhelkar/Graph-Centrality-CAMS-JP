"""CARMA metrics: every number the app shows is calculated here and nowhere else.

Python 3 + NetworkX only (no numpy/pandas/scipy). Pure functions: no I/O, plotting, layout or styling.
The same file runs in the browser (Pyodide, src/metrics-worker.ts) and in Jupyter.

One entry point: analyze(links, options) -> dict (JSON-serialisable). src/analysis-types.ts mirrors it.

Encoding: importance Low/Medium/High = 1/2/3 for assets and links, never rescaled.
Normalization: every degree value is divided by (n - 1), n = number of assets.
"""

from __future__ import annotations

import math

import networkx as nx


# =============================================================================
# 2D RANKING (degree centrality with node and edge weights, Pareto degree ranking)
# Every 2D view reads from score2d(). Changing it updates all of them; nothing else computes 2D.
# =============================================================================

def score2d(G: nx.DiGraph, ids: list[str], direction: str = "both", weighted: bool = True,
            front_order: str = "node") -> dict:
    """Rank assets by Pareto dominance on their 2D degree tuple.

    Each link e = (a, b) carries the 2-vector ((I_a + I_b) / 2, w_e), where I is asset importance and
    w is link importance (1-3). An asset's degree tuple is the component-wise sum over its links:
    (node-importance-weighted degree, edge-importance-weighted degree). The normalized tuple divides
    both components by (n - 1). The second component equals the 1D weighted degree.

    weighted=False switches only link importance off: the edge component counts links instead.
    TODO(supervisor): deferred question 7, definition of 2D unweighted.

    Assets are ranked by non-dominated sorting (pareto_fronts()); rank = front (1 = best).
    Order within a front (deferred question 1): larger node-importance degree first, then asset ID. This
    reproduces the Order column of the supervisor's Case 4 reference table (every asset); "sum", "edge" and "id"
    stay available as options.
    """
    raw = []
    for node in ids:
        node_part = edge_part = 0.0
        for a, b, data in _links(G, node, direction):
            node_part += (G.nodes[a]["importance"] + G.nodes[b]["importance"]) / 2
            edge_part += data["importance"] if weighted else 1
        raw.append((node_part, edge_part))
    return pareto_from_raw(raw, ids, front_order)


def pareto_from_raw(raw: list[tuple[float, float]], ids: list[str], front_order: str = "node") -> dict:
    """Normalize raw 2D tuples by (n - 1) and rank them by Pareto fronts."""
    den = max(len(ids) - 1, 1)
    normalized = [(x / den, y / den) for x, y in raw]
    fronts, order = pareto_rank(normalized, ids, front_order)
    return {"raw": raw, "normalized": normalized, "front": fronts, "order": order}


def pareto_rank(tuples: list[tuple[float, float]], ids: list[str], front_order: str = "node") -> tuple[list[int], list[int]]:
    """Pareto front per asset and the Order (asset indices, best first) for 2D degree tuples.

    Order = front, then within a front by `front_order` (deferred question 1; "node" matches the reference):
    "node" / "edge" = larger node / edge component first, "sum" = larger tuple sum first, "id" = none;
    remaining ties by asset ID. Works on raw or normalized tuples alike (dividing by n - 1 keeps the order).
    """
    fronts = pareto_fronts(tuples)

    def within_front(i):
        x, y = tuples[i]
        primary = {"sum": -(x + y), "node": -x, "edge": -y, "id": 0}[front_order]
        return (fronts[i], round(primary, 9), ids[i])

    return fronts, sorted(range(len(ids)), key=within_front)


def pareto_fronts(points: list[tuple[float, float]]) -> list[int]:
    """Front index per point (1 = not dominated by any point), by fast non-dominated sorting.

    x dominates y if x_i >= y_i in both components and x_i > y_i in at least one
    (strong: greater in both; weak: equal in one). Points where neither dominates share a front.
    """
    n = len(points)
    dominated_by_count = [0] * n
    dominates_list = [[] for _ in range(n)]
    for i in range(n):
        xi, yi = points[i]
        for j in range(i + 1, n):
            # dominates() inlined: this loop is O(n^2) and runs for every analysis.
            xj, yj = points[j]
            if xi >= xj and yi >= yj:
                if xi > xj or yi > yj:
                    dominates_list[i].append(j)
                    dominated_by_count[j] += 1
            elif xj >= xi and yj >= yi:
                dominates_list[j].append(i)
                dominated_by_count[i] += 1
    fronts = [0] * n
    current = [i for i in range(n) if dominated_by_count[i] == 0]
    front = 1
    while current:
        nxt = []
        for i in current:
            fronts[i] = front
            for j in dominates_list[i]:
                dominated_by_count[j] -= 1
                if dominated_by_count[j] == 0:
                    nxt.append(j)
        current = nxt
        front += 1
    return fronts


def dominates(x: tuple[float, float], y: tuple[float, float]) -> bool:
    return x[0] >= y[0] and x[1] >= y[1] and (x[0] > y[0] or x[1] > y[1])


# =============================================================================
# Entry point
# =============================================================================

DEFAULT_OPTIONS = {
    # Supervisor's answer: centrality counts an asset's incoming and outgoing links. A pair A -> B and B -> A
    # counts as two links. "out" / "in" stay available (the V3 reference used "out").
    "direction": "both",         # "out" | "in" | "both": which links count as an asset's links
    "depth": 2,                  # blast radius depth, 1-4 hops
    # TODO(supervisor): deferred question 9, which way a disruption spreads. "follow": along the links
    # (Source -> Target, the target depends on the source); "against": backwards (the source depends on the target).
    "blast_direction": "follow",
    "edge_types": None,          # None = all link types; else only these types are analysed
    "k_from": 1,                 # highlighted rank range (top-k = k_from..k_to by Order)
    "k_to": 10,
    "front_order": "node",       # order within a Pareto front; "node" reproduces the supervisor's reference table
    # Optional [{"id", "importance"?}]: fixes asset order. Assets without links still count in n.
    # TODO(supervisor): deferred question 8, whether unlinked assets count in n (the golden test checks it).
    "assets": None,
}

VARIANT_KEYS = [
    f"{dim}-{scope}-{w}" for scope in ("direct", "blast") for dim in ("1d", "2d") for w in ("u", "w")
]


def analyze(links: list[dict], options: dict | None = None) -> dict:
    """Everything the UI needs, for all 8 degree variants (1D/2D x direct/blast radius x unweighted/weighted).

    links: [{"source", "target", "type", "importance", "source_importance", "target_importance"}]
    Per-asset arrays are indexed like result["ids"].
    """
    opts = {**DEFAULT_OPTIONS, **(options or {})}
    if opts["direction"] not in ("out", "in", "both"):
        raise ValueError(f"Unknown direction: {opts['direction']}")
    if opts["blast_direction"] not in ("follow", "against"):
        raise ValueError(f"Unknown blast direction: {opts['blast_direction']}")
    if not 1 <= int(opts["depth"]) <= 4:
        raise ValueError("Depth must be 1 to 4 hops.")
    opts["depth"] = int(opts["depth"])

    full, ids, warnings = build_graph(links, opts["assets"])
    edge_type_counts = {}
    edge_type_assets = {}  # assets at either end of at least one link of the type
    for a, b, data in full.edges(data=True):
        edge_type_counts[data["type"]] = edge_type_counts.get(data["type"], 0) + 1
        edge_type_assets.setdefault(data["type"], set()).update((a, b))
    G = filter_edge_types(full, opts["edge_types"])
    n = len(ids)
    if n < 2:
        raise ValueError("The network needs at least 2 assets.")

    adj = spread_adjacency(G, opts["blast_direction"])
    reach = [blast_reach(adj, node, opts["depth"]) for node in ids]
    decay = [blast_decay(adj, node, opts["depth"]) for node in ids]
    direct2d = {}
    index = {node: i for i, node in enumerate(ids)}
    type_index = {t: i for i, t in enumerate(edge_type_counts)}

    variants = {}
    for key in VARIANT_KEYS:
        dim, scope, w = key.split("-")
        weighted = w == "w"
        if dim == "1d" and scope == "direct":
            sums = degree1d(G, ids, opts["direction"], weighted)
            variant = scalar_variant([s / (n - 1) for s in sums], ids, exact=sums)
        elif dim == "1d":
            variant = scalar_variant(blast1d(ids, weighted, reach, decay), ids)
        elif scope == "direct":
            direct2d[w] = score2d(G, ids, opts["direction"], weighted, opts["front_order"])
            variant = pareto_variant(direct2d[w])
        else:
            variant = pareto_variant(blast2d(ids, direct2d[w]["raw"], weighted, reach, decay, opts["front_order"]))
        variant.update({"key": key, "dimension": dim, "scope": scope, "weighted": weighted,
                        "label": variant_label(dim, scope, weighted, opts["depth"], opts["blast_direction"])})
        if variant.get("status") != "pending":
            variant["status"] = "ok"
            add_display(variant, opts["k_from"], opts["k_to"])
        variants[key] = variant

    return {
        "n": n,
        "m": G.number_of_edges(),
        "options": {k: v for k, v in opts.items() if k != "assets"},
        "ids": ids,
        "importance": [G.nodes[node]["importance"] for node in ids],
        "out_links": [G.out_degree(node) for node in ids],
        "in_links": [G.in_degree(node) for node in ids],
        "edge_types": edge_type_counts,
        "edge_type_assets": {t: len(s) for t, s in edge_type_assets.items()},
        "link_types": list(edge_type_counts),
        "warnings": warnings,
        "variants": variants,
        # Compact on purpose (large networks): each ring member is [asset, parent, link type index, importance],
        # with asset/parent as indices into ids and the link type as an index into link_types.
        "blast": [
            {
                "rings": [[[index[a], index[p], type_index[kind], w] for a, p, kind, w in ring] for ring in rings],
                "high": sum(1 for ring in rings for a, _, _, _ in ring if G.nodes[a]["importance"] == 3),
            }
            for rings in reach
        ],
    }


# =============================================================================
# Graph construction
# =============================================================================

def build_graph(links: list[dict], assets: list[dict] | None) -> tuple[nx.DiGraph, list[str], list[dict]]:
    """nx.DiGraph with node attribute importance and edge attributes importance, type, idx (row order).

    Duplicate Source -> Target pairs and self-links raise ValueError (the structure check blocks them).
    An asset given different importance values on different rows uses the highest, with a warning.
    """
    G = nx.DiGraph()
    ids: list[str] = []
    seen: dict[str, set] = {}

    def add_asset(node, value):
        if node not in seen:
            seen[node] = set()
            ids.append(node)
            G.add_node(node, importance=0)
        if value is not None:
            seen[node].add(int(value))
            G.nodes[node]["importance"] = max(G.nodes[node]["importance"], int(value))

    for a in assets or []:
        add_asset(str(a["id"]), a.get("importance"))
    for idx, link in enumerate(links):
        s, t = str(link["source"]), str(link["target"])
        if s == t:
            raise ValueError(f"Row {idx + 1}: {s} links to itself.")
        if G.has_edge(s, t):
            raise ValueError(f"Row {idx + 1}: duplicate link {s} -> {t}.")
        add_asset(s, link.get("source_importance"))
        add_asset(t, link.get("target_importance"))
        G.add_edge(s, t, importance=int(link["importance"]), type=str(link.get("type", "")), idx=idx)

    warnings = [
        {"code": "importance_conflict", "asset": node, "values": sorted(values), "used": max(values)}
        for node, values in seen.items() if len(values) > 1
    ]
    return G, ids, warnings


def filter_edge_types(G: nx.DiGraph, edge_types) -> nx.DiGraph:
    """Drop links whose type is not listed. Every asset stays, so n is unchanged."""
    if edge_types is None:
        return G
    keep = set(edge_types)
    H = nx.DiGraph()
    H.add_nodes_from(G.nodes(data=True))
    H.add_edges_from((a, b, d) for a, b, d in G.edges(data=True) if d["type"] in keep)
    return H


def spread_adjacency(G: nx.DiGraph, direction: str = "follow") -> dict[str, list[tuple[str, int, str, int]]]:
    """Where a disruption of each asset spreads next, as (asset, link importance, type, row) tuples.
    "follow" walks links Source -> Target, "against" walks them backwards. Read from the graph once
    so the blast-radius loops avoid NetworkX view overhead."""
    nbrs = G.succ if direction == "follow" else G.pred
    return {u: [(t, d["importance"], d["type"], d["idx"]) for t, d in nbrs[u].items()] for u in G}


def _links(G: nx.DiGraph, node: str, direction: str):
    if direction in ("out", "both"):
        yield from G.out_edges(node, data=True)
    if direction in ("in", "both"):
        yield from G.in_edges(node, data=True)


# =============================================================================
# 1D degree
# =============================================================================

def degree1d(G: nx.DiGraph, ids: list[str], direction: str, weighted: bool) -> list[float]:
    """Raw 1D degree: number of links (unweighted) or sum of link importance (weighted).
    Divide by (n - 1) for the normalized score."""
    return [sum(d["importance"] if weighted else 1 for _, _, d in _links(G, node, direction)) for node in ids]


# =============================================================================
# Blast radius (by default downstream: a link Source -> Target means the target depends on the source)
# =============================================================================

def blast_reach(adj: dict, source: str, depth: int) -> list[list[tuple[str, str, str, int]]]:
    """Assets affected by a disruption of `source`, grouped by ring (ring h = first reached at hop h).

    Each member is (asset, parent, link type, link importance). The parent is the asset in the previous ring
    with the highest-importance link to it (ties: earliest link row). Rings are ordered by the earliest link
    row that reaches each member.
    """
    rings = []
    seen = {source}
    frontier = [source]
    for _ in range(depth):
        found: dict[str, list] = {}  # asset -> [parent, type, importance, first row, best row]
        for u in frontier:
            for t, w, kind, idx in adj[u]:
                if t in seen:
                    continue
                cur = found.get(t)
                if cur is None:
                    found[t] = [u, kind, w, idx, idx]
                    continue
                if idx < cur[3]:
                    cur[3] = idx
                if w > cur[2] or (w == cur[2] and idx < cur[4]):
                    cur[0], cur[1], cur[2], cur[4] = u, kind, w, idx
        if not found:
            break
        rings.append([(t, f[0], f[1], f[2]) for t, f in sorted(found.items(), key=lambda kv: kv[1][3])])
        seen.update(found)
        frontier = list(found)
    return rings


def blast_decay(adj: dict, source: str, depth: int) -> dict[str, float]:
    """For every asset within `depth` hops of `source`: the strongest path's product of (link importance / 3)
    per hop. The /3 is a per-hop decay (a High link passes the full disruption on), not a rescale."""
    best = {source: 1.0}
    frontier = {source: 1.0}
    for _ in range(depth):
        improved: dict[str, float] = {}
        for u, value in frontier.items():
            for t, w, _, _ in adj[u]:
                v = value * w / 3
                if t != source and v > best.get(t, 0) and v > improved.get(t, 0):
                    improved[t] = v
        for t, v in improved.items():
            best[t] = max(best.get(t, 0), v)
        frontier = improved
    del best[source]
    return best


def blast1d(ids: list[str], weighted: bool, reach: list, decay: list) -> list[float]:
    """1D blast-radius degree, normalized by (n - 1).

    Unweighted: number of assets within the blast radius.
    Weighted: sum over those assets of their blast_decay() factor.
    TODO(supervisor): deferred question 6, this is the V3 reference definition kept as a temporary default.
    """
    den = len(ids) - 1
    if not weighted:
        return [sum(len(ring) for ring in rings) / den for rings in reach]
    return [sum(d.values()) / den for d in decay]


def blast2d(ids: list[str], direct_raw: list, weighted: bool, reach: list, decay: list, front_order: str = "node") -> dict:
    """2D blast-radius degree tuple (supervisor's answer to deferred question 2): every asset within the blast
    radius adds its own 2D direct tuple (same weighting), weakened by its blast_decay() factor when weighted and
    in full when unweighted, as in the 1D recipe. The asset itself is not counted. Normalized by (n - 1) and
    ranked by Pareto fronts like 2D direct."""
    index = {node: i for i, node in enumerate(ids)}
    raw = []
    for i in range(len(ids)):
        hits = decay[i].items() if weighted else ((m[0], 1.0) for ring in reach[i] for m in ring)
        x = y = 0.0
        for t, f in hits:
            a, b = direct_raw[index[t]]
            x += a * f
            y += b * f
        raw.append((x, y))
    return pareto_from_raw(raw, ids, front_order)


# =============================================================================
# Ranking, bands and display values
# =============================================================================

def scalar_variant(scores: list[float], ids: list[str], exact: list | None = None) -> dict:
    """Order = score descending, then asset ID. Equal scores share a rank (competition ranking: 1, 2, 2, 4).
    `exact` (integer sums) avoids float noise when deciding ties; otherwise scores are compared at 1e-9."""
    keys = exact if exact is not None else [round(s, 9) for s in scores]
    order = sorted(range(len(ids)), key=lambda i: (-keys[i], ids[i]))
    rank = [0] * len(ids)
    for pos, i in enumerate(order):
        prev = order[pos - 1] if pos else None
        rank[i] = rank[prev] if prev is not None and keys[prev] == keys[i] else pos + 1
    return {"kind": "scalar", "score": scores, "order": order, "rank": rank, "front": None,
            "raw": None, "normalized": None, "sort_value": scores}


def pareto_variant(s2: dict) -> dict:
    return {"kind": "pareto", "score": None, "order": s2["order"], "rank": s2["front"], "front": s2["front"],
            "raw": [list(t) for t in s2["raw"]], "normalized": [list(t) for t in s2["normalized"]],
            # The normalized-tuple sum drives sphere shading and size in 2D.
            "sort_value": [x + y for x, y in s2["normalized"]]}


def default_cuts(values: list[float]) -> list[float]:
    """Two cut-offs splitting [min, max] into three equal intervals."""
    lo, hi = min(values), max(values)
    return [lo + (hi - lo) / 3, lo + 2 * (hi - lo) / 3]


def bands(values: list[float], axis: str = "score", cuts: list[float] | None = None) -> list[str]:
    """Low / Medium / High per asset from two cut-offs (default: equal thirds of [min, max]).

    Scores: below the first cut Low, from it Medium, from the second High. Pareto fronts (lower is better):
    up to the first cut High, up to the second Medium, beyond it Low. All values equal: all Medium.
    Asset bands come from the full range and never follow chart exclusions or zoom (deferred question 4,
    answered); the chart's own zones do (see distribution()).
    """
    if not cuts and max(values) == min(values):
        return ["Medium"] * len(values)
    a, b = sorted(cuts) if cuts else default_cuts(values)
    if axis == "score":
        return ["High" if v >= b else "Medium" if v >= a else "Low" for v in values]
    return ["High" if v <= a else "Medium" if v <= b else "Low" for v in values]


def add_display(variant: dict, k_from: int, k_to: int) -> None:
    """Bands, sphere shading/size, top-k, histogram and summary for one variant."""
    values = variant["sort_value"]
    n = len(values)
    order = variant["order"]

    # Sphere shading: 4 bins split at the 50th, 75th and 90th percentile (linear interpolation).
    srt = sorted(values)

    def quantile(q):
        p = q * (n - 1)
        lo = int(p)
        return srt[lo] + (srt[min(n - 1, lo + 1)] - srt[lo]) * (p - lo)

    cuts = [quantile(q) for q in (0.5, 0.75, 0.9)]
    variant["shade_bin"] = [sum(1 for c in cuts if v > c) for v in values]
    vmax = values[order[0]] or 1
    variant["size"] = [round((v / vmax) ** 0.8, 3) if v > 0 else 0.0 for v in values]

    k_from = max(1, min(int(k_from), n))
    k_to = max(k_from, min(int(k_to), n))
    top = order[k_from - 1:k_to]
    variant["top_k"] = top
    variant["k_from"], variant["k_to"] = k_from, k_to
    axis_values, axis = (variant["score"], "score") if variant["kind"] == "scalar" else (variant["front"], "front")
    variant["distribution"] = distribution(axis_values, axis, {"top": top})
    variant["band"] = variant["distribution"]["band"]
    variant["summary"] = summary(variant, top)


# =============================================================================
# Distribution chart: every count the chart shows is made here; the chart only draws.
# =============================================================================

DEFAULT_CHART = {"cuts": None, "scale": "linear", "bins": None, "exclude": [], "zoom": None, "top": []}


def distribution(values: list[float], axis: str = "score", options: dict | None = None) -> dict:
    """Bars, zones, ticks and exclusion counts for the distribution chart, plus each asset's band.

    Two kinds of Low / Medium / High: `band` (per asset, equal thirds of the full range; what lists show) and the
    chart's zones (equal thirds of the assets still shown after exclusions and zoom, so they re-split as you
    magnify). Cut-offs are always calculated, never set by hand.

    values: one per asset (1D: normalized score; 2D: Pareto front). axis: "score" or "front".
    options:
      cuts     [a, b] band cut-offs in value units (default: equal thirds of the full range; the app never sets it)
      scale    "linear" or "log" (x axis; fronts too); zero scores always get their own "0" bar
      bins     number of equal-width bins (scores default: Rice rule 2 * n^(1/3), 6-30; fronts default: one per front)
      exclude  rules hiding assets from the bars, applied in order, each counted once:
               {"rule": "zero"}, {"rule": "below", "value": x}, {"rule": "above", "value": x},
               {"rule": "range", "lo": a, "hi": b, "closed": bool} (one bar), {"rule": "front", "value": f}
      zoom     [lo, hi] value range to magnify; assets outside it are counted, not drawn
      top      asset indices of the highlighted top-k range
    """
    o = {**DEFAULT_CHART, **(options or {})}
    n = len(values)
    cuts = sorted(o["cuts"]) if o["cuts"] else default_cuts(values)
    band = bands(values, axis, o["cuts"])
    top = set(o["top"])

    def hit(rule: dict, v: float) -> bool:
        r = rule["rule"]
        if r == "zero":
            return v == 0
        if r == "below":
            return v < rule["value"]
        if r == "above":
            return v > rule["value"]
        if r == "range":
            return rule["lo"] <= v < rule["hi"] or (rule.get("closed") and v == rule["hi"])
        if r == "front":
            return v == rule["value"]
        raise ValueError(f"Unknown exclusion rule: {r}")

    hidden = [False] * n
    excluded = []
    for rule in o["exclude"]:
        newly = [i for i in range(n) if not hidden[i] and hit(rule, values[i])]
        for i in newly:
            hidden[i] = True
        excluded.append({**rule, "count": len(newly)})
    visible = [i for i in range(n) if not hidden[i]]
    zoom = o["zoom"]
    shown = [i for i in visible if zoom is None or zoom[0] <= values[i] <= zoom[1]]

    def bar(lo, hi, members):
        return {"lo": lo, "hi": hi, "count": len(members), "top_count": sum(1 for i in members if i in top)}

    zero_bar = None
    suggest_log = False
    scale = o["scale"]
    if axis == "score":
        if any(v == 0 for v in values):
            zeros = [i for i in shown if values[i] == 0]
            zero_bar = {**bar(0.0, 0.0, zeros), "excluded": any(e["rule"] == "zero" for e in o["exclude"])}
        pos = [i for i in shown if values[i] > 0]
        bars, domain, ticks = [], None, []
        if pos:
            pv = [values[i] for i in pos]
            suggest_log = max(pv) / min(pv) >= 100
            nb = int(o["bins"] or max(6, min(30, round(2 * len(pv) ** (1 / 3)))))
            log = scale == "log"
            # Linear bins start at 0 unless zoom or a below/range exclusion has cut the low end away.
            cut_low = zoom is not None or any(e["rule"] in ("below", "range") and e["count"] for e in excluded)
            lo = zoom[0] if zoom and zoom[0] > 0 else (min(pv) if log or cut_low else 0.0)
            hi = zoom[1] if zoom else max(pv)
            tx = (lambda v: math.log10(v)) if log else (lambda v: v)
            a, b = tx(lo), tx(hi)
            if b <= a:
                b = a + (1 if log else max(abs(a) * 0.1, 1e-9))
            width = (b - a) / nb
            groups = [[] for _ in range(nb)]
            for i in pos:
                groups[max(0, min(nb - 1, int((tx(values[i]) - a) / width)))].append(i)
            back = (lambda x: 10 ** x) if log else (lambda x: x)
            bars = [bar(back(a + k * width), back(a + (k + 1) * width), g) for k, g in enumerate(groups)]
            domain = [back(a), back(b)]
            ticks = log_ticks(domain) if log else nice_ticks(domain)
    else:
        fs = [int(values[i]) for i in shown]
        bars, domain, ticks = [], None, []
        if fs:
            f_lo, f_hi = (max(min(fs), int(zoom[0])), min(max(fs), int(zoom[1]))) if zoom else (min(fs), max(fs))
            for g_lo, g_hi in front_groups(f_lo, f_hi, o["bins"], scale == "log"):
                members = [i for i in shown if g_lo <= int(values[i]) <= g_hi]
                # Excluded: every asset on these fronts is hidden by an exclusion rule (drawn as an empty outline).
                on_fronts = [i for i in range(n) if g_lo <= int(values[i]) <= g_hi]
                gone = bool(on_fronts) and all(hidden[i] for i in on_fronts)
                bars.append({**bar(g_lo, g_hi, members), "excluded": gone})
            domain = [f_lo, f_hi]
            if scale == "log":
                ticks = [int(t) for t in log_ticks(domain)] if f_hi > f_lo else [f_lo]
            else:
                step = max(1, math.ceil((f_hi - f_lo + 1) / 12))
                ticks = list(range(f_lo, f_hi + 1, step))

    # Chart zones: equal thirds of the shown assets' range, so they re-split as bars are excluded or zoomed.
    shown_values = [values[i] for i in shown]
    zone_cuts = default_cuts(shown_values) if shown_values else cuts
    zone_band = bands(shown_values, axis) if shown_values else []
    zones = [{"band": name, "count": zone_band.count(name)} for name in ("Low", "Medium", "High")]
    counts = [b["count"] for b in bars] + ([zero_bar["count"]] if zero_bar else [])
    return {
        "axis": axis, "scale": scale, "domain": domain, "bars": bars, "zero_bar": zero_bar, "ticks": ticks,
        "cuts": cuts, "zone_cuts": zone_cuts, "zones": zones, "band": band, "excluded": excluded,
        "hidden": n - len(visible), "outside_zoom": len(visible) - len(shown), "shown": len(shown), "total": n,
        "y_max": max(counts) if counts else 0, "suggest_log": suggest_log,
    }


def front_groups(lo: int, hi: int, bins: int | None, log: bool) -> list[tuple[int, int]]:
    """Consecutive front ranges [a, b] drawn as one bar each: one per front by default, or exactly `bins` groups.

    Front f spans [f, f + 1) on the axis (linear, or log10 when `log`); group edges split that span into equal widths
    and snap to the nearest front, keeping every group at least one front wide."""
    count = hi - lo + 1
    if not bins or bins >= count:
        return [(f, f) for f in range(lo, hi + 1)]
    bins = max(1, int(bins))
    tx, back = (math.log10, lambda x: 10 ** x) if log else ((lambda v: v), (lambda x: x))
    a, b = tx(lo), tx(hi + 1)
    starts = [lo]
    for k in range(1, bins):
        edge = math.floor(back(a + k * (b - a) / bins) + 0.5)
        starts.append(min(max(edge, starts[-1] + 1), hi - (bins - 1 - k)))
    return [(s, (starts[k + 1] - 1) if k + 1 < bins else hi) for k, s in enumerate(starts)]


def nice_ticks(domain: list[float], target: int = 5) -> list[float]:
    """Evenly spaced ticks on 1, 2, 2.5 or 5 times a power of ten (uniform intervals)."""
    lo, hi = domain
    span = hi - lo
    if span <= 0:
        return [lo]
    raw = span / target
    mag = 10 ** math.floor(math.log10(raw))
    step = next(m * mag for m in (1, 2, 2.5, 5, 10) if m * mag >= raw)
    first = math.ceil(lo / step - 1e-9) * step
    out, k = [], 0
    while first + k * step <= hi + 1e-12:
        out.append(round(first + k * step, 12))
        k += 1
    return out


def log_ticks(domain: list[float]) -> list[float]:
    """Powers of ten inside the domain (with 2x and 5x steps when it spans less than two decades)."""
    lo, hi = domain
    out = []
    for e in range(math.floor(math.log10(lo)), math.ceil(math.log10(hi)) + 1):
        for m in ((1,) if math.log10(hi / lo) >= 2 else (1, 2, 5)):
            v = m * 10 ** e
            if lo * (1 - 1e-9) <= v <= hi * (1 + 1e-9):
                out.append(v)
    return out


def summary(variant: dict, top: list[int]) -> dict:
    if variant["kind"] == "scalar":
        scores = variant["score"]
        total = sum(scores)
        sel = [scores[i] for i in top]
        return {"top_share": (sum(sel) / total) if total else 0.0, "range": [min(sel), max(sel)]}
    fronts = [variant["front"][i] for i in top]
    return {"top_share": None, "range": [min(fronts), max(fronts)]}


def variant_label(dim: str, scope: str, weighted: bool, depth: int, blast_direction: str = "follow") -> str:
    base = f"{dim.upper()} ({'weighted' if weighted else 'unweighted'})"
    if scope == "direct":
        return base
    against = ", against links" if blast_direction == "against" else ""
    return f"{base}, blast radius ({depth} {'hop' if depth == 1 else 'hops'}{against})"
