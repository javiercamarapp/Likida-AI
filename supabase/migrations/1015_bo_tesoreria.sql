-- 1015 — Back-office de Likida: tesorería (LOTE C, módulo 3; prioridad baja frente a 1009 y 1010).
--
-- Patrón de caja de RTM (dinero_socios_efectivo): CUENTAS (banco, stripe, caja) y un libro de movimientos de SOLO INSERCIÓN. El saldo de una
-- cuenta es la suma de sus movimientos; no hay saldo tecleado. Un error se corrige con una REVERSA enlazada y con motivo, nunca con UPDATE.
-- Sirve para CONCILIAR: conciliar un gasto o un pago a vendedor exige elegir un movimiento de tesorería o capturar una referencia de banco.
--
-- Esta tabla no sabe de bancos reales: los movimientos los captura un humano mirando su estado de cuenta (no hay conector bancario).
--
-- ADITIVA E IDEMPOTENTE. NO SE APLICA A PRODUCCIÓN SIN AUTORIZACIÓN. Requiere 1009 y 1010 para las dos columnas de enlace.
-- REVERSA (manual):
--   alter table public.bo_pago_vendedor drop column if exists tesoreria_mov_id;
--   alter table public.bo_gasto drop column if exists tesoreria_mov_id;
--   drop function if exists public.bo_tesoreria_saldo(uuid);
--   drop trigger if exists bo_tesoreria_mov_solo_insercion on public.bo_tesoreria_mov;
--   drop trigger if exists bo_tesoreria_mov_sin_truncate on public.bo_tesoreria_mov;
--   drop function if exists public.bo_tesoreria_mov_solo_insercion();
--   drop table if exists public.bo_tesoreria_mov;
--   drop table if exists public.bo_tesoreria_cuenta;
begin;

create table if not exists public.bo_tesoreria_cuenta (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null check (char_length(btrim(nombre)) between 1 and 80),
  tipo      text not null check (tipo in ('banco', 'stripe', 'caja')),
  activa    boolean not null default true,
  creado_en timestamptz not null default now()
);

comment on table public.bo_tesoreria_cuenta is
  '1015: cuentas de dinero de Likida (banco, Stripe, caja). Sin saldo tecleado: el saldo es la suma de bo_tesoreria_mov. Solo service_role.';

create unique index if not exists bo_tesoreria_cuenta_nombre_unico on public.bo_tesoreria_cuenta (lower(btrim(nombre)));

create table if not exists public.bo_tesoreria_mov (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid not null references public.bo_tesoreria_cuenta(id) on delete restrict,
  fecha          date not null,
  concepto       text not null check (concepto in ('saldo_inicial', 'ingreso', 'egreso', 'traspaso', 'ajuste', 'reversa')),
  monto          numeric(12,2) not null check (monto <> 0),
  nota           text check (nota is null or char_length(nota) <= 300),
  ref_tipo       text check (ref_tipo is null or ref_tipo in ('factura_saas', 'bo_gasto', 'bo_pago_vendedor', 'otro')),
  ref_id         uuid,
  clave_idem     text unique check (clave_idem is null or char_length(clave_idem) between 8 and 120),
  reversa_de     uuid unique references public.bo_tesoreria_mov(id) on delete restrict,
  motivo_reversa text,
  creado_por     uuid references public.app_user(id) on delete set null,
  creado_en      timestamptz not null default now(),
  constraint bo_tesoreria_mov_reversa_coherente check (
    (concepto = 'reversa') = (reversa_de is not null)
    and (reversa_de is null) = (motivo_reversa is null)
    and (motivo_reversa is null or char_length(btrim(motivo_reversa)) >= 3)),
  constraint bo_tesoreria_mov_signo check (
    (concepto in ('saldo_inicial', 'ingreso') and monto > 0) or (concepto = 'egreso' and monto < 0) or concepto in ('traspaso', 'ajuste', 'reversa'))
);

comment on table public.bo_tesoreria_mov is
  '1015: libro de movimientos de solo inserción. Saldo = suma. Corrección = reversa enlazada con motivo. Solo service_role.';

create index if not exists bo_tesoreria_mov_cuenta_idx on public.bo_tesoreria_mov (cuenta_id, fecha desc);

create or replace function public.bo_tesoreria_mov_solo_insercion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'bo_tesoreria_mov es de solo inserción (%): se corrige con una reversa enlazada', tg_op using errcode = '42501';
end;
$$;

drop trigger if exists bo_tesoreria_mov_solo_insercion on public.bo_tesoreria_mov;
create trigger bo_tesoreria_mov_solo_insercion
  before update or delete on public.bo_tesoreria_mov
  for each row execute function public.bo_tesoreria_mov_solo_insercion();

drop trigger if exists bo_tesoreria_mov_sin_truncate on public.bo_tesoreria_mov;
create trigger bo_tesoreria_mov_sin_truncate
  before truncate on public.bo_tesoreria_mov
  for each statement execute function public.bo_tesoreria_mov_solo_insercion();

create or replace function public.bo_tesoreria_saldo(p_cuenta uuid default null)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(m.monto), 0) from public.bo_tesoreria_mov m where p_cuenta is null or m.cuenta_id = p_cuenta
$$;

-- Enlace de conciliación: el movimiento de tesorería que respalda un gasto o un pago a vendedor.
alter table public.bo_gasto add column if not exists tesoreria_mov_id uuid references public.bo_tesoreria_mov(id) on delete restrict;
alter table public.bo_pago_vendedor add column if not exists tesoreria_mov_id uuid references public.bo_tesoreria_mov(id) on delete restrict;

alter table public.bo_tesoreria_cuenta enable row level security;
alter table public.bo_tesoreria_mov enable row level security;
revoke all on table public.bo_tesoreria_cuenta from public, anon, authenticated;
revoke all on table public.bo_tesoreria_mov from public, anon, authenticated;
revoke execute on function public.bo_tesoreria_saldo(uuid) from public, anon, authenticated;
grant select, insert, update on table public.bo_tesoreria_cuenta to service_role;
grant select, insert on table public.bo_tesoreria_mov to service_role;
grant execute on function public.bo_tesoreria_saldo(uuid) to service_role;
revoke update, delete, truncate on table public.bo_tesoreria_mov from service_role;

commit;
