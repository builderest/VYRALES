-- 007: Terminal de VYRALES (botones en vyrales.app que ejecutan comandos PRE-REGISTRADOS en el
-- PC de Franklin). La página solo encola el NOMBRE del comando; el agente del PC (agente/agente.js)
-- lo busca en su lista blanca, lo ejecuta en la carpeta del proyecto y escribe la salida aquí.
-- RLS activado y SIN políticas: solo la service role (funciones de Netlify y el agente) lee/escribe.
create table if not exists agent_jobs (
  id          uuid primary key default gen_random_uuid(),
  command     text not null,                 -- nombre de la lista blanca (ej. 'push')
  status      text not null default 'pending', -- pending | running | done | error | expired
  output      text not null default '',
  exit_code   integer,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);
create index if not exists agent_jobs_created on agent_jobs (created_at desc);
alter table agent_jobs enable row level security;

create table if not exists agent_state (
  id         integer primary key,              -- siempre 1
  last_seen  timestamptz,
  host       text,
  info       jsonb
);
alter table agent_state enable row level security;
