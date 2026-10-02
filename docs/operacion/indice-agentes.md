# Índice de operación de los agentes

Un solo lugar para saber, por agente, qué doc leer, qué cron lo mueve y qué migraciones de las olas 4a-4d faltan por aplicar en la base real. Estado al 2-oct-2026,
en `loop/punta-a-punta`: todo está construido y probado con dobles; **ninguna migración de esta tabla está aplicada en una base real** y nada se ha probado contra
proveedores reales (Meta, Resend, PAC, portales, GPS del cliente). La matriz de pruebas E2E por agente está en `docs/e2e/matriz-agentes.md`.

## Agentes, docs y crons

Los crons son los de `vercel.json`. «Reactivo» = lo dispara un mensaje o una petición, no un cron.

| Agente | Doc | Cron | Migraciones de las olas 4a-4d |
|---|---|---|---|
| 1 Liquidación fase 1 | `liquidacion-externa.md` | `/api/cron/liquidaciones-externas` (cada 5 min) | 0620 (candado de la copia al jefe), 0643-0645 (aviso de discrepancia con red, «Reavisar», teléfonos sin Excel) |
| 2 Peajes | `conciliacion-peajes.md` | `/api/cron/peajes` (cada 15 min) | 0603 (el pin de WhatsApp no cuenta como GPS), 0630-0632 (polígonos) |
| 3 Carta Porte | `carta-porte-multiformato.md` | `/api/cron/carta-porte-docs` (cada 5 min) | 0640-0642 (worker, avisos a la oficina, latido) |
| 4 Vigía | `vigia-cliente.md` | `/api/cron/vigia` (cada minuto; mantenimiento cada 5) | 0647 (respuestas rápidas aprobadas) |
| 5 Conductor | `agente-conductor.md` | `/api/cron/conductor-hitos` (cada 5 min) | 0603, 0604 (llegada sin confirmar, margen de acercamiento), 0630, 0635-0637 (geocerca, señal de vida, sitio derivado) |
| 6 Autofactura | `verificacion-portales.md` | `/api/cron/facturar` (cada 15 min), `/api/cron/portales-vivos` (lunes) | — |
| 7 Cobranza | `cobranza-por-gasto.md` | dentro de `/api/cron/escalar` (cada hora) | — |
| 8 Escalación de viaje no aceptado | `escalacion-viaje-no-aceptado.md` | `/api/cron/escalar` (cada hora) | — |
| 9 Buzón de facturas | `buzon-facturas.md` | `/api/cron/buzon-entrega` (cada 15 min) y webhook de correo | — |
| 10 GPS | `gps-proveedores.md` | `/api/cron/gps` (cada 5 min; re-importa las geocercas una vez al día por flota) | 0603, 0630-0632 |
| 11 Comunicación con operadores | `comunicacion-operadores.md` | reactivo (webhook de WhatsApp) | — |
| 12 Jornada | sin doc todavía | `/api/cron/jornada` (cada hora, minuto 30), `/api/cron/jornada-alertas` (cada 15 min) | — |
| 13 Mis reglas | `mis-reglas.md` | dentro de `/api/cron/escalar` (el vigilante de reglas) | — |
| Convenios | `convenios-clientes.md` | dentro de `conductor-hitos` (acercamiento) | 0580 (anterior a las olas 4) |
| Orquestador | `orquestador.md` | barrido de salud dentro de `/api/cron/escalar` | 0650-0652 (escalaciones, aviso por correo, barrido de salud) |

Otros crons de la plataforma: `wa-outbox` y `wa-pendientes` (cada minuto), `runner` (cada 4 h), `purgar` (04:15), `asistencia` (cada 5 min), `descarga-sat` (cada 6 h).

## Qué se enciende y qué nace apagado

Nacen **apagados** (se encienden por flota, una a la vez, y no hace falta aprobar sus plantillas para el demo si no se van a enseñar en vivo): el aviso a la oficina por llegada
y salida, el aviso al jefe por «ya llegué» sin confirmar, la señal de vida del Conductor, el aviso saliente del Orquestador (por correo), las alertas de estadía, la alerta de tope de
la Jornada, la cobranza por gasto, la copia al jefe sin teléfonos designados y el barrido largo del lector de tabla propia.

Nacen **encendidos**: la detección de llegadas y salidas por geocerca (solo con sitio asignado y GPS de la unidad), la validación de ubicación y la confirmación al chofer.

## Aplicar migraciones (con autorización y respaldo)

El código de cada agente funciona contra una base sin su migración y lo dice (no inventa un estado): la migración habilita lo que está en la columna de arriba. Orden recomendado,
aditivas e idempotentes: `0603, 0604, 0620, 0630, 0631, 0632, 0635, 0636, 0637, 0640, 0641, 0642, 0643, 0644, 0645, 0647, 0650, 0651, 0652`. Además siguen pendientes las de las
rondas anteriores (lista consolidada en `~/likida-loop/rondas/ronda-05-auditoria-cierre.md`, sección 3, punto 1). La compuerta de despliegue no construye si la base va atrás de la última
migración; correr antes la cadena contra una copia del estado actual de producción.

## Plantillas de WhatsApp

La lista consolidada de las que hay que someter a Meta, con agente, llamador, variables y botones, se **genera desde el catálogo**: `docs/operacion/plantillas-meta.md`
(regenerar con `npx tsx scripts/generar-doc-plantillas.ts`; una prueba falla si el doc difiere del catálogo). Verificar el estado contra Meta: `npx tsx scripts/verificar-plantillas-meta.ts`.
