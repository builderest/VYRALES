// POST /.netlify/functions/move-keyframe   { episode_id, from, to }
// Mueve el cuadro inicial (y su prompt editado) de una toma a otra, sin generar nada ($0).
// Sirve cuando un prompt se pegó en la toma equivocada pero la imagen salió bien.
// Si la toma destino ya tenía cuadro, ese se reemplaza (su archivo se borra del Storage).
// La toma origen queda sin cuadro y con su prompt automático.
const { getSupabaseClient } = require('./_supabase');
const { removeByPublicUrl } = require('./_storage');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const { episode_id: episodeId, from, to } = JSON.parse(event.body || '{}');
    const a = Number(from), b = Number(to);
    if (!episodeId || !a || !b || a === b) return json(400, { error: 'Manda episode_id, from y to (distintos).' });
    const supabase = getSupabaseClient();
    const { data: ep, error } = await supabase.from('episodes').select('id, status, shots').eq('id', episodeId).single();
    if (error || !ep) return json(404, { error: 'Episodio no encontrado.' });
    if (ep.status === 'generando_media') return json(409, { error: 'El episodio se está generando; espera a que termine.' });
    const shots = Array.isArray(ep.shots) ? ep.shots.map((s) => ({ ...s })) : [];
    const sa = shots.find((s) => s.n === a), sb = shots.find((s) => s.n === b);
    if (!sa || !sb) return json(400, { error: 'El episodio no tiene esas tomas.' });

    const { data: frames } = await supabase.from('assets').select('id, shot_number, storage_path').eq('episode_id', episodeId).eq('kind', 'image').in('shot_number', [a, b]);
    const src = (frames || []).find((f) => f.shot_number === a);
    const dst = (frames || []).find((f) => f.shot_number === b);
    if (!src) return json(400, { error: `La toma ${a} no tiene cuadro.` });

    if (dst) {
      const { error: delErr } = await supabase.from('assets').delete().eq('id', dst.id);
      if (delErr) throw delErr;
      await removeByPublicUrl(supabase, dst.storage_path);
    }
    const { error: mvErr } = await supabase.from('assets').update({ shot_number: b, approved: false, approved_at: null }).eq('id', src.id);
    if (mvErr) throw mvErr;

    if (sa.keyframe_prompt_override) sb.keyframe_prompt_override = sa.keyframe_prompt_override; else delete sb.keyframe_prompt_override;
    delete sa.keyframe_prompt_override;
    const { error: upErr } = await supabase.from('episodes').update({ shots }).eq('id', episodeId);
    if (upErr) throw upErr;
    console.log('[move-keyframe]', episodeId, `cuadro ${a} → ${b}`, dst ? '(reemplazó el anterior)' : '');
    return json(200, { moved: { from: a, to: b }, replaced: !!dst });
  } catch (err) {
    console.error('[move-keyframe] ERROR:', err);
    return json(500, { error: err.message });
  }
};
