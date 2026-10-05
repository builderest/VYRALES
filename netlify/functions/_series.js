// Lógica compartida para las novelas escritas COMPLETAS de una vez (arco entero).
//
// Una novela es un JSON (formato v2, ver series/dulce_engano.json o el "prompt maestro" del
// dashboard). Este módulo:
//   1. validateSeries()   — revisa el JSON antes de tocar la base. Con UN solo error no se
//                           importa nada. Los "warnings" son riesgos visuales (espejos, texto
//                           legible, multitudes…) que no bloquean pero conviene corregir.
//   2. toEpisodeRows()    — convierte cada episodio al formato de la tabla `episodes`.
//   3. buildShotPrompt()  — arma el prompt de Veo de UNA toma siguiendo la guía oficial de
//                           Google para Veo 3.1:
//                             Cámara → Sujeto → Acción (con marcas de tiempo) → Contexto →
//                             Estilo → Audio (quién habla, ambiente, SFX) → exclusiones
//                           redactadas en positivo.
//                           Fuente: cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1
//   4. buildImagePrompt() — prompt de la foto de referencia de cada personaje (Gemini).
//
// Reglas de guion que hace cumplir el validador (para que ninguna toma salga dañada):
//   - máx. 2 personajes con nombre en cuadro por toma;
//   - máx. 1 personaje habla por toma, con ≤ N palabras (cabe en 6 s);
//   - cada toma tiene cámara, acción (0–6 s) y reacción final quieta (6–8 s) → corte limpio;
//   - cada personaje tiene voz descrita siempre igual.

const VALID_MODELS = ['veo_lite', 'veo_fast', 'veo_standard'];

// Palabras que suelen producir artefactos en video generado. No bloquean: avisan.
const RISK_PATTERNS = [
  [/\bmirror(s|ed)?\b|\breflection(s)?\b|\breflective\b/i, 'espejos/reflejos (Veo suele duplicar o deformar personas)'],
  [/\breadable\b|\blegible\b|\btext on\b|\bwritten\b|\bsignage\b|\bsubtitle/i, 'texto legible en pantalla (sale deformado)'],
  [/\bcrowd(s|ed)?\b|\bdozens of\b|\bhundreds of\b/i, 'multitudes (caras deformes al fondo)'],
  [/\bfight(s|ing)?\b|\bpunch(es|ing)?\b|\bkick(s|ing)?\b|\bwrestl/i, 'peleas/golpes (movimientos rotos)'],
  [/\b(runs|running|run) (toward|towards|away|across|through|after|into|down the|up the)\b|\bsprint|\bchase\b/i, 'carreras/persecuciones (movimiento rápido)'],
  [/\btyping\b|\bfingers\b|\bpiano\b/i, 'dedos/manos en primer plano (manos deformes)']
];

function countWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function locationOf(sb, key) {
  const loc = sb.locations && sb.locations[key];
  if (!loc) return null;
  return typeof loc === 'string' ? { visual: loc, ambient: '' } : loc;
}

function extraOf(sb, key) {
  const ex = sb.extras && sb.extras[key];
  if (!ex) return null;
  return typeof ex === 'string' ? { who: ex, voice: '' } : ex;
}

// El JSON trae `dialogue` como objeto {speaker, line} o null (1 hablante por toma). Las
// novelas viejas lo traían como array. Esto lo normaliza siempre a array de 0–1 elementos.
function dialogueList(d) {
  if (!d) return [];
  return Array.isArray(d) ? d : [d];
}

