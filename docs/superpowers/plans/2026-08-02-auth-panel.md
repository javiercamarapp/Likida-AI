# Auth por usuario para el panel — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el passcode compartido del panel (`/dashboard`) por login real por usuario (Supabase Auth: magic link + Google), resolviendo el tenant desde la sesión en vez de una variable de entorno.

**Architecture:** Toda la infraestructura de datos ya existe desde `0001_init.sql` (tabla `app_user`, RLS, `get_user_tenant_ids()`/`is_superadmin()`) y `src/lib/auth/session.ts` (`getSessionTenant()`) — sin conectar. Este plan CONECTA esas piezas: un guard nuevo que usa `getSessionTenant()`, páginas de login/cuenta que hablan con Supabase Auth, y el retiro del passcode viejo al final, una vez verificado el camino nuevo.

**Tech Stack:** Next.js 16 (App Router, `src/proxy.ts` = middleware), `@supabase/ssr` ^0.10.0 (ya instalado, ya usado en `src/lib/supabase/server.ts`), `@supabase/supabase-js` ^2.101.0, Vitest.

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-08-02-auth-panel-design.md` — no reabrir las 4 decisiones de la sección "Decisiones ya tomadas" sin motivo nuevo.
- No se crea ninguna tabla ni columna nueva. Todo el modelo de datos ya existe (`app_user`, RLS de las 7 tablas de negocio, `get_user_tenant_ids()`, `is_superadmin()`).
- El rol del contralor es `flota_admin` (dominio ya definido en `app_user.rol`, migración `0025`).
- El passcode compartido (`src/lib/auth/passcode.ts`, `/acceso`, `DASHBOARD_PASSCODE`/`DASHBOARD_SECRET`) se elimina de una vez al final del plan — no se deja como respaldo en paralelo.
- Ningún cambio toca las 7 tablas de negocio ni cómo el dashboard las consulta (sigue usando `supabaseAdmin()` con `.eq('tenant_id', ...)` explícito) — solo cambia DE DÓNDE sale ese `tenantId`.
- Estilo visual dentro del sistema de diseño ya existente de Likida (`.card`, `.glass`, `var(--accent)`, `var(--surface)`, `var(--muted)`, `var(--line)`, `var(--ink)` — ver `src/app/globals.css`), no un stack de componentes nuevo.
- Bloqueos externos, fuera de este repo, que no bloquean escribir el código pero sí probarlo de punta a punta:
  - **Google OAuth** requiere que Javier cree un cliente OAuth en Google Cloud Console y lo configure en Supabase Auth (Task 12).
  - **Referencia visual de usehandle.ai** requiere la extensión de Chrome conectada (no disponible al escribir este plan) — Task 6 puede construirse con el layout descrito en el spec sin esa referencia, y afinarse visualmente después si la extensión se conecta.

---

### Task 1: Provisionar cuentas en `app_user`

**Files:**
- Create: `src/lib/auth/provisionar.ts`
- Test: `src/lib/auth/provisionar.test.ts`

**Interfaces:**
- Consumes: `supabaseAdmin()` de `@/lib/supabase/admin` (ya existe)
- Produces: `provisionarFlotaAdmin(tenantId: string, email: string, nombre?: string): Promise<{ userId: string }>` — usado por Task 11 para dar de alta al contralor real, y disponible para altas futuras.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/auth/provisionar.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createUser = vi.fn();
const insert = vi.fn();
const from = vi.fn(() => ({ insert }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    auth: { admin: { createUser: (...a: unknown[]) => createUser(...a) } },
    from: (...a: unknown[]) => from(...(a as [])),
  }),
}));

const { provisionarFlotaAdmin } = await import('./provisionar');

describe('provisionarFlotaAdmin', () => {
  beforeEach(() => {
    createUser.mockReset();
    insert.mockReset();
    insert.mockResolvedValue({ error: null });
    from.mockClear();
  });

  it('crea el usuario de Auth y la fila de app_user con rol flota_admin', async () => {
    createUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
    const r = await provisionarFlotaAdmin('t-1', 'contralor@innovativos.mx', 'Ana Ruiz');
    expect(createUser).toHaveBeenCalledWith({ email: 'contralor@innovativos.mx', email_confirm: true });
    expect(from).toHaveBeenCalledWith('app_user');
    expect(insert).toHaveBeenCalledWith({
      id: 'u-1', tenant_id: 't-1', email: 'contralor@innovativos.mx', nombre: 'Ana Ruiz', rol: 'flota_admin',
    });
    expect(r).toEqual({ userId: 'u-1' });
  });

  it('sin nombre, nombre queda null', async () => {
    createUser.mockResolvedValue({ data: { user: { id: 'u-2' } }, error: null });
    await provisionarFlotaAdmin('t-1', 'sin-nombre@innovativos.mx');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ nombre: null }));
  });

  it('si Auth falla al crear el usuario, lanza con el mensaje de Supabase', async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { message: 'correo ya registrado' } });
    await expect(provisionarFlotaAdmin('t-1', 'ya@existe.mx')).rejects.toThrow('correo ya registrado');
    expect(insert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npx vitest run src/lib/auth/provisionar.test.ts`
