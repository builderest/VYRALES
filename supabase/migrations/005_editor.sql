-- VYRALES — migración 005: editor de episodios en el dashboard.
-- Guarda el plan de edición (recortes, orden, subtítulos, música, tarjetas) por episodio.
-- Idempotente: se puede correr más de una vez.
alter table episodes add column if not exists edit_plan jsonb;
