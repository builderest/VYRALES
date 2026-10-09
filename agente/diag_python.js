// Diagnóstico: ¿hay Python en esta PC? (para la alineación de voz con Whisper)
const { execFileSync } = require('child_process');
for (const [cmd, args] of [['py', ['-0p']], ['python', ['--version']], ['python3', ['--version']], ['where', ['python']], ['nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv']]]) {
  try { console.log('$', cmd, args.join(' '), '\n' + execFileSync(cmd, args, { encoding: 'utf8', timeout: 20000, shell: true }).trim()); }
  catch (e) { console.log('$', cmd, args.join(' '), '→ NO:', String(e.message).split('\n')[0]); }
}
