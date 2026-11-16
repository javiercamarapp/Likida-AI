-- 1010 — Back-office de Likida: comisiones y pagos a vendedores (LOTE C, módulo 2).
--
-- La comisión es una REGLA sobre COBRADO, no una cifra. Regla pactada (Javier, 14-ago-2026): 50 % del primer mes y 20 % recurrente. El
-- código (vendedores.ts: COMISION_PRIMER_MES, COMISION_RECURRENTE, reglaComision) es la fuente PRIMARIA; la tabla bo_comision_regla solo
-- congela el porcentaje usado y guarda la vigencia, que hoy es null: los 24 meses del paquete son una PROPUESTA no pactada.
--
--   · bo_comision_mov: libro de SOLO INSERCIÓN. Devengo = comisión sobre el SUBTOTAL sin IVA (base a confirmar) de una factura_saas
--     'pagada' con conciliada_en y referencia_banco (el disparador lo vuelve a comprobar). Clawback = movimiento NEGATIVO ligado al devengo
--     origen cuando la factura se cancela después. (factura_saas_id, tipo) y (referencia_origen) únicos: devengar o reversar dos veces no duplica.
--   · bo_pago_vendedor: máquina de estados borrador → autorizado → pagado. Sin CFDI de honorarios no sale de borrador. Un solo pago por
--     (vendedor, periodo). El sistema NUNCA genera orden de transferencia ni escribe al vendedor: solo registra lo que un humano autorizó y pagó.
--   · bo_saldo_comision(vendedor): devengado + clawbacks − pagos autorizados/pagados. Un saldo NEGATIVO se arrastra a lo siguiente; jamás
--     se le pide dinero de vuelta al vendedor.
--
-- ADITIVA E IDEMPOTENTE. NO SE APLICA A PRODUCCIÓN SIN AUTORIZACIÓN.
-- REVERSA (manual):
--   drop function if exists public.bo_saldo_comision(uuid);
--   drop trigger if exists bo_pago_vendedor_transiciones on public.bo_pago_vendedor;
--   drop function if exists public.bo_pago_vendedor_transiciones();
--   drop table if exists public.bo_pago_vendedor;
--   drop trigger if exists bo_comision_mov_valida on public.bo_comision_mov;
--   drop trigger if exists bo_comision_mov_solo_insercion on public.bo_comision_mov;
--   drop function if exists public.bo_comision_mov_valida();
--   drop function if exists public.bo_comision_mov_solo_insercion();
--   drop table if exists public.bo_comision_mov;
--   drop table if exists public.bo_comision_regla;
begin;

create table if not exists public.bo_comision_regla (
  id            uuid primary key default gen_random_uuid(),
  vigente_desde date not null,
  primer_mes_pct numeric(5,4) not null default 0.5000 check (primer_mes_pct between 0 and 1),
  recurrente_pct numeric(5,4) not null default 0.2000 check (recurrente_pct between 0 and 1),
  vigencia_meses int check (vigencia_meses is null or vigencia_meses > 0),
  nota          text,
  creado_en     timestamptz not null default now()
);

comment on table public.bo_comision_regla is
  '1010: congela el porcentaje pactado y la vigencia. El código sigue siendo la fuente primaria. vigencia_meses null = no definida (los 24 meses son PROPUESTA).';

create unique index if not exists bo_comision_regla_vigente_desde_unica on public.bo_comision_regla (vigente_desde);
insert into public.bo_comision_regla (vigente_desde, primer_mes_pct, recurrente_pct, vigencia_meses, nota)
values ('2026-08-14', 0.5000, 0.2000, null, 'Regla pactada el 14-ago-2026. Vigencia no definida (propuesta de 24 meses sin pactar).')
on conflict (vigente_desde) do nothing;