Expected: FAIL — `Cannot find module './provisionar'`

- [ ] **Step 3: Implementación mínima**

```ts
// src/lib/auth/provisionar.ts
// ═══════════════════════════════════════════════════════════════════════════
// ALTA DE UN CONTRALOR. `app_user.id` tiene que ser el mismo `id` de
// `auth.users`, así que la fila de `app_user` no se puede insertar antes de
// que exista el usuario de Auth. Se crea aquí con la Admin API (service-role,
// vía supabaseAdmin()) y `email_confirm: true` para que no haga falta un paso
// de confirmación aparte — el primer login real (magic link o Google) ya es
// la confirmación.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function provisionarFlotaAdmin(
  tenantId: string,
  email: string,
  nombre?: string,
): Promise<{ userId: string }> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(error?.message ?? 'no se pudo crear el usuario de Auth');

  const { error: errInsert } = await admin.from('app_user').insert({
    id: data.user.id, tenant_id: tenantId, email, nombre: nombre ?? null, rol: 'flota_admin',
  });
  if (errInsert) throw new Error(errInsert.message);

  return { userId: data.user.id };
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `npx vitest run src/lib/auth/provisionar.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/provisionar.ts src/lib/auth/provisionar.test.ts
git commit -m "feat(auth): provisionarFlotaAdmin — alta de contralor en app_user"
```

---

### Task 2: Cobertura de `getSessionTenant` (ya existe, sin tests)

**Files:**
- Test: `src/lib/auth/session.test.ts`

**Interfaces:**
- Consumes: `getSessionTenant()` de `./session` (sin modificar — ya existe y es correcta)

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/auth/session.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
vi.mock('@/lib/supabase/server', () => ({
  supabaseServer: async () => ({ auth: { getUser: (...a: unknown[]) => getUser(...a) }, from: (...a: unknown[]) => from(...(a as [])) }),
}));

const { getSessionTenant } = await import('./session');

describe('getSessionTenant', () => {
  beforeEach(() => { getUser.mockReset(); maybeSingle.mockReset(); from.mockClear(); });

  it('sin usuario autenticado, regresa null', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await getSessionTenant()).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('con usuario y fila en app_user, regresa tenantId/rol/nombre', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-1' } } });
    maybeSingle.mockResolvedValue({ data: { tenant_id: 't-1', rol: 'flota_admin', nombre: 'Ana' } });
    const r = await getSessionTenant();
    expect(from).toHaveBeenCalledWith('app_user');
    expect(eq).toHaveBeenCalledWith('id', 'u-1');
    expect(r).toEqual({ userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana' });
  });

  it('usuario autenticado sin fila en app_user (o superadmin sin tenant), tenantId null', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u-2' } } });
    maybeSingle.mockResolvedValue({ data: null });
    const r = await getSessionTenant();
    expect(r).toEqual({ userId: 'u-2', tenantId: null, rol: 'flota_admin', nombre: null });
  });

  it('si Supabase truena, regresa null en vez de lanzar', async () => {
    getUser.mockRejectedValue(new Error('fetch failed'));
    expect(await getSessionTenant()).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test y confirmar que falla o pasa parcialmente**

Run: `npx vitest run src/lib/auth/session.test.ts`
Expected: puede fallar si el mock de `from().select().eq().maybeSingle()` no calza exactamente con la forma real de `session.ts` — ajustar el mock a la cadena real (`select('tenant_id, rol, nombre').eq('id', user.id).maybeSingle()`), NO el código de producción.

- [ ] **Step 3: (sin cambios de producción)**

`session.ts` ya implementa este contrato correctamente — este task es solo cobertura. Si el Step 2 revela una discrepancia real (no un mock mal armado), documentarla aquí y corregir `session.ts` con su propio test que reproduzca la falla primero.

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `npx vitest run src/lib/auth/session.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/session.test.ts
git commit -m "test(auth): cobertura de getSessionTenant (estaba sin usar y sin probar)"
```

---

### Task 3: Guard nuevo — `requireSessionTenant`

**Files:**
- Modify: `src/lib/auth/guard.ts`
- Modify: `src/lib/auth/guard.test.ts` (reemplaza los tests de `exigirAcceso` por los de `requireSessionTenant`)

**Interfaces:**
- Consumes: `getSessionTenant()` de `./session`, `SessionTenant` type
- Produces: `requireSessionTenant(destino: string): Promise<SessionTenant & { tenantId: string }>` — usado por Task 4 en las páginas del dashboard. Redirige (lanza vía `next/navigation` `redirect()`) en vez de regresar cuando no hay acceso, así que el tipo de retorno garantiza `tenantId` no nulo para quien lo llama.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/auth/guard.test.ts (reemplaza el archivo completo)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...(a as [])) }));

const getSessionTenant = vi.fn();
vi.mock('./session', () => ({ getSessionTenant: (...a: unknown[]) => getSessionTenant(...a) }));

const { requireSessionTenant } = await import('./guard');

describe('requireSessionTenant', () => {
  beforeEach(() => { redirect.mockClear(); getSessionTenant.mockReset(); });

  it('sin sesión, manda a /login con el next codificado', async () => {
    getSessionTenant.mockResolvedValue(null);
    await expect(requireSessionTenant('/dashboard/abc-123')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent('/dashboard/abc-123')}`);
  });

  it('con sesión pero sin tenant (superadmin o sin alta), manda a /sin-acceso', async () => {
    getSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: null, rol: 'flota_admin', nombre: null });
    await expect(requireSessionTenant('/dashboard')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/sin-acceso');
  });

  it('con sesión y tenant, regresa el SessionTenant tal cual', async () => {
    const s = { userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana' };
    getSessionTenant.mockResolvedValue(s);
    await expect(requireSessionTenant('/dashboard')).resolves.toEqual(s);
    expect(redirect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npx vitest run src/lib/auth/guard.test.ts`
Expected: FAIL — `requireSessionTenant is not exported`

- [ ] **Step 3: Reescribir `guard.ts`**

```ts
// src/lib/auth/guard.ts (reemplaza el archivo completo)
// ═══════════════════════════════════════════════════════════════════════════
// SEGUNDA CAPA DE AUTORIZACIÓN — la que no depende de un regex.
//
// Mismo criterio que la versión anterior (passcode): el proxy es la primera
// capa (barata, por matcher de ruta); esta es la segunda, y viaja CON la
// página en vez de con la configuración de rutas. Las dos tienen que fallar a
// la vez para que una página del panel se sirva sin autorización.
//
// Ahora la fuente de verdad es `app_user` vía `getSessionTenant()`, no un
// passcode compartido: sin sesión de Supabase, a /login; con sesión pero sin
// tenant asignado (superadmin, o alta pendiente), a /sin-acceso — nunca se
// sirve el panel sin un tenantId real.
// ═══════════════════════════════════════════════════════════════════════════
import { redirect } from 'next/navigation';
import { getSessionTenant, type SessionTenant } from './session';

export async function requireSessionTenant(
  destino: string,
): Promise<SessionTenant & { tenantId: string }> {
  const s = await getSessionTenant();
  if (!s) redirect(`/login?next=${encodeURIComponent(destino)}`);
  if (!s.tenantId) redirect('/sin-acceso');
  return s as SessionTenant & { tenantId: string };
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `npx vitest run src/lib/auth/guard.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/guard.ts src/lib/auth/guard.test.ts
git commit -m "feat(auth): requireSessionTenant reemplaza exigirAcceso (basado en app_user, no passcode)"
```

---

### Task 4: El dashboard lee el tenant de la sesión, no de un env var

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/app/dashboard/[id]/page.tsx`

**Interfaces:**
- Consumes: `requireSessionTenant` de `@/lib/auth/guard` (Task 3)

- [ ] **Step 1: `dashboard/page.tsx` — quitar `TENANT()` y `exigirAcceso`**

Buscar:
```ts
import { exigirAcceso } from '@/lib/auth/guard';
```
y
```ts
const TENANT = () => process.env.DEMO_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';
```
y dentro de `DashboardPage`:
```ts
await exigirAcceso('/dashboard');
const tenantId = TENANT();
```

Reemplazar el import por:
```ts
import { requireSessionTenant } from '@/lib/auth/guard';
```
Quitar la línea de `const TENANT = ...` por completo. Reemplazar las dos líneas dentro de `DashboardPage` por:
```ts
const { tenantId } = await requireSessionTenant('/dashboard');
```

- [ ] **Step 2: Mismo cambio en `dashboard/[id]/page.tsx`**

Buscar el `TENANT()` de la línea 13 y el uso en `TENANT()` de la línea 37
(`getLiquidacionDetalle(id, TENANT())`), aplicar el mismo reemplazo: importar
`requireSessionTenant`, quitar `TENANT`, y usar
`const { tenantId } = await requireSessionTenant(\`/dashboard/${id}\`);`
antes de `getLiquidacionDetalle(id, tenantId)`. Revisar si esta página ya
importaba `exigirAcceso` (probable, por el mismo patrón de dos capas) y
quitarlo igual.

- [ ] **Step 3: Verificar que compila**

Run: `npm run typecheck`
Expected: 0 errores. Si algo más en el archivo referenciaba `TENANT` o
`DEMO_TENANT_ID`, aparece aquí.

- [ ] **Step 4: Verificación manual (no hay test de render para estas páginas — mismo criterio que hoy, ninguna página del dashboard tiene uno)**

Con el resto de las tasks de este plan ya aplicadas (login funcionando), entrar
al panel de verdad con una sesión real y confirmar que carga los datos del
tenant correcto. Esta verificación se hace completa al final de la Task 11, no
aquí — este paso queda bloqueado hasta entonces porque todavía no hay forma de
iniciar sesión.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/page.tsx src/app/dashboard/\[id\]/page.tsx
git commit -m "feat(dashboard): el tenantId sale de la sesión, no de DEMO_TENANT_ID"
```

---

### Task 5: Migrar los export routes (CSV y PDF) a `getSessionTenant`

**Hallazgo durante la Task 4, no previsto al escribir el plan original:**
`src/app/api/export/liquidaciones/route.ts` y `src/app/api/export/pdf/[id]/route.ts`
—linkeados directo desde el dashboard ("Exportar CSV" / "Descargar PDF")—
importan `ACCESS_COOKIE`/`tokenMatches` de `src/lib/auth/passcode.ts`
directamente, con su propio gate (mismo passcode del panel) y su propio
`TENANT()`. La Task 13 (antes Task 12) borra `passcode.ts` — sin este task
antes, esa borradura rompe la compilación Y deja las dos rutas de exportación
sin gate alguno a medio camino.

**Files:**
- Modify: `src/app/api/export/liquidaciones/route.ts`
- Modify: `src/app/api/export/pdf/[id]/route.ts`

**Interfaces:**
- Consumes: `getSessionTenant()` de `@/lib/auth/session` — **NO**
  `requireSessionTenant` de `guard.ts`: esa función llama `redirect()` de
  `next/navigation`, pensado para páginas (Server Components), no para Route
  Handlers de API. Aquí se regresa un `NextResponse` 401 a mano, igual que ya
  hacían con el passcode.

- [ ] **Step 1: Reemplazar `src/app/api/export/liquidaciones/route.ts` completo**

```ts
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toCsv, toLiquidacionRows } from '@/lib/cuadra/export';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { getSessionTenant } from '@/lib/auth/session';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// Export de liquidaciones a CSV (ERP/Excel). Gate por la sesión real del
// contralor (Supabase Auth) — ya no por el passcode compartido. El
// service-role salta RLS, así que se sigue filtrando EXPLÍCITO por
// tenant_id, ahora tomado de la sesión en vez de un env var.
export async function GET(req: Request) {
  if (!rateLimit(`export:${clientIp(req)}`, 10, 60_000)) return new NextResponse('Demasiadas peticiones', { status: 429 });

  const s = await getSessionTenant();
  if (!s || !s.tenantId) return new NextResponse('No autorizado', { status: 401 });
  const tenantId = s.tenantId;

  const { data, error } = await supabaseAdmin()
    .from('liquidacion')
    .select('created_at, total_comprobado, total_anticipo, diferencia, estatus, diferencias, viaje:viaje_id(folio, operador:operador_id(nombre))')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(5000);
  // El texto crudo de PostgREST iba en el cuerpo del 500 y del lado del
  // servidor NO quedaba ninguna línea: el único testigo del fallo era el
  // navegador del contralor, que no lo guarda. Si cerraba la pestaña, el evento
  // no existió. Y de paso el mensaje sacaba nombres de columna y detalle del
  // esquema hacia afuera (auditoría 5, operabilidad, ALTO).
  //
  // Se invierte: el detalle se queda dentro y el usuario recibe algo que puede
  // repetir por teléfono. `tenant` va en el log —el redactor lo huella, no lo
  // borra— para saber de qué flota era el fallo.
  if (error) {
    logger.error('export.liquidaciones', { tenant: tenantId, err: error.message });
    return new NextResponse('No se pudo generar el export. Intenta de nuevo en un momento.', { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = toLiquidacionRows((data ?? []) as any);
  const csv = toCsv(rows);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="liquidaciones_likida.csv"`,
    },
  });
}
```

- [ ] **Step 2: Reemplazar `src/app/api/export/pdf/[id]/route.ts` completo**

```ts
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { getSessionTenant } from '@/lib/auth/session';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// ═══════════════════════════════════════════════════════════════════════════
// EL PDF QUE YA EXISTÍA Y NO TENÍA PUERTA.
//
// `guardar_liquidacion_tx` recibe `p_pdf_url` y la columna `pdf_url` existe
// desde la 0001, pero `getLiquidacionDetalle` ni la seleccionaba y ninguna
// página la renderizaba: en el demo, "¿me da el PDF?" se contestaba tecleando
// una URL a mano (auditoría 5, frontend, MEDIO 5).
//
// Lo guardado NO es una URL pública: es la ruta dentro del bucket privado
// `liquidaciones` (`{tenantId}/{viajeId}.pdf`, ver tools.ts). Servirla tal cual
// no funcionaría, y hacer público el bucket dejaría las liquidaciones de todas
// las flotas al alcance de quien adivine dos UUIDs. Por eso aquí se firma una
// URL de vida corta, detrás de la sesión real del contralor.
//
// El ejemplar que se entrega es el del CONTRALOR (`{viajeId}.pdf`), no el del
// operador: es el que lleva los veredictos y el que se archiva. Esa separación
// es deliberada en `tools.ts` y aquí se respeta.
// ═══════════════════════════════════════════════════════════════════════════
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!rateLimit(`export-pdf:${clientIp(req)}`, 30, 60_000)) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }

  const s = await getSessionTenant();
  if (!s || !s.tenantId) return new NextResponse('No autorizado', { status: 401 });
  const tenantId = s.tenantId;

  const { id } = await params;
  const admin = supabaseAdmin();
  // El filtro por tenant es EXPLÍCITO: el service-role salta RLS, así que un
  // id de otra flota no puede resolver aquí — tenantId sale de la sesión, no
  // de un env var.
  const { data, error } = await admin
    .from('liquidacion')
    .select('pdf_url')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    logger.error('export.pdf.lectura', { tenant: tenantId, liquidacion: id, err: error.message });
    return new NextResponse('No se pudo leer la liquidación. Intenta de nuevo en un momento.', { status: 500 });
  }
  // Sin fila y con fila sin PDF son 404 los dos: quien pregunta no debe poder
  // distinguir "no existe" de "existe y aún no tiene papel".
  if (!data?.pdf_url) return new NextResponse('No hay PDF para esta liquidación', { status: 404 });

  const firmada = await admin.storage
    .from('liquidaciones')
    .createSignedUrl(data.pdf_url as string, 60, { download: `liquidacion_${id.slice(0, 8)}.pdf` });

  if (firmada.error || !firmada.data?.signedUrl) {
    logger.error('export.pdf.firma', {
      tenant: tenantId, liquidacion: id, path: data.pdf_url,
      err: firmada.error?.message ?? 'storage no devolvió URL firmada',
    });
    return new NextResponse('No se pudo preparar la descarga. Intenta de nuevo en un momento.', { status: 502 });
  }

  return NextResponse.redirect(firmada.data.signedUrl, 302);
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 4: Verificación manual (no hay test para estas rutas — tampoco lo había antes de este plan; se verifican igual que `proxy.ts`, por curl/uso real)**

Sin sesión, las dos rutas deben seguir regresando 401 (antes por passcode
ausente, ahora por sesión ausente). Con sesión real (una vez desplegado y
probado en la Task 11), confirmar que "Exportar CSV" y "Descargar PDF" desde
el panel siguen funcionando y devuelven solo los datos del tenant de quien
inició sesión.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/export/liquidaciones/route.ts src/app/api/export/pdf/\[id\]/route.ts
git commit -m "fix(export): CSV y PDF leen el tenant de la sesión, no del passcode/env var"
```

---

### Task 6: `proxy.ts` — el gate de `/dashboard` valida sesión real

**Files:**
- Modify: `src/proxy.ts`

**Interfaces:**
- Ninguna (no exporta nada nuevo; sigue exportando `proxy` y `config` con la misma forma)

- [ ] **Step 1: Reescribir el bloque de `/dashboard` en `proxy.ts`**

Reemplazar todo el archivo por:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Cabeceras de seguridad + gate de sesión del dashboard. El matcher EXCLUYE
// /api (webhook, demo, export manejan lo suyo y no deben pasar por el gate ni
// cargar cabeceras de página).
//
// El gate ya NO es un passcode compartido: usa la sesión real de Supabase
// Auth. `createServerClient` aquí, con las cookies de request/response, es el
// patrón oficial para refrescar el token de sesión en middleware — sin esto,
// una sesión cuyo access token expiró a mitad de vida se vería como "sin
// sesión" hasta el siguiente refresh del lado del navegador.
//
// Esta es la PRIMERA capa (barata, por matcher de ruta). La segunda vive en
// cada página vía `requireSessionTenant` (src/lib/auth/guard.ts): las dos
// tienen que fallar a la vez para que el panel se sirva sin autorización.
export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const path = req.nextUrl.pathname;

  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  if (process.env.NODE_ENV === 'production') {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000');
  }

  if (path.startsWith('/dashboard')) {
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => req.cookies.getAll(),
          setAll: (list) => {
            list.forEach(({ name, value }) => req.cookies.set(name, value));
            res = NextResponse.next({ request: req });
            list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
          },
        },
      },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('next', path);
      return NextResponse.redirect(url);
    }
  }
  return res;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 3: Verificación manual con curl (no hay test para `proxy.ts` — tampoco lo había antes de este plan)**

```bash
curl -s -D - -o /dev/null https://likidaai.vercel.app/dashboard | grep -i "HTTP\|location"
```

Antes de desplegar esto, sin sesión, `/dashboard` debe seguir dando un
redirect — ahora hacia `/login` en vez de `/acceso`. Correr este curl otra vez
después de desplegar (no antes: el cambio vive solo en local hasta el push).

- [ ] **Step 4: Commit**

```bash
git add src/proxy.ts
git commit -m "feat(proxy): el gate de /dashboard valida sesión de Supabase, no passcode"
```

---

### Task 7: Página `/login` — magic link + Google

**Files:**
- Create: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `supabaseServer()` de `@/lib/supabase/server`

- [ ] **Step 1: Escribir la página**

```tsx
// src/app/login/page.tsx
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://likida.ai';
}

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; enviado?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = sp?.next && sp.next.startsWith('/dashboard') ? sp.next : '/dashboard';

  async function entrarConGoogle(formData: FormData) {
    'use server';
    const dest = String(formData.get('next') ?? '/dashboard');
    const sb = await supabaseServer();
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(dest)}` },
    });
    if (error || !data.url) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    redirect(data.url);
  }

  async function entrarConEmail(formData: FormData) {
    'use server';
    const dest = String(formData.get('next') ?? '/dashboard');
    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    const sb = await supabaseServer();
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(dest)}` },
    });
    if (error) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    redirect(`/login?next=${encodeURIComponent(dest)}&enviado=1`);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-8 w-full max-w-sm">
        <div className="text-lg font-semibold tracking-tight">Likida · Panel</div>
        <p className="text-sm mt-1 mb-6" style={{ color: 'var(--muted)' }}>
          Entra con la cuenta que te dio tu flota.
        </p>

        {sp?.enviado ? (
          <p className="text-sm p-3 rounded-lg hairline" style={{ background: 'var(--surface)' }}>
            Te mandamos un link a tu correo. Ábrelo desde este mismo dispositivo.
          </p>
        ) : (
          <>
            <form action={entrarConGoogle}>
              <input type="hidden" name="next" value={next} />
              <button type="submit"
                className="w-full px-4 py-2.5 rounded-lg text-sm font-medium hairline mb-3"
                style={{ color: 'var(--ink)' }}>
                Continuar con Google
              </button>
            </form>

            <div className="text-xs text-center mb-3" style={{ color: 'var(--muted)' }}>o</div>

            <form action={entrarConEmail}>
              <input type="hidden" name="next" value={next} />
              <input name="email" type="email" required placeholder="tu@flota.com"
                className="w-full px-3 py-2.5 rounded-lg hairline text-sm mb-3"
                style={{ background: 'var(--surface)' }} />
              <button type="submit"
                className="w-full px-4 py-2.5 rounded-lg text-sm font-medium"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                Continuar con email
              </button>
            </form>
          </>
        )}

        {sp?.error && (
          <p className="text-xs mt-3" style={{ color: 'var(--color-bad)' }}>
            Algo falló. Intenta otra vez.
          </p>
        )}

        <p className="text-xs mt-6" style={{ color: 'var(--muted)' }}>
          ¿Tu correo no tiene acceso? Pídele a tu flota que te dé de alta en Likida.
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 3: Verificación visual manual**

```bash
npm run dev
```
Abrir `http://localhost:3000/login` y confirmar que la card se ve centrada,
con las variables de color correctas en modo claro y oscuro (mismo criterio
de "verificar mirando" que el resto del proyecto). Si la extensión de Chrome
ya está conectada para entonces, comparar el layout contra
`https://usehandle.ai/login` y ajustar espaciado/tamaños a mano — no es
bloqueante para que la página funcione, solo para que se vea más cercana a la
referencia.

- [ ] **Step 4: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat(auth): página /login — magic link + Google"
```

---

### Task 8: Ruta `/auth/callback`

**Files:**
- Create: `src/app/auth/callback/route.ts`

**Interfaces:**
- Consumes: `supabaseServer()` de `@/lib/supabase/server`

- [ ] **Step 1: Escribir el route handler**

```ts
// src/app/auth/callback/route.ts
// Supabase redirige aquí con ?code= tras el magic link o el consentimiento de
// Google. exchangeCodeForSession intercambia ese code por una sesión real y
// la deja en las cookies (mismo cliente/cookies que supabaseServer() usa en
// el resto del panel).
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const next = req.nextUrl.searchParams.get('next');
  const dest = next && next.startsWith('/dashboard') ? next : '/dashboard';

  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(dest, req.url));
  }
  return NextResponse.redirect(new URL('/login?error=1', req.url));
}
```

- [ ] **Step 2: Verificar que compila**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add src/app/auth/callback/route.ts
git commit -m "feat(auth): ruta /auth/callback completa la sesión tras magic link/Google"
```

