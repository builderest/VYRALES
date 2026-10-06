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
  dev_log: { label: 'Ver log del servidor local', help: 'Últimas 120 líneas de netlify dev', special: 'dev_log' }
};
