// VIDEO LARGO (8–15 min, 16:9) + SHORTS VERTICALES CON LLAMADA A LA ACCIÓN, escritos por Claude en la PC (plan, $0).
//   node agente/claude_largo.js <job>   → lee media/guiones/<job>.req.json { topic, tipo } y deja media/guiones/<job>.json
// Paso 1: Claude escribe la historia (narración + qué se ve). Paso 2: el revisor (también Claude) escribe los prompts
// súper detallados en inglés para Flow/LTX, capítulo por capítulo (16:9) y Short por Short (9:16).
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
process.env.VYRALES_LOCAL_RUN = '1';
const { runClaude, parseJson, claudeLlm } = require('./_claude');
const F = (f) => require(path.join(ROOT, 'netlify', 'functions', f));

// Convierte tomas {line, visual_es, camera} en tomas del sistema con prompts detallados (Claude, por grupos).
async function detail(shots, { aspect, context, title, log }) {
  const rows = shots.map((s, i) => ({ n: i + 1, chapter: s.chapter, chapter_title: s.chapter_title, camera: s.camera || '', start_en: s.visual_es || '', dialogue: [{ speaker: 'Narrador', line: s.line }], characters: Array.isArray(s.characters) ? s.characters : [], location: s.location || '' })); // Franklin oct-14: antes se perdían personaje y lugar aquí
  const { checkVisuals, applyChanges } = F('_visual_check');
  const out = [];
  for (let i = 0; i < rows.length; i += 16) {
    const part = rows.slice(i, i + 16);
    let done = null;
    for (let k = 1; k <= 2 && !done; k++) {
      try { const vc = await checkVisuals({ series: { title }, shots: part, rewriteStart: 'all', llm: claudeLlm(() => {}), aspect, context, log: () => {} }); done = applyChanges(part, vc.changes); }
      catch (e) { log(`    (grupo ${i / 16 + 1}, intento ${k}: ${String(e.message).slice(0, 140)})`); }
    }
    out.push(...(done || part));
    log(`    prompts detallados: ${Math.min(i + 16, rows.length)}/${rows.length}`);
  }
  // Repaso: tomas que quedaron sin acción/cámara (Claude a veces se salta alguna; oct-11 la importación fallaba
  // por 4 tomas sin action_en). Se vuelven a pedir solas, una vez.
  const miss = out.map((s, i) => i).filter((i) => !(out[i].action_en && String(out[i].action_en).trim()) || !(out[i].camera && String(out[i].camera).trim()));
  // 🐞 BUG oct-14 (El Chapo EP25 salió con la narración REVUELTA): el repaso dejaba que Claude PARTIERA tomas y luego
  // reacomodaba el resultado por POSICIÓN (más tomas que las pedidas → todo se corría), y además los grupos dejan números
  // de toma repetidos (cada grupo renumera desde 1). Ahora: sin partir, con números temporales únicos, y un GUARDIÁN que
  // exige que la narración quede IDÉNTICA palabra por palabra.
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const narr = (list) => norm(list.map((x) => (x.dialogue || []).map((d) => d && d.line).filter(Boolean).join(' ')).join(' '));
  const original = norm(shots.map((s) => s.line).join(' '));
  if (narr(out) !== original) log('    ⚠️ la narración cambió al partir tomas en los grupos (se revisa abajo)');
  const antesRepaso = out.slice();
  if (miss.length) {
    log(`    repaso: ${miss.length} toma(s) sin acción/cámara → las pido otra vez (sin partir)`);
    try {
      const part = miss.map((i, k) => Object.assign({}, out[i], { n: k + 1 })); // n único y temporal
      const vc = await checkVisuals({ series: { title }, shots: part, rewriteStart: 'all', llm: claudeLlm(() => {}), aspect, context, allowSplit: false, log: () => {} });
      const fixed = applyChanges(part, vc.changes, { splits: false });
      if (fixed.length === part.length) fixed.forEach((x, k) => { const keep = out[miss[k]]; out[miss[k]] = Object.assign({}, keep, x, { n: keep.n, dialogue: keep.dialogue }); });
    } catch (e) { log('    repaso falló (' + String(e.message).slice(0, 100) + ') → la importación pone valores por defecto'); }
  }
  if (narr(out) !== narr(antesRepaso)) { log('    🛑 el repaso cambió la narración → lo deshago'); out.splice(0, out.length, ...antesRepaso); }
  if (narr(out) !== original) throw new Error('GUARDIÁN: la narración detallada NO es idéntica a la que escribió Claude (palabras ' + narr(out).split(' ').length + ' vs ' + original.split(' ').length + '). No guardo un guion revuelto.');
  log('    ✅ guardián: narración idéntica palabra por palabra (' + original.split(' ').length + ' palabras)');
  return out.map((s, i) => Object.assign({}, s, { n: i + 1, characters: Array.isArray(s.characters) ? s.characters : [], location: s.location || 'escena' }));
}

