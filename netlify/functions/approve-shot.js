// POST /.netlify/functions/approve-shot   body: { assetId }
// Marca una toma (asset) como aprobada tras el filtro humano de 1-2 minutos.
const { getSupabaseClient } = require('./_supabase');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const { assetId } = JSON.parse(event.body || '{}');
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
