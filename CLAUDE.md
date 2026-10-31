# CARMA: Critical Asset Risk Management A____ (final word TBD)

Web app that ranks the most critical assets in an infrastructure network and shows each asset's
blast radius (how far a disruption spreads downstream). MIT research project. It will be shown
to an industry client and later sold, so it must look like a professional Microsoft/Apple
product, not an AI-generated demo. THIS REPO IS PUBLIC: never write client names, partner
names, or real network data into any committed file.

## How to work with me (read first, every session)
- NEVER ASSUME. If anything is ambiguous, missing, or could be done two ways, STOP and ask me
  before writing code. Ask as numbered multiple-choice questions with your recommendation marked.
- Start every task in plan mode: restate the task, list every assumption you would otherwise
  make, list open questions, then wait for my answers.
- Small steps. After each working step: run tests, tell me exactly how to check it myself,
  then commit with a clear message.
- Never change ranking math without updating tests. Ask before adding any dependency.
- Never read files in `private/` unless I explicitly say so in that message.
- If a requirement below conflicts with reference/, this file wins. Tell me about the conflict.

## Deadline deliverables (all WEIGHTED, high resolution, 2x pixel density)
1. 1D top 10: the ranked list of the top 10 assets AND the centrality distribution chart, both
   visible in one screenshot, plus the 3D graph with the top 10 highlighted.
2. 1D blast radius on two assets shown together: two cones pointing in different directions
   (no overlap), with both affected-asset lists visible.
3. 2D top 10: same composition as #1, for 2D (weighted).
4. 2D blast radius on two assets: same composition as #2, for 2D (weighted).
5. The full dashboard.
Key statistics in view: which ones is still to be confirmed by the supervisor; until then leave
space and ask me, do not invent a list.
Required feature (not a screenshot): 1D vs 2D side by side (see "Compare 1D vs 2D").
A 2-3 minute narrated demo video is recorded later, so the UI must support the demo flow below.

## Demo flow the UI must support, in this order
1. Upload the network (Excel) -> structure check -> preview
2. Analysis setup panel: Metric (Degree centrality; "Betweenness centrality - in development"
   shown disabled), Dimension (1D / 2D), Weighted (locked on in demo mode), k (Top 10/25/50 or
   custom From/To). An explicit "Analyze" button generates the results.
3. Results: ranked top-k list + 3D graph with top-k highlighted
4. Distribution chart: how many assets are High / Medium / Low
5. Blast radius: pick any asset (or two), see the cone and the list of affected assets
6. Compare 1D vs 2D side by side
7. Present mode: one button hides app chrome and centres the graph evenly, for a large TV

## Stack and hosting
Vite + React + TypeScript for the UI. Python (via Pyodide) for ALL calculations. SheetJS (xlsx)
for upload parsing. Plain CSS with CSS variables (light + dark token sets). No Tailwind
defaults. Playwright for the screenshot script.
- Hosted on GitHub Pages: fully static, NO backend. Everything runs in the browser.
- Vite `base` = '/<repo-name>/'. A GitHub Actions workflow runs pytest, builds, and publishes
  `dist/` to Pages. A failing test blocks the deploy.

## Data security (non-negotiable)
- Real partner data, architecture diagrams, meeting notes and slides live in `private/`, which
  is gitignored. They are never committed and never copied into src/ or public/.
- Only the made-up sample dataset is committed (`public/sample/`).
- .gitignore must include: private/, data/, *.xlsx, *.xls, *.csv, *.pdf, *.pptx, PLAYBOOK.md
  (with an exception for public/sample/).
- Uploaded files are processed in the browser only. Nothing is sent to any server.

## Architecture: ONE calculations file, in Python
All math lives in `metrics/carma_metrics.py`. Nothing else computes metrics.
- Python 3 + NetworkX only (no numpy/pandas/scipy). Build an `nx.DiGraph` with node attribute
  `importance` and edge attributes `importance`, `type`. Use NetworkX for structure and standard
  algorithms (degree, BFS for blast radius, later betweenness). Never call NetworkX functions
  that need scipy/numpy (e.g. default PageRank) without asking. Same file runs in Jupyter.
- Browser: Pyodide from jsDelivr, pinned to an exact version at least two weeks old, in a Web
  Worker (`src/metrics-worker.ts`); load NetworkX with `pyodide.loadPackage('networkx')`. Start
  loading when the app opens (during upload) and show progress.
- Pure functions only: no I/O, no plotting, no layout, no styling.
- One entry point: `analyze(links: list[dict], options: dict) -> dict` (JSON-serialisable),
  returning everything the UI needs: all 8 degree variants (1D/2D x direct/blast radius x
  weighted/unweighted), raw scores, Low/Medium/High band per asset, ranks (with ties), top-k,
  blast-radius membership per asset (ring 1 / ring 2: id, hop, link type, importance, rank),
  distribution bins, and summary statistics.
- 2D lives in ONE clearly marked function, `score2d()`, at the top of the file with a
  docstring. Changing it must update every view with no other edits.
