// Small shared controls (Fluent 2 style: neutral, 1px borders, 4-6px corners, one icon set).
import {
  Add20Regular, ArrowClockwise20Regular, ArrowCounterclockwise20Regular, ArrowDownload20Regular, ArrowRight20Regular,
  ArrowUpload20Regular, Checkmark20Regular, CheckmarkCircle20Regular, ChevronDown20Regular, ChevronLeft20Regular,
  ChevronRight20Regular, Dismiss20Regular, DocumentTable20Regular, ErrorCircle20Regular, FullScreenMaximize20Regular,
  Info20Regular, Pause20Regular, Pin20Regular, Play20Regular, Subtract20Regular, Warning20Regular, WeatherMoon20Regular,
  WeatherSunny20Regular, ZoomFit20Regular, type FluentIcon,
} from '@fluentui/react-icons';
import { useApp } from '../state';
import { css } from './css';

export const LV = ['', 'L', 'M', 'H'];
export const LV_FULL = ['', 'Low', 'Medium', 'High'];
export const APP_TAGLINE = 'A Critical Asset Risk Management Dashboard for Enterprise Networks';

const MINOR_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);

/** Title Case for labels built in Python (e.g. "2D (weighted), blast radius (2 hops)" -> "2D (Weighted), Blast Radius (2 Hops)"). */
export function titleCase(s: string) {
  return s.replace(/[A-Za-z][\w']*/g, (w, at: number) => (at > 0 && MINOR_WORDS.has(w.toLowerCase()) ? w : w[0].toUpperCase() + w.slice(1)));
}

/** Ranking subtitle, e.g. "Ranks 1–10 · 2D · Weighted · Blast Radius: 2 Hops". */
export function rankingSubtitle(v: { dimension: string; weighted: boolean; scope: string }, from: number, to: number, depth: number, against: boolean) {
  const blast = v.scope === 'blast' ? ` · Blast Radius: ${depth} ${depth === 1 ? 'Hop' : 'Hops'}${against ? ' (Against Links)' : ''}` : '';
  return `Ranks ${from}–${to} · ${v.dimension.toUpperCase()} · ${v.weighted ? 'Weighted' : 'Unweighted'}${blast}`;
}

/** "Pareto front" as a link to its definition (opens in a new tab). */
export function ParetoLink({ text = 'Pareto front' }: { text?: string }) {
  return <a href="https://en.wikipedia.org/wiki/Pareto_front" target="_blank" rel="noopener noreferrer" style={css('color: var(--link); font-weight: 600')}>{text}</a>;
}

const SEG_ON = 'height: 28px; border: 0; border-radius: 4px; background: var(--seg-on-bg); color: var(--seg-on-text); font: inherit; font-size: 13px; font-weight: 600; box-shadow: var(--seg-on-shadow); white-space: nowrap';
const SEG_OFF = 'height: 28px; border: 0; border-radius: 4px; background: transparent; color: var(--seg-off-text); font: inherit; font-size: 13px; font-weight: 400; white-space: nowrap';

export function Segmented<const T extends string | number>(props: {
  options: { id: T; label: string; disabled?: boolean }[];
  value: NoInfer<T> | null;
  onChange(v: NoInfer<T>): void;
  label?: string;
  labelledBy?: string;
  /** Buttons share the width equally. */
  fill?: boolean;
  /** Long labels wrap onto a second line instead of overflowing. */
  wrap?: boolean;
  role?: 'group' | 'tablist';
}) {
  const pad = props.fill ? 'flex: 1; padding: 0 8px; ' : 'padding: 0 12px; ';
  const wrap = props.wrap ? '; min-height: 28px; height: auto; padding-top: 4px; padding-bottom: 4px; line-height: 16px; white-space: normal' : '';
  return (
    <div role={props.role ?? 'group'} aria-label={props.label} aria-labelledby={props.labelledBy}
      style={css('display: flex; gap: 2px; padding: 2px; background: var(--seg-bg); border-radius: 6px')}>
      {props.options.map((o) => {
        const on = o.id === props.value;
        return (
          <button key={String(o.id)} type="button" disabled={o.disabled}
            {...(props.role === 'tablist' ? { role: 'tab', 'aria-selected': on } : { 'aria-pressed': on })}
            onClick={() => props.onChange(o.id)} style={css(pad + (on ? SEG_ON : SEG_OFF) + wrap)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Centrality band chip (Low / Medium / High), the business-friendly stand-in for a score. */
export function BandChip({ band, size = 'md' }: { band: 'Low' | 'Medium' | 'High'; size?: 'sm' | 'md' }) {
  const k = band.toLowerCase();
  return (
    <span style={css(`display: inline-flex; align-items: center; height: ${size === 'sm' ? 20 : 24}px; padding: 0 8px; border-radius: 4px; background: var(--band-${k}-bg); color: var(--band-${k}); font-size: 12px; font-weight: 600; white-space: nowrap`)}>
      {band}
    </span>
  );
}

/** Circled L / M / H importance marker (the graph's own markers are drawn by the scene and stay as ported). */
export function LevelChip({ lv, alt = false }: { lv: number | string; alt?: boolean; size?: number }) {
  const text = typeof lv === 'number' ? LV[lv] : lv;
  return (
    <span style={css(`width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--chip-border); background: ${alt ? 'var(--chip-bg-alt)' : 'var(--chip-bg)'}; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: var(--chip-text); flex: none; box-sizing: border-box`)}>
      {text}
    </span>
  );
}

/** App header on every page: the name and what it stands for. */
export function AppBar() {
  return (
    <header style={css('height: 48px; padding: 0 24px; display: flex; align-items: baseline; gap: 12px; background: var(--surface); border-bottom: 1px solid var(--border); box-sizing: border-box')}>
      <span style={css('line-height: 48px; font-size: 16px; font-weight: 600; letter-spacing: 0.04em; color: var(--text-strong)')}>CARMA</span>
      <span style={css('font-size: 13px; color: var(--text-3)')}>{APP_TAGLINE}</span>
    </header>
  );
}

/** Page footer on Upload, Dashboard and Compare: who made CARMA. */
export function Footer() {
  return (
    <footer style={css('margin-top: auto; padding: 24px; border-top: 1px solid var(--border); background: var(--surface); text-align: center; font-size: 20px; line-height: 28px; color: var(--text-2)')}>
      Created by <span style={css('font-weight: 600; color: var(--text-strong)')}>Rudra Karadkhelkar</span>
      <span aria-hidden="true" style={css('margin: 0 12px; color: var(--text-3)')}>|</span>
      Concept: <span style={css('font-weight: 600; color: var(--text-strong)')}>Dr. Ranjan Pal</span>
    </footer>
  );
}

export function ThemeButton() {
  const { theme, toggleTheme } = useApp();
  const dark = theme === 'dark';
  return (
    <button type="button" onClick={toggleTheme} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title={dark ? 'Light theme' : 'Dark theme'}
      style={css('width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--control-border); border-radius: 4px; background: var(--control-bg); color: var(--text)')}>
      <Icon name={dark ? 'sun' : 'moon'} />
    </button>
  );
}

// One icon set (Fluent UI System Icons, Regular), one stroke weight.
const ICONS = {
  info: Info20Regular,
  upload: ArrowUpload20Regular,
  sheet: DocumentTable20Regular,
  check: Checkmark20Regular,
  checkCircle: CheckmarkCircle20Regular,
  close: Dismiss20Regular,
  warn: Warning20Regular,
  error: ErrorCircle20Regular,
  chevronDown: ChevronDown20Regular,
  chevronLeft: ChevronLeft20Regular,
  chevronRight: ChevronRight20Regular,
  arrowRight: ArrowRight20Regular,
  download: ArrowDownload20Regular,
  reset: ArrowCounterclockwise20Regular,
  rotateRight: ArrowClockwise20Regular,
  fit: ZoomFit20Regular,
  fullscreen: FullScreenMaximize20Regular,
  plus: Add20Regular,
  minus: Subtract20Regular,
  moon: WeatherMoon20Regular,
  sun: WeatherSunny20Regular,
  play: Play20Regular,
  pause: Pause20Regular,
  pin: Pin20Regular,
} satisfies Record<string, FluentIcon>;

export function Icon({ name, size = 16, stroke, style }: {
  name: keyof typeof ICONS; size?: number; stroke?: string; width?: number; style?: string;
}) {
  const C = ICONS[name];
  return <C aria-hidden="true" style={{ width: size, height: size, flex: 'none', color: stroke ?? 'currentColor', ...(style ? css(style) : null) }} />;
}
