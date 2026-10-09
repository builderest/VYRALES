// Memoria visual de una novela: prompts e insumos para
//   1) la imagen fija de cada LUGAR (se genera una vez y se reutiliza siempre), y
//   2) el CUADRO INICIAL de cada toma (personajes con su foto + lugar con su imagen fija),
//      que después Veo Lite anima. Así el video arranca con la cara, la ropa y el set
//      correctos, aunque Lite no acepte fotos de referencia directamente.
const { shortName, onScreenExtras } = require('./_series');
const { loadReferenceImages } = require('./_veo');
const { MAX_CHARACTER_REFS, generateImage } = require('./_image');
const { ensureMediaBucket, uploadFile, removeByPublicUrl } = require('./_storage');
const { logSpend } = require('./_spend');

function locationOf(sb, key) {
  const loc = sb.locations && sb.locations[key];
  if (!loc) return null;
  return typeof loc === 'string' ? { visual: loc, ambient: '' } : loc;
}

const CLEAN_FRAME =
  'Every surface is clean and blank: walls, papers, screens and signs show only soft, blurry, unreadable shapes, ' +
  'with zero letters, words, numbers or logos anywhere in the image.';

function buildLocationPrompt(locationKey, storyBible) {
  const sb = storyBible || {};
  const loc = locationOf(sb, locationKey);
  if (!loc) throw new Error(`El lugar "${locationKey}" no existe en story_bible.locations.`);
  return [
    `${(sb.visual_style || 'Cinematic style').replace(/\.?$/, '.')}`,
    `Empty establishing view of the set, with nobody in it: ${loc.visual.replace(/\.?$/, '.')}`,
    'Vertical 9:16 composition, eye-level medium-wide view, soft cinematic lighting, rich detail.',
    'This image is a fixed set reference that will be reused in every scene, so keep it simple, coherent and timeless.',
    CLEAN_FRAME
  ].join(' ');
}

// shot: elemento de episodes.shots; characterRows: filas de `characters`; storyBible.
// hasLocationRef: si se adjunta la imagen fija del lugar.
function buildKeyframePrompt(shot, characterRows, storyBible, hasLocationRef) {
  const sb = storyBible || {};
  const loc = locationOf(sb, shot.location);
  const names = shot.characters || [];
  const parts = [
    `Create the very first frame of a vertical 9:16 video shot. ${(sb.visual_style || '').replace(/\.?$/, '.')}`,
    shot.camera ? `Framing: ${shot.camera.replace(/\.?$/, '.')}` : ''
  ];
  names.forEach((name, i) => {
    const row = (characterRows || []).find((r) => r.name === name);
    if (!row) throw new Error(`El personaje "${name}" no existe.`);
    const first = shortName(name, characterRows);
    const outfit = (shot.wardrobe && shot.wardrobe[name]) || (row.profile && row.profile.default_outfit) || '';
    parts.push(
      `${names.length > 1 ? `Character ${i + 1}: ` : ''}${row.fixed_prompt_tag.replace(/\.?$/, '')}` +
      // "exactly" + prioridad sobre el estilo: el estilo de la serie decía "period-appropriate hide
      // garments" y en las escenas modernas Gemini le puso túnica prehistórica (EP3 T8).
      (outfit ? `, wearing exactly ${outfit.replace(/\.?$/, '')} (this outfit has priority over any clothing mentioned in the style)` : '') +
      `. From the face reference image of ${first} take ONLY the identity: exact face shape, skin tone, eye color and hair color; ` +
      `the hairstyle, clothing and accessories come from this text, never from the plain gray top in the reference photo.`
    );
  });
  if (names.length > 1) {
    parts.push(`There are exactly ${names.length} people: ${names.map((n) => shortName(n, characterRows)).join(' and ')}. Each one wears only their own outfit; clothing and accessories are never shared.`);
  }
  // Personas secundarias que hablan en esta toma (sin foto): su descripción fija.
  onScreenExtras(shot, sb).forEach((ex) => parts.push(`Also in the frame: ${ex.who.replace(/\.?$/, '')}.`));
  const narrado = sb.format === 'narrado_unico';
  // Videos narrados: el cuadro muestra SOLO lo que dice start_en (el set fijo metía el bosque en una toma
  // que empezaba en agua negra, EP2 T2).
  if (loc && !narrado) {
    parts.push(`Setting: ${loc.visual.replace(/\.?$/, '.')}` + (hasLocationRef ? ' ' + SET_REF_SENTENCE : ''));
  }
  parts.push(shot.start_en && shot.start_en.trim()
    ? `Moment (this exact frame, before anyone speaks): ${shot.start_en.trim().replace(/\.?$/, '.')}`
    : `Moment: the instant this action begins, before anyone speaks — ${String(shot.action_en || '').replace(/\.?$/, '.')}`);
  if (!names.length) parts.push('The whole image shows exactly and only what the Moment describes, as the main subject filling the frame. Add no people, scientists, laboratories, screens or equipment unless the Moment mentions them.');
  // (EP2 T4: "microscope view" salió como una científica en un microscopio)
  parts.push('Natural anatomy and natural hands, expressive faces, cinematic composition.');
  // Una sola imagen continua: con "close-up" + 2 personajes Gemini llegó a armar un collage de
  // 3 paneles (EP1 T10), que Veo no puede animar como una sola toma.
  parts.push('This is ONE single continuous full-frame image taken from one camera angle, like a single movie frame: one scene, one moment, with no split screen, panels, collage, borders or inset pictures.');
  if (names.length > 1 && /close[- ]?up/i.test(shot.camera || '')) {
    parts.push(`${names.map((n) => shortName(n, characterRows)).slice(1).join(' and ')} stays inside the same frame, partly visible at the edge and softly out of focus.`);
  }
  parts.push(CLEAN_FRAME);
  return parts.filter(Boolean).join(' ');
}

