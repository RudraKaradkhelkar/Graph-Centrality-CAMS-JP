import json
from pathlib import Path

import pytest

from carma_metrics import analyze, bands, distribution, dominates, pareto_fronts, pareto_rank

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "reference_1d.json").read_text(encoding="utf-8"))


def link(s, t, w, si=1, ti=1, kind="Power"):
    return {"source": s, "target": t, "type": kind, "importance": w, "source_importance": si, "target_importance": ti}


# Small hand-checked network, n = 4 so every value is divided by 3.
#   A -> B (w 3), A -> C (w 1), B -> C (w 2), C -> D (w 2); importance A 3, B 2, C 1, D 1
# Centrality counts incoming and outgoing links (supervisor's answer).
SMALL = [link("A", "B", 3, 3, 2), link("A", "C", 1, 3, 1), link("B", "C", 2, 2, 1), link("C", "D", 2, 1, 1)]


# --- Pareto dominance (CLAUDE.md test cases) --------------------------------

def test_strong_dominance():
    assert dominates((3, 4), (1, 2))


def test_weak_dominance():
    assert dominates((3, 2), (1, 2))
    assert not dominates((1, 2), (1, 2))


def test_incomparable_points_share_a_front():
    assert not dominates((1, 3), (2, 1)) and not dominates((2, 1), (1, 3))
    assert pareto_fronts([(1, 3), (2, 1)]) == [1, 1]


def test_fronts_peel_in_layers():
    assert pareto_fronts([(3, 4), (1, 3), (2, 1), (0, 0), (3, 4)]) == [1, 2, 2, 3, 1]


# --- Normalization and degree definitions ------------------------------------

def test_1d_divides_by_n_minus_1_without_rescaling():
    r = analyze(SMALL)
    assert r["ids"] == ["A", "B", "C", "D"]
    w, u = r["variants"]["1d-direct-w"]["score"], r["variants"]["1d-direct-u"]["score"]
    # Both ways: A 3+1, B 3+2, C 1+2+2, D 2 (weighted); A 2, B 2, C 3, D 1 links.
    assert w == pytest.approx([4 / 3, 5 / 3, 5 / 3, 2 / 3])
    assert u == pytest.approx([2 / 3, 2 / 3, 1, 1 / 3])


def test_2d_tuple_and_normalization():
    v = analyze(SMALL)["variants"]["2d-direct-w"]
    # A: links A-B (3+2)/2 + A-C (3+1)/2 = 4.5 node part, 3 + 1 = 4 edge part
    assert v["raw"][0] == pytest.approx([4.5, 4])
    assert v["normalized"][0] == pytest.approx([1.5, 4 / 3])
    # B: A-B 2.5 + B-C 1.5 = 4, edge 5; C: 2 + 1.5 + 1 = 4.5, edge 5; D: 1, 2.
    assert v["raw"][1] == pytest.approx([4, 5]) and v["raw"][2] == pytest.approx([4.5, 5]) and v["raw"][3] == pytest.approx([1, 2])
    # C dominates A and B; A and B are incomparable (front 2, A first on the node part); D last.
    assert v["front"] == [2, 2, 1, 3]
    assert v["order"] == [2, 0, 1, 3]


def test_2d_edge_component_equals_1d_weighted():
    r = analyze(FIXTURE["links"], {"assets": FIXTURE["assets"]})
    edge = [t[1] for t in r["variants"]["2d-direct-w"]["normalized"]]
    assert edge == pytest.approx(r["variants"]["1d-direct-w"]["score"])


def test_2d_unweighted_counts_links_in_edge_component():
    v = analyze(SMALL)["variants"]["2d-direct-u"]
    assert [t[1] for t in v["raw"]] == [2, 2, 3, 1]
    assert v["raw"][0][0] == pytest.approx(4.5)


def test_direction_option():
    r = analyze(SMALL, {"direction": "out"})
    assert r["variants"]["1d-direct-w"]["score"] == pytest.approx([4 / 3, 2 / 3, 2 / 3, 0])
    r = analyze(SMALL, {"direction": "in"})
    assert r["variants"]["1d-direct-w"]["score"] == pytest.approx([0, 1, 1, 2 / 3])


def test_two_way_pair_counts_as_two_links():
    r = analyze([link("A", "B", 3), link("B", "A", 1), link("B", "C", 2)])
    assert r["variants"]["1d-direct-u"]["score"] == pytest.approx([1, 3 / 2, 1 / 2])
    assert r["variants"]["1d-direct-w"]["score"] == pytest.approx([2, 3, 1])


