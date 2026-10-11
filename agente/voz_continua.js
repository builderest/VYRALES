// VOZ CONTINUA DE UN EPISODIO EN LA PC: node agente/voz_continua.js <episode_id>
// Una sola voz para todo el video (narrador fijo del canal), alineada palabra por palabra con Whisper local.
// Si el episodio ya tiene voz y solo cambió el texto, se parchan solo las frases cambiadas (la voz no cambia).
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
process.env.VYRALES_LOCAL_RUN = '1';
(async () => {
  const id = process.argv[2];
  const sb = require(path.join(ROOT, 'netlify', 'functions', '_supabase')).getSupabaseClient();
  const { data: episode } = await sb.from('episodes').select('*').eq('id', id).single();
  const { data: series } = await sb.from('series').select('*').eq('id', episode.series_id).single();
  const v = await require(path.join(ROOT, 'netlify', 'functions', '_voice_full')).ensureFullVoice(sb, { episode, series, log: (...x) => console.log(...x) });
  console.log('LISTO: voz continua', v && v.seconds, 's ·', (v && v.words || []).length, 'palabras alineadas');
})().catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });
