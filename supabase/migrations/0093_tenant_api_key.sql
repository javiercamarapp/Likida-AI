-- ═══════════════════════════════════════════════════════════════════════════
-- LLAVES DE API POR FLOTA — lo que hace consumible a /v1 desde un sistema ajeno
--
-- La API v1 quedó escrita el 14-ago-2026 y autentica por COOKIE
-- (`resolverTenantApi` → `getSessionTenant` → `supabaseServer()` → `cookies()`).
-- Eso la vuelve consumible por un navegador con sesión del panel y por nadie
-- más: un TMS headless no tiene cookies. O sea, la cuña enterprise —"no importa
-- qué TMS uses hoy ni dentro de dos años, Likida es una capa encima"— no se
-- podía ni demostrar en una llamada.
--
-- Esta tabla la habilita. El caso concreto: Transportes Innovativos está
-- reescribiendo su TMS (1 a 1.5 años) y necesita leer de Likida desde su propio
-- código.
--
-- ── LA LLAVE EN CLARO NO SE GUARDA. NUNCA. ────────────────────────────────
--
-- Solo su SHA-256. Se enseña UNA vez, al crearla, y si el dueño la pierde se
-- revoca y se emite otra. Guardarla en claro convertiría un volcado de esta
-- tabla —o un `select` de alguien con service role -- en acceso directo a la
-- API de TODAS las flotas. El hash no es reversible y el prefijo alcanza para
-- que una persona identifique cuál es cuál en la lista.
--
-- `prefijo` son los primeros caracteres visibles (p. ej. `lk_live_a1b2…`): sirve
-- para reconocerla en el panel y en los logs sin exponerla. Va indexado porque
-- es por donde se busca al autenticar: se localiza el candidato por prefijo y
-- recién entonces se compara el hash completo.
--
-- ── QUIÉN MANDA: `administra_flota()`, NO `tenant_data()` ─────────────────
--
-- Una llave de API no es un dato de la flota que se consulta: es CONTROL. Con
-- ella se lee todo lo que el área de la llave permita, desde fuera y sin
-- sesión. Por eso el mismo criterio que `rastreo_credencial` (0050): ni el
-- contador ni el encargado la ven o la crean, solo el dueño y el superadmin.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.tenant_api_key (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,

  -- Cómo la llama una persona ("TMS propio", "tablero de Tableau"). Sin esto,
  -- una lista de hashes es indistinguible y nadie se atreve a revocar ninguna.
  nombre        text not null,

  -- Los primeros caracteres, para reconocerla. NO es secreto.
  prefijo       text not null,

  -- SHA-256 en hex de la llave completa. 64 caracteres.
  hash          text not null,

  -- El ÁREA que la llave puede leer, con el mismo vocabulario de
  -- `lib/auth/visibilidad.ts`. Una llave para un tablero de operación no tiene
  -- por qué poder leer el margen de la flota.
  area          text not null default 'operacion',

  creada_en     timestamptz not null default now(),
  creada_por    uuid references public.app_user(id) on delete set null,

  -- Para poder contestar "¿esta llave todavía se usa?" antes de revocarla, y
  -- para detectar una que se filtró y alguien está usando desde otro lado.
  ultimo_uso_en timestamptz,

  -- Revocar NO borra: el renglón queda para la auditoría de qué llave leyó qué.
  revocada_en   timestamptz,

  constraint tenant_api_key_hash_unico unique (hash),
  constraint tenant_api_key_area_dominio check (area in ('operacion', 'dinero', 'administracion')),
  constraint tenant_api_key_nombre_no_vacio check (length(trim(nombre)) > 0),
  -- 64 hex: si alguien intentara escribir la llave en claro aquí, no cabe en la
  -- forma y el insert falla en vez de guardarla.
  constraint tenant_api_key_hash_forma check (hash ~ '^[0-9a-f]{64}$')
);

-- Por donde se busca al autenticar. Parcial sobre las vivas: una llave revocada
-- no debe ni aparecer en el camino caliente.
create index if not exists tenant_api_key_prefijo_vivo
  on public.tenant_api_key (prefijo)
  where revocada_en is null;

create index if not exists tenant_api_key_por_flota
  on public.tenant_api_key (tenant_id, creada_en desc);

alter table public.tenant_api_key enable row level security;

-- CONTROL, no dato: mismo criterio que `rastreo_credencial` (0050).
create policy administra_flota on public.tenant_api_key for all
  using ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin())
  with check ((tenant_id = any(get_user_tenant_ids()) and administra_flota()) or is_superadmin());

comment on table public.tenant_api_key is
  'Llaves de API por flota para /v1. Se guarda SOLO el SHA-256; la llave en claro se enseña una vez al crearla. RLS por administra_flota() porque es control, no dato.';
comment on column public.tenant_api_key.hash is
  'SHA-256 hex de la llave completa. Nunca la llave en claro: un volcado de esta tabla no puede dar acceso.';
comment on column public.tenant_api_key.area is
  'Qué puede leer, con el vocabulario de lib/auth/visibilidad.ts. Una llave de operación no lee el margen.';
comment on column public.tenant_api_key.revocada_en is
  'Revocar no borra el renglón: se conserva para poder auditar qué llave leyó qué.';
