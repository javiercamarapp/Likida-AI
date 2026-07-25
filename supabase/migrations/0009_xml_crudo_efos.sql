-- 1.8: conservar el XML CRUDO del CFDI (CFF art. 30, 5 años) — además es la
-- fuente para re-correr reglas nuevas sobre datos históricos. 1.9: marca de EFOS
-- no concluyente (código ≠ 200/201 y ≠ conocido) → bandeja de revisión.

create table if not exists cfdi_xml (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  gasto_id uuid references gasto(id) on delete set null,
  cfdi_uuid text not null,
  xml text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, cfdi_uuid)
);
alter table cfdi_xml enable row level security;
create policy tenant_data on cfdi_xml for all
  using (tenant_id = any(get_user_tenant_ids()) or is_superadmin())
  with check (tenant_id = any(get_user_tenant_ids()) or is_superadmin());

alter table gasto add column if not exists efos_revisar boolean; -- SAT: código EFOS no concluyente