- `src/analysis-types.ts` mirrors analyze()'s output. UI code reads ONLY that result.
  Excel parsing, layout (`layout.ts`) and rendering stay in TypeScript.
- Tests: `metrics/test_carma_metrics.py` (pytest).

## Ranking approach (from the supervisor's meeting and written reference; follow exactly)
- Importance encoding: L/M/H = 1/2/3 for both assets and links. Do NOT rescale (no /3).
- Normalization: every degree value is divided by (n - 1), n = number of assets. Values above 1
  are normal because weights go up to 3. (Verified against the supervisor's reference table.)
- 1D weighted ("edge-importance-weighted degree") = sum of link importance over the asset's
  links, / (n - 1). 1D unweighted = number of links / (n - 1). Exact equal scores tie.
- 2D weighted ("degree centrality with node and edge weights", Pareto degree ranking):
  - Each link e = (a, b) carries a 2-vector: ( (I_a + I_b) / 2 , w_e ).
  - An asset's DEGREE TUPLE = component-wise sum over its links:
    (node-importance-weighted degree, edge-importance-weighted degree).
    Normalized tuple = degree tuple / (n - 1).
  - Note: the second component equals the 1D weighted degree. 2D adds asset importance.
  - Rank assets by Pareto dominance on the tuple: x dominates y if x_i >= y_i in both and
    x_i > y_i in at least one (strong = greater in both; weak = equal in one). Neither
    dominates -> same front. Rank = front index from non-dominated sorting (front 1 = best).
  - Output columns, using the supervisor's names: Order, Asset ID, Pareto front,
    Degree tuple (node-importance, edge-importance), Normalized tuple.
  - Top-k = the first k rows by Order. The Pareto front column shows where ranks are shared.
  - All 2D logic lives in `score2d()` (and helper `pareto_fronts()`) in metrics/carma_metrics.py.
  - Tests: (3,4) dominates (1,2) strongly; (3,2) dominates (1,2) weakly; (1,3) and (2,1) share
    a front; normalization divides by (n - 1).
  - Never show the Pareto frontier plot in the app (research paper only). Show rankings.
- LINK DIRECTION (must be verified, do not assume): whether "an asset's links" means outgoing,
  incoming, or both. The reference suggests both (the top asset both receives and sends). The
  current canvas code uses outgoing only. Implement direction as one option in analyze() and let
  the private golden test (below) decide which one reproduces the supervisor's numbers.
- GOLDEN TEST: `private/GOLDEN.md` lists values from the supervisor's reference table for the real
  partner network. Write `private/test_golden.py` that loads the real file from private/ and
  checks analyze() reproduces them exactly. It runs locally only, never in CI, never committed.
  Read private/ ONLY when I tell you to in that message.
- Demo mode (default ON): weighted only. Unweighted variants exist for research comparisons and
  papers; their controls are hidden in demo mode (code kept behind a flag).
- Labels: every ranking, chart and list states its variant, e.g. "1D (weighted)", "2D (weighted)".
- Business-friendly by default: show each asset's Low/Medium/High band everywhere (nobody in a
  business audience knows what a score of 0.02 means). Raw values sit behind a "Show values"
  toggle for engineers and researchers.
- DEFERRED QUESTIONS for the supervisor. I will answer these later, while finishing the 2D
  calculations. Do NOT block on them: implement each as an option in analyze() with the
  temporary default below, mark it `# TODO(supervisor)` in code, and list all of them for me
  at the end of each phase. These are the only places you may use a default without asking.
  Temporary defaults: link direction = outgoing (current canvas behaviour); order within a
  front = larger normalized-tuple sum first, then asset ID; rank-change labels = none (signed
  number only); bands after exclusions = fixed on the full range; statistics = none.
  The questions:
  1. Order within a front: how are assets on the same front ordered (by the node component,
     the edge component, their sum, or ID)? Check against the golden table first.
  2. 2D blast radius: which vectors are aggregated over the 2-hop reach?
  3. Rank-change labels ("Rises strongly", "Rises", "Falls slightly", ...): what thresholds?
  4. Low/Medium/High after exclusions: recompute on the visible range, or keep fixed?
  5. Which statistics go on the snapshots?

## Reference design
`reference/` holds the approved V3 designs (`.dc.html` is a custom template format: treat it as
a visual and behavioural SPEC, do not run it). Light and dark differ only in colours.
- Port the 3D graph faithfully: CSS-rendered spheres + cylinder arrows, virtual space 1400x1200,
  default camera yaw -22, pitch -14, perspective DIST 14, `_layout()` (square 8.4x8.4 floor;
  lanes: control on top, power below, end devices right), zoom 20%-1200%, Fit to screen = zoom
  to fitZ, name labels tiered by zoom, L/M/H labels when weighted.
- Real asset IDs may not have type prefixes (CC-, GEN-, ...). Layout grouping must use an asset
  type column if present; if absent, ASK me how to group.
- Do NOT restyle the graph. Everything else gets the design rules below.

