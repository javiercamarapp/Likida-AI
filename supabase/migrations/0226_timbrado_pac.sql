-- ═══════════════════════════════════════════════════════════════════════════
-- 0226 — EL TIMBRADO VÍA PAC (A21, decisión de Javier del 27-ago-2026:
-- "sí al PAC").
--
-- La Fase D de Carta Porte cerró primero por la vía export (0214): el XML
-- validado se descargaba para timbrar en el facturador de la flota. Hoy la
-- decisión cambió el candado histórico: Likida SÍ timbra — por API de un PAC,
-- cuando la flota lo tenga configurado, y SIEMPRE con un humano apretando el
-- botón (el agente prepara, el humano timbra — la regla de la casa no cambió;
-- lo que cambió es quién transporta el XML al SAT).
--
-- Proveedor 1: SW Sapien (sw.com.mx) por su servicio `issue`: recibe el CFDI
-- SIN sellar (Sello/NoCertificado/Certificado ausentes) y el PAC lo SELLA con
-- el CSD que la flota cargó en SU bóveda, y lo timbra — Likida jamás guarda
-- la llave privada del cliente (la alternativa, sellar aquí, exigiría
-- custodiar el CSD y su contraseña: más superficie para el mismo timbre).
--
-- Tres piezas:
--   1. `flota_fiscal` — el perfil del EMISOR que el CFDI completo exige y que
--      la vía export dejaba al facturador: RFC, razón social, régimen, CP de
--      expedición. TODO anulable: NULL = sin capturar y el flujo lo dice —
--      sin perfil no se arma CFDI timbrable (fail-closed), jamás se supone.
--      `modo` decide contra qué ambiente del PAC va ESTA flota (sandbox
--      mientras prueba, produccion cuando su CSD esté en la bóveda real).
--   2. `cliente` gana los datos fiscales del RECEPTOR que el CFDI 4.0 exige
--      (nombre de la constancia, régimen, uso CFDI, CP fiscal) — hoy solo
--      tenía nombre comercial y RFC. Anulables: cada hueco es un faltante
--      declarado del flujo de timbre.
--   3. `ccp_timbre` — el timbre como HECHO citable: uuid fiscal, fecha, sello
--      SAT y el XML timbrado tal cual regresó del PAC. UN timbre vigente por
--      viaje (unique parcial): el doble clic y la carrera de dos pestañas los
--      resuelve la base, no un `if` (estándar §7). El XML vive en la fila por
--      la misma razón que `cfdi_xml` (repo.ts): es el comprobante, no un
--      adjunto — y pesa KBs, no MBs.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. El perfil fiscal del emisor ─────────────────────────────────────────
create table if not exists public.flota_fiscal (
  -- Una fila por flota: el perfil ES de la flota (PK = tenant).
  tenant_id        uuid primary key references public.tenant(id) on delete cascade,
  rfc              text,
  razon_social     text,
  -- Clave del catálogo c_RegimenFiscal (601, 626…). Formato aquí; el catálogo
  -- completo lo valida el PAC al timbrar (criterio de la 0204 con los CPs).
  regimen_fiscal   text,
  -- CP del domicilio fiscal del emisor = LugarExpedicion del CFDI.
  lugar_expedicion text,
  serie            text,
  -- Contra qué ambiente del PAC timbra esta flota. Arranca en sandbox a
  -- propósito: pasar a produccion es un acto deliberado (CSD real en la
  -- bóveda del PAC + contrato), no un default.
  modo             text not null default 'sandbox'
    constraint flota_fiscal_modo_dominio check (modo in ('sandbox', 'produccion')),
  actualizado_en   timestamptz not null default now(),
  -- Quién declaró; se conserva aunque la cuenta se borre (patrón 0207/0213).
  actualizado_por  uuid references public.app_user(id) on delete set null,
  constraint flota_fiscal_rfc_forma
    check (rfc is null or rfc ~ '^[A-ZÑ&0-9]{12,13}$'),
  constraint flota_fiscal_regimen_forma
    check (regimen_fiscal is null or regimen_fiscal ~ '^[0-9]{3}$'),
  constraint flota_fiscal_cp_forma
    check (lugar_expedicion is null or lugar_expedicion ~ '^[0-9]{5}$'),
  constraint flota_fiscal_serie_forma
    check (serie is null or length(btrim(serie)) between 1 and 25)
);

comment on table public.flota_fiscal is
  'El perfil del EMISOR para timbrar (0226): RFC, razón social, régimen y CP de expedición — lo que la vía export (0214) dejaba al facturador. NULL = sin capturar: el flujo de timbre lo lista como faltante, jamás lo supone. El único escritor es carta_porte_timbre.ts, con bitácora.';
