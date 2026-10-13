// MULTIUSUARIO de VYRALES: quién llama, a qué espacio pertenece y qué puede tocar.
//
// * Cada usuario vive en un ESPACIO (workspaces). Tus datos de siempre están en el espacio ADMIN.
// * Episodios, tomas y personajes cuelgan de una serie: el dueño de la serie es el dueño de todo eso.
// * withTenant() envuelve CADA función (lo llama withKeys en _keys.js): lee la sesión, busca en la
//   petición los identificadores (series, episode_id, assetId, character_id…) y si alguno es de OTRO
//   espacio responde 403 antes de que la función haga nada. Después aplica las claves de API de ese
//   espacio y deja el "contexto" disponible con current() para el resto de la petición.
// * Si la migración 009 todavía no se corrió, todo funciona como antes (un solo usuario: tú).
//
// Sesión (cookie vyrales_auth, firmada con DASHBOARD_KEY — ver login.js y edge-functions/auth.js):
//   "u.<userId>.<vence>.<firma>"  → usuario con email y contraseña
//   "<vence>.<firma>"             → formato viejo = admin (sigue funcionando)
//   header x-vyrales-key = DASHBOARD_KEY → "sistema" (llamadas internas servidor→servidor y el agente)
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const ADMIN_WS = '00000000-0000-0000-0000-000000000001';
const als = new AsyncLocalStorage();
let BASE_DEFAULT_SERIES; // DEFAULT_SERIES_SLUG del .env / Netlify (del admin)
const current = () => als.getStore() || null;

// ---------- contraseñas (scrypt) ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 });
  return 'scrypt$16384$8$1$' + salt.toString('base64') + '$' + hash.toString('base64');
}
function verifyPassword(pw, stored) {
  const p = String(stored || '').split('$');
  if (p.length !== 6 || p[0] !== 'scrypt') return false;
  try {
    const want = Buffer.from(p[5], 'base64');
    const got = crypto.scryptSync(String(pw), Buffer.from(p[4], 'base64'), want.length, { N: +p[1], r: +p[2], p: +p[3] });
    return crypto.timingSafeEqual(got, want);
  } catch (_) { return false; }
}

// ---------- sesión ----------
const sessionSecret = () => process.env.DASHBOARD_KEY || '';
function signUser(uid, exp) { return crypto.createHmac('sha256', sessionSecret()).update('vyrales:' + uid + ':' + exp).digest('hex'); }
function userCookieValue(uid, days) {
  const exp = Date.now() + days * 86400000;
  return 'u.' + uid + '.' + exp + '.' + signUser(uid, exp);
}
function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function parseSession(event) {
  const key = sessionSecret();
  if (!key) return null;
  const h = (event && event.headers) || {};
  // 1) La cookie de sesión manda (así un navegador con sesión de usuario nunca entra como "sistema").
  const m = String(h.cookie || h.Cookie || '').match(/(?:^|;\s*)vyrales_auth=([^;]+)/);
  if (m) {
    const p = decodeURIComponent(m[1]).split('.');
    if (p[0] === 'u' && p.length === 4) {
      const [, uid, exp, sig] = p;
      if (Number(exp) > Date.now() && /^[0-9a-f-]{36}$/i.test(uid) && same(sig, signUser(uid, exp))) return { kind: 'user', uid };
    } else if (p.length === 2) {
      const [exp, sig] = p;
      const good = crypto.createHmac('sha256', key).update('vyrales:' + exp).digest('hex');
      if (Number(exp) > Date.now() && same(sig, good)) return { kind: 'admin_legacy' };
    }
  }
  // 2) Llamadas internas / agente: header con la DASHBOARD_KEY.
  const hk = h['x-vyrales-key'] || h['X-Vyrales-Key'];
  if (hk && same(hk, key)) return { kind: 'system' };
  return null;
}

// Canal activo elegido por el admin (cookie vyrales_ws): un UUID. Solo se respeta para admin (ver withTenant).
function parseActiveWs(event) {
  const h = (event && event.headers) || {};
  const m = String(h.cookie || h.Cookie || '').match(/(?:^|;\s*)vyrales_ws=([0-9a-f-]{36})(?:;|$)/i);
  return m ? m[1] : null;
}

// ---------- ¿ya se corrió la migración 009? ----------
let tenancy = { at: 0, on: null };
async function tenancyOn(sb) {
  if (tenancy.on !== null && Date.now() - tenancy.at < 60000) return tenancy.on;
  try {
    const { error } = await sb.from('workspaces').select('id').limit(1);
    tenancy = { at: Date.now(), on: !error };
  } catch (_) { tenancy = { at: Date.now(), on: false }; }
  return tenancy.on;
}
function tenancyKnownOn() { return tenancy.on === true; }

// ---------- usuarios y espacios (caché corta) ----------
const cache = new Map();
async function cached(key, ms, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ms) return c.v;
  const v = await fn();
  cache.set(key, { at: Date.now(), v });
  return v;
}
function forget(prefix) { for (const k of cache.keys()) if (!prefix || k.startsWith(prefix)) cache.delete(k); }
async function loadWs(sb, id) {
  return cached('ws:' + id, 15000, async () => {
    const { data } = await sb.from('workspaces').select('*').eq('id', id).maybeSingle();
    return data || null;
  });
}
async function loadUser(sb, uid) {
  return cached('user:' + uid, 15000, async () => {
    const { data: user } = await sb.from('app_users').select('id, email, name, role, active, prefs, workspace_id').eq('id', uid).maybeSingle();
    if (!user) return null;
    const ws = await loadWs(sb, user.workspace_id);
    return ws ? { user, ws } : null;
  });
}

// ---------- ¿de quién es este dato? ----------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function wsOfSeriesSlug(sb, slug) {
  const { data } = await sb.from('series').select('workspace_id').eq('slug', String(slug)).maybeSingle();
  return data ? data.workspace_id : null;
}
async function wsOfSeriesId(sb, id) {
  if (!UUID.test(String(id))) return null;
  const { data } = await sb.from('series').select('workspace_id').eq('id', id).maybeSingle();
  return data ? data.workspace_id : null;
}
async function wsOfEpisode(sb, id) {
  if (!UUID.test(String(id))) return null;
  const { data } = await sb.from('episodes').select('series_id').eq('id', id).maybeSingle();
  return data ? wsOfSeriesId(sb, data.series_id) : null;
}
async function wsOfAsset(sb, id) {
  if (!UUID.test(String(id))) return null;
  const { data } = await sb.from('assets').select('episode_id').eq('id', id).maybeSingle();
  return data ? wsOfEpisode(sb, data.episode_id) : null;
}
async function wsOfCharacter(sb, id) {
  if (!UUID.test(String(id))) return null;
  const { data } = await sb.from('characters').select('series_id').eq('id', id).maybeSingle();
  return data ? wsOfSeriesId(sb, data.series_id) : null;
}
async function wsOfJob(sb, id) {
  if (!UUID.test(String(id))) return null;
  const { data } = await sb.from('agent_jobs').select('workspace_id').eq('id', id).maybeSingle();
  return data ? data.workspace_id : null;
}

function readBody(event) {
  if (!event || !event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const j = JSON.parse(raw);
    return j && typeof j === 'object' ? j : {};
  } catch (_) {
    try { return Object.fromEntries(new URLSearchParams(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body)); } catch (__) { return {}; }
  }
}

// Todos los identificadores que traen las funciones del panel (ver la lista en el README de multiusuario).
function extractRefs(event, opts) {
  const q = (event && event.queryStringParameters) || {};
  const b = readBody(event);
  const refs = [];
  const add = (type, v) => { if (v != null && v !== '') refs.push([type, v]); };
  for (const src of [q, b]) {
    if (!opts.softSeries) {
      if (typeof src.series === 'string') add('slug', src.series);
      else if (src.series && typeof src.series === 'object' && src.series.slug) add('slug', src.series.slug);
    }
    add('slug', src.slug);
    add('slug', src.confirm_slug);
    add('series_id', src.series_id);
    add('episode', src.episode_id);
    add('episode', src.episodeId);
    add('asset', src.assetId);
    add('asset', src.asset_id);
    if (Array.isArray(src.assetIds)) src.assetIds.slice(0, 200).forEach((x) => add('asset', x));
    add('character', src.character_id);
    if (opts.jobParam) add('job', src.job);
  }
  return refs;
}
async function ownersOf(sb, refs) {
  const owners = new Set();
  for (const [type, v] of refs) {
    let ws = null;
    if (type === 'slug') ws = await wsOfSeriesSlug(sb, v);
    else if (type === 'series_id') ws = await wsOfSeriesId(sb, v);
    else if (type === 'episode') ws = await wsOfEpisode(sb, v);
    else if (type === 'asset') ws = await wsOfAsset(sb, v);
    else if (type === 'character') ws = await wsOfCharacter(sb, v);
    else if (type === 'job') ws = await wsOfJob(sb, v);
    if (ws) owners.add(ws); // lo que no existe no tiene dueño: la función responderá "no encontrado"
  }
  return owners;
}

const jsonRes = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });

