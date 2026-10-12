-- VYRALES · claves de las APIs guardadas desde el panel (página Cuenta → API)
-- Ejecutar UNA vez en Supabase → SQL Editor → Run.
--
-- Seguridad:
--  * El valor se guarda CIFRADO (AES-256-GCM) por netlify/functions/_keys.js. La llave de cifrado
--    sale de VYRALES_SECRET (si existe) o de SUPABASE_SERVICE_ROLE_KEY, que solo viven en el servidor.
--  * RLS activado y SIN políticas: el navegador (anon) no puede leer ni escribir esta tabla.
--    Solo las funciones de Netlify y el agente (service_role) la usan.
--  * Solo se aceptan los nombres de la lista blanca de _keys.js. Supabase, DASHBOARD_KEY y
--    VYRALES_SECRET nunca se guardan aquí.

create table if not exists public.app_secrets (
  name        text primary key,
  value_enc   text not null,
  updated_at  timestamptz not null default now()
);

alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
