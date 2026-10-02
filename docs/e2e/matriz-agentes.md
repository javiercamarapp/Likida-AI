# Matriz E2E por agente (criterio g de la cola maestra)

Criterio (cola-maestra.md, «PRIORIDAD MÁXIMA»): para cada uno de los 13 agentes, **una prueba E2E del ciclo completo con dobles de proveedor** y estos cinco casos: **feliz, fallo, duplicado, fuera de orden y otro tenant**.

Esta matriz es el índice de esas pruebas. Se corre **un archivo a la vez** y con el candado de memoria:

```bash
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
~/likida-loop/heavy.sh npx vitest run src/lib/likida/e2e/agente-07-cobranza.e2e.test.ts
```

Todos los datos son **sintéticos** (flotas «t-a/t-b», operadores «Ficticio», RFC y UUID de prueba, dominios `.invalid`/`.example`). Nada toca producción, Meta, SW, Resend ni OpenRouter reales: cada proveedor es un doble.

## Numeración de los 13 agentes

La numeración histórica del inventario (agentes 5–12) se corrió en uno cuando se insertó el Conductor como Agente 5 (cola maestra). Esta matriz usa la de la cola:

| # | Agente | Ciclo que cubre la prueba |
|---|---|---|
| 1 | Liquidación fase 1 (entrega del pago ya calculado) | POST `/v1/liquidaciones-externas` → cron → outbox/Meta → botón del chofer |
| 2 | Peajes (PASE × gasto × GPS × caseta) | buzón firmado → cola con claim → cruce → bitácora conciliada |
| 3 | Carta Porte multi-formato | panel / WhatsApp / correo → lectura → revisión → viaje → export |
| 4 | Vigía de servicio al cliente | mensaje del cliente → borrador con datos reales → aprobación → SLA/escalamiento |
| 5 | Conductor (ciclo del conductor) | cron + chofer + validación + tablero + estadías |
| 6 | Autofactura con proveedores | lote supervisado → portal verificado → paso humano |
| 7 | Cobranza de comprobantes | cron por tier → claim → texto/plantilla → bitácora |
| 8 | Escalación del viaje no aceptado | cron horario → claim → chofer + jefe |
| 9 | Buzón de facturas de proveedores | correo Resend firmado → bandeja → aprobación → export SAP/CONTPAQi |
| 10 | GPS (mapa y lectores) | poll/push → asentador → mapa |
| 11 | Comunicación con operadores | aceptar viaje, aviso/acuse por selector de WhatsApp, hitos (motor del Conductor) |
| 12 | Jornada | marcas + GPS → tope → alerta |
| 13 | Mis reglas | español libre → confirmación humana → vigilante SQL → WhatsApp |

## Matriz agente × caso × archivo × estado

Estado: **verde** = corrió con `heavy.sh` y pasa; **todo** = escrita como `it.todo` con motivo (la implementación vive en un worktree de la Ola 3 y no está integrada en `loop/punta-a-punta`; no hay verde falso).

| # | Feliz | Fallo | Duplicado | Fuera de orden | Otro tenant | Archivo | Estado |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 4 | 3 | 3 | 3 | `src/lib/likida/e2e/agente-01-liquidacion.e2e.test.ts` | verde (14) |
| 2 | 1 | 4 | 3 | 3 | 3 | `src/lib/likida/e2e/agente-02-peajes.e2e.test.ts` + `src/lib/likida/peajes/flujo_completo.test.ts` | verde (14 + 5); 2 todo (reclamación PASE×GPS×geocerca) |
| 3 | 3 | 5 | 4 | 4 | 4 | `src/lib/likida/e2e/agente-03-carta-porte.e2e.test.ts` | verde (20); 1 todo (salida al layout del cliente) |
| 4 | 1 | 5 | 4 | 4 | 4 | `src/lib/likida/e2e/agente-04-vigia.e2e.test.ts` | verde (18); 3 todo (grupos 10 min, histórico, copiloto) |
| 5 | 2 | 7 | 5 | 5 | 4 | `src/lib/likida/conductor/ciclo_completo.e2e.test.ts` (38 pruebas, ya existía) | verde; 7 todo en `agentes-pendientes-ola3.e2e.test.ts` (conciliación obligatoria, escalamiento a jefe de tráfico, API de validar) |
| 6 | — | — | — | — | — | `src/lib/likida/e2e/agentes-pendientes-ola3.e2e.test.ts` | todo (5) — w3-autofactura |
| 7 | 1 | 5 | 2 | 4 | 3 | `src/lib/likida/e2e/agente-07-cobranza.e2e.test.ts` | verde (15); 1 todo (cobranza por gasto) |
| 8 | 1 | 5 | 2 | 4 | 3 | `src/lib/likida/e2e/agente-08-escalacion.e2e.test.ts` | verde (15) |
| 9 | 2 | 5 | 3 | 3 | 2 | `src/lib/likida/e2e/agente-09-buzon.e2e.test.ts` | verde (15); 2 todo (PDF/zip 0530, entrega al contador 0531) |
| 10 | — | — | — | — | — | `src/lib/likida/e2e/agentes-pendientes-ola3.e2e.test.ts` | todo (6) — w3-gps-jornada |
| 11 | 3 | 4 | 2 | 3 | 1+3 | `src/lib/likida/e2e/agente-11-comunicacion-operadores.e2e.test.ts` | verde (16); 1 todo (instrucciones del convenio) |
| 12 | — | — | — | — | — | `src/lib/likida/e2e/agentes-pendientes-ola3.e2e.test.ts` | todo (5) — w3-gps-jornada (cron `jornada-alertas`) |
| 13 | 2 | 6 | 3 | 3 | 3 | `src/lib/likida/e2e/agente-13-mis-reglas.e2e.test.ts` | verde (17); 1 todo (vista del respaldo por plantilla) |
| — | Convenios/perfiles; Orquestador y tablero en vivo; modo demo 20-oct | | | | | `src/lib/likida/e2e/agentes-pendientes-ola3.e2e.test.ts` | todo (6) — w3-convenios y streams aún sin construir |

