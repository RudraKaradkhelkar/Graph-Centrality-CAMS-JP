// 3D network view. The ported scene maths (scene.ts) produces style strings; this component writes them to
// pooled DOM elements in requestAnimationFrame, so dragging and tweening never re-render React.
// Overlays (legend, selected asset bar, view controls) are rendered by the caller through `overlay`.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { GraphTheme } from './graph-theme';
import { DEFAULT_PITCH, DEFAULT_YAW } from './layout';
import { buildScene, H, W, type GatherCache, type Scene, type SceneData } from './scene';

export interface CameraInfo {
  zoomPct: string;
  gizmo: Scene['gizmo'];
  nameTier: number;
  auto: boolean;
}

export interface GraphControls {
  zoomIn(): void;
  zoomOut(): void;
  resetView(): void;
  fitView(): void;
  rotL(): void;
  rotR(): void;
  toggleAuto(): void;
  fullScreen(): void;
}

export interface TipContent {
  title: string;
  line: string;
}

interface Props {
  data: SceneData;
  fitZ: number;
  /** Fit zoom from the height alone (layout fitH): lets Fit to screen follow a shorter viewport. */
  fitH?: number;
  /** Zoom the view opens (and Reset view returns) at. The reference uses 1 (100%); 'fit' = Fit to screen. */
  startZoom?: number | 'fit';
  /** Height in px (or a CSS length); the drawing stays centred and the empty space above and below is trimmed. Default: 1400:1200. */
  height?: number | string;
  /** Start rotating on mount (Present mode). */
  autoRotate?: boolean;
  /** Auto-rotate speed in degrees per second. */
  rotateSpeed?: number;
  theme: GraphTheme;
  sel: number;
  from: number;
  to: number;
  weighted: boolean;
  showLevels: boolean;
  sizeByScore: boolean;
  gatherCone: boolean;
  /** Assets whose blast cones are shown (empty = none; two = side-by-side blast radii). */
  blastTargets: number[];
  /** When this changes to a non-empty value, the camera frames the blast cones once they have settled. */
  frameKey?: string;
  /** Shared camera: views with the same link rotate, zoom and pan together (Compare 1D vs 2D). */
  link?: CameraLink;
  view: '3d' | 'flat';
  /** false: the drawing stays where it is (no panning); dragging only turns it and zoom centres on its pivot. */
  pannable?: boolean;
  labelStyle: 'inside' | 'badge';
  ariaLabel: (k: number) => string;
  tip: (k: number) => TipContent;
  /** shift = Shift was held (Shift-click pins for a second blast radius). */
  onSelect: (k: number, shift: boolean) => void;
  overlay: (info: CameraInfo, controls: GraphControls) => ReactNode;
}

export interface Cam { yaw: number; pitch: number; z: number; px: number; py: number }

/** One camera shared by several graph views; each view redraws when another one moves it. */
export class CameraLink {
  readonly ref: { current: Cam };
  /** Auto-rotate clock shared by the linked views, so they turn together and any of them can stop it. */
  readonly auto: { current: number | null } = { current: null };
  private subs = new Set<() => void>();
  constructor(start: Partial<Cam> = {}) {
    this.ref = { current: { yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH, z: 1, px: 0, py: 0, ...start } };
  }
  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }
  moved(from: () => void) {
    this.subs.forEach((fn) => { if (fn !== from) fn(); });
  }
}
type Pooled = HTMLElement & { _s?: string; _t?: string };

const MORPH_MS = 700;
/** The Play button's speed (the reference's 0.5 degrees per 33 ms). */
const AUTO_SPEED = 0.5 / 33 * 1000;

function setStyle(el: Pooled, s: string) {
  if (el._s !== s) { el.style.cssText = s; el._s = s; }
}
function setText(el: Pooled, t: string) {
  if (el._t !== t) { el.textContent = t; el._t = t; }
}
function pool<T>(layer: HTMLElement, items: T[], make: () => HTMLElement, apply: (el: Pooled, item: T, i: number) => void) {
  while (layer.children.length < items.length) layer.appendChild(make());
  while (layer.children.length > items.length) layer.lastChild!.remove();
  items.forEach((item, i) => apply(layer.children[i] as Pooled, item, i));
}
const el = (tag: string, ...kids: HTMLElement[]) => { const e = document.createElement(tag); kids.forEach((k) => e.appendChild(k)); return e; };

