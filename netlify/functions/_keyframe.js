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
      (outfit ? `, wearing ${outfit}` : '') +
      `. From the face reference image of ${first} take ONLY the identity: exact face shape, skin tone, eye color and hair color; ` +
      `the hairstyle, clothing and accessories come from this text, never from the plain gray top in the reference photo.`
    );
  });
  if (names.length > 1) {
    parts.push(`There are exactly ${names.length} people: ${names.map((n) => shortName(n, characterRows)).join(' and ')}. Each one wears only their own outfit; clothing and accessories are never shared.`);
  }
  // Personas secundarias que hablan en esta toma (sin foto): su descripción fija.
  onScreenExtras(shot, sb).forEach((ex) => parts.push(`Also in the frame: ${ex.who.replace(/\.?$/, '')}.`));
  if (loc) {
    parts.push(`Setting: ${loc.visual.replace(/\.?$/, '.')}` + (hasLocationRef ? ' ' + SET_REF_SENTENCE : ''));
  }
  parts.push(shot.start_en && shot.start_en.trim()
    ? `Moment (this exact frame, before anyone speaks): ${shot.start_en.trim().replace(/\.?$/, '.')}`
    : `Moment: the instant this action begins, before anyone speaks — ${String(shot.action_en || '').replace(/\.?$/, '.')}`);
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
  const locs = (series.visual_memory && series.visual_memory.locations) || {};
  const hasLocDef = !!(series.story_bible && series.story_bible.locations && series.story_bible.locations[shot.location]);
  if (shot.location && hasLocDef && !(locs[shot.location] && locs[shot.location].url)) {
    const { visualMemory } = await createLocationImage(supabase, { seriesId, slug: series.slug, storyBible: series.story_bible, key: shot.location, log });
    series.visual_memory = visualMemory; // la misma corrida reutiliza el lugar en las siguientes tomas
  }
  const { refs, hasLocationRef } = await keyframeReferences(shot, characters, series.visual_memory);
  const prompt = effectiveKeyframePrompt(shot, characters, series.story_bible, hasLocationRef);
  log('generando cuadro inicial de la toma', shot.n, 'con', refs.length, 'imagen(es) de referencia...');
  const img = await generateImage({ prompt, references: refs });
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
      .update({ storage_path: url, prompt, cost_usd: img.costUsd, model: 'nano_banana', approved: false, approved_at: null })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    asset = data;
    if (existing.storage_path && existing.storage_path !== url) await removeByPublicUrl(supabase, existing.storage_path, log);
  } else {
    const { data, error } = await supabase
      .from('assets')
      .insert({ episode_id: episode.id, kind: 'image', model: 'nano_banana', shot_number: shot.n, storage_path: url, prompt, cost_usd: img.costUsd, approved: false })
      .select()
      .single();
    if (error) throw error;
    asset = data;
  }
  log('cuadro inicial listo:', url);
  return { asset, startImage: { imageBytes: img.buffer.toString('base64'), mimeType: img.mimeType } };
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
  loadExistingKeyframe, createLocationImage };
