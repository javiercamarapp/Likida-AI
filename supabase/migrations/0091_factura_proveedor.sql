-- ═══════════════════════════════════════════════════════════════════════════
-- 0091 — Facturas de PROVEEDOR (14-ago-2026, F6 del plan).
--
-- El tercer agente que pidió Transportes Innovativos: la factura del taller,
-- la refaccionaria o el proveedor de diésel que hoy alguien captura A MANO
-- en el ERP. Aquí aterriza el XML (dato duro del CFDI, sin OCR), un humano
-- la aprueba o rechaza (LFPDPPP 26-II: el agente prepara y marca, la
-- persona decide), y lo aprobado sale en un layout importable al ERP.
--
-- El XML crudo se guarda AQUÍ y no en cfdi_xml a propósito: esa tabla es
-- del ciclo de GASTOS de viaje (sus líneas de consolidado, su gasto_id) y
-- colgarle facturas de proveedor mezclaría dos ciclos con reglas distintas.
--
-- unique(tenant_id, cfdi_uuid) = el dedup ES de la base: la misma factura
-- subida dos veces (o por dos personas) choca ahí, no en una regla de UI.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.factura_proveedor (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant(id) on delete cascade,
  cfdi_uuid text not null,
  emisor_rfc text,
  emisor_nombre text,
  receptor_rfc text,
  -- ¿El receptor del CFDI es el RFC de la flota? Se calcula al ingerir y se
  -- GUARDA: si los datos fiscales del tenant cambian después, esta bandera
  -- sigue diciendo la verdad de lo que se validó ese día.
  receptor_es_flota boolean,
  fecha date,
  sub_total numeric(12,2),
  iva numeric(12,2),
  total numeric(12,2) not null,
  descripcion text,
  conceptos smallint not null default 1,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aprobada', 'rechazada')),
  decidido_por text,
  decidido_en timestamptz,
  xml_crudo text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, cfdi_uuid)
);

comment on table public.factura_proveedor is
  'Facturas de proveedor (F6): XML ingerido, cola de aprobación humana, export a ERP. Ciclo aparte del gasto de viaje.';

create index idx_factura_proveedor_cola
  on public.factura_proveedor (tenant_id, estado, created_at desc);

alter table public.factura_proveedor enable row level security;
