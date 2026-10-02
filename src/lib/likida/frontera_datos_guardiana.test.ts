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
 * UN archivo el acceso a la ventana de 24 h por contacto (mig. 0360: RPC de
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
// W3 ORQUESTADOR (Ola 3b): +1 archivo, +7 llamadas — 277 → 278 y 1,705 → 1,712. El módulo nuevo es `orquestador/fuentes_reales.ts`, que
// junta en UN archivo lo propio del asistente: las tareas que deja para una persona (tabla de la 0650: insertar, leer la previa ante el
// índice único, listar las abiertas, atender con UPDATE condicional) y tres lecturas de «envíos que no salieron» (entregas del buzón, mensajes
// fallidos del Vigía, folio de un viaje). Todo lo demás COMPONE los lectores que cada agente ya tiene (`conductor/repo_validacion.ts`,
// `vigia/repo.ts`, `buzon/repo.ts`, `agentes/cobranza*.ts`, `autofactura/control_emision_repo.ts`): no abre una segunda ruta a esos datos.
const TECHO_ARCHIVOS_FUERA_DE_LA_FRONTERA = 278;
const TECHO_LLAMADAS_FUERA_DE_LA_FRONTERA = 1_712;
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
