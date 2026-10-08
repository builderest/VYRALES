// GET /.netlify/functions/tiktok-creator-info → datos del creador para el panel de publicar en TikTok
// (nombre, foto, opciones de privacidad, si tiene apagados comentarios/dúo/stitch, duración máxima).
// TikTok exige mostrarlos ANTES de publicar (reglas de UX de Direct Post).
const { getSupabaseClient } = require('./_supabase');
const { tiktokCreatorInfo } = require('./_social');
const { checkDashboardKey } = require('./_auth');
const json = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });
exports.handler = async (event) => {
  const denied = checkDashboardKey(event);
  if (denied) return json(401, { error: denied });
  try { return json(200, await tiktokCreatorInfo(getSupabaseClient())); }
  catch (err) { return json(400, { error: err.message }); }
};