// ---------- el envoltorio de cada función ----------
// opts: { adminOnly, softSeries, jobParam }
function withTenant(handler, opts, applyKeysForCtx) {
  opts = opts || {};
  return async function (event, context) {
    if (current()) return handler(event, context); // llamada interna (una función llamando a otra): ya se revisó
    let sb;
    try { sb = require('./_supabase').getSupabaseClient(); } catch (_) { return handler(event, context); }
    const on = await tenancyOn(sb);
    const sess = parseSession(event);
    let ctx;
    if (!on) {
      ctx = { mode: 'legacy', isAdmin: true, wsId: ADMIN_WS, ws: null, user: null, borrowed: new Set() };
    } else {
      if (sess && sess.kind === 'user') {
        const r = await loadUser(sb, sess.uid);
        if (!r || !r.user.active || !r.ws.active) return jsonRes(401, { error: 'Tu cuenta no está activa. Vuelve a iniciar sesión o habla con el administrador.' });
        ctx = { mode: 'user', isAdmin: !!r.ws.is_admin, wsId: r.ws.id, ws: r.ws, user: r.user };
      } else if (sess && sess.kind === 'admin_legacy') {
        ctx = { mode: 'user', isAdmin: true, wsId: ADMIN_WS, ws: await loadWs(sb, ADMIN_WS), user: null };
      } else if (sess && sess.kind === 'system') {
        ctx = { mode: 'system', isAdmin: true, wsId: null, ws: null, user: null };
      } else {
        ctx = { mode: 'anon', isAdmin: false, wsId: null, ws: null, user: null };
      }
      // CANAL ACTIVO (oct-13): el admin puede trabajar en otro canal suyo sin re-loguear.
      // Solo para admin, y solo a su canal principal o a un canal que le pertenece (owner_ws = admin).
      if (ctx.mode === 'user' && ctx.isAdmin) {
        const selWs = parseActiveWs(event);
        if (selWs && selWs !== ctx.wsId) {
          const w = await loadWs(sb, selWs);
          if (w && (w.id === ADMIN_WS || w.owner_ws === ADMIN_WS)) { ctx.wsId = w.id; ctx.ws = w; ctx.isAdmin = true; }
        }
      }
      if (opts.adminOnly && !(ctx.isAdmin && (ctx.mode === 'user' || ctx.mode === 'system'))) {
        return jsonRes(403, { error: 'Solo el administrador puede usar esta función.' });
      }
      // Guardia: nada de otro espacio.
      const owners = await ownersOf(sb, extractRefs(event, opts));
      if (ctx.mode === 'user') {
        for (const w of owners) if (w !== ctx.wsId) return jsonRes(403, { error: 'No tienes acceso a esa novela o episodio.' });
      } else {
        if (owners.size > 1) return jsonRes(400, { error: 'La petición mezcla datos de cuentas distintas.' });
        if (ctx.mode === 'anon' && owners.size) return jsonRes(401, { error: 'Inicia sesión.' });
        ctx.wsId = owners.size ? [...owners][0] : ADMIN_WS; // sistema/anónimo: el espacio dueño del dato (o admin)
        ctx.ws = await loadWs(sb, ctx.wsId);
        ctx.isAdmin = !!(ctx.ws && ctx.ws.is_admin);
      }
    }
    ctx.sb = sb;
    ctx.borrowed = new Set();
    // Varias funciones viejas usan DEFAULT_SERIES_SLUG (la novela del admin) cuando no les mandan serie.
    // Para otras cuentas se apaga: así nunca terminan trabajando sobre una novela del admin.
    if (BASE_DEFAULT_SERIES === undefined) BASE_DEFAULT_SERIES = process.env.DEFAULT_SERIES_SLUG || null;
    if (ctx.wsId && ctx.wsId !== ADMIN_WS) process.env.DEFAULT_SERIES_SLUG = '__sin_serie_de_esta_cuenta__';
    else if (BASE_DEFAULT_SERIES) process.env.DEFAULT_SERIES_SLUG = BASE_DEFAULT_SERIES;
    else delete process.env.DEFAULT_SERIES_SLUG;
    if (applyKeysForCtx) {
      // Máximo 2.5 s esperando: si Supabase tarda, sigue con lo que ya había (.env / Netlify)
      await Promise.race([applyKeysForCtx(sb, ctx).catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
    }
    return als.run(ctx, () => handler(event, context));
  };
}

// Espacio dueño de los datos que se están creando ahora (funciones: el contexto; agente: VYRALES_WS).
function currentWs() {
  const c = current();
  return (c && c.wsId) || process.env.VYRALES_WS || ADMIN_WS;
}
// Columnas extra para un insert, solo si la migración 009 ya existe.
function wsFields(extra) {
  return tenancyKnownOn() ? Object.assign({ workspace_id: currentWs() }, extra || {}) : Object.assign({}, extra || {});
}

// ---------- créditos ----------
async function adminSettings(sb) {
  const ws = await loadWs(sb, ADMIN_WS);
  const s = (ws && ws.settings) || {};
  return {
    markup: Number(s.markup) > 0 ? Number(s.markup) : 2.5,
    credit_usd: Number(s.credit_usd) > 0 ? Number(s.credit_usd) : 0.01,
    pc_job_credits: Number.isFinite(Number(s.pc_job_credits)) ? Number(s.pc_job_credits) : 10,
    pc_shot_credits: Number.isFinite(Number(s.pc_shot_credits)) ? Number(s.pc_shot_credits) : 10
  };
}
async function creditMove(sb, wsId, delta, reason, detail, costUsd, by) {
  const { data, error } = await sb.rpc('credit_move', { p_ws: wsId, p_delta: Math.round(delta), p_reason: reason, p_detail: detail ? String(detail).slice(0, 200) : null, p_cost: costUsd == null ? null : Number(costUsd), p_by: by || null });
  if (error) throw new Error('No se pudo mover créditos: ' + error.message);
  forget('ws:' + wsId);
  return data;
}
// Cobro por usar una clave prestada del admin (lo llama _spend.js con el costo real).
async function chargeApiUse(sb, { wsId, service, costUsd, note }) {
  if (!wsId || wsId === ADMIN_WS || !(costUsd > 0) || !service) return null;
  const c = current();
  const borrowed = c && c.borrowed ? c.borrowed : new Set(String(process.env.VYRALES_BORROWED || '').split(',').filter(Boolean));
  if (!borrowed.has(service)) return null; // usó su propia clave: no se cobra
  const st = await adminSettings(sb);
  const credits = Math.max(1, Math.ceil(costUsd * st.markup / st.credit_usd - 1e-9));
  return creditMove(sb, wsId, -credits, 'uso_api', service + ' · ' + (note || ''), costUsd, null);
}

// Antes de mandar un trabajo a la PC del admin: permisos, Claude y cobro. Devuelve las columnas del insert.
const PC_SHOT = /^(gen_local|regen_local|toma_local):/;
const PC_ALLOWED_FOR_USERS = /^(gen_local|regen_local|toma_local|voz_continua|flow_frames|flow_cuadros|flow_lugar|render_full|publish|publish_pkg|subtitulos|portada_yt|voz_ingles):/;
async function agentJobFields(sb, command) {
  if (!tenancyKnownOn() && !(await tenancyOn(sb))) return {};
  const c = current();
  const wsId = currentWs();
  if (wsId === ADMIN_WS) return { workspace_id: wsId };
  const ws = (c && c.ws && c.ws.id === wsId) ? c.ws : await loadWs(sb, wsId);
  if (ws && ws.owner_ws === ADMIN_WS) return { workspace_id: wsId }; // canal del admin: usa SU Claude y SU PC, sin cobrar créditos (oct-13)
  if (/^claude_/.test(command)) throw Object.assign(new Error('Los guiones con Claude en la PC son solo del administrador (su plan de Claude no se puede compartir). Usa la opción pagada con tus créditos o tu propia clave.'), { status: 403 });
  if (!PC_ALLOWED_FOR_USERS.test(command)) throw Object.assign(new Error('Tu cuenta no puede usar ese comando de la PC.'), { status: 403 });
  if (!ws || !(ws.perms && ws.perms.pc)) throw Object.assign(new Error('Tu cuenta no tiene permiso para usar la PC del administrador. Usa tus propias APIs o pide acceso.'), { status: 403 });
  const st = await adminSettings(sb);
  let price = st.pc_job_credits;
  if (PC_SHOT.test(command)) {
    let shots = 1;
    if (/^gen_local:/.test(command)) {
      const epId = command.split(':')[1];
      const { data: ep } = await sb.from('episodes').select('shots').eq('id', epId).maybeSingle();
      shots = Math.max(1, ((ep && ep.shots) || []).length);
    }
    price = shots * st.pc_shot_credits;
  }
  if (price > 0) {
    if ((ws.credits || 0) < price) throw Object.assign(new Error('No tienes créditos suficientes: este trabajo en la PC cuesta ' + price + ' créditos y tienes ' + (ws.credits || 0) + '.'), { status: 402 });
    await creditMove(sb, wsId, -price, 'uso_pc', command.split(':')[0], 0, null);
  }
  return { workspace_id: wsId };
}

// Fila lista para insertar en agent_jobs (con su espacio, permisos y cobro). Lanza error si no se permite.
async function jobRow(sb, command) { return Object.assign({ command }, await agentJobFields(sb, command)); }

module.exports = {
  jobRow, wsOfJob,
  ADMIN_WS, current, currentWs, wsFields, withTenant, tenancyOn, tenancyKnownOn,
  hashPassword, verifyPassword, userCookieValue, parseSession, parseActiveWs,
  loadWs, loadUser, forget, wsOfSeriesSlug, wsOfEpisode, readBody,
  adminSettings, creditMove, chargeApiUse, agentJobFields
};
