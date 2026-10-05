-- VYRALES — migración 003: memoria visual por novela
-- Cómo usarla: Supabase → SQL Editor → pega todo → Run. Idempotente, no borra datos.
--
-- series.visual_memory guarda las imágenes fijas de cada LUGAR de la novela (la panadería,
-- el elevador…) que se reutilizan como referencia al generar el cuadro inicial de cada toma:
--   { "locations": { "<key>": { "url": "...", "prompt": "...", "cost_usd": 0.067, "updated_at": "..." } } }
-- No lo toca el importador (re-importar una novela no borra la memoria visual).
alter table series add column if not exists visual_memory jsonb not null default '{}'::jsonb;

-- Los cuadros iniciales de cada toma se guardan en `assets` con kind='image' y
-- model='nano_banana' (ya existen en los enums de schema.sql).
select column_name, data_type from information_schema.columns
 where table_schema='public' and table_name='series' and column_name='visual_memory';
