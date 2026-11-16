-- 1009 — Back-office de Likida: gastos propios y proveedores (LOTE C, módulo 1).
--
-- Los gastos de LIKIDA como empresa (Vercel, Supabase, Resend, Claude Code, Facturapi, Mifiel, WhatsApp…), no los de una flota cliente.
-- Datos de PLATAFORMA: sin tenant_id. RLS habilitada SIN políticas y sin privilegios para anon/authenticated: solo service_role desde el
-- servidor, tras requireSuperadmin().
--
--   · bo_proveedor: catálogo ligero; nombre único sin importar mayúsculas.
--   · bo_gasto: UN hecho de dinero, escrito una vez. Moneda USD exige tipo de cambio (uno por mes, capturado a mano). Un hecho NO se edita:
--     solo se concilia (una vez, con referencia de banco), se le fija la cuenta/«deducible en forma» o se ANULA (una vez, con motivo). Todo lo
--     demás lo rechaza el disparador; DELETE también. Anti-duplicado por UUID del CFDI y por llave compuesta (solo entre gastos no anulados).
--   · clave_idem: repetir la misma operación (doble clic, reintento) no duplica.
--
-- Mientras Likida no tenga RFC propio, «deducible_en_forma» queda en 'no_evaluable'; el código jamás lo rellena por comodidad.
--
-- ADITIVA E IDEMPOTENTE. NO SE APLICA A PRODUCCIÓN SIN AUTORIZACIÓN.
-- REVERSA (manual):
--   drop trigger if exists bo_gasto_hecho_inmutable on public.bo_gasto;
--   drop function if exists public.bo_gasto_hecho_inmutable();
--   drop table if exists public.bo_gasto;
--   drop table if exists public.bo_proveedor;
begin;

create table if not exists public.bo_proveedor (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null check (char_length(btrim(nombre)) between 1 and 120),
  rfc           text check (rfc is null or char_length(rfc) in (12, 13)),
  categoria     text not null default 'otro'
                check (categoria in ('infraestructura', 'ia_modelos', 'correo_observabilidad', 'legal_firma', 'whatsapp', 'otro')),
  cuenta_contable text,
  cadencia      text not null default 'mensual' check (cadencia in ('mensual', 'anual', 'por_uso')),
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);

comment on table public.bo_proveedor is
  '1009: proveedores de Likida como empresa (no de una flota). Nombre único sin importar mayúsculas. Solo service_role.';

create unique index if not exists bo_proveedor_nombre_unico on public.bo_proveedor (lower(btrim(nombre)));

