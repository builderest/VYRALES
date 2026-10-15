// PRODUCIR UN EPISODIO EN LA PC (lo lanza el agente: node agente/gen_local.js <episode_id>)
// Corre el MISMO generador que vyrales.app (generate-media-background.js: cuadros iniciales,
// voces, unión automática, textos para publicar) pero aquí en Cronix y con el proveedor "king":
// cada toma la genera LTX-2.5 en la PC king por Tailscale (gratis). Solo se paga lo de Google
// que no es video: cuadros iniciales (~$0.067 c/u) y voces (~$0.004 c/u).
// Sin el límite de 15 min de Netlify (un episodio de 20 tomas tarda ~30-40 min en king).
//
// oct-15 (Franklin): "el verificador no tiene que esperar a que king termine todos los videos
// para ir revisando, para ganar tiempo". Antes: UNA llamada generaba TODAS las tomas y SOLO
// DESPUÉS corría el QA completo (de ahí que un episodio largo se viera "atascado" horas después
// de que king ya había terminado de producir). Ahora: se pide una toma a la vez y, apenas esa
// toma queda guardada, se ENCADENA una revisión de QA (sin esperarla) mientras se pide la
// siguiente toma. Las revisiones de QA se encadenan ENTRE SÍ (nunca dos al mismo tiempo) para
// no pisarse escribiendo episodes.shots; _qa.js ahora se salta lo que ya revisó (sh.qa.mech_ok)
// así que llamarlo muchas veces no repite el análisis de lo que ya pasó.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
process.env.VYRALES_LOCAL_RUN = '1'; // sin límite de tiempo ni auto-llamadas a Netlify

