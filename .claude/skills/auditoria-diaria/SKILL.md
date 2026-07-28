---
name: auditoria-diaria
description: Corre la auditoría diaria del repo con un agente experto por rubro — frontend, backend, agéntico, tool calling, seguridad, fiscal, legal, arquitectura, pruebas, operabilidad, rendimiento y modelo de datos —, verifica cada hallazgo contra el código antes de anotarlo, lo pinta en un tablero que se mira, arregla críticos y altos con prueba que los reproduzca y commit atómico, y recalifica los 12 rubros contra la auditoría anterior. Úsala en la revisión de la mañana, al pedir "audita el repo", "qué se rompió", "califica el código", "encuentra errores y arréglalos", al cerrar una fase, antes de un demo o un deploy, y cuando corra desatendida por cron o /loop.
---

# Auditoría diaria

Una nota que solo sube es una nota que nadie está midiendo. La auditoría 2 de Likida bajó de 6.4 a 6.2 después de cerrar 13 bugs, y esa bajada fue el hallazgo más valioso de la ronda: dos rubros bajaron porque la mirada se hizo más profunda y la nota anterior estaba inflada, no porque el código empeorara. Esta rutina existe para producir ese tipo de lectura todos los días, no para producir un número que tranquilice.

## CRITICAL

- **Un hallazgo sin `archivo:línea` y sin escenario de falla concreto no es un hallazgo, es una opinión.** Se descarta sin discusión. El escenario tiene que ser "entra esto → sale esto mal", no "podría fallar".
- **Ningún auditor toca código.** Los 12 encuentran y califican; el orquestador arregla. Un auditor que arregla deja de buscar, y además 12 agentes escribiendo sobre el mismo repo se pisan.
- **El orquestador verifica cada hallazgo abriendo el archivo antes de anotarlo.** En la auditoría 2 uno resultó falso. Los falsos se anotan como falsos en el reporte — es lo que mantiene honestos a los auditores de mañana y lo que impide que la nota se mueva por ruido.
- **Árbol sucio, autofix apagado.** Si `git status` no está limpio al arrancar, la auditoría corre igual pero no se arregla nada: no se pueden hacer commits atómicos encima del trabajo a medias de alguien más, y el diario lo dice en una línea.
- **No se arregla lo que no se pudo reproducir.** Primero la prueba que falla, luego el arreglo, luego la prueba que pasa. Sin reproducción, el hallazgo baja a *propuesto* y espera. Arreglar a ciegas es cómo se introducen los bugs que la auditoría de mañana va a encontrar.
- **La explicación de la nota pesa más que la nota.** Un rubro que baja sin razón escrita es una calificación inventada.

## Las seis fases

**0 · Anclaje.** Leer `docs/auditoria-<N-1>/00-SINTESIS.md` para tener las notas previas — sin ellas no hay delta y la calificación flota. Correr `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build` y guardar la salida real: es la línea base contra la que se mide todo lo demás. Crear `docs/auditoria-N/` y actualizar `MAPA.md` con lo que cambió desde la ronda anterior (`git log <sha-anterior>..HEAD --stat`).

**1 · Doce auditores en paralelo, contexto fresco.** Uno por rubro, cada uno con el `MAPA.md`, su sección de `references/rubros.md`, su nota previa y los hallazgos que le quedaron abiertos. Cada uno escribe **un solo archivo**, `docs/auditoria-N/<rubro>.md` — un archivo por agente es lo que evita que se pisen. El prompt exacto está en `references/auditor-prompt.md`; se usa tal cual, cambiando solo el bloque del rubro.

**2 · Verificación adversarial.** El orquestador abre cada hallazgo y lo confirma contra el código. Los que sobreviven entran a la síntesis con severidad; los que no, entran a la sección *descartados* con la razón. Cuando un hallazgo contradice algo que tú ya decidiste, aplica `revisar-sin-ceder`: defender con evidencia antes de ceder.

**3 · Tablero.** `docs/auditoria-N/tablero.html`, autocontenido, con los 12 rubros, la flecha contra la ronda anterior, la serie histórica y los hallazgos por severidad. Se abre y **se mira** — un tablero que nunca se renderizó no es evidencia de nada. Detalle en `references/tablero.md`.

**4 · Arreglo de críticos y altos.** Uno a la vez, en serie, cada uno: prueba que reproduce → arreglo → prueba verde → suite completa → commit atómico citando el ID del hallazgo. Medios y bajos quedan propuestos en el tablero. Si un arreglo rompe algo, se revierte ese commit y el hallazgo vuelve a *pendiente* con la razón: el bucle retiene lo que mejora y devuelve lo que no.

**5 · Recalificación y cierre.** Correr la suite completa otra vez, escribir `00-SINTESIS.md` con las 12 notas, el delta y **el porqué de cada movimiento**, y commitear. Antes de declarar cualquier cosa terminada, `evidencia`: comando y salida real, o se dice que no se verificó.

## Los doce rubros

Frontend · Backend y API · Sistema agéntico y orquestación · Tool calling · Seguridad · Cumplimiento fiscal · Cumplimiento legal · Arquitectura y mantenibilidad · Pruebas · Operabilidad y DX · Rendimiento y costo · Modelo de datos y esquema.

Son los 11 ejes que Likida ya venía calificando, con fiscal y legal separados: comparten archivos pero no fallan igual — lo fiscal se rompe contra `normas/*.yaml` y le cuesta dinero al cliente, lo legal se rompe contra la LFPDPPP y le cuesta el negocio. Qué mira cada uno, dónde, y las anclas de calificación 0–10: `references/rubros.md`.

## Skills que se invocan solas dentro de la rutina

No hay que pedirlas; el disparador es la situación:

| Cuando pasa esto | Entra esta |
|---|---|
| Un hallazgo no tiene causa raíz clara | `depuracion-sistematica` |
| Toca reproducir antes de arreglar | `test-driven-development` |
| El rubro es seguridad y hay SQL, frontera de confianza o efecto dentro de un condicional | `review` |
| El rubro es seguridad y toca permisos, hooks o sandbox | `auditor-permisos` |
| Se va a declarar algo arreglado | `evidencia` |
| Un auditor dice que algo está mal y probablemente no lo está | `revisar-sin-ceder` |
| Hay que lanzar los 12 en paralelo sin que se pisen | `workflow-mapper` |
| La ronda va a durar más que el contexto | `plan-en-disco` |
| Corre desatendida | `goal-writer` + `bucle-trinquete` |
| Toca pintar el tablero | `dataviz` |

## Desatendida

Condición de terminación, tope de presupuesto, qué hacer si truena a media ronda y cómo se reanuda sin repetir trabajo: `references/desatendido.md`. Léelo **antes** de arrancar en modo cron o `/loop`, no cuando ya se atoró.

## Defaults

Repo: `~/javiercamarapp/cuadra` (`javiercamarapp/cuadra` en GitHub, rama `master`). Rondas en `docs/auditoria-N/`, N consecutivo. Escala 0–10 por rubro, global con un decimal. Autofix: críticos y altos. `pruebas-manuales/*.prueba.ts` hacen llamadas reales de pago — **no se corren**.

Corriendo como routine en la nube cambian tres cosas —la compuerta sin `build`, los arreglos por PR y no a `master`, y que esta skill viaja en el repo—: está en `references/desatendido.md`, sección *En la nube*.