create table if not exists public.bo_gasto (
  id               uuid primary key default gen_random_uuid(),
  proveedor_id     uuid references public.bo_proveedor(id) on delete restrict,
  fecha            date not null,
  periodo          date not null,
  concepto         text not null check (char_length(btrim(concepto)) between 1 and 200),
  moneda           text not null default 'MXN' check (moneda in ('MXN', 'USD')),
  monto_original   numeric(12,2) not null check (monto_original >= 0),
  tipo_cambio      numeric(10,4) check (tipo_cambio is null or tipo_cambio > 0),
  subtotal_mxn     numeric(12,2) check (subtotal_mxn is null or subtotal_mxn >= 0),
  iva_acreditable_mxn numeric(12,2) check (iva_acreditable_mxn is null or iva_acreditable_mxn >= 0),
  total_mxn        numeric(12,2) not null check (total_mxn >= 0),
  cfdi_uuid        text check (cfdi_uuid is null or cfdi_uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  comprobante_estado text not null default 'sin_comprobante'
                   check (comprobante_estado in ('sin_comprobante', 'cfdi', 'invoice_extranjero')),
  deducible_en_forma text not null default 'no_evaluable' check (deducible_en_forma in ('si', 'no', 'no_evaluable')),
  cuenta_contable  text,
  conciliado_en    timestamptz,
  conciliado_por   uuid references public.app_user(id) on delete set null,
  referencia_banco text,
  anulado_en       timestamptz,
  anulado_por      uuid references public.app_user(id) on delete set null,
  motivo_anulacion text,
  clave_idem       text unique check (clave_idem is null or char_length(clave_idem) between 8 and 120),
  creado_por       uuid references public.app_user(id) on delete set null,
  creado_en        timestamptz not null default now(),
  constraint bo_gasto_periodo_es_mes_de_fecha check (periodo = date_trunc('month', fecha::timestamp)::date),
  constraint bo_gasto_usd_con_tipo_de_cambio check (moneda = 'MXN' or tipo_cambio is not null),
  constraint bo_gasto_desglose_cuadra check (
    subtotal_mxn is null or iva_acreditable_mxn is null or abs(subtotal_mxn + iva_acreditable_mxn - total_mxn) <= 0.01),
  constraint bo_gasto_cfdi_coherente check ((comprobante_estado = 'cfdi') = (cfdi_uuid is not null)),
  -- Patrón factura_saas_conciliacion_coherente: quién y cuándo van juntos, y «conciliado» sin referencia de banco no existe.
  constraint bo_gasto_conciliacion_coherente check (
    (conciliado_en is null) = (conciliado_por is null)
    and (conciliado_en is null or char_length(btrim(coalesce(referencia_banco, ''))) >= 3)
    and (referencia_banco is null or conciliado_en is not null)),
  constraint bo_gasto_anulacion_coherente check (
    (anulado_en is null) = (anulado_por is null)
    and (anulado_en is null) = (motivo_anulacion is null)
    and (motivo_anulacion is null or char_length(btrim(motivo_anulacion)) >= 3))
);

comment on table public.bo_gasto is
  '1009: gastos propios de Likida. Hecho de dinero de una sola escritura: solo se concilia (una vez, con referencia de banco), se fija su cuenta/deducibilidad o se anula (una vez, con motivo). Nunca DELETE. Solo service_role.';
comment on column public.bo_gasto.deducible_en_forma is
  'no_evaluable mientras Likida no tenga RFC propio (bo_entidad.rfc null). Nunca se rellena por comodidad; la deducibilidad de fondo es del contador.';
comment on column public.bo_gasto.tipo_cambio is
  'Pesos por dólar del mes, capturado a mano. Obligatorio si la moneda es USD.';

-- Anti-duplicado: el mismo UUID de CFDI no entra dos veces, ni la misma llave compuesta (solo entre gastos vivos: uno anulado libera la llave).
create unique index if not exists bo_gasto_cfdi_uuid_unico
  on public.bo_gasto (lower(cfdi_uuid)) where cfdi_uuid is not null and anulado_en is null;
create unique index if not exists bo_gasto_llave_compuesta
  on public.bo_gasto (proveedor_id, fecha, total_mxn, lower(btrim(concepto))) where proveedor_id is not null and anulado_en is null;
create index if not exists bo_gasto_periodo_idx on public.bo_gasto (periodo desc, fecha desc);
create index if not exists bo_gasto_proveedor_idx on public.bo_gasto (proveedor_id, periodo desc);

create or replace function public.bo_gasto_hecho_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_libres text[] := array['conciliado_en', 'conciliado_por', 'referencia_banco', 'tesoreria_mov_id',
                           'anulado_en', 'anulado_por', 'motivo_anulacion', 'deducible_en_forma', 'cuenta_contable'];
begin
  if tg_op = 'DELETE' then
    raise exception 'bo_gasto es un hecho de dinero: no se borra, se anula con motivo' using errcode = '42501';
  end if;
  if (to_jsonb(new) - v_libres) is distinct from (to_jsonb(old) - v_libres) then
    raise exception 'bo_gasto es de una sola escritura: solo se concilia, se clasifica o se anula' using errcode = '42501';
  end if;
  if old.conciliado_en is not null and new.conciliado_en is distinct from old.conciliado_en then
    raise exception 'el gasto ya estaba conciliado' using errcode = '42501';
  end if;
  if old.anulado_en is not null and new.anulado_en is distinct from old.anulado_en then
    raise exception 'el gasto ya estaba anulado' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists bo_gasto_hecho_inmutable on public.bo_gasto;
create trigger bo_gasto_hecho_inmutable
  before update or delete on public.bo_gasto
  for each row execute function public.bo_gasto_hecho_inmutable();

alter table public.bo_proveedor enable row level security;
alter table public.bo_gasto enable row level security;
revoke all on table public.bo_proveedor from public, anon, authenticated;
revoke all on table public.bo_gasto from public, anon, authenticated;
grant select, insert, update on table public.bo_proveedor to service_role;
grant select, insert, update on table public.bo_gasto to service_role;
revoke delete, truncate on table public.bo_gasto from service_role;

commit;
