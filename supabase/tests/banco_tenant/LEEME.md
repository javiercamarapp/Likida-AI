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
  valores por tipo; disparadores y FKs apagados con `session_replication_role = replica`). La primera corrida de CI (run 41908252310)
  sembró 96 de 221 tablas: las otras 125 chocaron con un CHECK (dominios, formas con regex, coherencias entre columnas). Ahora
  `scripts/ci/banco-tenant-siembra.mjs` lee los CHECK reales del catálogo (`pg_get_constraintdef`) y arma por tabla y columna una
  lista ordenada de valores candidatos (literales de los `IN (...)`, muestras generadas desde el regex, números de las comparaciones,
  fechas relativas, JSON con las llaves exigidas); `ci_banco.sembrar_buscando` prueba combinaciones, una subtransacción por intento,
  hasta sembrar el par de filas (flota A y flota B, con valores distintos cuando hay únicos globales). Una tabla que no se puede
  sembrar NO cuenta como probada: aparece en `cobertura.no_sembradas` con su error y debe estar en
  `scripts/ci/banco-tenant-no-sembrables.json` con el motivo (si no, el banco falla y no se calla). El runner exige
  `cobertura_minima_siembra` (0.85 de las tablas con columna de tenant) e imprime la tabla de no sembradas en el resumen del job.
- **canario**: crea objetos abiertos a propósito (`zz_canario_*`) y exige que el banco los marque. Si no, el banco está ciego.

Todo ocurre en una transacción que termina en `rollback`; los objetos auxiliares viven en el esquema efímero `ci_banco`.

## Allowlist

- **Permanente** (`permanente: true`): solo ayudantes de RLS (`funcion_authenticated`), con razón. Una fuga o un `sin_rls` nunca puede ser permanente.
- **Temporal**: `id`, `hallazgo` (id de la tabla de hallazgos), `severidad`, `justificacion`, `fecha_limite`. Vencida = el banco falla.
- Una excepción que ya no coincide con ningún hallazgo se reporta como obsoleta (aviso): retirarla. El aviso es POR FASE: las excepciones
  de funciones, políticas y vistas solo pueden quedar obsoletas en la estática, y las de fugas solo en la dinámica (antes la dinámica
  avisaba de RLS-01..07 por no medir funciones). Retiradas el 2026-11-04: RLS-08, RLS-09, L1K-01 y L1K-02, porque `is_operador()` y
  `get_user_operador_id()` las borra la migración 0086 y no existen; si se recrean, la estática las reporta como no listadas.
- Para agregar los hallazgos de una corrida: el runner imprime un esqueleto JSON de los «no listados».
- `BANCO_TENANT_ESTRICTO=0` convierte «no listado» en informe (solo para calibrar la primera corrida; el paso del workflow es estricto).

## Límites declarados

- No se probó contra Postgres en la Mac (regla del carril); el árbitro es el CI. El canario existe precisamente para que un banco
  que no detecta nada se note.
- Solo se prueban esquemas listados en `esquemas_expuestos` (`public`, `graphql_public`, como `supabase/config.toml`).
- Tablas que la siembra no logra llenar (coherencias muy específicas, tipos raros) quedan sin probar por (b), con motivo en la lista de no
  sembrables; la estática (a) sí las cubre. La búsqueda de candidatos tiene tope (600 intentos por tabla).
- No cubre la capa de aplicación con `service_role` (filtro `tenant_id` a mano): ver `consultas_admin_filtran_tenant.test.ts`.
