# Auth por usuario para el panel — diseño

**Fecha:** 2-ago-2026 · **Demo:** jueves 6-ago-2026 (4 días) · **Estado:** aprobado por Javier, pendiente de plan de implementación.

## Por qué

Hoy el panel (`/dashboard`) vive detrás de UN passcode compartido para toda la
instalación (`src/lib/auth/passcode.ts`, `DASHBOARD_PASSCODE`/`DASHBOARD_SECRET`).
`docs/HANDOFF.md` ya lo marcaba como "bloqueante de segundo cliente, no de este
demo": no hay identidad, así que cortarle el acceso a una persona es imposible
por construcción. Javier pidió adelantarlo para ANTES del demo del jueves,
inspirado en cómo lo hacen usehandle.ai y happyrobot.ai — dos SaaS B2B
enterprise-gated (sin auto-registro público) cuya página de login real es
magic link por email + Google OAuth, sin contraseña.

## Decisiones ya tomadas (no reabrir sin razón)

1. **Provisión del tenant: manual, por Javier.** Nadie se registra creando su
   propia flota desde cero. Javier sigue cerrando clientes con su proceso
   existente (`diagnostico` → `cotizacion` → `contrato` → `cobro`) y captura
   el RFC/razón social ahí, como hoy. El "registro" es solo que el contralor
   cree SU login para un tenant que YA EXISTE. Mismo patrón que ya usa el
   operador de WhatsApp (`resolveOperador`: "no te tengo registrado, pídele a
   tu flota que te dé de alta").
2. **Método de login: email (magic link) + Google OAuth, los dos desde el
   arranque.** Google requiere que Javier cree un cliente OAuth en Google
   Cloud Console y lo pegue en el dashboard de Supabase Auth — pendiente
   externo suyo, no de código.
3. **El passcode compartido se elimina de una vez**, no se deja como
   respaldo en paralelo. Riesgo aceptado explícitamente: sin passcode de
   emergencia, si el login nuevo falla el día de la demo no hay puerta
   trasera. La mitigación es probarlo ANTES del jueves con el correo real
   del contralor de la demo, no ese mismo día.
4. **Un solo rol por ahora: `flota_admin`** (el nombre que ya usa el dominio
   existente de `app_user.rol` para "el contralor"). Los roles `contador` y
   `operador` del mismo dominio no se usan todavía desde el panel — quedan
   disponibles para después del demo, no hace falta tocarlos ahora. Nada de
   invitar más usuarios al mismo tenant en esta ronda.

## Modelo de datos — YA EXISTE, no se crea nada

Hallazgo del 2-ago-2026 al empezar el plan de implementación: `0001_init.sql`
—la migración de arranque del proyecto— ya define exactamente lo que este
diseño necesita, sin usar:

- Tabla `app_user` (`id` = `auth.users.id`, `tenant_id` nullable —`null` es
  superadmin—, `email` único, `nombre`, `rol`: `superadmin` | `flota_admin` |
  `contador` | `operador`).
- Funciones `get_user_tenant_ids()` e `is_superadmin()`, ambas `security
  definer` sobre `auth.uid()`.
- RLS ya habilitado en las 7 tablas de negocio (`terminal`, `operador`,
  `politica_gasto`, `viaje`, `gasto`, `liquidacion`, `wa_conversacion`) con la
  política `tenant_data`: `tenant_id = any(get_user_tenant_ids()) or
  is_superadmin()`.
- Un `CHECK` sobre `app_user.rol` (migración `0025`), con comentario propio:
  *"de este dominio depende `is_superadmin()` y por tanto la RLS de las 7
  tablas de negocio"*.
- `src/lib/auth/session.ts` → `getSessionTenant()`: YA lee la sesión de
  Supabase, busca en `app_user`, regresa `{ userId, tenantId, rol, nombre }`.

Nada de esto se usa hoy: `app_user` tiene 0 filas, `getSessionTenant()` no se
llama desde ningún lado. El dashboard sigue leyendo `TENANT()` (env var). Se
construyó completo desde el día uno del proyecto y se dejó sin conectar para
salir rápido con el passcode compartido — exactamente lo que ya avisaba
`HANDOFF.md`.

**Consecuencia para este diseño: no se crea ninguna tabla ni columna nueva.**
El rol para el contralor de una flota es `flota_admin` (ya existe en el
dominio permitido). El trabajo es CONECTAR, no construir: provisionar filas
en `app_user`, y hacer que el login real y el dashboard lean de ahí en vez
del passcode/env var.

### Provisión de un contralor nuevo

`app_user.id` tiene que ser el mismo `id` de `auth.users`, así que no se
puede insertar la fila de `app_user` antes de que exista el usuario de Auth.
Se resuelve con la Admin API de Supabase (ya disponible vía
`supabaseAdmin()`, que usa la service-role key):

```ts
const { data, error } = await supabaseAdmin().auth.admin.createUser({
  email, email_confirm: true,
});
if (error || !data.user) throw new Error(error?.message ?? 'no se creó el usuario');
await supabaseAdmin().from('app_user').insert({
  id: data.user.id, tenant_id: tenantId, email, nombre, rol: 'flota_admin',
});
```

Cuando esa persona entre después por magic link o Google con el MISMO correo,
Supabase Auth reconoce el `auth.users` ya existente (mismo email) y la sesión
trae ese mismo `id` — que ya hace match con la fila de `app_user`.

## Autenticación

- Supabase Auth, proveedores **Email (magic link)** y **Google OAuth**,
  habilitados desde el dashboard de Supabase (acción de Javier, fuera de este
  repo).
- Una sola pantalla sirve para login y "registro": al ser magic link/OAuth no
  existe un paso separado de "crear contraseña". La primera vez que un correo
  ya provisionado en `app_user` (ver arriba) inicia sesión, ya está dentro —
  no hay una acción de alta distinta.
- Ruta de callback de Supabase (`/auth/callback`) que completa la sesión y
  redirige a `/dashboard`.

## Resolución de tenant (el cambio estructural)

Hoy `dashboard/page.tsx:12` y `dashboard/[id]/page.tsx:13` fijan el tenant por
variable de entorno:

```ts
const TENANT = () => process.env.DEMO_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';
```

Esto se reemplaza por `getSessionTenant()` (`src/lib/auth/session.ts`, YA
ESCRITA — ver arriba), que regresa `{ userId, tenantId, rol, nombre } | null`:

- `tenantId` no nulo → ese es el `tenantId` para toda la página (mismo lugar
  que hoy usa `TENANT()`).
- Sesión válida pero `tenantId` nulo → esa persona es `superadmin` (rol sin
  tenant) o su `app_user.tenant_id` nunca se llenó. Página de "sin acceso":
  mensaje explícito, sin revelar qué tenants existen. Mismo tono que el
  operador de WhatsApp sin registrar.
- `getSessionTenant()` regresa `null` (sin sesión, o `supabaseServer()` no
  encuentra cookie válida) → redirect a `/login?next=<ruta>`, mismo patrón
  que el `exigirAcceso` de hoy.

`src/lib/auth/guard.ts` (`exigirAcceso`) y `proxy.ts` (el gate de
`/dashboard`) se reescriben sobre `getSessionTenant()` en vez de sobre
`tokenMatches`/`ACCESS_COOKIE` del passcode viejo.

Nota aparte, fuera de alcance de este demo: el dashboard sigue leyendo los
datos con `supabaseAdmin()` (service-role, salta RLS) y seguirá haciéndolo —
la RLS que ya existe en las 7 tablas de negocio queda como defensa en
profundidad sin usar todavía por la capa de datos, solo por `app_user`. Migrar
las consultas del panel a `supabaseServer()` para que la RLS las aplique de
verdad es un cambio más grande y no es necesario para que el login por
usuario funcione hoy — mismo criterio de "nada de refactors grandes a días
del demo".

## Páginas

| Ruta | Qué hace | Cambia respecto a hoy |
|---|---|---|
| `/` | Home/marketing | Casi nada — solo el link "Entrar" apunta a `/login` |
| `/login` | Login + registro unificado (email o Google) | Reemplaza `/acceso` |
| `/auth/callback` | Completa la sesión de Supabase tras magic link/OAuth | Nueva |
| `/cuenta` | Nombre de la flota, correo del contralor, cerrar sesión | Nueva, mínima a propósito |
| `/dashboard`, `/dashboard/[id]` | El panel de siempre | El `tenantId` ya no sale de un env var, sale de la sesión |

## Qué se elimina

- `/acceso` (page.tsx)
- `src/lib/auth/passcode.ts` completo
- Variables de entorno `DASHBOARD_PASSCODE` y `DASHBOARD_SECRET` (en Vercel,
  una vez que el login nuevo esté probado y en producción)

## Estilo visual

Referencia: la página de login real de usehandle.ai — card centrada,
minimalista, logo arriba, "Continuar con Google" y "Continuar con email" como
único par de acciones, link de "¿No tienes cuenta? Regístrate" (que en Likida
no aplica igual, ya que no hay auto-registro — se omite o se sustituye por un
texto que explica que el acceso lo da su flota).

Se construye DENTRO del sistema de diseño que Likida ya tiene (`.card`,
`.glass`, las variables `var(--accent)`, `var(--surface)`, `var(--muted)` que
ya usan `/` y `/acceso`), no con un stack de componentes nuevo (shadcn/ui,
Tailwind v4) como el que trae el template de clonado. El repo
`JCodesMore/ai-website-cloner-template` (starred por Javier) se usa solo como
**referencia visual** — capturas y specs de componentes de la página real de
usehandle.ai — para guiar el layout a mano, no para escribir el código
directamente en `cuadra`, ya que ese template escribe un proyecto Next.js
aparte con su propio stack.

## Manejo de errores

- Correo con sesión válida pero sin fila en `app_user`, o con `tenant_id`
  nulo (superadmin): mensaje claro de "sin acceso, contacta a tu proveedor" —
  no se distingue de "no existe la cuenta" para no filtrar qué correos SÍ
  tienen acceso.
- Falla el envío del magic link o el OAuth de Google: mensaje de reintentar,
  sin detalles técnicos.
- Sesión expirada en el panel: mismo `next=` que hoy, vuelve a `/login` en vez
  de a `/acceso`.

## Pruebas / verificación

- Prueba manual real, ANTES del jueves: se provisiona el correo real de
  Javier como `flota_admin` del tenant demo (Transportes Innovativos), y
  entra por los dos caminos — Google y magic link — confirmando que ve el
  dashboard correcto. "Verificar mirando": no basta con que el código
  compile, hay que entrar de verdad y ver el panel.
- Prueba de aislamiento: se provisiona un segundo correo como `flota_admin`
  del tenant de prueba `PRUEBA-XML-DIESEL` (ya existe, ver conversación
  previa) y se confirma que ese correo NO ve el dashboard de Transportes
  Innovativos, ni al revés.
- Unit test de `getSessionTenant()`: dado un `app_user` mockeado, regresa el
  `tenantId`/`rol` correctos, y `null` cuando no hay usuario autenticado.

## Riesgo aceptado, explícito

Quitar el passcode de una vez (sin dejarlo en paralelo) significa que un
fallo del login nuevo el día de la demo no tiene puerta trasera. Javier lo
aceptó a sabiendas. La única mitigación real es probar el flujo completo
ANTES del jueves, no esa misma mañana.
