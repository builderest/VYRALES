-- VYRALES — migración 002: novelas escritas completas (arco entero) + sección de personajes
-- Cómo usarla: Supabase → SQL Editor → pega todo → Run. Es idempotente: se puede correr
-- más de una vez sin romper nada ni borrar datos.

-- Episodios: título y tomas estructuradas (una entrada por toma de 8s con set, personajes,
-- vestuario, acción visual en inglés y diálogo en español).
alter table episodes add column if not exists title text;
alter table episodes add column if not exists shots jsonb;

-- Personajes: ficha completa (edad, personalidad, arco, vestuario por defecto…) y orden en
-- el dashboard.
alter table characters add column if not exists profile jsonb not null default '{}'::jsonb;
alter table characters add column if not exists sort_order integer not null default 0;

-- Un personaje no se puede repetir dentro de la misma serie (permite el upsert del importador).
create unique index if not exists uq_characters_series_name on characters(series_id, name);

-- assets.updated_at + trigger (lo usa el dashboard para saber cuándo terminó una
-- regeneración). Por si la base se creó con la primera versión de schema.sql.
alter table assets add column if not exists updated_at timestamptz not null default now();

create or replace function set_assets_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_assets_updated_at on assets;
create trigger trg_assets_updated_at
  before update on assets
  for each row
  execute function set_assets_updated_at();

-- Permisos de la service_role (los mismos que se dieron a mano el 2026-10-04; aquí quedan
-- documentados para que una base nueva funcione igual).
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
