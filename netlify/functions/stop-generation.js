// POST /.netlify/functions/stop-generation  { episode_id }
// Pide detener la generación en curso (videos o cuadros) de un episodio. La corrida lo revisa
// antes de cada toma: la que ya se está generando termina; las siguientes no se mandan.
// Si la corrida ya no existe (servidor cerrado con Ctrl+C), libera el estado del episodio.
const { getSupabaseClient } = require('./_supabase');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const body = JSON.parse(event.body || '{}');
    const supabase = getSupabaseClient();
    const { data: ep, error } = await supabase.from('episodes').select('id, status, validator_report, updated_at').eq('id', body.episode_id || '').single();
    if (error || !ep) return json(404, { error: 'Episodio no encontrado.' });
    const vr = Object.assign({}, ep.validator_report || {}, { stop_requested_at: new Date().toISOString() });
    const patch = { validator_report: vr };
    // force: el usuario confirma que el proceso ya murió (p. ej. cerró el servidor).
    if (body.force && ep.status === 'generando_media') patch.status = 'guion_generado';
    const { error: uErr } = await supabase.from('episodes').update(patch).eq('id', ep.id);
    if (uErr) throw uErr;
    return json(200, { ok: true, released: !!patch.status });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
