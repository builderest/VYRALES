// Lógica compartida para las novelas escritas COMPLETAS de una vez (arco entero).
//
// Una novela vive como JSON en /series/<slug>.json (ver series/dulce_engano.json). Este
// módulo hace tres cosas:
//   1. validateSeries()   — revisa el JSON antes de tocar la base: si hay un solo error, no
//                           se importa nada (no queremos gastar Veo en un guion roto).
//   2. toEpisodeRows()    — convierte cada episodio al formato de la tabla `episodes`
//                           (script legible + `shots` estructurado por toma).
//   3. buildShotPrompt()  — arma el prompt final que se le manda a Veo para UNA toma:
//                           estilo visual de la serie + set fijo + tag fijo de cada
//                           personaje + vestuario del episodio + acción en inglés +
//                           diálogo en español. Así ya no depende de detectar nombres en
//                           el texto ni de mandarle narración en español a Veo.

function countWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function validateSeries(data) {
  const errors = [];
  const warnings = [];
  const req = (cond, msg) => {
    if (!cond) errors.push(msg);
  };

  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['El JSON de la serie está vacío o no es un objeto.'], warnings };
  }

  req(/^[a-z0-9_]+$/.test(data.slug || ''), 'slug inválido (solo minúsculas, números y _).');
  req(data.title, 'Falta title.');

  const sb = data.story_bible || {};
  req(sb.visual_style, 'Falta story_bible.visual_style.');
  const locations = sb.locations || {};
  const extras = sb.extras || {};
  const rules = sb.rules || {};
  const shotsPerEpisode = rules.shots_per_episode || 8;
  const maxWords = rules.max_words_per_episode || 400;
  const maxDialogueWords = rules.max_dialogue_words_per_shot || 16;

  const characters = data.characters || [];
  req(characters.length > 0, 'La serie no tiene personajes.');
  const byKey = {};
  characters.forEach((c, i) => {
    const label = c.key || `personaje #${i + 1}`;
    req(c.key && c.name, `${label}: falta key o name.`);
    req(c.fixed_prompt_tag, `${label}: falta fixed_prompt_tag.`);
    req(c.profile && c.profile.default_outfit, `${label}: falta profile.default_outfit.`);
    if (c.fixed_prompt_tag && c.key && !c.fixed_prompt_tag.startsWith(c.key)) {
      warnings.push(`${label}: el fixed_prompt_tag no empieza con el nombre "${c.key}" (Veo no sabrá a quién se refiere el diálogo).`);
    }
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
    shots.forEach((s, j) => {
      const st = `${tag} T${j + 1}`;
      req(s.n === j + 1, `${st}: n=${s.n}, se esperaba ${j + 1}.`);
      req(locations[s.location], `${st}: location desconocida "${s.location}".`);
      req(Array.isArray(s.characters) && s.characters.length > 0, `${st}: no tiene personajes.`);
      const cast = Array.isArray(s.characters) ? s.characters : [];
      cast.forEach((k) => req(byKey[k], `${st}: personaje desconocido "${k}".`));
      if (cast.length > 3) warnings.push(`${st}: ${cast.length} personajes en 8 segundos — Veo puede mezclar caras.`);
      req(s.scene_es && s.scene_es.trim(), `${st}: falta scene_es.`);
      req(s.visual_en && s.visual_en.trim(), `${st}: falta visual_en.`);
      if (s.visual_en && /"/.test(s.visual_en)) errors.push(`${st}: visual_en tiene comillas dobles (rompen el prompt).`);

      Object.keys(s.wardrobe || {}).forEach((k) => {
        req(byKey[k], `${st}: vestuario para personaje desconocido "${k}".`);
        if (byKey[k] && !cast.includes(k)) warnings.push(`${st}: vestuario de ${k}, pero ${k} no está en la toma.`);
      });

      let dialogueWords = 0;
      (s.dialogue || []).forEach((d) => {
        req(d.speaker && d.line, `${st}: diálogo sin speaker o line.`);
        req(byKey[d.speaker] || extras[d.speaker], `${st}: hablante desconocido "${d.speaker}".`);
        if (byKey[d.speaker] && !cast.includes(d.speaker)) {
          errors.push(`${st}: ${d.speaker} habla pero no está en characters.`);
        }
        if (d.line && /"/.test(d.line)) errors.push(`${st}: el diálogo tiene comillas dobles (rompen el prompt).`);
        dialogueWords += countWords(d.line);
      });
      if (dialogueWords > maxDialogueWords) {
        errors.push(`${st}: ${dialogueWords} palabras de diálogo (máx. ${maxDialogueWords} para que quepan en 8s).`);
      }

      words += countWords(s.scene_es);
    });

    if (words > maxWords) errors.push(`${tag}: ${words} palabras de guion (máx. ${maxWords}).`);
  });

  return { ok: errors.length === 0, errors, warnings };
}

// Convierte el episodio del JSON al formato de la tabla `episodes`. Los personajes de cada
// toma se guardan con su NOMBRE COMPLETO (igual que en la tabla `characters`) y el
// vestuario ya resuelto (default del personaje < vestuario del episodio < vestuario de la
// toma), así el generador no tiene que adivinar nada.
function toEpisodeRows(data) {
  const byKey = {};
  (data.characters || []).forEach((c) => (byKey[c.key] = c));

  return (data.episodes || []).map((ep) => {
    const shots = (ep.shots || []).map((s) => {
      const wardrobe = {};
      s.characters.forEach((k) => {
        const c = byKey[k];
        wardrobe[c.name] =
          (s.wardrobe && s.wardrobe[k]) || (ep.wardrobe && ep.wardrobe[k]) || c.profile.default_outfit;
      });
      return {
        n: s.n,
        location: s.location,
        characters: s.characters.map((k) => byKey[k].name),
        wardrobe,
        scene_es: s.scene_es,
        visual_en: s.visual_en,
        dialogue: s.dialogue || []
      };
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
// characterRows: filas de la tabla `characters` de la serie (name, fixed_prompt_tag, profile).
// storyBible: series.story_bible.
function buildShotPrompt(shot, characterRows, storyBible) {
  const sb = storyBible || {};
  const parts = [];

  if (sb.visual_style) parts.push(sb.visual_style.trim().replace(/\.?$/, '.'));

  const setting = sb.locations && sb.locations[shot.location];
  if (setting) parts.push(`Setting: ${setting}.`);

  const cast = (shot.characters || []).map((name) => {
    const row = (characterRows || []).find((r) => r.name === name);
    if (!row || !row.fixed_prompt_tag) {
      // Mejor fallar antes de llamar a Veo que gastar dinero en una toma con un personaje
      // sin descripción (saldría con otra cara).
      throw new Error(`El personaje "${name}" de la toma ${shot.n} no existe en la tabla characters o no tiene fixed_prompt_tag.`);
    }
    const outfit = (shot.wardrobe && shot.wardrobe[name]) || (row.profile && row.profile.default_outfit);
    return outfit ? `${row.fixed_prompt_tag}, wearing ${outfit}` : row.fixed_prompt_tag;
  });
  if (cast.length) parts.push(`Characters: ${cast.join('; ')}.`);

  parts.push(shot.visual_en.trim());

  const extras = sb.extras || {};
  const dialogue = shot.dialogue || [];
  if (dialogue.length) {
    dialogue.forEach((d) => {
      const who = extras[d.speaker] ? capitalize(extras[d.speaker]) : d.speaker;
      parts.push(`${who} says in Mexican Spanish: "${d.line}"`);
    });
  } else {
    parts.push('No dialogue, only ambient sound and soft emotional music.');
  }

  if (sb.negative) parts.push(sb.negative.trim());

  return parts.join(' ');
}

module.exports = { validateSeries, toEpisodeRows, buildShotPrompt, countWords };
