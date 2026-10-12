-- VYRALES · MULTIUSUARIO (fases 1-3): espacios de trabajo, usuarios, permisos y créditos.
-- Ejecutar UNA vez en Supabase → SQL Editor → Run (después de la 008). Se puede correr dos veces sin daño.
--
-- Qué hace:
--  * workspaces: un espacio por cliente. El tuyo (admin) es el 00000000-…-0001 y TODO lo que ya existe
--    queda en él (series, gastos, trabajos de la PC, redes conectadas, claves del panel).
--  * app_users: usuarios con email + contraseña (hash scrypt; nunca la contraseña en texto).
--  * workspace_id en series, agent_jobs, generation_log, social_accounts y app_secrets.
--    Episodios, tomas y personajes cuelgan de su serie, así que heredan el dueño de la serie.
--  * credit_ledger: cada movimiento de créditos (compra, regalo, cobro) con su costo real.
--  * RLS activado SIN políticas en las tablas nuevas: el navegador (anon) no puede leerlas.
--    Solo las funciones de Netlify y el agente (service_role) las usan, y ellas filtran por espacio.

-- ---------- espacios ----------
create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  is_admin    boolean not null default false,
  credits     bigint not null default 0,          -- saldo en créditos (1 crédito = $0.01 por defecto)
  perms       jsonb not null default '{}'::jsonb,  -- { keys: {google:true, fal:false, ...}, pc: true }
  settings    jsonb not null default '{}'::jsonb,  -- solo admin: { markup: 2.5, credit_usd: 0.01, pc_job_credits: 10, pc_shot_credits: 10 }
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
insert into public.workspaces (id, name, is_admin, settings)
values ('00000000-0000-0000-0000-000000000001', 'Admin', true, '{"markup": 2.5, "credit_usd": 0.01, "pc_job_credits": 10, "pc_shot_credits": 10}'::jsonb)
on conflict (id) do nothing;

-- ---------- usuarios ----------
create table if not exists public.app_users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  name           text,
  pass_hash      text not null,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  role           text not null default 'owner',
  active         boolean not null default true,
  prefs          jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz
);
create index if not exists app_users_ws on public.app_users(workspace_id);

-- ---------- dueño de cada dato ----------
alter table public.series         add column if not exists workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id);
alter table public.agent_jobs     add column if not exists workspace_id uuid not null default '00000000-0000-0000-0000-000000000001';
alter table public.generation_log add column if not exists workspace_id uuid not null default '00000000-0000-0000-0000-000000000001';
create index if not exists series_ws on public.series(workspace_id);
create index if not exists agent_jobs_ws on public.agent_jobs(workspace_id, status);
create index if not exists generation_log_ws on public.generation_log(workspace_id, created_at);

-- Redes conectadas: antes una cuenta por red para todo el sistema; ahora una por red POR ESPACIO.
alter table public.social_accounts add column if not exists workspace_id uuid not null default '00000000-0000-0000-0000-000000000001';
alter table public.social_accounts drop constraint if exists social_accounts_pkey;
alter table public.social_accounts add primary key (workspace_id, platform);

-- Claves del panel (página API): una por nombre POR ESPACIO. (Crea la tabla si la 008 no se corrió.)
create table if not exists public.app_secrets (
  name        text not null,
  value_enc   text not null,
  updated_at  timestamptz not null default now()
);
alter table public.app_secrets add column if not exists workspace_id uuid not null default '00000000-0000-0000-0000-000000000001';
alter table public.app_secrets drop constraint if exists app_secrets_pkey;
alter table public.app_secrets add primary key (workspace_id, name);

-- ---------- créditos ----------
create table if not exists public.credit_ledger (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  delta         bigint not null,               -- + compra/regalo, − cobro
  balance_after bigint,
  reason        text not null,                 -- 'regalo_admin' | 'compra' | 'uso_api' | 'uso_pc' | 'ajuste'
  detail        text,
  cost_usd      numeric(10,4),                 -- lo que te costó a ti (para ver tu margen)
  created_by    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists credit_ledger_ws on public.credit_ledger(workspace_id, created_at desc);

-- Mover créditos sin carreras: suma/resta y anota en el historial en una sola operación.
create or replace function public.credit_move(p_ws uuid, p_delta bigint, p_reason text, p_detail text, p_cost numeric, p_by uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare nb bigint;
begin
  update workspaces set credits = credits + p_delta where id = p_ws returning credits into nb;
  if nb is null then raise exception 'workspace % no existe', p_ws; end if;
  insert into credit_ledger(workspace_id, delta, balance_after, reason, detail, cost_usd, created_by)
  values (p_ws, p_delta, nb, p_reason, p_detail, p_cost, p_by);
  return nb;
end $$;
revoke all on function public.credit_move(uuid, bigint, text, text, numeric, uuid) from public, anon, authenticated;
grant execute on function public.credit_move(uuid, bigint, text, text, numeric, uuid) to service_role;

-- ---------- seguridad ----------
alter table public.workspaces    enable row level security;
alter table public.app_users     enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.app_secrets   enable row level security;
revoke all on public.workspaces, public.app_users, public.credit_ledger, public.app_secrets from anon, authenticated;
grant all on public.workspaces, public.app_users, public.credit_ledger, public.app_secrets to service_role;