create table if not exists public.bo_comision_mov (
  id               uuid primary key default gen_random_uuid(),
  vendedor_id      uuid not null references public.app_user(id) on delete restrict,
  prospecto_id     uuid references public.prospecto(id) on delete restrict,
  tenant_id        uuid,
  factura_saas_id  uuid references public.factura_saas(id) on delete restrict,
  periodo          date not null check (periodo = date_trunc('month', periodo::timestamp)::date),
  tipo             text not null check (tipo in ('devengo', 'clawback')),
  concepto         text not null check (concepto in ('primer_mes', 'recurrente', 'ajuste')),
  base_cobrada     numeric(12,2) not null check (base_cobrada >= 0),
  pct_aplicado     numeric(5,4) check (pct_aplicado is null or pct_aplicado between 0 and 1),
  monto            numeric(12,2) not null,
  referencia_origen uuid references public.bo_comision_mov(id) on delete restrict,
  creado_en        timestamptz not null default now(),
  creado_por       uuid references public.app_user(id) on delete set null,
  constraint bo_comision_mov_tipo_concepto check ((tipo = 'clawback') = (concepto = 'ajuste')),
  constraint bo_comision_mov_signo check ((tipo = 'devengo' and monto >= 0) or (tipo = 'clawback' and monto < 0)),
  constraint bo_comision_mov_origen check ((tipo = 'clawback') = (referencia_origen is not null)),
  constraint bo_comision_mov_devengo_con_factura check (tipo <> 'devengo' or (factura_saas_id is not null and pct_aplicado is not null))
);

comment on table public.bo_comision_mov is
  '1010: libro de comisiones de solo inserción. devengo sobre SUBTOTAL sin IVA de factura pagada y conciliada con referencia de banco; clawback negativo ligado al origen. Solo service_role.';

create unique index if not exists bo_comision_mov_una_por_factura_y_tipo
  on public.bo_comision_mov (factura_saas_id, tipo) where factura_saas_id is not null;
create unique index if not exists bo_comision_mov_un_clawback_por_origen
  on public.bo_comision_mov (referencia_origen) where referencia_origen is not null;
create index if not exists bo_comision_mov_vendedor_periodo_idx on public.bo_comision_mov (vendedor_id, periodo desc);

create or replace function public.bo_comision_mov_solo_insercion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'bo_comision_mov es de solo inserción (%): se corrige con un clawback o un ajuste enlazado', tg_op using errcode = '42501';
end;
$$;

drop trigger if exists bo_comision_mov_solo_insercion on public.bo_comision_mov;
create trigger bo_comision_mov_solo_insercion
  before update or delete on public.bo_comision_mov
  for each row execute function public.bo_comision_mov_solo_insercion();

drop trigger if exists bo_comision_mov_sin_truncate on public.bo_comision_mov;
create trigger bo_comision_mov_sin_truncate
  before truncate on public.bo_comision_mov
  for each statement execute function public.bo_comision_mov_solo_insercion();

-- Defensa en profundidad: aunque el código ya lo comprueba, la base no deja devengar sobre algo no cobrado ni inventar un clawback.
create or replace function public.bo_comision_mov_valida()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  f record;
  o record;
begin
  if new.tipo = 'devengo' then
    select estado, subtotal, conciliada_en, referencia_banco into f from public.factura_saas where id = new.factura_saas_id;
    if not found or f.estado <> 'pagada' or f.conciliada_en is null or char_length(btrim(coalesce(f.referencia_banco, ''))) < 3 then
      raise exception 'solo se comisiona una factura pagada y conciliada con referencia de banco' using errcode = '23514';
    end if;
    if f.subtotal is null or abs(new.base_cobrada - f.subtotal) > 0.01 then
      raise exception 'la base de comisión es el subtotal sin IVA de la factura (%)', f.subtotal using errcode = '23514';
    end if;
  else
    select tipo, vendedor_id, monto, factura_saas_id into o from public.bo_comision_mov where id = new.referencia_origen;
    if not found or o.tipo <> 'devengo' or o.vendedor_id <> new.vendedor_id
       or o.factura_saas_id is distinct from new.factura_saas_id or new.monto <> -o.monto then
      raise exception 'un clawback revierte exactamente un devengo del mismo vendedor y la misma factura' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bo_comision_mov_valida on public.bo_comision_mov;
create trigger bo_comision_mov_valida
  before insert on public.bo_comision_mov
  for each row execute function public.bo_comision_mov_valida();

