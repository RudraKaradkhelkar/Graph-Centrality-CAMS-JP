// Phase 1 copies the V3 reference chrome, whose markup is written as inline style strings.
// css('height: 36px; color: var(--text)') turns one into a React style object (cached per string),
// so the reference styles can be carried over unchanged apart from colours, which use theme variables.
import type { CSSProperties } from 'react';

const cache = new Map<string, CSSProperties>();

export function css(s: string): CSSProperties {
  let out = cache.get(s);
  if (out) return out;
  out = {};
  for (const decl of s.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim();
    const key = prop.startsWith('--') ? prop : prop.replace(/^-(webkit|moz|ms)-/, (_, v: string) => v[0].toUpperCase() + v.slice(1) + '-')
      .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    (out as Record<string, string>)[key] = decl.slice(i + 1).trim();
  }
  cache.set(s, out);
  return out;
}
