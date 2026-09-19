# Diario — auditoría 32, continuación 3 (19-sep-2026)

Una línea por acción, con su sha. Se escribe **mientras** avanza, no al cerrar.

## Anclaje

- `git ls-remote origin master` → `69becdbd569a165b4547aef9771d1e4935d98b62`.
  Fresco, y **el mismo sha que ayer**: master no se ha movido desde el 16-sep.
- `git rev-parse HEAD` al clonar → `69becdb`. Sin ref rancio (la trampa de la
  continuación 2 de la 31 no se repitió).
- `list_pull_requests(open)` → **#477 abierto**, rama `claude/auditoria-32`,
  draft, `mergeable_state: clean`, 15 commits, 47 archivos. Los otros cuatro
  abiertos (#478, #479, #480, #481) son de las rutinas normativas, no de
  auditoría. → **RONDA DE CONTINUACIÓN**, se continúa sobre #477, no se abre PR
  nuevo.
- `git checkout -B claude/auditoria-32 origin/claude/auditoria-32` → `656bc68`.
- `git log --oneline claude/auditoria-32..origin/master` → vacío. Sin conflicto.
- `git status --short` → vacío. **Árbol limpio → autofix habilitado.**
- El clon llegó **sin `node_modules`**. `npm ci` → **exit 0**.

## Línea base de la compuerta

```
npx vitest run
  Test Files  989 passed (989)
  Tests       12990 passed | 6 skipped (12996)
  Duration    158.51s
  exit 0

npx tsc --noEmit -p .   exit 0
```

**Cifra por cifra idéntica al cierre del 18-sep** (989 / 12,990 / 6 / 0), que es
lo que confirma que el árbol no se movió entre rondas. El intermitente de
`cron/asistencia/route.test.ts` **no apareció** en esta pasada.

`npm run build` no se corre en la nube: pide Supabase, OpenRouter, Facturapi y
Upstash.

## Auditores lanzados

Seis, en un solo mensaje, contexto fresco, uno por rubro, ninguno toca código.
Entran los seis por la cláusula «su código cambió desde que escribió» — los doce
archivos de rubro existen, así que ninguno entra por archivo faltante:

| Rubro | Nota previa | Por qué entra | Archivo |
|---|---|---|---|
| Operabilidad y DX | 4 | `2c38766` arregló su propio CRÍTICO | `operabilidad-continuacion-3.md` |
| Rendimiento y costo | 4 | `fc811a0` arregló su propio CRÍTICO | `rendimiento-continuacion-3.md` |
| Pruebas | 5 | `e47f974` + 5 archivos de prueba nuevos | `pruebas-continuacion-3.md` |
| Backend y API | 6 | `pg.ts` y `consolidado.ts` cambiaron de contrato | `backend-continuacion-3.md` |
| Cumplimiento fiscal | 3 | 0358 y 0359 reescriben el predicado de dinero | `fiscal-continuacion-3.md` |
| Arquitectura y mantenibilidad | 4 | 0357/0358/0359 son tres arreglos a su ARQ-A3 | `arquitectura-continuacion-3.md` |

A los tres primeros se les pidió explícitamente el **veredicto sobre el arreglo
del orquestador que tocó su código**, que es la regla que se ha pagado sola tres
rondas seguidas.

## Acciones

### 1 · REN-32C3-C1 (CRÍTICO) — arreglado y retenido · `95f497c`

- Verificado por mí antes de tocar nada: `gastosSinCfdi` (`ciclo.ts:177-195`)
  pagina con `traerTodo` sin techo y se llama en `:269`, **antes** del único
  `Date.now() >= venceEn`, que vive en `:275`.
- Rojo medido: la prueba del motor pedía **100,000 filas** donde deben ser 0 y
  lanzaba `LecturaIncompleta` en vez de cortar.
- Verde tras el arreglo. **Mutación en los dos sentidos:** quitar el cableado
  → 2 rojas; quitar el corte del motor → 4 rojas.
- Un daño colateral encontrado y corregido dentro del mismo arreglo: la primera
  versión miraba `Date.now()` **también sin reloj** y le corría la secuencia a
  `REND-A3`. Se guarda con `venceEn !== undefined` antes de la mirada.
- `REND-A3` movió su ancla de 4 a 5 miradas al reloj (una legítima nueva, la
  del prólogo). Aserciones intactas y mordiendo en los dos sentidos.

### INFRA / higiene de la ronda

- **Un auditor dejó una mutación viva en el árbol**: `intake/consolidado.ts:523`
  con `monto: 0`. Era deliberada (mutación de pruebas durante una corrida de
  suite) y su autor la restauró al pedírselo; otros dos auditores la detectaron
  y la reportaron sin tocarla, que es la conducta correcta. **Ningún commit de
  esta ronda usó `git add -A`**: los cinco se armaron con rutas explícitas.
- El dato que dejó esa mutación **es un hallazgo**: escribir todas las líneas de
  un ECC con `monto = 0` no pone roja **ni una** de las 12,990 pruebas.
- Consecuencia medida: la suite completa que lancé a las 11:2x corrió con
  mutaciones de otro agente en el árbol (`_escritura.ts`), así que **no cuenta
  como compuerta**. Se vuelve a correr con el árbol quieto antes de cerrar.
