-- 1011 — Back-office propio (LOTE D): contratos y vencimientos de Likida misma.
--
-- Hoy los contratos, suscripciones, dominios y paquetes de creditos de Likida no tienen ningun vigia (el patron de vigencias.ts
-- cubre los papeles de la flota cliente, no los de Likida). Esta tabla es el archivo con vencimiento:
--   · `vence_el` NULL = «sin fecha declarada». Nunca se lee como «vigente» ni como «no vence» (salvo tipo `creditos`, que no expiran).
--   · el estado guardado es solo borrador | vigente | terminado; «por renovar» y «vencido» se CALCULAN con la fecha de hoy (Mexico)
--     en el codigo (src/lib/backoffice/vencimientos.ts), porque un estado guardado envejece sin que nadie lo toque.
--   · terminar exige motivo y congela la fila (un contrato terminado no se edita).
--   · `bo_contrato_aviso` solo registra avisos MOSTRADOS en pantalla (sin envio externo, canal fijo `pantalla`); de solo agregar.
-- Datos de PLATAFORMA (sin tenant_id propio): la columna `tenant_id` es una referencia suelta a la flota cuando el contrato es de un cliente.
-- Solo service_role (RLS sin politicas). No borra nada de ninguna tabla existente. Las migraciones no se aplican a produccion desde aqui.
--
-- ADITIVA E IDEMPOTENTE.
-- REVERSA (manual):
--   drop table if exists public.bo_contrato_aviso;
--   drop table if exists public.bo_contrato;
--   drop function if exists public.bo_contrato_aviso_solo_agregar();
--   drop function if exists public.bo_contrato_congelar_terminado();
begin;

create table if not exists public.bo_contrato (
  id                 uuid primary key default gen_random_uuid(),
  tipo               text not null check (tipo in ('cliente', 'proveedor', 'suscripcion', 'dominio', 'creditos', 'legal_pendiente', 'vendedor', 'otro')),
  contraparte        text not null check (char_length(btrim(contraparte)) between 1 and 200),
  tenant_id          uuid references public.tenant (id) on delete set null,
  descripcion        text check (descripcion is null or char_length(descripcion) <= 1000),
  firmado_el         date,
  vence_el           date,
  renovacion_auto    boolean not null default false,
  dias_aviso         integer[] not null default '{30}'::integer[],
  responsable        text check (responsable is null or char_length(btrim(responsable)) between 1 and 120),
  costo_mensual_mxn  numeric(12, 2) check (costo_mensual_mxn is null or costo_mensual_mxn >= 0),
  documento_url      text check (documento_url is null or (char_length(documento_url) <= 500 and documento_url ~* '^https?://')),
  estado             text not null default 'borrador' check (estado in ('borrador', 'vigente', 'por_renovar', 'vencido', 'terminado')),
  motivo_terminacion text,
  creado_por         uuid,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  constraint bo_contrato_dias_aviso_valido check (
    cardinality(dias_aviso) between 1 and 6
    and array_position(dias_aviso, null) is null
    and 1 <= all (dias_aviso)
    and 365 >= all (dias_aviso)
  ),
  constraint bo_contrato_terminado_con_motivo check (
    (estado = 'terminado') = (motivo_terminacion is not null and char_length(btrim(motivo_terminacion)) >= 5)
  ),
  constraint bo_contrato_fechas_en_orden check (firmado_el is null or vence_el is null or vence_el >= firmado_el)
);

comment on table public.bo_contrato is
  '1011: contratos, suscripciones, dominios y creditos de Likida misma. vence_el null = sin fecha declarada. Estado calculado en codigo. Solo service_role.';
comment on column public.bo_contrato.dias_aviso is
  '1011: ventana propia de la fila, de 1 a 6 valores entre 1 y 365 dias. Rige solo para los tipos sin ventana fija en el codigo (cliente, suscripcion, dominio y documento legal pendiente la traen fija).';
comment on column public.bo_contrato.estado is
  '1011: lo que el codigo escribe es borrador, vigente o terminado. por_renovar y vencido se calculan con la fecha de hoy.';

-- Anti-duplicado: el mismo contrato vivo (tipo, contraparte, fecha de vencimiento) no se da de alta dos veces (doble clic, reintento).
create unique index if not exists bo_contrato_unico_vivo
  on public.bo_contrato (tipo, lower(btrim(contraparte)), coalesce(vence_el, date '9999-12-31'))
  where estado <> 'terminado';
create index if not exists bo_contrato_vence_idx on public.bo_contrato (vence_el) where estado <> 'terminado';
create index if not exists bo_contrato_tenant_idx on public.bo_contrato (tenant_id) where tenant_id is not null;

-- Un contrato terminado no se edita (la huella del motivo queda intacta) y cada edicion actualiza `actualizado_en`.
create or replace function public.bo_contrato_congelar_terminado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado = 'terminado' then
    raise exception 'un contrato terminado no se edita (id %)', old.id using errcode = '42501';
  end if;
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists bo_contrato_congelar_terminado on public.bo_contrato;
create trigger bo_contrato_congelar_terminado
  before update on public.bo_contrato
  for each row execute function public.bo_contrato_congelar_terminado();

alter table public.bo_contrato enable row level security;
revoke all on table public.bo_contrato from public, anon, authenticated;
grant select, insert, update on table public.bo_contrato to service_role;
-- Un contrato no se borra: se termina con motivo.
revoke delete, truncate on table public.bo_contrato from service_role;

-- Avisos mostrados en pantalla (de solo agregar). Sin envio por correo ni WhatsApp hasta que Javier lo autorice.
create table if not exists public.bo_contrato_aviso (
  id          uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.bo_contrato (id) on delete restrict,
  dias_antes  integer not null check (dias_antes between 0 and 365),
  mostrado_en timestamptz not null default now(),
  canal       text not null default 'pantalla' check (canal = 'pantalla'),
  unique (contrato_id, dias_antes)
);

comment on table public.bo_contrato_aviso is
  '1011: avisos de vencimiento MOSTRADOS en pantalla, uno por (contrato, umbral). De solo agregar. No hay envio saliente. Solo service_role.';

create or replace function public.bo_contrato_aviso_solo_agregar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'bo_contrato_aviso es de solo agregar (%)', tg_op using errcode = '42501';
end;
$$;

drop trigger if exists bo_contrato_aviso_solo_agregar on public.bo_contrato_aviso;
create trigger bo_contrato_aviso_solo_agregar
  before update or delete on public.bo_contrato_aviso
  for each row execute function public.bo_contrato_aviso_solo_agregar();

alter table public.bo_contrato_aviso enable row level security;
revoke all on table public.bo_contrato_aviso from public, anon, authenticated;
grant select, insert on table public.bo_contrato_aviso to service_role;
revoke update, delete, truncate on table public.bo_contrato_aviso from service_role;

commit;
