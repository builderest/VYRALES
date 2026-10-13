// /.netlify/functions/agent — Terminal de VYRALES (lado servidor).
//   GET                      → estado del agente (en línea si avisó hace < 15 s) + últimas órdenes
//   GET ?job=<id>            → una orden con su salida (la página la va leyendo)
//   POST { command }         → encola una orden de la LISTA BLANCA (nombres de agente/comandos.js)
// Nunca ejecuta nada aquí: solo guarda el nombre; el agente de tu PC decide si lo corre.
const { getSupabaseClient } = require('./_supabase');
const { checkDashboardKey } = require('./_auth');
const COMMANDS = require('../../agente/comandos');
const T = require('./_tenant');

const json = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  const denied = checkDashboardKey(event);
  if (denied) return json(401, { error: denied });
  const sb = getSupabaseClient();
  // MULTIUSUARIO: cada espacio ve solo SUS órdenes; los usuarios (no admin) solo pueden mandar trabajos de
  // producción de SUS episodios y si el admin les dio permiso de usar su PC (se cobran créditos, ver _tenant.js).
  const on = await T.tenancyOn(sb);
  const ctx = T.current();
  const isAdmin = !ctx || ctx.isAdmin;
  const mine = (q) => (on ? q.eq('workspace_id', T.currentWs()) : q);
  try {
    if (event.httpMethod === 'POST') {
      const { command } = JSON.parse(event.body || '{}');
      // "nombre" o "nombre:argumento" (solo si el comando declara un argumento y este pasa su validación).
      const [name, arg] = String(command || '').split(/:(.*)/s);
      const def = Object.prototype.hasOwnProperty.call(COMMANDS, name) ? COMMANDS[name] : null;
      if (!def || (def.arg ? !def.arg.test(arg || '') : arg !== undefined)) return json(400, { error: 'Comando no permitido.' });
      if (!isAdmin) {
        // El argumento debe ser un episodio de SU espacio (gen_local:<id>, flow_frames:<id>, …)
        const epId = String(arg || '').split(':')[0];
        const owner = /^[0-9a-f-]{36}$/i.test(epId) ? await T.wsOfEpisode(sb, epId) : null;
        if (!owner || owner !== T.currentWs()) return json(403, { error: 'Ese comando no es para tu cuenta.' });
      }
      // Producir / rehacer en la PC esperan su turno en la fila (el agente las hace una por una);
      // los comandos de la Terminal no se encolan si hay algo corriendo.
      const queueable = ['gen_local', 'regen_local', 'qa_tomas', 'voz_continua', 'flow_frames', 'flow_lugar', 'claude_pulir', 'claude_revisar', 'claude_detalle', 'claude_guion', 'claude_largo', 'claude_ideas', 'grabar_demo_tiktok'].includes(name);
      if (!queueable) {
        if (!isAdmin) return json(403, { error: 'La Terminal es solo del administrador.' });
        const { data: busy } = await sb.from('agent_jobs').select('id').in('status', ['pending', 'running']).limit(1);
        if (busy && busy.length) return json(409, { error: 'Ya hay una orden en curso; espera a que termine.' });
      } else {
        const { data: dup } = await sb.from('agent_jobs').select('id').eq('command', command).in('status', ['pending', 'running']).limit(1);
        if (dup && dup.length) return json(409, { error: 'Esa misma orden ya está en la fila de la PC.' });
      }
      let extra;
      try { extra = await T.agentJobFields(sb, command); } catch (e) { return json(e.status || 403, { error: e.message }); }
      const { data, error } = await sb.from('agent_jobs').insert(Object.assign({ command }, extra)).select().single();
      if (error) throw error;
      return json(200, { job: data });
    }
    const q = event.queryStringParameters || {};
    if (q.job) {
      const { data, error } = await mine(sb.from('agent_jobs').select('*').eq('id', q.job)).single();
      if (error) throw error;
      return json(200, { job: data });
    }
    const [{ data: st, error: e1 }, { data: jobs }] = await Promise.all([
      sb.from('agent_state').select('*').eq('id', 1).maybeSingle(),
      mine(sb.from('agent_jobs').select('id, command, status, exit_code, created_at, finished_at')).order('created_at', { ascending: false }).limit(10)
    ]);
    if (e1) return json(200, { table_missing: true, error: e1.message, commands: list() });
    const online = !!(st && st.last_seen && Date.now() - new Date(st.last_seen).getTime() < 15000);
    // files: videos en calidad completa guardados en la PC y la dirección (Tailscale) para bajarlos.
    // A los usuarios no se les muestra el nombre de tu PC ni tus videos guardados en ella.
    if (!isAdmin) return json(200, { online, pc_allowed: !!(ctx.ws && ctx.ws.perms && ctx.ws.perms.pc), commands: [], jobs: jobs || [] });
    return json(200, { online, host: st && st.host, last_seen: st && st.last_seen, dev_running: !!(st && st.info && st.info.dev_running), files: (st && st.info && st.info.files) || null, commands: list(), jobs: jobs || [] });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
function list() { return Object.entries(COMMANDS).filter(([, c]) => !c.hidden).map(([key, c]) => ({ key, label: c.label, help: c.help })); }

// Claves de la página Cuenta → API (cifradas en Supabase; mandan sobre el .env). Ver _keys.js.
exports.handler = require('./_keys').withKeys(exports.handler);