---

### Task 9: Página `/sin-acceso` y página `/cuenta`

**Files:**
- Create: `src/app/sin-acceso/page.tsx`
- Create: `src/app/cuenta/page.tsx`

**Interfaces:**
- Consumes: `getSessionTenant()` de `@/lib/auth/session`, `supabaseServer()` de `@/lib/supabase/server`

- [ ] **Step 1: `/sin-acceso`**

```tsx
// src/app/sin-acceso/page.tsx
export default function SinAcceso() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-8 w-full max-w-sm text-center">
        <div className="text-lg font-semibold tracking-tight">Sin acceso</div>
        <p className="text-sm mt-3" style={{ color: 'var(--muted)' }}>
          Tu cuenta inició sesión, pero no está vinculada a ninguna flota en
          Likida. Pídele a tu proveedor que te dé de alta.
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: `/cuenta`**

```tsx
// src/app/cuenta/page.tsx
import { redirect } from 'next/navigation';
import { requireSessionTenant } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export default async function Cuenta() {
  const s = await requireSessionTenant('/cuenta');
  const { data: tenant } = await supabaseAdmin()
    .from('tenant').select('nombre').eq('id', s.tenantId).maybeSingle();

  async function cerrarSesion() {
    'use server';
    const sb = await supabaseServer();
    await sb.auth.signOut();
    redirect('/');
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-8 w-full max-w-sm">
        <div className="text-lg font-semibold tracking-tight">Mi cuenta</div>
        <dl className="mt-6 text-sm space-y-3">
          <div>
            <dt style={{ color: 'var(--muted)' }}>Flota</dt>
            <dd>{(tenant?.nombre as string) ?? '—'}</dd>
          </div>
          <div>
            <dt style={{ color: 'var(--muted)' }}>Correo</dt>
            <dd>{s.nombre ?? s.userId}</dd>
          </div>
        </dl>
        <form action={cerrarSesion} className="mt-6">
          <button type="submit"
            className="w-full px-4 py-2.5 rounded-lg text-sm font-medium hairline"
            style={{ color: 'var(--ink)' }}>
            Cerrar sesión
          </button>
        </form>
      </div>
    </main>
  );
}
```

Nota: `s.nombre` viene de `app_user.nombre`, que puede ser null si no se
capturó al provisionar — no es el correo. Si `nombre` es null, se muestra el
`userId` como placeholder; queda como mejora de después del demo mostrar el
correo real (`session.ts` no lo expone hoy, solo `nombre`/`rol`/`tenantId`).

- [ ] **Step 3: Verificar que compila**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add src/app/sin-acceso/page.tsx src/app/cuenta/page.tsx
git commit -m "feat(auth): páginas /sin-acceso y /cuenta"
```

