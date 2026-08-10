# Inventario de capa de datos — 17 páginas de "Dueño de flota" (pre-rediseño)

Escrito el 10-ago-2026, antes de borrar y rehacer las 17 páginas operativas del
panel de `flota_admin` con el lenguaje visual que estrenó `Resumen` el
7-ago-2026 (`DEGRADADO_MARCA`, `KpiDegradado`, selector semanal/mensual/
histórico). Se quedan SIN tocar por ahora: `arco`, `soporte`, `usuarios`,
`politicas`, `suscripcion`, `configuracion` (no son "el software", son cuenta/
cumplimiento) y todo el panel del Contador (`contador/*`, otro rol).

**Por qué existe este documento:** al borrar un `page.tsx`, la función de
datos que usaba (en `lib/likida/*`) NO se borra sola — sigue viva en el
repo, solo queda desconectada de cualquier UI. Este documento es el mapa para
reconectar (o decidir no reconectar) cada una cuando se rediseñe su página.

**Una excepción ya resuelta:** `getLiquidaciones` (la tabla de `cuadre`) vivía
como función LOCAL no exportada dentro de `cuadre/page.tsx` — la única de las
17 cuya lógica no estaba ya en `lib/likida`. Se movió a
`lib/likida/analytics.ts` (exportada, con su tipo `LiqRow`) el mismo día que
este inventario, para que borrar la página no la perdiera. Las otras 16 no
necesitan este paso: su lógica ya vive en `lib/likida/comercial.ts`,
`operacion.ts`, `analytics.ts`, `facturacion/*` o `cuadre/engine.ts`.

---

## 1. `despacho/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getTableroOperacion` | `lib/likida/operacion.ts` | Consulta. Agrega 6 cifras del tablero (viajes activos, sin asignar, unidades disponibles/en taller, incidencias abiertas, POD pendientes) desde `viaje`+`unidad`+`incidencia`+`pod`. Cero cifras de dinero por diseño — la matriz de roles 0044 le da al encargado asignar/exportar, no ver finanzas. |
| `getViajesSinAsignar` | `lib/likida/operacion.ts` | Consulta. Viajes con `operador_id is null` y `estatus != 'liquidado'` — la cola de "sin repartir". |
| `getCargaOperadores` | `lib/likida/operacion.ts` | Consulta. Cruza `operador`+`viaje`+`pod`+`incidencia` para calcular carga por chofer, ordenado por carga descendente. |
| `getUnidades` | `lib/likida/operacion.ts` | Consulta. **Compartida con `incidencias`, `unidades`.** Flota con el vencimiento más próximo de póliza/permiso SICT/verificación y conteo de mantenimientos abiertos. |
| `listOperadores` | `lib/likida/repo.ts` | Consulta. Choferes activos del tenant, para el selector de reasignación. |
| `crearViaje` | `lib/likida/operacion.ts` | Mutación. Inserta `viaje` (valida mismo tenant); si trae operador, avisa por WhatsApp best-effort. |
| `asignarUnidad` | `lib/likida/operacion.ts` | Mutación. `UPDATE viaje.unidad_id`, validando tenant. |
| `reasignarOperador` | `lib/likida/repo.ts` | Mutación. `UPDATE viaje.operador_id` tras comprobar que el operador es de esta flota. |

## 2. `viajes/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getViajes` | `lib/likida/analytics.ts` | Consulta. **Compartida con `incidencias`.** Los 100 viajes más recientes con operador y las 4 marcas de confirmación del chofer. |
| `contarViajes` | `lib/likida/analytics.ts` | Consulta. `COUNT(*)` exacto, opcionalmente por `estatus` — existe porque `getViajes` solo trae 100. |
| `getViajesSinLiquidar` | `lib/likida/analytics.ts` | Consulta. TODOS los viajes (sin ventana) en `abierto`/`en_cuadre`, para sumar el anticipo abierto sin subestimarlo. |
| `confirmacionDeViaje` | `dashboard/confirmacion.ts` | Cómputo puro. Deriva el estado de confirmación (5 valores) de las marcas ya traídas. |
| `resumenConfirmacion` | `dashboard/confirmacion.ts` | Cómputo puro. Suma `confirmacionDeViaje` sobre las filas visibles. |

## 3. `incidencias/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getViajes` | `lib/likida/analytics.ts` | Consulta. **Compartida con `viajes`.** Alimenta el selector de viaje al levantar una incidencia. |
| `getIncidencias` | `lib/likida/operacion.ts` | Consulta. `incidencia` + folio/unidad; calcula horas abiertas y SLA vencido (solo si hay SLA pactado). |
| `getUnidades` | `lib/likida/operacion.ts` | Consulta. **Compartida con `despacho`, `unidades`.** |
| `crearIncidencia` | `lib/likida/operacion.ts` | Mutación. Inserta `incidencia`, valida tenant del viaje/unidad. |
| `cambiarEstadoIncidencia` | `lib/likida/operacion.ts` | Mutación. `UPDATE incidencia.estado`, pone `resuelta_en` solo si `estado='resuelta'` (constraint 0047). |

## 4. `operadores/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getOperadoresDetalle` | `lib/likida/analytics.ts` | Consulta. Anticipo entregado/comprobado y % comprobado por chofer. |
| `crearOperador` | `lib/likida/administracion.ts` | Mutación. Valida nombre/teléfono, rechaza teléfono ya usado en OTRO tenant, inserta y audita. |
| `actualizarRfcOperador` | `lib/likida/repo.ts` | Mutación. `UPDATE operador.rfc` — habilita la rama RLISR 57 de viático timbrado al operador. |

## 5. `cuadre/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getKpis` | `lib/likida/analytics.ts` | Consulta. **Compartida con `valor-ahorro`, `analitica`, `chat`.** Cerradas, monto comprobado, dinero observado, con-diferencias, por-revisar, tasa de cuadre. |
| `detectarAnomalias` | `lib/likida/analytics.ts` | Consulta + detección. **Compartida con `valor-ahorro`.** Comprobante repetido entre viajes distintos. |
| `getLiquidaciones` | `lib/likida/analytics.ts` | Consulta. Últimas 50 `liquidacion` con folio, para el detalle. **Ya movida a `lib/likida` — ver nota arriba.** |

## 6. `facturacion/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getDocumentos` | `lib/likida/analytics.ts` | Consulta. **Compartida con `documentos`.** `gasto` mapeado a vista de CFDI: estado SAT, EFOS, confianza OCR. |
| `getAcreditables` | `lib/likida/analytics.ts` | Consulta. **Compartida con `chat`.** Suma IEPS/IVA/peaje/litros acreditables — IEPS en litros, no en pesos. |

## 7. `cobranza/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getCobranza` | `lib/likida/comercial.ts` | Consulta. `factura_emitida` + vista `factura_saldo` (nunca columna guardada) + `cliente`. Sin `vence_en` = "sin plazo", nunca "vencido". |

## 8. `valor-ahorro/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getValorAhorro` | `lib/likida/analytics.ts` | RPC `resumen_documentos_tenant()` + conteos exactos + costo de IA por fase — conteos reales más UNA estimación declarada. |
| `getKpis` | `lib/likida/analytics.ts` | Compartida — ver §5. |
| `detectarAnomalias` | `lib/likida/analytics.ts` | Compartida — ver §5. |
| `MINUTOS_CAPTURA_MANUAL` | `lib/likida/analytics.ts` | Constante `=4`, el supuesto declarado de "horas ahorradas". |

## 9. `unidades/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getUnidades` | `lib/likida/operacion.ts` | Compartida — ver §1. |
| `crearUnidad` | `lib/likida/operacion.ts` | Mutación. Inserta `unidad`, único obligatorio: `numero_economico`. |
| `cambiarEstadoUnidad` | `lib/likida/operacion.ts` | Mutación. `UPDATE unidad.estado`, valida dominio de 4 valores antes de llamar. |

## 10. `pod/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getPods` | `lib/likida/operacion.ts` | Consulta. Parte de TODOS los viajes en curso (left-join con `pod`), para que uno sin registro siga apareciendo. |
| `marcarPodPedido` | `lib/likida/operacion.ts` | Mutación. Inserta `pod` pendiente, valida tenant. |
| `rechazarPod` | `lib/likida/operacion.ts` | Mutación. `UPDATE pod.estado='rechazado'` + nota, sin borrar el archivo. |
| `sendTemplate` | `lib/meta/client.ts` | WhatsApp real, plantilla `pod_pendiente`, disparada tras `marcarPodPedido`. |
| `motivoDeFalloWhatsApp` | `lib/meta/client.ts` | Pura. Traduce errores de Meta a mensaje legible. |

