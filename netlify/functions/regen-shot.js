// POST /.netlify/functions/regen-shot   body: { assetId }
// Punto de enganche para regenerar UNA toma puntual (no el episodio completo).
// Por ahora solo deja la marca en Supabase; cuando conectemos la API de Veo de
// verdad, aquí va la llamada que genera el nuevo clip y reemplaza storage_path.
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

    // TODO: aquí va la llamada real a la API de Veo (Google AI Studio / Vertex AI)
    // usando el mismo prompt guardado en assets.prompt, y luego subir el resultado
    // a Supabase Storage y actualizar storage_path con la nueva ruta.

    const { data, error } = await supabase
      .from('assets')
      .update({ approved: false })
      .eq('id', assetId)
      .select()
      .single();

    if (error) throw error;
    return {
      statusCode: 200,
      body: JSON.stringify({ asset: data, note: 'Marcado para regenerar — falta conectar la API de Veo.' })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