// Junta las imágenes de referencia de una toma: fotos de cara (obligatorias) + imagen fija
// del lugar (si existe en la memoria visual). Lanza error si falta la foto de un personaje.
async function keyframeReferences(shot, characterRows, visualMemory) {
  const names = shot.characters || [];
  if (names.length > MAX_CHARACTER_REFS) throw new Error(`La toma ${shot.n} tiene más de ${MAX_CHARACTER_REFS} personajes.`);
  const faceUrls = names.map((name) => {
    const row = (characterRows || []).find((r) => r.name === name);
    if (!row || !row.reference_image_url) {
      throw new Error(`Falta la foto de cara de "${name}" (toma ${shot.n}). Súbela en el Elenco: el cuadro inicial la necesita.`);
    }
    return row.reference_image_url;
  });
  const locRef = visualMemory && visualMemory.locations && visualMemory.locations[shot.location];
  const urls = locRef && locRef.url ? [...faceUrls, locRef.url] : faceUrls;
  const images = await loadReferenceImages(urls);
  const refs = images.map((img, i) => ({
    ...img,
    label: i < names.length ? `face reference of ${shortName(names[i], characterRows)}` : `fixed set reference of ${shot.location}`
  }));
  return { refs, hasLocationRef: !!(locRef && locRef.url) };
}

const SET_REF_SENTENCE = 'Match the set reference image exactly: same layout, colors, furniture and lighting.';

function effectiveKeyframePrompt(shot, characterRows, storyBible, hasLocationRef) {
  const override = shot.keyframe_prompt_override && shot.keyframe_prompt_override.trim();
  if (override) {
    // Un prompt editado a mano no pierde la instrucción del set cuando sí se adjunta la imagen del lugar.
    return hasLocationRef && !override.includes('set reference image') ? `${override} ${SET_REF_SENTENCE}` : override;
  }
  return buildKeyframePrompt(shot, characterRows, storyBible, hasLocationRef);
}

