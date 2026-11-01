// App-wide state: the loaded dataset, the latest analysis result and the theme.
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { AnalysisResult, AnalyzeOptions } from './analysis-types';
import { hasErrors, type Dataset, type ParseResult } from './data/parse';
import { defaultTypeLanes, type Lane } from './graph/seed';
import { analyze, getLoadStatus, onLoadStatus, type LoadStatus } from './metrics-client';

export type Theme = 'light' | 'dark';

/** Choices made in the Analysis setup panel; the dashboard opens with them. */
export interface Setup {
  dim: '1d' | '2d';
  weighted: boolean;
  kFrom: number;
  kTo: number;
}

/**
 * Demo mode (default): opens weighted, with a Weighted / Unweighted toggle (Dr. Pal's feedback, 2026-10-31). Researchers
 * add ?research to the address (e.g. .../Graph-Centrality-CAMS-JP/?research) for the Research Mode badge.
 */
export const DEMO_MODE = !/[?&]research\b/.test(location.search + location.hash);

interface AppState {
  /** Latest upload: the dataset (null if unreadable) and its structure-check issues. */
  parsed: ParseResult | null;
  setParsed(p: ParseResult | null): void;
  /** Dataset ready for analysis: parsed without errors. */
  dataset: Dataset | null;
  /** Graph lane per asset type (only when the asset list has types and no X/Y/Z). */
  laneByType: Record<string, Lane> | null;
  setLaneByType(l: Record<string, Lane>): void;
  analysisName: string;
  setAnalysisName(s: string): void;
  depth: number;
  setDepth(d: number): void;
  result: AnalysisResult | null;
  busy: boolean;
  error: string | null;
  /** Runs analyze() on the loaded dataset; resolves to null if it failed (error is set). */
  run(options: AnalyzeOptions): Promise<AnalysisResult | null>;
  theme: Theme;
  toggleTheme(): void;
  /** True unless the address has ?research. */
  demo: boolean;
  setup: Setup;
  setSetup(s: Setup): void;
  /** Off (business view): Low/Medium/High bands instead of scores and tuples. */
  showValues: boolean;
  setShowValues(v: boolean): void;
  /** Present mode: app chrome hidden, graph(s) full screen for a large TV. */
  present: boolean;
  setPresent(on: boolean): void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useApp outside AppProvider');
  return s;
}

export function useLoadStatus(): LoadStatus {
  return useSyncExternalStore(onLoadStatus, getLoadStatus);
}

function initialTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [parsed, setParsedRaw] = useState<ParseResult | null>(null);
  const [laneByType, setLaneByType] = useState<Record<string, Lane> | null>(null);
  const dataset = parsed?.dataset && !hasErrors(parsed.issues) ? parsed.dataset : null;
  const [analysisName, setAnalysisName] = useState('');
  const [depth, setDepth] = useState(2);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [setup, setSetupRaw] = useState<Setup>({ dim: '1d', weighted: true, kFrom: 1, kTo: 10 });
  const setSetup = (s: Setup) => setSetupRaw(s);
  const [showValues, setShowValues] = useState(false);
  const [present, setPresentRaw] = useState(false);
  useEffect(() => {
    // Leaving browser full screen (or Esc when full screen was refused) ends Present mode.
    const onFs = () => { if (!document.fullscreenElement) setPresentRaw(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPresentRaw(false); };
    document.addEventListener('fullscreenchange', onFs);
    addEventListener('keydown', onKey);
    return () => { document.removeEventListener('fullscreenchange', onFs); removeEventListener('keydown', onKey); };
  }, []);
  const setPresent = (on: boolean) => {
    setPresentRaw(on);
    if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => { /* still present, in the window */ });
    if (!on && document.fullscreenElement) void document.exitFullscreen();
  };

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    // Follow the system theme until the user picks one.
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      let saved: string | null = null;
      try { saved = localStorage.getItem('carma-theme'); } catch { /* storage unavailable */ }
      if (saved !== 'light' && saved !== 'dark') {
        document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light';
        setTheme(mq.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('carma-theme', next); } catch { /* storage unavailable */ }
    // Applied before re-rendering, so components reading theme colours (the chart) see the new ones.
    document.documentElement.dataset.theme = next;
    setTheme(next);
  };

  const setParsed = (p: ParseResult | null) => {
    setParsedRaw(p);
    const d = p?.dataset;
    setLaneByType(d && d.hasTypes && !d.hasPositions ? defaultTypeLanes(d.assets, d.links) : null);
    setResult(null);
    setError(null);
  };

  // Live recomputes can overlap; only the latest request may update the result.
  const latest = useRef(0);
  const run = async (options: AnalyzeOptions) => {
    if (!dataset) return null;
    const ticket = ++latest.current;
    setBusy(true);
    try {
      const r = await analyze(dataset.links, { ...options, assets: dataset.assets.map((a) => ({ id: a.id, importance: a.importance })) });
      if (ticket === latest.current) { setResult(r); setError(null); }
      return r;
    } catch (e) {
      if (ticket === latest.current) setError((e as Error).message);
      return null;
    } finally {
      if (ticket === latest.current) setBusy(false);
    }
  };

  return (
    <Ctx.Provider value={{ parsed, setParsed, dataset, laneByType, setLaneByType: (l) => setLaneByType(l), analysisName, setAnalysisName, depth, setDepth, result, busy, error, run, theme, toggleTheme,
      demo: DEMO_MODE, setup, setSetup, showValues, setShowValues, present, setPresent }}>
      {children}
    </Ctx.Provider>
  );
}
