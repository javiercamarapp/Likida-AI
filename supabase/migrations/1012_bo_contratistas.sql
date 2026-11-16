-- 1012 — Back-office propio (LOTE D): contratistas. Registro LIGERO.
--
-- La nomina se compra (Runa HR u otro), no se construye: aqui NO se calcula, NO se timbra y NO se guarda ningun importe de pago.
-- Solo queda quien trabaja con Likida, bajo que esquema, y si tiene en orden lo que Likida necesita para poder pagarle
-- (RFC, constancia de situacion fiscal, CFDI de honorarios). `cfdi_honorarios_vigente` NULL = sin dato (no se confunde con «vencido»).
-- Solo service_role (RLS sin politicas). No borra nada de ninguna tabla existente.
--
-- ADITIVA E IDEMPOTENTE. Requiere 1011 (bo_contrato).
-- REVERSA (manual):
--   drop table if exists public.bo_contratista;
begin;

create table if not exists public.bo_contratista (
  id                              uuid primary key default gen_random_uuid(),
  nombre                          text not null check (char_length(btrim(nombre)) between 1 and 160),
  rol                             text check (rol is null or char_length(btrim(rol)) between 1 and 120),
  esquema                         text not null check (esquema in ('honorarios', 'comision', 'sueldo_fijo', 'proveedor_nomina')),
  rfc                             text check (rfc is null or (char_length(rfc) in (12, 13) and rfc = upper(rfc))),
  cfdi_honorarios_vigente         boolean,
  constancia_situacion_fiscal_en  date,
  contrato_id                     uuid references public.bo_contrato (id) on delete set null,
  vendedor_id                     uuid references public.app_user (id) on delete set null,
  activo                          boolean not null default true,
  nota                            text check (nota is null or char_length(nota) <= 500),
  creado_por                      uuid,
  creado_en                       timestamptz not null default now()
);

comment on table public.bo_contratista is
  '1012: registro ligero de contratistas. No calcula ni timbra nomina (se compra). cfdi_honorarios_vigente null = sin dato. Solo service_role.';

-- Anti-duplicado: la misma persona activa con el mismo esquema no se da de alta dos veces.
create unique index if not exists bo_contratista_unico_activo
  on public.bo_contratista (lower(btrim(nombre)), esquema)
  where activo;
create index if not exists bo_contratista_contrato_idx on public.bo_contratista (contrato_id) where contrato_id is not null;

alter table public.bo_contratista enable row level security;
revoke all on table public.bo_contratista from public, anon, authenticated;
grant select, insert, update on table public.bo_contratista to service_role;
-- Un contratista no se borra: se desactiva.
revoke delete, truncate on table public.bo_contratista from service_role;

commit;
