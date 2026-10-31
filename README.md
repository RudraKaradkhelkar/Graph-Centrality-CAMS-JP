# CARMA

CARMA ranks the most critical assets in an infrastructure network and shows how far a disruption to each one
could spread (its blast radius). It is an MIT research tool built around degree centrality:

- **1D**: one score per asset from its links, weighted by link importance (Low 1, Medium 2, High 3).
- **2D**: two values per asset (the importance of the assets at both ends of its links, and the importance of the
  links), ranked by Pareto fronts.
- **Blast radius**: the assets reached within 1 to 4 hops, drawn as a cone on a 3D view of the network, with
  1D vs 2D side by side.

**Open the app:** https://rudrakaradkhelkar.github.io/Graph-Centrality-CAMS-JP/

## Your data stays in your browser

Everything runs on your own computer. The file you open is read and analysed in the browser (the calculations use
Python and NetworkX through Pyodide); nothing is uploaded anywhere. Try it with **Use the sample network**, a
made-up regional power grid.

The file needs a links table (Source, Target, Edge type, Edge importance, Source asset importance, Target asset
importance) and an asset list, either as one Excel workbook with both sheets or as two files (.xlsx, .xls or .csv).
The upload page lists the expected columns and offers a template.

## Demo and research mode

The app opens in demo mode: weighted results only, with Low / Medium / High bands. Add `?research` to the address
(for example `.../Graph-Centrality-CAMS-JP/?research`) to also show the unweighted variants.

## Run it locally

Needs Node 24 and, for the calculation tests, Python 3.14.

```
npm ci
npm run dev          # http://localhost:5173/Graph-Centrality-CAMS-JP/
npm test             # parsing tests (vitest)
pip install -r requirements-dev.txt
npm run test:py      # calculation tests (pytest)
```

`npm run snapshots -- --file <network file> --assets <ID>,<ID> [--dark]` saves high-resolution screenshots of the
top 10 and two-asset blast-radius views into `snapshots/` (needs Microsoft Edge or Playwright's Chromium).

## Copyright

Copyright (c) 2026 RudraKaradkhelkar. All rights reserved. The code is public to read; it is not licensed for reuse.
