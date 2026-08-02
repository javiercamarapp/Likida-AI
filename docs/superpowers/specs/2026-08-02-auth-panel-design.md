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
4. **Un solo rol por ahora: contralor.** Nada de roles adicionales
   (admin/contador) ni de invitar más usuarios al mismo tenant en esta
   ronda — eso queda para después del demo, cuando haga falta.

## Modelo de datos

Una sola columna nueva, sin tabla nueva:

```sql
alter table tenant add column contralor_email text unique;
```

Nullable a propósito: un tenant sin `contralor_email` capturado simplemente no
tiene a nadie que pueda entrar todavía (estado normal de un tenant recién
creado, antes de invitar al contralor).

## Autenticación

- Supabase Auth, proveedores **Email (magic link)** y **Google OAuth**,
  habilitados desde el dashboard de Supabase (acción de Javier, fuera de este
  repo).
- Una sola pantalla sirve para login y "registro": al ser magic link/OAuth no
  existe un paso separado de "crear contraseña". La primera vez que un correo
  autorizado (que coincide con algún `tenant.contralor_email`) inicia sesión,
  ya está dentro — no hay una acción de alta distinta.
- Ruta de callback de Supabase (`/auth/callback`) que completa la sesión y
  redirige a `/dashboard`.

## Resolución de tenant (el cambio estructural)

Hoy `dashboard/page.tsx:12` fija el tenant por variable de entorno:

```ts
const TENANT = () => process.env.DEMO_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';
```

Esto se reemplaza por un resolver que lee la sesión de Supabase Auth server-side,
toma el email autenticado, y busca `tenant where contralor_email = email`:

- Si hay match → ese es el `tenantId` para toda la página (mismo lugar que hoy
  usa `TENANT()`, en `dashboard/page.tsx` y `dashboard/[id]/page.tsx`).
- Si no hay match → página de "sin acceso": el correo existe y tiene sesión
  válida, pero no está vinculado a ningún tenant. Mensaje explícito, sin
  revelar qué tenants existen. Mismo tono que el operador de WhatsApp sin
  registrar.
- Sin sesión válida → redirect a `/login?next=<ruta>`, mismo patrón que el
  `exigirAcceso` de hoy.

`src/lib/auth/guard.ts` (`exigirAcceso`) y `proxy.ts` (el gate de
`/dashboard`) se reescriben sobre este resolver en vez de sobre
`tokenMatches`/`ACCESS_COOKIE` del passcode viejo.

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

- Correo no autorizado (sin match en `tenant.contralor_email`): mensaje claro
  de "sin acceso, contacta a tu proveedor" — no se distingue de "no existe la
  cuenta" para no filtrar qué correos SÍ tienen acceso.
- Falla el envío del magic link o el OAuth de Google: mensaje de reintentar,
  sin detalles técnicos.
- Sesión expirada en el panel: mismo `next=` que hoy, vuelve a `/login` en vez
  de a `/acceso`.

## Pruebas / verificación

- Prueba manual real, ANTES del jueves: Javier inicia sesión con su correo
  real (el que se configure como `contralor_email` de Transportes
  Innovativos) por los dos caminos — Google y magic link — y confirma que ve
  el dashboard correcto. "Verificar mirando": no basta con que el código
  compile, hay que entrar de verdad y ver el panel.
- Prueba de aislamiento: con un segundo tenant de prueba (o el tenant demo de
  diésel ya creado, `PRUEBA-XML-DIESEL`, si se le da su propio
  `contralor_email` distinto), confirmar que un correo NO ve el dashboard de
  otro tenant.
- Unit test del resolver: dado un email, regresa el `tenantId` correcto o
  `null` — sin pegarle a Supabase Auth de verdad, solo la consulta a `tenant`.

## Riesgo aceptado, explícito

Quitar el passcode de una vez (sin dejarlo en paralelo) significa que un
fallo del login nuevo el día de la demo no tiene puerta trasera. Javier lo
aceptó a sabiendas. La única mitigación real es probar el flujo completo
ANTES del jueves, no esa misma mañana.
