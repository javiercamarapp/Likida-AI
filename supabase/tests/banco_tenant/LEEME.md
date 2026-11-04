# Banco multi-tenant (X-02): flota A contra flota B

Corre en el CI público «CI Postgres (aislamiento entre tenants)» (`.github/workflows/ci-postgres.yml`), sobre el Postgres efímero con
las migraciones aplicadas. Runner: `node scripts/ci/banco-tenant.mjs --fase=estatica|dinamica|canario`. Excepciones:
`scripts/ci/banco-tenant-allowlist.json`. Pruebas sin base: `scripts/ci/banco_tenant.test.ts`.

| Comprobación | Archivo | Tipo de hallazgo |
| --- | --- | --- |
| (a) tabla con columna de tenant sin RLS; política permisiva `true` para anon/authenticated/public | `10_politicas.sql` | `sin_rls`, `politica_abierta` |
| (b) usuario autenticado de A no lee ni toca (UPDATE) filas de B, y viceversa; anon no lee filas de ninguna flota | `20_siembra_lectura.sql` | `fuga_lectura`, `fuga_escritura`, `fuga_anon` |
| (c) SECURITY DEFINER ejecutable por anon/PUBLIC | `30_funciones.sql` | `funcion_anon` |
| (d) SECURITY DEFINER ejecutable por authenticated (solo-sistema = service_role) | `30_funciones.sql` | `funcion_authenticated` |
| (e) vista sin `security_invoker` ni filtro por sesión; vista materializada expuesta | `40_vistas.sql` | `vista_sin_invoker`, `matview_expuesta` |

## Fases y por qué en ese orden

- **estática**: va ANTES de `grants_previos_0947_restaurar.sql`. Esa restauración devuelve también las ACL de funciones, así que
  (c) y (d) solo miden el estado real de producción antes de ella.
- **dinámica**: va DESPUÉS de restaurar, para que los privilegios de tabla no oculten un hueco de RLS (misma razón que la capa 1).
  Siembra una fila por flota en cada tabla con columna de tenant (`tenant_id` o FK a `tenant(id)`, descubiertas desde el catálogo;
  valores por tipo; disparadores y FKs apagados con `session_replication_role = replica`). Una tabla que no se puede sembrar
  NO cuenta como probada: aparece en `cobertura.no_sembradas` y el runner exige `cobertura_minima_siembra` (hoy 0.5; subirla cuando
  la primera corrida muestre la cobertura real).
- **canario**: crea objetos abiertos a propósito (`zz_canario_*`) y exige que el banco los marque. Si no, el banco está ciego.

Todo ocurre en una transacción que termina en `rollback`; los objetos auxiliares viven en el esquema efímero `ci_banco`.

## Allowlist

- **Permanente** (`permanente: true`): solo ayudantes de RLS (`funcion_authenticated`), con razón. Una fuga o un `sin_rls` nunca puede ser permanente.
- **Temporal**: `id`, `hallazgo` (id de la tabla de hallazgos), `severidad`, `justificacion`, `fecha_limite`. Vencida = el banco falla.
- Una excepción que ya no coincide con ningún hallazgo se reporta como obsoleta (aviso): retirarla.
- Para agregar los hallazgos de una corrida: el runner imprime un esqueleto JSON de los «no listados».
- `BANCO_TENANT_ESTRICTO=0` convierte «no listado» en informe (solo para calibrar la primera corrida; el paso del workflow es estricto).

## Límites declarados

- No se probó contra Postgres en la Mac (regla del carril); el árbitro es el CI. El canario existe precisamente para que un banco
  que no detecta nada se note.
- Solo se prueban esquemas listados en `esquemas_expuestos` (`public`, `graphql_public`, como `supabase/config.toml`).
- Tablas que la siembra genérica no logra llenar (CHECK, únicos, tipos raros) quedan sin probar por (b); la estática (a) sí las cubre.
- No cubre la capa de aplicación con `service_role` (filtro `tenant_id` a mano): ver `consultas_admin_filtran_tenant.test.ts`.
