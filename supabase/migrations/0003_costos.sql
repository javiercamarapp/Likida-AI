-- ═══════════════════════════════════════════════════════════════════════════
-- Costo real de AI por liquidación. Una fila por LLAMADA al modelo (OCR de cada
-- comprobante, razonamiento del cuadre, escalación a Opus, chat). Agrupable por
-- liquidación (vía viaje_id) y por tenant → margen real por cliente.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists llm_costo (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  viaje_id uuid references viaje(id) on delete set null,       -- = 1 liquidación
  liquidacion_id uuid references liquidacion(id) on delete set null,
  fase text not null,            -- ocr | cuadre | escalacion | chat | router
  modelo text not null,          -- slug de OpenRouter usado realmente
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  costo_usd numeric(10,6) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_costo_tenant on llm_costo(tenant_id, created_at desc);
create index if not exists idx_costo_viaje on llm_costo(viaje_id);

alter table llm_costo enable row level security;
create policy tenant_data on llm_costo for all
  using (tenant_id = any(get_user_tenant_ids()) or is_superadmin())
  with check (tenant_id = any(get_user_tenant_ids()) or is_superadmin());