export function GraphView(props: Props) {
  const vpRef = useRef<HTMLElement>(null);
  const L = {
    grid: useRef<HTMLDivElement>(null), coneBack: useRef<HTMLDivElement>(null), edges: useRef<HTMLDivElement>(null),
    elabels: useRef<HTMLDivElement>(null), nodes: useRef<HTMLDivElement>(null), names: useRef<HTMLDivElement>(null),
    coneLabels: useRef<HTMLDivElement>(null), tip: useRef<HTMLDivElement>(null),
  };
  const ownCam = useRef<Cam>({ yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH, z: props.startZoom === 'fit' ? props.fitZ : props.startZoom ?? 1, px: 0, py: 0 });
  const cam = props.link ? props.link.ref : ownCam;
  const propsRef = useRef(props);
  propsRef.current = props;
  const hover = useRef<number | null>(null);
  const drag = useRef<null | { mode: 'pan' | 'rot'; x: number; y: number; k: number } & Cam>(null);
  const moved = useRef(false);
  const tween = useRef<null | { from: Cam; to: Partial<Cam>; t0: number; dur: number }>(null);
  const ownAuto = useRef<number | null>(null);
  const auto = props.link ? props.link.auto : ownAuto;
  // Virtual height of the viewport (its width is always W), measured from the element.
  const vh = useRef(H);
  // While true the zoom follows the viewport's shape (opened at, or last set to, Fit to screen).
  const autoFit = useRef(props.startZoom === 'fit');
  const morph = useRef<{ from: number[]; to: number[]; m0: number } | null>(null);
  const frame = useRef(0);
  const frameKey = useRef('');
  const pendingFrame = useRef(false);
  // Cone layouts, per data set. Looked up when drawing (not captured at render time): a frame scheduled before the
  // data changed must not reuse the previous data's cones.
  const caches = useRef<{ data: SceneData; map: GatherCache } | null>(null);
  const cacheFor = (data: SceneData) => {
    if (caches.current?.data !== data) caches.current = { data, map: new Map() };
    return caches.current.map;
  };
  // Ends a drag in progress (window listeners): kept so unmounting mid-drag cleans up.
  const endDrag = useRef<(() => void) | null>(null);
  const [info, setInfo] = useState<CameraInfo>({ zoomPct: '100%', gizmo: [], nameTier: 10, auto: false });
  const [dragging, setDragging] = useState(false);

  const schedule = () => { if (!frame.current) frame.current = requestAnimationFrame(render); };
  // Linked views: redraw when the other view moves the shared camera, and tell it when this one draws.
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;
  const fromLink = useRef(false);
  const onLink = useRef(() => { fromLink.current = true; scheduleRef.current(); }).current;

  function render(now: number) {
    frame.current = 0;
    const p = propsRef.current;
    let again = false;
    const c = cam.current;
    if (tween.current) {
      const t = tween.current, k = Math.min(1, (now - t.t0) / t.dur), e = 1 - Math.pow(1 - k, 3);
      (Object.keys(t.to) as (keyof Cam)[]).forEach((key) => { c[key] = t.from[key] + (t.to[key]! - t.from[key]) * e; });
      if (k >= 1) tween.current = null; else again = true;
    }
    if (auto.current != null) {
      c.yaw += (p.rotateSpeed ?? AUTO_SPEED) * (now - auto.current) / 1000;
      auto.current = now;
      again = true;
    }
    const m = morph.current!;
    const mt = m.m0 ? Math.min(1, (now - m.m0) / MORPH_MS) : 1;
    if (mt < 1) again = true;
    const sc = buildScene(p.data, {
      view: p.view, z: c.z, px: c.px, py: c.py, yaw: c.yaw, pitch: c.pitch, weighted: p.weighted, showLevels: p.showLevels,
      sizeByScore: p.sizeByScore, gatherCone: p.gatherCone, sel: p.sel, from: p.from, to: p.to, labelStyle: p.labelStyle,
      hover: drag.current ? null : hover.current, gFrom: m.from, gTo: m.to, mt, vh: vh.current,
    }, p.theme, cacheFor(p.data));
    apply(sc, p);
    if (pendingFrame.current && mt >= 1 && sc.focus) {
      // Fit the blast cones in view (leaving room for the overlays), keeping the current rotation.
      pendingFrame.current = false;
      const [x0, y0, x1, y1] = sc.focus, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const f = Math.min(W * 0.8 / Math.max(1, x1 - x0), vh.current * 0.66 / Math.max(1, y1 - y0));
      const zt = zoomTarget(cx, cy, c.z * f);
      autoFit.current = false;
      startTween({ z: zt.z, px: zt.px! + (W / 2 - cx), py: zt.py! + (vh.current / 2 + 20 - cy) }, 500);
      again = true;
    }
    setInfo((old) => {
      const next = { zoomPct: Math.round(c.z * 100) + '%', gizmo: sc.gizmo, nameTier: sc.nameTier, auto: auto.current != null };
      const same = old.zoomPct === next.zoomPct && old.nameTier === next.nameTier && old.auto === next.auto &&
        old.gizmo.length === next.gizmo.length && old.gizmo.every((g, i) => g.s === next.gizmo[i].s);
      return same ? old : next;
    });
    if (p.link && !fromLink.current) p.link.moved(onLink);
    fromLink.current = false;
    if (again) schedule();
  }

  function apply(sc: Scene, p: Props) {
    pool(L.grid.current!, sc.grid, () => el('div'), (e, s) => setStyle(e, s));
    pool(L.coneBack.current!, sc.cones, () => el('div'), (e, c) => {
      setStyle(e, 'position: absolute; inset: 0; pointer-events: none; opacity: ' + c.op);
      pool(e, [c.fill, ...c.discs, ...c.dashes], () => el('div'), (part, css) => setStyle(part, css));
    });
    pool(L.edges.current!, sc.edges, () => el('div', el('span')), (e, it) => {
      setStyle(e, it.s);
      setStyle(e.firstChild as Pooled, it.a);
    });
    pool(L.elabels.current!, sc.elabels, () => el('div'), (e, it) => { setStyle(e, it.s); setText(e, it.t); });
    pool(L.nodes.current!, sc.nodes, () => { const b = el('button', el('span')); (b as HTMLButtonElement).type = 'button'; return b; }, (e, it) => {
      setStyle(e, it.s);
      if (e.dataset.k !== String(it.k)) { e.dataset.k = String(it.k); e.setAttribute('aria-label', p.ariaLabel(it.k)); }
      const span = e.firstChild as Pooled;
      setStyle(span, it.ls);
      setText(span, it.lab);
    });
    pool(L.names.current!, sc.names, () => el('div', el('span'), el('span')), (e, it) => {
      setStyle(e, it.s);
      setStyle(e.children[0] as Pooled, it.is); setText(e.children[0] as Pooled, it.id);
      setStyle(e.children[1] as Pooled, it.ns); setText(e.children[1] as Pooled, it.nm);
    });
    pool(L.coneLabels.current!, sc.cones.flatMap((c) => c.labels), () => el('div', el('span')), (e, it) => {
      setStyle(e, it.s);
      const span = e.firstChild as Pooled;
      span.className = 'graph-cone-label';
      setText(span, it.t);
    });
    const tipEl = L.tip.current! as Pooled;
    if (sc.tip) {
      const t = p.tip(sc.tip.k);
      setStyle(tipEl, sc.tip.s);
      setText(tipEl.querySelector('.graph-tip-title') as Pooled, t.title);
      setText(tipEl.querySelector('.graph-tip-line') as Pooled, t.line);
    } else setStyle(tipEl, 'display: none');
  }

  // Blast layout morph whenever the set of blast assets changes.
  if ((props.frameKey ?? '') !== frameKey.current) {
    frameKey.current = props.frameKey ?? '';
    pendingFrame.current = frameKey.current !== '';
  }
  const targets = props.blastTargets;
  if (!morph.current) morph.current = { from: targets, to: targets, m0: 0 };
  else if (targets.join() !== morph.current.to.join()) morph.current = { from: morph.current.to, to: targets, m0: performance.now() };

  useEffect(schedule);
  useEffect(() => () => { cancelAnimationFrame(frame.current); frame.current = 0; }, []);
  useEffect(() => { if (props.autoRotate) { auto.current = performance.now(); schedule(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Follow the element's shape: the drawing stays centred, and a fitted view re-fits.
  useLayoutEffect(() => {
    const vp = vpRef.current!;
    const measure = () => {
      const r = vp.getBoundingClientRect();
      if (!r.width) return;
      vh.current = W * r.height / r.width;
      if (autoFit.current && !props.link) { const z = fitAt(); Object.assign(cam.current, { z, py: fitPy(z) }); }
      // A drawing that can't be panned (Blast Radius in 3D) is framed again whenever its box changes size.
      if (propsRef.current.pannable === false && frameKey.current) pendingFrame.current = true;
      schedule();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => props.link?.subscribe(onLink), [props.link, onLink]);

  const pt = (e: { clientX: number; clientY: number }) => {
    const r = vpRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * vh.current, k: W / r.width };
  };
  const fitAt = () => {
    const p = propsRef.current;
    return p.fitH ? Math.min(p.fitZ, p.fitH * (vh.current - 220) / 980) : p.fitZ;
  };
  // Vertical pan that keeps the network centred at zoom z (the layout centres it at zoom 1).
  const fitPy = (z: number) => -(propsRef.current.data.CY - H / 2) * (1 - z);
  const zoomTarget = (x: number, y: number, nz: number): Partial<Cam> => {
    const v = cam.current, t = Math.max(0.2, Math.min(12, nz)), CX = propsRef.current.data.CX, CY = propsRef.current.data.CY + (vh.current - H) / 2;
    return { z: t, px: x - CX - (x - CX - v.px) * t / v.z, py: y - CY - (y - CY - v.py) * t / v.z };
  };
  // Where zooming centres: the given point, or (no panning) the pivot, so the drawing never moves sideways.
  const anchor = (x: number, y: number) => propsRef.current.pannable === false
    ? { x: propsRef.current.data.CX + cam.current.px, y: propsRef.current.data.CY + (vh.current - H) / 2 + cam.current.py }
    : { x, y };
  const startTween = (to: Partial<Cam>, dur = 300) => { tween.current = { from: { ...cam.current }, to, t0: performance.now(), dur }; schedule(); };
  const stopAuto = () => { auto.current = null; autoFit.current = false; schedule(); };
  const isUI = (e: { target: EventTarget | null }) => !!(e.target as HTMLElement)?.closest?.('[data-ui]');

  useEffect(() => {
    const vp = vpRef.current!;
    const onWheel = (e: WheelEvent) => {
      // While dragging, scrolling must not move the page under the graph.
      if (drag.current) { e.preventDefault(); return; }
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const p = pt(e), a = anchor(p.x, p.y);
      tween.current = null;
      autoFit.current = false;
      Object.assign(cam.current, zoomTarget(a.x, a.y, cam.current.z * Math.exp(-e.deltaY * 0.0022)));
      schedule();
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => { vp.removeEventListener('wheel', onWheel); endDrag.current?.(); };
  }, []);

  const controls: GraphControls = {
    zoomIn: () => { const a = anchor(W / 2, vh.current / 2); autoFit.current = false; startTween(zoomTarget(a.x, a.y, cam.current.z * 1.5)); },
    zoomOut: () => { const a = anchor(W / 2, vh.current / 2); autoFit.current = false; startTween(zoomTarget(a.x, a.y, cam.current.z / 1.5)); },
    resetView: () => {
      const s = propsRef.current.startZoom;
      auto.current = null;
      autoFit.current = s === 'fit';
      const z = s === 'fit' ? fitAt() : s ?? 1;
      startTween({ yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH, z, px: 0, py: s === 'fit' ? fitPy(z) : 0 }, 450);
    },
    fitView: () => { const z = fitAt(); autoFit.current = true; startTween({ z, px: 0, py: fitPy(z) }); },
    rotL: () => { auto.current = null; startTween({ yaw: cam.current.yaw - 30 }); },
    rotR: () => { auto.current = null; startTween({ yaw: cam.current.yaw + 30 }); },
    toggleAuto: () => { auto.current = auto.current == null ? performance.now() : null; schedule(); },
    fullScreen: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void vpRef.current?.requestFullscreen();
    },
  };

  const nodeOf = (t: EventTarget | null) => {
    const b = (t as HTMLElement)?.closest?.('[data-k]') as HTMLElement | null;
    return b ? Number(b.dataset.k) : null;
  };

  return (
    <section
      ref={vpRef}
      className="graph-viewport"
      aria-label={props.pannable === false ? '3D view. Hover a sphere for its name, drag to rotate, Ctrl and scroll to zoom.' : '3D network view. Hover a sphere for its name, click to select, drag to rotate, Shift and drag to pan, Ctrl and scroll to zoom.'}
      style={{ cursor: dragging ? 'grabbing' : 'grab', ...(props.height ? { height: props.height, aspectRatio: 'auto' } : null) }}
      onPointerDown={(e) => {
        moved.current = false;
        if (isUI(e) || (e.pointerType === 'mouse' && e.button > 2) || drag.current) return;
        stopAuto();
        tween.current = null;
        const pan = props.pannable !== false && (e.shiftKey || e.button === 1 || e.button === 2);
        drag.current = { mode: pan ? 'pan' : 'rot', x: e.clientX, y: e.clientY, k: pt(e).k, ...cam.current };
        hover.current = null;
        setDragging(true);
        // Follow the pointer on the whole window: the drag carries on past the graph's edges (the cursor is never
        // locked) and ends wherever the button is released.
        const id = e.pointerId;
        const move = (ev: PointerEvent) => {
          const d = drag.current;
          if (!d || ev.pointerId !== id) return;
          const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true;
          if (d.mode === 'pan') Object.assign(cam.current, { px: d.px + dx * d.k, py: d.py + dy * d.k });
          else Object.assign(cam.current, { yaw: d.yaw + dx * 0.35, pitch: Math.max(-89, Math.min(15, d.pitch - dy * 0.3)) });
          schedule();
        };
        const up = (ev: PointerEvent) => { if (ev.pointerId === id) finish(); };
        const finish = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
          endDrag.current = null;
          drag.current = null;
          setDragging(false);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        endDrag.current = finish;
      }}
      // Middle button: pans like the right button, instead of starting the browser's autoscroll (which moves the page).
      onMouseDown={(e) => { if (e.button === 1 && !isUI(e)) e.preventDefault(); }}
      onAuxClick={(e) => { if (e.button === 1 && !isUI(e)) e.preventDefault(); }}
      onDoubleClick={(e) => { if (isUI(e)) return; const p = pt(e), a = anchor(p.x, p.y); autoFit.current = false; startTween(zoomTarget(a.x, a.y, cam.current.z * 1.8)); }}
      onContextMenu={(e) => { if (!isUI(e)) e.preventDefault(); }}
    >
      <div ref={L.grid} aria-hidden="true" className="graph-layer" />
      <div ref={L.coneBack} aria-hidden="true" className="graph-layer" />
      <div aria-hidden="true" className="graph-layer">
        <div ref={L.edges} />
        <div ref={L.elabels} />
      </div>
      <div
        ref={L.nodes}
        className="graph-layer graph-nodes"
        onClick={(e) => { const k = nodeOf(e.target); if (k != null && !moved.current) propsRef.current.onSelect(k, e.shiftKey); }}
        onMouseOver={(e) => { const k = nodeOf(e.target); if (k != null && !drag.current && hover.current !== k) { hover.current = k; schedule(); } }}
        onMouseOut={(e) => { if (nodeOf(e.target) != null && nodeOf(e.relatedTarget) == null) { hover.current = null; schedule(); } }}
      />
      <div ref={L.names} aria-hidden="true" className="graph-layer" />
      <div ref={L.coneLabels} aria-hidden="true" className="graph-layer" />
      <div ref={L.tip} style={{ display: 'none' }}>
        <div className="graph-tip">
          <div className="graph-tip-title" />
          <div className="graph-tip-line" />
        </div>
      </div>
      {props.overlay(info, controls)}
    </section>
  );
}
