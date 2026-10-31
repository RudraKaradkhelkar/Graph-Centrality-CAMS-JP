// Runs pytest with the project's .venv Python when present (Windows or macOS/Linux), else the system Python.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const venv = ['.venv/Scripts/python.exe', '.venv/bin/python'].find((p) => fs.existsSync(p));
const r = spawnSync(venv ?? 'python', ['-m', 'pytest', 'metrics', '-q', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
