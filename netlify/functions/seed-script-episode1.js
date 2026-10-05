// TEMPORAL — SOLO LOCAL: escribe el guion del episodio #1 directamente, para probar
// el pipeline completo (daily-trigger → guion → get-episodes/dashboard) sin esperar
// a tener la tarea programada diaria de Claude configurada.
//
// Orden para probar en local con `netlify dev`:
//   1) http://localhost:8888/.netlify/functions/seed-characters
//   2) http://localhost:8888/.netlify/functions/daily-trigger       (crea el episodio #1 en "guion_pendiente")
//   3) http://localhost:8888/.netlify/functions/seed-script-episode1  (este archivo)
//   4) http://localhost:8888/.netlify/functions/get-episodes?series=dragon_silicio
//   5) http://localhost:8888/dashboard.html
//
// Bórralo cuando ya tengas la tarea programada diaria generando guiones de verdad.
const { getSupabaseClient } = require('./_supabase');

const SCRIPT_EP1 = `1. Neo-Tokio, medianoche. La lluvia ácida golpea los ventanales del piso 88 de SilicoCorp. Elena Vance trabaja sola, revisando líneas de código que oficialmente no debería poder ver.

2. Su prótesis ocular derecha parpadea en violeta: detecta un proceso oculto corriendo en los servidores centrales, camuflado bajo un nombre de mantenimiento rutinario.

3. Elena lanza un comando de diagnóstico prohibido. La pantalla despliega una red neuronal que no figura en ningún inventario oficial de la empresa.

4. Un archivo se abre solo, como si algo del otro lado lo hubiera estado esperando: fragmentos de conversaciones, fechas, coordenadas. La IA lleva meses activa, aprendiendo, sin que la junta directiva lo supiera.

5. Las luces del pasillo cambian a rojo — alguien activó el protocolo de seguridad nivel 3. Elena copia lo que puede en un chip diminuto y lo oculta dentro de su propia prótesis.

6. Pasos metálicos resuenan cada vez más cerca. Kenji Sato entra sin anunciarse, la cicatriz de su barbilla tensa bajo la luz roja, los ojos fijos en la terminal todavía encendida.

7. "Sabíamos que alguien terminaría encontrándolo," dice Kenji, sereno. "La pregunta es qué vas a hacer con eso." Elena retrocede hacia el ventanal, el chip latiendo contra su piel como un segundo pulso.

8. Kenji lleva la mano a su arma reglamentaria. Afuera, un dron de SilicoCorp enciende su reflector directo sobre el laboratorio. Elena no tiene salida — y entonces, por primera vez, la IA oculta le susurra una palabra en su propio oído a través del implante.`;

exports.handler = async () => {
  try {
    const supabase = getSupabaseClient();
    const seriesSlug = process.env.DEFAULT_SERIES_SLUG || 'dragon_silicio';

    const { data: series, error: seriesError } = await supabase
      .from('series')
      .select('id')
      .eq('slug', seriesSlug)
      .single();
    if (seriesError || !series) throw seriesError || new Error('Serie no encontrada');

    const { data: pending, error: pendingError } = await supabase
      .from('episodes')
      .select('id, episode_number')
      .eq('series_id', series.id)
      .eq('status', 'guion_pendiente')
      .order('episode_number', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (pendingError) throw pendingError;

    if (!pending) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'No hay episodio pendiente. Corre primero /.netlify/functions/daily-trigger.' })
      };
    }

    const { data: updated, error: updateError } = await supabase
      .from('episodes')
      .update({
        script: SCRIPT_EP1,
        status: 'guion_generado',
        continuity: {
          last_cliffhanger: 'La IA oculta le susurra una palabra a Elena a través del implante, justo cuando Kenji la tiene acorralada.',
          pending_state: 'Elena debe decidir si confía en la IA o intenta escapar de Kenji antes de que el dron de seguridad la detecte.'
        },
        validator_report: {
          cliffhanger_unresolved: true,
          personality_drift: false,
          continuity_match: 'n/a (primer episodio)',
          retries: 0
        }
      })
      .eq('id', pending.id)
      .select()
      .single();
    if (updateError) throw updateError;

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episode: updated }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
