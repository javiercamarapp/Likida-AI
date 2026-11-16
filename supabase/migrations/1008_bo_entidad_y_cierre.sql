-- 1008 — Back-office de Likida, lote A: la entidad legal propia, el cierre mensual y el borrador del update a inversionistas.
--
-- Datos de PLATAFORMA (sin tenant_id): lo que Likida se aplica a sí misma. Solo service_role, tras requireSuperadmin() en el servidor.
--   · bo_entidad            una sola fila (id = 1): razón social, RFC, régimen, CP y fecha de constitución. Mientras `rfc` sea null, la
--                           contabilidad fiscal, la DIOT y el «deducible en forma» NO son evaluables y la pantalla lo dice.
--   · bo_cierre_mes         una fila por mes: cifras en pesos (numeric(12,2); null = «sin dato», jamás 0), estado abierto|listo|cerrado y
--                           el snapshot con las comprobaciones. Un mes cerrado no se edita ni se borra: se REABRE con motivo.
--   · bo_cierre_reapertura  solo-inserción: quién reabrió qué mes y por qué.
--   · bo_update_inversionistas  el borrador (markdown) del update del mes; se guarda, nunca se envía desde aquí.
--
-- ADITIVA E IDEMPOTENTE. NO se aplica a producción desde el repo: se aplica a mano, con autorización.
-- REVERSA (manual, en este orden):
--   drop table if exists public.bo_update_inversionistas;
--   drop function if exists public.bo_reabrir_cierre(date, text, uuid);
--   drop table if exists public.bo_cierre_reapertura;
--   drop table if exists public.bo_cierre_mes;
--   drop function if exists public.bo_cierre_mes_guarda();
--   drop function if exists public.bo_cierre_reapertura_solo_agregar();
--   drop table if exists public.bo_entidad;
--   drop function if exists public.bo_entidad_sin_borrar();
begin;