create table if not exists public.bo_pago_vendedor (
  id                  uuid primary key default gen_random_uuid(),
  vendedor_id         uuid not null references public.app_user(id) on delete restrict,
  periodo             date not null check (periodo = date_trunc('month', periodo::timestamp)::date),
  monto_autorizado    numeric(12,2) not null check (monto_autorizado > 0),
  cfdi_honorarios_uuid text check (cfdi_honorarios_uuid is null
                        or cfdi_honorarios_uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  cfdi_honorarios_recibido_en date,
  estado              text not null default 'borrador' check (estado in ('borrador', 'autorizado', 'pagado')),
  autorizado_por      uuid references public.app_user(id) on delete set null,
  autorizado_en       timestamptz,
  pagado_en           date,
  referencia_banco    text,
  creado_por          uuid references public.app_user(id) on delete set null,
  creado_en           timestamptz not null default now(),
  constraint bo_pago_vendedor_sin_cfdi_no_sale_de_borrador check (estado = 'borrador' or cfdi_honorarios_uuid is not null),
  constraint bo_pago_vendedor_autorizacion_coherente check ((estado = 'borrador') = (autorizado_en is null) and (autorizado_en is null) = (autorizado_por is null)),
  constraint bo_pago_vendedor_pago_coherente check (
    (estado = 'pagado') = (pagado_en is not null)
    and (estado <> 'pagado' or char_length(btrim(coalesce(referencia_banco, ''))) >= 3)
    and (estado = 'pagado' or referencia_banco is null))
);

comment on table public.bo_pago_vendedor is
  '1010: un pago por (vendedor, periodo). borrador → autorizado (exige CFDI de honorarios) → pagado (exige referencia de banco). El sistema no genera órdenes de transferencia ni escribe al vendedor. Solo service_role.';

create unique index if not exists bo_pago_vendedor_uno_por_periodo on public.bo_pago_vendedor (vendedor_id, periodo);

create or replace function public.bo_pago_vendedor_transiciones()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'bo_pago_vendedor no se borra' using errcode = '42501';
  end if;
  if old.estado = 'pagado' then
    raise exception 'un pago ya pagado no se modifica' using errcode = '42501';
  end if;
  if old.estado = 'autorizado' and new.estado = 'borrador' then
    raise exception 'un pago autorizado no vuelve a borrador' using errcode = '42501';
  end if;
  if old.estado = 'borrador' and new.estado = 'pagado' then
    raise exception 'un pago no pasa de borrador a pagado sin autorizarse' using errcode = '42501';
  end if;
  if new.vendedor_id <> old.vendedor_id or new.periodo <> old.periodo then
    raise exception 'el vendedor y el periodo de un pago no cambian' using errcode = '42501';
  end if;
  if old.estado = 'autorizado' and (new.monto_autorizado <> old.monto_autorizado or new.cfdi_honorarios_uuid is distinct from old.cfdi_honorarios_uuid) then
    raise exception 'el monto y el CFDI de un pago autorizado no cambian' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists bo_pago_vendedor_transiciones on public.bo_pago_vendedor;
create trigger bo_pago_vendedor_transiciones
  before update or delete on public.bo_pago_vendedor
  for each row execute function public.bo_pago_vendedor_transiciones();

-- Saldo por pagar del vendedor: devengado + clawbacks (negativos) − pagos autorizados o pagados. Puede ser NEGATIVO: se arrastra.
create or replace function public.bo_saldo_comision(p_vendedor uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce((select sum(m.monto) from public.bo_comision_mov m where m.vendedor_id = p_vendedor), 0)
       - coalesce((select sum(p.monto_autorizado) from public.bo_pago_vendedor p where p.vendedor_id = p_vendedor and p.estado in ('autorizado', 'pagado')), 0)
$$;

alter table public.bo_comision_regla enable row level security;
alter table public.bo_comision_mov enable row level security;
alter table public.bo_pago_vendedor enable row level security;
revoke all on table public.bo_comision_regla from public, anon, authenticated;
revoke all on table public.bo_comision_mov from public, anon, authenticated;
revoke all on table public.bo_pago_vendedor from public, anon, authenticated;
revoke execute on function public.bo_saldo_comision(uuid) from public, anon, authenticated;
grant select, insert, update on table public.bo_comision_regla to service_role;
grant select, insert on table public.bo_comision_mov to service_role;
grant select, insert, update on table public.bo_pago_vendedor to service_role;
grant execute on function public.bo_saldo_comision(uuid) to service_role;
revoke update, delete, truncate on table public.bo_comision_mov from service_role;
revoke delete, truncate on table public.bo_pago_vendedor from service_role;

commit;
