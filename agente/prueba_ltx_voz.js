// PRUEBA: LTX genera la toma CON SU PROPIA VOZ (lo lanza el agente: node agente/prueba_ltx_voz.js <episode_id> 1,2,3)
// Pregunta a responder: ¿LTX mantiene la misma voz para el mismo personaje en tomas distintas?
// Usa los mismos cuadros iniciales y el mismo prompt de LTX, más la línea en español y la voz del personaje.
// Deja en <videos>\<serie>\prueba_ltx_voz\:  ep<N>_t<NN>.mp4 (con audio de LTX) y ep<N>_todas.mp4 (todas seguidas).
// Gratis (king). No toca el episodio ni Supabase (solo lee).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
const FINALES = process.env.VYRALES_FINALES_DIR || path.join(ROOT, 'finales');
const ffmpeg = require(path.join(ROOT, 'node_modules', 'ffmpeg-static'));
const run = (args, cwd) => new Promise((res, rej) => execFile(ffmpeg, args, { cwd, maxBuffer: 1 << 26 }, (e, so, se) => (e ? rej(new Error(String(se).slice(-600))) : res())));

async function main() {
  const [epId, list] = process.argv.slice(2);
  if (!/^[0-9a-f-]{36}$/i.test(epId || '')) throw new Error('Uso: node agente/prueba_ltx_voz.js <episode_id> 1,2,3');
  const pick = String(list || '1,2,3').split(',').map(Number).filter((n) => n >= 1 && n <= 60);
  const F = path.join(ROOT, 'netlify', 'functions');
  const { getSupabaseClient } = require(path.join(F, '_supabase'));
  const K = require(path.join(F, '_king'));
  const supabase = getSupabaseClient();
  const { data: ep, error } = await supabase.from('episodes').select('id, episode_number, shots, series_id, assets(kind, shot_number, storage_path, created_at)').eq('id', epId).single();
  if (error || !ep) throw error || new Error('Episodio no encontrado');
  const { data: series } = await supabase.from('series').select('slug, story_bible').eq('id', ep.series_id).single();
  const { data: chars } = await supabase.from('characters').select('name, profile').eq('series_id', ep.series_id);
  const sb = series.story_bible || {};
  const OUT = path.join(FINALES, series.slug, 'prueba_ltx_voz');
  fs.mkdirSync(OUT, { recursive: true });
  const latest = (kind, n) => (ep.assets || []).filter((a) => a.kind === kind && a.shot_number === n && a.storage_path).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const voiceOf = (spk) => {
    const ex = sb.extras && sb.extras[spk];
    if (ex) return (typeof ex === 'string' ? '' : ex.voice) || '';
    const c = (chars || []).find((r) => r.name === spk || String(r.name).split(' ')[0] === spk);
    return (c && c.profile && c.profile.voice) || '';
  };

  const done = [];
  for (const n of pick) {
    const shot = (ep.shots || []).find((s) => s.n === n);
    const frame = latest('image', n);
    if (!shot || !frame) { console.log(`toma ${n}: sin guion o sin cuadro, la salto`); continue; }
    const d = (Array.isArray(shot.dialogue) ? shot.dialogue : shot.dialogue ? [shot.dialogue] : []).find((x) => x && x.line);
    const loc = sb.locations && sb.locations[shot.location];
    const ambient = loc && typeof loc === 'object' ? loc.ambient : '';
    let prompt = K.ltxPromptFor(shot, sb);
    if (d) {
      const voice = voiceOf(d.speaker) || 'a natural voice';
      prompt = prompt.replace('There are absolutely no captions', `The speaker says, in Spanish, with ${voice}, clearly and at a natural pace: "${d.line}" Only this person speaks; everyone else stays silent. Sound: ${ambient ? ambient + ', ' : ''}quiet, no music, no other voices. There are absolutely no captions`);
    }
    // Sin "talking, lip movement" en el negativo (aquí SÍ debe hablar) y sin música/voces extra.
    const negative = K.ltxNegativeFor(shot, sb) + ', music, singing, background voices, crowd noise';
    const fb = Buffer.from(await (await fetch(frame.storage_path)).arrayBuffer());
    console.log(`\nTOMA ${n} (${d ? d.speaker + ': ' + d.line : 'sin diálogo'})`);
    const t0 = Date.now();
    const { videoBuffer } = await K.kingGenerateVideo({ prompt, negative, startImage: { imageBytes: fb.toString('base64'), mimeType: 'image/jpeg' }, durationSeconds: 8, keepAudio: true, log: (...a) => console.log(...a) });
    const name = `ep${ep.episode_number}_t${String(n).padStart(2, '0')}.mp4`;
    fs.writeFileSync(path.join(OUT, name), videoBuffer);
    fs.writeFileSync(path.join(OUT, name.replace('.mp4', '_prompt.txt')), prompt + '\n\nNEGATIVO: ' + negative);
    console.log(`TOMA ${n}: LISTA en ${Math.round((Date.now() - t0) / 1000)} s → ${series.slug}\\prueba_ltx_voz\\${name}`);
    done.push(name);
  }
  if (done.length > 1) {
    // Todas seguidas en un solo archivo para escucharlas de corrido (¿es la misma voz?).
    const inputs = done.flatMap((f) => ['-i', f]);
    const fc = done.map((_, i) => `[${i}:v]scale=704:1280,setsar=1,fps=24[v${i}];[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`).join(';') + ';' + done.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${done.length}:v=1:a=1[v][a]`;
    const all = `ep${ep.episode_number}_todas.mp4`;
    await run(['-y', ...inputs, '-filter_complex', fc, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', all], OUT);
    console.log(`\nTODAS SEGUIDAS: ${series.slug}\\prueba_ltx_voz\\${all}`);
  }
  console.log('\nLISTO:', done.join(', '));
}

main().catch((err) => { console.error('ERROR:', err.message || err); process.exit(1); });
