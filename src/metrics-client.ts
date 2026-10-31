// Promise API over the Pyodide worker, plus a subscribable load status for the UI.
import type { AnalysisResult, AnalyzeOptions, ChartOptions, Distribution, LinkRow } from './analysis-types';
import type { WorkerMessage } from './metrics-worker';

export interface LoadStatus {
  stage: 'runtime' | 'networkx' | 'metrics' | 'ready' | 'error';
  pct: number;
  message?: string;
}

const worker = new Worker(new URL('./metrics-worker.ts', import.meta.url), { type: 'module' });
let status: LoadStatus = { stage: 'runtime', pct: 0 };
const listeners = new Set<(s: LoadStatus) => void>();
const pending = new Map<number, { resolve: (r: never) => void; reject: (e: Error) => void }>();
let nextId = 1;

worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
  const m = ev.data;
  if (m.type === 'progress' || m.type === 'load-error') {
    status = m.type === 'progress' ? { stage: m.stage, pct: m.pct } : { stage: 'error', pct: 0, message: m.message };
    listeners.forEach((fn) => fn(status));
    return;
  }
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.type === 'result') p.resolve(JSON.parse(m.json) as never);
  else p.reject(new Error(m.message));
};

function request<T>(msg: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (r: never) => void, reject });
    worker.postMessage({ id, ...msg });
  });
}

export function analyze(links: LinkRow[], options: AnalyzeOptions): Promise<AnalysisResult> {
  return request({ type: 'analyze', links, options });
}

/** Chart counts for one variant's values (1D scores or 2D fronts), computed in Python. */
export function distribution(values: number[], axis: 'score' | 'front', options: ChartOptions): Promise<Distribution> {
  return request({ type: 'distribution', values, axis, options });
}

export function getLoadStatus(): LoadStatus {
  return status;
}

export function onLoadStatus(fn: (s: LoadStatus) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