// Genera y guarda el cuadro inicial de UNA toma. Si ya había uno, lo reemplaza (misma fila
// de `assets`, archivo viejo borrado de Storage solo después de subir el nuevo).
// Devuelve el asset y los bytes del cuadro (para pasárselo directo a Veo).
// Imagen fija de un LUGAR (memoria visual): se genera una sola vez por lugar y se guarda en
// series.visual_memory.locations[key]. La usan location-image-background (botón del dashboard)
// y createKeyframe (automático: si una toma es de un lugar sin imagen, primero se crea).
async function createLocationImage(supabase, { seriesId, slug, storyBible, key, prompt, log = console.log }) {
  const { data: cur } = await supabase.from('series').select('visual_memory').eq('id', seriesId).single();
  const old = cur && cur.visual_memory && cur.visual_memory.locations && cur.visual_memory.locations[key];
  const finalPrompt = (prompt && String(prompt).trim()) || (old && old.prompt_override) || buildLocationPrompt(key, storyBible);
  log('generando imagen fija del lugar', key, '...');
  const img = await generateImage({ prompt: finalPrompt });
  await logSpend(supabase, { seriesId, kind: 'location', model: img.model, costUsd: img.costUsd, note: key });
  await ensureMediaBucket(supabase);
  const ext = img.mimeType.includes('jpeg') ? 'jpg' : 'png';
  const url = await uploadFile(supabase, { path: `${slug}/locations/${key}-v${Date.now()}.${ext}`, buffer: img.buffer, contentType: img.mimeType });
  // Se relee justo antes de guardar (por si otro lugar se generó en paralelo).
  const { data: fresh } = await supabase.from('series').select('visual_memory').eq('id', seriesId).single();
  const vm = Object.assign({ locations: {} }, (fresh && fresh.visual_memory) || {});
  const entry = {
    url,
    prompt: finalPrompt,
    prompt_override: prompt ? String(prompt).trim() : (old && old.prompt_override) || undefined,
    cost_usd: img.costUsd,
    source: 'generated',
    updated_at: new Date().toISOString()
  };
  vm.locations = Object.assign({}, vm.locations, { [key]: entry });
  const { error } = await supabase.from('series').update({ visual_memory: vm }).eq('id', seriesId);
  if (error) throw error;
  if (old && old.url && old.url !== url) await removeByPublicUrl(supabase, old.url, log);
  log('lugar listo ✅', key, url);
  return { url, entry, visualMemory: vm };
}

async function createKeyframe(supabase, { series, episode, shot, characters, log = console.log }) {
  // Memoria visual automática: si el lugar de esta toma no tiene imagen fija todavía, se crea
  // primero (una sola vez por lugar) para que todas las tomas de ese lugar compartan el set.
  const seriesId = series.id || episode.series_id;
  // Primero se revisan las fotos de cara (sin gastar nada): antes se creaba la imagen del
  // lugar y DESPUÉS fallaba por falta de foto.
  const sinFoto = (shot.characters || []).filter((name) => { const r = (characters || []).find((x) => x.name === name); return !r || !r.reference_image_url; });
  if (sinFoto.length) {
    // Automático: si a un personaje le falta la foto de cara, se genera aquí (~$0.067) en vez
    // de parar la producción (Job T2: Dios no tenía foto y todo se detenía).
    const { createCharacterPhoto } = require('./_character_photo');
    const { data: rows, error: rErr } = await supabase.from('characters').select('id, name, role, fixed_prompt_tag, profile, reference_image_url, sort_order').eq('series_id', seriesId);
    if (rErr) throw rErr;
    for (const name of sinFoto) {
      const row = (rows || []).find((r) => r.name === name);
      if (!row) throw new Error(`El personaje "${name}" no existe en el Elenco.`);
      log('falta la foto de cara de', name, '— generándola automáticamente...');
      const url = await createCharacterPhoto(supabase, { series: Object.assign({ id: seriesId }, series), character: row, allCharacters: rows, log });
      row.reference_image_url = url;
      (characters || []).forEach((c) => { if (c.name === name) c.reference_image_url = url; });
    }
  }
  const narradoFmt = !!(series.story_bible && series.story_bible.format === 'narrado_unico');
  const locs = (series.visual_memory && series.visual_memory.locations) || {};
  const hasLocDef = !narradoFmt && !!(series.story_bible && series.story_bible.locations && series.story_bible.locations[shot.location]);
  if (shot.location && hasLocDef && !(locs[shot.location] && locs[shot.location].url)) {
    const { visualMemory } = await createLocationImage(supabase, { seriesId, slug: series.slug, storyBible: series.story_bible, key: shot.location, log });
    series.visual_memory = visualMemory; // la misma corrida reutiliza el lugar en las siguientes tomas
  }
  const { refs, hasLocationRef } = await keyframeReferences(shot, characters, narradoFmt ? {} : series.visual_memory);
  const prompt = effectiveKeyframePrompt(shot, characters, series.story_bible, hasLocationRef);
  const { fluxImage, useFlux } = require('./_flux');
  const fluxText = shot.start_en || shot.action_en || shot.end_en || '';
  const flux = useFlux(series.story_bible, shot) && !!fluxText;
  log('generando cuadro inicial de la toma', shot.n, flux ? 'con FLUX en king (gratis)...' : 'con ' + refs.length + ' imagen(es) de referencia...');
  // image_engine 'flow': cuadro inicial con Google Flow (tu plan) y, si falla, FLUX en king. Ambos $0.
  let img;
  if (flux && (shot.image_engine || series.story_bible.image_engine) === 'flow') {
    try { img = await require('../../agente/flow_imagenes').flowImage({ prompt: fluxText }); log('cuadro inicial de Google Flow'); }
    catch (e) { log('Flow falló (' + String(e.message).slice(0, 160) + ') → FLUX en king'); img = await fluxImage({ prompt: fluxText }); }
  } else img = flux ? await fluxImage({ prompt: fluxText }) : await generateImage({ prompt, references: refs });
  await logSpend(supabase, { seriesId, episodeId: episode.id, shotNumber: shot.n, kind: 'keyframe', model: img.model, costUsd: img.costUsd });

  await ensureMediaBucket(supabase);
  const ext = img.mimeType.includes('jpeg') ? 'jpg' : 'png';
  const storagePath = `${series.slug}/ep${episode.episode_number}/frame-${String(shot.n).padStart(2, '0')}-v${Date.now()}.${ext}`;
  const url = await uploadFile(supabase, { path: storagePath, buffer: img.buffer, contentType: img.mimeType });

  const { data: existing } = await supabase
    .from('assets')
    .select('id, storage_path')
    .eq('episode_id', episode.id)
    .eq('kind', 'image')
    .eq('shot_number', shot.n)
    .maybeSingle();

  let asset;
  if (existing) {
    const { data, error } = await supabase
      .from('assets')
      .update({ storage_path: url, prompt: flux ? fluxText : prompt, cost_usd: img.costUsd, model: 'nano_banana', approved: false, approved_at: null })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    asset = data;
    if (existing.storage_path && existing.storage_path !== url) await removeByPublicUrl(supabase, existing.storage_path, log);
  } else {
    const { data, error } = await supabase
      .from('assets')
      .insert({ episode_id: episode.id, kind: 'image', model: 'nano_banana', shot_number: shot.n, storage_path: url, prompt: flux ? fluxText : prompt, cost_usd: img.costUsd, approved: false })
      .select()
      .single();
    if (error) throw error;
    asset = data;
  }
  log('cuadro inicial listo:', url);
  return { asset, startImage: { imageBytes: img.buffer.toString('base64'), mimeType: img.mimeType } };
}


