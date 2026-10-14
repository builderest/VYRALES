// LISTA BLANCA de comandos que la página puede pedir. SOLO esto se ejecuta: la página manda
// el nombre (ej. "push") y nunca texto libre. Para agregar un comando, edítalo AQUÍ, en tu PC.
// cmd/args van separados (sin shell) para que nada pueda inyectar comandos extra.
module.exports = {
  estado: {
    label: 'Estado del proyecto',
    help: 'git status + últimos 5 commits',
    steps: [['git', ['status', '-sb']], ['git', ['log', '--oneline', '-5']]]
  },
  // Diagnóstico de red de esta PC hacia king (oct-14: tras reiniciarse Cronix, el agente no llegaba a ComfyUI).
  red_diag: {
    label: 'Diagnóstico de red (Tailscale)',
    help: 'tailscale status + ping a king + prueba HTTP a ComfyUI',
    steps: [['curl.exe', ['-sS', '-v', '-m', '15', 'http://100.66.84.73:8188/system_stats']], ['C:\\Program Files\\Tailscale\\tailscale.exe', ['status']], ['C:\\Program Files\\Tailscale\\tailscale.exe', ['ping', '-c', '3', '100.66.84.73']]] // curl primero: tailscale ping sale con error si no hay conexión directa y corta los pasos
  },
  red_diag2: {
    label: 'Diagnóstico de red 2 (firewall/rutas de esta PC)',
    help: 'Reglas de salida bloqueadas, perfil de red, ruta hacia king',
    steps: [['powershell.exe', ['-NoProfile', '-Command', "Get-NetConnectionProfile | Format-Table -Auto Name,InterfaceAlias,NetworkCategory | Out-String -Width 200; Get-NetFirewallProfile | Format-Table -Auto Name,Enabled,DefaultOutboundAction | Out-String -Width 200; Get-NetFirewallRule -Direction Outbound -Action Block -Enabled True | Select-Object -First 30 DisplayName,Profile | Format-Table -Auto | Out-String -Width 200; Find-NetRoute -RemoteIPAddress 100.66.84.73 | Select-Object -Last 1 InterfaceAlias,NextHop | Format-Table -Auto | Out-String; Get-Service | Where-Object { $_.DisplayName -match 'VPN|Firewall|Portmaster|GlassWire|Proton|Nord|Express|Surfshark|Warp|Cloudflare|Netlimiter|Kaspersky|Norton|McAfee|Avast|AVG|Bitdefender|ESET' -and $_.Status -eq 'Running' } | Format-Table -Auto Name,DisplayName | Out-String -Width 200"]]]
  },
  red_diag3: {
    label: 'Diagnóstico de red 3 (cuándo se conectó cada red)',
    help: 'Historial de conexiones de red de hoy (VPN, Tailscale, Ethernet) y reinicios',
    steps: [['powershell.exe', ['-NoProfile', '-Command', "Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-NetworkProfile/Operational'; StartTime=(Get-Date).Date.AddHours(-6)} -ErrorAction SilentlyContinue | Where-Object { $_.Id -in 10000,10001 } | Select-Object -First 40 TimeCreated,Id,@{n='Red';e={($_.Message -split [Environment]::NewLine | Select-String 'Name:|Nombre:' | Select-Object -First 1).ToString().Trim()}} | Format-Table -Auto | Out-String -Width 200; Get-WinEvent -FilterHashtable @{LogName='System'; Id=6005,6006,1074; StartTime=(Get-Date).Date.AddHours(-6)} -ErrorAction SilentlyContinue | Select-Object -First 15 TimeCreated,Id | Format-Table -Auto | Out-String"]]]
  },
  proton_info: {
    label: 'ProtonVPN: ver modo (solo lectura)',
    help: 'Admin del agente, procesos/servicios de ProtonVPN y su ajuste de kill switch',
    steps: [['powershell.exe', ['-NoProfile', '-Command', "'ADMIN=' + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); Get-Service *proton* | Format-Table -Auto Name,Status,StartType | Out-String; Get-Process | Where-Object { $_.ProcessName -match 'proton' } | Format-Table -Auto ProcessName,Id | Out-String; Get-ChildItem -Path \"$env:LOCALAPPDATA\\Proton\",\"$env:ProgramData\\Proton VPN\" -Recurse -Include *.json,*.config -ErrorAction SilentlyContinue | Select-Object -First 40 | ForEach-Object { $c = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue; if ($c -match 'KillSwitch|SplitTunnel') { $_.FullName; ([regex]::Matches($c,'.{0,40}(KillSwitch|SplitTunnel)[^,}]{0,60}') | Select-Object -First 8 | ForEach-Object { '   ' + $_.Value }) } }"]]]
  },
  ts_puente_test: { label: 'Probar puente a king por Tailscale', help: 'Prueba ComfyUI de king vía tailscale nc (sirve con VPN conectado)', steps: [['node', ['agente/ts_proxy.js', 'test']]] },
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
    special: 'regen_local', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{1,3}(,\d{1,3})*(:\d{1,3}(,\d{1,3})*)?$/i, hidden: true
  },
  // "prueba_ltx_voz:<episode_id>:<tomas>" — LTX genera video CON su propia voz (prueba, no toca el episodio).
  prueba_ltx_voz: { label: 'Prueba LTX con voces propias', help: 'LTX genera las tomas con la voz incluida (gratis en king) para comparar con las voces fijas', special: 'prueba_ltx_voz', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{1,3}(,\d{1,3})*$/i, hidden: true },
  // Graba el video demo para la revisión de TikTok (abre Edge/Chrome visible; tú inicias sesión en TikTok).
  grabar_demo_tiktok: { label: 'Grabar demo para TikTok', help: 'Abre el navegador en esta PC y graba el flujo Conectar TikTok → Post to TikTok (tú solo inicias sesión en TikTok y das Authorize)', special: 'grabar_demo_tiktok' },
  prueba_ltx_final: { label: 'Prueba LTX con cuadro final', help: 'LTX con cuadro inicial + final (gratis en king) para comparar contra solo inicial', special: 'prueba_ltx_final', hidden: true },
  flow_login: { label: 'Flow: iniciar sesión (una vez)', help: 'Abre Flow en el Chrome de VYRALES para que inicies sesión con tu cuenta de Google', special: 'flow_login' },
  // "flow_cuadros:<episode_id>[:<tomas>]" — cuadros con Google Flow en una sesión + videos en king.
  flow_cuadros: { label: 'Flow: cuadros del episodio', help: 'Genera los cuadros iniciales en Google Flow (una sesión) y rehace los videos en king', special: 'flow_cuadros', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:\d{1,3}(,\d{1,3})*)?$/i, hidden: true },
  // "toma_local:<episode_id>:<n>" — una sola toma (cuadro + video) en king; lo pide el panel.
  toma_local: { label: 'Una toma en king', help: 'Genera una sola toma (cuadro + video) en la PC king', special: 'toma_local', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{1,2}$/i, hidden: true },
  diag_python: { label: 'Diagnóstico Python', help: 'Revisa si hay Python en la PC', special: 'diag_python' },
  claude_diag: { label: 'Claude: instalar / revisar', help: 'Revisa si Claude Code está instalado en la PC (si no, lo instala) y prueba tu plan', special: 'claude_diag' },
  claude_login: { label: 'Claude: iniciar sesión', help: 'Abre una ventana de Claude Code en la PC para iniciar sesión una vez con tu plan', special: 'claude_login' },
  // "claude_guion:<job>" — lo pide /analitica.html (botón Crear guion con Claude).
  claude_guion: { label: 'Claude: escribir guion', help: 'Escribe el guion de una idea con Claude en la PC ($0)', special: 'claude_guion', arg: /^[a-z0-9-]{6,60}$/i, hidden: true },
  claude_detalle: { label: 'Claude: detallar toma', help: 'Prompts detallados de una toma con Claude ($0)', special: 'claude_detalle', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{1,3}$/i, hidden: true },
  flow_lugar: { label: 'Flow: imagen de un lugar', help: 'Imagen fija de un lugar con Google Flow ($0)', special: 'flow_lugar', arg: /^[a-z0-9_]{3,60}:[^:\n\r]{1,80}$/, hidden: true },
  flow_cara: { label: 'Flow: fotos de personaje', help: 'Fotos de cara de personajes con Google Flow ($0)', special: 'flow_cara', arg: /^[a-z0-9_]{3,60}(:[0-9a-fA-F-]{8,40})?$/, hidden: true },
  voz_ingles: { label: 'Pista de audio en inglés', help: 'Traduce (Claude), voz en inglés en una toma (~$0.35; $0 si ya existe y el guion no cambió; :nueva fuerza), sincroniza con las tomas y saca el audio para YouTube', special: 'voz_ingles', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:nueva)?$/i, hidden: true },
  preflight: { label: 'Pre-vuelo del episodio', help: 'Antes de producir: el cerebro marca las tomas con riesgo y Claude las corrige con el cambio mínimo ($0)', special: 'preflight', arg: /^[0-9a-f-]{36}$/i, hidden: true },
  cerebro_cargar: { label: 'Cerebro: cargar historial', help: 'Lee todos los veredictos (QA + tus aprobaciones/rechazos individuales) y recalcula los patrones ($0)', special: 'cerebro_cargar', hidden: true },
  cerebro_pensar: { label: 'Cerebro: pensar', help: 'Recalcula los patrones con evidencia + análisis de Claude que solo opina ($0)', special: 'cerebro_pensar', hidden: true },
  claude_aprender: { label: 'Claude aprende', help: 'Convierte las lecciones nuevas (correcciones y arreglos) en reglas de su memoria profesional ($0)', special: 'claude_aprender', hidden: true },
  qa_tomas: { label: 'Control de calidad de tomas', help: 'Revisa cada toma (congelada, imagen que no cuadra, acción que no se ve, humo) y rehace las malas en king ($0)', special: 'qa_tomas', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, hidden: true },
  yt_relacionado: { label: 'YouTube: video relacionado del Short', help: 'Pone el video largo como "video relacionado" del Short en YouTube Studio (Chrome del agente). <short_ep>[:ver]', special: 'yt_relacionado', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:ver)?$/i, hidden: true },
  short_reusar: { label: 'Short con las tomas del largo', help: 'El Short conserva su narración pero usa las tomas ya hechas del video largo (Claude elige y revisa cada una). $0 en video', special: 'short_reusar', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:\d+=\d+(\+\d+)*(,\d+=\d+(\+\d+)*)*)?$/i, hidden: true },
  portada_yt: { label: 'Portada de YouTube', help: 'Claude elige el cuadro más épico, texto llamativo ES/EN, arma la portada y la pone en YouTube ($0). <ep>[:<videoId>]', special: 'portada_yt', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:[A-Za-z0-9_-]{11})?$/, hidden: true },
  subtitulos: { label: 'Subtítulos ES/EN en YouTube', help: 'Arma las pistas CC español e inglés del largo y las sube al video de YouTube ($0). <ep>[:<videoId>]', special: 'subtitulos', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:[A-Za-z0-9_-]{11})?$/, hidden: true },
  voz_instalar: { label: 'Poner una voz ya hecha', help: 'Pone en el episodio una voz ya generada (sin pagar TTS). <ep>:<url>[:guardar]', special: 'voz_instalar', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:https?:\/\/\S+?(:guardar)?$/i, hidden: true },
  prueba_voz_completa: { label: 'Prueba: voz en una sola toma', help: 'Narra todo el episodio en UNA llamada de TTS (sin pedazos) para comparar', special: 'prueba_voz_completa', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, hidden: true },
  voz_continua: { label: 'Voz continua del episodio', help: 'Una sola voz para todo el video, alineada palabra por palabra', special: 'voz_continua', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, hidden: true },
  claude_pulir: { label: 'Claude: pulir narración', help: 'Quita muletillas, saltos bruscos y palabras raras de la narración ($0)', special: 'claude_pulir', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, hidden: true },
  claude_revisar: { label: 'Claude: prompts de tomas', help: 'Prompts completos de tomas nuevas/partidas con Claude ($0)', special: 'claude_revisar', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d{1,3}(,\d{1,3})*$/i, hidden: true },
  claude_ideas: { label: 'Claude: ideas de videos', help: 'Ideas de próximos videos con tus estadísticas, con Claude ($0)', special: 'claude_ideas', arg: /^[a-z0-9-]{6,60}$/i, hidden: true },
  claude_largo: { label: 'Claude: guion largo + Shorts', help: 'Escribe un video largo (8–15 min) y sus Shorts con Claude en la PC ($0)', special: 'claude_largo', arg: /^[a-z0-9-]{6,60}$/i, hidden: true },
  flow_prueba_lote: { label: 'Flow: prueba de lote', help: 'Experimento: varias imágenes sin esperar cada una', special: 'flow_prueba_lote' },
  flow_prueba_ref: { label: 'Flow: prueba con foto de referencia', help: 'Genera 1 imagen en Flow usando una foto de cara como referencia', special: 'flow_prueba_ref' },
  publish_pkg: { label: 'Rehacer paquete de publicación', help: 'Textos + portada del episodio (≈$0.001)', special: 'publish_pkg', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, hidden: true },
  flow_frames: { label: 'Flow: cuadros que faltan (sin video)', help: 'Lo pide el panel: genera con Google Flow los cuadros iniciales que faltan', special: 'flow_frames', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(:\d{1,3}(,\d{1,3})*)?$/i, hidden: true },
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
    label: 'Publicar en calidad completa', help: 'Sube el video de VYRALE/finales (calidad completa) a TikTok, YouTube, Facebook o Instagram',
    special: 'publish_local', arg: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(tiktok|youtube|facebook|instagram)(:private|:public)?$/i, hidden: true
  }
};
