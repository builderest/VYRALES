// Importa una novela COMPLETA (serie + personajes + todos los episodios ya escritos) a
// Supabase. Se dispara desde el dashboard.
//
//   GET  /.netlify/functions/import-series               → novelas incluidas en el repo
//                                                           (series/*.json), si son válidas
//                                                           y si ya están en la base.
//   GET  /.netlify/functions/import-series?master=1      → "prompt maestro" para pedirle a
//                                                           Claude una novela nueva.
//   POST { slug }                                         → importa una novela del repo.
//   POST { series: {…json completo…} }                    → importa una novela PEGADA en el
//                                                           modal "PROMPT" del dashboard.
//   Cualquier POST con dry_run: true                      → solo valida y resume, no escribe.
//
// Reglas de seguridad:
//   - Si la validación tiene UN solo error, no se escribe nada (422 con la lista).
//   - Es idempotente: serie y personajes se actualizan por slug / (serie, nombre). La foto de
//     referencia de un personaje existente NO se toca.
//   - Un episodio que ya pasó a producción (generando_media, en_revision, publicado,
//     archivado) NUNCA se sobreescribe.
//   - No llama a Veo ni a ninguna API de pago.
const { getSupabaseClient } = require('./_supabase');
const { validateSeries, toEpisodeRows, buildImagePrompt } = require('./_series');
const { buildMasterPrompt } = require('./_master_prompt');

// esbuild necesita require() estáticos para empaquetar los JSON del repo.
const BUNDLED = {
  dulce_engano: require('../../series/dulce_engano.json')
};

const EDITABLE_STATUSES = new Set(['guion_pendiente', 'guion_generado', 'guion_rechazado']);
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

function summarize(data, validation, existingSeries) {
  return {
    slug: data.slug,
    title: data.title,
    genre: data.genre || null,
    exists: !!existingSeries,
    characters: (data.characters || []).map((c) => ({ key: c.key, name: c.name, role: c.role })),
    episodes: (data.episodes || []).map((e) => ({ n: e.episode_number, title: e.title, shots: (e.shots || []).length })),
    ...validation
  };
}

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};

    if (event.httpMethod === 'GET' && qs.master) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: buildMasterPrompt(BUNDLED.dulce_engano)
      };
    }

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
    if ((event.body || '').length > MAX_BODY_BYTES) return json(413, { error: 'La novela pesa más de 5 MB.' });

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch (_) {
      return json(400, { error: 'Body JSON inválido.' });
    }

    let data;
    if (body.series && typeof body.series === 'object') {
      data = body.series; // pegada en el modal del dashboard
    } else if (body.slug) {
      data = BUNDLED[body.slug];
      if (!data) return json(404, { error: `No existe series/${body.slug}.json en el proyecto.` });
    } else {
      return json(400, { error: 'Manda { slug } o { series: {...} }.' });
    }

    const validation = validateSeries(data);
    const { data: existingSeries } = await supabase.from('series').select('id').eq('slug', data.slug || '').maybeSingle();

    if (!validation.ok) {
      return json(422, { error: 'La novela no pasó la validación. No se importó nada.', ...summarize(data, validation, existingSeries) });
    }

    const rows = toEpisodeRows(data);
    if (body.dry_run) {
      return json(200, { dry_run: true, ...summarize(data, validation, existingSeries) });
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

    // 2) Personajes (con su prompt de foto ya generado)
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
          source: body.series ? 'pegada_en_dashboard' : 'repo',
          format_version: data.format_version || 1,
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

    // Episodios que sobran (la versión nueva tiene menos) y no están en producción: se
    // archivan para que no queden guiones viejos colgando en la cola.
    const newNumbers = new Set(rows.map((r) => r.episode_number));
    const leftovers = (existingEpisodes || []).filter((e) => !newNumbers.has(e.episode_number) && EDITABLE_STATUSES.has(e.status));
    for (const e of leftovers) {
      await supabase.from('episodes').update({ status: 'archivado' }).eq('id', e.id);
    }
    result.archived = leftovers.map((e) => e.episode_number);

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