---

### Task 10: Link del home apunta a `/login`

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Cambiar el link**

Buscar, en dos lugares (nav superior y CTA del hero):
```tsx
<Link href="/acceso" ...>Entrar</Link>
```
y
```tsx
<Link href="/acceso" ...>Entrar al panel</Link>
```
Reemplazar `/acceso` por `/login` en ambos.

- [ ] **Step 2: Verificar que compila**

Run: `npm run typecheck`
Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "chore(home): el link de Entrar apunta a /login"
```

---

### Task 11: Verificación de punta a punta con una cuenta real

**Files:** ninguno (operación, no código)

- [ ] **Step 1: Desplegar todo lo anterior**

```bash
git push
```

(Recordatorio del propio repo: `git push` YA despliega — no correr
`vercel deploy` después.)

- [ ] **Step 2: Provisionar el correo real de Javier como flota_admin del tenant demo**

Ejecutar una sola vez, con el correo real que Javier va a usar en la sala:

```ts
import { provisionarFlotaAdmin } from '@/lib/auth/provisionar';
await provisionarFlotaAdmin(
  '11111111-1111-1111-1111-111111111111', // tenant demo, Transportes Innovativos
  'CORREO_REAL_DE_JAVIER',
  'Javier',
);
```

(Se puede correr como script suelto con `npx tsx` apuntando al proyecto, o
pedirle a un agente que lo ejecute con las variables de entorno de
producción cargadas — la función usa `supabaseAdmin()`, que necesita
`SUPABASE_SERVICE_ROLE_KEY`.)

- [ ] **Step 3: Entrar de verdad — magic link**

Ir a `https://likidaai.vercel.app/login`, poner el correo real, abrir el link
del correo, confirmar que aterriza en `/dashboard` y que los datos son los de
Transportes Innovativos (comparar contra lo que ya se conoce del viaje
`VJ-2026-0848`). "Verificar mirando": no basta con que no truene, hay que ver
las cifras correctas.

