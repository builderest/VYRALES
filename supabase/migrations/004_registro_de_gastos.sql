-- VYRALES — migración 004: registro de gastos (cada llamada que cuesta dinero)
-- Idempotente. Cada generación exitosa de video (Veo) o imagen (Gemini) agrega una fila,
-- AUNQUE después se regenere: así el dashboard muestra el gasto real acumulado y no solo
-- el costo de las versiones que existen hoy.
create table if not exists generation_log (
  id            uuid primary key default gen_random_uuid(),
  series_id     uuid references series(id) on delete set null,
  episode_id    uuid references episodes(id) on delete set null,
  shot_number   integer,
  kind          text not null,          -- 'video' | 'keyframe' | 'location'
  model         text,
  cost_usd      numeric(10,4) not null default 0,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_generation_log_series on generation_log(series_id);
create index if not exists idx_generation_log_created on generation_log(created_at);
alter table generation_log enable row level security;
grant all on generation_log to service_role;