async function main() {
  const episodeId = process.argv[2];
  if (!/^[0-9a-f-]{36}$/i.test(episodeId || '')) throw new Error('Uso: node agente/gen_local.js <episode_id>');
  const { getSupabaseClient } = require(path.join(ROOT, 'netlify', 'functions', '_supabase'));
  const supabase = getSupabaseClient();
  const { data: ep, error } = await supabase.from('episodes').select('id, episode_number, series_id, status').eq('id', episodeId).single();
  if (error || !ep) throw error || new Error('Episodio no encontrado');
  const { data: series } = await supabase.from('series').select('slug, title').eq('id', ep.series_id).single();
  // Short que sale de un video LARGO ya hecho (Franklin, oct-11): no se generan tomas nuevas; se usan las del largo
  // con la narración del Short (short_reusar.js). Los Shorts sueltos (sin largo) se generan normal con LTX + QA.
  if (!Number(process.argv[3])) {
    const { data: e1 } = await supabase.from('episodes').select('continuity').eq('id', episodeId).single();
    const parent = e1 && e1.continuity && e1.continuity.parent_episode_id;
    if (parent && process.env.VYRALES_SHORT_NUEVO !== '1') {
      const { count } = await supabase.from('assets').select('id', { count: 'exact', head: true }).eq('episode_id', parent).eq('kind', 'video_clip');
      if (!count) throw new Error('Este Short sale de un video largo que todavía no tiene tomas: produce primero el largo (el Short usa sus tomas).');
      if (count > 0) {
        console.log('Este Short sale de un video largo ya hecho → uso sus tomas (sin generar video nuevo).');
        const { spawnSync } = require('child_process');
        const r = spawnSync(process.execPath, [path.join(__dirname, 'short_reusar.js'), episodeId], { stdio: 'inherit', timeout: 60 * 60000 });
        process.exit(r.status == null ? 1 : r.status);
      }
    }
  }

  const onlyShot = Number(process.argv[3]) || null;
  const { handler } = require(path.join(ROOT, 'netlify', 'functions', 'generate-media-background'));
  const callHandler = (extra) => handler({ httpMethod: 'POST', headers: { 'x-vyrales-key': process.env.DASHBOARD_KEY || '' }, /* llamada interna = "sistema" (multiusuario) */ body: JSON.stringify(Object.assign({ series: series.slug, episode_id: episodeId, provider: 'king', force: ep.status === 'generando_media' }, extra || {})), queryStringParameters: {} });

  if (onlyShot) {
    // Toma de prueba suelta: sin cambios, igual que antes (sin QA progresivo).
    console.log(`Produciendo "${series.title}" EP ${ep.episode_number} (solo la toma ${onlyShot}) con LTX-2.5 en king...`);
    const res = await callHandler({ shot: onlyShot });
    console.log('RESULTADO', res.statusCode, String(res.body || '').slice(0, 800));
    if (res.statusCode >= 400) process.exit(1);
    return;
  }

  const { data: epShots } = await supabase.from('episodes').select('shots').eq('id', episodeId).single();
  const totalShots = (epShots && epShots.shots || []).length;

  if (!totalShots) {
    // Episodio sin tomas estructuradas (guion legacy en texto): no se puede pedir toma por toma
    // por número, así que se mantiene el comportamiento de siempre (todo de una, QA al final).
    console.log(`Produciendo "${series.title}" EP ${ep.episode_number} con LTX-2.5 en king (guion legacy, sin QA progresivo)...`);
    const res = await callHandler();
    console.log('RESULTADO', res.statusCode, String(res.body || '').slice(0, 800));
    if (res.statusCode >= 400) process.exit(1);
    try {
      const { handler: regen } = require(path.join(ROOT, 'netlify', 'functions', 'regen-shot-background'));
      const redone = await require('./_qa').qaShots({ supabase, epId: episodeId, handler: regen, log: (...x) => console.log(...x) });
      if (redone.length) await mergeFinal();
    } catch (e) { console.log('QA: no se pudo (' + String(e.message).slice(0, 200) + ')'); }
    return;
  }

  console.log(`Produciendo "${series.title}" EP ${ep.episode_number} (${totalShots} tomas) con LTX-2.5 en king — QA en vivo, toma por toma...`);

  let anyRedone = false;
  let qaChain = Promise.resolve();
  const { handler: regen } = require(path.join(ROOT, 'netlify', 'functions', 'regen-shot-background'));
  // Encadena una revisión de QA DESPUÉS de la anterior (nunca dos a la vez, para no pisarse
  // escribiendo episodes.shots) pero SIN esperarla aquí: la toma siguiente se pide ya mismo.
  const scheduleQa = () => {
    qaChain = qaChain
      .then(() => require('./_qa').qaShots({ supabase, epId: episodeId, handler: regen, log: (...x) => console.log('[QA en vivo]', ...x) }))
      .then((redone) => { if (redone && redone.length) anyRedone = true; })
      .catch((e) => console.log('[QA en vivo] error:', String(e.message || e).slice(0, 200)));
    return qaChain;
  };

  for (let n = 1; n <= totalShots; n++) {
    const res = await callHandler({ shot: n });
    console.log(`RESULTADO toma ${n}/${totalShots}`, res.statusCode, String(res.body || '').slice(0, 400));
    if (res.statusCode >= 400) {
      console.log(`toma ${n}/${totalShots}: no se pudo generar (${res.statusCode}) — sigo con la siguiente.`);
      continue;
    }
    scheduleQa(); // no await: el QA de lo generado hasta ahora corre mientras se pide la toma n+1
  }

  console.log('Generación de todas las tomas terminada. Esperando a que termine la última revisión de QA en curso...');
  await qaChain;
  // Última pasada de seguridad (por si quedó algo sin revisar, p. ej. por un corte a mitad).
  try {
    const redoneFinal = await require('./_qa').qaShots({ supabase, epId: episodeId, handler: regen, log: (...x) => console.log('[QA final]', ...x) });
    if (redoneFinal && redoneFinal.length) anyRedone = true;
  } catch (e) { console.log('QA final: no se pudo (' + String(e.message).slice(0, 200) + ')'); }

  if (anyRedone) await mergeFinal();

  async function mergeFinal() {
    try {
      const { mergeEpisodeVideo } = require(path.join(ROOT, 'netlify', 'functions', '_merge'));
      const { data: fresh } = await supabase.from('episodes').select('*, assets(*)').eq('id', episodeId).single();
      const { data: sr } = await supabase.from('series').select('id, slug, title, genre, story_bible').eq('id', ep.series_id).single();
      const m = await mergeEpisodeVideo(supabase, { episode: fresh, series: sr, log: (...x) => console.log(...x) });
      console.log('QA: video final unido de nuevo:', m.asset && m.asset.storage_path);
    } catch (e) { console.log('QA: no se pudo unir el video final (' + String(e.message).slice(0, 200) + ')'); }
  }
}
main().catch((err) => { console.error('ERROR:', err.message || err); process.exit(1); });
