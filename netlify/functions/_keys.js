// Claves de las APIs guardadas desde el panel (Cuenta → API).
//
// * Se guardan CIFRADAS (AES-256-GCM) en la tabla app_secrets de Supabase (ver supabase/migrations/008_app_secrets.sql).
// * La clave del PANEL manda sobre la del .env / Netlify (decisión de Franklin, oct-11). Si se quita
//   del panel, vuelve a usarse la del .env / Netlify.
// * applyKeys() las copia a process.env (máx. 1 consulta por minuto por instancia), así todo el código
//   que ya lee process.env.X sigue igual. withKeys() envuelve cada handler para que se apliquen antes.
// * Lista blanca: solo estos nombres. Supabase, DASHBOARD_KEY y VYRALES_SECRET NUNCA vienen de aquí.
const crypto = require('crypto');

const SERVICES = [
  { id: 'google', name: 'Google AI', sub: 'Gemini · Veo · Imagen · voces', icon: 'fa-brands fa-google',
    desc: 'Guiones, imágenes, videos con Veo, voces y revisión de calidad.',
    url: 'https://aistudio.google.com/apikey', test: true,
    fields: [{ name: 'GOOGLE_AI_API_KEY', label: 'API key', secret: true }] },
  { id: 'fal', name: 'fal.ai', sub: 'Veo por fal.ai', icon: 'fa-solid fa-bolt',
    desc: 'Videos con Veo a través de fal.ai (opcional si usas Google o tu PC).',
    url: 'https://fal.ai/dashboard/keys', test: false,
    fields: [{ name: 'FAL_KEY', label: 'API key', secret: true }] },
  { id: 'tiktok', name: 'TikTok', sub: 'Publicar en TikTok', icon: 'fa-brands fa-tiktok',
    desc: 'La app de TikTok for Developers. Después conecta tu cuenta en Redes conectadas.',
    url: 'https://developers.tiktok.com/apps', test: true,
    fields: [{ name: 'TIKTOK_CLIENT_KEY', label: 'Client key', secret: false },
             { name: 'TIKTOK_CLIENT_SECRET', label: 'Client secret', secret: true }] },
  { id: 'meta', name: 'Meta', sub: 'Facebook e Instagram', icon: 'fa-brands fa-meta',
    desc: 'La app de Meta for Developers y tu página de Facebook.',
    url: 'https://developers.facebook.com/apps', test: true,
    fields: [{ name: 'META_APP_ID', label: 'App ID (Facebook)', secret: false },
             { name: 'META_APP_SECRET', label: 'App secret (Facebook)', secret: true },
             { name: 'META_PAGE_ID', label: 'ID de la página de Facebook', secret: false },
             { name: 'INSTAGRAM_APP_ID', label: 'App ID (Instagram)', secret: false },
             { name: 'INSTAGRAM_APP_SECRET', label: 'App secret (Instagram)', secret: true }] },
  { id: 'youtube', name: 'YouTube', sub: 'Publicar en YouTube', icon: 'fa-brands fa-youtube',
    desc: 'Credenciales OAuth de Google Cloud (tipo "Aplicación web").',
    url: 'https://console.cloud.google.com/apis/credentials', test: true,
    fields: [{ name: 'YOUTUBE_CLIENT_ID', label: 'Client ID', secret: false },
             { name: 'YOUTUBE_CLIENT_SECRET', label: 'Client secret', secret: true },
             { name: 'YOUTUBE_CHANNEL_URL', label: 'Enlace del canal', secret: false }] },
  { id: 'sitio', name: 'Sitio', sub: 'Dirección pública', icon: 'fa-solid fa-globe',
    desc: 'La dirección donde está publicado el panel (para enlaces y regresos de las redes).',
    url: '', test: false,
    fields: [{ name: 'PUBLIC_BASE_URL', label: 'Dirección pública (https://…)', secret: false }] }
];
// Solo se muestran (configuradas o no); nunca se cambian desde la web.
const SERVER_ONLY = [
  { name: 'SUPABASE_URL', label: 'Supabase · URL del proyecto' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Supabase · service_role key' },
  { name: 'DASHBOARD_KEY', label: 'Llave del panel (login)' }
];
const ALLOWED = new Set(SERVICES.flatMap((s) => s.fields.map((f) => f.name)));
const FIELD = Object.fromEntries(SERVICES.flatMap((s) => s.fields.map((f) => [f.name, f])));

// ---------- cifrado ----------
function cryptoKey() {
  const base = process.env.VYRALES_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!base) throw new Error('Falta VYRALES_SECRET o SUPABASE_SERVICE_ROLE_KEY para cifrar las claves.');
  return crypto.createHash('sha256').update('vyrales-app-secrets|' + base).digest();
}
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cryptoKey(), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return 'v1:' + iv.toString('base64') + ':' + c.getAuthTag().toString('base64') + ':' + ct.toString('base64');
}
function decrypt(blob) {
  const p = String(blob || '').split(':');
  if (p.length !== 4 || p[0] !== 'v1') return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', cryptoKey(), Buffer.from(p[1], 'base64'));
    d.setAuthTag(Buffer.from(p[2], 'base64'));
    return Buffer.concat([d.update(Buffer.from(p[3], 'base64')), d.final()]).toString('utf8');
  } catch (_) { return null; } // otra llave de cifrado o dato dañado: se ignora
}

