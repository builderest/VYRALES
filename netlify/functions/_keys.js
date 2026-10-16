// Claves de las APIs (página Cuenta → API), ahora POR ESPACIO (multiusuario).
//
// * Se guardan CIFRADAS (AES-256-GCM) en app_secrets (migraciones 008 y 009), una fila por (espacio, nombre).
// * En cada petición se aplican a process.env las claves del espacio que llama:
//     - Admin: la del panel manda sobre la del .env / Netlify (decisión de Franklin, oct-11).
//     - Otro usuario: SU clave; si no tiene y el admin le PRESTÓ ese servicio (y tiene créditos para
//       Google / fal), usa la del admin y queda marcada como "prestada" (se cobra en créditos, ver _spend.js);
//       si no, la variable queda VACÍA: nunca ve ni usa las claves del admin sin permiso.
// * withKeys() envuelve cada función: primero la guardia de espacios (_tenant.js), después las claves.
// * Lista blanca: solo estos nombres. Supabase, DASHBOARD_KEY y VYRALES_SECRET NUNCA vienen de aquí.
const crypto = require('crypto');
const T = require('./_tenant');

const SERVICES = [
  { id: 'google', name: 'Google AI', sub: 'Gemini · Veo · Imagen · voces', icon: 'fa-brands fa-google',
    desc: 'Guiones, imágenes, videos con Veo, voces y revisión de calidad.',
    url: 'https://aistudio.google.com/apikey', test: true, charged: true,
    fields: [{ name: 'GOOGLE_AI_API_KEY', label: 'API key', secret: true }] },
  { id: 'fal', name: 'fal.ai', sub: 'Veo por fal.ai', icon: 'fa-solid fa-bolt',
    desc: 'Videos con Veo a través de fal.ai (opcional si usas Google o la PC).',
    url: 'https://fal.ai/dashboard/keys', test: false, charged: true,
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
             { name: 'META_PAGE_ID', label: 'ID de la página de Facebook', secret: false, own: true },
             { name: 'INSTAGRAM_APP_ID', label: 'App ID (Instagram)', secret: false },
             { name: 'INSTAGRAM_APP_SECRET', label: 'App secret (Instagram)', secret: true }] },
  { id: 'youtube', name: 'YouTube', sub: 'Publicar en YouTube', icon: 'fa-brands fa-youtube',
    desc: 'Credenciales OAuth de Google Cloud (tipo "Aplicación web").',
    url: 'https://console.cloud.google.com/apis/credentials', test: true,
    fields: [{ name: 'YOUTUBE_CLIENT_ID', label: 'Client ID', secret: false },
             { name: 'YOUTUBE_CLIENT_SECRET', label: 'Client secret', secret: true },
             { name: 'YOUTUBE_CHANNEL_URL', label: 'Enlace del canal', secret: false, own: true }] },
  { id: 'sitio', name: 'Sitio', sub: 'Dirección pública', icon: 'fa-solid fa-globe', adminOnly: true,
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
const FIELD = Object.fromEntries(SERVICES.flatMap((s) => s.fields.map((f) => [f.name, Object.assign({ service: s.id }, f)])));
const SERVICE = Object.fromEntries(SERVICES.map((s) => [s.id, s]));

// Valores del .env / Netlify al arrancar (son del ADMIN). Nunca se pierden aunque se reemplacen en process.env.
const BASE = {};
for (const n of ALLOWED) if (process.env[n]) BASE[n] = process.env[n];

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

function isMissingTable(err) {
  const m = String((err && (err.message || err.code)) || '');
  return /42P01|PGRST205|does not exist|Could not find the table/i.test(m) || (err && (err.code === '42P01' || err.code === 'PGRST205'));
}

// ---------- filas del panel por espacio (caché 60 s) ----------
const ROWS = new Map(); // wsId → { at, vals: {name: valor}, updated: {name: fecha}, error }
async function rowsFor(sb, wsId, force) {
  const c = ROWS.get(wsId);
  if (!force && c && Date.now() - c.at < 60000) return c;
  const out = { at: Date.now(), vals: {}, updated: {}, error: null };
  try {
    const on = await T.tenancyOn(sb);
    let q = sb.from('app_secrets').select(on ? 'name, value_enc, updated_at, workspace_id' : 'name, value_enc, updated_at');
    if (on) q = q.eq('workspace_id', wsId);
    else if (wsId !== T.ADMIN_WS) { ROWS.set(wsId, out); return out; } // sin multiusuario solo existe el admin
    if (q && typeof q.abortSignal === 'function' && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) q = q.abortSignal(AbortSignal.timeout(2500));
    const { data, error } = await q;
    if (error) { out.error = error; if (c) { c.error = error; c.at = Date.now(); return c; } ROWS.set(wsId, out); return out; }
    for (const row of data || []) {
      if (!ALLOWED.has(row.name)) continue;
      const v = decrypt(row.value_enc);
      if (v == null || v === '') continue;
      out.vals[row.name] = v;
      out.updated[row.name] = row.updated_at;
    }
  } catch (e) { out.error = e; }
  ROWS.set(wsId, out);
  return out;
}
function forgetRows(wsId) { if (wsId) ROWS.delete(wsId); else ROWS.clear(); }

// Qué valor usa cada nombre para un espacio y de dónde sale.
//   source: 'panel' (su clave) · 'servidor' (.env/Netlify, solo admin) · 'prestada' (del admin, con permiso) · 'falta'
async function resolveFor(sb, ctx, force) {
  const wsId = (ctx && ctx.wsId) || T.ADMIN_WS;
  const admin = await rowsFor(sb, T.ADMIN_WS, force);
  const adminVal = (n) => admin.vals[n] || BASE[n];
  const isAdminWs = wsId === T.ADMIN_WS;
  const own = isAdminWs ? admin : await rowsFor(sb, wsId, force);
  const ws = ctx && ctx.ws ? ctx.ws : (isAdminWs ? null : await T.loadWs(sb, wsId));
  const perms = (ws && ws.perms && ws.perms.keys) || {};
  const credits = Number(ws && ws.credits) || 0;
  const vals = {}, src = {}, borrowed = new Set();
  for (const n of ALLOWED) {
    const f = FIELD[n];
    if (isAdminWs) {
      if (admin.vals[n]) { vals[n] = admin.vals[n]; src[n] = 'panel'; }
      else if (BASE[n]) { vals[n] = BASE[n]; src[n] = 'servidor'; }
      else src[n] = 'falta';
      continue;
    }
    if (own.vals[n]) { vals[n] = own.vals[n]; src[n] = 'panel'; continue; }
    // Canal DEL ADMIN (owner_ws = admin, p. ej. MindFuel): usa las claves del admin como su canal principal, sin
    // préstamo ni créditos (igual que ya usa su Claude y su PC). Antes caía en "falta" → "Falta GOOGLE_AI_API_KEY" al
    // preparar textos en MindFuel (Franklin, oct-16). Lo propio del canal (página de Facebook, enlace del canal) NO se hereda.
    if (ws && ws.owner_ws === T.ADMIN_WS && !f.own) { if (adminVal(n)) { vals[n] = adminVal(n); src[n] = 'servidor'; } else src[n] = 'falta'; continue; }
    if (SERVICE[f.service].adminOnly) { if (adminVal(n)) { vals[n] = adminVal(n); src[n] = 'servidor'; } else src[n] = 'falta'; continue; }
    const canBorrow = !f.own && perms[f.service] === true && adminVal(n) && (!SERVICE[f.service].charged || credits > 0);
    if (canBorrow) { vals[n] = adminVal(n); src[n] = 'prestada'; borrowed.add(f.service); }
    else src[n] = (!f.own && perms[f.service] === true && SERVICE[f.service].charged && credits <= 0) ? 'sin_creditos' : 'falta';
  }
  return { vals, src, borrowed, updated: own.updated, error: own.error || admin.error };
}

// Aplica a process.env las claves del espacio de esta petición (lo llama _tenant.withTenant).
async function applyForCtx(sb, ctx, force) {
  const r = await resolveFor(sb, ctx, force);
  for (const n of ALLOWED) {
    if (r.vals[n]) process.env[n] = r.vals[n];
    else delete process.env[n];
  }
  if (ctx) { ctx.borrowed = r.borrowed; ctx.keySources = r.src; }
  return r;
}

// Compatibilidad: el agente y api-keys usan applyKeys (siempre como admin).
async function applyKeys(sb, force) {
  const r = await applyForCtx(sb, { wsId: T.ADMIN_WS, isAdmin: true }, force);
  return { rows: Object.keys(r.updated).map((name) => ({ name, updated_at: r.updated[name] })), error: r.error };
}

// Para el agente: variables de entorno de un trabajo de OTRO espacio (valor o '' si no tiene).
async function keysEnvFor(sb, wsId) {
  const ws = await T.loadWs(sb, wsId);
  const r = await resolveFor(sb, { wsId, ws }, true);
  const env = {};
  for (const n of ALLOWED) env[n] = r.vals[n] || '';
  env.VYRALES_WS = wsId;
  env.VYRALES_BORROWED = [...r.borrowed].join(',');
  return env;
}

const serverValue = (name) => BASE[name];

function withKeys(handler, opts) {
  return T.withTenant(handler, opts || {}, (sb, ctx) => applyForCtx(sb, ctx));
}

module.exports = {
  SERVICES, SERVER_ONLY, ALLOWED, FIELD, SERVICE, encrypt, decrypt, isMissingTable,
  rowsFor, forgetRows, resolveFor, applyForCtx, applyKeys, keysEnvFor, withKeys, serverValue
};