comment on column public.flota_fiscal.modo is
  'sandbox = timbres de prueba contra el ambiente de pruebas del PAC (no amparan nada); produccion = timbres fiscales reales. Cambiarlo es un acto declarado del contador/admin.';

-- Mismo doble candado que 0196/0198/0217: RLS deny-all + solo service_role.
alter table public.flota_fiscal enable row level security;
revoke all on table public.flota_fiscal from public, anon, authenticated;
grant select, insert, update, delete on table public.flota_fiscal to service_role;

-- ── 2. El receptor fiscal ──────────────────────────────────────────────────
-- El CFDI 4.0 exige del receptor exactamente esto (y el SAT lo cruza contra
-- la constancia): nombre fiscal, régimen, uso y CP. Sin alguno, el timbre
-- rebota en el PAC — por eso son faltantes declarados ANTES de llamar.
alter table public.cliente
  add column if not exists razon_social   text,
  add column if not exists regimen_fiscal text,
  add column if not exists uso_cfdi       text,
  add column if not exists cp_fiscal      text;

alter table public.cliente
  add constraint cliente_regimen_forma
  check (regimen_fiscal is null or regimen_fiscal ~ '^[0-9]{3}$');
alter table public.cliente
  add constraint cliente_uso_cfdi_forma
  check (uso_cfdi is null or uso_cfdi ~ '^[A-Z]{1}[0-9]{2}$');
alter table public.cliente
  add constraint cliente_cp_fiscal_forma
  check (cp_fiscal is null or cp_fiscal ~ '^[0-9]{5}$');

comment on column public.cliente.razon_social is
  'El nombre EXACTO de la constancia fiscal del cliente (el SAT lo valida al timbrar). NULL = sin capturar; el nombre comercial (`nombre`) NO lo sustituye — un nombre casi-igual rebota el timbre.';
comment on column public.cliente.uso_cfdi is
  'Clave c_UsoCFDI que el cliente pide (S01, G03…). NULL = sin capturar — se pregunta al cliente, no se supone.';

-- ── 3. El timbre, como hecho ───────────────────────────────────────────────
create table if not exists public.ccp_timbre (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  viaje_id      uuid not null,
  uuid_fiscal   text not null,
  estado        text not null default 'vigente'
    constraint ccp_timbre_estado_dominio check (estado in ('vigente', 'cancelado')),
  proveedor     text not null,
  -- En qué ambiente se timbró. Un timbre sandbox NO ampara nada y la pantalla
  -- lo dice — guardarlo permite probar el circuito completo sin mentir.
  modo          text not null
    constraint ccp_timbre_modo_dominio check (modo in ('sandbox', 'produccion')),
  fecha_timbrado     timestamptz not null,
  sello_sat          text,
  no_certificado_sat text,
  -- El XML timbrado TAL CUAL regresó del PAC — el comprobante citable.
  xml           text not null,
  -- Quién apretó el botón. Jamás automático (la regla no cambió).
  timbrado_por  uuid references public.app_user(id) on delete set null,
  creado_en     timestamptz not null default now(),
  constraint ccp_timbre_uuid_forma
    check (uuid_fiscal ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint ccp_timbre_xml_no_vacio check (length(xml) > 0),
  -- La FK COMPUESTA de la casa (0028/0145): el timbre de la flota A no puede
  -- colgarse de un viaje de la flota B.
  constraint ccp_timbre_viaje_tenant_fkey
    foreign key (viaje_id, tenant_id) references public.viaje (id, tenant_id)
    on delete cascade
);

-- UN timbre vigente por viaje: la carrera de dos botones la gana exactamente
-- uno; cancelar (estado != vigente) libera para re-timbrar la corrección.
create unique index if not exists ccp_timbre_vigente_unico
  on public.ccp_timbre (tenant_id, viaje_id)
  where estado = 'vigente';

-- El mismo uuid fiscal no entra dos veces en la misma flota (idempotencia
-- contra el reintento de un timbre que el PAC ya había aceptado).
create unique index if not exists ccp_timbre_uuid_unico
  on public.ccp_timbre (tenant_id, lower(uuid_fiscal));

comment on table public.ccp_timbre is
  'El timbre del CFDI con complemento Carta Porte (0226): uuid fiscal, fecha, sello SAT y el XML timbrado tal cual. UN timbre vigente por viaje (unique parcial — la carrera la resuelve la base). El único escritor es carta_porte_timbre.ts; lo dispara un humano, jamás un cron.';

alter table public.ccp_timbre enable row level security;
revoke all on table public.ccp_timbre from public, anon, authenticated;
grant select, insert, update, delete on table public.ccp_timbre to service_role;
