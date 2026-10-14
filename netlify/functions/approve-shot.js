// POST /.netlify/functions/approve-shot   body: { assetId }
// Marca una toma (asset) como aprobada tras el filtro humano de 1-2 minutos.
const { getSupabaseClient } = require('./_supabase');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const { assetId, assetIds } = JSON.parse(event.body || '{}');
    const supabase0 = getSupabaseClient();
    // Aprobar varias de una vez (botón "Aprobar todas"): { assetIds: [...] }
    if (Array.isArray(assetIds)) {
      const ids = assetIds.filter((x) => typeof x === 'string' && x).slice(0, 200);
      if (!ids.length) return { statusCode: 400, body: JSON.stringify({ error: 'Falta assetIds' }) };
      const { data, error } = await supabase0.from('assets')
        .update({ approved: true, approved_at: new Date().toISOString() })
        .in('id', ids).eq('approved', false).select('id');
      if (error) throw error;
      return { statusCode: 200, body: JSON.stringify({ approved: (data || []).length }) };
    }
    if (!assetId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Falta assetId' }) };
    }
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('assets')
      .update({ approved: true, approved_at: new Date().toISOString() })
      .eq('id', assetId)
      .select()
      .single();

    if (error) throw error;
    // 🧠 Aprobación INDIVIDUAL = Franklin revisó ESTA toma → evidencia para el cerebro (no bloquea si falla).
    try { if (data && data.kind === 'video_clip') await require('./_cerebro').franklinLive(supabase, { episodeId: data.episode_id, shotNumber: data.shot_number, clipId: data.id, ok: true }); } catch (_) {}
    return { statusCode: 200, body: JSON.stringify({ asset: data }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// Claves de la página Cuenta → API (cifradas en Supabase; mandan sobre el .env). Ver _keys.js.
exports.handler = require('./_keys').withKeys(exports.handler);
