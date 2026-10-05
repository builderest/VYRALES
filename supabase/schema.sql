-- VYRALES — esquema inicial de Supabase
-- IMPORTANTE: después de este archivo corre también supabase/migrations/002_novela_completa.sql
-- (columnas title/shots/profile/sort_order, índice único de personajes y permisos).
-- Cómo usarlo: Supabase Dashboard → tu proyecto → SQL Editor → pega todo esto → Run.
-- Seguridad: RLS queda ACTIVADO en todas las tablas y sin políticas públicas a propósito.
-- Eso significa que nadie puede leer ni escribir estos datos desde el navegador con la
-- clave "anon". Solo las funciones de Netlify, usando la clave "service_role" (que nunca
-- se expone al navegador), pueden tocar esta base. Es la forma más simple de mantener
-- todo privado sin tener que escribir políticas de acceso fila por fila.

create extension if not exists "pgcrypto"; -- para gen_random_uuid()

-- ─────────────────────────────────────────────────────────────────────────
-- channels: las plataformas donde se publica (TikTok, YouTube Shorts, Reels)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists channels (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,                 -- "TikTok", "YouTube Shorts", "Instagram Reels"
  platform      text not null,                 -- "tiktok" | "youtube" | "instagram"
  handle        text,                          -- @usuario en esa plataforma
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- series: cada novela/microdrama — incluye el story bible completo en JSON
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists series (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,          -- "dragon_silicio", usado en rutas de Storage
  title           text not null,                 -- "El Dragón de Silicio"
  genre           text,                          -- "Sci-Fi", "Drama", "Cyberpunk Thriller"
  language        text not null default 'es',
  synopsis        text,
  -- story_bible guarda las reglas fijas: tono, arquetipos, reglas de continuidad.
  -- Ejemplo de forma (no es obligatorio seguirla al pie de la letra):
  -- {
  --   "tone": "thriller tenso, ritmo rápido",
  --   "setting": "Neo-Tokio, 2089",
  --   "rules": {
  --     "cliffhanger_required": true,
  --     "max_words_per_episode": 400
  --   },
  --   "archetypes": { "elena_vance": "protagonista rebelde", "kenji_sato": "antagonista corporativo" }
  -- }
  story_bible     jsonb not null default '{}'::jsonb,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- characters: un personaje por fila, con su referencia visual fija
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists characters (
  id                uuid primary key default gen_random_uuid(),
  series_id         uuid not null references series(id) on delete cascade,
  name              text not null,                 -- "Elena Vance"
  role              text,                          -- "protagonista" | "antagonista" | "secundario"
  description       text,                          -- descripción física/personalidad en español
  fixed_prompt_tag  text,                           -- el tag en inglés que se inyecta en cada generación de imagen/video
  reference_image_url text,                         -- URL en Supabase Storage de la imagen de referencia fija
  created_at        timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- episodes: un capítulo — su guion, estado, y a qué canales va
-- ─────────────────────────────────────────────────────────────────────────
create type episode_status as enum (
  'guion_pendiente',   -- aún no se ha escrito el guion
  'guion_generado',    -- Claude escribió el guion, esperando validación
  'guion_rechazado',   -- el validador lo rechazó (sin cliffhanger o inconsistente) — se reintenta
  'generando_media',   -- aprobado, generando imágenes/video en Veo
  'en_revision',       -- media lista, esperando el filtro humano de 1-2 min
  'publicado',         -- ya salió en los canales
  'archivado'
);

create table if not exists episodes (
  id              uuid primary key default gen_random_uuid(),
  series_id       uuid not null references series(id) on delete cascade,
  episode_number  integer not null,
  status          episode_status not null default 'guion_pendiente',
  script          text,                       -- el guion completo en español
  -- continuity: lo que debe recordar el SIGUIENTE episodio (gancho sin resolver, estado pendiente)
  continuity      jsonb not null default '{}'::jsonb,
  validator_report jsonb,                      -- resultado del chequeo contra el story bible (ver doc)
  retries_count   integer not null default 0,
  final_video_path text,                       -- ruta en Storage del episodio ya armado
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (series_id, episode_number)
);

-- qué canales recibirán este episodio (muchos a muchos)
create table if not exists episode_channels (
  episode_id   uuid not null references episodes(id) on delete cascade,
  channel_id   uuid not null references channels(id) on delete cascade,
  posted_at    timestamptz,
  post_url     text,
  primary key (episode_id, channel_id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- assets: cada imagen o clip de video generado, ligado a su episodio
-- ─────────────────────────────────────────────────────────────────────────
create type asset_kind as enum ('image', 'video_clip', 'final_render');
create type asset_model as enum ('nano_banana', 'veo_lite', 'veo_fast', 'other');

create table if not exists assets (
  id            uuid primary key default gen_random_uuid(),
  episode_id    uuid not null references episodes(id) on delete cascade,
  kind          asset_kind not null,
  model         asset_model not null,
  shot_number   integer,                 -- 1..8, el número de toma dentro del episodio
  storage_path  text not null,           -- ruta dentro del bucket de Supabase Storage
  prompt        text,                    -- el prompt exacto usado para generarlo
  cost_usd      numeric(10,4),           -- costo real reportado por la API, para la telemetría
  quality_score numeric(5,2),            -- 0-100, si se corre un chequeo automático de calidad
  approved      boolean not null default false,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  -- updated_at: se usa desde el dashboard para saber cuándo una regeneración (regen-shot)
  -- o una unión de video final (merge-episode) YA terminó — el frontend guarda el valor
  -- de antes de disparar la acción y hace polling a get-episodes hasta que cambia. El
  -- trigger de abajo lo actualiza solo en cada UPDATE, sin que el código tenga que
  -- acordarse de tocarlo a mano.
  updated_at    timestamptz not null default now()
);

create index if not exists idx_episodes_series on episodes(series_id);
create index if not exists idx_episodes_status on episodes(status);
create index if not exists idx_assets_episode on assets(episode_id);
create index if not exists idx_characters_series on characters(series_id);

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

-- ─────────────────────────────────────────────────────────────────────────
-- Bloquear todo por defecto (ver nota de seguridad arriba)
-- ─────────────────────────────────────────────────────────────────────────
alter table channels enable row level security;
alter table series enable row level security;
alter table characters enable row level security;
alter table episodes enable row level security;
alter table episode_channels enable row level security;
alter table assets enable row level security;
-- A propósito no se crea ninguna policy: sin policies + RLS activo = nadie entra
-- excepto la service_role key (que Supabase deja pasar siempre, RLS o no).

-- ─────────────────────────────────────────────────────────────────────────
-- Datos de ejemplo para probar el dashboard de inmediato (bórralos cuando
-- tengas tu primera serie real)
-- ─────────────────────────────────────────────────────────────────────────
insert into channels (name, platform, handle) values
  ('TikTok', 'tiktok', '@vyrales'),
  ('YouTube Shorts', 'youtube', '@vyrales'),
  ('Instagram Reels', 'instagram', '@vyrales')
on conflict do nothing;

insert into series (slug, title, genre, synopsis, story_bible) values (
  'dragon_silicio',
  'El Dragón de Silicio',
  'Sci-Fi',
  'Una ingeniera cibernética descubre una IA oculta dentro de SilicoCorp.',
  '{"tone":"thriller tenso, ritmo rápido","setting":"Neo-Tokio, 2089","rules":{"cliffhanger_required":true,"max_words_per_episode":400}}'
) on conflict (slug) do nothing;
