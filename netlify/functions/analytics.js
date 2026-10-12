// GET  /.netlify/functions/analytics           → datos reales del canal (ver _analytics.js)
// POST /.netlify/functions/analytics {action:'ideas'} → ideas de próximos videos con Gemini
//      (~$0.002 por llamada, se anota en generation_log). Solo con la sesión/llave del panel.
const { getSupabaseClient } = require('./_supabase');
const { checkDashboardKey } = require('./_auth');
const { collect, TOPICS } = require('./_analytics');
const { logSpend } = require('./_spend');
const { TEXT_MODEL } = require('./_publish');
const TEXT_PRICE = { input: 0.75, output: 3.75 };
const json = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });

let cache = null; // { at, data } — 3 min, para no gastar cuota de la API en cada recarga
async function getData(sb, fresh) {
  if (!fresh && cache && Date.now() - cache.at < 180000) return cache.data;
  const data = await collect(sb);
  // Si YouTube Analytics falló por un error temporal, no se guarda en caché (el siguiente Actualizar reintenta).
  if (!(data.youtube && data.youtube.analytics && data.youtube.analytics.reason === 'temporal')) cache = { at: Date.now(), data };
  return data;
}

function summary(d) {
  const vids = (d.youtube.videos || []).filter((v) => v.privacy !== 'private');
  const lines = vids.map((v) => {
    const hrs = Math.max(1, (Date.now() - new Date(v.published).getTime()) / 3600000);
    return `- "${v.title}" | tema: ${v.topic} | ${v.views} vistas en ${Math.round(hrs)} h | ${v.duration}s` + (v.avgPct != null ? ` | ${Math.round(v.avgPct)}% visto` : '') + ` | ${v.likes} likes`;
  });
  return lines.join('\n');
}

async function ideasPrompt(sb, body, data) {
  const d = data || await getData(sb, false);
  const focus = String(body.focus || '').slice(0, 200);
  const prompt = [
    'Eres estratega de contenido de VYRALES: canal en español (Latinoamérica y EE. UU.) de documentales cortos verticales (YouTube Shorts, TikTok, Reels), hechos con IA, narrados por una sola voz solemne con pausas dramáticas.',
    'Analiza el rendimiento REAL de nuestros videos y propone los próximos videos con más probabilidad de funcionar.',
    'REGLAS: temas reales y verificables (historia, ciencia, prehistoria, guerras, espacio, misterios con base científica); apto para toda la familia; nada de desinformación ni clickbait que el video no cumpla; el gancho EMPIEZA por el tema que más llama la atención (como "La Tercera Guerra Mundial estuvo a punto de empezar…"); cada video se entiende solo (no depende de partes); duración 60–110 s.',
    'Prioriza los temas y estilos que ya funcionaron en nuestros datos, pero incluye 1 idea de un tema nuevo para probar. Sé honesto: "por_que" debe citar el dato de nuestros videos en que te basas (o decir que es una prueba).',
    focus ? `El creador pide enfocarse en: ${focus}` : '',
    '', 'Nuestros videos (YouTube):', summary(d) || '(sin datos)',
    '', 'Temas posibles: ' + TOPICS.map((t) => t[0]).join(', ') + ', Otros.',
    '', 'Devuelve SOLO este JSON:',
    '{"ideas":[{"titulo":"título de YouTube, máx 70 caracteres","gancho":"primera frase exacta del narrador","tema":"uno de los temas","por_que":"1 frase con el dato en que se basa","duracion_s":75,"tags":["3 palabras clave"],"nuevo":false}]}',
    'Exactamente 6 ideas.'
  ].filter(Boolean).join('\n');
  return prompt;
}
async function ideas(sb, body) {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error('Falta GOOGLE_AI_API_KEY.');
  const prompt = await ideasPrompt(sb, body);
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.9 } })
  });
  const j = await res.json();
  if (!res.ok) throw new Error('Gemini HTTP ' + res.status + ': ' + JSON.stringify(j.error || j).slice(0, 200));
  const text = j.candidates && j.candidates[0] && j.candidates[0].content.parts.map((p) => p.text || '').join('');
  let out; try { out = JSON.parse(text); } catch (_) { throw new Error('Gemini no devolvió JSON válido.'); }
  const u = j.usageMetadata || {};
  const costUsd = ((u.promptTokenCount || 2000) * TEXT_PRICE.input + ((u.candidatesTokenCount || 800) + (u.thoughtsTokenCount || 0)) * TEXT_PRICE.output) / 1e6;
  await logSpend(sb, { kind: 'text', model: TEXT_MODEL, costUsd, note: 'analitica: ideas' });
  return { ideas: (out.ideas || []).slice(0, 8), costUsd, at: new Date().toISOString() };
}

