// 3D graph palettes, copied verbatim from the V3 reference (light and dark). Do not restyle.

export interface GraphTheme {
  bg: string;
  grid: string;
  sph: [string, string, string, string][];
  org: [string, string, string, string];
  glow: string;
  shadow: string;
  ring: string;
  ringGap: string;
  halo: string;
  e0: [string, string, string];
  e1: [string, string, string];
  e2: [string, string, string];
  cone: string;
  coneA: [number, number, number, number, number];
  lblBg: string;
  lblBorder: string;
  lblText: string;
  lblHop: string;
  badgeBg: string;
  badgeText: string;
  gx: [string, string, string];
  gizmoText: string;
  nameTop: string;
  nameRest: string;
  nameHalo: string;
}

export const LIGHT: GraphTheme = {
  bg: '#FFFFFF', grid: '100, 116, 139, 0.16',
  sph: [['#EEF5FE', '#86B6EF', '#4F7FBF', '#0B1F3A'], ['#E3EEFD', '#5598E7', '#2E62A8', '#0B1F3A'], ['#D6E6FB', '#2A78D6', '#174A8C', '#FFFFFF'], ['#C9DDF8', '#1C5CAB', '#0D3366', '#FFFFFF']],
  org: ['#FFE3D1', '#EB6834', '#9E3A12', '#2A1205'], glow: '', shadow: '0 2px 4px rgba(16, 24, 40, 0.22)',
  ring: '#16181D', ringGap: '#FFFFFF', halo: 'rgba(15, 98, 214, 0.14)',
  e0: ['#E1E6EC', '#A7B1BF', '#717C8C'], e1: ['#B9D5FB', '#2A78D6', '#164A8F'], e2: ['#D6E6FB', '#7FAEEA', '#4F7FBF'],
  cone: '235, 104, 52', coneA: [0.30, 0.16, 0.06, 0.10, 0.05],
  lblBg: '#FFFFFF', lblBorder: '#C3C9D2', lblText: '#2B3340', lblHop: '#2A78D6', badgeBg: '#16181D', badgeText: '#FFFFFF',
  gx: ['194, 65, 12', '21, 128, 61', '29, 78, 216'], gizmoText: '78, 85, 98',
  nameTop: '#16181D', nameRest: '#4E5562', nameHalo: '#FFFFFF',
};

export const DARK: GraphTheme = {
  bg: '#0A0C10', grid: '140, 155, 180, 0.10',
  sph: [['#FFFFFF', '#E4E8EE', '#8D96A5', '#141821'], ['#FFFFFF', '#E4E8EE', '#8D96A5', '#141821'], ['#FFFFFF', '#E4E8EE', '#8D96A5', '#141821'], ['#FFFFFF', '#E4E8EE', '#8D96A5', '#141821']],
  org: ['#FFE6CC', '#FF7A1A', '#B84300', '#1A0A00'], glow: '0 0 14px rgba(255, 122, 26, 0.6)', shadow: '0 2px 6px rgba(0, 0, 0, 0.5)',
  ring: '#FFFFFF', ringGap: '#0A0C10', halo: 'rgba(255, 255, 255, 0.12)',
  e0: ['#A3ACBA', '#667082', '#3A4250'], e1: ['#D6E8FF', '#8AB8FF', '#3D6FB8'], e2: ['#C2D8F5', '#6E9BD8', '#33598F'],
  cone: '255, 122, 26', coneA: [0.46, 0.24, 0.1, 0.14, 0.07],
  lblBg: '#1E222A', lblBorder: '#3A404B', lblText: '#E8EAEE', lblHop: '#8AB8FF', badgeBg: '#FFFFFF', badgeText: '#141821',
  gx: ['232, 131, 106', '127, 203, 154', '127, 176, 240'], gizmoText: '201, 208, 218',
  nameTop: '#F2F4F7', nameRest: '#AEB5C0', nameHalo: '#0A0C10',
};