# --- Ranking ----------------------------------------------------------------

def test_equal_scores_tie_with_competition_ranking():
    v = analyze(SMALL)["variants"]["1d-direct-w"]
    assert v["rank"] == [3, 1, 1, 4]
    assert v["order"] == [1, 2, 0, 3]  # B and C tie, ordered by asset ID


def test_order_within_a_front_follows_node_component():
    # (3, 1) and (2, 3) share a front. The supervisor's reference orders by node-importance degree first,
    # so (3, 1) leads even though (2, 3) has the larger sum.
    assert pareto_rank([(2, 3), (3, 1)], ["A", "B"]) == ([1, 1], [1, 0])
    assert pareto_rank([(2, 3), (3, 1)], ["A", "B"], "sum")[1] == [0, 1]
    # Equal node components fall back to asset ID.
    assert pareto_rank([(2, 1), (2, 1)], ["B", "A"])[1] == [1, 0]


def test_top_k_is_first_k_by_order():
    v = analyze(SMALL, {"k_from": 2, "k_to": 3})["variants"]["1d-direct-w"]
    assert v["top_k"] == [2, 0]


# --- Blast radius -------------------------------------------------------------

def test_blast_rings_and_parent():
    r = analyze(SMALL)
    rings = r["blast"][0]["rings"]
    assert [[m[0] for m in ring] for ring in rings] == [[1, 2], [3]]
    assert rings[1][0] == [3, 2, r["link_types"].index("Power"), 2]  # D, reached from C by a Medium link
    assert analyze(SMALL, {"depth": 1})["blast"][0]["rings"] == rings[:1]


def test_blast_weighted_uses_strongest_path():
    # From A within 2 hops: B 3/3 = 1; C max(1/3, 1 * 2/3) = 2/3; D only via A -> C -> D = (1/3) * (2/3) = 2/9.
    v = analyze(SMALL)["variants"]["1d-blast-w"]
    assert v["score"][0] == pytest.approx((1 + 2 / 3 + 2 / 9) / 3)
    # With 3 hops D is also reached via A -> B -> C -> D = 1 * 2/3 * 2/3 = 4/9.
    v = analyze(SMALL, {"depth": 3})["variants"]["1d-blast-w"]
    assert v["score"][0] == pytest.approx((1 + 2 / 3 + 4 / 9) / 3)


def test_blast_against_links_walks_backwards():
    # Against the links, D is reached from C (1 hop), then from A and B (2 hops; B's link to C is stronger).
    r = analyze(SMALL, {"blast_direction": "against"})
    rings = r["blast"][3]["rings"]
    assert [[m[0] for m in ring] for ring in rings] == [[2], [0, 1]]
    assert r["blast"][0]["rings"] == []
    # Weighted: C 2/3, then A via C 2/3 * 1/3 = 2/9 and B via C 2/3 * 2/3 = 4/9; / (n - 1) = 3
    assert r["variants"]["1d-blast-w"]["score"][3] == pytest.approx((2 / 3 + 2 / 9 + 4 / 9) / 3)
    assert r["variants"]["1d-blast-w"]["label"] == "1D (weighted), blast radius (2 hops, against links)"


def test_2d_blast_weighted_adds_reached_assets_2d_values_with_decay():
    # 2D direct (both ways): A (4.5, 4), B (4, 5), C (4.5, 5), D (1, 2).
    # From A: B decay 1, C 2/3, D 2/9 (same strongest paths as 1D blast).
    v = analyze(SMALL)["variants"]["2d-blast-w"]
    assert v["status"] == "ok" and v["kind"] == "pareto"
    assert v["raw"][0] == pytest.approx([4 + 2 / 3 * 4.5 + 2 / 9 * 1, 5 + 2 / 3 * 5 + 2 / 9 * 2])
    # From B: C 2/3, D 4/9. From C: D 2/3. D reaches nothing.
    assert v["raw"][1] == pytest.approx([2 / 3 * 4.5 + 4 / 9 * 1, 2 / 3 * 5 + 4 / 9 * 2])
    assert v["raw"][2] == pytest.approx([2 / 3, 4 / 3]) and v["raw"][3] == [0, 0]
    assert v["normalized"][0] == pytest.approx([x / 3 for x in v["raw"][0]])
    assert v["front"] == [1, 2, 3, 4]
    assert v["label"] == "2D (weighted), blast radius (2 hops)"