-- ───────────────────────────── bo_entidad ─────────────────────────────
create table if not exists public.bo_entidad (
  id                  smallint primary key default 1 check (id = 1),
  razon_social        text check (razon_social is null or char_length(btrim(razon_social)) between 1 and 200),
  rfc                 text check (rfc is null or (char_length(rfc) in (12, 13) and rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$')),
  regimen_fiscal      text check (regimen_fiscal is null or char_length(btrim(regimen_fiscal)) between 1 and 80),
  domicilio_fiscal_cp text check (domicilio_fiscal_cp is null or domicilio_fiscal_cp ~ '^[0-9]{5}$'),
  constituida_el      date,
  actualizada_por     uuid,
  actualizada_en      timestamptz not null default now()
);

comment on table public.bo_entidad is
  '1008: la entidad legal propia de Likida (una sola fila, id = 1). rfc null = aún sin razón social ni RFC propios: nada fiscal es evaluable. Solo service_role.';

create or replace function public.bo_entidad_sin_borrar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'bo_entidad no se borra (la fila id = 1 se actualiza)' using errcode = '42501';
end;
$$;

drop trigger if exists bo_entidad_sin_borrar on public.bo_entidad;
create trigger bo_entidad_sin_borrar
  before delete on public.bo_entidad
  for each row execute function public.bo_entidad_sin_borrar();

alter table public.bo_entidad enable row level security;
revoke all on table public.bo_entidad from public, anon, authenticated;
grant select, insert, update on table public.bo_entidad to service_role;
revoke delete, truncate on table public.bo_entidad from service_role;

-- ───────────────────────────── bo_cierre_mes ─────────────────────────────
-- Unidades: ingresos_cobrados e ingresos_facturados van SIN IVA (subtotal); iva_trasladado es el IVA de lo cobrado; neto =
-- ingresos_cobrados − cogs_ia − gastos_operativos − (comisiones_devengadas − clawback_aplicado). Cualquier componente null deja neto null.
create table if not exists public.bo_cierre_mes (
  periodo               date primary key check (extract(day from periodo) = 1),
  estado                text not null default 'abierto' check (estado in ('abierto', 'listo', 'cerrado')),
  ingresos_cobrados     numeric(12,2),
  ingresos_facturados   numeric(12,2),
  iva_trasladado        numeric(12,2),
  cogs_ia               numeric(12,2),
  gastos_operativos     numeric(12,2),
  comisiones_devengadas numeric(12,2),
  clawback_aplicado     numeric(12,2),
  neto                  numeric(12,2),
  tipo_cambio_usd       numeric(10,4) check (tipo_cambio_usd is null or tipo_cambio_usd > 0),
  snapshot              jsonb not null default '{}'::jsonb
                        check (jsonb_typeof(snapshot) = 'object' and pg_column_size(snapshot) <= 65536),
  cerrado_por           uuid,
  cerrado_en            timestamptz,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),
  constraint bo_cierre_cerrado_coherente
    check ((estado = 'cerrado') = (cerrado_en is not null and cerrado_por is not null))
);

comment on table public.bo_cierre_mes is
  '1008: cierre mensual de Likida. Un mes cerrado no se edita ni se borra; se reabre con bo_reabrir_cierre(periodo, motivo). null = sin dato, nunca 0. Solo service_role.';

create table if not exists public.bo_cierre_reapertura (
  id         bigint generated always as identity primary key,
  periodo    date not null references public.bo_cierre_mes (periodo) on delete restrict,
  motivo     text not null check (char_length(btrim(motivo)) >= 5),
  creado_por uuid,
  creado_en  timestamptz not null default now()
);

comment on table public.bo_cierre_reapertura is
  '1008: quién reabrió un mes cerrado y por qué. Solo inserción (UPDATE y DELETE se rechazan). Solo service_role.';

create index if not exists bo_cierre_reapertura_periodo_idx on public.bo_cierre_reapertura (periodo, creado_en desc);

-- Guarda del cierre: un mes cerrado no se toca (salvo la reapertura, que marca su transacción) y ninguno se borra.
create or replace function public.bo_cierre_mes_guarda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'bo_cierre_mes no se borra (periodo %)', old.periodo using errcode = '42501';
  end if;
  if new.periodo <> old.periodo then
    raise exception 'el periodo de un cierre no cambia' using errcode = '42501';
  end if;
  if old.estado = 'cerrado' then
    if current_setting('likida.reabriendo_cierre', true) = 'on' and new.estado = 'abierto' then
      new.actualizado_en := now();
      return new;
    end if;
    raise exception 'el cierre de % está cerrado: se reabre con motivo (bo_reabrir_cierre)', old.periodo using errcode = '42501';
  end if;
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists bo_cierre_mes_guarda on public.bo_cierre_mes;
create trigger bo_cierre_mes_guarda
  before update or delete on public.bo_cierre_mes
  for each row execute function public.bo_cierre_mes_guarda();

create or replace function public.bo_cierre_reapertura_solo_agregar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'bo_cierre_reapertura es de solo agregar (%)', tg_op using errcode = '42501';
end;
$$;

drop trigger if exists bo_cierre_reapertura_solo_agregar on public.bo_cierre_reapertura;
create trigger bo_cierre_reapertura_solo_agregar
  before update or delete on public.bo_cierre_reapertura
  for each row execute function public.bo_cierre_reapertura_solo_agregar();

-- Reabrir un mes cerrado: motivo obligatorio (≥ 5 caracteres), deja fila en bo_cierre_reapertura y vuelve el mes a 'abierto'.
create or replace function public.bo_reabrir_cierre(p_periodo date, p_motivo text, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_estado text;
begin
  if p_motivo is null or char_length(btrim(p_motivo)) < 5 then
    raise exception 'reabrir un cierre exige un motivo (mínimo 5 caracteres)' using errcode = '22023';
  end if;
  select estado into v_estado from public.bo_cierre_mes where periodo = p_periodo for update;
  if v_estado is null then
    raise exception 'no existe un cierre para %', p_periodo using errcode = '22023';
  end if;
  if v_estado <> 'cerrado' then
    raise exception 'el cierre de % no está cerrado (está %)', p_periodo, v_estado using errcode = '22023';
  end if;
  insert into public.bo_cierre_reapertura (periodo, motivo, creado_por) values (p_periodo, btrim(p_motivo), p_actor);
  perform set_config('likida.reabriendo_cierre', 'on', true);
  update public.bo_cierre_mes
     set estado = 'abierto', cerrado_por = null, cerrado_en = null
   where periodo = p_periodo;
  perform set_config('likida.reabriendo_cierre', 'off', true);
end;
$$;

revoke all on function public.bo_reabrir_cierre(date, text, uuid) from public, anon, authenticated;
grant execute on function public.bo_reabrir_cierre(date, text, uuid) to service_role;

alter table public.bo_cierre_mes enable row level security;
revoke all on table public.bo_cierre_mes from public, anon, authenticated;
grant select, insert, update on table public.bo_cierre_mes to service_role;
revoke delete, truncate on table public.bo_cierre_mes from service_role;

alter table public.bo_cierre_reapertura enable row level security;
revoke all on table public.bo_cierre_reapertura from public, anon, authenticated;
grant select, insert on table public.bo_cierre_reapertura to service_role;
revoke update, delete, truncate on table public.bo_cierre_reapertura from service_role;

-- ───────────────────────────── bo_update_inversionistas ─────────────────────────────
create table if not exists public.bo_update_inversionistas (
  periodo        date primary key references public.bo_cierre_mes (periodo) on delete restrict,
  borrador_md    text not null check (char_length(borrador_md) between 1 and 20000),
  aprobado_por   uuid,
  aprobado_en    timestamptz,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint bo_update_aprobacion_coherente check ((aprobado_por is null) = (aprobado_en is null))
);

comment on table public.bo_update_inversionistas is
  '1008: borrador (markdown) del update mensual a inversionistas. Se guarda y se descarga; nada de aquí se envía. Solo service_role.';

alter table public.bo_update_inversionistas enable row level security;
revoke all on table public.bo_update_inversionistas from public, anon, authenticated;
grant select, insert, update on table public.bo_update_inversionistas to service_role;
revoke delete, truncate on table public.bo_update_inversionistas from service_role;

commit;