function validateSeries(data) {
  const errors = [];
  const warnings = [];
  const req = (cond, msg) => {
    if (!cond) errors.push(msg);
  };

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['El JSON de la serie está vacío o no es un objeto.'], warnings };
  }

  req(/^[a-z0-9_]{3,60}$/.test(data.slug || ''), 'slug inválido: solo minúsculas, números y _ (3 a 60 caracteres).');
  req(data.title, 'Falta title.');
  req(data.synopsis, 'Falta synopsis.');

  const sb = data.story_bible || {};
  req(sb.visual_style, 'Falta story_bible.visual_style.');
  req(sb.tone, 'Falta story_bible.tone.');
  req(sb.locations && Object.keys(sb.locations).length > 0, 'Falta story_bible.locations.');
  const rules = sb.rules || {};
  const shotsPerEpisode = rules.shots_per_episode || 8;
  const maxWords = rules.max_words_per_episode || 400;
  const maxDialogueWords = rules.max_dialogue_words_per_shot || 15;
  const maxCast = rules.max_characters_per_shot || 2;
  ['shot_model', 'cliffhanger_model'].forEach((k) => {
    if (rules[k] !== undefined) req(VALID_MODELS.includes(rules[k]), `story_bible.rules.${k} inválido: "${rules[k]}" (usa ${VALID_MODELS.join(', ')}).`);
  });
  if (rules.shot_seconds !== undefined) req([4, 6, 8].includes(rules.shot_seconds), 'story_bible.rules.shot_seconds debe ser 4, 6 u 8.');

  Object.keys(sb.locations || {}).forEach((k) => {
    const loc = locationOf(sb, k);
    req(loc && loc.visual, `Location "${k}": falta la descripción visual.`);
  });
  Object.keys(sb.extras || {}).forEach((k) => {
    const ex = extraOf(sb, k);
    req(ex && ex.who, `Extra "${k}": falta "who" (descripción en inglés).`);
  });

  const characters = data.characters || [];
  req(characters.length > 0, 'La serie no tiene personajes.');
  const byKey = {};
  characters.forEach((c, i) => {
    const label = c.key || `personaje #${i + 1}`;
    req(c.key && c.name, `${label}: falta key o name.`);
    req(c.role, `${label}: falta role (protagonista, antagonista o secundario).`);
    req(c.fixed_prompt_tag, `${label}: falta fixed_prompt_tag.`);
    req(c.profile && c.profile.default_outfit, `${label}: falta profile.default_outfit.`);
    req(c.profile && c.profile.voice, `${label}: falta profile.voice (voz en inglés, siempre igual).`);
    if (c.fixed_prompt_tag && c.key && !c.fixed_prompt_tag.startsWith(c.key)) {
      errors.push(`${label}: el fixed_prompt_tag debe empezar con "${c.key}," (así Veo sabe quién habla).`);
    }
    if (c.fixed_prompt_tag && /"/.test(c.fixed_prompt_tag)) errors.push(`${label}: el fixed_prompt_tag tiene comillas dobles.`);
    if (byKey[c.key]) errors.push(`Personaje duplicado: ${c.key}.`);
    byKey[c.key] = c;
  });

  const episodes = data.episodes || [];
  req(episodes.length > 0, 'La serie no tiene episodios.');

  episodes.forEach((ep, idx) => {
    const tag = `Ep${ep.episode_number}`;
    req(ep.episode_number === idx + 1, `${tag}: numeración no consecutiva (se esperaba ${idx + 1}).`);
    req(ep.title, `${tag}: falta title.`);
    req(ep.continuity && ep.continuity.summary, `${tag}: falta continuity.summary.`);
    req(ep.continuity && ep.continuity.last_cliffhanger, `${tag}: falta continuity.last_cliffhanger (el gancho es obligatorio).`);
    Object.keys(ep.wardrobe || {}).forEach((k) => req(byKey[k], `${tag}: vestuario para personaje desconocido "${k}".`));

    const shots = ep.shots || [];
    req(shots.length === shotsPerEpisode, `${tag}: tiene ${shots.length} tomas, se esperaban ${shotsPerEpisode}.`);

    let words = 0;
    let withDialogue = 0;
    shots.forEach((s, j) => {
      const st = `${tag} T${j + 1}`;
      req(s.n === j + 1, `${st}: n=${s.n}, se esperaba ${j + 1}.`);
      req(locationOf(sb, s.location), `${st}: location desconocida "${s.location}".`);
      const cast = Array.isArray(s.characters) ? s.characters : [];
      req(cast.length > 0, `${st}: no tiene personajes.`);
      req(cast.length <= maxCast, `${st}: ${cast.length} personajes con nombre en cuadro (máx. ${maxCast}; Veo mezcla caras).`);
      cast.forEach((k) => req(byKey[k], `${st}: personaje desconocido "${k}".`));
      req(s.scene_es && s.scene_es.trim(), `${st}: falta scene_es.`);
      req(s.camera && s.camera.trim(), `${st}: falta camera (encuadre y movimiento).`);
      req(s.action_en && s.action_en.trim(), `${st}: falta action_en (lo que pasa de 0 a 6 s).`);
      req(s.reaction_en && s.reaction_en.trim(), `${st}: falta reaction_en (reacción quieta de 6 a 8 s, para que el corte sea limpio).`);

      ['camera', 'action_en', 'reaction_en', 'sfx'].forEach((f) => {
        if (s[f] && /"/.test(s[f])) errors.push(`${st}: ${f} tiene comillas dobles (rompen el prompt).`);
      });
      const englishText = [s.camera, s.action_en, s.reaction_en, s.sfx].filter(Boolean).join(' ');
      RISK_PATTERNS.forEach(([re, why]) => {
        if (re.test(englishText)) warnings.push(`${st}: riesgo visual — ${why}.`);
      });

      Object.keys(s.wardrobe || {}).forEach((k) => {
        req(byKey[k], `${st}: vestuario para personaje desconocido "${k}".`);
        if (byKey[k] && !cast.includes(k)) warnings.push(`${st}: vestuario de ${k}, pero ${k} no está en la toma.`);
      });

      const lines = dialogueList(s.dialogue);
      req(lines.length <= 1, `${st}: ${lines.length} hablantes (máx. 1 por toma, para que la voz no se mezcle).`);
      lines.forEach((d) => {
        req(d.speaker && d.line, `${st}: diálogo sin speaker o line.`);
        const isExtra = !!extraOf(sb, d.speaker);
        req(byKey[d.speaker] || isExtra, `${st}: hablante desconocido "${d.speaker}".`);
        if (byKey[d.speaker] && !cast.includes(d.speaker)) errors.push(`${st}: ${d.speaker} habla pero no está en characters.`);
        if (d.line && /"/.test(d.line)) errors.push(`${st}: el diálogo tiene comillas dobles (rompen el prompt).`);
        const w = countWords(d.line);
        if (w > maxDialogueWords) errors.push(`${st}: ${w} palabras de diálogo (máx. ${maxDialogueWords} para decirlo en 6 s).`);
      });
      if (lines.length) withDialogue++;

      words += countWords(s.scene_es);
    });

    if (words > maxWords) errors.push(`${tag}: ${words} palabras de guion (máx. ${maxWords}).`);
    if (shots.length && withDialogue < Math.ceil(shots.length * 0.6)) {
      warnings.push(`${tag}: solo ${withDialogue}/${shots.length} tomas con diálogo (se busca contenido conversado).`);
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

// Personajes "de la base" a partir del JSON (para armar vistas previas de prompt al importar).
function characterRowsFromData(data) {
  return (data.characters || []).map((c) => ({
    name: c.name,
    fixed_prompt_tag: c.fixed_prompt_tag,
    profile: Object.assign({ key: c.key }, c.profile || {})
  }));
}

// Convierte el episodio del JSON al formato de la tabla `episodes`. Los personajes de cada
// toma se guardan con su NOMBRE COMPLETO (igual que en `characters`) y el vestuario ya
// resuelto (default del personaje < vestuario del episodio < vestuario de la toma).
// Cada toma guarda además `prompt_preview`: el prompt exacto que recibirá Veo.
function toEpisodeRows(data) {
  const byKey = {};
  (data.characters || []).forEach((c) => (byKey[c.key] = c));
  const rowsForPreview = characterRowsFromData(data);

  return (data.episodes || []).map((ep) => {
    const shots = (ep.shots || []).map((s) => {
      const wardrobe = {};
      s.characters.forEach((k) => {
        const c = byKey[k];
        wardrobe[c.name] =
          (s.wardrobe && s.wardrobe[k]) || (ep.wardrobe && ep.wardrobe[k]) || c.profile.default_outfit;
      });
      const shot = {
        n: s.n,
        location: s.location,
        characters: s.characters.map((k) => byKey[k].name),
        wardrobe,
        camera: s.camera || '',
        action_en: s.action_en || s.visual_en || '',
        reaction_en: s.reaction_en || '',
        sfx: s.sfx || '',
        scene_es: s.scene_es,
        dialogue: dialogueList(s.dialogue)
      };
      shot.prompt_preview = buildShotPrompt(shot, rowsForPreview, data.story_bible);
      return shot;
    });

    const script = shots.map((s) => `${s.n}. ${s.scene_es}`).join('\n\n');

    return {
      episode_number: ep.episode_number,
      title: ep.title,
      script,
      shots,
      continuity: ep.continuity,
      words: countWords(shots.map((s) => s.scene_es).join(' '))
    };
  });
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// shot: un elemento de episodes.shots (ya convertido por toEpisodeRows).
// characterRows: filas de `characters` de la serie (name, fixed_prompt_tag, profile).
// storyBible: series.story_bible.
function buildShotPrompt(shot, characterRows, storyBible) {
  const sb = storyBible || {};
  const rules = sb.rules || {};
  const secs = rules.shot_seconds || 8;
  const speakEnd = Math.max(2, secs - 2);
  const ts = (a, b) => `[00:${String(a).padStart(2, '0')}-00:${String(b).padStart(2, '0')}]`;
  const parts = [];

  // Toma vieja (formato v1, sin cámara/reacción): se mantiene el armado anterior.
  const isV2 = !!(shot.camera || shot.reaction_en);

  const rowFor = (name) => {
    const row = (characterRows || []).find((r) => r.name === name);
    if (!row || !row.fixed_prompt_tag) {
      // Mejor fallar antes de llamar a Veo que gastar en una toma con un personaje sin
      // descripción (saldría con otra cara).
      throw new Error(`El personaje "${name}" de la toma ${shot.n} no existe en la tabla characters o no tiene fixed_prompt_tag.`);
    }
    return row;
  };

  // 1) Cámara
  if (isV2 && shot.camera) parts.push(shot.camera.trim().replace(/\.?$/, '.'));

  // 2) Sujeto(s): identidad fija + vestuario de este episodio
  const cast = (shot.characters || []).map((name) => {
    const row = rowFor(name);
    const outfit = (shot.wardrobe && shot.wardrobe[name]) || (row.profile && row.profile.default_outfit);
    return outfit ? `${row.fixed_prompt_tag}, wearing ${outfit}` : row.fixed_prompt_tag;
  });
  if (cast.length) parts.push(isV2 ? cast.map((c) => c.replace(/\.?$/, '.')).join(' ') : `Characters: ${cast.join('; ')}.`);

  // 3) Acción con marcas de tiempo: diálogo en 0–6 s, reacción quieta en 6–8 s (corte limpio)
  const extras = sb.extras || {};
  const lines = dialogueList(shot.dialogue);
  const speakerPhrase = (d) => {
    const ex = extraOf(sb, d.speaker);
    if (ex) return `${capitalize(ex.who)} says${ex.voice ? ` in ${ex.voice}` : ''}:`;
    const row = (characterRows || []).find((r) => (r.profile && r.profile.key) === d.speaker || r.name === d.speaker || r.name.split(' ')[0] === d.speaker);
    const voice = row && row.profile && row.profile.voice;
    return `${d.speaker} says${voice ? ` in ${voice}` : ''}:`;
  };

  if (isV2) {
    const action = shot.action_en.trim().replace(/\.?$/, '.');
    const speech = lines.map((d) => ` ${speakerPhrase(d)} "${d.line}"`).join('');
    parts.push(`${ts(0, speakEnd)} ${action}${speech}`);
    parts.push(`${ts(speakEnd, secs)} ${shot.reaction_en.trim().replace(/\.?$/, '.')}`);
  } else {
    parts.push((shot.action_en || shot.visual_en || '').trim());
    lines.forEach((d) => parts.push(`${d.speaker} says in Mexican Spanish: "${d.line}"`));
  }

  // 4) Contexto (set fijo)
  const loc = locationOf(sb, shot.location);
  if (loc) parts.push(`Setting: ${loc.visual.replace(/\.?$/, '.')}`);

  // 5) Estilo
  if (sb.visual_style) parts.push(sb.visual_style.trim().replace(/\.?$/, '.'));

  // 6) Audio
  if (isV2) {
    if (lines.length) {
      const who = extraOf(sb, lines[0].speaker) ? extraOf(sb, lines[0].speaker).who : lines[0].speaker;
      parts.push(`Audio: only ${who} speaks, in Spanish, clearly and at a natural pace, finishing the line by second ${speakEnd}.`);
    } else {
      parts.push('Audio: nobody speaks in this shot.');
    }
    const ambient = (loc && loc.ambient) || '';
    if (ambient) parts.push(`Ambient noise: ${ambient.replace(/\.?$/, '.')}`);
    if (shot.sfx) parts.push(`SFX: ${shot.sfx.replace(/\.?$/, '.')}`);
  } else if (!lines.length) {
    parts.push('No dialogue, only ambient sound and soft emotional music.');
  }

  // 7) Exclusiones (redactadas en positivo, como pide la guía de Veo)
  if (sb.negative) parts.push(sb.negative.trim().replace(/\.?$/, '.'));

  return parts.join(' ');
}

// Prompt para generar la FOTO DE REFERENCIA de un personaje en Gemini (copiar y pegar desde
// el dashboard). Solo cara y peinado normal, con ropa neutra lisa: la ropa de cada episodio
// la pone el texto de la toma. El estilo va al inicio y al final, y se aclara que NO es
// fotorrealista: en la primera prueba (2026-10-05) Gemini devolvió 4 de 5 retratos realistas.
function buildImagePrompt(character, storyBible) {
  const sb = storyBible || {};
  const fullStyle = (sb.visual_style || 'Cinematic style').trim().replace(/\.$/, '');
  const style = fullStyle.split(',')[0].trim();
  const tag = String(character.fixed_prompt_tag || '').trim().replace(/\.$/, '');
  const stylized = /anim|3d|cartoon|anime|illustrat|comic|painted|claymation/i.test(fullStyle);
  const common =
    'close-up head and shoulders, facing the camera, neutral relaxed expression, ' +
    'wearing a plain simple light-gray crew-neck top, soft even studio lighting, ' +
    'plain light-gray background, vertical 9:16. ';
  if (stylized) {
    return (
      `${style} character face reference: a stylized ${style.toLowerCase().includes('anime') ? 'anime' : 'animated'} character, NOT photorealistic, NOT a photo of a real person. ` +
      `${tag}. ` +
      'Smooth stylized skin, expressive animated eyes, ' +
      common +
      `Same art style as: ${fullStyle}. Not live action. ` +
      'No text, no logos, no jewelry.'
    );
  }
  return (
    `${style} character face reference portrait. ${tag}. ` +
    common +
    `Visual style: ${fullStyle}. ` +
    'No text, no logos, no jewelry.'
  );
}

module.exports = {
  validateSeries,
  toEpisodeRows,
  buildShotPrompt,
  buildImagePrompt,
  characterRowsFromData,
  countWords,
  VALID_MODELS
};
