// EDITAR UNA TOMA COMPLETA desde el panel (Franklin, oct-11: "si una escena sale mal, poder editarla completa
// desde ahí: la imagen, el prompt de la imagen y el de la escena, y regenerar"). Sin costo salvo "Detallar con IA".
//   GET  ?episode_id&shot                       → narración, prompts (imagen/movimiento/final/fondo/cámara), cuadro y video actuales
//   POST { episode_id, shot, fields }           → guarda los prompts; si cambia la imagen → frame_stale; si cambia el movimiento → clip_stale
//   POST { episode_id, shot, image_base64, mime }→ usa TU imagen como cuadro inicial (el video de esa toma queda por rehacer)
//   POST { episode_id, shot, action: 'detail' } → propone prompts súper detallados desde la narración (Gemini, ~$0.005; no guarda)
const { getSupabaseClient } = require('./_supabase');
const { checkDashboardKey } = require('./_auth');
const json = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });
const FIELDS = ['start_en', 'action_en', 'reaction_en', 'background_en', 'end_en', 'camera'];
const clean = (v) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').replace(/"/g, '').trim().slice(0, 2000);

exports.handler = async (event) => {
  const sb = getSupabaseClient();
  try {
    const q = event.queryStringParameters || {};
    const body = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : {};
    const epId = body.episode_id || q.episode_id;
    const n = Number(body.shot || q.shot);
    const { data: ep, error } = await sb.from('episodes').select('id, episode_number, series_id, shots, assets(id, kind, shot_number, storage_path, created_at, updated_at)').eq('id', epId || '').single();
    if (error || !ep) return json(404, { error: 'Episodio no encontrado.' });
    const shot = (ep.shots || []).find((s) => s.n === n);
    if (!shot) return json(404, { error: 'No existe la toma ' + n + '.' });
    const { lineOf } = require('./_visual_check');
    const last = (kind) => require('./_assets').newest((ep.assets || []).filter((a) => a.kind === kind && a.shot_number === n));

    if (event.httpMethod === 'GET') {
      return json(200, { n, line: lineOf(shot), camera_only: !!shot.camera_only, fields: Object.fromEntries(FIELDS.map((f) => [f, shot[f] || ''])), frame_stale: !!shot.frame_stale, clip_stale: !!shot.clip_stale,
        overrides: { image: !!shot.keyframe_prompt_override, video: !!shot.prompt_override }, detail_proposal: shot.detail_proposal || null, frame: (last('image') || {}).storage_path || null, clip: (last('video_clip') || {}).storage_path || null, clip_id: (last('video_clip') || {}).id || null });
    }
    const bad = checkDashboardKey(event);
    if (bad) return json(401, { error: bad });
    const { data: series } = await sb.from('series').select('id, slug, title, story_bible').eq('id', ep.series_id).single();
    const saveShot = async (patch) => {
      const { data: fr } = await sb.from('episodes').select('shots').eq('id', ep.id).single();
      await sb.from('episodes').update({ shots: (fr.shots || []).map((s) => (s.n === n ? Object.assign({}, s, patch) : s)) }).eq('id', ep.id);
    };

    // "No está bien" desde el panel: se marca la toma y el control de calidad la rehace con prompt reescrito por Claude
    // (y cuadro nuevo si hace falta), aunque su revisión automática la haya aprobado. $0 (king + Claude + Flow).
    if (body.action === 'qa_force') {
      const clip = last('video_clip');
      if (!clip) return json(400, { error: 'La toma todavía no tiene video.' });
      const reason = clean(body.reason || 'no está bien').slice(0, 300);
      await saveShot({ qa: Object.assign({}, shot.qa || {}, { force: true, force_reason: reason, clip_id: clip.id, ok: false, tries: Math.min(Number((shot.qa || {}).tries) || 0, 2) }) });
      const { data: open } = await sb.from('agent_jobs').select('id').in('status', ['pending', 'running']).like('command', 'qa_tomas:' + ep.id + '%').limit(1);
      if (!(open && open.length)) { const { error: qe } = await sb.from('agent_jobs').insert({ command: 'qa_tomas:' + ep.id }); if (qe) return json(500, { error: qe.message }); }
      return json(200, { queued: true });
    }

    if (body.action === 'detail' && !body.paid) { // GRATIS: Claude en la PC con tu plan; el resultado llega a shot.detail_proposal
      const { data: stt } = await sb.from('agent_state').select('last_seen').eq('id', 1).maybeSingle();
      if (!(stt && stt.last_seen && Date.now() - new Date(stt.last_seen).getTime() < 90000)) return json(200, { offline: true });
      const at = new Date().toISOString();
      await saveShot({ detail_request: { at, fields: Object.fromEntries(FIELDS.map((k) => [k, clean((body.fields || {})[k] != null ? body.fields[k] : shot[k])])) } });
      const { error: qe } = await sb.from('agent_jobs').insert({ command: 'claude_detalle:' + ep.id + ':' + n });
      if (qe) return json(500, { error: qe.message });
      return json(200, { queued: true, at });
    }
    if (body.action === 'detail') {
      const { checkVisuals } = require('./_visual_check');
      const aspect = series.story_bible && series.story_bible.aspect === '16:9' ? '16:9' : '9:16';
      const vc = await checkVisuals({ series, shots: [Object.assign({}, shot, body.fields || {})], rewriteStart: 'all', allowSplit: false, aspect, log: () => {} });
      const c = vc.changes[0] || {};
      try { await require('./_spend').logSpend(sb, { seriesId: series.id, episodeId: ep.id, shotNumber: n, kind: 'text', costUsd: vc.costUsd, note: 'detallar toma' }); } catch (_) {}
      return json(200, { fields: { start_en: c.start_en, action_en: c.action_en, reaction_en: c.reaction_en, background_en: c.background_en, end_en: c.end_en, camera: shot.camera || '' }, problema: c.ok === false ? c.problema : '', costUsd: vc.costUsd });
    }

    if (body.action === 'split') { // "Dividir en tomas": pedazos de la línea; Claude detalla los prompts de cada pedazo
      const { splitShotDb } = require('./_split');
      const lines = (body.lines || []).map((x) => String(x || '').trim()).filter(Boolean);
      const parts = lines.map((line, k) => (k === 0 ? Object.assign({ line }, Object.fromEntries(FIELDS.map((f) => [f, shot[f] || '']))) : { line, start_en: '', action_en: '', reaction_en: '', background_en: '', end_en: '', camera: shot.camera || '' }));
      const r = await splitShotDb(sb, ep.id, n, parts, () => {});
      const list = parts.map((_, k) => r.first + k).join(',');
      const { data: stt } = await sb.from('agent_state').select('last_seen').eq('id', 1).maybeSingle();
      const online = !!(stt && stt.last_seen && Date.now() - new Date(stt.last_seen).getTime() < 90000);
      if (online) await sb.from('agent_jobs').insert({ command: 'claude_revisar:' + ep.id + ':' + list });
      return json(200, { ok: true, shots: list, detailing: online });
    }
    if (body.image_base64) {
      const buf = Buffer.from(String(body.image_base64), 'base64');
      if (buf.length < 5000 || buf.length > 8e6) return json(400, { error: 'Imagen inválida (tamaño).' });
      const { storeKeyframeImage } = require('./_keyframe');
      const url = await storeKeyframeImage(sb, { series, episode: ep, shotN: n, image: { imageBytes: buf.toString('base64'), mimeType: body.mime || 'image/jpeg' }, note: 'imagen subida a mano' });
      await saveShot({ frame_stale: false, clip_stale: !!last('video_clip'), end_frame_url: null, end_frame_skip: false, own_image: true });
      return json(200, { ok: true, frame: url, clip_stale: !!last('video_clip') });
    }

    const f = body.fields || {};
    const patch = {};
    FIELDS.forEach((k) => { if (f[k] != null) patch[k] = clean(f[k]); });
    // "Solo cámara": objeto rígido (maqueta, mapa); LTX no lo deforma y el QA no le pide movimiento propio.
    const camChanged = f.camera_only != null && !!f.camera_only !== !!shot.camera_only;
    if (f.camera_only != null) patch.camera_only = !!f.camera_only;
    const imgChanged = patch.start_en != null && patch.start_en !== (shot.start_en || '');
    const vidChanged = ['action_en', 'reaction_en', 'background_en', 'end_en', 'camera'].some((k) => patch[k] != null && patch[k] !== (shot[k] || ''));
    // Lo que escribes aquí MANDA: se quitan los prompts "editados" viejos que lo pisarían.
    Object.assign(patch, { keyframe_prompt_override: null, prompt_override: null, edited_at: new Date().toISOString() });
    if (imgChanged) Object.assign(patch, { frame_stale: true, end_frame_url: null, end_frame_skip: false, own_image: false });
    if (imgChanged || vidChanged || camChanged) patch.clip_stale = !!last('video_clip');
    await saveShot(patch);
    return json(200, { ok: true, imgChanged, vidChanged });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
