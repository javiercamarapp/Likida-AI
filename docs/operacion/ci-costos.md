# Costo de GitHub Actions al pasar el repositorio a privado

Repo público: Actions es gratis. Repo privado con plan Pro: **3,000 min/mes incluidos**, y lo que exceda cuesta
**US$0.006/min** (Linux 2 núcleos). Esta nota explica el diseño que baja el consumo y cómo operarlo.

## Medición de partida

Muestra: 300 corridas de GitHub (11 a 14-nov-2026, 2.87 días), duración real de cada job (inicio a fin, redondeada
al minuto como factura GitHub) y extrapolada a 30 días. Fuente: `gh run list` y `gh api .../runs/ID/jobs`.

Hallazgos:

- Cada push a una rama con PR corría **dos veces** los tres workflows pesados (`push '**'` y `pull_request`).
- Minutos medios por job: `verificar` 18.7 (PR) / 19.9 (push); Postgres 5.2; E2E navegador 21.3; CodeQL 8.5 a 10.4.
  Lo que más pesa en `verificar` son las pruebas con cobertura (~12 min); en E2E, las dos pasadas de Playwright (~17 min).
- Ritmo: ~9 corridas de PR/día, ~9 pushes a ramas/día (casi todos de ramas con PR) y ~2.5 pushes a master/día.

## Diseño

1. **Sin duplicados.** `ci.yml`, `ci-postgres.yml` y `e2e-navegador.yml` corren en `pull_request`, en `push` a
   `master`/`main` y en `workflow_dispatch`. Ya no en push de ramas. Para ramas **sin** PR queda `ci-rapido.yml`
   (job `rapido`: typecheck + lint; si la rama ya tiene PR abierto no hace nada).
2. **Filtro de cambios, sin `paths:` en `on:`.** El primer paso de cada job pesado es
   `node scripts/ci/cambios-ci.mjs <perfil>`, que calcula `steps.cambios.outputs.relevante`
   (`git diff` contra la base del PR). Todos los pasos siguientes llevan `if: steps.cambios.outputs.relevante == 'true'`.
   Si el PR no toca nada relevante, **el job termina en verde en segundos con su mismo nombre de check**.

   | Perfil | Check (nombre intacto) | Corre si el PR toca |
   | --- | --- | --- |
   | `verificar` | `verificar` | cualquier cosa que no sea `docs/**`, `*.md`, LICENSE, plantillas |
   | `postgres` | `Migraciones + aislamiento (Postgres efímero)` | `supabase/**`, `scripts/ci/**`, `.github/workflows/**`, `src/lib/likida/migraciones_verificadas.test.ts` |
   | `e2e` | `Pila local + Playwright contra el producto` | `src/**`, `public/**`, `pruebas-navegador/**`, `supabase/**`, `scripts/ci/e2e/**`, workflows, `package*.json`, `next.config.*`, `vercel.json`, `playwright|postcss|tailwind.config.*`, `tsconfig*.json` |

   En push a master, `workflow_dispatch` o con la etiqueta `ci-completo`: corre **todo siempre**. Ante cualquier
   duda (diff ilegible o vacío, error de git) corre todo (falla abierto).
3. **Cachés.** npm (`setup-node cache: npm`, ya estaba), Chromium de Playwright (ya estaba, clave por versión) y
   **nuevo** `.next/cache` en los dos builds (clave por lockfile + fuente, prefijos `nextjs-ci-` y `nextjs-e2e-`).
   No se cachea el `.deb` de pgTAP: se baja dentro del contenedor tras `apt-get update` y ahorraría ~10 s; no vale
   el riesgo de servir un paquete viejo. Tampoco `tsconfig.tsbuildinfo`: `pruebas_en_ci.test.ts` documenta que el
   typecheck debe correr en frío.
4. **Artefactos:** todos los `upload-artifact` con `retention-days` de 3 a 7 (el de `npm-audit-dev` no tenía).
5. **Programados:** `e2e-webkit-nocturno` pasa de diario a lunes y jueves (ahorra ~180 min/mes). `salud-produccion`
   (pulso de 1 min), `backup-storage`, `secretos` semanal y `codeql` semanal **no se tocan**: son protectores y
   cuestan menos de 400 min/mes en conjunto. `aviso-deploy-en-pr` se salta por completo (job-level `if`) si el
   título del PR no lleva `[deploy`.

## Regla: un check requerido nunca queda sin reportar

El ruleset de `master` exige por nombre `verificar` y `Migraciones + aislamiento (Postgres efímero)`; la ruta de
release exige además `Pila local + Playwright contra el producto` en estado `success` (un `skipped` cuenta como
falla en `scripts/ci/ci-requeridos.mjs`). Un workflow filtrado con `paths:` en `on:` no se dispara y deja el check
**pendiente para siempre**, bloqueando el merge. Por eso:

- el workflow SIEMPRE se dispara;
- el filtrado ocurre **dentro** del job (pasos con `if`), nunca saltando el job (un job saltado reporta `skipped`);
- no se renombra ningún job ni se añade otro job con el mismo nombre;
- `scripts/ci/cambios_ci.test.ts` falla si aparece `paths:` en esos tres workflows o si un paso posterior al filtro
  queda sin condición.

## Cómo forzar la corrida completa

- Etiqueta **`ci-completo`** en el PR (el workflow incluye el tipo `labeled`; cualquier etiqueta reinicia la corrida,
  así que ponlas antes de empujar), o
- *Actions → workflow → Run workflow* sobre la rama (`workflow_dispatch`): publica el check completo sobre ese SHA.

## Minutos por mes: antes y después (estimado)

| Workflow | Antes | Después | Notas |
| --- | ---: | ---: | --- |
| CI (`verificar`) | 11,530 | 5,700 | sin push duplicado; docs saltan; caché `.next` |
| CI Postgres | 3,224 | 955 | ~71 % de los PR no tocan supabase/scripts-ci |
| E2E navegador | 12,854 | 5,435 | sin duplicado; ~22 % de PR sin cambios de app; caché `.next` |
| CodeQL | 2,974 | 2,900 | sin cambio de diseño (ver abajo); ignora docs/SQL |
| Secretos (gitleaks) | 344 | 340 | |
| Aviso `[deploy]` | 303 | ~10 | job saltado sin `[deploy` |
| Salud de producción | 480 | 450 | pulso intacto |
| Backup Storage | 94 | 94 | intacto |
| E2E WebKit | 250 | 70 | lunes y jueves |
| CI rápido (nuevo) | 0 | 350 | typecheck + lint en ramas sin PR |
| **Total** | **~32,000** | **~16,300** | -49 % |

Supuestos: ritmo de la muestra constante (261 corridas de PR, 271 pushes a ramas y 73 a master por mes); caché
`.next` ahorra ~1.5 min por build; sin medir en vivo (ver «Qué no está verificado»).

### Costo mensual proyectado en privado

`max(0, minutos - 3,000) x US$0.006`

| Escenario | Minutos/mes | Costo extra |
| --- | ---: | ---: |
| Hoy sin cambios | ~32,000 | US$174 |
| Con este diseño | ~16,300 | **US$80** |
| Con este diseño + palancas A y E (abajo) | ~8,600 | US$34 |

## Palancas adicionales (no aplicadas: cambian protección o hábito)

Para llegar a ≤12,000 min hace falta algo más que filtrar:

- **E. Menos empujes por PR (hábito, sin perder nada): ~-5,600 min.** Cada push a un PR cuesta ~43 min; agrupar
  commits en un solo push por PR (regla ya vigente para Vercel) lo reduce casi proporcionalmente. Es la palanca más grande.
- **A. CodeQL solo en master y semanal: -2,100 min.** Quita el análisis previo al merge; el de master sigue.
- **B. E2E en PR solo con `ci-completo` o cambios de UI (no `src/lib`)**: ~-1,000 a -4,000 min según el criterio;
  E2E no es check requerido del ruleset, pero sí de la ruta de release (corre en master), por lo que la protección
  de producción se conserva a costa de enterarse del fallo después del merge.

## CodeQL en repo privado

Necesita licencia **GitHub Code Security** (antes GHAS). El preflight de `codeql.yml` falla a propósito si el repo es
privado y la licencia no está confirmada, para no mostrar un verde falso. Se dejó tal cual. Para apagarlo:
*Actions → CodeQL → ⋯ → Disable workflow* (reversible, no toca el historial), o borrar `.github/workflows/codeql.yml`.
No es un check requerido; `eslint-plugin-security` y `regex_sin_redos.test.ts` siguen en `verificar`.

## Qué no está verificado sin correr el CI real

- Que la sintaxis de las expresiones (`toJSON(...labels.*.name)`, `if: ${{ (failure()) && ... }}`) la acepte Actions
  (YAML y pruebas locales sí pasan).
- Que `git fetch --depth=1 origin <base_sha>` y `git diff` contra el merge commit funcionen en el runner (si fallan,
  el script corre todo).
- El ahorro real de la caché `.next` (Turbopack) y los minutos proyectados.
- Riesgo conocido: un PR solo de docs salta las pruebas que leen archivos de `docs/` (hay ~100 que mencionan
  rutas de docs o `.md`). Si rompe una, se descubre en el push a master. Usa `ci-completo` en PR de docs que
  alteren contratos documentados (runbooks, DEPLOY, `docs/operacion`).
