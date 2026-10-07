// /.netlify/functions/agent — Terminal de VYRALES (lado servidor).
//   GET                      → estado del agente (en línea si avisó hace < 15 s) + últimas órdenes
//   GET ?job=<id>            → una orden con su salida (la página la va leyendo)
//   POST { command }         → encola una orden de la LISTA BLANCA (nombres de agente/comandos.js)
// Nunca ejecuta nada aquí: solo guarda el nombre; el agente de tu PC decide si lo corre.
const { getSupabaseClient } = require('./_supabase');
const { checkDashboardKey } = require('./_auth');
const COMMANDS = require('../../agente/comandos');

const json = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });

exports.handler = async (event) => {
  const denied = checkDashboardKey(event);
  if (denied) return json(401, { error: denied });
  const sb = getSupabaseClient();
  try {
    if (event.httpMethod === 'POST') {
      const { command } = JSON.parse(event.body || '{}');
      // "nombre" o "nombre:argumento" (solo si el comando declara un argumento y este pasa su validación).
      const [name, arg] = String(command || '').split(/:(.*)/s);
      const def = Object.prototype.hasOwnProperty.call(COMMANDS, name) ? COMMANDS[name] : null;
      if (!def || (def.arg ? !def.arg.test(arg || '') : arg !== undefined)) return json(400, { error: 'Comando no permitido.' });
      // Producir / rehacer en la PC esperan su turno en la fila (el agente las hace una por una);
      // los comandos de la Terminal no se encolan si hay algo corriendo.
      const queueable = ['gen_local', 'regen_local'].includes(name);
      if (!queueable) {
        const { data: busy } = await sb.from('agent_jobs').select('id').in('status', ['pending', 'running']).limit(1);
        if (busy && busy.length) return json(409, { error: 'Ya hay una orden en curso; espera a que termine.' });
      } else {
        const { data: dup } = await sb.from('agent_jobs').select('id').eq('command', command).in('status', ['pending', 'running']).limit(1);
        if (dup && dup.length) return json(409, { error: 'Esa misma orden ya está en la fila de la PC.' });
      }
      const { data, error } = await sb.from('agent_jobs').insert({ command }).select().single();
      if (error) throw error;
      return json(200, { job: data });
    }
    const q = event.queryStringParameters || {};
    if (q.job) {
      const { data, error } = await sb.from('agent_jobs').select('*').eq('id', q.job).single();
      if (error) throw error;
      return json(200, { job: data });
    }
    const [{ data: st, error: e1 }, { data: jobs }] = await Promise.all([
      sb.from('agent_state').select('*').eq('id', 1).maybeSingle(),
      sb.from('agent_jobs').select('id, command, status, exit_code, created_at, finished_at').order('created_at', { ascending: false }).limit(10)
    ]);
    if (e1) return json(200, { table_missing: true, error: e1.message, commands: list() });
    const online = !!(st && st.last_seen && Date.now() - new Date(st.last_seen).getTime() < 15000);
    // files: videos en calidad completa guardados en la PC y la dirección (Tailscale) para bajarlos.
    return json(200, { online, host: st && st.host, last_seen: st && st.last_seen, dev_running: !!(st && st.info && st.info.dev_running), files: (st && st.info && st.info.files) || null, commands: list(), jobs: jobs || [] });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
function list() { return Object.entries(COMMANDS).filter(([, c]) => !c.hidden).map(([key, c]) => ({ key, label: c.label, help: c.help })); }
