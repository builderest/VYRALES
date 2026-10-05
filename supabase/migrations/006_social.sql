-- 006: cuentas de redes sociales conectadas (TikTok, Instagram) para publicar desde VYRALES.
-- Los tokens son SECRETOS: la tabla tiene RLS activado y NINGUNA política, así que solo la
-- service role (funciones de Netlify) puede leerla. get-episodes nunca la devuelve.
create table if not exists social_accounts (
  platform       text primary key,            -- 'tiktok' | 'instagram'
  account_id     text,                        -- open_id (TikTok) / user id (Instagram)
  account_name   text,
  access_token   text not null,
  refresh_token  text,
  expires_at     timestamptz,
  refresh_expires_at timestamptz,
  scopes         text,
  updated_at     timestamptz not null default now()
);
alter table social_accounts enable row level security;
