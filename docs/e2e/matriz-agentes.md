# Matriz E2E por agente (criterio g de la cola maestra)

Criterio (cola-maestra.md, «PRIORIDAD MÁXIMA»): para cada uno de los 13 agentes, **una prueba E2E del ciclo completo con dobles de proveedor** y estos cinco casos:
**feliz, fallo, duplicado, fuera de orden y otra flota (otro tenant)**.

Esta matriz es el índice de esas pruebas y refleja el estado del árbol `loop/punta-a-punta` tras la Ola 4d, P7 (convenios-edición), P9 (claims-concurrencia), P0 (demo), P12, P13 (Carta Porte multiembarque) y Ola 9 (2-oct-2026, ronda 13). Las cifras salen de una
corrida real de cada archivo con `heavy.sh`; si cambian, se actualiza esta tabla en el mismo commit. Se corre **un archivo a la vez** y con el candado de memoria:

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
~/likida-loop/heavy.sh npx vitest run --maxWorkers=2 src/lib/likida/e2e/agente-07-cobranza.e2e.test.ts
```

Todos los datos son **sintéticos** (flotas «t-a/t-b», operadores «Ficticio», RFC y UUID de prueba, dominios `.invalid`/`.example`, teléfonos de la serie 28999…).
Nada toca producción, Meta, SW, Resend ni OpenRouter reales: cada proveedor es un doble.

## Numeración de los 13 agentes

La numeración histórica del inventario (agentes 5–12) se corrió en uno cuando se insertó el Conductor como Agente 5 (cola maestra). Esta matriz usa la de la cola:

| # | Agente | Ciclo que cubre la prueba | Doc de operación |
|---|---|---|---|
| 1 | Liquidación fase 1 (entrega del pago ya calculado) | POST `/v1/liquidaciones-externas` → cron → outbox/Meta → botón del chofer; formato de la flota, copia al jefe, «No coincide» con red y «Reavisar» | `liquidacion-externa.md` |
| 2 | Peajes (PASE × gasto × GPS × caseta) | buzón firmado / correo / pull → cola con claim → cruce → bitácora conciliada → reporte de reclamación | `conciliacion-peajes.md` |
| 3 | Carta Porte multi-formato | panel / WhatsApp / correo → bandeja → worker del cron → revisión → viaje → export (csv, json, xlsx) | `carta-porte-multiformato.md` |
| 4 | Vigía de servicio al cliente | mensaje del cliente → borrador con datos reales → aprobación → SLA/escalamiento; grupos críticos y alerta de 10 min; histórico → respuesta rápida | `vigia-cliente.md` |
| 5 | Conductor (ciclo del conductor) | cron + chofer + validación contra GPS + detección por geocerca + señal de vida + tablero + estadías | `agente-conductor.md` |
| 6 | Autofactura con proveedores | lote supervisado → portal verificado → paso humano | `verificacion-portales.md` |
| 7 | Cobranza de comprobantes | cron por tier → claim → texto/plantilla → bitácora; cobranza por gasto | `cobranza-por-gasto.md` |
| 8 | Escalación del viaje no aceptado | cron horario → claim → chofer + jefe | `escalacion-viaje-no-aceptado.md` |
| 9 | Buzón de facturas de proveedores | correo Resend firmado → bandeja → aprobación → export SAP/CONTPAQi; entrega al contador | `buzon-facturas.md` |
| 10 | GPS (mapa y lectores) | poll/push → asentador → `posicion` → barrido de validación del Conductor | `gps-proveedores.md` |
| 11 | Comunicación con operadores | aviso de asignación, aceptación, acuse por selector de WhatsApp, hitos (motor del Conductor) | `comunicacion-operadores.md` |
| 12 | Jornada | marcas + GPS → tope → alerta | `jornada-alerta-tope.md` |
| 13 | Mis reglas | español libre → confirmación humana → vigilante SQL → WhatsApp | `mis-reglas.md` |
| — | Convenios / perfiles de cliente | archivo → despacho → acercamiento a la planta → pregunta → exportación | `convenios-clientes.md` |
| — | Orquestador / tablero en vivo | pregunta por rol → herramientas de solo lectura → escalar a una persona → barrido de salud y aviso | `orquestador.md` |

## Matriz agente × archivo × estado

**verde (N)** = corrió con `heavy.sh` y pasa N pruebas; **todo** = escrita como `it.todo` con motivo (no hay verde falso). «Cinco casos» dice dónde se ven los cinco casos del
criterio: los archivos `e2e/agente-NN-*.e2e.test.ts` los traen como bloques `describe` con esos nombres; los demás los reparten en bloques por tema (se indican).

| # | Archivo(s) E2E | Estado | Cinco casos |
|---|---|---|---|
| 1 | `src/lib/likida/e2e/agente-01-liquidacion.e2e.test.ts` · `src/lib/likida/liquidacion_externa/ciclo_completo.e2e.test.ts` | verde (14 + 39) | sí, en ambos (la segunda suma formato de la flota, copia al jefe, discrepancia y discrepancia con red) |
| 2 | `e2e/agente-02-peajes.e2e.test.ts` · `peajes/ciclo_completo.e2e.test.ts` · `peajes/flujo_completo.test.ts` | verde (14 + 28 + 5) | sí; la reclamación PASE × GPS × geocerca (Excel y PDF, otro tenant, desglose anulado) y los **cursos** (P8: importar, fuera de curso por unidad y por convenio, fallo, duplicado, fuera de orden y otro tenant) en `ciclo_completo` |
| 3 | `e2e/agente-03-carta-porte.e2e.test.ts` | verde (35); 1 todo | sí, más el bloque del **worker del cron** (reclamo, tope de intentos, avisos a la oficina) y el de **varios embarques** (P13: correo, panel/WhatsApp, duplicado, sin modelo, base sin 0670/0671 y otra flota). Todo: salida al layout del cliente, que depende de documentos reales |
| 4 | `e2e/agente-04-vigia.e2e.test.ts` · `vigia/ciclo_completo.e2e.test.ts` | verde (18 + 20) | sí; el segundo cubre dato real del Conductor, POD adjunto, queja con niveles, alerta de 10 min con la cola llena y del histórico a la respuesta rápida |
| 5 | `conductor/ciclo_completo.e2e.test.ts` | verde (53) | sí, en 10 bloques: viaje feliz, chofer que no contesta, fuera de orden, duplicados y solapes, chofer y flota equivocados, fuera de ventana de 24 h, validación sin acusar, flotas en la misma pasada, tablero y **P2** (hitos por geocerca y señal de vida) |
| 6 | `e2e/agente-06-autofactura.e2e.test.ts` · `src/app/api/cron/portales-vivos/route.test.ts` | verde (26 + 13) | sí; lote al vuelo real con un doble del portal (feliz, fallo, duplicado, fuera de orden, otra flota); el contrato del vigilante de portales en `route.test` |
| 7 | `e2e/agente-07-cobranza.e2e.test.ts` · `agentes/cobranza_gasto_e2e.test.ts` | verde (16 + 24) | sí; la cobranza por gasto, su base sin migrar y su configuración en la segunda |
| 8 | `e2e/agente-08-escalacion.e2e.test.ts` | verde (15) | sí |
| 9 | `e2e/agente-09-buzon.e2e.test.ts` · `buzon/ingesta_e2e.test.ts` · `buzon/entrega_e2e.test.ts` · `src/app/api/cron/buzon-entrega/route.test.ts` | verde (15 + 7 + 13 + 8) | sí en el primero; PDF/zip/pareja XML+PDF en `ingesta_e2e`; entrega al contador (CSV+ZIP, reserva atómica, backoff, cron) en `entrega_e2e`; el contrato del cron en `route.test` |
| 10 | `e2e/agente-10-gps.e2e.test.ts` · `conectores/tabla_propia/e2e.test.ts` | verde (17 + 1) | sí: feliz, fallo (401, 5xx, formato, cofre, cierre durable por flota), duplicado (poll y push), fuera de orden (muestra atrasada, de ayer, futura) y otra flota (mismo `device_id`, huérfanos) |
| 11 | `e2e/agente-11-comunicacion-operadores.e2e.test.ts` | verde (16) | sí |
| 12 | `e2e/agente-12-jornada.e2e.test.ts` · `src/app/api/cron/jornada-alertas/route.test.ts` | verde (26 + 10) | sí; la alerta de tope se enciende desde la sección «Alerta de tope» de `/dashboard/jornada` (P10) |
| 13 | `e2e/agente-13-mis-reglas.e2e.test.ts` · `reglas/e2e_ciclo_completo.test.ts` | verde (19 + 12) | sí; el respaldo por plantilla y «cuál plantilla usé» en la segunda |
| — | `convenios/convenios.e2e.test.ts` | verde (3) | sí: feliz y sin convenio; P7 suma el ciclo del cron con convenio editado tras despachar, acercamiento antes del despacho, fuera de orden y otra flota |
| — | `orquestador/orquestador.e2e.test.ts` · `orquestador/orquestador_vivo.e2e.test.ts` | verde (11 + 7) | rol, aislamiento, escalar a una persona, agente caído, sin PII; aviso apagado por omisión, barrido de salud sin duplicar y cierre solo |

El único `todo` que queda en todo el árbol es el de Carta Porte (salida al layout del cliente). El archivo de pendientes se retiró al integrar P10 y P11. Ningún archivo de esta tabla tiene fallos.

## Qué falta (y por qué)

1. **Agentes 6 y 12**: cerrados con P11 y P10 (E2E del ciclo y `route.test` de sus crons). Lo pendiente de Autofactura es externo: portales verificados contra el real, mandato legal y quién opera el vinculador.
2. **Carta Porte: salida al layout del cliente**: depende de los documentos reales (la exactitud no está medida).
3. **Convenios**: cerrado con P7 (ciclo del cron con convenio editado tras despachar, acercamiento antes del despacho y otra flota). Lo que falta es externo: aplicar 0656/0657/0658 y datos reales.
4. **Crons sin `route.test.ts`**: ninguno de los agentes (`jornada-alertas` y `portales-vivos` ya la tienen).
5. **Ningún E2E toca proveedores reales**: eso es bloqueo externo (Meta, Resend, PAC, portales, GPS del cliente), no código.

## Dobles de proveedor por agente

| Proveedor | Doble | Dónde |
|---|---|---|
| WhatsApp/Meta (texto, botones, plantilla, ventana 24 h, 131047/132001/429) | `crearMeta()` | `conductor/meta.fixture.ts` |
| Outbox de WhatsApp (liquidación) | `wa_outbox` en memoria + `drenarMeta(ventanaAbierta, plantillaAprobada)` | `e2e/agente-01-…` |
| GPS (Samsara, y la tabla propia con CSV) | respuesta HTTP simulada del proveedor + base en memoria; poller y asentador reales | `e2e/agente-10-gps.e2e.test.ts`, `conectores/tabla_propia/e2e.test.ts` |
| Estado durable del poll de GPS | `reclamarPolls`/`finalizarPoll` con un mock que anota con qué clase de falla se cierra cada flota | `e2e/agente-10-gps.e2e.test.ts` |
| PAC (cancelación CFDI) | fixtures de contrato 201/202/205/400 | Autofactura (pendiente) |
| Correo (Resend webhook + descarga de adjuntos + SAT) | `fetch` stub + `consultarCFDI` doble + firma svix real | `e2e/agente-09-…`, `e2e/agente-03-…`, `buzon/*_e2e.test.ts` |
| OpenRouter (modelo) | `llmFalso` / `generateStructured` doble | `e2e/agente-03-…`, `e2e/agente-13-…`, `orquestador/*` |

El arnés compartido vive en `src/lib/likida/e2e/db_memoria.fixture.ts` (base en memoria con `unique` → error 23505, `ON CONFLICT DO NOTHING` con `ignoreDuplicates`, RPC,
`gt/neq`, defaults) y reutiliza los dobles que ya existían: `conductor/meta.fixture.ts` (Meta con ventana de 24 h, plantillas aprobadas y rate limit),
`vigia/repo.fixture.ts`, `carta_porte_docs/{repo_falso,llm_falso,documentos_sinteticos,escenario}.fixture.ts` y `peajes/db_falsa.test.util.ts`.

## Límites declarados de esta capa

1. `hitos_viaje.ts` (`interpretarHito`/`sellarHito`) **se retiró en la ronda 11** (archivo y prueba): ya no estaba en el camino del chofer, los hitos los atiende el motor del Conductor
   (`atenderConductor`). Los dos techos de `frontera_datos_guardiana.test.ts` bajaron a la vez (286 → 285 archivos, 1,882 → 1,881 llamadas).
2. La prueba del Agente 11 replica el orden de llamadas del dispatcher (`processor.ts` es demasiado grande para correrlo entero con doble de base); el cableado real lo cubre
   `processor_hitos.test.ts`. Es una limitación declarada, no un hueco oculto.
3. Los E2E de cobranza (7), escalación (8), reglas (13) y GPS (10) usan una base en memoria, no Postgres: **no validan** los `CHECK`/índices únicos de las migraciones (eso es trabajo de
   las pruebas SQL, `supabase/tests/`, y de pgTAP), solo la lógica de la aplicación y que cada consulta filtra por tenant.
4. Una prueba que mockea al proveedor demuestra el contrato documentado, no el comportamiento del proveedor vivo.
