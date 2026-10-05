// Cliente de Supabase compartido por las funciones de Netlify.
// Usa la service_role key — SOLO vive aquí, en el servidor, nunca en el navegador.
// Configúrala en Netlify: Site settings → Environment variables →
//   SUPABASE_URL = https://TU-PROYECTO.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY = (Supabase → Project Settings → API → service_role)
const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Faltan las variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Netlify.'
    );
  }
  return createClient(url, key);
}

module.exports = { getSupabaseClient };
