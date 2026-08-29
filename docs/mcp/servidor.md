# El servidor MCP de Likida — nota técnica

> La guía para personas está en `conectar-claude-y-chatgpt.md`. Esto es el
> mapa para quien mantenga el servidor.

## Qué versión de la especificación implementa, y contra qué documentación

**Escrito y verificado el 28-ago-2026.** Este dato caduca: el ecosistema MCP
publica una revisión mayor cada pocos meses, y este documento NO es el
estado del código — el código es el estado del código. Si estás leyendo esto
meses después, vuelve a mirar la especificación antes de asumir nada.

- **Revisión vigente de la especificación MCP: `2026-07-28`**
  (https://modelcontextprotocol.io/specification/2026-07-28 y su changelog,
  leído el 28-ago-2026). Esa revisión volvió el protocolo **stateless**:
  quitó `initialize`/`notifications/initialized`, las sesiones
  (`Mcp-Session-Id`), el GET de streams y `ping`; agregó `server/discover`
  (obligatorio), la versión por petición en
  `_meta["io.modelcontextprotocol/protocolVersion"]`, el campo `resultType`
  en todo result, y `ttlMs`/`cacheScope` en `tools/list`.
- **Los clientes en producción (Claude.ai, Claude Code, ChatGPT) siguen
  hablando la generación anterior** (`2025-03-26` / `2025-06-18` /
  `2025-11-25`), la del handshake `initialize`.
- Por eso el servidor atiende **las dos generaciones a la vez** (es
  stateless por construcción, así que no cuesta estado):
  `initialize`/`ping` para la vieja, `server/discover` + `_meta` +
  `resultType` + `ttlMs`/`cacheScope` para la nueva, y `-32022`
  (`UnsupportedProtocolVersion`) para lo que no conoce. Declarado en
  `VERSIONES_SOPORTADAS` (`src/lib/mcp/protocolo.ts`).
- Transporte: **Streamable HTTP, respuestas JSON simples**. No se ofrecen
  streams del servidor (GET = 405, contemplado por la spec) ni sesiones. El
  transporte HTTP+SSE viejo está Deprecated en la spec y aquí no existe.
- Autorización: **OAuth 2.1** conforme a la sección de autorización de la
  spec — Protected Resource Metadata (RFC 9728, con el path del recurso
  como sufijo), Authorization Server Metadata (RFC 8414), DCR (RFC 7591),
  PKCE S256 obligatorio (RFC 7636), `resource` (RFC 8707) e `iss` en la
  respuesta de autorización (RFC 9207). **Nota:** la revisión 2026-07-28
  deprecó DCR en favor de Client ID Metadata Documents (CIMD); DCR sigue
  siendo lo que Claude y ChatGPT usan hoy, y CIMD queda como pendiente
  documentado.
- Documentación de clientes consultada (28-ago-2026): los artículos de
  soporte de Anthropic sobre conectores personalizados
  (support.anthropic.com), la documentación MCP de Claude Code
  (code.claude.com/docs), y la documentación MCP de OpenAI
  (developers.openai.com — requisitos del modo desarrollador y el contrato
  `search`/`fetch` de Deep Research).

## Las piezas

| Pieza | Archivo |
|---|---|
| Endpoint MCP (JSON-RPC, gateo, bitácora) | `src/app/api/mcp/route.ts` |
| Protocolo (versiones, formas RPC) | `src/lib/mcp/protocolo.ts` |
| Credencial (llave `lk_live_` u OAuth) | `src/lib/mcp/credencial.ts` |
| Motor OAuth (códigos, tokens, rotación) | `src/lib/mcp/oauth.ts` |
| Catálogo y despachador de herramientas | `src/lib/mcp/herramientas.ts` + `herramientas/` |
| Descubrimiento (.well-known) | `src/app/.well-known/…` + `src/lib/mcp/metadata.ts` |
| DCR y canje de tokens | `src/app/api/mcp/oauth/{registro,token}/route.ts` |
| Pantalla de consentimiento | `src/app/mcp/autorizar/page.tsx` |
| Tablas (clientes, códigos, tokens) | `supabase/migrations/0260_mcp_oauth.sql` (verificación: bloque 207) |

## Las reglas que no se negocian

1. **El tenant sale de la credencial. Punto.** No hay parámetro ni campo
   del protocolo que lo cambie. Sin tenant resoluble → 401/503, jamás datos.
2. **`SUPABASE_SERVICE_ROLE_KEY` no sale del servidor.** El cliente MCP
   recibe tokens propios (`lk_mcp_at_…`) o usa una llave `lk_live_`;
   ninguna configuración de usuario contiene una credencial de Supabase.
3. **Solo lectura.** El catálogo entero es `readOnlyHint: true` y hay una
   prueba que lo fija. Una escritura futura exige diseño de
   preparar-y-constancia, no quitar un candado.
4. **Área por herramienta, antes de ejecutar** (`despacharHerramienta`):
   llave → su área emitida; OAuth → las áreas del rol
   (`visibilidad.ts`). Rol o área desconocidos no alcanzan nada.
5. **Ningún secreto en claro en la base**: SHA-256 con CHECK de 64 hex
   (la base rechaza el secreto entero aunque el código se equivoque —
   bloque 207 de `verificaciones.sql`).
6. **Bitácora**: cada `tools/call` (y cada intento negado por área) se
   anota en `bitacora_auditoria` con actor y herramienta; los intentos
   negados además en `evento_seguridad`.
7. **Tasa**: 60/min por IP sin identificar, 240/min por flota (las mismas
   de /v1), 10/min el registro DCR, 30/min el endpoint de token.
8. **Este servidor no gasta modelo.** Si una herramienta futura lo hiciera,
   su presupuesto es `createLlmBudget` con propósito **`fondo`** — nunca
   `interactivo`, que tiene reserva para el chofer.

## Vida de las credenciales

| Credencial | Prefijo | Vida | Muere por |
|---|---|---|---|
| Código de autorización | `lk_mcp_ac_` | 5 min, un solo uso | expiración, canje, reuso (revoca la familia) |
| Token de acceso | `lk_mcp_at_` | 8 horas | expiración, revocación de familia |
| Token de refresco | `lk_mcp_rt_` | 60 días, rota en cada uso | rotación, reuso (revoca la familia), expiración |
| Llave de API | `lk_live_` | hasta revocarla | revocación en el panel |

Revocación de emergencia de un consentimiento OAuth (superadmin, SQL):
`update mcp_oauth_token set revocado_en = now() where tenant_id = '…' and revocado_en is null;`

## Variables de entorno

**Ninguna nueva.** El servidor usa las que ya existen:
`NEXT_PUBLIC_APP_URL` (tiene que ser `https://app.likida.ai` — las URLs de
descubrimiento OAuth se derivan de ahí), `NEXT_PUBLIC_SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY` (solo servidor, como siempre).

## Qué falta para encenderlo en producción

1. Aplicar la migración **0260** (`scripts/aplicar-migraciones-y-humos.sh`).
2. Desplegar con la bandera `[deploy]` en el asunto del commit.
3. Humo de 2 minutos, en orden:
   - `curl https://app.likida.ai/.well-known/oauth-protected-resource/api/mcp` → JSON con `authorization_servers`;
   - `curl -X POST https://app.likida.ai/api/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` → **401** con cabecera `WWW-Authenticate` (así descubren los clientes dónde autorizarse);
   - conectar Claude.ai como dice la guía y preguntar «lista mis viajes».