## 11. `analitica/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getKpis` | `lib/likida/analytics.ts` | Compartida — ver §5, aquí con ventana de días del filtro global. |
| `getGastoPorConcepto` | `lib/likida/analytics.ts` | Consulta. `gasto` agrupado por concepto, ordenado por total. |
| `getLiquidacionesPorDia` | `lib/likida/analytics.ts` | Consulta. Agrupado por día calendario en hora LOCAL (America/Mexico_City) — corrige el bug real de desfase UTC. |
| `etiquetaConcepto` | `lib/likida/cuadre/engine.ts` | Pura. **Compartida con `documentos`.** Mapea concepto/producto OCR a etiqueta legible. |

## 12. `chat/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getKpis` | `lib/likida/analytics.ts` | Compartida — ver §5. |
| `getAcreditables` | `lib/likida/analytics.ts` | Compartida — ver §6. |

Nota: ambas se llaman DESPUÉS de `puedeVerArea(rol,'dinero')` — antes de ese
chequeo el rol `encargado` podía leer cifras de dinero por esta pantalla
aunque el resto del panel se las negara.

## 13. `rentabilidad/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getRentabilidad` | `lib/likida/comercial.ts` | Consulta. `viaje.ingreso_flete` vs `liquidacion.total_comprobado`. NUNCA usa `anticipo` como sustituto de ingreso. `margenPct` es `null`, no `0`, sin ingreso capturado. |

## 14. `clientes/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getCartera` | `lib/likida/comercial.ts` | Consulta. `cliente` + `viaje`. Sin `ingreso_flete` cuenta en `viajesSinIngreso`, nunca como `$0`. `concentracion` es `null` sin ingreso capturado. |

## 15. `mapa/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getEstadoRastreo` | `lib/likida/comercial.ts` | Consulta. `rastreo_credencial` + `posicion` — el token nunca sale completo, solo últimos 4 dígitos. **No es un mapa real, es un estado de conexión** (Wialon/Traccar/Samsara/Geotab/Navixy). |

## 16. `cotizador/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getCotizaciones` | `lib/likida/comercial.ts` | Consulta. `cotizacion` + nombre de cliente. Margen calculado en la página, solo si `precio` Y `costoEstimado` están presentes. |

## 17. `documentos/page.tsx`

| Función | Archivo | Qué hace |
|---|---|---|
| `getDocumentos` | `lib/likida/analytics.ts` | Compartida con `facturacion` — ver §6. |
| `getPorFacturar` | `lib/likida/facturacion/pendientes.ts` | Consulta + cómputo. `gasto` sin `cfdi_uuid` (paginado completo), identifica comercio/portal y calcula caducidad para facturar. |
| `resumirFacturas` | `lib/likida/facturacion/pendientes.ts` | Pura. Total, vencidos, urgentes, sin comercio, monto total/vencido. |
| `avisarPorFacturar` | `lib/likida/facturacion/avisar.ts` | Mutación + WhatsApp real. Un mensaje por lote (máx. 6 líneas), plantilla `plazo_factura`, audita a quién se avisó. |
| `etiquetaConcepto` | `lib/likida/cuadre/engine.ts` | Compartida con `analitica` — ver §11. |

---

## Archivos de prueba dedicados

Solo una de las 17 tiene test propio co-localizado — se borra junto con la página:

- `dashboard/despacho/vista.test.tsx` — prueba `TableroCifras` contra `TableroOperacion`.

Las otras 16 no tienen `page.test.tsx`/`vista.test.tsx` propio. Los tests de
las funciones de `lib/likida/*` (`operacion.test.ts`, `analytics*.test.ts`,
`comercial.test.ts`, etc.) NO se tocan — viven en `src/lib/likida/`, no se
borran con las páginas.

## Apéndice — infraestructura de sesión/tenant (no es lógica de negocio)

Idéntica en las 17 páginas, no hay nada que "reconectar" distinto por página:

| Función | Archivo | Qué hace |
|---|---|---|
| `resolverTenantEfectivo` | `lib/auth/tenant-efectivo.ts` | Resuelve `{tenantId, rol}` efectivo (soporta `?rol=` de superadmin), gatea la ruta. |
| `requireSessionTenant` | `lib/auth/guard.ts` | Sesión real; se repite DENTRO de cada server action, no confía en el closure del render. |
| `resolverTenantPedido` | `lib/auth/tenant-api.ts` | Valida que el tenant pedido por un superadmin exista. |
| `exigirVerRuta` | `lib/auth/guard.ts` | `requireSessionTenant` + chequeo de visibilidad por rol. |
| `puedeAsignar`/`puedeAdministrar`/`puedeVerArea`/`puedeExportar` | `lib/auth/permisos.ts` / `visibilidad.ts` | Puras, sin I/O — deciden qué se pinta o qué acción corre. |
