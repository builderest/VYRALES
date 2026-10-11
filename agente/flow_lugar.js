// IMAGEN FIJA DE UN LUGAR CON GOOGLE FLOW ($0): node agente/flow_lugar.js <series_slug> <location_key>
// Usa el prompt guardado del lugar (o el automático). Lo pide el botón "Generar" de Lugares en series con Flow.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
process.env.VYRALES_LOCAL_RUN = '1';
(async () => {
  const [slug, key] = process.argv.slice(2);
  const sb = require(path.join(ROOT, 'netlify', 'functions', '_supabase')).getSupabaseClient();
  const { data: s } = await sb.from('series').select('id, slug, story_bible').eq('slug', slug).single();
  const { createLocationImage } = require(path.join(ROOT, 'netlify', 'functions', '_keyframe'));
  await createLocationImage(sb, { seriesId: s.id, slug: s.slug, storyBible: Object.assign({}, s.story_bible, { image_engine: 'flow' }), key, log: console.log });
  console.log('LISTO: lugar', key, 'con Google Flow ($0)');
})().catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });
