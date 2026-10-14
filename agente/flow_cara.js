// GENERAR FOTOS DE PERSONAJE CON GOOGLE FLOW EN LA PC ($0). Lo lanza el agente:
//   node agente/flow_cara.js <slug_de_la_serie>
// Flow baja la ORIGINAL (=s0): resolución completa, para que sirva de referencia en los prompts del video.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
process.env.VYRALES_LOCAL_RUN = '1'; // → createCharacterPhoto usa Flow ($0)

async function main() {
  const slug = String(process.argv[2] || '').trim();
  const onlyId = String(process.argv[3] || '').trim(); // opcional: regenerar SOLO este personaje (aunque ya tenga foto)
  if (!/^[a-z0-9_]{3,60}$/.test(slug)) throw new Error('Uso: node agente/flow_cara.js <slug> [characterId]');
  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const sb = getSupabaseClient();
  const { data: series } = await sb.from('series').select('id, slug, title, story_bible').eq('slug', slug).single();
  if (!series) throw new Error('Serie no encontrada: ' + slug);
  const { createCharacterPhoto } = require(path.join(ROOT, 'netlify', 'functions', '_character_photo'));
  const { data: chars } = await sb.from('characters').select('id, name, role, fixed_prompt_tag, profile, reference_image_url, sort_order').eq('series_id', series.id).order('sort_order', { ascending: true });
  const missing = onlyId
    ? (chars || []).filter((c) => String(c.id) === onlyId)
    : (chars || []).filter((c) => !c.reference_image_url);
  if (!missing.length) { console.log('Todas las fotos de personaje ya existen.'); return; }
  console.log('Generar', missing.length, 'foto(s) de personaje con Google Flow ($0) para "' + series.title + '"...');
  let ok = 0;
  for (const c of missing) {
    try { await createCharacterPhoto(sb, { series, character: c, allCharacters: chars, log: console.log }); console.log('  LISTO:', c.name); ok++; }
    catch (e) { console.log('  FALLÓ', c.name + ':', String(e.message).slice(0, 160)); }
  }
  console.log('LISTO: ' + ok + '/' + missing.length + ' fotos de personaje generadas con Flow.');
}
main().catch((e) => { console.log('ERROR:', e.message); process.exit(1); });
