// Importa una novela COMPLETA (serie + personajes + todos los episodios ya escritos) desde
// /series/<slug>.json a Supabase. Se dispara desde el dashboard (botón "Importar novela").
//
//   GET  /.netlify/functions/import-series              → lista las novelas disponibles en
//                                                          el repo, si pasan la validación y
//                                                          si ya están en la base.
//   POST /.netlify/functions/import-series  { slug }    → valida e importa.
//   POST ... { slug, dry_run: true }                    → solo valida, no escribe nada.
//
// Reglas de seguridad:
//   - Si la validación tiene UN solo error, no se escribe nada (422 con la lista).
//   - Es idempotente: se puede correr varias veces. Serie y personajes se actualizan por
//     slug / (serie, nombre).
//   - Un episodio que ya pasó a producción (generando_media, en_revision, publicado,
//     archivado) NUNCA se sobreescribe — sus tomas ya costaron dinero y su prompt quedó
//     guardado. Solo se actualizan episodios en guion_pendiente / guion_generado /
//     guion_rechazado.
//   - No llama a Veo ni a ninguna API de pago.
const { getSupabaseClient } = require('./_supabase');
const { validateSeries, toEpisodeRows, buildImagePrompt } = require('./_series');

// esbuild necesita require() estáticos para empaquetar los JSON: para agregar una novela
// nueva, crea series/<slug>.json y agrégala aquí.
const BUNDLED = {
  dulce_engano: require('../../series/dulce_engano.json')
};

const EDITABLE_STATUSES = new Set(['guion_pendiente', 'guion_generado', 'guion_rechazado']);

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  try {
    const supabase = getSupabaseClient();

    if (event.httpMethod === 'GET') {
      const slugs = Object.keys(BUNDLED);
      const { data: existing } = await supabase.from('series').select('id, slug').in('slug', slugs);
      const list = slugs.map((slug) => {
        const data = BUNDLED[slug];
        const v = validateSeries(data);
        return {
          slug,
          title: data.title,
          episodes: (data.episodes || []).length,
          characters: (data.characters || []).length,
          valid: v.ok,
          errors: v.errors,
          warnings: v.warnings,
          imported: !!(existing || []).find((s) => s.slug === slug)
        };
      });
      return json(200, { series: list });
    }

    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch (_) {
      return json(400, { error: 'Body JSON inválido.' });
    }

    const data = BUNDLED[body.slug];
    if (!data) return json(404, { error: `No existe series/${body.slug}.json en el proyecto.` });

    const validation = validateSeries(data);
    if (!validation.ok) {
      return json(422, { error: 'La novela no pasó la validación. No se importó nada.', ...validation });
    }

    const rows = toEpisodeRows(data);
    if (body.dry_run) {
      return json(200, { dry_run: true, ...validation, episodes: rows.map((r) => ({ n: r.episode_number, title: r.title, words: r.words })) });
    }

    // 1) Serie
    const { data: series, error: seriesError } = await supabase
      .from('series')
      .upsert(
        {
          slug: data.slug,
          title: data.title,
          genre: data.genre || null,
          language: data.language || 'es',
          synopsis: data.synopsis || null,
          story_bible: data.story_bible,
          is_active: true,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'slug' }
      )
      .select('id, slug, title')
      .single();
    if (seriesError) throw seriesError;

    // 2) Personajes
    const characterPayload = data.characters.map((c) => ({
      series_id: series.id,
      name: c.name,
      role: c.role || null,
      description: c.description || null,
      fixed_prompt_tag: c.fixed_prompt_tag,
      profile: Object.assign({ key: c.key }, c.profile || {}, {
        image_prompt: (c.profile && c.profile.image_prompt) || buildImagePrompt(c, data.story_bible)
      }),
      sort_order: c.sort_order || 0
    }));
    const { error: charsError } = await supabase
      .from('characters')
      .upsert(characterPayload, { onConflict: 'series_id,name' });
    if (charsError) throw charsError;

    // 3) Episodios
    const { data: existingEpisodes, error: exError } = await supabase
      .from('episodes')
      .select('id, episode_number, status')
      .eq('series_id', series.id);
    if (exError) throw exError;

    const result = { inserted: [], updated: [], protected: [] };
    for (const r of rows) {
      const payload = {
        series_id: series.id,
        episode_number: r.episode_number,
        title: r.title,
        script: r.script,
        shots: r.shots,
        continuity: r.continuity,
        status: 'guion_generado',
        validator_report: {
          source: 'arco_completo',
          validated_at: new Date().toISOString(),
          cliffhanger_unresolved: true,
          words: r.words,
          warnings: validation.warnings.filter((w) => w.startsWith(`Ep${r.episode_number} `))
        },
        updated_at: new Date().toISOString()
      };

      const current = (existingEpisodes || []).find((e) => e.episode_number === r.episode_number);
      if (!current) {
        const { error } = await supabase.from('episodes').insert(payload);
        if (error) throw error;
        result.inserted.push(r.episode_number);
      } else if (EDITABLE_STATUSES.has(current.status)) {
        const { error } = await supabase.from('episodes').update(payload).eq('id', current.id);
        if (error) throw error;
        result.updated.push(r.episode_number);
      } else {
        result.protected.push({ episode: r.episode_number, status: current.status });
      }
    }

    console.log('[import-series]', series.slug, JSON.stringify(result));
    return json(200, {
      series,
      characters: characterPayload.length,
      episodes: result,
      warnings: validation.warnings
    });
  } catch (err) {
    console.error('[import-series] ERROR:', err);
    return json(500, { error: err.message });
  }
};
