-- VYRALES · CANALES DEL ADMIN (oct-13): varios canales en una misma cuenta de admin.
-- Ejecutar UNA vez en Supabase → SQL Editor → Run (después de la 009). Idempotente (se puede correr dos veces).
--
-- Qué hace:
--  * workspaces.owner_ws: si está lleno, ese espacio es un CANAL que pertenece a un espacio admin
--    (NO es una cuenta de cliente con login). El admin crea varios canales y cambia entre ellos sin salir.
--  * El canal "principal" sigue siendo el admin de siempre (00000000-…-0001, owner_ws = NULL).
alter table public.workspaces add column if not exists owner_ws uuid references public.workspaces(id) on delete cascade;
create index if not exists workspaces_owner on public.workspaces(owner_ws);