## Data input
Domain: the reference network is a transport control system. Directed edge list: one workbook (Links + Assets sheets) or two files; .xlsx/.xls/.csv.
Link columns: Source, Target, Edge type, Edge importance, Source asset importance,
Target asset importance. Optional asset name/abbreviation column: asset labels must match the
abbreviations in the client's architecture diagram (one-to-one mapping). Validate structure and
show errors inline.

## Features beyond the reference
- Blast radius list: when a cone is drawn, a panel lists every affected asset grouped by
  Ring 1 (1 hop) and Ring 2 (2 hops): ID, name, type, band (L/M/H), link type, rank. Counts in
  group headers. Rows clickable (jump to asset). Export CSV.
- Two-asset blast radius: pin a second asset; each cone points away from the graph centre so
  cones do not overlap; one list per asset. Each asset has its own blast radius; showing two
  distinct cones is the point. Do not build merged/overlapping cones.
- Distribution chart (see the full spec in the next section).
- Compare 1D vs 2D (REQUIRED; one "Compare 1D vs 2D" button, uncluttered): a split view with
  "1D (weighted)" on the left and "2D (weighted)" on the right. Each side shows its 3D graph
  with its own top-k highlighted and its ranked list; the two cameras stay in sync (rotate,
  zoom, pan, selection). Below: one table in the supervisor's format,
  Asset | 1D (weighted) rank | 2D (weighted) rank | Change. Change shows the signed rank
  difference; word labels ("Rises strongly", "Rises", ...) wait for open question 3.
  Selecting an asset shows its blast radius on both sides at once.
- Present mode (see demo flow).

## Distribution chart (mandatory for both 1D and 2D; researcher-configurable)
Purpose: show how many assets are highly, moderately and weakly central. Executives read the
Low/Medium/High zones; engineers and researchers read the values. Both must be on one chart.
- Axes: y = number of assets. x = centrality score (1D) or Pareto front (2D, since 2D has no
  single number; front 1 = most critical). Axis titles always visible and specific, e.g.
  "Degree centrality score, 1D (weighted)" and "Number of assets". Never ambiguous with rank.
- Default order: max to min (most critical on the LEFT), as the supervisor described.
  Option: min to max.
- Two label layers on the x-axis: a zone row (High / Medium / Low, each with its asset count)
  and a numeric tick row below it. Numeric ticks can be toggled off for executive views.
- Zones: split the score range into three equal intervals by default; researchers can drag or
  type the two cut-offs. Zones are shaded.
- Uniform intervals: tick spacing must be uniform. Linear or log scale toggle; suggest log when
  the range spans orders of magnitude. Zero scores cannot sit on a log axis: show them as a
  separate "0" bar at the low end, clearly marked.
- Bins: bin width/count control with a sensible default.
- Exclude to magnify: the default view shows ALL assets (the large zero-score bar of assets with
  only incoming links is important and must be visible by default). Researchers can exclude
  bars/bins (click a bar > Exclude) or exclude by rule (e.g. score = 0, below/above a value).
  Exclusions appear as removable chips with counts ("Excluded: 38 assets with score 0").
  The y-axis rescales so the remaining bars are readable. One click resets.
- Zoom: drag across the x-axis to magnify a range (e.g. Medium + High only); Reset button.
- Highlight the current top-k range on the chart.
- Researcher overrides: editable axis titles; export the chart as PNG and SVG for papers/slides.
- All binning, zone and exclusion counts come from analyze() options/results in
  metrics/carma_metrics.py, not from chart code.

## Backlog (do NOT build now)
- "Why this rank" panel: deterministic, template-generated explanations in the style of the
  supervisor's rationale (e.g. "A and B share front 3: A has the larger node-importance degree,
  B the larger edge-importance degree; neither dominates"). No AI-generated text. Ask first.
- Architecture diagram view mapped one-to-one to the network.
- Betweenness centrality and other metrics.
- Ranking links and assets together (heterogeneous ranking).

## Design rules for everything outside the graph (avoid the "AI-generated" look)
- Target: Microsoft Fluent 2 style enterprise data app. Dense, calm, information-first.
- Type: system stack ('Segoe UI Variable', 'Segoe UI', -apple-system, 'SF Pro Text', sans-serif).
  Tabular numerals for all numbers. Sizes 12/13/14/16/20 only. Left-aligned headings.
- Colour: neutral greys + ONE accent (the graph's top-k orange) + L/M/H semantic colours. No
  gradients, no purple/blue AI palettes, no glassmorphism, no glow.
- Surfaces: 1px borders, radius 4-6px, shadows only on popovers/menus. 4px spacing grid.
- Icons: one set, one stroke weight (Fluent UI System Icons). No emoji, no sparkles, no icons in
  coloured circles.
- Copy: plain, specific labels ("Blast radius: 12 assets"). No marketing taglines.
- Tables: right-aligned numbers, sticky headers, no zebra stripes, row hover only.
- Every control has hover, focus-visible and disabled states. Respect prefers-reduced-motion.
