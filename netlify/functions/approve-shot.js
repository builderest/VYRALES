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
    return { statusCode: 200, body: JSON.stringify({ asset: data }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
