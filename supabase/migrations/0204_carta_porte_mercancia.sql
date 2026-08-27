-- ═══════════════════════════════════════════════════════════════════════════
-- 0204 — AGENTE DE CARTA PORTE, Fases B-C (blueprint 20-Agente-Carta-Porte).
--
-- El hueco H2 del blueprint: 15 de los 19 campos del CLIENTE en el checklist
-- CCP tenían `fuente: null` porque la mercancía no se capturaba en ninguna
-- pantalla. Sin mercancía no hay borrador, y sin borrador el validador de
-- rechazo seguro del PAC (`validarComplemento`, que existe desde antes) no
-- tiene nada que validar.
--
-- Dos piezas:
--   1. Columnas CCP del viaje — los datos del cliente que viven una vez por
--      viaje (CPs y estados de origen/destino, RFC del destinatario, si el
--      transporte es internacional). Nullable todas: la ausencia es un estado
--      del checklist, no un error.
--   2. `viaje_mercancia` — una fila por mercancía del viaje (el complemento
--      exige el detalle POR mercancía: clave, descripción, cantidad, unidad,
--      peso). `material_peligroso` NULL = no declarado (mismo contrato que
--      `incidencia.hay_lesionados`): un false por default afirmaría "no es
--      peligroso" sin que nadie lo dijera, y esa afirmación decide si el
--      complemento exige AseguraMedAmbiente.
--
-- Y la fila del catálogo: el agente de Carta Porte entra a `agente_definicion`
-- como agente de PRODUCTO vivo — el séptimo.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.viaje
  add column if not exists ccp_origen_cp        text,
  add column if not exists ccp_destino_cp       text,
  add column if not exists ccp_origen_estado    text,
  add column if not exists ccp_destino_estado   text,
  add column if not exists ccp_rfc_destinatario text,
  add column if not exists ccp_transp_internac  boolean;

-- Formato, no catálogo (el criterio de la 0025 con forma_pago): un CP son 5
-- dígitos y un RFC 12-13 caracteres del alfabeto del SAT. Validar contra el
-- catálogo completo de CPs rechazaría capturas legítimas por un catálogo
-- desactualizado — el PAC es quien valida contra catálogo al timbrar.
alter table public.viaje
  add constraint viaje_ccp_origen_cp_formato
  check (ccp_origen_cp is null or ccp_origen_cp ~ '^[0-9]{5}$');
alter table public.viaje
  add constraint viaje_ccp_destino_cp_formato
  check (ccp_destino_cp is null or ccp_destino_cp ~ '^[0-9]{5}$');
alter table public.viaje
  add constraint viaje_ccp_rfc_destinatario_formato
  check (ccp_rfc_destinatario is null or ccp_rfc_destinatario ~ '^[A-ZÑ&0-9]{12,13}$');

comment on column public.viaje.ccp_transp_internac is
  'NULL = no declarado. El checklist lo pide; nunca se rellena "Nacional" por default — es un dato del cliente (Apéndice 3), no una suposición del software.';

-- ── La mercancía, una fila por renglón del complemento ─────────────────────
create table if not exists public.viaje_mercancia (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenant(id) on delete cascade,
  viaje_id           uuid not null,
  descripcion        text not null,
  -- Clave c_ClaveProdServCP (catálogo PROPIO de la Carta Porte, no el
  -- c_ClaveProdServ del CFDI). Formato 8 dígitos; el catálogo completo lo
  -- valida el PAC — aquí formato, y NULL = el cliente aún no la da.
  bienes_transp      text,
  cantidad           numeric(14,3) not null,
  clave_unidad       text,
  peso_kg            numeric(14,3),
  material_peligroso boolean,
  created_at         timestamptz not null default now(),
  constraint viaje_mercancia_cantidad_positiva check (cantidad > 0),
  constraint viaje_mercancia_peso_positivo check (peso_kg is null or peso_kg > 0),
  constraint viaje_mercancia_clave_formato check (bienes_transp is null or bienes_transp ~ '^[0-9]{8}$'),
  -- La FK COMPUESTA de la casa (0028/0145): un autenticado de la flota A no
  -- puede colgar mercancía del viaje de la flota B. `viaje` trae su
  -- unique (id, tenant_id) desde la 0028.
  constraint viaje_mercancia_viaje_tenant_fkey
    foreign key (viaje_id, tenant_id) references public.viaje (id, tenant_id)
    on delete cascade
);

create index if not exists viaje_mercancia_viaje_idx
  on public.viaje_mercancia (tenant_id, viaje_id);

comment on table public.viaje_mercancia is
  'Renglones de mercancía del complemento Carta Porte, por viaje (Apéndice 3: son datos del CLIENTE — la regla 2.7.7.1.1 limita la responsabilidad de cada parte a los datos que aportó). El único escritor es carta_porte_datos.ts, con bitácora.';

-- Mismo doble candado que 0196/0198/0199: RLS deny-all + sin grants directos.
alter table public.viaje_mercancia enable row level security;
revoke all on public.viaje_mercancia from public, anon, authenticated;
grant select, insert, update, delete on public.viaje_mercancia to service_role;

-- ── El séptimo agente de producto ──────────────────────────────────────────
insert into public.agente_definicion (id, nombre, departamento, disparador, estado, descripcion) values
  ('carta_porte', 'Agente de Carta Porte', 'producto', 'whatsapp', 'vivo',
   'Al despachar, decide con fundamento si el viaje necesita el complemento (árbol 2.7.7.2.1/2.7.7.2.8), pide las declaraciones por WhatsApp con botones, y arma el borrador validado contra el rechazo seguro del PAC. Jamás timbra (0049) ni afirma "no necesitas" sin la declaración firmada de la flota.')
on conflict (id) do nothing;

-- ── Notificaciones: la misma mudanza CHECK → FK que la 0116 hizo con las
-- corridas. Los CHECKs anónimos de la 0097 siguen enumerando a los seis
-- agentes originales; con la fila de arriba sembrada, la FK deja entrar a
-- carta_porte (y a cualquier agente futuro DECLARADO) sin otra migración.
alter table public.agente_notificacion_config
  drop constraint agente_notificacion_config_agente_check;
alter table public.agente_notificacion_config
  add constraint agente_notificacion_config_agente_fk
    foreign key (agente) references public.agente_definicion(id);
alter table public.agente_notificacion_estado
  drop constraint agente_notificacion_estado_agente_check;
alter table public.agente_notificacion_estado
  add constraint agente_notificacion_estado_agente_fk
    foreign key (agente) references public.agente_definicion(id);
