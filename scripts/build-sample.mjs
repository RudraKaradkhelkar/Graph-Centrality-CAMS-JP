// One-off: builds the committed, made-up sample network and the pytest fixture from the
// reference design (reference/ is local only, so this script only runs where it exists).
//   public/sample/regional-grid.xlsx      Links + Assets sheets (with Asset type and X/Y/Z)
//   metrics/fixtures/reference_1d.json   analyze() input + the reference _derive() 1D values
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'reference/V3-Dashboard.dc.html'), 'utf8');
const src = html.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*?)<\/script>/)[1];
const Component = new Function('DCLogic', `${src}; return Component;`)(class {});
const ref = new Component();
const raw = ref._raw();
const D = ref._derive(raw);

const TYPE_NAMES = ['Power', 'Control', 'Network'];
const ASSET_TYPES = {
  CC: 'Control center', GEN: 'Generation', TSS: 'Transmission substation',
  DSS: 'Distribution substation', RTU: 'Field RTU', COM: 'Communications',
};
// The reference truncates three long names; the upload design shows them in full.
const FULL_NAMES = {
  'TSS-009': 'Granite Falls Transmission Substation East Yard',
  'DSS-012': 'Hollis Distribution Substation Feeder Bank B',
  'COM-022': 'Core Router 22 Northern Backbone Ring',
};

const ids = raw.N.map((n) => n[0]);
const importance = raw.N.map((n) => n[4]);
const links = [];
for (let k = 0; k < raw.E.length; k += 4) {
  const a = raw.E[k], b = raw.E[k + 1];
  links.push({
    source: ids[a], target: ids[b], type: TYPE_NAMES[raw.E[k + 3]], importance: raw.E[k + 2],
    source_importance: importance[a], target_importance: importance[b],
  });
}
const assets = raw.N.map((n, i) => ({
  id: n[0], name: FULL_NAMES[n[0]] ?? raw.NM[i], type: ASSET_TYPES[n[0].split('-')[0]],
  x: n[1], y: n[2], z: n[3],
}));

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(links.map((l) => ({
  Source: l.source, Target: l.target, 'Edge type': l.type, 'Edge importance': l.importance,
  'Source asset importance': l.source_importance, 'Target asset importance': l.target_importance,
}))), 'Links');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(assets.map((a) => ({
  'Asset ID': a.id, 'Asset name': a.name, 'Asset type': a.type, X: a.x, Y: a.y, Z: a.z,
}))), 'Assets');
fs.mkdirSync(path.join(root, 'public/sample'), { recursive: true });
fs.writeFileSync(path.join(root, 'public/sample/regional-grid.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

// D.V[i] holds (score, rank) pairs in the order 1U 1W 2U 2W 1UB 1WB 2UB 2WB; D.F[i] = [out, in, h1, h2, high].
const expected = ids.map((id, i) => ({
  id,
  '1U': D.V[i][0], '1U_rank': D.V[i][1], '1W': D.V[i][2], '1W_rank': D.V[i][3],
  '1UB': D.V[i][8], '1UB_rank': D.V[i][9], '1WB': D.V[i][10], '1WB_rank': D.V[i][11],
  out: D.F[i][0], in: D.F[i][1], hop1: D.F[i][2], hop2: D.F[i][3], high: D.F[i][4],
}));
fs.mkdirSync(path.join(root, 'metrics/fixtures'), { recursive: true });
fs.writeFileSync(path.join(root, 'metrics/fixtures/reference_1d.json'), JSON.stringify({
  note: 'Made-up sample network. Expected values come from the V3 reference _derive(), which divides edge importance by 3.',
  assets: ids.map((id, i) => ({ id, importance: importance[i] })), links, expected,
}, null, 1));
console.log(`Wrote ${links.length} links, ${assets.length} assets.`);
