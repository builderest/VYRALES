// Una toma puede quedar con DOS videos (o dos cuadros) si se rehízo por caminos distintos (regen manual + QA):
// el panel, el editor y el render elegían uno al azar (T15 Toba: la tarjeta mostraba uno y el editor otro).
// Regla única: vale el MÁS RECIENTE (updated_at, o created_at si no hay).
const ts = (a) => String(a.updated_at || a.created_at || '');
function latestPerShot(assets, kinds = ['video_clip', 'image']) {
  const best = {};
  const out = [];
  for (const a of assets || []) {
    if (!kinds.includes(a.kind) || a.shot_number == null) { out.push(a); continue; }
    const k = a.kind + ':' + a.shot_number;
    if (!best[k] || ts(a) > ts(best[k])) best[k] = a;
  }
  return out.concat(Object.values(best));
}
const newest = (list) => (list || []).slice().sort((a, b) => ts(b).localeCompare(ts(a)))[0];
module.exports = { latestPerShot, newest, ts };