(async () => {
  const job = String(process.argv[2] || '').replace(/[^a-z0-9-]/gi, '');
  const supabase = F('_supabase').getSupabaseClient();
  const { uploadFile } = F('_storage');
  const save = (obj) => uploadFile(supabase, { path: `guiones/${job}.json`, buffer: Buffer.from(JSON.stringify(obj)), contentType: 'application/json' });
  try {
    const { data: u } = supabase.storage.from('media').getPublicUrl(`guiones/${job}.req.json`);
    const req = await (await fetch(u.publicUrl + '?t=' + Date.now())).json();
    const tipo = req.tipo || 'historia';
    const canal = await F('_memoria').memoryBlock(supabase).catch(() => '');
    console.log('Guionista largo (Claude) →', String(req.topic).slice(0, 120), canal ? '· con identidad/memoria del canal (' + (process.env.VYRALES_WS || 'principal') + ')' : '');
    const t0 = Date.now();
    let story = null;
    for (let k = 1; k <= 2 && !story; k++) {
      let raw = '';
      try { raw = (req.raw_file && fs.existsSync(path.join(ROOT, req.raw_file))) ? (console.log('  reuso la historia ya escrita: ' + req.raw_file), fs.readFileSync(path.join(ROOT, req.raw_file), 'utf8')) : await runClaude(F('_guionista').buildLongPrompt(tipo, { topic: req.topic, canal }), { timeoutMin: 25, log: console.log }); fs.mkdirSync(path.join(ROOT, '_to_delete'), { recursive: true }); fs.writeFileSync(path.join(ROOT, '_to_delete', `claude_raw_${k}.txt`), raw); story = parseJson(raw); }
      catch (e) { console.log(`  intento ${k}: ${String(e.message).slice(0, 200)}`); if (k === 2) throw e; }
    }
    // Pulido de la narración (largo y cada Short): sin "Y" muletilla, sin saltos, sin palabras raras. Claude, $0.
    try {
      const { polishLines } = F('_pulir');
      const all = (story.chapters || []).flatMap((c) => c.shots || []);
      const nl = await polishLines(all.map((x) => x.line), claudeLlm(() => {}), { kind: 'largo', title: story.title });
      all.forEach((x, i) => { x.line = nl[i]; });
      for (const sh of story.shorts || []) { const n2 = await polishLines((sh.shots || []).map((x) => x.line), claudeLlm(() => {}), { kind: 'short_cta', title: sh.title }); sh.shots.forEach((x, i) => { x.line = n2[i]; }); }
      console.log('Narración pulida (largo + Shorts).');
    } catch (e) { console.log('  (pulido: ' + String(e.message).slice(0, 160) + ')'); }
    const longShots = (story.chapters || []).flatMap((c, ci) => (c.shots || []).map((s) => Object.assign({}, s, { chapter: ci + 1, chapter_title: c.title })));
    const words = longShots.map((s) => s.line).join(' ').split(/\s+/).filter(Boolean).length;
    console.log(`Historia escrita en ${Math.round((Date.now() - t0) / 1000)} s: "${story.title}" · ${(story.chapters || []).length} capítulos · ${longShots.length} tomas · ${words} palabras (~${(words / 2.3 / 60).toFixed(1)} min) · ${(story.shorts || []).length} Shorts`);
    await save({ ok: false, partial: true, stage: 'prompts', story, at: new Date().toISOString() });
    const context = story.title + '. ' + (story.chapters || []).map((c) => c.title).join(' → ');
    console.log('Prompts detallados del video largo (16:9)...');
    const detailed = await detail(longShots, { aspect: '16:9', context, title: story.title, log: console.log });
    // Los Shorts del largo usan las TOMAS DEL LARGO (short_reusar.js, Franklin oct-11): no se escriben prompts de
    // imagen/video para ellos (ahorra ~5–10 min por guion). Solo su narración.
    const shorts = (story.shorts || []).map((sh) => Object.assign({}, sh, { reuse_long: true, shots: (sh.shots || []).map((x, i) => ({ n: i + 1, camera: x.camera || '', start_en: x.visual_es || '', scene_es: x.visual_es || x.line, dialogue: [{ speaker: 'Narrador', line: x.line }], characters: Array.isArray(x.characters) ? x.characters : [], location: x.location || 'escena' })) }));
    if (shorts.length) console.log(`${shorts.length} Shorts: usarán las tomas del largo (sin prompts propios).`);
    const result = { ok: true, kind: 'largo', tipo, model: 'Claude (tu plan)', costUsd: 0, words, minutes: +(words / 2.3 / 60).toFixed(1),
      long: { title: story.title, hook_text: story.hook_text, description: story.description, sources: story.sources || [], characters: story.characters || [], locations: story.locations || {}, chapters: (story.chapters || []).map((c) => c.title), shots: detailed },
      shorts, at: new Date().toISOString() };
    await save(result);
    console.log(`LISTO en ${Math.round((Date.now() - t0) / 60000)} min → media/guiones/${job}.json`);
  } catch (e) {
    console.log('ERROR:', e.message);
    await save({ ok: false, error: e.message, at: new Date().toISOString() }).catch(() => {});
    process.exit(1);
  }
})();
