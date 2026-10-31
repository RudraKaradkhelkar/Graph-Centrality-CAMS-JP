import { describe, expect, it } from 'vitest';
import type { LinkRow } from '../analysis-types';
import { layout } from './layout';
import { assetRoles, defaultTypeLanes, seedLayout } from './seed';

const link = (source: string, target: string): LinkRow => ({ source, target, type: 'P', importance: 1, source_importance: 1, target_importance: 1 });

describe('lanes', () => {
  const links = [link('C1', 'P1'), link('P1', 'P2'), link('P2', 'E1'), link('C1', 'E2')];

  it('assigns roles from link direction', () => {
    expect(assetRoles(['C1', 'P1', 'P2', 'E1', 'E2', 'U'], links)).toEqual(['top', 'middle', 'middle', 'right', 'right', 'right']);
  });

  it('puts each type in the lane most of its assets belong to', () => {
    const assets = [{ id: 'C1', name: '', type: 'Control' }, { id: 'P1', name: '', type: 'Power' }, { id: 'P2', name: '', type: 'Power' },
      { id: 'E1', name: '', type: 'Device' }, { id: 'E2', name: '', type: 'Device' }];
    expect(defaultTypeLanes(assets, links)).toEqual({ Control: 'top', Power: 'middle', Device: 'right' });
  });

  it('seeds deterministic, finite positions', () => {
    const assets = ['C1', 'P1', 'P2', 'E1', 'E2'].map((id) => ({ id, name: id }));
    const a = seedLayout(assets, links, null), b = seedLayout(assets, links, null);
    expect(a).toEqual(b);
    expect(a.pos.flat().every(Number.isFinite)).toBe(true);
    // Middle lane runs left to right with distance from the senders: P1 (1 hop) left of P2 (2 hops).
    expect(a.pos[1][0]).toBeLessThan(a.pos[2][0]);
  });
});

describe('large networks', () => {
  it('lays out 1,000 assets in reasonable time', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ids = Array.from({ length: 1000 }, (_, i) => `A${i}`);
    const pairs = new Set<string>();
    const links: LinkRow[] = [];
    while (links.length < 2000) {
      const s = ids[Math.floor(rand() * 1000)], t = ids[Math.floor(rand() * 1000)];
      if (s !== t && !pairs.has(s + t)) { pairs.add(s + t); links.push(link(s, t)); }
    }
    const assets = ids.map((id, i) => ({ id, name: id, type: `T${i % 12}` }));
    const t0 = performance.now();
    const out = layout(seedLayout(assets, links, defaultTypeLanes(assets, links)));
    const ms = performance.now() - t0;
    console.log(`layout of 1000 assets: ${ms.toFixed(0)} ms`);
    expect(out.pos.flat().every(Number.isFinite)).toBe(true);
    expect(ms).toBeLessThan(15000);
  }, 30000);
});

describe('small networks', () => {
  it('stay roughly as wide as tall after layout, even with one-asset clusters', () => {
    const links = [link('A_X', 'B_Y'), link('B_Y', 'C_Z'), link('A_X', 'C_Z')];
    const assets = ['A_X', 'B_Y', 'C_Z'].map((id) => ({ id, name: id, type: id.slice(2) }));
    const out = layout(seedLayout(assets, links, defaultTypeLanes(assets, links)));
    expect(out.pos.flat().every(Number.isFinite)).toBe(true);
    const span = (k: number) => Math.max(...out.pos.map((p) => p[k])) - Math.min(...out.pos.map((p) => p[k]));
    expect(span(1)).toBeLessThan(1.5 * span(0));
  });
});