def test_2d_blast_unweighted_adds_reached_assets_in_full():
    # 2D unweighted direct: A (4.5, 2), B (4, 2), C (4.5, 3), D (1, 1).
    v = analyze(SMALL)["variants"]["2d-blast-u"]
    assert v["raw"] == [pytest.approx([9.5, 6]), pytest.approx([5.5, 4]), pytest.approx([1, 1]), [0, 0]]
    # Depth 1: only the assets linked directly.
    v = analyze(SMALL, {"depth": 1})["variants"]["2d-blast-u"]
    assert v["raw"][0] == pytest.approx([8.5, 5])


def test_2d_blast_follows_spread_direction():
    # Against the links, D reaches C (1 hop), then A and B; weighted decay C 2/3, A 2/9, B 4/9.
    v = analyze(SMALL, {"blast_direction": "against"})["variants"]["2d-blast-w"]
    assert v["raw"][3] == pytest.approx([2 / 3 * 4.5 + 2 / 9 * 4.5 + 4 / 9 * 4, 2 / 3 * 5 + 2 / 9 * 4 + 4 / 9 * 5])


# --- Input handling -----------------------------------------------------------

def test_conflicting_importance_uses_highest_with_warning():
    r = analyze([link("A", "B", 1, 1, 2), link("B", "C", 1, 3, 1)])
    assert r["importance"][1] == 3
    assert r["warnings"] == [{"code": "importance_conflict", "asset": "B", "values": [2, 3], "used": 3}]


def test_duplicate_link_is_rejected():
    with pytest.raises(ValueError, match="duplicate"):
        analyze([link("A", "B", 1), link("A", "B", 2)])


def test_edge_type_filter_keeps_n():
    links = [link("A", "B", 3, kind="Power"), link("A", "C", 2, kind="Control")]
    r = analyze(links, {"edge_types": ["Power"]})
    assert r["n"] == 3 and r["m"] == 1
    assert r["variants"]["1d-direct-w"]["score"][0] == pytest.approx(3 / 2)
    assert r["edge_types"] == {"Power": 1, "Control": 1}


def test_unlinked_assets_count_in_n():
    r = analyze(SMALL, {"assets": [{"id": x} for x in ["A", "B", "C", "D", "E"]]})
    assert r["n"] == 5 and r["ids"][-1] == "E"
    assert r["variants"]["1d-direct-w"]["score"][0] == pytest.approx(4 / 4)
    assert r["variants"]["1d-direct-w"]["score"][4] == 0


def test_result_is_json_serialisable():
    json.dumps(analyze(FIXTURE["links"], {"assets": FIXTURE["assets"]}))


# --- Agreement with the V3 reference (made-up sample network) -----------------

@pytest.fixture(scope="module")
def sample():
    # The V3 reference counts outgoing links only.
    return analyze(FIXTURE["links"], {"assets": FIXTURE["assets"], "direction": "out"}), FIXTURE["expected"]


def test_sample_ids_match(sample):
    r, exp = sample
    assert r["ids"] == [e["id"] for e in exp]


def test_1d_unweighted_matches_reference(sample):
    r, exp = sample
    assert r["variants"]["1d-direct-u"]["score"] == pytest.approx([e["1U"] for e in exp], abs=1e-9)


def test_1d_weighted_is_reference_times_3(sample):
    # The reference divides link importance by 3; CLAUDE.md does not rescale.
    r, exp = sample
    assert r["variants"]["1d-direct-w"]["score"] == pytest.approx([3 * e["1W"] for e in exp], abs=1e-8)


@pytest.mark.parametrize("key,ref", [("1d-direct-u", "1U"), ("1d-direct-w", "1W"),
                                     ("1d-blast-u", "1UB"), ("1d-blast-w", "1WB")])
def test_1d_order_matches_reference(sample, key, ref):
    # The reference never ties (equal scores are broken by ID); our Order uses the same tie-break.
    r, exp = sample
    order = r["variants"][key]["order"]
    assert [pos + 1 for pos in sorted(range(len(order)), key=lambda p: order[p])] == \
        [e[f"{ref}_rank"] for e in sorted(exp, key=lambda e: r["ids"].index(e["id"]))] or \
        [e[f"{ref}_rank"] for e in exp] == [order.index(i) + 1 for i in range(len(order))]


def test_1d_blast_radius_matches_reference(sample):
    r, exp = sample
    assert r["variants"]["1d-blast-u"]["score"] == pytest.approx([e["1UB"] for e in exp], abs=1e-9)
    assert r["variants"]["1d-blast-w"]["score"] == pytest.approx([e["1WB"] for e in exp], abs=1e-9)


