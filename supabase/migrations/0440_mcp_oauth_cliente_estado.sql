-- ═══════════════════════════════════════════════════════════════════════════
-- 0440 — CLIENTES OAUTH DEL MCP: ESTADO DE APROBACIÓN (anti consent-phishing).
--
-- Hallazgo de seguridad (auditoría ola 1, #2): el registro dinámico (RFC 7591)
-- es abierto y aceptaba CUALQUIER redirect_uri https. Un atacante registraba un
-- cliente con client_name «Claude» y redirect_uri https://atacante.tld/cb, le
-- mandaba a un contralor el enlace de consentimiento y, al pulsar «Autorizar»,
-- el código llegaba al atacante (PKCE no protege: el atacante ES el cliente).
--
-- Arreglo, parte de la base: cada cliente nace con un ESTADO.
--   · 'aprobado'  — todas sus redirect_uri caen en hosts conocidos (claude.ai,
--                   claude.com, chatgpt.com, openai.com…) o son loopback
--                   (RFC 8252 §7.3: el código no sale de la máquina del usuario).
--                   Lo decide el código (lib/mcp/oauth.ts) al registrar.
--   · 'pendiente' — cualquier otro host: NO se puede consentir ni canjear nada
--                   hasta que el superadmin lo apruebe (/admin/mcp-clientes).
--   · 'rechazado' — el superadmin lo negó; además corta refrescos vivos.
-- `estado_en` / `estado_por` dejan quién y cuándo decidió.
--
-- Los clientes YA registrados se reclasifican con el MISMO criterio (aquí, en
-- SQL): los de hosts conocidos/loopback quedan 'aprobado' (nada cambia para
-- Claude ni ChatGPT); el resto queda 'pendiente' y su refresco deja de rotar
-- hasta aprobación. Es deliberado: un cliente con host desconocido es
-- justamente la superficie del ataque.
--
-- Idempotente: add column if not exists, drop/add constraint, update acotado.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.mcp_oauth_cliente
  add column if not exists estado     text not null default 'pendiente',
  add column if not exists estado_en  timestamptz,
  add column if not exists estado_por uuid references public.app_user(id) on delete set null;

alter table public.mcp_oauth_cliente
  drop constraint if exists mcp_oauth_cliente_estado_dominio;
alter table public.mcp_oauth_cliente
  add constraint mcp_oauth_cliente_estado_dominio
  check (estado in ('pendiente', 'aprobado', 'rechazado'));

comment on column public.mcp_oauth_cliente.estado is
  '0440: pendiente | aprobado | rechazado. Solo un cliente aprobado puede recibir consentimiento y canjear códigos/refrescos. Nace aprobado únicamente si TODAS sus redirect_uri son de hosts conocidos o loopback (decide lib/mcp/oauth.ts); el resto espera al superadmin (/admin/mcp-clientes).';
comment on column public.mcp_oauth_cliente.estado_en is
  '0440: cuándo se decidió el estado (aprobación automática o del superadmin).';
comment on column public.mcp_oauth_cliente.estado_por is
  '0440: app_user que aprobó/rechazó. NULL = aprobación automática por host conocido, o pendiente.';

-- Reclasificar lo ya registrado con el mismo criterio que el código.
update public.mcp_oauth_cliente c
   set estado = 'aprobado', estado_en = now()
 where c.estado = 'pendiente'
   and c.estado_en is null
   and jsonb_typeof(c.redirect_uris) = 'array'
   and jsonb_array_length(c.redirect_uris) > 0
   and not exists (
     select 1
       from jsonb_array_elements_text(c.redirect_uris) u(uri)
      where not (
        u.uri ~* '^https://(claude\.ai|claude\.com|chatgpt\.com|chat\.openai\.com|platform\.openai\.com|openai\.com)(:443)?(/|\?|#|$)'
        or u.uri ~* '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(/|\?|#|$)'
      )
   );

-- La cola del superadmin: solo lo pendiente, lo más reciente primero.
create index if not exists mcp_oauth_cliente_pendiente_idx
  on public.mcp_oauth_cliente (creado_en desc)
  where estado = 'pendiente';
