-- 0998 — Registro de exportaciones de flota para offboarding (F9, CT-DAT-16).
--
-- Cuando una flota se va (o pide su paquete), el código (src/lib/likida/offboarding/) arma un paquete de archivos con un manifiesto
-- de huellas SHA-256 por archivo. Esta tabla guarda el MANIFIESTO y la huella del manifiesto: así, quien recibe el paquete puede
-- comprobar que no cambió, y Likida puede demostrar qué entregó y cuándo. El paquete en sí NO vive aquí (no se duplican los datos).
--
--   · estado: generado -> entregado -> purgado (solo hacia adelante). Cualquier otro cambio de columna se rechaza.
--   · sin FK a tenant: la constancia debe sobrevivir a que la flota se borre al final del offboarding.
--   · el borrado/anonimización posterior sigue la retención (decisión D7 pendiente): esta migración NO borra ni anonimiza nada.
--
-- Solo service_role. ADITIVA E IDEMPOTENTE.
-- REVERSA (manual):
--   drop table if exists public.tenant_exportacion;
--   drop function if exists public.tenant_exportacion_transicion();
begin;

create table if not exists public.tenant_exportacion (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  solicitado_por uuid not null,
  creado_en      timestamptz not null default now(),
  estado         text not null default 'generado' check (estado in ('generado', 'entregado', 'purgado')),
  entregado_en   timestamptz,
  filas_total    integer not null check (filas_total >= 0),
  manifiesto     jsonb not null check (jsonb_typeof(manifiesto) = 'object'),
  huella_sha256  text not null check (huella_sha256 ~ '^[0-9a-f]{64}$')
);

comment on table public.tenant_exportacion is
  '0998: constancia de exportación de flota (offboarding): manifiesto de huellas SHA-256 y huella del manifiesto. Sin los datos. Solo service_role.';

create index if not exists tenant_exportacion_tenant_idx on public.tenant_exportacion (tenant_id, creado_en desc);

create or replace function public.tenant_exportacion_transicion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
     or new.solicitado_por is distinct from old.solicitado_por or new.creado_en is distinct from old.creado_en
     or new.filas_total is distinct from old.filas_total or new.manifiesto is distinct from old.manifiesto
     or new.huella_sha256 is distinct from old.huella_sha256 then
    raise exception 'tenant_exportacion: solo cambian estado y entregado_en' using errcode = '42501';
  end if;
  if new.estado is distinct from old.estado and not (
       (old.estado = 'generado' and new.estado in ('entregado', 'purgado'))
    or (old.estado = 'entregado' and new.estado = 'purgado')) then
    raise exception 'tenant_exportacion: transicion % -> % no permitida', old.estado, new.estado using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_exportacion_transicion on public.tenant_exportacion;
create trigger tenant_exportacion_transicion
  before update on public.tenant_exportacion
  for each row execute function public.tenant_exportacion_transicion();

alter table public.tenant_exportacion enable row level security;
revoke all on table public.tenant_exportacion from public, anon, authenticated;
grant select, insert, update on table public.tenant_exportacion to service_role;
-- Los privilegios por omision del esquema ya dan todo a service_role: una constancia no se borra.
revoke delete, truncate on table public.tenant_exportacion from service_role;

commit;
