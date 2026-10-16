// CONTROL DE CALIDAD a mano de un episodio ya producido (lo lanza el agente: node agente/qa_tomas.js <episode_id>).
// Mismo QA que corre solo al final de gen_local: duración, congelado y revisión visual con Claude ($0);
// rehace en king lo que falle (una vez por toma) y vuelve a unir el video final si cambió algo.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
process.env.VYRALES_LOCAL_RUN = '1';
(async () => {
  const epId = process.argv[2];
  const forzarUnir = process.argv[3] === 'unir'; // qa_tomas:<ep>:unir → vuelve a unir el final aunque no cambió nada (p. ej. cambió el estilo de letras)
  if (!/^[0-9a-f-]{36}$/i.test(epId || '')) throw new Error('Uso: node agente/qa_tomas.js <episode_id>');
  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const supabase = getSupabaseClient();
  const redone = await require('./_qa').qaShots({ supabase, epId, handler: null, log: (...x) => console.log(...x) });
  // Se une si cambió algo O si todavía no hay video final más nuevo que la última toma (producción cortada antes de unir).
  const { data: chk } = await supabase.from('episodes').select('continuity, assets(kind, created_at)').eq('id', epId).single();
  // oct-16: también si la VOZ cambió después del último video final (parche de una frase, p. ej. el cierre de MindFuel):
  // antes el panel seguía mostrando el final viejo con la voz vieja.
  const voiceAt = ((chk.continuity || {}).voice || {}).at || '';
  const lastClip = (chk.assets || []).filter((a) => a.kind === 'video_clip').map((a) => a.created_at).sort().pop() || '';
  const lastFinal = (chk.assets || []).filter((a) => a.kind === 'final_render').map((a) => a.created_at).sort().pop() || '';
  const { data: cont } = await supabase.from('agent_jobs').select('id').eq('status', 'pending').eq('command', 'qa_tomas:' + epId).limit(1);
  if (cont && cont.length) { console.log('QA: quedó pendiente (cedió el turno a un trabajo manual o sigue en otra corrida) → NO uno el video todavía, se une cuando termine todo.'); return; }
  if (forzarUnir || redone.length || lastFinal < lastClip || (voiceAt && new Date(lastFinal || 0) < new Date(voiceAt))) {
    const { mergeEpisodeVideo } = require(path.join(ROOT, 'netlify', 'functions', '_merge'));
    const { data: ep } = await supabase.from('episodes').select('*, assets(*)').eq('id', epId).single();
    const { data: sr } = await supabase.from('series').select('id, slug, title, genre, story_bible').eq('id', ep.series_id).single();
    const m = await mergeEpisodeVideo(supabase, { episode: ep, series: sr, log: (...x) => console.log(...x) });
    console.log('QA: video final unido de nuevo:', m.asset && m.asset.storage_path);
  }
})().catch((e) => { console.error('ERROR:', e.message || e); process.exit(1); });
