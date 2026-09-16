# MAPA — auditoría 31, continuación 2 (15-sep-2026)

Segunda continuación sobre el PR **#462**, rama `claude/auditoria-31`. Este
documento describe **qué cambió** desde que cada auditor escribió su archivo. No
sugiere ninguna dirección para las notas: sube, baja o se queda según lo que
midas, y todo movimiento necesita un número contable detrás.

## Decisión de tipo de ronda, con los comandos

- `list_pull_requests(open)` vía MCP de GitHub (no hay `gh` en esta imagen) →
  **PR #462 abierto** (`claude/auditoria-31`). Con un PR de auditoría vivo la
  regla es continuar sobre él y no abrir uno nuevo.
- `git log --oneline claude/auditoria-31..origin/master` → **vacío**;
  `origin/master` sigue en **`4047a50`**, el mismo sha sobre el que se cortó la
  rama el 13-sep. El código de producción no se ha movido en tres días.

## Lo que sí se movió: dos commits dentro de la rama

Los dos entraron **después** de que se escribiera `00-SINTESIS-continuacion.md`,
y por eso ninguna síntesis los describe todavía:

```
8c0e7df  fix(seguridad): el detector de deriva llama a git con argumentos,
         no con una cadena para el shell
         scripts/ci/deriva-sin-desplegar.mjs      | 25 +++--
         scripts/ci/deriva_sin_desplegar.test.ts  | 41 +++++---

939c111  test(peajes): el acuse se afirma con fronteras de etiqueta,
         no con texto pelado
         src/app/dashboard/agentes/peajes/acuse-corte.test.tsx | 27 ++++--
```

`docs/auditoria-31/progreso.md` no los registra: el diario se cortó en la línea
de las 11:48. Es una falla del propio método y queda anotada aquí.

## Quién se relanza hoy, y por qué exactamente ese

La regla de continuación relanza **solo** los rubros cuyo archivo falte o cuyo
código haya cambiado desde que se escribió. Los 12 archivos existen. Cruzando
las rutas tocadas contra el archivo más reciente de cada rubro:

| Rubro | Archivo más reciente | Código suyo que cambió después | Relanza |
|---|---|---|---|
| Frontend | `frontend.md` (0f5ca48) | `peajes/controles.tsx`, `peajes/page.tsx` (065f699) y su prueba de render (939c111) | **sí** |
| Seguridad | `seguridad.md` (0f5ca48) | `scripts/ci/deriva-sin-desplegar.mjs` — entró como script nuevo en 30e5e14 y se le corrigió la llamada a `git` en 8c0e7df | **sí** |
| Pruebas | `pruebas.md` (0f5ca48) | 4 archivos de prueba nuevos o reescritos (fd66be6, f4fde69, 54bddb2, 065f699, 8c0e7df, 939c111) | **sí** |
| Operabilidad | `operabilidad-continuacion.md` (54d6f14) | `deriva-sin-desplegar.mjs`, el artefacto que ese mismo archivo calificó, cambió después de que entregara | **sí** |
| Rendimiento | `rendimiento-continuacion.md` (54d6f14) | ninguno | no |
| Los otros 7 | `<rubro>.md` (0f5ca48) | ninguno en sus rutas | no |

Los cuatro escriben `<rubro>-continuacion-2.md`. Los archivos previos se
conservan intactos para poder leer el delta.

## Estado del árbol al arrancar

`git status --short` vacío → **autofix habilitado**.

## Hallazgos que llegan abiertos a esta ronda

Tres de ellos son partes restantes de arreglos de ayer, y el veredicto de «no
cierra» lo escribió un auditor, no el orquestador:

- **REN-31-C1, parte restante** (CRÍTICO) — `venceEn` se ancla después de
  `leerInterruptor` (hasta 9.5 s) y `COLCHON_LATIDO_CRON_MS` reserva 5.0 s para
  un latido que puede costar 9.5: **130.2 s medidos contra `maxDuration = 120`**.
  `leerConfigCobranza` (`cobranza.ts:39`) sigue sin `acotada()`.
- **REN-30-C1, parte restante** (CRÍTICO reincidente) — el prólogo de hasta 100
  páginas de `gasto` (~30 s nominales) corre **antes** del único chequeo de
  reloj de `barrerPorConciliar`.
- **OP-A6, parte restante** (ALTO) — el `::warning::` del detector no escribe en
  `$GITHUB_STEP_SUMMARY`, no abre issue (`:228` es `if: failure()`) y no manda
  correo. Con él mergeado, 14 corridas verdes habrían mandado **cero** avisos.
- **REN-30-C2** (CRÍTICO reincidente) — `candidatosDeGasto`, 427.5 s contra el
  techo, antes del único avance durable.
- **OP-C1** (CRÍTICO, 6ª ronda), **ARQ-C1** (9ª), **FE-C1** (6ª), **ARQ-A3**
  (CRÍTICO, no reproducible sin Postgres), **FIS-C1**, **FIS-C2**, **LEG-C1**,
  **LEG-31-C1**, **PRU-C1**.

## Lo que no es código y lleva tres días

El arreglo fiscal de la ronda 30 (`cuadre/desde_db.ts`, el cubo del 15 %) está
en `master` y no en producción: el último commit con `[deploy]` en el **asunto**
es `cfa00ab`, del 10-sep. Se verifica con
`git log origin/master --format='%h %s' | grep -m1 '^\S* \[deploy'`.