// Parecido entre dos imágenes (SSIM 0..1, 1 = idénticas) con ffmpeg. null si no se pudo medir.
async function similarity(a, b) {
  try {
    const os = require('os'); const path = require('path'); const fs = require('fs');
    const { execFile } = require('child_process');
    const ffmpeg = require('ffmpeg-static');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-ssim-'));
    const fa = path.join(dir, 'a.img'), fb = path.join(dir, 'b.img');
    fs.writeFileSync(fa, Buffer.from(a.imageBytes, 'base64'));
    fs.writeFileSync(fb, Buffer.from(b.imageBytes || b.buffer.toString('base64'), 'base64'));
    const out = await new Promise((res) => execFile(ffmpeg, ['-i', fa, '-i', fb, '-lavfi', '[0]scale=256:456,format=gray[x];[1]scale=256:456,format=gray[y];[x][y]ssim', '-f', 'null', '-'], (e, so, se) => res(String(se || ''))));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    const m = /All:([0-9.]+)/.exec(out);
    return m ? Number(m[1]) : null;
  } catch (_) { return null; }
}

// ---- CUADRO FINAL (opcional, toma con shot.end_en) ----
// LTX en king anima del cuadro inicial al final. El final se crea EDITANDO el cuadro inicial
// (misma escena, mismo estilo, misma luz) para que la toma sea continua, y se guarda en
// episodes.shots[n].end_frame_url (sin tocar la tabla assets).
async function createEndFrame(supabase, { series, episode, shot, startImage, anchorImage = null, log = console.log }) {
  if (!shot || !shot.end_en || !startImage) return null;
  const sb = series.story_bible || {};
  const prompt = [
    'Edit the reference image into the LAST frame of the same continuous vertical 9:16 video shot.',
    (sb.visual_style || '').replace(/\.?$/, '.'),
    'Keep exactly the same world, style, lighting, color palette, lens look and level of realism as the reference image; it is the same shot a few seconds later.',
    (sb.narration && sb.narration.mode === 'continuous') ? 'This is the NEXT DRAWING of a smooth animation, a small step forward: keep the same camera angle and almost the same framing (at most slightly closer, higher or a few degrees around), the same character in the same place; only the described action advances a little. Nothing jumps or changes abruptly.' : '',
    `Final moment (this exact frame): ${String(shot.end_en).trim().replace(/\.?$/, '.')}`,
    'This is ONE single continuous full-frame image, like a single movie frame, with no split screen, panels, collage, borders or inset pictures.',
    CLEAN_FRAME
  ].filter(Boolean).join(' ');
  log('generando cuadro FINAL de la toma', shot.n, '(editando el cuadro inicial)...');
  const ref = [Object.assign({}, startImage, { label: 'the FIRST frame of this same shot (keep its world, style and light)' })];
  // Voz continua: el primer cuadro del video ancla al personaje y al lugar (sin esto el caballero
  // cambiaba de capucha a casco y el fondo se volvía otro entre tomas).
  if (anchorImage) ref.push(Object.assign({}, anchorImage, { label: 'the FIRST frame of the whole video: the character must keep EXACTLY this look (same armor, same hood, same cape) and the place must stay this same battlefield' }));
  let img = null;
  let lastSim = null;
  for (let attempt = 0; attempt < 2 && !img; attempt++) {
    const p = attempt === 0 ? prompt : prompt + (lastSim != null && lastSim < 0.5 ? ' IMPORTANT: the previous attempt changed too much. Stay much closer to the reference: same camera angle, same framing, same place; only a small step of the action.' : ' IMPORTANT: the previous attempt looked almost identical to the reference. The final frame must show the described action clearly advanced, with a slightly different framing.');
    const fl = require('./_flux');
    const cand = fl.useFlux(sb, shot)
      ? await fl.fluxImage({ prompt: 'Same scene, same lighting and style, a few seconds later: ' + String(shot.end_en).trim() + (attempt === 0 ? '' : (lastSim != null && lastSim < 0.5 ? ' Keep the same camera angle and framing; only a small step of the action.' : ' The action is clearly advanced and the framing slightly closer.')), reference: startImage })
      : await generateImage({ prompt: p, references: ref });
    await logSpend(supabase, { seriesId: series.id || episode.series_id, episodeId: episode.id, shotNumber: shot.n, kind: 'keyframe', model: cand.model, costUsd: cand.costUsd, note: 'cuadro final' });
    // Si sale casi igual al inicial (SSIM alto) la toma queda quieta: se reintenta una vez; si no, sin cuadro final.
    const sim = await similarity(startImage, cand);
    lastSim = sim;
    log(`cuadro final toma ${shot.n}: parecido con el inicial ${sim == null ? '?' : sim.toFixed(2)}`);
    // Voz continua (movimiento tipo anime): ni igual (quieto) ni muy distinto (salto brusco).
    const minSim = sb.narration && sb.narration.mode === 'continuous' ? 0.38 : 0;
    if (sim == null || (sim < 0.85 && sim >= minSim)) img = cand;
    else if (sim < minSim) { log(`cuadro final toma ${shot.n}: cambió demasiado (salto brusco) → reintento más parecido`); if (attempt === 1) img = cand; }
  }
  if (!img) {
    log(`toma ${shot.n}: el cuadro final salía igual al inicial → se anima solo desde el inicial`);
    const { data: f0 } = await supabase.from('episodes').select('shots').eq('id', episode.id).single();
    const sh0 = Array.isArray(f0 && f0.shots) ? f0.shots : [];
    await supabase.from('episodes').update({ shots: sh0.map((x) => (x.n === shot.n ? Object.assign({}, x, { end_frame_skip: true, end_frame_url: null }) : x)) }).eq('id', episode.id);
    shot.end_frame_skip = true;
    return null;
  }
  await ensureMediaBucket(supabase);
  const ext = img.mimeType.includes('jpeg') ? 'jpg' : 'png';
  const url = await uploadFile(supabase, { path: `${series.slug}/ep${episode.episode_number}/frame-${String(shot.n).padStart(2, '0')}-end-v${Date.now()}.${ext}`, buffer: img.buffer, contentType: img.mimeType });
  // Se guarda en el guion de la toma (leyendo el guion fresco para no pisar otros cambios).
  const { data: fresh } = await supabase.from('episodes').select('shots').eq('id', episode.id).single();
  const shots = Array.isArray(fresh && fresh.shots) ? fresh.shots : [];
  const old = (shots.find((x) => x.n === shot.n) || {}).end_frame_url;
  const next = shots.map((x) => (x.n === shot.n ? Object.assign({}, x, { end_frame_url: url, end_frame_skip: false }) : x));
  await supabase.from('episodes').update({ shots: next }).eq('id', episode.id);
  shot.end_frame_url = url;
  if (old && old !== url) await removeByPublicUrl(supabase, old, log);
  log('cuadro final listo:', url);
  return { imageBytes: img.buffer.toString('base64'), mimeType: img.mimeType };
}
// Cuadro final de la toma: el guardado, o uno nuevo (fresh=true lo rehace). null si la toma no lleva final.
async function endFrameFor(supabase, { series, episode, shot, startImage, anchorImage = null, fresh = false, log = console.log }) {
  if (!shot || !shot.end_en) return null;
  if (!fresh && shot.end_frame_skip) return null;
  if (!fresh && shot.end_frame_url) {
    const [img] = await loadReferenceImages([shot.end_frame_url]);
    if (img) return img;
  }
  return createEndFrame(supabase, { series, episode, shot, startImage, anchorImage, log });
}

