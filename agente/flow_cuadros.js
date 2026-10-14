// CUADROS INICIALES DE UN EPISODIO CON GOOGLE FLOW, TODOS EN UNA SOLA SESIÓN, y luego videos en king.
//   node agente/flow_cuadros.js <episode_id> 1,3,5   (tomas; sin lista = todas)
// Cada toma usa su start_en. El cuadro final se rehace editando el nuevo inicial (FLUX en king). $0.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
(async () => {
  const args = process.argv.slice(2);
  const solo = args[0] === 'solo'; if (solo) args.shift(); // solo cuadros (botón del panel), sin videos
  const [epId, list] = args;
  if (!/^[0-9a-f-]{36}$/i.test(epId || '')) throw new Error('Uso: node agente/flow_cuadros.js <episode_id> [1,3,5]');
  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const { storeKeyframeImage } = require(path.join(ROOT, 'netlify', 'functions', '_keyframe'));
  const { flowImages } = require('./flow_imagenes');
  const supabase = getSupabaseClient();
  // Revisor IMAGEN = NARRACIÓN (una vez por episodio): corrige los start_en que no muestran lo que dice el narrador.
  // GRATIS: el revisor usa Claude en esta PC (tu plan); Gemini (de pago) solo si Claude no está disponible.
  let llm = null; try { const C = require('./_claude'); if (C.claudePath()) llm = C.claudeLlm(console.log); } catch (_) {}
  try { await require(path.join(ROOT, 'netlify', 'functions', '_visual_check')).reviewEpisode(supabase, { episodeId: epId, llm, engine: llm ? 'claude' : 'gemini', log: console.log }); }
  catch (e) { if (llm) { console.log('Revisor con Claude falló (' + String(e.message).slice(0, 120) + ') → intento con Gemini'); try { await require(path.join(ROOT, 'netlify', 'functions', '_visual_check')).reviewEpisode(supabase, { episodeId: epId, log: console.log }); } catch (e2) { console.log('Revisor de imágenes: no se pudo (' + String(e2.message).slice(0, 160) + ')'); } } else throw e; }
  try {} 
  catch (e) { console.log('Revisor de imágenes: no se pudo (' + String(e.message).slice(0, 160) + ') — sigo con los prompts tal cual.'); }
  const { data: ep } = await supabase.from('episodes').select('id, episode_number, series_id, shots, continuity, assets(kind, shot_number)').eq('id', epId).single();
  const { data: series } = await supabase.from('series').select('id, slug, story_bible').eq('id', ep.series_id).single();
  const aspect = ((ep.continuity && ep.continuity.aspect) || (series.story_bible && series.story_bible.aspect)) === '16:9' ? '16:9' : '9:16';
  const hasFrame = (n) => (ep.assets || []).some((a) => (a.kind === 'image' || a.kind === 'video_clip') && a.shot_number === n);
  const want = list ? list.split(',').map(Number) : (ep.shots || []).map((s) => s.n).filter((n) => !solo || !hasFrame(n) || (ep.shots || []).some((s) => s.n === n && s.frame_stale));
  const all = (ep.shots || []).filter((s) => want.includes(s.n) && (s.start_en || s.action_en));
  // Tomas con personajes: una por una con sus fotos de cara como referencia (createKeyframe → Flow con ingredientes).
  const conPersonajes = all.filter((s) => (s.characters || []).length);
  const conDone = []; // también limpian frame_stale (antes solo lo hacían las tomas sin personajes)
  if (conPersonajes.length) {
    const { createKeyframe } = require(path.join(ROOT, 'netlify', 'functions', '_keyframe'));
    const { data: fullSeries } = await supabase.from('series').select('id, slug, story_bible, visual_memory').eq('id', ep.series_id).single();
    const { data: characters } = await supabase.from('characters').select('name, fixed_prompt_tag, profile, reference_image_url').eq('series_id', ep.series_id);
    for (const sh of conPersonajes) {
      try { await createKeyframe(supabase, { series: fullSeries, episode: ep, shot: sh, characters, log: (...x) => console.log(...x) }); conDone.push(sh.n); console.log(`toma ${sh.n}: cuadro con personajes listo`); }
      catch (e) { console.log(`toma ${sh.n}: FALLÓ ${String(e.message).slice(0, 200)}`); }
    }
  }
  const shots = all.filter((s) => !(s.characters || []).length);
  console.log('Flow: generando', shots.length, 'cuadros en una sola sesión → tomas', shots.map((s) => s.n).join(','));
  // Cada cuadro se guarda en cuanto sale (el panel los va mostrando uno por uno).
  const done = [];
  if (shots.length) await flowImages(shots.map((s) => (s.keyframe_prompt_override && s.keyframe_prompt_override.trim()) || s.start_en || s.action_en), console.log, async (i, img) => {
    await storeKeyframeImage(supabase, { series, episode: ep, shotN: shots[i].n, image: { imageBytes: img.buffer.toString('base64'), mimeType: img.mimeType }, note: 'Google Flow' });
    done.push(shots[i].n);
    console.log(`toma ${shots[i].n}: cuadro guardado (${done.length}/${shots.length})`);
  }, { aspect });
  // El cuadro final viejo ya no corresponde: se rehace desde el nuevo inicial.
  const { data: fr } = await supabase.from('episodes').select('shots').eq('id', epId).single();
  await supabase.from('episodes').update({ shots: fr.shots.map((x) => (done.includes(x.n) || conDone.includes(x.n) ? Object.assign({}, x, { end_frame_url: null, end_frame_skip: false, frame_stale: false, clip_stale: solo ? (ep.assets || []).some((a) => a.kind === 'video_clip' && a.shot_number === x.n) : false }) : x)) }).eq('id', epId);
  console.log('Cuadros de Flow guardados:', done.join(',') || 'ninguno');
  if (!done.length && !conPersonajes.length) process.exit(1);
  if (solo) {
    // Si el episodio ya estaba producido: los videos viejos de las tomas con cuadro nuevo (clip_stale) y los de
    // las tomas nuevas (partidas) se hacen en king ($0) con el mismo generador de Producir, y se une el final.
    const produced = (ep.assets || []).some((a) => a.kind === 'video_clip');
    if (!produced) { console.log('LISTO: cuadros hechos con Flow ($0). Revísalos en el panel.'); return; }
    console.log('Cuadros listos. El episodio ya tenía videos → hago en king los que faltan o quedaron viejos y uno el video final...');
    execFileSync(process.execPath, [path.join(__dirname, 'gen_local.js'), epId], { cwd: ROOT, stdio: 'inherit' });
    console.log('LISTO: cuadros nuevos + videos rehechos + video final unido.');
    return;
  }
  console.log('Ahora los videos en king...');
  execFileSync(process.execPath, [path.join(__dirname, 'regen_local.js'), epId, done.join(',')], { cwd: ROOT, stdio: 'inherit' });
})().catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });
