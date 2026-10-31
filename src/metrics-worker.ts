/// <reference lib="webworker" />
// Runs metrics/carma_metrics.py in Pyodide, off the main thread. Loading starts as soon as the app opens.
import metricsSource from '../metrics/carma_metrics.py?raw';

const PYODIDE_VERSION = '314.0.7'; // Python 3.14.2, NetworkX 3.6.1
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export type WorkerRequest =
  | { id: number; type: 'analyze'; links: unknown[]; options: unknown }
  | { id: number; type: 'distribution'; values: number[]; axis: 'score' | 'front'; options: unknown };
export type WorkerMessage =
  | { type: 'progress'; stage: 'runtime' | 'networkx' | 'metrics' | 'ready'; pct: number }
  | { type: 'load-error'; message: string }
  | { id: number; type: 'result'; json: string }
  | { id: number; type: 'error'; message: string };

interface Pyodide {
  loadPackage(name: string): Promise<void>;
  runPython(code: string): unknown;
  globals: { set(name: string, value: unknown): void };
  FS: { writeFile(path: string, data: string): void };
}

const post = (m: WorkerMessage) => self.postMessage(m);

async function boot(): Promise<Pyodide> {
  post({ type: 'progress', stage: 'runtime', pct: 5 });
  const mod = await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`);
  const py: Pyodide = await mod.loadPyodide({ indexURL: PYODIDE_URL });
  post({ type: 'progress', stage: 'networkx', pct: 60 });
  await py.loadPackage('networkx');
  post({ type: 'progress', stage: 'metrics', pct: 90 });
  py.FS.writeFile('/home/pyodide/carma_metrics.py', metricsSource);
  py.runPython('import json, carma_metrics');
  post({ type: 'progress', stage: 'ready', pct: 100 });
  return py;
}

const ready = boot();
ready.catch((e) => post({ type: 'load-error', message: String(e?.message ?? e) }));

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const id = req.id;
  try {
    const py = await ready;
    py.globals.set('options_json', JSON.stringify(req.options ?? {}));
    let json: string;
    if (req.type === 'analyze') {
      py.globals.set('links_json', JSON.stringify(req.links));
      json = py.runPython('json.dumps(carma_metrics.analyze(json.loads(links_json), json.loads(options_json)))') as string;
    } else {
      // Chart-only changes: count bars, zones and exclusions without re-running the analysis.
      py.globals.set('values_json', JSON.stringify(req.values));
      py.globals.set('axis', req.axis);
      json = py.runPython('json.dumps(carma_metrics.distribution(json.loads(values_json), axis, json.loads(options_json)))') as string;
    }
    post({ id, type: 'result', json });
  } catch (e) {
    // Python exceptions arrive as PythonError; the last line holds the readable message.
    const text = String((e as Error)?.message ?? e).trim();
    post({ id, type: 'error', message: text.split('\n').pop() ?? text });
  }
};