// Guarda una imagen YA HECHA como cuadro inicial de la toma (voz continua: el inicial de la toma N es el
// final de la toma N-1, así el video se ve como un solo movimiento).
async function storeKeyframeImage(supabase, { series, episode, shotN, image, note = 'encadenado', log = console.log }) {
  await ensureMediaBucket(supabase);
  const ext = String(image.mimeType || '').includes('png') ? 'png' : 'jpg';
  const url = await uploadFile(supabase, { path: `${series.slug}/ep${episode.episode_number}/frame-${String(shotN).padStart(2, '0')}-v${Date.now()}.${ext}`, buffer: Buffer.from(image.imageBytes, 'base64'), contentType: image.mimeType || 'image/jpeg' });
  const { data: existing } = await supabase.from('assets').select('id, storage_path').eq('episode_id', episode.id).eq('kind', 'image').eq('shot_number', shotN).maybeSingle();
  if (existing) {
    await supabase.from('assets').update({ storage_path: url, prompt: note, cost_usd: 0, model: 'nano_banana', approved: false, approved_at: null }).eq('id', existing.id).then(({ error }) => { if (error) throw error; });
    if (existing.storage_path && existing.storage_path !== url) await removeByPublicUrl(supabase, existing.storage_path, log);
  } else {
    await supabase.from('assets').insert({ episode_id: episode.id, kind: 'image', model: 'nano_banana', shot_number: shotN, storage_path: url, prompt: note, cost_usd: 0, approved: false }).then(({ error }) => { if (error) throw error; });
  }
  log(`toma ${shotN}: cuadro inicial = cuadro final de la toma anterior (${note})`);
  return url;
}
// Último cuadro de un video (respaldo cuando la toma anterior no tuvo cuadro final).
async function lastFrameOf(videoBuffer) {
  const os = require('os'); const path = require('path'); const fs = require('fs');
  const { execFile } = require('child_process');
  const ffmpeg = require('ffmpeg-static');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vy-last-'));
  const v = path.join(dir, 'v.mp4'), o = path.join(dir, 'last.jpg');
  fs.writeFileSync(v, videoBuffer);
  await new Promise((res, rej) => execFile(ffmpeg, ['-y', '-sseof', '-0.15', '-i', v, '-frames:v', '1', '-q:v', '2', o], (e, so, se) => (e ? rej(new Error(String(se).slice(-300))) : res())));
  const buf = fs.readFileSync(o);
  fs.rmSync(dir, { recursive: true, force: true });
  return { imageBytes: buf.toString('base64'), mimeType: 'image/jpeg' };
}

// Cuadro inicial ya guardado de una toma (para reutilizarlo al animar o regenerar el video).
async function loadExistingKeyframe(supabase, episodeId, shotNumber) {
  const { data: frame } = await supabase
    .from('assets')
    .select('id, storage_path')
    .eq('episode_id', episodeId)
    .eq('kind', 'image')
    .eq('shot_number', shotNumber)
    .maybeSingle();
  if (!frame || !frame.storage_path) return null;
  const [img] = await loadReferenceImages([frame.storage_path]);
  return { asset: frame, startImage: img };
}

module.exports = {
  buildLocationPrompt,
  buildKeyframePrompt,
  effectiveKeyframePrompt,
  keyframeReferences,
  createKeyframe,
  loadExistingKeyframe, createLocationImage, createEndFrame, endFrameFor, storeKeyframeImage, lastFrameOf };
