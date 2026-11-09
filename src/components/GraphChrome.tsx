// Small overlays for graph views: Present mode, ring and level keys, and the Graph Controls pop-up.
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
          <span aria-hidden="true" style={{ width: 10 + h * 4, height: 10 + h * 4, borderRadius: '50%', border: `1.5px dashed rgb(${T.cone})`, boxSizing: 'border-box' }} />
          Ring {h + 1} = {h + 1} {h ? 'Hops' : 'Hop'}{h === 0 ? ' (Inner)' : h === depth - 1 && depth > 1 ? ' (Outer)' : ''}
        </span>
      ))}
    </span>
  );
}

/** Key for the L / M / H letters on spheres, edges and in lists. */
export const IMPORTANCE_KEY = 'Assigned Importance: H = High · M = Medium · L = Low';

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

/** Every way to move the graph, for a mouse and for a laptop touchpad (no middle button needed). */
const CONTROLS: [string, string, string][] = [
  ['Turn the graph', 'Drag', 'Click and hold, then slide'],
  ['Move it sideways', 'Shift + drag, or right-click and drag', 'Shift + click and hold, then slide'],
  ['Zoom in or out', 'Ctrl + scroll wheel, or double-click', 'Pinch with two fingers, or double-tap'],
  ["See an asset's name", 'Point at a sphere', 'Point at a sphere'],
  ['Select an asset', 'Click a sphere', 'Tap a sphere'],
  ['Add a second blast radius', 'Shift + click a sphere', 'Shift + tap a sphere'],
  ['Scroll the page', 'Scroll wheel', 'Two-finger swipe'],
];

/** "Graph Controls" pop-up: opens over the graph, closes with its button or Escape. */
export function GraphControlsHelp({ onClose }: { onClose(): void }) {
  return (
    <div data-ui="1" role="dialog" aria-labelledby="gc-h" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      style={css(`position: absolute; top: 72px; right: 20px; z-index: 5; width: min(640px, calc(100% - 40px)); box-sizing: border-box; ${PANEL}; background: var(--popover-bg); box-shadow: var(--popover-shadow); border-radius: 8px; padding: 16px 20px 18px; cursor: default`)}>
      <div style={css('display: flex; align-items: center; justify-content: space-between; gap: 12px')}>
        <h2 id="gc-h" style={css('margin: 0; display: flex; align-items: center; gap: 8px; font-size: 18px; line-height: 24px; font-weight: 600; color: var(--text-strong)')}><Icon name="mouse" size={20} />Graph Controls</h2>
        <button type="button" autoFocus aria-label="Close the graph controls" onClick={onClose} style={css(`${BTN}; border-radius: 6px`)}><Icon name="close" /></button>
      </div>
      <table style={css('margin-top: 12px; width: 100%; border-collapse: collapse; font-size: 15px; line-height: 22px; color: var(--text)')}>
        <thead>
          <tr style={css('font-size: 14px; color: var(--text-3); text-align: left')}>
            <th scope="col" style={css('padding: 0 12px 6px 0; font-weight: 600')}>To</th>
            <th scope="col" style={css('padding: 0 12px 6px 0; font-weight: 600')}>Mouse</th>
            <th scope="col" style={css('padding: 0 0 6px 0; font-weight: 600')}>Laptop Touchpad</th>
          </tr>
        </thead>
        <tbody>
          {CONTROLS.map(([what, mouse, pad]) => (
            <tr key={what} style={css('border-top: 1px solid var(--divider)')}>
              <th scope="row" style={css('padding: 7px 12px 7px 0; font-weight: 600; text-align: left; vertical-align: top')}>{what}</th>
              <td style={css('padding: 7px 12px 7px 0; color: var(--text-2); vertical-align: top')}>{mouse}</td>
              <td style={css('padding: 7px 0; color: var(--text-2); vertical-align: top')}>{pad}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={css('margin: 12px 0 0; font-size: 14px; line-height: 20px; color: var(--text-3)')}>
        Buttons on the graph: rotate and auto-rotate, + and − to zoom, reset view, fit to screen, full screen, and 3D or Top-Down.
      </p>
    </div>
  );
}