El arnés compartido vive en `src/lib/likida/e2e/db_memoria.fixture.ts` (base en memoria con `unique` → error 23505, RPC, `gt/neq`, defaults) y reutiliza los dobles que ya existían: `conductor/meta.fixture.ts` (Meta con ventana de 24 h, plantillas aprobadas y rate limit), `vigia/repo.fixture.ts`, `carta_porte_docs/{repo_falso,llm_falso,documentos_sinteticos,escenario}.fixture.ts` y `peajes/db_falsa.test.util.ts`.

## Dobles de proveedor por agente

| Proveedor | Doble | Dónde |
|---|---|---|
| WhatsApp/Meta (texto, botones, plantilla, ventana 24 h, 131047/132001/429) | `crearMeta()` | `conductor/meta.fixture.ts` |
| Outbox de WhatsApp (liquidación) | `wa_outbox` en memoria + `drenarMeta(ventanaAbierta, plantillaAprobada)` | `e2e/agente-01-…` |
| GPS (Samsara y tabla propia) | posiciones en memoria vía RPC `peaje_posiciones_ventana`; poller real en `conectores/sincronizar_gps.test.ts` | `e2e/agente-02-…`; la tabla propia es **todo** |
| PAC (cancelación CFDI) | fixtures de contrato 201/202/205/400 | `w3-autofactura` (todo) |
| Correo (Resend webhook + descarga de adjuntos + SAT) | `fetch` stub + `consultarCFDI` doble + firma svix real | `e2e/agente-09-…`, `e2e/agente-03-…` |
| OpenRouter (modelo) | `llmFalso` / `generateStructured` doble | `e2e/agente-03-…`, `e2e/agente-13-…` |

## Interfaces esperadas de lo que construye la Ola 3 (para los `todo`)

- **Conductor, conciliación obligatoria**: un «ya llegué» **sin posición GPS que lo respalde** queda `no_confirmado`, **no sella** el hito y aparece como excepción en el tablero; la posición tardía lo concilia (adenda del análisis del 1-oct). Escalamiento: aviso con botones → 2.º aviso → jefe de tráfico, con tiempos y contactos de la pantalla de configuración (w3-conductor-vigia 3106c28b). API: `POST /v1/hitos/{id}/validar` (ae0f416d).
- **GPS**: `LECTORES_POSICION` con Wialon/Geotab/Navixy/genérico (`posiciones_proveedores.ts`), `/api/gps/push/{flota}` firmado con rotación e idempotencia, asentador común (poll y push), dispositivos huérfanos sin crear unidades, semáforo en vivo/atrasada/obsoleta. **Falta** el lector de **tabla propia** de Innovativos y el importador de geocercas (columnas: unidad, lat, lon, fecha_hora, velocidad, ignición; polígono o centro+radio).
- **Jornada**: cron `jornada-alertas` + plantillas nuevas del catálogo (w3-gps-jornada).
- **Autofactura**: 0540 (paso humano), 0541 (cancelación SW sapien), 0542 (control de emisión real con lote supervisado y cupo diario), arnés `scripts/verificar-portal.mjs` (w3-autofactura).
- **Buzón**: 0530 (PDF/zip/pareja XML+PDF con rastro por archivo y marca de revisión) y 0531 (entrega al contador con CSV+ZIP, reserva atómica, rebote libera) y el webhook de eventos de Resend (w3-buzon-cobranza-reglas; ya traen su propio E2E de ingesta en su rama).
- **Cobranza por gasto** (w3-buzon-cobranza-reglas): el recordatorio nombra el gasto sin comprobante.
- **Convenios** (w3-convenios 0580): cliente → convenio → instrucciones, ligado al viaje y al Conductor.
- **Vigía**: 0484 (grupos y clientes críticos, 10 min), lector del histórico `.txt/.zip` de WhatsApp, FAQs y tendencias (w3-conductor-vigia).

## Hallazgos de esta ronda (para la auditoría de cierre de la Ola 4)

1. `hitos_viaje.ts` (`interpretarHito`/`sellarHito`) **ya no lo llama `processor.ts`**: solo lo importan `talacha_wa.ts` y `jornada/wa.ts`. Los hitos del chofer los atiende el motor del Conductor (`atenderConductor`); `hitos_viaje.ts` es código legado que sigue con pruebas unitarias. Conviene decidir si se retira o se documenta como utilitario (la prueba del Agente 11 lo trata así a propósito).
2. La prueba del Agente 11 replica el orden de llamadas del dispatcher (`processor.ts` es demasiado grande para correrlo entero con doble de base); el cableado real lo cubre `processor_hitos.test.ts`. Es una limitación declarada, no un hueco oculto.
3. Los E2E de cobranza (7), escalación (8) y reglas (13) usan una base en memoria, no Postgres: **no validan** los `CHECK`/índices únicos de las migraciones (eso es trabajo de pgTAP, `supabase/tests/`), solo la lógica de la aplicación y que cada consulta filtra por tenant.