def test_link_counts_and_rings_match_reference(sample):
    r, exp = sample
    assert r["out_links"] == [e["out"] for e in exp]
    assert r["in_links"] == [e["in"] for e in exp]
    assert [len(b["rings"][0]) if b["rings"] else 0 for b in r["blast"]] == [e["hop1"] for e in exp]
    assert [len(b["rings"][1]) if len(b["rings"]) > 1 else 0 for b in r["blast"]] == [e["hop2"] for e in exp]
    assert [b["high"] for b in r["blast"]] == [e["high"] for e in exp]


# --- Bands and the distribution chart ------------------------------------------------

V9 = [0, 0, 0, 1, 2, 3, 4, 5, 6]


def test_bands_default_thirds_and_custom_cuts():
    assert bands(V9) == ["Low"] * 4 + ["Medium"] * 2 + ["High"] * 3  # cuts 2 and 4
    assert bands(V9, cuts=[5, 1]) == ["Low"] * 3 + ["Medium"] * 4 + ["High"] * 2  # cut order does not matter
    # Fronts: lower is better. Range 1-3 -> cuts 1.67 / 2.33.
    assert bands([1, 2, 3, 3], axis="front") == ["High", "Medium", "Low", "Low"]
    assert bands([2, 2]) == ["Medium", "Medium"]


def test_distribution_zero_bar_and_linear_bins():
    d = distribution(V9, "score", {"bins": 5, "top": [8, 7]})
    assert d["zero_bar"] == {"lo": 0.0, "hi": 0.0, "count": 3, "top_count": 0, "excluded": False}
    # Positive scores in 5 equal bins over [0, 6]: width 1.2.
    assert [b["count"] for b in d["bars"]] == [1, 1, 1, 1, 2]
    assert d["bars"][-1]["top_count"] == 2 and d["bars"][-1]["hi"] == pytest.approx(6)
    assert d["ticks"] == [0, 2, 4, 6]
    assert [(z["band"], z["count"]) for z in d["zones"]] == [("Low", 4), ("Medium", 2), ("High", 3)]
    assert d["y_max"] == 3


def test_exclusions_count_each_asset_once_and_keep_bands():
    d = distribution(V9, "score", {"bins": 5, "exclude": [{"rule": "zero"}, {"rule": "below", "value": 2}]})
    assert [e["count"] for e in d["excluded"]] == [3, 1]
    assert d["zero_bar"]["excluded"] and d["zero_bar"]["count"] == 0
    assert d["band"] == bands(V9)  # bands never follow exclusions
    assert d["domain"][0] == 2  # the low end was excluded, so bins start at the lowest shown score
    assert d["shown"] == 5 and d["hidden"] == 4
    # The chart's zones re-split what is shown (scores 2-6: cuts 3.33 / 4.67); asset bands don't move.
    assert d["zone_cuts"] == pytest.approx([2 + 4 / 3, 2 + 8 / 3])
    assert [z["count"] for z in d["zones"]] == [2, 1, 2]


def test_zoom_counts_assets_outside_and_re_splits_zones():
    d = distribution(V9, "score", {"bins": 2, "zoom": [2, 4]})
    assert d["shown"] == 3 and d["outside_zoom"] == 6
    assert d["domain"] == [2, 4]
    assert d["zone_cuts"] == pytest.approx([2 + 2 / 3, 2 + 4 / 3])
    assert [z["count"] for z in d["zones"]] == [1, 1, 1]
    assert d["band"] == bands(V9)


def test_log_scale_bins_by_decade_and_suggests_log():
    d = distribution([0.001, 0.01, 0.1, 1], "score", {"scale": "log", "bins": 3})
    assert d["suggest_log"]
    assert [b["count"] for b in d["bars"]] == [1, 1, 2]
    assert d["ticks"] == pytest.approx([0.001, 0.01, 0.1, 1])


def test_front_axis_has_one_bar_per_front():
    d = distribution([1, 1, 2, 3, 3, 3], "front", {"exclude": [{"rule": "front", "value": 2}]})
    assert [(b["lo"], b["count"], b["excluded"]) for b in d["bars"]] == [(1, 2, False), (2, 0, True), (3, 3, False)]
    assert d["band"] == ["High", "High", "Medium", "Low", "Low", "Low"]
    assert d["zero_bar"] is None


def test_analyze_bands_come_from_its_distribution():
    v = analyze(SMALL)["variants"]["1d-direct-w"]
    assert v["band"] == v["distribution"]["band"]
    assert v["distribution"]["total"] == 4
