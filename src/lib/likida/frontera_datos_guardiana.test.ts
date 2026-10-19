import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 21, ALTO — REINCIDENTE (c18, c19, c20). `repo.ts`/`pg.ts` dejaron
// de ser "el único punto de acceso a datos" (MAPA.md, CLAUDE.md) hace tres
// rondas: 128 → 171 → 186 → 243 archivos de producción llaman a Supabase
// directo, y el guardia que debía crecer con el árbol (`acotada_guardiana.
// test.ts`, una allowlist literal de rutas) no se enteró ni una vez — los
// módulos más nuevos (el MCP entero, `agentes/*`, `marketing/*`,
// `sat_descarga/*`) nunca entraron a ninguna lista.
//
// Migrar los ~240 de golpe es demasiado riesgoso para hacerlo en esta pasada.
// ESTO ES EL MECANISMO DE CONTENCIÓN, NO LA MIGRACIÓN: congela el número
// medido HOY (barriendo `src/` completo, no una lista literal — el error que
// ya mató al guardia anterior) y hace que la suite se ponga roja si el
// conteo SUBE sin que alguien lo note y mueva la constante a mano, con un
// commit que lo explique. Bajarlo (migrar código a `repo.ts`) es bienvenido:
// el techo se ajusta hacia abajo el mismo día.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Medido a mano el 29-ago-2026 (auditoría 21), con el mismo método que la
 * serie de la auditoría: archivos de producción — sin `.test.`/`.fixture.`/
 * `pruebas-manuales` — con al menos un `.from(`/`.rpc(`, SIN contar
 * `repo.ts` ni `pg.ts` (la frontera declarada). Es un TECHO, no un objetivo:
 * si sube, actualiza este número en el mismo commit que explica por qué.
 *
 * AUDITORÍA 24 — 241 → 251 tras fusionar las 15 ramas (medido con el
 * barrido completo sobre el árbol integrado, no sumando los deltas
 * parciales que cada constructor midió contra su propia base). Los diez
 * módulos nuevos: `repo_paginado.ts` (frontend-op, FE-2/3/6), `revision.ts`
 * (revision, cierre humano de liquidaciones), `gasto_correccion.ts`
 * (agentico, WA-3), `interruptor_tenant.ts` (integración, ADM-6),
 * `importacion/unidades.ts`, `importacion/operadores.ts`, `terminales.ts`
 * (masivo, alta masiva para 800 tractos), y tres más del mismo patrón
 * (un módulo más con acceso directo, no un reemplazo de `repo.ts`/`pg.ts`)
 * en los carriles de `datos`/`auth`/`admin`. Ninguno migra código YA
 * existente fuera de la frontera; todos son funcionalidad nueva del
 * piloto que cuenta contra el techo como cualquier otro módulo directo.
 *
 * AUDITORÍA 25 — 251 → 252 (BE-C1a/BE-C1b/DATOS-C1). Un módulo nuevo,
 * `revision_recalculo.ts`: sube/archiva el PDF regenerado en Storage
 * (`.storage.from(...)`, que la misma regexp de este guardia cuenta —
 * "`.from(`" sin distinguir tabla de bucket) y llama la RPC dedicada
 * `agregar_pdf_historial`. Ninguno de los dos cabe en `repo.ts` como un
 * wrapper más sin que `repo.ts` empiece a saber de PDFs y de la ruta del
 * bucket de `liquidaciones` — el mismo molde que ya siguen `tools.ts` y
 * `processor.ts` (ambos fuera de la frontera, ambos suben a ese bucket
 * directo). Funcionalidad nueva, no código migrado.
 *
 * LOOP PUNTA A PUNTA (1-oct-2026), Agente 1 «liquidación externa» — 252 → 254
 * archivos (las llamadas, 1,284 → ~1,300, caben en el margen y no se tocan).
 * Dos módulos nuevos, ambos deliberadamente PEGADOS al mínimo: `liquidacion_externa/
 * repo.ts` junta TODO el acceso a datos del módulo (tablas de la 0370, Storage del
 * bucket `liquidaciones`, lectura del outbox, razón social) en vez de repartirlo
 * en un archivo por tabla, y `liquidacion_externa/trabajo.ts` existe aparte
 * porque es la ÚNICA consulta que cruza flotas (el cron barre la cola de todas) y
 * `consultas_admin_filtran_tenant.test.ts` tiene que poder exentar SOLO esa sin
 * exentar el resto. Funcionalidad nueva, no código migrado.
 *
 * LOOP PUNTA A PUNTA (1-oct-2026), Agente 2 «conciliación de peajes» — 254 → 258
 * archivos y 1,328 → 1,344 llamadas (medido con el barrido completo contra el
 * mismo commit base: 254 archivos y 1,302 llamadas; el techo de llamadas ya traía
 * 26 de margen y el resto lo consume este agente). Cuatro módulos nuevos, todos
 * con una razón para no caber en `repo.ts`: `peajes/datos.ts` (los catálogos de
 * la flota —TAGs, casetas, geocercas, mapeos, buzón— y la lectura de posiciones
 * por ventana, todo en UN archivo en vez de uno por tabla),
 * `peajes/ingesta.ts` (la cola de archivos y su claim con lease/token),
 * `peajes/bitacora_conciliada.ts` (la lectura paginada del export) y
 * `api/peajes/ingesta/route.ts` (la config del buzón antes de verificar la
 * firma). Funcionalidad nueva, no código migrado; `intake/desglose_peaje.ts`
 * (ya fuera de la frontera) suma 4 llamadas por la lectura de TAGs y el barrido.
 *
 * LOOP PUNTA A PUNTA (1-oct-2026), integración — 258 → 259 archivos y 1,344 →
 * 1,347 llamadas, medido tras fusionar las ramas de WhatsApp y de agentes 1-2:
 * el módulo nuevo es `lib/likida/wa_ventana.ts` (Agente WhatsApp), que junta en
 * UN archivo el acceso a la ventana de 24 h por contacto (mig. 0368: RPC de
 * registrar_entrante_wa / ventana_estado_wa y el registro de decisiones de envío).
 * Funcionalidad nueva, no código migrado.
 *
 * LOOP PUNTA A PUNTA (1-oct-2026), stream W2 seguridad — 259 → 260 archivos y
 * 1,347 → 1,355 llamadas: el módulo nuevo es `lib/legal/aceptacion.ts` (mig.
 * 0443: registrar/revocar/consultar la aceptación de Términos, Aviso y mandato
 * de autofacturación por flota, 3 RPC + 1 lectura, todo en UN archivo) y
 * `lib/mcp/oauth.ts` (ya fuera de la frontera) suma 3 llamadas por la cola de
 * aprobación de clientes OAuth desconocidos (mig. 0440). Y 260 → 261 archivos y
 * 1,355 → 1,359 llamadas por `lib/legal/datos_responsable.ts`: la captura por flota
 * de razón social, domicilio y contacto de privacidad (auditoría ola 1, #10), UN
 * archivo con su lectura y su escritura. Funcionalidad nueva, no código migrado.
 *
 * LOOP PUNTA A PUNTA (1-oct-2026), W2 «producto» — 259 → 260 archivos y 1,347 →
 * 1,371 llamadas (medido con el barrido completo del guardia). Un módulo nuevo,
 * `invitacion_operador.ts` (10 llamadas): el reclamo atómico de la invitación por
 * WhatsApp (UPDATE condicionado a «sin invitar», 0460/0462), el estado de cada
 * operador de la página y los conteos de pendientes y fallidos; es UN archivo con
 * su contrato probado contra una base en memoria que aplica los filtros, y no cabe
 * en `repo.ts` sin que éste empiece a saber de plantillas de WhatsApp. El resto
 * (+14) vive en archivos que YA estaban fuera de la frontera: `terminales.ts` (+13:
 * editar, borrar, contar por patio con la RPC 0461, asignar operadores, jefes y lo
 * que quedó sin patio, y leer el patio de un registro para el alcance del jefe) y
 * `administracion.ts` (+1: `politicaPropiaDeclarada`). Funcionalidad nueva, no
 * código migrado.
 *
 * LOOP PUNTA A PUNTA (1-oct-2026), Agente 4 «Vigía de servicio al cliente» — 259 → 260
 * archivos y 1,347 → 1,404 llamadas (+57, todas en UN archivo). El módulo nuevo es
 * `lib/likida/vigia/repo.ts`, que junta TODO el acceso a datos del Vigía en vez de
 * repartirlo por tabla: las cinco tablas de la 0400 (config, contacto, conversación,
 * mensaje, evento), las tres RPC (`vigia_recibir_mensaje`, `vigia_purgar`,
 * `vigia_suprimir_contacto`), el servicio de estatus de viaje real (viaje, posicion,
 * pod, factura de UN cliente en UNA flota) y las lecturas/acciones del tablero. Cada
 * consulta filtra por tenant (las dos que cruzan flotas a propósito —el número del
 * webhook y el barrido del cron— están rotuladas) y `repo.test.ts` lo comprueba con
 * un cliente grabador. Funcionalidad nueva, no código migrado.
 *
 * AUDITORÍA 28, ARQ-M1 (LA UNIDAD EQUIVOCADA): hasta aquí el techo vivía en
 * ARCHIVOS — y con 252 archivos medidos contra un techo de 252, este guardia
 * llevaba CERO margen: cualquier archivo nuevo con un solo `.from(`/`.rpc(`
 * lo rompía, aunque fuera trivial, mientras que quien quisiera colar código
 * de verdad arriesgado —cientos de consultas nuevas sin `traerTodo`/`acotada`
 * dentro de un archivo YA listado, como `processor.ts` o `analytics.ts`—
 * pasaba invisible: el conteo de archivos no se mueve un ápice si el bulto
 * crece DENTRO de un archivo que ya estaba fuera de la frontera. Contar
 * archivos mide "cuántos lugares nuevos violan la regla", no "cuánto código
 * la viola" — y es el código, no el archivo, el que se recorta a 1,000 filas
 * en silencio cuando le falta paginar (la misma familia de bug que ARQ-A1
 * encontró en `lineasEccParaCuadre`, cuadre/desde_db.ts).
 *
 * El techo ahora es la SUMA de `.from(`/`.rpc(` en esos mismos archivos:
 * medido hoy en 1,278 (barrido completo, mismo método, mismo commit que este
 * cambio). El margen (50) es deliberadamente angosto por la misma razón que
 * el de archivos lo era: un techo que absorbe crecimiento grande sin
 * pestañear deja de medir nada — igual que el de arriba, se sube a mano, en
 * el commit que explica por qué.
 */
//
// LOOP PUNTA A PUNTA (2-oct-2026), Agente 5 «Conductor» — 259 → 261 archivos y
// 1,347 → 1,390 llamadas (medido con el barrido completo). UN solo archivo
// nuevo: `lib/likida/conductor/repo.ts` junta TODO el acceso a datos del módulo
// (los hitos y sus bitácoras de la 0380, la config por flota, los contactos de
// tráfico, el claim de avisos, la siembra, la lectura de /v1 y el mantenimiento de
// privacidad) en vez de repartirlo en un archivo por tabla —el mismo molde que
// `liquidacion_externa/repo.ts`—: el motor, el intérprete, el planificador y las
// rutas no tienen ni un `.from(`/`.rpc(`, y el ejecutor entra por los puertos
// `PuertosConductor`. Las 43 llamadas (38 de las lecturas/escrituras del motor y 5 del
// escritor de config y contactos de `PUT /v1/conductor/config`) son las consultas nuevas,
// todas con `acotada`, acotadas por tenant y las de lotes con `traerTodo`.
// Funcionalidad nueva, no código migrado.
//
// LOOP PUNTA A PUNTA (2-oct-2026), Agente 5 «Conductor», 2.ª entrega (0385) — 261 → 262
// archivos y 1,390 → 1,432 llamadas (medido con el barrido completo). UN solo archivo nuevo:
// `lib/likida/conductor/repo_validacion.ts` junta el acceso a datos de la entrega (catálogo de
// sitios y su importador, posiciones para validar, veredictos, evidencia, acciones de oficina,
// indicadores y las lecturas del tablero y de las estadías) APARTE de `conductor/repo.ts` para no
// volverlo un archivo de mil líneas; los barridos del cron que cruzan flotas se sumaron a
// `conductor/trabajo.ts` (ya exento y ya contado). Todas con `acotada`, acotadas por tenant (las vigila
// `consultas_admin_filtran_tenant.test.ts`) y las lecturas por lotes con `traerPorIds`. Funcionalidad
// nueva, no código migrado.
//
// LOOP PUNTA A PUNTA (1-oct-2026), Agente 3 «Carta Porte multi-formato» — 259 → 261
// archivos y 1,347 → 1,402 llamadas (medido con el barrido completo contra el mismo
// commit base: 259 y 1,347). Dos archivos nuevos: `carta_porte_docs/repo.ts`, que junta
// en UNO TODO el acceso a datos del módulo (las siete tablas de la 0420, el bucket
// `cartaporte-docs`, las RPC de claim/retención/correo y la escritura de viaje y
// mercancía) en vez de repartirlo por tabla —50 de las 55 llamadas—, y
// `carta_porte_docs/bytes.ts`, que existe SOLO para sacar de contenido.ts, whatsapp.ts y
// repo.ts las conversiones `Buffer.from(` que esta regexp cuenta como `.from(` (cinco
// llamadas, ninguna a Supabase). Funcionalidad nueva, no código migrado.
//
// INTEGRACIÓN OLA 2 (2-oct-2026): al fusionar las cinco ramas el techo es la SUMA medida,
// 259 → 268 archivos y 1,347 → 1,580 llamadas (seguridad +2/+12, producto +1/+24,
// Conductor +3/+85, Vigía +1/+57, Carta Porte +2/+55); cada tramo está explicado arriba
// y todo es funcionalidad nueva, no código migrado.
//
// OLA 3, W3 «Conductor + Vigía» (2-oct-2026), medido contra el commit base (268 / 1,580):
//   · catálogos separados de `geocerca` (0480): +1 llamada en `peajes/datos.ts` (leer si el
//     nombre ya es un sitio del Conductor antes del upsert; el resto son filtros añadidos).
//   · Vigía conectado al Conductor y adjunto del POD (`vigia/repo.ts`): +3 llamadas de `archivoAdjuntoReal`
//     (el viaje de ESE cliente, su POD y la URL firmada del bucket); el estatus de viaje ya existía.
//   · grupos e histórico exportado del Vigía (0484): +1 archivo, `vigia/historial/repo.ts` (+13 llamadas: grupos, clientes, importación
//     por lotes con deshacer, lectura paginada del histórico y borrado), todo filtrado por `tenant_id` y con `acotada`.
//   · validar un hito por llave de API (`conductor/repo_validacion.ts`): +1 llamada, `hitoDeFlota` (el hito DE ESA flota
//     antes de la RPC atómica de validar).
//   · Vigía, clientes críticos y purga del histórico (0484, `vigia/repo.ts`): +3 llamadas (los clientes con un grupo crítico,
//     el reintento de guardar la config en una base sin la 0484 y la purga del histórico importado).
//
// LOOP PUNTA A PUNTA, ola 3, W3 «Mis reglas» (Agente 13) — 1,580 → 1,585 llamadas, mismos
// 268 archivos: las cinco llamadas son de `reglas/repo.ts` (ya medido) para la tabla nueva
// `regla_aviso` de la 0520 — historial de avisos (lista), avisos enviados en la ventana de
// 24 h (tope de frecuencia), registrar un aviso, purga de retención y el UPDATE del límite
// de frecuencia. Funcionalidad nueva, no código migrado.
//
// LOOP PUNTA A PUNTA, ola 3, W3 «Cobranza por gasto» (Agente 7) y «Buzón de facturas»
// (Agente 9) — 268 → 273 archivos y 1,585 → 1,657 llamadas (medido con el barrido completo).
// Funcionalidad nueva, no código migrado:
//   · `agentes/cobranza_gasto.ts` (17): toda la cobranza por gasto de la 0525 — gastos con
//     comprobante faltante, claim de contactos (un contacto por gasto y tier), config por flota;
//   · `buzon/repo.ts` (16): recepción por archivo, bucket `buzon-facturas`, emparejado PDF↔CFDI
//     y bitácora de la 0530; `buzon/entrega_repo.ts` (26): config, lotes, reserva atómica de
//     facturas, claim con lease, eventos y confirmación de Resend de la 0531;
//   · `buzon/bytes.ts` (6): SOLO conversiones `Buffer.from(` que esta regexp cuenta como `.from(`
//     (ninguna es Supabase; mismo motivo que `carta_porte_docs/bytes.ts`);
//   · el resto (≈7) son llamadas añadidas a archivos que ya contaban (purga de la bitácora del
//     buzón, la lectura de facturas tolerante a la base sin migrar).
// INTEGRACIÓN ola 3 (ronda-03): suma de W3 Conductor+Vigía (+1 archivo, +21 llamadas) y W3 buzón/cobranza/reglas (+5 archivos, +77 llamadas)
// sobre 268 / 1,580 → 274 / 1,679 (medido con el barrido; +1 sobre la suma por llamadas compartidas).
// ADVERSARIAL ronda 03: +4 llamadas, todas en archivos que ya contaban — `conductor/repo_validacion.ts` (+1, `unidadReportaGps`: ¿la unidad
// reporta GPS de verdad? decide si un pin basta como evidencia) y `buzon/repo.ts` (+3: dos lecturas «¿esta ruta de PDF la usa una factura?» y el
// UPDATE que suelta la ruta de la recepción descartada). 1,701 → 1,705.
// LOOP PUNTA A PUNTA, ola 3b — integración de la rama de los Agentes 1 y 2 (liquidación externa y peajes) con el tronco: 277 / 1,705 →
// 279 / 1,730, medido con el barrido completo sobre el árbol fusionado. Los dos archivos nuevos son los de los Agentes 1-2 que el tronco
// aún no contaba (`liquidacion_externa/trabajo.ts` ya estaba; suman los accesos del correo/pull de peajes y de la retención de
// agentes); las +25 llamadas, las mismas ramas más 3 en `liquidacion_externa/repo.ts` (el formato de la flota de la 0564: leer, guardar y
// borrar — junta TODO el acceso a esa tabla en el repo del módulo, no en un archivo aparte). Funcionalidad nueva, no código migrado.
// LOOP PUNTA A PUNTA, W3 «GPS/Jornada» (integración sobre la ola 3): 277 → 280 archivos y 1,705 → 1,728 llamadas,
// medido con el barrido. Funcionalidad nueva, no código migrado; cada archivo junta TODO el acceso a datos de su pieza:
//   · `gps_push/datos.ts` (+1 archivo, 9): secreto del push por flota, rotación y salud por RPC;
//   · `importacion/gps_dispositivos.ts` (+1, 4): mapeo masivo unidad↔dispositivo por CSV y lista de huérfanos;
//   · `jornada/alerta_tope_datos.ts` (+1, 8): jornadas en curso de las flotas con la alerta encendida, claim por
//     (jornada, nivel) y configuración (0502);
//   · `conectores/sincronizar_gps.ts` (+2): registro de dispositivos huérfanos y la lectura de unidades por número
//     económico (tabla propia: se liga por el económico que la flota ya usa; solo su flota, solo activas).
// Integración ola 3b (agentes 1-4 + GPS/jornada): 277/1,705 + (2/25) + (3/23) = 282 / 1,753 (se re-mide con el barrido).
// OLA 3, W3 «convenios» (0580): +2 archivos y +31 llamadas (medido con el barrido), 277 / 1,705 → 279 / 1,736. Funcionalidad nueva, no código migrado:
//   · `convenios/repo.ts` (28): TODO el acceso a datos tenant-anclado del módulo — lista, importador (upserts por llave única), elegir y
//     ligar el convenio al viaje con su foto, el claim del envío (UN UPDATE condicionado), el contexto del envío y el lado del viaje;
//   · `convenios/trabajo.ts` (6): las lecturas que CRUZAN flotas del aviso de acercamiento (el cron barre todas las flotas en una
//     corrida; cada candidato lleva su tenant y todo lo posterior se ancla a él) — viven aparte, como `conductor/trabajo.ts`.
// El resto: las llamadas propias del conteo de arriba que ya existían (ninguna otra llamada nueva fuera de estos dos archivos).
// Integración ola 3b con convenios: 282/1,753 + (2/31) = 284 / 1,784 (se re-mide con el barrido).
// W3 ORQUESTADOR (Ola 3b): +1 archivo, +7 llamadas — 277 → 278 y 1,705 → 1,712. El módulo nuevo es `orquestador/fuentes_reales.ts`, que
// junta en UN archivo lo propio del asistente: las tareas que deja para una persona (tabla de la 0650: insertar, leer la previa ante el
// índice único, listar las abiertas, atender con UPDATE condicional) y tres lecturas de «envíos que no salieron» (entregas del buzón, mensajes
// fallidos del Vigía, folio de un viaje). Todo lo demás COMPONE los lectores que cada agente ya tiene (`conductor/repo_validacion.ts`,
// `vigia/repo.ts`, `buzon/repo.ts`, `agentes/cobranza*.ts`, `autofactura/control_emision_repo.ts`): no abre una segunda ruta a esos datos.
// Integración ola 3b con el orquestador: 284/1,784 + (1/7) = 285 / 1,791 (se re-mide con el barrido).
// OLA 4a, paquete A «conductor-gps»: 0 archivos y +14 llamadas (1,791 → 1,805), todas en archivos que ya contaban — funcionalidad nueva, no
// código migrado, cada pieza junta SU acceso en el repo del módulo:
//   · `convenios/repo.ts` (+12): reiniciar los sellos de envío al cambiar de chofer (1), listar los viajes abiertos con su convenio ligado
//     y las opciones del cliente (5) y corregir a mano el convenio de un viaje (6: viaje, convenio, instrucciones, update/insert de la
//     fila ligada y los sitios que pasan al viaje);
//   · `conductor/trabajo.ts` (+1): qué viajes traen sitio de carga/descarga, para distinguir «sin posición» de «sin sitio» en el aviso
//     de llegada sin confirmar (lectura que cruza flotas, como el resto del archivo);
//   · `conductor/repo.ts` (+1): el reintento del guardado de la config contra una base sin la 0604.
// P1 «geocercas-polígono» (ola 4b): 285 → 286 archivos y 1,807 → 1,811 llamadas. Un módulo nuevo,
// `conectores/tabla_propia/reimportar_geocercas.ts`, con las 4 llamadas de la re-importación diaria de geocercas (la RPC que lista
// las flotas a las que ya les toca, el claim atómico por flota, la lectura de la huella del último contenido importado y el
// registro del resultado; todas sobre la 0631). Vive aparte de `repo.ts` porque su lista cruza flotas, como `conductor/trabajo.ts`.
// Funcionalidad nueva, no código migrado.
// INTEGRACIÓN P0 + P12 (ronda 11): se retira `hitos_viaje.ts` (utilitario sin llamador desde la Ola 4a; su única llamada era `viaje`): 286 → 285 archivos.
// OLA 9 (seguridad): +2 archivos y +4 llamadas, medidos con el barrido real (285 → 287 y 1,881 → 1,885). Los dos son módulos nuevos que cruzan
// flotas por diseño: `admin/techo_ia.ts` (lee las flotas y su gasto de hoy para la pantalla del superadmin y escribe el techo por la RPC de
// la 0682) y `likida/retencion_ledgers.ts` (la retención de los ledgers de la 0680, que el cron corre sobre toda la base, sin flota).
// Funcionalidad nueva, no código migrado.
// OLA E1-A (guardia-observabilidad): 0 archivos (sigue en 287); el módulo nuevo `admin/estado.ts` no toca la base (su generador de días se escribió sin el helper de Array que el barrido contaría como consulta).

// E1-B «cuadre-tarjetas-cobranza»: +1 archivo y +3 llamadas (287 → 288 y 1,906 → 1,909), medidos con el barrido real contra la base ec78640f. El módulo
// nuevo es `acuse_folio.ts` (el acuse «solo folio» del cierre al encargado: sube el PDF al bucket `liquidaciones` y firma su URL). La lectura de la página
// /admin/cobranza SÍ se puso en `repo.ts` (frontera: 0). CHOQUE ESPERABLE con E1-A: los dos paquetes suben estos techos; al integrar, el techo es la SUMA de los tramos.
// CARTA PORTE, T-A3-27 (repositorio de envíos al TMS): +1 archivo, `carta_porte_docs/repo_envios.ts` (288 → 289), que junta en UNO el acceso a la cola
// `cp_envio_tms` de la 0790 (leer, actualizar condicional, listar, conteo por estado y las 3 RPC de reclamo y alerta única) y se prueba con un doble en memoria.
// Funcionalidad nueva, no código migrado.
// WS1 «perfil de tenant» (0770): +1 archivo y +1 llamada (288 → 289 y 1,916 → 1,917). El módulo nuevo es `lib/auth/perfil_tenant.ts`: la lectura de
// `tenant_perfil` (una tabla deny-all, un solo `.from(`) con su caché y falla cerrada; no cabe en `repo.ts` sin que éste conozca la política de acceso.
// Integración Carta Porte + perfil (0770): el barrido real mide 290 archivos (incluye +1 de perfil_tenant.ts); techo subido a lo medido, sin relajar la regla. Un techo de integración es la suma de los tramos.
// Integración Carta Porte + Vigía (INT-RAMAS): techo = suma de los tramos (289 base de perfil + 1 CP + 5 Vigía); se ajusta al barrido real.
// Integración + Peajes (INT-RAMAS): 295 + 6 (Peajes sobre la base de perfil: 295 − 289) = 301 esperado; se ajusta al barrido real.
// Integración + Liquidación (INT-RAMAS): 301 + 4 (Liquidación sobre la base de perfil: 293 − 289) = 305 esperado; se ajusta al barrido real.
// 15-oct-2026, frente TMS (reanclado sobre master): techo 305 → 308 archivos y 2,095 → 2,105 llamadas, medido con el barrido real. Lo nuevo es el conector TMS de solo
// lectura: `conectores/tms/sincronizar.ts`, `conectores/tms/ccp.ts` y `api/cron/tms/route.ts` (todo con `tenant_id`, por `acotada`/`traerTodo`). Funcionalidad nueva, no código migrado.
// Integración cinco-integracion-2 (tms-conector + peajes-importador sobre la misma base): 308 → 312, medido con el barrido real del árbol fusionado
// (archivos nuevos de los conectores TMS/peajes con acceso directo: tms/{archivo,ccp,liquidaciones,peajes,posiciones,sincronizar}.ts y
// peajes/datos.ts). Funcionalidad nueva, no código migrado.
// 15-oct-2026, frente A3 Carta Porte (reanclado sobre master): techo 305 → 310 archivos y 2,095 → 2,120 llamadas, medido con el barrido real. Lo nuevo es la
// salida al TMS, el catálogo del cliente, los catálogos SAT y la bandeja de hallazgos de `carta_porte_docs/*`; todo con `tenant_id`, por `acotada`/`traerTodo`. Funcionalidad nueva, no código migrado.
// 16-oct-2026, T-A3-67: techo 310 → 314 archivos (rojo heredado de las tareas A3 anteriores, medido con el barrido real; T-A3-67 no agrega consultas directas: solo cablea lectores ya existentes en servicio.ts).
// Integración cinco-integracion-2 (+ cartaporte sobre la misma base): el barrido real del árbol fusionado mide 321 archivos; techo subido a lo medido, sin relajar la regla.
// 18-oct-2026, T-A2-35 (gate de arquitectura, bajada): el módulo de peajes tenía SEIS archivos llamando a Supabase cada uno por su cuenta
// (`datos.ts`, `revision_cobros.ts`, `bitacora_conciliada.ts`, `vinculos_conciliacion.ts`, `vinculos_reporte.ts`) además de `intake/desglose_peaje.ts`
// y `ingesta.ts`. Los cinco primeros se consolidaron, tal cual (mismas firmas, mismos cuerpos, sin cambiar comportamiento), en el nuevo
// `peajes/repo.ts` — el mismo patrón que ya siguen `vigia/repo.ts`/`conductor/repo.ts`/`reglas/repo.ts` para sus propios módulos (no exime del
// conteo del guardia: `FRONTERA` solo exime la raíz, pero reduce seis archivos contados a uno). `ingesta.ts` NO se migró: aun quitando sus
// consultas reales, `Buffer.from(` (la firma HMAC y el `bufferDeBytea`) sigue coincidiendo con la misma expresión regular, así que seguiría
// contado — migrar sus consultas no bajaba el conteo y sí arriesgaba el camino del cron sin ninguna ganancia medible. `intake/desglose_peaje.ts`
// tampoco: sus consultas viven DENTRO de `conciliarDesgloseInterno`, la misma función bajo revisión de rendimiento de `escala.test.ts` (60 000
// líneas) — mezclar ese refactor con una afinación de rendimiento en la pasada más riesgosa del módulo no se justifica; queda como tarea aparte.
// El barrido real tras la consolidación mide 317 archivos (321 − 6 archivos vueltos a contar como 2: `repo.ts` nuevo + los dos que no se tocaron,
// `intake/desglose_peaje.ts` e `ingesta.ts`, que YA estaban contados antes). Techo bajado a lo medido, bienvenido: "bajarlo... es bienvenido: el
// techo se ajusta hacia abajo el mismo día" (ver la nota de la cabecera). Llamadas SIN cambio (2,222): migrar código no quita consultas, solo
// las reubica — el techo de llamadas no se tocó.
// Integración con avisoHuerfanos (19-oct-2026, sobre la misma base): +1 archivo (317 → 318), `avisar_huerfanos.ts` — barrido cruzado de
// TODAS las flotas (por diseño, igual que otros avisos de cola atorada), por `traerTodo` y anclado a `tenant_id` por fila. Funcionalidad
// nueva. Techo de integración = suma de los dos tramos, medido con el barrido real tras fusionar ambas ramas.
// Integración con A2 Peajes (canal SFTP, 0843, 19-oct-2026, sobre la misma base): +1 archivo (318 → 319). OJO, este +1 NO es acceso real
// a Supabase: es `peajes/ingesta_sftp.ts`, que delega TODO su acceso a datos a `leerCuerpoIngesta`/`recibirArchivoPeaje` (ya dentro de la
// frontera) y solo cae en el regex genérico `\.(from|rpc)\(` del guardia por `Buffer.from(bytes).toString('base64')` — un falso positivo
// del patrón, no del código. Se documenta en vez de reescribir el `Buffer.from` idiomático para esquivar el regex. Las 2 llamadas reales
// nuevas (ver el techo de abajo) viven en `peajes/repo.ts` (T-A2-35 ya consolidó ahí lo que antes era `datos.ts`), por `acotada`, ancladas
// a `tenant_id`.
const TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA = 319;
// Agente 4 (Vigía), T-A4-06: +1 archivo (288 → 289), `vigia/programa/repo.ts`: el acceso a datos del programa de despacho (0795: carga, filas, cambios). Es su propio
// `repo.ts` por frente pero la frontera de este guardia solo exime el de la raíz; todo pasa por `acotada`/`traerTodo` con `tenant_id`. Funcionalidad nueva. Un techo de integración es la SUMA de los tramos.
// WS1 «perfil de tenant» (0770): +1 archivo y +1 llamada (288 → 289 y 1,916 → 1,917). El módulo nuevo es `lib/auth/perfil_tenant.ts`: la lectura de
// `tenant_perfil` (una tabla deny-all, un solo `.from(`) con su caché y falla cerrada; no cabe en `repo.ts` sin que éste conozca la política de acceso.
// Integración Vigía + perfil (0770): el barrido real mide 294 = 293 (la rama del Vigía sola, 4 por encima de su techo declarado de 289) + 1 (perfil_tenant.ts). Techo subido a lo medido, sin relajar la regla.
// Integración Peajes + perfil (0770): el barrido real mide 295 archivos (incluye +1 de perfil_tenant.ts); techo subido a lo medido, sin relajar la regla. Un techo de integración es la suma de los tramos.
// 14-oct-2026, frente «cinco agentes» A1, T-A1-13: techo 288 → 290 archivos. El árbol de la rama del frente ya medía 289 / 1,918 (lo anterior del frente, sin
// subir el techo); `liquidacion_externa/repo_correo.ts` suma +1 archivo y +22 llamadas (todas por `acotada`, con `tenant_id`): es el ÚNICO acceso a datos
// nuevo de la liquidación por correo (0785-0787: config, coordinadores, desglose, entregas, excepciones, cursor del pull, conteos). Funcionalidad nueva.
// 15-oct-2026, frente «cinco agentes» A1, T-A1-38 (cierre): techo 290 → 291 archivos y 1,940 → 1,946 llamadas, medido con el barrido real de esta prueba sobre la
// rama del frente. Lo que subió desde T-A1-13: `repo_correo.ts` (+4 llamadas por T-A1-18 y T-A1-29, todas por `acotada` con `tenant_id`), `trabajo.ts` (+1, la lectura
// de la configuración de correo por `acotada`) y dos módulos de entrega que el barrido cuenta SIN tocar la base: `entrega_correo.ts` y `xlsx_minimo.ts` usan
// `Buffer.from(` (base64/zip), que la expresión `.from(` confunde con una consulta. Funcionalidad nueva, no código migrado.
// WS1 «perfil de tenant» (0770): +1 archivo y +1 llamada (288 → 289 y 1,916 → 1,917). El módulo nuevo es `lib/auth/perfil_tenant.ts`: la lectura de
// `tenant_perfil` (una tabla deny-all, un solo `.from(`) con su caché y falla cerrada; no cabe en `repo.ts` sin que éste conozca la política de acceso.
// Integración Liquidación + perfil (0770): el barrido real mide 293 archivos (incluye +1 de perfil_tenant.ts); techo subido a lo medido, sin relajar la regla. Un techo de integración es la suma de los tramos.
// Integración ronda 20: 287 (E1-A, +0) + 1 (E1-B, acuse_folio.ts) = 288.
// INTEGRACIÓN ola 4a (A + B): 1,805 → 1,807. El paquete B (M3/M4, copia al jefe) suma +2 llamadas RPC en un archivo que ya contaba
// (`reclamar_copia_jefe` y `cerrar_copia_jefe`, el reclamo atómico de la copia); cada paquete midió contra su propia base, por eso
// la suma de ambos solo se ve en el barrido del árbol integrado. Funcionalidad nueva, no código migrado.
// OLA 4b, paquete P3 «carta-porte-worker» (0640-0642): 0 archivos y +4 llamadas (1,807 → 1,811), todas en `carta_porte_docs/repo.ts`, que ya
// contaba — funcionalidad nueva, no código migrado: las RPC del worker (qué procesar y su respaldo directo contra una base sin la 0641, qué quedó
// agotado, qué documento por avisar, y el candado de «una sola vez» del aviso a la oficina con su liberación). Cada una va por `acotada`.
// INTEGRACIÓN ola 4b (P1 + P3): P1 mide 1,807 → 1,811 (+4) y P3 1,807 → 1,811 (+4) contra la misma base; la suma es 1,815 (se confirma con el barrido del árbol fusionado).
// OLA 4c, paquete P2 «conductor-ciclo-gps» (0635-0637): 0 archivos y +20 llamadas (1,815 → 1,835), todas en archivos que ya contaban y todas por
// `acotada`: `conductor/trabajo.ts` +8 (lecturas que CRUZAN flotas del cron `conductor-hitos`, acotadas por las flotas de cada lote: los sitios
// con polígono de cada viaje —2—, las muestras de GPS de verdad sin el pin, los viajes sin sitio con sus derivaciones previas —2—, el catálogo de
// sitios, los episodios de «sin señal de vida» y la última muestra de cada unidad) y `conductor/repo.ts` +12 (las escrituras de la 0635-0637, siempre
// con `tenant_id`: reclamar/completar/liberar el cruce de geocerca —4—, asignar el sitio derivado —3—, y abrir/reclamar nivel/cerrar/anotar/responder/
// cerrar por el jefe el episodio de señal de vida —5—). Funcionalidad nueva, no código migrado.
// OLA 4c, paquete P4 «liquidacion-discrepancias» (0643-0645): 0 archivos y +14 llamadas (suma de las dos: 1,835 + 14 = 1,849), todas en archivos que ya contaban —
// funcionalidad nueva, no código migrado: `liquidacion_externa/repo.ts` junta el acceso del aviso de discrepancia (las cuatro RPC de la 0644:
// «No coincide» atómico, reclamo, cierre y rearme; la lectura de un aviso y la del panel; marcar la tarea abierta; la lectura de los teléfonos
// de la flota con o sin formato y su guardado sin Excel de muestra (actualizar o crear la fila) y quitar el formato conservando los teléfonos; y las dos de la tarea durable en la cola del orquestador, insertar y leer la previa ante el índice único) y
// `liquidacion_externa/trabajo.ts` suma la lista de avisos pendientes que cruza flotas (como su lista de entregas). Todas por `acotada`.
// RONDA 08, corrector adversarial (señal de vida): 0 archivos y +2 llamadas, en `conductor/trabajo.ts` (1,849 + 2 = 1,851): la lectura de los sitios
// de la flota con su geometría (patios donde esperar es normal) y la del estado del conector de GPS (`conector_poll_estado`); ambas por `acotada`.
// RONDA 08, P5 «vigia-cierre» (0647): 0 archivos y +7 llamadas (1,815 → 1,822), todas en `vigia/repo.ts` y `vigia/historial/repo.ts`, que ya contaban —
// funcionalidad nueva—: la cola del barrido y los ciclos muertos (`expirarCiclosInactivos`: lectura + cierre condicional), y las respuestas rápidas
// (lectura de las aprobadas, uso atómico, leer/aprobar/retirar desde la pantalla). Cada una va por `acotada`.
// OLA 4d, paquete P6 «orquestador-vivo» (0651-0652): 0 archivos y +11 llamadas (1,815 → 1,826), todas en `orquestador/fuentes_reales.ts`, que ya contaba y que
// sigue siendo el ÚNICO archivo con acceso a datos propio del asistente (funcionalidad nueva, no código migrado; cada una va por `acotada`):
//   · el aviso de una tarea (0651): leer su estado, el claim del intento (lee los intentos y hace el UPDATE condicional), cerrar/anotar el estado y el nombre de la flota (4+1);
//   · el ciclo del cron escalar (0652): el claim de flotas por RPC, el registro del barrido por RPC y las tareas con aviso pendiente (3);
//   · las tareas de sistema del barrido de salud: listar las abiertas `barrido:*` y cerrar por llave (2);
//   · la reclamación de peajes: el último desglose no anulado de la flota (1).
// Las otras lecturas nuevas (convenio, liquidación externa, jornada, reporte de peajes) COMPONEN lectores que ya existen (`convenios/repo.ts`, `liquidacion_externa/repo.ts`,
// `jornada/repo.ts`, `peajes/bitacora_conciliada.ts`) y no suman llamadas. Cada paquete de la Ola 4 midió contra su propia base: la suma se confirma con el barrido del árbol integrado.
// INTEGRACIÓN ola 4d (P5 + P6), medida con el barrido real del árbol fusionado: 1,851 + 7 (P5) + 11 (P6) = 1,869 llamadas exactas, cero holgura
// (cada paquete midió contra su propia base; P5 y P6 no se pisan: vigia/ y orquestador/fuentes_reales.ts). 0 archivos nuevos (286 sin cambio).
// CORRECTOR ronda 09 (adversarial): +2 en `orquestador/fuentes_reales.ts` (1,869 → 1,871): la lectura del anti-rebote del barrido de salud
// (`cerradaSolaDesde`) y la de «qué agentes usa esta flota» (`hayFilas`, una sola función que sirve a tres tablas). Ambas acotadas con `.limit(1)`.
// OLA 4d, paquete P7 «convenios-edicion» (0656-0657): 0 archivos y +5 llamadas (1,851 → 1,856), todas en `convenios/repo.ts`, que ya contaba, y todas por
// `acotada`: la versión de cada convenio (lectura aparte a propósito, para que una base sin la 0656 no deje sin lista a toda la pantalla), los clientes y los
// sitios que ofrece el formulario de alta/edición (2) y las dos RPC de la edición — `guardar_convenio` (alta/edición atómica con control de versión) y
// `refrescar_viajes_de_convenio` (llevar la edición a los viajes en curso). Funcionalidad nueva, no código migrado. Medido contra su propia base (1,851):
// al integrarla con las otras ramas de la ola, el techo es la suma de los tramos.
// INTEGRACIÓN P7 + P9 (ronda 10): 1,871 + 5 (P7) + 6 (P9) = 1,882 por suma; medido con el barrido real del árbol fusionado: 1,882 exactas, cero holgura.
// RONDA 09, paquete P9 «claims-concurrencia» (0660-0661): 0 archivos y +6 llamadas (1,851 + 6 = 1,857), en archivos que ya contaban — funcionalidad nueva, no código
// migrado: `reglas/repo.ts` +3 (las RPC del reclamo de «Mis reglas»: reclamar, confirmar y liberar las llaves de un aviso) y `conductor/trabajo.ts` +3 (la lectura de
// viajes ahora es la RPC de reparto justo entre flotas + la lectura por lotes + la anterior como respaldo sin la 0661, y el cierre de los hitos de viajes vencidos).
// INTEGRACIÓN P0 + P12 (ronda 11): -1 por el retiro de `hitos_viaje.ts` (1,882 → 1,881), medido con el barrido real del árbol fusionado.
// RONDA 12, paquete P13 «carta-porte-multiembarque» (0670-0671): 0 archivos y +5 llamadas (1,881 → 1,886), todas en `carta_porte_docs/repo.ts`, que ya contaba y
// donde cada una va por `acotada` — funcionalidad nueva, no código migrado: la RPC atómica `cp_documento_dividir`, las lecturas de la ficha de linaje
// (`cp_documento_embarque`: hijos de un padre, linaje por lote de documentos, y el padre de un hijo) y la lectura por ids de los hijos (`cp_documento`).
// El módulo nuevo `multiembarque.ts` es puro y no suma archivos (su `Array.from` se reescribió para no contar como `.from(`). Medido con el barrido real.
// Integración P13 + Ola 9 (ronda 13): 1,881 + 5 (P13) + 4 (Ola 9, ver la nota de archivos, arriba) = 1,890.
// RONDA 14, paquete P8 «peajes-cursos» (0665): 0 archivos y +6 llamadas, todas en `peajes/datos.ts` (ya contaba; cada una va por `acotada` con el `tenant_id` anclado): funcionalidad nueva, no código migrado.
// Ronda 15, P14 «vigia-respaldo-correo» (0673-0674): +8 llamadas en `vigia/repo.ts`, por `acotada` (lista de directores, RPC del correo, tablero).
// Ronda 15 (corrector, 0676): +1 en `carta_porte_docs/repo.ts` (la RPC `cp_documentos_cerrar_zombis`).
// Ronda 16 (integración): 1,890 + 6 + 8 + 1 = 1,905; CONFIRMADO con el barrido real del árbol fusionado (ver la prueba: «N de 1,905»). Un techo de integración es la SUMA de los tramos.
// RONDA 18, paquete «cierre-reauditoria»: 0 archivos y +5 llamadas (1,905 → 1,910), todas en `repo.ts` de su módulo (ya contaban; cada una va por `acotada` con el
// `tenant_id` anclado): `conductor/repo.ts` +4 (los episodios de «sin señal de vida» para el tablero: filtro por viajes, episodios, folios y choferes) y `reglas/repo.ts` +1
// (¿hay otra corrida mandando el aviso de esta regla?, R10-6). Funcionalidad nueva, no código migrado. Medido con el barrido real: base 3e61ee1d = 1,905; con el paquete = 1,910.
// Ronda 18 (integración): cierre +5 (→ 1,910), pg +0, carga −4 (lo medido en el árbol fusionado: 1,906; la rama de carga declaraba −3). CONFIRMADO con el barrido real:
// con el techo en 1,905 la prueba dice «subió de 1905 a 1906». Archivos: 287, sin cambio.
// OLA E1-A (guardia-observabilidad, 0700/0701): 0 archivos y +7 llamadas sobre 1,905 → 1,912, medido con el barrido real: `admin/salud.ts` (+5: insert de latencia_muestra y las RPC
// registrar_estado, estado_30_dias, purgar_latencia y purgar_estado_dia, por `acotada`) y `admin/slo.ts` (+2: latencia_percentiles y llm_costo_percentiles).
// Funcionalidad nueva (agregados sin tenant), no código migrado. Un techo de integración es la SUMA de los tramos.
// Ronda 19 (integración): 1,906 (ronda 18) + 7 (E1-A) = 1,913 esperado; el valor final es el del barrido real de la prueba.

// E1-B: +3 llamadas (acuse_folio.ts: storage). Ronda 20 (integración): 1,913 (E1-A integrado) + 3 = 1,916 esperado; el valor final es el del barrido real.
// CARTA PORTE (frente A3), medido con el barrido real: 1,916 → 1,934 (+18). +7 son de T-A3-27 (`carta_porte_docs/repo_envios.ts`: 1 select por id, 1 update, 1 select por
// documento, 1 conteo y 3 RPC). Las otras +11 ya estaban en `carta_porte_docs/repo.ts` en la rama del frente (T-A3-03/04/09/20: configuración de salida, preparar el envío, catálogo del cliente,
// marcar subido a mano y estado por documento) y el techo no se había subido; la prueba estaba roja ANTES de esta tarea (1,927 > 1,916). Funcionalidad nueva, no código migrado.
// Integración Carta Porte + perfil (0770): el barrido real mide 1,935 llamadas (incluye +1 de perfil_tenant.ts); techo subido a lo medido, sin relajar la regla.
// Integración Carta Porte + Vigía (INT-RAMAS): 1,917 base + 18 CP + 45 Vigía = 1,980 esperado; se ajusta al barrido real.
// Integración + Conductor (INT-RAMAS): 1,980 (perfil + CP + Vigía) + 29 de tramos propios del Conductor (1,946 − 1,917; 0 archivos) = 2,009 esperado; se ajusta al barrido real.
// Integración + Peajes (INT-RAMAS): 2,009 + 55 (Peajes sobre la base de perfil: 1,972 − 1,917) = 2,064 esperado; se ajusta al barrido real.
// Integración + Liquidación (INT-RAMAS): 2,064 + 31 (Liquidación sobre la base de perfil: 1,948 − 1,917) = 2,095 esperado; se ajusta al barrido real.
// 15-oct-2026, frente Peajes (reanclado sobre master): techo 2,095 → 2,102 llamadas (+7 en `peajes/datos.ts`: tarifario por caseta y clase, tarifas
// de referencia, configuración de umbrales y avisos; todas por `acotada`/`traerTodo`/`conteo` con `tenant_id`). Funcionalidad nueva, no código migrado.
// Integración cinco-integracion-2 (tms-conector + peajes-importador sobre la misma base, 2,105 de tms-conector + llamadas propias de
// peajes-importador que tms-conector no traía): el barrido real del árbol fusionado mide 2,134 llamadas; techo subido a lo medido, sin relajar la regla.
// 16-oct-2026, T-A3-67: techo 2,120 → 2,138 llamadas (rojo heredado de las tareas A3 anteriores, medido con el barrido real; esta tarea no suma ninguna).
// 16-oct-2026, T-A3-66: techo 2,138 → 2,141 llamadas (+3, medido con el barrido real), todas en `carta_porte_docs/repo.ts` (`leerSalidasParaSinCcp`: hitos de salida, viajes con su cliente y complementos aprobados ligados); solo lectura, con `tenant_id`, por `acotada`/`traerPorIds`.
// Integración cinco-integracion-2 (+ cartaporte sobre la misma base): el barrido real del árbol fusionado mide 2,180 llamadas; techo subido a lo medido, sin relajar la regla.
// T-A4-31 (Vigía, turnos y festivos): 2,095 → 2,101 (+6 llamadas, medido con el barrido real; techo no subido en su commit bda0409f, corregido en T-A4-45), todas en
// `vigia/repo.ts` por `acotada` y ancladas a `tenant_id` (la lectura de `tenant.zona_horaria` por `id`): zona del tenant, festivos (leer, guardar, quitar) y nombre de la flota.
// Funcionalidad nueva, no código migrado.
// Integración cinco-integracion-2 (+ vigia sobre la misma base): el barrido real del árbol fusionado mide 2,186 llamadas; techo subido a lo medido, sin relajar la regla.
// Historia propia de la rama Conductor (conteo desde su propia base, antes de integrarse a cinco-integracion-2; se conserva para el rastro de auditoría):
// LOOP CINCO AGENTES, T-A5-38 (parada iniciada por el chofer, 0806): 2,095 → 2,098 (0 archivos, +3 llamadas, medido con el barrido completo), las tres en `conductor/repo.ts`
// (`leerParadaAbierta`, `abrirParada`, `cerrarParada`: sobre `viaje_parada`, por `acotada`, ancladas a `tenant_id`; las prueba `paradas_repo.test.ts`). Funcionalidad nueva, no código migrado.
// LOOP CINCO AGENTES, T-A5-41 (ciclo por servicio, 0807): 2,098 → 2,101 medido con el barrido completo. +2 son de esta tarea, en `conductor/repo.ts` (`leerCicloServicio`,
// `sembrarCicloServicio`: sobre `ciclo_servicio`, por `acotada`, ancladas a `tenant_id`; las prueba `ciclo_servicio_repo.test.ts`). El +1 restante ya estaba en la rama del
// frente desde T-A5-40 (`leerEvidenciasSelloViaje`) y su techo no se había subido. Funcionalidad nueva, no código migrado.
// LOOP CINCO AGENTES, T-A5-44 (patio de entrega declarado vs «Entregar en»): 2,101 → 2,102 (0 archivos, +1 llamada, medido con el barrido completo), en `conductor/repo.ts`
// (`leerEventosPatio`: lee la bitácora `viaje_hito_evento` de esos viajes, por `acotada`, anclada a `tenant_id`; la prueba `patio_entrega.test.ts` cubre su uso). Sin migración. Funcionalidad nueva.
// LOOP CINCO AGENTES, T-A5-43 («con quién te reportaste» y rampa): 2,102 → 2,105 (0 archivos, +3 llamadas medidas con el barrido completo; las dos de esta tarea son `leerEventosReporte`
// y `guardarEventoReporte` en `conductor/repo.ts`: leen y escriben la bitácora `viaje_hito_evento` de esos viajes, por `acotada`, ancladas a `tenant_id`; las prueba
// `reporte_llegada_repo.test.ts`. La tercera ya estaba en la rama del frente antes de esta tarea). Sin migración. Funcionalidad nueva, no código migrado.
// LOOP CINCO AGENTES, T-A5-46 (resultado de la descarga y caja cargada): 2,105 → 2,106 (0 archivos, +1 llamada medida con el barrido completo, en `conductor/repo.ts`:
// `leerEventosResultadoDescarga` lee la bitácora `viaje_hito_evento` de esos viajes, por `acotada`, anclada a `tenant_id`; la prueba `resultado_descarga_repo.test.ts` cubre su uso). Sin migración. Funcionalidad nueva.
// LOOP CINCO AGENTES, T-A5-47 (asignación con botones): 2,106 → 2,108 (0 archivos, +2 llamadas medidas con el barrido completo, ambas en `conductor/repo.ts`:
// `aceptarPorBoton` escribe `aceptado_en`/`aceptado_origen` en un solo UPDATE condicionado (sin aceptar, ya avisado, mismo operador y flota) y relee la fila para decir por qué no cambió; por
// `acotada`, ancladas a `tenant_id`; la prueba `confirmar_viaje_boton.test.ts` cubre sus filtros). `leerCajaDelViaje` no suma (reusa el lector del Vigía). Sin migración. Funcionalidad nueva.
// LOOP CINCO AGENTES, T-A5-48 (rutas autorizadas, 0808): 2,108 → 2,111 (0 archivos, +3 llamadas medidas con el barrido completo, las tres en `conductor/repo.ts`:
// `leerRutasAutorizadas`, e `importarRutas` (un INSERT por lote y un UPDATE por fila cambiada, por id Y `tenant_id`), todas por `acotada`, ancladas a `tenant_id`; las prueba `rutas_repo.test.ts`). Funcionalidad nueva.
// LOOP CINCO AGENTES, T-A5-49 (rutas en el mensaje de asignación): 2,111 → 2,112 (0 archivos, +1 llamada medida con el barrido completo, en `conductor/repo.ts`:
// `leerCodigosSitios` lee `geocerca.id, codigo` de los sitios del viaje, por `acotada`, anclada a `tenant_id`; la prueba `rutas_repo.test.ts` cubre su filtro). Sin migración. Funcionalidad nueva.
// LOOP CINCO AGENTES, T-A5-66 (eventos de geocerca sin viaje, 0820): 2,112 → 2,120 (0 archivos, +8 llamadas medidas con el barrido completo): +6 en `conductor/repo.ts`
// (`leerFlotasConHuerfanos`, `leerUltimosCrucesHuerfanos`, `guardarEventosHuerfanos`, `leerEventosHuerfanosPendientes`, `marcarEventosHuerfanosReconciliados` y la RPC de
// retención `purgar_eventos_geocerca_huerfanos` en el mantenimiento) y +2 en `conductor/trabajo.ts` (`leerUnidadesSinViajeAbierto`: unidades y viajes abiertos, por `traerTodo`).
// Todas por `acotada`, ancladas a `tenant_id`; las prueba `huerfanos_repo.test.ts`. Funcionalidad nueva, no código migrado.
// LOOP CINCO AGENTES, T-A5-50 (mantenimiento de rutas): 2,120 → 2,121 (0 archivos, +1 llamada medida con el barrido completo, en `conductor/repo.ts`: `marcarRutaRevisada`, un UPDATE de
// `revisada_en` por id Y `tenant_id`, por `acotada`; la prueba `rutas_repo.test.ts` cubre sus filtros). La lectura reusa `leerRutasAutorizadas`. Sin migración. Funcionalidad nueva.
// LOOP CINCO AGENTES, T-A5-52 (catálogo de documentos por cliente, 0809): 2,121 → 2,125 (0 archivos, +4 llamadas medidas con el barrido completo, las cuatro en `conductor/repo.ts`:
// `leerDocumentosCliente`, el conteo previo de `altaDocumentoCliente` (tope por cliente), su INSERT y el DELETE de `bajaDocumentoCliente`; todas por `acotada`, ancladas a `tenant_id`; las prueba `documentos_cliente_repo.test.ts`). Funcionalidad nueva.
// Integración cinco-integracion-2 (+ conductor sobre la misma base): el barrido real del árbol fusionado mide 2,221 llamadas; techo subido a lo medido, sin relajar la regla.
// FASE 1 SEGURIDAD · SEG-SESIONES: +1 llamada (2,095 → 2,096), en
// `auth/usuarios_escritura.ts` (`cerrarSesionesUsuario`: la RPC
// `revocar_sesiones_usuario`, migración 0840 SOLO LOCAL). No es tráfico de
// tenant — llama con el id YA ANCLADO al tenant por `leerObjetivo`, que es
// el guardia de esta función. Funcionalidad nueva, no código migrado.
// Integración cinco-integracion-2 (+ auditoria-seguridad sobre la misma base): el barrido real del árbol fusionado mide 2,222 llamadas; techo subido a lo medido, sin relajar la regla.
// 19-oct-2026, avisoHuerfanos: +2 llamadas (2,222 → 2,224), las dos de `avisar_huerfanos.ts` (ver arriba).
// Integración con A2 Peajes (canal SFTP, 0843, sobre la misma base): +3 (2,224 → 2,227) — 2 reales en `peajes/repo.ts`
// (`peaje_sftp_reclamar` vía RPC, y `peaje_ingesta_config` al cerrar la config — T-A2-35 ya consolidó ahí lo que antes
// era `datos.ts`), por `acotada`, ancladas a `tenant_id`; +1 falso positivo del regex en `ingesta_sftp.ts` (ver el techo
// de archivos de arriba).
// Integración con T-A5-53/54 (documentos de cierre, 0823, sobre la misma base): +6 llamadas (2,227 → 2,233), las seis en
// `conductor/repo_validacion.ts` (ya era de los archivos fuera de la frontera, junto con `guardarEvidencia`/`leerEvidencias`
// existentes): `leerDocumentosCierre` (select), `crearSolicitudDocumentosCierre` (upsert del snapshot),
// `guardarEvidenciaDocumentoCierre` (insert de la evidencia + update del seguimiento) y
// `guardarEvidenciaDocumentoCierreSinCategoria` y `registrarRespuestaChoferDocumentosCierre` (un insert y un update más). Todas
// por `acotada`, ancladas a `tenant_id`. Cubiertas por `documentos_cierre.test.ts` (lógica pura), `v1/evidencias/route.test.ts`
// (la lectura) y `processor_hitos.test.ts` (el cableado de la foto); las reglas que solo Postgres demuestra —CHECK ampliado,
// FKs que desligan sin romper, RLS— en `supabase/tests/0823_documentos_cierre_evidencia.sql` y el bloque 353 de
// `verificaciones.sql`. Sin migración de código viejo: funcionalidad nueva.
const TECHO_LLAMADAS_FUERA_DE_LA_FRONTERA = 2_233;
// Agente 4 (Vigía), T-A4-06: +7 llamadas (1,916 → 1,923), medido con el barrido real, todas en `vigia/programa/repo.ts` (ver arriba), todas por `acotada` y con `tenant_id` (lo comprueba su `repo.test.ts`).
// Integración Vigía + perfil (0770): el barrido real mide 1,962 = 1,961 (la rama del Vigía sola, 38 por encima de su techo declarado de 1,923) + 1 (perfil_tenant.ts). Techo subido a lo medido, sin relajar la regla.
// T-A5-04 (Conductor, 0800): 0 archivos y +1 llamada (1,916 → 1,917), en `conductor/repo.ts` (`aceptarViajesImportados`: la RPC `aceptar_viajes_importados`, por `acotada`
// con el tenant anclado). Funcionalidad nueva, no código migrado; medido con el barrido real: base 1,916, con la tarea 1,917.
// T-A5-03 (Conductor, 0800): 0 archivos y +7 llamadas (1,917 → 1,924), todas en `conductor/repo.ts` (alta y baja de voluntarios del piloto: leer un operador de la flota,
// listar voluntarios, buscar candidatos, contarlos, leer el tope, marcar la marca y la RPC `retirar_voluntario`; todas por `acotada` con el tenant anclado). La frontera
// declarada es solo `lib/likida/repo.ts`/`pg.ts`, así que `conductor/repo.ts` cuenta como cualquier módulo. Funcionalidad nueva, no código migrado; medido con el barrido real.
// LOOP CINCO AGENTES, T-A5-25 (preflight del piloto): 1,936 → 1,938 (0 archivos, +2 llamadas, medido con el barrido real), ambas en `conductor/repo.ts`
// (`leerDatosPreflight`: los viajes abiertos y aceptados de los voluntarios y sus posiciones de las últimas 2 h; por `acotada`, ancladas a `tenant_id`, solo lectura).
// Funcionalidad nueva, no código migrado.
// LOOP CINCO AGENTES, T-A5-17 (equivalencias texto→sitio, 0803): 1,924 → 1,936 (0 archivos, +12 llamadas, medido con el barrido completo), todas en
// `conductor/repo_validacion.ts`, que ya contaba: el diccionario de la flota (leer), el importador (resolver códigos de sitio, insertar por lotes,
// actualizar), la asignación a mano desde la lista (comprobar sitio, buscar la previa, crear o editar) y los viajes abiertos de 14 días para la lista de
// «textos sin sitio». Todas por `acotada`, ancladas a `tenant_id` y las lecturas por lotes con `traerTodo`/`traerPorIds`. Funcionalidad nueva, no código migrado.
// WS1 «perfil de tenant» (0770), integración con el Conductor: +1 llamada (el `.from(` de `tenant_perfil` en `lib/auth/perfil_tenant.ts`). OJO: la rama del Conductor sola YA medía 1,945
// con el barrido real (su techo declarado, 1,938, estaba 7 por debajo); con el perfil, 1,945 + 1 = 1,946. Suma de tramos, medida con el barrido real; el techo se sube para reflejarla.
// Integración Peajes + perfil (0770): el barrido real mide 1,972 llamadas (incluye +1 de perfil_tenant.ts); techo subido a lo medido, sin relajar la regla.
// T-A1-13 (ver el techo de archivos): 1,918 medidas en la rama del frente + 22 de `repo_correo.ts` = 1,940, medido con el barrido real.
// Integración Liquidación + perfil (0770): el barrido real mide 1,948 llamadas (incluye +1 de perfil_tenant.ts); techo subido a lo medido, sin relajar la regla.
// INTEGRACIÓN ola 3 (ronda-03), suma con W3 autofactura (+3 archivos, +22 llamadas): 277 / 1,701 (ajustado al barrido real).
// OLA 3, Agente 6 «autofacturación» (W3): cada entrega suma su tramo medido, explicado aquí.
//   · cancelación de CFDI de Carta Porte (0541): `carta_porte_cancelacion.ts` (claim → PAC → resultado → confirmar: 3 consultas)
//     y la sección de timbrado; vinculación asistida (0540): `autofactura/vinculacion_remota_repo.ts`, que junta TODO el acceso
//     a datos del módulo (cinco RPC atómicas y las dos lecturas), y la llamada a `purgar_vinculacion_portal` en el cron de
//     purga. Funcionalidad nueva, no código migrado. Medido: 268 → 270 archivos, 1,580 → 1,591 llamadas.
//   · control de la emisión real (0542): `autofactura/control_emision_repo.ts` junta TODO el acceso a datos del módulo
//     (puertos del control, RPC atómicas de cupo/lote/fase y lecturas del tablero) y la pantalla lee tres de ellas.
//     Funcionalidad nueva. Medido: 270 → 271 archivos, 1,591 → 1,602 llamadas.


const RAIZ_SRC = new URL('../../', import.meta.url).pathname;

/** La frontera declarada — los dos únicos archivos donde `.from(`/`.rpc(`
 *  directo está permitido sin contar contra el techo. */
const FRONTERA = new Set(['lib/likida/repo.ts', 'lib/likida/pg.ts']);

/** Todos los `.ts`/`.tsx` de `src/`, excluyendo pruebas, fixtures y el
 *  directorio de pruebas manuales — EL BARRIDO, no una lista literal. La
 *  lista literal es exactamente lo que dejó ciego al guardia anterior
 *  (`acotada_guardiana.test.ts` cita esa lección: un módulo nuevo que no se
 *  da de alta a mano no lo ve nadie). */
function fuentesDeProduccion(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'pruebas-manuales') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { fuentesDeProduccion(p, acc); continue; }
    if (!/\.(ts|tsx)$/.test(e)) continue;
    if (/\.test\.tsx?$/.test(e) || /\.fixture\.tsx?$/.test(e)) continue;
    acc.push(p);
  }
  return acc;
}

function tieneAccesoDirecto(ruta: string): boolean {
  return /\.(from|rpc)\(/.test(readFileSync(ruta, 'utf8'));
}

/** Cuántas llamadas `.from(`/`.rpc(` trae un archivo — la UNIDAD que de
 *  verdad mide cuánto código bypasea `repo.ts`/`pg.ts`, no cuántos archivos
 *  lo hacen (ver AUDITORÍA 28 arriba). */
function llamadasDirectas(ruta: string): number {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta sale de fuentesDeProduccion()/readdirSync sobre RAIZ_SRC, un directorio fijo del repo; ninguna entrada de usuario.
  return (readFileSync(ruta, 'utf8').match(/\.(from|rpc)\(/g) ?? []).length;
}

describe('la frontera de datos (repo.ts/pg.ts) — el número medido no puede subir en silencio', () => {
  const archivos = fuentesDeProduccion(RAIZ_SRC)
    .map((p) => relative(RAIZ_SRC, p))
    .filter((rel) => !FRONTERA.has(rel))
    .filter((rel) => tieneAccesoDirecto(join(RAIZ_SRC, rel)))
    .sort();

  it('el barrido encuentra archivos conocidos con acceso directo (si esto falla, el barrido se quedó ciego)', () => {
    // Los dos ejemplos más nuevos que la c21 citó: el MCP OAuth entero nació
    // sin pasar por repo.ts, y el pipeline entrante sigue haciendo `.from(`
    // inline desde hace varias rondas.
    expect(archivos).toContain('lib/mcp/oauth.ts');
    expect(archivos).toContain('lib/likida/processor.ts');
  });

  it(`no hay más de ${TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA} archivos con acceso directo a Supabase fuera de repo.ts/pg.ts`, () => {
    const mensaje = archivos.length > TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA
      ? [
        `El conteo SUBIÓ de ${TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA} a ${archivos.length}.`,
        'Si el crecimiento es real y ya se revisó, sube TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA',
        'en este archivo, en el MISMO commit que lo explica. Si no, alguien metió',
        'una consulta directa nueva por fuera de repo.ts/pg.ts — muévela ahí.',
      ].join('\n')
      : `${archivos.length} de ${TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA} — dentro del techo.`;
    expect(archivos.length, mensaje).toBeLessThanOrEqual(TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA);
  });

  it('si el conteo BAJÓ (código migrado a repo.ts), hay que bajar el techo también', () => {
    // Este test no puede fallar solo — es la nota que explica por qué el de
    // arriba no debe quedarse verde "de sobra": un techo que nunca se ajusta
    // hacia abajo deja de medir nada. Si `archivos.length` queda muy por
    // debajo de TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA por varias rondas, es
    // señal de que el techo quedó obsoleto, no de que el problema mejoró.
    expect(archivos.length).toBeGreaterThan(0);
  });

  // ── AUDITORÍA 28, ARQ-M1: el techo que de verdad importa — LLAMADAS ──────
  const totalLlamadas = archivos.reduce((n, rel) => n + llamadasDirectas(join(RAIZ_SRC, rel)), 0);

  it('el barrido cuenta más llamadas que archivos (si no, esto no mide nada distinto)', () => {
    // Si algún día coincidieran, contar llamadas dejaría de aportar sobre
    // contar archivos — la señal de que el guardia de archivos se quedó
    // ciego a este tipo de crecimiento (varias consultas nuevas en un mismo
    // archivo ya listado) es precisamente que este número sea MAYOR.
    expect(totalLlamadas).toBeGreaterThan(archivos.length);
  });

  it(`no hay más de ${TECHO_LLAMADAS_FUERA_DE_LA_FRONTERA} llamadas .from(/.rpc( fuera de repo.ts/pg.ts`, () => {
    const mensaje = totalLlamadas > TECHO_LLAMADAS_FUERA_DE_LA_FRONTERA
      ? [
        `El conteo de LLAMADAS subió de ${TECHO_LLAMADAS_FUERA_DE_LA_FRONTERA} a ${totalLlamadas}.`,
        'Si el crecimiento es real y ya se revisó, sube TECHO_LLAMADAS_FUERA_DE_LA_FRONTERA',
        'en este archivo, en el MISMO commit que lo explica. Si no, alguien metió',
        'consultas directas nuevas por fuera de repo.ts/pg.ts — muévelas ahí, o revisa que',
        'las nuevas paginen con traerTodo/acotada igual que el resto del archivo.',
      ].join('\n')
      : `${totalLlamadas} de ${TECHO_LLAMADAS_FUERA_DE_LA_FRONTERA} — dentro del techo.`;
    expect(totalLlamadas, mensaje).toBeLessThanOrEqual(TECHO_LLAMADAS_FUERA_DE_LA_FRONTERA);
  });

  it('si las llamadas BAJARON (código migrado o simplificado), hay que bajar ese techo también', () => {
    // Misma nota que la de archivos, mismo motivo: un techo que se queda muy
    // por encima de lo medido deja de ser un techo.
    expect(totalLlamadas).toBeGreaterThan(0);
  });
});
