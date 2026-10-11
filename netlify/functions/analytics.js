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
  cache = { at: Date.now(), data };
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

async function ideas(sb, body) {
  const key = process.env.GOOGLE_AI_API_KEY;
  if (!key) throw new Error('Falta GOOGLE_AI_API_KEY.');
  const d = await getData(sb, false);
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

exports.handler = async (event) => {
  const sb = getSupabaseClient();
  try {
    if (event.httpMethod === 'POST') {
      const bad = checkDashboardKey(event);
      if (bad) return json(401, { error: bad });
      const body = JSON.parse(event.body || '{}');
      if (body.action === 'ideas') return json(200, await ideas(sb, body));
      return json(400, { error: 'Acción no válida.' });
    }
    const fresh = (event.queryStringParameters || {}).fresh === '1';
    return json(200, await getData(sb, fresh));
  } catch (err) {
    return json(500, { error: err.message });
  }
};
