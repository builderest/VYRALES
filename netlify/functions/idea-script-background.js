// POST /.netlify/functions/idea-script-background { job, idea }  (botón "Crear guion" de /analitica.html)
// Escribe el guion COMPLETO (el mismo JSON que se pega en "PROMPT") a partir de una idea, con el guionista
// maestro del tipo de video, y le pasa el revisor IMAGEN = NARRACIÓN para dejar todos los prompts súper
// detallados. El resultado queda en Storage (media/guiones/<job>.json) y la página lo lee con
// GET /.netlify/functions/analytics?script=<job>. ~$0.10–0.20 por guion (Gemini Pro + revisor).
const { getSupabaseClient } = require('./_supabase');
const { checkDashboardKey } = require('./_auth');
const { uploadFile } = require('./_storage');
const { buildNarratedPrompt, TIPOS } = require('./_guionista');
const { checkVisuals, applyChanges } = require('./_visual_check');
const { logSpend } = require('./_spend');

const WRITER = process.env.SCRIPT_MODEL || 'gemini-3.1-pro-preview';
const WRITER_PRICE = { input: 2, output: 12 }; // USD por 1M tokens (estimado; se anota en generation_log)
const FALLBACK = 'gemini-3.8-flash';
const FALLBACK_PRICE = { input: 0.75, output: 3.75 };

const tipoFor = (tema) => /guerra|batalla|historia|humanos antiguos/i.test(tema || '') ? 'historia' : /misterio/i.test(tema || '') ? 'misterios' : 'curiosidades';

async function write(model, price, prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': process.env.GOOGLE_AI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.9 } })
  });
  const j = await res.json();
  if (!res.ok) throw new Error(model + ' HTTP ' + res.status + ': ' + JSON.stringify(j.error || j).slice(0, 200));
  const text = j.candidates && j.candidates[0] && j.candidates[0].content.parts.map((p) => p.text || '').join('');
  const data = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/g, ''));
  const u = j.usageMetadata || {};
  return { data, costUsd: ((u.promptTokenCount || 5000) * price.input + ((u.candidatesTokenCount || 5000) + (u.thoughtsTokenCount || 0)) * price.output) / 1e6, model };
}

exports.handler = async (event) => {
  const bad = checkDashboardKey(event);
  if (bad) return { statusCode: 401, body: bad };
  const supabase = getSupabaseClient();
  const body = JSON.parse(event.body || '{}');
  const job = String(body.job || '').replace(/[^a-z0-9-]/gi, '').slice(0, 60);
  if (!job) return { statusCode: 400, body: 'Falta job' };
  const save = (obj) => uploadFile(supabase, { path: `guiones/${job}.json`, buffer: Buffer.from(JSON.stringify(obj)), contentType: 'application/json' });
  try {
    const idea = body.idea || {};
    const tipo = tipoFor(idea.tema);
    const topic = [
      idea.titulo ? `Título: ${idea.titulo}` : '',
      idea.gancho ? `Gancho sugerido (primera frase del narrador; mejóralo si puedes, sin perder el tema): ${idea.gancho}` : '',
      idea.por_que ? `Por qué este tema (dato del canal): ${idea.por_que}` : '',
      `Duración objetivo: ${Math.max(60, Math.min(110, Number(idea.duracion_s) || 80))} s. Video que se entiende solo (no es parte de una serie).`
    ].filter(Boolean).join('\n');
    const prompt = buildNarratedPrompt(tipo, { topic });
    let r;
    try { r = await write(WRITER, WRITER_PRICE, prompt); }
    catch (e) { console.warn('[idea-script] escritor principal falló, uso', FALLBACK, e.message); r = await write(FALLBACK, FALLBACK_PRICE, prompt); }
    const data = r.data;
    const ep = data && data.episodes && data.episodes[0];
    if (!ep || !Array.isArray(ep.shots) || !ep.shots.length) throw new Error('El guion salió sin tomas.');
    // Prompts súper detallados + imagen = narración (aún no hay cuadros → se reescriben todas las imágenes).
    const vc = await checkVisuals({ series: { title: data.title || TIPOS[tipo].title }, shots: ep.shots, rewriteStart: 'all', log: () => {} });
    ep.shots = applyChanges(ep.shots, vc.changes);
    ep.continuity = Object.assign({}, ep.continuity || {}, { visual_checked: new Date().toISOString(), from_idea: idea.titulo || '' });
    // Validación igual que el modal PROMPT (no importa nada).
    const { handler: imp } = require('./import-series');
    const v = await imp({ httpMethod: 'POST', queryStringParameters: {}, body: JSON.stringify({ series: data, dry_run: true }) });
    const validation = JSON.parse(v.body || '{}');
    const costUsd = r.costUsd + vc.costUsd;
    await logSpend(supabase, { kind: 'text', model: r.model, costUsd, note: 'guion desde idea: ' + String(idea.titulo || '').slice(0, 60) });
    await save({ ok: true, tipo, model: r.model, costUsd, validation, series: data, at: new Date().toISOString() });
  } catch (err) {
    console.error('[idea-script] ERROR', err.message);
    await save({ ok: false, error: err.message, at: new Date().toISOString() }).catch(() => {});
  }
  return { statusCode: 200, body: 'ok' };
};
