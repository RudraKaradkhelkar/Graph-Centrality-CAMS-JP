// Small overlays for graph views outside the main dashboard: the 1D vs 2D comparison and Present mode.
import type { ReactNode } from 'react';
import type { GraphTheme } from '../graph/graph-theme';
import type { CameraInfo, GraphControls } from '../graph/GraphView';
import { useApp } from '../state';
import { css } from './css';
import { Icon, LevelChip } from './ui';

const PANEL = 'pointer-events: auto; background: var(--overlay-94); box-shadow: var(--overlay-shadow); border: 1px solid var(--border)';
const BTN = 'width: 36px; height: 32px; display: flex; align-items: center; justify-content: center; border: 0; background: transparent; color: var(--text-2); cursor: pointer';

/** Top-left caption: what is ranked and what is highlighted. */
export function GraphCaption({ title, sub, big }: { title: string; sub: ReactNode; big?: boolean }) {
  return (
    <div data-ui="1" style={css(`position: absolute; left: 16px; top: 16px; max-width: 70%; ${PANEL}; padding: ${big ? '12px 16px' : '8px 12px'}; border-radius: 6px; cursor: default`)}>
      <div style={css(`font-size: ${big ? 20 : 14}px; font-weight: 600; color: var(--text)`)}>{title}</div>
      <div style={css(`margin-top: 2px; font-size: ${big ? 14 : 12}px; color: var(--text-3)`)}>{sub}</div>
    </div>
  );
}

/** Ring key for the blast cones: which dashed ring on the graph is which hop. */
export function RingKey({ depth, T }: { depth: number; T: GraphTheme }) {
  return (
    <span style={css('display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px')}>
      <span style={css('font-weight: 600; color: var(--text)')}>Blast Cone Rings (on the graph):</span>
      {Array.from({ length: depth }, (_, h) => (
        <span key={h} style={css('display: inline-flex; align-items: center; gap: 6px')}>
          <span aria-hidden="true" style={{ width: 8 + h * 4, height: 8 + h * 4, borderRadius: '50%', border: `1.5px dashed rgb(${T.cone})`, boxSizing: 'border-box' }} />
          Ring {h + 1} = {h + 1} {h ? 'Hops' : 'Hop'}{h === 0 ? ' (Inner)' : h === depth - 1 && depth > 1 ? ' (Outer)' : ''}
        </span>
      ))}
    </span>
  );
}

/** Key for the L / M / H letters on spheres, links and in lists. */
export const IMPORTANCE_KEY = 'Importance (From File): H = High · M = Medium · L = Low';

/** Bottom-left legend in the graph's own colours. */
export function GraphLegend({ T, from, to, levels, blast, depth = 2 }: { T: GraphTheme; from: number; to: number; levels: boolean; blast: boolean; depth?: number }) {
  return (
    <div data-ui="1" style={css(`position: absolute; left: 16px; bottom: 16px; max-width: calc(100% - 32px); box-sizing: border-box; ${PANEL}; padding: 8px 12px; border-radius: 6px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: var(--text-2); cursor: default`)}>
      <div style={css('display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px')}>
        <span style={css('display: flex; align-items: center; gap: 8px')}><span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: '50%', background: T.org[1] }} />Ranks {from}–{to}</span>
        <span style={css('display: flex; align-items: center; gap: 8px')}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', border: `2px solid ${T.ring}` }} />Selected</span>
        <span style={css('display: flex; align-items: center; gap: 8px')}><span aria-hidden="true" style={{ width: 20, height: 4, borderRadius: 2, background: T.e0[1] }} />Depends On</span>
        {blast && <span style={css('display: flex; align-items: center; gap: 8px')}><span aria-hidden="true" style={{ width: 22, height: 12, clipPath: 'polygon(0 50%, 100% 0, 100% 100%)', background: `rgba(${T.cone}, 0.6)` }} />Blast Radius</span>}
        {levels && <span style={css('display: flex; align-items: center; gap: 4px')}>{[1, 2, 3].map((v) => <LevelChip key={v} lv={v} size={15} />)} {IMPORTANCE_KEY}</span>}
      </div>
      {blast && <RingKey depth={depth} T={T} />}
    </div>
  );
}

/** Bottom-right zoom and view buttons. */
export function GraphButtons({ c }: { c: GraphControls }) {
  return (
    <div data-ui="1" style={css(`position: absolute; right: 16px; bottom: 16px; display: flex; ${PANEL}; border-radius: 6px; overflow: hidden; cursor: default`)}>
      <button type="button" aria-label="Zoom out" onClick={c.zoomOut} style={css(BTN)}><Icon name="minus" width={2} /></button>
      <button type="button" aria-label="Zoom in" onClick={c.zoomIn} style={css(BTN)}><Icon name="plus" width={2} /></button>
      <button type="button" aria-label="Fit to screen" onClick={c.fitView} style={css(BTN)}><Icon name="fit" /></button>
      <button type="button" aria-label="Reset view" onClick={c.resetView} style={css(BTN)}><Icon name="reset" /></button>
    </div>
  );
}

/** Present mode: play / pause the slow rotation. */
export function RotateButton({ info, c }: { info: CameraInfo; c: GraphControls }) {
  return (
    <button data-ui="1" type="button" onClick={c.toggleAuto} aria-pressed={info.auto} aria-label={info.auto ? 'Stop rotating' : 'Rotate slowly'}
      title={info.auto ? 'Stop rotating' : 'Rotate slowly'}
      style={css(`position: absolute; right: 16px; bottom: 16px; width: 36px; height: 32px; display: flex; align-items: center; justify-content: center; ${PANEL}; border-radius: 6px; color: var(--text-2); cursor: pointer`)}>
      <Icon name={info.auto ? 'pause' : 'play'} />
    </button>
  );
}

/** Top-right button leaving Present mode (Esc works too). */
export function ExitPresent() {
  const app = useApp();
  return (
    <button data-ui="1" type="button" onClick={() => app.setPresent(false)} title="Esc"
      style={css('position: fixed; right: 16px; top: 16px; z-index: 60; height: 32px; padding: 0 12px; display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--overlay-94); font: inherit; font-size: 13px; font-weight: 600; color: var(--text); cursor: pointer')}>
      <Icon name="close" size={14} width={2} />Exit Presentation
    </button>
  );
}

/** Header button entering Present mode. */
export function PresentButton() {
  const app = useApp();
  return (
    <button type="button" onClick={() => app.setPresent(true)} title="Full screen for a large display; Esc to leave"
      style={css('height: 36px; padding: 0 16px; display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--control-border); border-radius: 6px; background: var(--control-bg); font: inherit; font-size: 14px; font-weight: 600; color: var(--text); cursor: pointer')}>
      <Icon name="fullscreen" size={16} />Present
    </button>
  );
}