exports.ideasPrompt = ideasPrompt;
exports.collectData = (sb) => getData(sb, true);
exports.handler = async (event) => {
  const sb = getSupabaseClient();
  try {
    if (event.httpMethod === 'POST') {
      const bad = checkDashboardKey(event);
      if (bad) return json(401, { error: bad });
      const body = JSON.parse(event.body || '{}');
      const agentOnline = async () => { const { data: st } = await sb.from('agent_state').select('last_seen').eq('id', 1).maybeSingle(); return !!(st && st.last_seen && Date.now() - new Date(st.last_seen).getTime() < 90000); };
      // GRATIS PRIMERO (Franklin, oct-11): las ideas las escribe Claude en la PC con el plan ($0). Gemini (de pago) solo si lo pides con paid:true.
      if (body.action === 'ideas' && !body.paid) {
        if (!(await agentOnline())) return json(200, { offline: true });
        const job = 'ideas-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const { uploadFile } = require('./_storage');
        await uploadFile(sb, { path: `guiones/${job}.req.json`, buffer: Buffer.from(JSON.stringify({ focus: String(body.focus || '').slice(0, 200), at: new Date().toISOString() })), contentType: 'application/json' });
        const { error } = await sb.from('agent_jobs').insert({ command: 'claude_ideas:' + job });
        if (error) return json(500, { error: error.message });
        return json(200, { queued: true, job });
      }
      if (body.action === 'ideas') return json(200, await ideas(sb, body));
      if (body.action === 'claude_largo') { // VIDEO LARGO + SHORTS con Claude en la PC ($0, ~25 min)
        const job = 'largo-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const idea = body.idea || {};
        const tipo = /guerra|batalla|historia|humanos antiguos/i.test(idea.tema || '') ? 'historia' : /misterio/i.test(idea.tema || '') ? 'misterios' : 'curiosidades';
        const topic = [idea.titulo, idea.gancho ? 'Gancho sugerido: ' + idea.gancho : '', idea.por_que ? 'Por qué (dato del canal): ' + idea.por_que : '', 'Cuenta la historia COMPLETA, real y verificable, con las personas, la evidencia y lo que significa hoy.'].filter(Boolean).join('\n');
        const { uploadFile } = require('./_storage');
        await uploadFile(sb, { path: `guiones/${job}.req.json`, buffer: Buffer.from(JSON.stringify({ tipo, topic, idea, at: new Date().toISOString() })), contentType: 'application/json' });
        const online = await agentOnline();
        const { error } = await sb.from('agent_jobs').insert({ command: 'claude_largo:' + job });
        if (error) return json(500, { error: error.message });
        return json(200, { queued: true, job, online, titulo: idea.titulo || '' });
      }
      if (body.action === 'claude_script') { // guion con Claude en la PC (plan de Claude, $0): pedido → Storage + orden al agente
        const job = String(body.job || '').replace(/[^a-z0-9-]/gi, '').slice(0, 60);
        if (job.length < 6) return json(400, { error: 'Falta job.' });
        const { uploadFile } = require('./_storage');
        await uploadFile(sb, { path: `guiones/${job}.req.json`, buffer: Buffer.from(JSON.stringify({ idea: body.idea || {}, at: new Date().toISOString() })), contentType: 'application/json' });
        const { data: st } = await sb.from('agent_state').select('last_seen').eq('id', 1).maybeSingle();
        const online = !!(st && st.last_seen && Date.now() - new Date(st.last_seen).getTime() < 90000);
        const { error } = await sb.from('agent_jobs').insert({ command: 'claude_guion:' + job });
        if (error) return json(500, { error: error.message });
        return json(200, { queued: true, online });
      }
      return json(400, { error: 'Acción no válida.' });
    }
    const qs = event.queryStringParameters || {};
    if (qs.script) { // resultado del botón "Crear guion" (lo deja idea-script-background en Storage)
      const job = String(qs.script).replace(/[^a-z0-9-]/gi, '');
      const { data } = sb.storage.from('media').getPublicUrl(`guiones/${job}.json`);
      const r = await fetch(data.publicUrl + '?t=' + Date.now());
      if (!r.ok) return json(200, { pending: true });
      return json(200, await r.json());
    }
    const fresh = qs.fresh === '1';
    return json(200, await getData(sb, fresh));
  } catch (err) {
    return json(500, { error: err.message });
  }
};

// Claves de la página Cuenta → API (cifradas en Supabase; mandan sobre el .env). Ver _keys.js.
exports.handler = require('./_keys').withKeys(exports.handler);
