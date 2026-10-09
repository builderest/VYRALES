// LISTA BLANCA de comandos que la página puede pedir. SOLO esto se ejecuta: la página manda
// el nombre (ej. "push") y nunca texto libre. Para agregar un comando, edítalo AQUÍ, en tu PC.
// cmd/args van separados (sin shell) para que nada pueda inyectar comandos extra.
module.exports = {
  estado: {
    label: 'Estado del proyecto',
    help: 'git status + últimos 5 commits',
    steps: [['git', ['status', '-sb']], ['git', ['log', '--oneline', '-5']]]
  },
  push: {
    label: 'Subir cambios (git push)',
    help: 'Publica los commits en GitHub → Netlify despliega solo',
    steps: [['git', ['push', 'origin', 'main']], ['git', ['status', '-sb']]]
  },
  pull: {
    label: 'Bajar cambios (git pull)',
    help: 'Trae lo último de GitHub (solo avance rápido, nunca mezcla)',
    steps: [['git', ['pull', '--ff-only']]]
  },
  dev_start: { label: 'Iniciar servidor local', help: 'npm run dev (netlify dev) en segundo plano', special: 'dev_start' },
  dev_stop: { label: 'Detener servidor local', help: 'Para el netlify dev que inició el agente', special: 'dev_stop' },
  dev_restart: { label: 'Reiniciar servidor local', help: 'Detiene y vuelve a iniciar netlify dev', special: 'dev_restart' },
  dev_log: { label: 'Ver log del servidor local', help: 'Últimas 120 líneas de netlify dev', special: 'dev_log' },
  // "gen_local:<episode_id>" — produce el episodio con LTX-2.5 en king (lo pide el panel).
  gen_local: {
    label: 'Producir episodio en la PC (LTX)', help: 'Genera todas las tomas con LTX-2.5 en king, voces, unión y textos',
    special: 'gen_local', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, hidden: true
  },
  // "regen_local:<episode_id>:<tomas>[:<tomas con cuadro nuevo>]" — rehacer tomas en king y volver a unir.
  regen_local: {
    label: 'Rehacer tomas en la PC (LTX)', help: 'Rehace tomas con LTX en king y vuelve a unir el episodio',
    special: 'regen_local', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{1,2}(,\d{1,2})*(:\d{1,2}(,\d{1,2})*)?$/i, hidden: true
  },
  // "prueba_ltx_voz:<episode_id>:<tomas>" — LTX genera video CON su propia voz (prueba, no toca el episodio).
  prueba_ltx_voz: { label: 'Prueba LTX con voces propias', help: 'LTX genera las tomas con la voz incluida (gratis en king) para comparar con las voces fijas', special: 'prueba_ltx_voz', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{1,2}(,\d{1,2})*$/i, hidden: true },
  // Graba el video demo para la revisión de TikTok (abre Edge/Chrome visible; tú inicias sesión en TikTok).
  grabar_demo_tiktok: { label: 'Grabar demo para TikTok', help: 'Abre el navegador en esta PC y graba el flujo Conectar TikTok → Post to TikTok (tú solo inicias sesión en TikTok y das Authorize)', special: 'grabar_demo_tiktok' },
  prueba_ltx_final: { label: 'Prueba LTX con cuadro final', help: 'LTX con cuadro inicial + final (gratis en king) para comparar contra solo inicial', special: 'prueba_ltx_final', hidden: true },
  flow_login: { label: 'Flow: iniciar sesión (una vez)', help: 'Abre Flow en el Chrome de VYRALES para que inicies sesión con tu cuenta de Google', special: 'flow_login' },
  // "flow_cuadros:<episode_id>[:<tomas>]" — cuadros con Google Flow en una sesión + videos en king.
  flow_cuadros: { label: 'Flow: cuadros del episodio', help: 'Genera los cuadros iniciales en Google Flow (una sesión) y rehace los videos en king', special: 'flow_cuadros', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:\d{1,2}(,\d{1,2})*)?$/i, hidden: true },
  // "toma_local:<episode_id>:<n>" — una sola toma (cuadro + video) en king; lo pide el panel.
  toma_local: { label: 'Una toma en king', help: 'Genera una sola toma (cuadro + video) en la PC king', special: 'toma_local', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{1,2}$/i, hidden: true },
  diag_python: { label: 'Diagnóstico Python', help: 'Revisa si hay Python en la PC', special: 'diag_python' },
  flow_prueba_ref: { label: 'Flow: prueba con foto de referencia', help: 'Genera 1 imagen en Flow usando una foto de cara como referencia', special: 'flow_prueba_ref' },
  flow_frames: { label: 'Flow: cuadros que faltan (sin video)', help: 'Lo pide el panel: genera con Google Flow los cuadros iniciales que faltan', special: 'flow_frames', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, hidden: true },
  flow_ver: { label: 'Flow: mostrar ventana', help: 'Hace la prueba de Flow con la ventana de Chrome visible', special: 'flow_ver' },
  flow_prueba: { label: 'Flow: imagen de prueba', help: 'Genera 1 imagen en Flow con tu cuenta y la guarda', special: 'flow_prueba' },
  prueba_flux_nat: { label: 'Prueba Flux naturaleza (inicio+final)', help: 'Cuadros inicial y final con Flux.2 Klein en king para tomas sin caras (gratis)', special: 'prueba_flux_nat' },
  prueba_flux: { label: 'Prueba cuadros Flux en king (3 tomas EP3)', help: 'Hace 3 cuadros iniciales del EP 3 con Flux.2 Klein en king y los pone al lado de los de Gemini (gratis)', special: 'prueba_flux' },
  prueba_ltx: { label: 'Prueba LTX-2.5 en king (3 tomas EP2)', help: 'Genera 3 tomas del EP 2 con LTX-2.5 en king y las deja junto a las de Veo en finales/prueba_ltx (gratis)', special: 'prueba_ltx' },
  discos: { label: 'Espacio en discos de esta PC', help: 'Libre / total de cada disco (C:, D:, E:...) y dónde se guardan los videos', special: 'discos' },
  pc_https: { label: 'Activar reproducción desde la PC (HTTPS)', help: 'tailscale serve: publica dentro de Tailscale https://<esta-pc>.ts.net para que el panel reproduzca desde aquí', special: 'pc_https' },
  gen_estado: { label: 'Probar PC generadora (king)', help: 'Revisa por Tailscale si ComfyUI de king responde (GPU, memoria, cola)', special: 'gen_estado' },
  // Con argumento: "render_full:<episode_id>" (solo un UUID; se valida aquí y en la función agent).
  // No sale como botón en la Terminal: lo pide el panel de revisión o el propio agente.
  render_full: {
    label: 'Video final en calidad completa', help: 'Arma el video final sin recomprimir y lo guarda en VYRALE/finales',
    special: 'render_full', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, hidden: true
  },
  // "publish:<episode_id>:<tiktok|youtube>[:private]" — lo encola el botón Publicar cuando la PC tiene
  // la versión en calidad completa; sube ESE archivo con las cuentas conectadas.
  publish: {
    label: 'Publicar en calidad completa', help: 'Sube el video de VYRALE/finales a TikTok o YouTube',
    special: 'publish_local', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(tiktok|youtube)(:private|:public)?$/i, hidden: true
  }
};
