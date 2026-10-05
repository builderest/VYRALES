// Foto de cara de un personaje generada con Gemini en el MISMO estilo de la serie, para
// reutilizarla en todos los cuadros iniciales (memoria visual).
// Consistencia de estilo entre personajes: se adjuntan como "referencia de estilo" hasta 2
// fotos YA existentes de otros personajes de la serie (no para copiar su cara, solo su forma
// de render). Así no vuelve a pasar que una foto salga 3D y otras realistas.
const { generateImage } = require('./_image');
const { buildImagePrompt } = require('./_series');
const { loadReferenceImages } = require('./_veo');
const { ensureMediaBucket, uploadFile, removeByPublicUrl } = require('./_storage');
const { logSpend } = require('./_spend');

function effectiveCharacterPrompt(character, storyBible) {
  const p = character.profile || {};
  return (p.image_prompt_override && p.image_prompt_override.trim()) ||
    p.image_prompt ||
    buildImagePrompt({ fixed_prompt_tag: character.fixed_prompt_tag }, storyBible);
}

async function createCharacterPhoto(supabase, { series, character, allCharacters, log = console.log }) {
  const prompt = effectiveCharacterPrompt(character, series.story_bible);
  const oldUrl = character.reference_image_url || null;
  // Referencias de estilo: fotos generadas aquí (ya en el estilo de la serie) y las subidas a
  // mano que marcaste con "Estilo" en el dashboard. Una foto realista subida sin marcar NO se
  // usa, para no heredar ese estilo.
  const isGenerated = (c) => (c.profile || {}).photo_source === 'generated';
  const isLead = (c) => (c.profile || {}).style_reference === true;
  const others = (allCharacters || [])
    .filter((c) => c.id !== character.id && c.reference_image_url && (isGenerated(c) || isLead(c)))
    .sort((a, b) => (isGenerated(b) - isGenerated(a)) || ((a.sort_order || 0) - (b.sort_order || 0)))
    .slice(0, 2);
  const images = others.length ? await loadReferenceImages(others.map((c) => c.reference_image_url)) : [];
  const references = images.map((img) => ({
    ...img,
    label: 'ART STYLE reference only — a DIFFERENT person from the same series: copy only its rendering style, lighting, framing and background, never its face'
  }));
  const fullPrompt = references.length
    ? `${prompt} Render this new character in exactly the same art style, lighting, framing and plain background as the style reference images, but with their own unique face as described.`
    : prompt;

  log('generando foto de', character.name, references.length ? `(con ${references.length} referencia(s) de estilo)` : '');
  const img = await generateImage({ prompt: fullPrompt, references });
  await logSpend(supabase, { seriesId: series.id, kind: 'character', model: img.model, costUsd: img.costUsd, note: character.name });

  await ensureMediaBucket(supabase);
  const ext = img.mimeType.includes('jpeg') ? 'jpg' : 'png';
  const url = await uploadFile(supabase, {
    path: `characters/${series.slug}/${character.id}-${Date.now()}.${ext}`,
    buffer: img.buffer,
    contentType: img.mimeType
  });
  const profile = Object.assign({}, character.profile || {}, { photo_source: 'generated', photo_prompt_used: fullPrompt });
  const { error } = await supabase.from('characters').update({ reference_image_url: url, profile }).eq('id', character.id);
  if (error) throw error;
  if (oldUrl && oldUrl !== url) {
    await removeByPublicUrl(supabase, oldUrl, log);
  }
  return url;
}

module.exports = { createCharacterPhoto, effectiveCharacterPrompt };