- [ ] **Step 4: Prueba de aislamiento**

Provisionar un segundo correo (uno personal, de prueba) para el tenant
`PRUEBA-XML-DIESEL` (ya existe, creado en la sesión anterior — buscar su
`tenant_id` real, que es el mismo tenant demo si no se creó uno nuevo aparte;
si comparte tenant con la demo, crear un tenant de prueba distinto solo para
esta verificación). Entrar con ese segundo correo y confirmar que NO ve los
datos de Transportes Innovativos.

- [ ] **Step 5: Registrar el resultado**

Si algo de esto falla, NO se avanza a la Task 13 (retiro del passcode) hasta
resolverlo — es la última verificación antes de quedarse sin respaldo.

---

### Task 12 (acción de Javier, fuera de este repo): habilitar Google OAuth

No es código. Pasos exactos para que el botón "Continuar con Google" del
Task 7 funcione:

1. En [Google Cloud Console](https://console.cloud.google.com/), crear un
   proyecto (o usar uno existente) → **APIs & Services → Credentials → Create
   Credentials → OAuth client ID** → tipo **Web application**.
2. En **Authorized redirect URIs**, agregar la URL de callback que Supabase
   indica en su propio panel (Authentication → Providers → Google) — tiene la
   forma `https://gngoqsvrxdguxvsizpbw.supabase.co/auth/v1/callback`.
3. Copiar el **Client ID** y **Client Secret** que Google genera.
4. En el [dashboard de Supabase](https://supabase.com/dashboard/project/gngoqsvrxdguxvsizpbw/auth/providers) →
   **Authentication → Providers → Google**, activar el proveedor y pegar esas
   dos credenciales.
5. En **Authentication → URL Configuration**, confirmar que **Site URL** y
   **Redirect URLs** incluyen `https://likidaai.vercel.app/**` (y `likida.ai`
   si aplica) — si falta, el redirect tras el login cae en un dominio no
   autorizado y Supabase lo rechaza.

Sin este task, el botón de Google en `/login` redirige a un error — el magic
link por email funciona igual sin él.

---

### Task 13: Retirar el passcode compartido

**Files:**
- Delete: `src/app/acceso/page.tsx`
- Delete: `src/lib/auth/passcode.ts`
- Delete: `src/lib/auth/passcode.test.ts`

**Solo ejecutar este task después de que la Task 11 haya pasado completa.**
Es el punto sin retorno del riesgo aceptado en el spec: sin passcode de
respaldo, un fallo del login nuevo no tiene puerta trasera.

- [ ] **Step 1: Borrar los archivos**

```bash
git rm src/app/acceso/page.tsx src/lib/auth/passcode.ts src/lib/auth/passcode.test.ts
```

- [ ] **Step 2: Confirmar que nada más los importa**

Run: `grep -rn "auth/passcode\|from '@/app/acceso'" src/ --include="*.ts" --include="*.tsx"`
Expected: sin resultados. Si aparece algo, arreglarlo antes de continuar (lo
más probable: algún otro archivo todavía importaba `ACCESS_COOKIE` o
`tokenMatches` de `passcode.ts`).

- [ ] **Step 3: Verificar que compila y pasan las pruebas**

Run: `npm run check`
Expected: 0 errores, todas las pruebas verdes.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(auth): retira el passcode compartido — login por usuario ya probado en producción"
```

- [ ] **Step 5: Quitar las variables de entorno en Vercel**

```bash
vercel env rm DASHBOARD_PASSCODE production
vercel env rm DASHBOARD_PASSCODE preview
vercel env rm DASHBOARD_SECRET production
vercel env rm DASHBOARD_SECRET preview
git push
```

(De nuevo: `git push` ya despliega — no correr `vercel deploy` aparte.)

---

## Self-review de este plan

- **Cobertura del spec:** provisión (Task 1, 11), autenticación magic link +
  Google (Task 7, 12), resolución de tenant (Task 2, 3, 4), export routes
  migrados (Task 5, hallazgo durante Task 4 — no estaba en el spec original,
  añadido para no romper el build en la Task 13), proxy (Task 6), páginas
  `/login` `/auth/callback` `/cuenta` `/sin-acceso` (Task 7-9), link del home
  (Task 10), retiro del passcode (Task 13), verificación con "verificar
  mirando" (Task 11). Todas las secciones del spec original tienen task, más
  el hallazgo de la Task 5.
- **Placeholders:** ninguno — cada step de código trae el archivo completo o
  el diff exacto a aplicar.
- **Consistencia de tipos:** `SessionTenant` (de `session.ts`, sin tocar) se
  usa igual en `guard.ts` (Task 3) y en `cuenta/page.tsx` (Task 9).
  `requireSessionTenant` regresa `SessionTenant & { tenantId: string }` en
  las dos páginas que lo consumen (Task 4 y Task 9). Las rutas de exportación
  (Task 5) usan `getSessionTenant()` directo, no `requireSessionTenant` —
  son Route Handlers, no páginas, y no pueden usar el `redirect()` de
  `next/navigation` en el que se apoya el guard.
- **Alcance:** un solo subsistema (auth del panel). No toca el intake de
  WhatsApp, el motor de cuadre, ni las 7 tablas de negocio más allá de leer
  `tenant.nombre` en `/cuenta`.
