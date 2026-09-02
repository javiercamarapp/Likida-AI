-- ═══════════════════════════════════════════════════════════════════════════
-- 0260 — EL ESTACIONAMIENTO OAUTH DEL SERVIDOR MCP.
--
-- Likida expone un servidor MCP (/api/mcp) para que el contador o el jefe de
-- flota le pregunte a SUS datos desde Claude o ChatGPT. Esos clientes se
-- autorizan por OAuth 2.1 contra la identidad que YA existe (Supabase Auth +
-- app_user): el usuario inicia sesión en el panel, consiente, y el servidor
-- emite tokens propios. Estas tres tablas son la memoria de ese flujo.
--
-- ── LO QUE NUNCA SE GUARDA AQUÍ ──────────────────────────────────────────
--
-- Ni un token en claro, ni un código en claro. Igual que `tenant_api_key`
-- (0093): se guarda el SHA-256 con un CHECK que exige 64 hex, así que si
-- alguien intentara escribir el secreto en claro el insert FALLA en vez de
-- guardarlo. Un volcado de estas tablas no da acceso a nada.
--
-- ── POR QUÉ CADA TOKEN LLEVA tenant_id Y rol PEGADOS ─────────────────────
--
-- La regla del servidor MCP es «cada sesión atada a UN tenant y UN usuario».
-- El token no es una llave global que luego se resuelve: nace con su flota y
-- su rol congelados al momento del consentimiento. Si el usuario cambia de
-- rol después, los tokens viejos siguen diciendo el rol con el que se
-- consintió — y expiran solos (acceso: horas; refresco: días).
--
-- ── clientes DCR ─────────────────────────────────────────────────────────
--
-- Claude y ChatGPT se registran solos (RFC 7591, Dynamic Client
-- Registration). Un cliente registrado NO es una credencial: es un par
-- (id, redirect_uris) que acota A DÓNDE se puede mandar un código. La
-- seguridad real está en PKCE (S256, obligatorio) y en el consentimiento
-- con sesión del panel. El registro abierto se acota por tasa en el código.
--
-- Va en EXENTAS-de-bloque parcial: la capa 1 de la batería ya barre RLS y
-- grants de TODO el catálogo. El bloque de verificaciones.sql demuestra
-- lo que solo la base puede demostrar: que el CHECK de 64 hex rechaza un
-- secreto en claro y que un código no se puede marcar usado dos veces.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── El cliente OAuth (Claude, ChatGPT, u otro cliente MCP) ─────────────────

create table if not exists public.mcp_oauth_cliente (
  id            uuid primary key default gen_random_uuid(),
  -- Cómo se presentó el cliente al registrarse ("Claude", "ChatGPT"…). Es
  -- INFORMATIVO: se enseña en la pantalla de consentimiento con la advertencia
  -- de que el nombre lo eligió quien se registró, no nosotros.
  nombre        text
    constraint mcp_oauth_cliente_nombre_forma check (nombre is null or length(nombre) between 1 and 120),
  -- Las redirect_uris EXACTAS que el cliente declaró. El endpoint de
  -- autorización solo redirige a una de éstas, comparada carácter por
  -- carácter — es el candado contra el open redirect.
  redirect_uris jsonb not null,
  creado_en     timestamptz not null default now(),
  -- Para poder barrer registros que nunca se usaron (un escáner que se
  -- registra y se va deja basura; esto permite podarla con criterio).
  ultimo_uso_en timestamptz
);

comment on table public.mcp_oauth_cliente is
  'Clientes OAuth del servidor MCP (0260), registrados por DCR (RFC 7591). No guarda secretos: son clientes públicos con PKCE obligatorio. El único escritor es /api/mcp/oauth/registro.';

alter table public.mcp_oauth_cliente enable row level security;
revoke all on table public.mcp_oauth_cliente from public, anon, authenticated;
grant select, insert, update on table public.mcp_oauth_cliente to service_role;

-- ── El código de autorización (vive minutos, se usa UNA vez) ───────────────

