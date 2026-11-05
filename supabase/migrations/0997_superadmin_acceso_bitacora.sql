-- 0997 — Bitácora de lecturas y descargas del superadmin (F9, CT-ENT-01 / CT-SEG-05).
--
-- Hoy `impersonacion_dia` (0110) firma UNA vez por (actor, flota, día) que un superadmin abrió el panel de un cliente, y
-- `evento_seguridad` registra exportes de dinero. Falta lo que un cliente enterprise pregunta: ¿QUÉ leyó o descargó alguien de Likida
-- en mi flota, y cuándo? Esta tabla es ese registro, de solo agregar:
--   · una fila por lectura de página o descarga de un superadmin sobre una flota (la deduplica el código por minuto y ruta);
--   · SOLO la ruta (sin querystring) y el tipo; jamás el contenido ni filtros que traigan datos personales;
--   · append-only por disparador: UPDATE y DELETE se rechazan; la única salida es la poda por retención, con piso de 365 días.
--
-- Retención: el piso de 365 días es una PROPUESTA mientras no se cierre la decisión D7 (retención de datos, fila 11 de TAREAS-JAVIER).
-- Solo service_role (RLS sin políticas). El emisor (src/lib/seguridad/acceso_superadmin.ts) está tras bandera apagada y tolera
-- que la tabla no exista.
--
-- ADITIVA E IDEMPOTENTE.
-- REVERSA (manual):
--   drop function if exists public.purgar_superadmin_acceso(integer);
--   drop table if exists public.superadmin_acceso;
--   drop function if exists public.superadmin_acceso_solo_agregar();
begin;

create table if not exists public.superadmin_acceso (
  id        bigint generated always as identity primary key,
  creado_en timestamptz not null default now(),
  actor     uuid not null,
  tenant_id uuid,
  tipo      text not null check (tipo in ('lectura', 'descarga', 'ver_como')),
  ruta      text not null check (char_length(ruta) between 1 and 200 and ruta !~ '[?#]'),
  detalle   jsonb not null default '{}'::jsonb check (jsonb_typeof(detalle) = 'object' and pg_column_size(detalle) <= 2048)
);

comment on table public.superadmin_acceso is
  '0997: lecturas y descargas de un superadmin sobre una flota. Solo agregar; ruta sin querystring; poda con piso de 365 días. Solo service_role.';

create index if not exists superadmin_acceso_tenant_creado_idx on public.superadmin_acceso (tenant_id, creado_en desc);
create index if not exists superadmin_acceso_actor_creado_idx on public.superadmin_acceso (actor, creado_en desc);

create or replace function public.superadmin_acceso_solo_agregar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- La poda por retención marca su transacción; cualquier otro UPDATE o DELETE se rechaza.
  if tg_op = 'DELETE' and current_setting('likida.purgando_superadmin_acceso', true) = 'on' then
    return old;
  end if;
  raise exception 'superadmin_acceso es de solo agregar (%)', tg_op using errcode = '42501';
end;
$$;

drop trigger if exists superadmin_acceso_solo_agregar on public.superadmin_acceso;
create trigger superadmin_acceso_solo_agregar
  before update or delete on public.superadmin_acceso
  for each row execute function public.superadmin_acceso_solo_agregar();

alter table public.superadmin_acceso enable row level security;
revoke all on table public.superadmin_acceso from public, anon, authenticated;
grant select, insert on table public.superadmin_acceso to service_role;
-- Los privilegios por omision del esquema ya dan todo a service_role: se quitan los que romperian el solo-agregar.
revoke update, delete, truncate on table public.superadmin_acceso from service_role;

create or replace function public.purgar_superadmin_acceso(p_dias integer default 365)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_n integer;
begin
  if p_dias is null or p_dias < 365 then
    raise exception 'la retencion minima de superadmin_acceso es 365 dias (pidio %)', p_dias using errcode = '22023';
  end if;
  perform set_config('likida.purgando_superadmin_acceso', 'on', true);
  delete from public.superadmin_acceso where creado_en < now() - make_interval(days => p_dias);
  get diagnostics v_n = row_count;
  perform set_config('likida.purgando_superadmin_acceso', 'off', true);
  return v_n;
end;
$$;

revoke all on function public.purgar_superadmin_acceso(integer) from public, anon, authenticated;
grant execute on function public.purgar_superadmin_acceso(integer) to service_role;

commit;
