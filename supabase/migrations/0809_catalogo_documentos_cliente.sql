-- ═══════════════════════════════════════════════════════════════════════════
-- 0809 — CONDUCTOR (T-A5-52, R24): el CATÁLOGO de documentos que pide cada cliente al cierre del viaje.
--
-- Cada cliente pide papeles distintos (carta porte firmada y sellada, pedimento, DODA, fitosanitario, tickets de báscula…).
-- Esta tabla guarda, POR FLOTA y POR CLIENTE, qué documentos pide:
--   · `tipo` = 'basico' (sin él no se cierra) o 'complementario' (se pide, pero no frena el cierre).
--   · `requiere_firma` / `requiere_sello`: si el documento debe venir firmado y/o sellado.
--   · Un cliente SIN filas aquí no cambia nada: se sigue pidiendo solo el comprobante de entrega (POD) de siempre.
--   · `nombre` se guarda con espacios simples; el mismo nombre (sin distinguir mayúsculas) no se repite dentro de un cliente.
--   · `cliente_id` va ligado con el tenant (llave compuesta): un documento no puede colgar del cliente de otra flota.
--   · La baja es un DELETE de la fila (el catálogo es configuración, no historial).
--
-- Solo aditiva e idempotente (create … if not exists, drop … if exists). Nace VACÍA: sin catálogos ni datos del cliente.
-- RLS con la misma política de lectura que `ruta_autorizada` (0808); la escritura solo la hace el servidor.
--
-- Reversa manual (no se corre sola):  drop table if exists public.cliente_documento_requerido;
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.cliente_documento_requerido (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  cliente_id uuid not null,
  nombre text not null,
  tipo text not null,
  requiere_firma boolean not null default false,
  requiere_sello boolean not null default false,
  created_at timestamptz not null default now(),
  constraint cliente_documento_requerido_cliente_fkey
    foreign key (cliente_id, tenant_id) references public.cliente (id, tenant_id) on delete cascade,
  constraint cliente_documento_requerido_nombre_largo check (char_length(btrim(nombre)) between 1 and 80),
  constraint cliente_documento_requerido_tipo check (tipo in ('basico', 'complementario'))
);
comment on table public.cliente_documento_requerido is
  '0809: documentos que pide cada cliente al cierre del viaje, basicos o complementarios, con firma y/o sello. Sin filas = solo el POD de siempre. Nace vacia; sin datos del cliente.';

create unique index if not exists cliente_documento_requerido_unico
  on public.cliente_documento_requerido (tenant_id, cliente_id, lower(btrim(nombre)));
create index if not exists cliente_documento_requerido_cliente
  on public.cliente_documento_requerido (tenant_id, cliente_id);

alter table public.cliente_documento_requerido enable row level security;
drop policy if exists tenant_lee on public.cliente_documento_requerido;
create policy tenant_lee on public.cliente_documento_requerido for select
  using (
    (tenant_id = any(public.get_user_tenant_ids()) and (select public.ve_operacion()))
    or (select public.is_superadmin())
  );
revoke all on table public.cliente_documento_requerido from public, anon, authenticated;
grant select on table public.cliente_documento_requerido to authenticated;
grant select, insert, update, delete on table public.cliente_documento_requerido to service_role;
