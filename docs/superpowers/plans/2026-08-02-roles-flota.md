# 5 roles del panel — Plan de implementación

## Contexto

El esquema ya anticipaba esto: `app_user.rol` acepta
`superadmin | flota_admin | contador | operador` (constraint
`app_user_rol_dominio`, 0025), y existe una tabla `operador` (el chofer,
identificado por teléfono de WhatsApp) con sus propios `viaje`. Lo único que
falta a nivel dato es un quinto valor: `encargado`.

RLS hoy (0001_init.sql:110-119) es SOLO por tenant, no por rol: cualquier
`app_user` de un tenant tiene lectura+escritura completa sobre las 7 tablas
de negocio vía la policy `tenant_data`. Eso es correcto para dueño/encargado/
contador (los tres viven del mismo panel, mismos datos), pero es la razón por
la que el chofer NO puede tener ese mismo tipo de sesión: si un operador se
loguea con una sesión que hereda `tenant_data`, ve TODOS los viajes de la
flota, no solo los suyos. Repetir el patrón de los otros tres roles para el
chofer sería un IDOR — la UI lo escondería, la API no.

## Matriz de permisos

| Rol | Ve | Puede | RLS |
|---|---|---|---|
| `superadmin` | todos los tenants | todo | ya existe (`is_superadmin()`) |
| `flota_admin` ("dueño") | su flota completa | todo: exportar, asignar, invitar usuarios | `tenant_data` (ya existe) |
| `encargado` (nuevo) | su flota completa | exportar, asignar viajes a choferes | `tenant_data` (ya existe, solo falta el valor en el dominio) |
| `contador` | su flota completa | solo lectura + exportar | `tenant_data` (ya existe) |
| `operador` ("chofer") | SOLO sus propios viajes | solo lectura | **policy nueva**, scoped por `operador_id` — no `tenant_data` |

## Alcance de esta vuelta

Se construyen las 5, pero el chofer se corta a lo mínimo defendible: una
vista de solo lectura de sus propios viajes, con RLS real (no un filtro de
UI que un token robado se salta). Nada de invitar chofer por correo desde
la web todavía — se sigue dando de alta con `provisionarUsuario` a mano,
igual que dueño/encargado/contador hoy.

---

### Task 1: `encargado` en el dominio de roles

**Files:** `supabase/migrations/0044_rol_encargado.sql`, `src/lib/auth/provisionar.ts`, `src/lib/auth/provisionar.test.ts`

- [ ] **Step 1: Test que falla** — `provisionar.test.ts`: `provisionarUsuario` acepta `rol: 'encargado'` sin lanzar.
- [ ] **Step 2: Migración** — alterar el constraint `app_user_rol_dominio` para incluir `'encargado'`.
- [ ] **Step 3: Tipo** — `RolAppUser` en `provisionar.ts` gana `'encargado'`.
- [ ] **Step 4: Aplicar migración y correr el test.**
- [ ] **Step 5: Commit.**

### Task 2: El guard reparte permisos, no solo tenant

**Files:** `src/lib/auth/permisos.ts` (nuevo), `src/lib/auth/permisos.test.ts`

- [ ] **Step 1: Test que falla** — funciones puras `puedeExportar(rol)`, `puedeAsignar(rol)`, `puedeAdministrar(rol)` con la tabla de la matriz de arriba.
- [ ] **Step 2: Implementación mínima.**
- [ ] **Step 3: Commit.**

`requireSessionTenant` ya devuelve `rol` (session.ts) — no hace falta tocarlo.

### Task 3: El dashboard actual se gatea por rol (dueño/encargado/contador)

**Files:** `src/app/dashboard/page.tsx`, `src/app/dashboard/[id]/page.tsx`

- [ ] **Step 1:** "Exportar CSV" / "Descargar PDF" solo si `puedeExportar(rol)`.
- [ ] **Step 2:** Acción "Reasignar chofer" en el detalle del viaje, solo si `puedeAsignar(rol)` — select con los `operador` del tenant, `UPDATE viaje SET operador_id`.
- [ ] **Step 3: Verificación manual + tests de las funciones puras ya cubren la lógica de permiso.**
- [ ] **Step 4: Commit.**

### Task 4: RLS real para el chofer — antes de que exista login de chofer

**Files:** `supabase/migrations/0045_rls_operador.sql`

- [ ] **Step 1:** Policy nueva en `viaje`, `gasto`, `liquidacion`: si `rol = 'operador'`, solo filas donde `operador_id` = el operador ligado a `auth.uid()`. Requiere una forma de ligar `app_user` → `operador` (columna `operador_id` en `app_user`, nullable, solo se llena para rol `operador`).
- [ ] **Step 2:** Test de RLS (igual que los que ya existen para `tenant_data`, ver `*.test.ts` de repo — correr contra Supabase real, no mock, es la única forma honesta de probar RLS).
- [ ] **Step 3: Commit.**

### Task 5: Vista de solo lectura del chofer

**Files:** `src/app/mis-viajes/page.tsx` (nuevo), `src/lib/auth/guard.ts`

- [ ] **Step 1:** `requireSessionTenant` no sirve tal cual (asume dashboard de flota) — nueva guard `requireOperador()` que redirige rol≠operador a `/dashboard`.
- [ ] **Step 2:** Página: lista de viajes propios, estatus, comprobado — sin exportar, sin cifras de otros choferes.
- [ ] **Step 3:** `proxy.ts` gatea `/mis-viajes` igual que `/dashboard`.
- [ ] **Step 4: Commit.**

### Task 6: Verificación de punta a punta

- [ ] Provisionar un `encargado`, un `contador` y un `operador` de prueba.
- [ ] Confirmar en el navegador que cada uno ve exactamente lo que la matriz dice — "verificar mirando", no solo que no truene.