create table if not exists public.mcp_oauth_codigo (
  id             uuid primary key default gen_random_uuid(),
  -- SHA-256 del código, jamás el código. El CHECK hace imposible guardarlo
  -- en claro: un código real no tiene la forma de 64 hex.
  codigo_hash    text not null unique
    constraint mcp_oauth_codigo_hash_forma check (codigo_hash ~ '^[0-9a-f]{64}$'),
  cliente_id     uuid not null references public.mcp_oauth_cliente(id) on delete cascade,
  -- La identidad que consintió, congelada en este instante. `user_email` va
  -- desnormalizado a propósito: es la firma que la bitácora necesita en cada
  -- consulta MCP, y resolverla contra auth.users en cada petición sería un
  -- viaje extra al camino caliente.
  user_id        uuid not null references public.app_user(id) on delete cascade,
  user_email     text,
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  rol            text not null,
  -- A dónde se mandó el código. El endpoint de token exige que la vuelta
  -- traiga EXACTAMENTE esta URI (RFC 6749 §4.1.3) — sin esto, un código
  -- robado en tránsito se canjearía desde cualquier parte.
  redirect_uri   text not null,
  -- PKCE S256, obligatorio. Se guarda el challenge; el verifier solo lo
  -- conoce el cliente y viaja en el canje.
  code_challenge text not null
    constraint mcp_oauth_codigo_challenge_forma check (length(code_challenge) between 43 and 128),
  scope          text,
  -- RFC 8707: a qué recurso pidió el cliente que sirviera el token. Hoy solo
  -- hay uno (/api/mcp); se guarda para poder negarse si un día hay dos.
  resource       text,
  -- La familia que heredarán los tokens canjeados de este código. Nace aquí
  -- para que el REUSO del código pueda revocar lo ya emitido: sin ella, un
  -- código robado y canjeado dos veces dejaría viva la primera emisión.
  familia        uuid not null,
  creado_en      timestamptz not null default now(),
  expira_en      timestamptz not null,
  -- UNA sola vez: el canje marca `usado_en` con un UPDATE condicionado a que
  -- siga null. Un segundo canje del mismo código no encuentra fila que
  -- actualizar y se niega — y además revoca la familia emitida (RFC 6749
  -- §4.1.2: el reuso de un código es señal de robo).
  usado_en       timestamptz
);

create index if not exists mcp_oauth_codigo_expira_idx
  on public.mcp_oauth_codigo (expira_en);

comment on table public.mcp_oauth_codigo is
  'Códigos de autorización OAuth del servidor MCP (0260): hasheados, con PKCE, de un solo uso y vida de minutos. Escritor: la pantalla de consentimiento /mcp/autorizar; lector/canjeador: /api/mcp/oauth/token.';

alter table public.mcp_oauth_codigo enable row level security;
revoke all on table public.mcp_oauth_codigo from public, anon, authenticated;
grant select, insert, update, delete on table public.mcp_oauth_codigo to service_role;

-- ── El token (acceso y refresco), atado a flota + usuario + rol ────────────

create table if not exists public.mcp_oauth_token (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique
    constraint mcp_oauth_token_hash_forma check (token_hash ~ '^[0-9a-f]{64}$'),
  tipo          text not null
    constraint mcp_oauth_token_tipo_dominio check (tipo in ('acceso', 'refresco')),
  cliente_id    uuid not null references public.mcp_oauth_cliente(id) on delete cascade,
  user_id       uuid not null references public.app_user(id) on delete cascade,
  user_email    text,
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  rol           text not null,
  -- La FAMILIA agrupa todos los tokens que descienden del mismo
  -- consentimiento (acceso + refresco, y sus rotaciones). El reuso de un
  -- refresco ya rotado revoca la familia ENTERA de un tiro — es la defensa
  -- estándar contra un refresco robado (OAuth 2.1 §4.3.1, rotación con
  -- detección de reuso).
  familia       uuid not null,
  emitido_en    timestamptz not null default now(),
  expira_en     timestamptz not null,
  revocado_en   timestamptz,
  -- Best-effort, como `tenant_api_key.ultimo_uso_en`: sirve para contestar
  -- «¿este acceso sigue vivo?» antes de revocarlo, nunca para negar servicio.
  ultimo_uso_en timestamptz
);

-- El camino caliente: resolver un Bearer. `token_hash` ya es unique (índice
-- implícito). Los otros dos son para revocar por familia y para auditar por
-- flota.
create index if not exists mcp_oauth_token_familia_idx
  on public.mcp_oauth_token (familia);
create index if not exists mcp_oauth_token_tenant_idx
  on public.mcp_oauth_token (tenant_id, emitido_en);

comment on table public.mcp_oauth_token is
  'Tokens OAuth del servidor MCP (0260): hasheados, con expiración corta (acceso) y rotación con detección de reuso (refresco). Cada token nace atado a UN tenant, UN usuario y UN rol — no existe el token global. Escritor: /api/mcp/oauth/token; lector: la puerta de /api/mcp.';

alter table public.mcp_oauth_token enable row level security;
revoke all on table public.mcp_oauth_token from public, anon, authenticated;
grant select, insert, update, delete on table public.mcp_oauth_token to service_role;
