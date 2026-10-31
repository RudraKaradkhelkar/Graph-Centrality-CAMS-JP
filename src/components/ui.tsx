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
  role?: 'group' | 'tablist';
}) {
  const pad = props.fill ? 'flex: 1; padding: 0 8px; ' : 'padding: 0 12px; ';
  return (
    <div role={props.role ?? 'group'} aria-label={props.label} aria-labelledby={props.labelledBy}
      style={css('display: flex; gap: 2px; padding: 2px; background: var(--seg-bg); border-radius: 6px')}>
      {props.options.map((o) => {
        const on = o.id === props.value;
        return (
          <button key={String(o.id)} type="button" disabled={o.disabled}
            {...(props.role === 'tablist' ? { role: 'tab', 'aria-selected': on } : { 'aria-pressed': on })}
            onClick={() => props.onChange(o.id)} style={css(pad + (on ? SEG_ON : SEG_OFF))}>
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