// ---------- aplicar al proceso ----------
const ORIGINAL = {};           // valor del .env / Netlify antes de que el panel lo reemplace
let panelNames = new Set();    // nombres que hoy vienen del panel
let lastAt = 0;
let lastRows = [];
let lastError = null;

function isMissingTable(err) {
  const m = String((err && (err.message || err.code)) || '');
  return /42P01|PGRST205|does not exist|Could not find the table/i.test(m) || (err && (err.code === '42P01' || err.code === 'PGRST205'));
}

async function applyKeys(sb, force) {
  if (!force && Date.now() - lastAt < 60000) return { rows: lastRows, error: lastError };
  lastAt = Date.now();
  try {
    if (!sb) sb = require('./_supabase').getSupabaseClient();
    let q = sb.from('app_secrets').select('name, value_enc, updated_at');
    if (q && typeof q.abortSignal === 'function' && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) q = q.abortSignal(AbortSignal.timeout(2500));
    const { data, error } = await q;
    if (error) { lastError = error; return { rows: lastRows, error }; }
    lastError = null;
    const now = new Set();
    for (const row of data || []) {
      if (!ALLOWED.has(row.name)) continue;
      const v = decrypt(row.value_enc);
      if (v == null || v === '') continue;
      if (!panelNames.has(row.name) && !Object.prototype.hasOwnProperty.call(ORIGINAL, row.name)) ORIGINAL[row.name] = process.env[row.name];
      process.env[row.name] = v;
      now.add(row.name);
    }
    // Lo que se quitó del panel vuelve a su valor del .env / Netlify
    for (const name of panelNames) {
      if (now.has(name)) continue;
      if (ORIGINAL[name] === undefined) delete process.env[name]; else process.env[name] = ORIGINAL[name];
      delete ORIGINAL[name];
    }
    panelNames = now;
    lastRows = (data || []).filter((r) => ALLOWED.has(r.name)).map((r) => ({ name: r.name, updated_at: r.updated_at }));
    return { rows: lastRows, error: null };
  } catch (e) {
    lastError = e;
    return { rows: lastRows, error: e }; // nunca rompe la función: sigue con el .env / Netlify
  }
}

// Valor del servidor (.env / Netlify) aunque el panel lo esté reemplazando
function serverValue(name) {
  return panelNames.has(name) ? ORIGINAL[name] : process.env[name];
}
function fromPanel(name) { return panelNames.has(name); }

function withKeys(handler) {
  return async function (event, context) {
    // Máximo 2.5 s esperando a Supabase: si tarda, la función sigue con las claves que ya tenía (.env / Netlify)
    await Promise.race([applyKeys(), new Promise((r) => setTimeout(r, 2500))]);
    return handler(event, context);
  };
}

module.exports = { SERVICES, SERVER_ONLY, ALLOWED, FIELD, encrypt, decrypt, applyKeys, withKeys, serverValue, fromPanel, isMissingTable };
