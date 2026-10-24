// ═══════════════════════════════════════════════════════════════════════════
// EL CICLO DE LA DESCARGA MASIVA (0231) — pedir, volver, bajar, ingerir.
//
// El SAT no contesta al momento: acepta un trámite y lo procesa hasta seis
// días. Por eso este ciclo NO es una función que descarga; es una función que
// EMPUJA UN PASO por flota y se va, y que al correr otra vez retoma donde
// quedó. El estado vive en `sat_descarga_solicitud`, no en memoria.
//
// El orden importa y es siempre el mismo:
//   1. VERIFICAR lo que ya está en curso. Primero se cobra lo pedido: pedir
//      más antes de recoger lo que ya está listo desperdicia el tope diario.
//   2. INGERIR lo que bajó, con dedup por folio fiscal en la base.
//   3. PEDIR el siguiente rango, solo si no hay nada vivo para ese tipo.
//
// LOS TOPES SON DEL SAT, NO DE LIKIDA, y por eso se respetan y se dicen:
// 200,000 CFDI por petición (web service, hasta 6 días) o 2,000 documentos al
// día (portal, ~48 h). La ventana por solicitud se corta en 31 días para que
// una flota grande no tope, y cuando el rango pendiente es más largo se pide
// por pedazos, avanzando un pedazo por corrida.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { traerTodoPorLlave, llaveFechaId, despuesDeFechaId, LecturaCortadaPorReloj, PAGINA, type LlaveFechaId } from '@/lib/likida/pg';
import { logger } from '@/lib/logger';
import { hoyMx } from '@/lib/formato';
import type { Gasto } from '@/types/likida';
import { parseCfdiXml } from '../intake/cfdi_xml';
import { guardarYConciliarConsolidado } from '../intake/consolidado';
import { saveCfdiXmlRaw } from '../repo';
import { ligarGastoAutomatico } from './liga_campos';
import { resolverDescargaSat, estadoDescargaSat } from './index';
import { decidirCruce } from './cruce';
import { rfcsFiscalesDeTenants, normalizarRfc } from './rfc_tenant';
import type { ProveedorDescargaSat, TipoDescarga } from './tipos';

/** Días por solicitud. El SAT admite rangos largos, pero un rango corto
 *  reparte el riesgo: si un pedazo falla, no se pierde el año entero. */
export const VENTANA_MAX_DIAS = 31;

/** Cuánto hacia atrás se pide la PRIMERA vez. Tres meses es un trimestre
 *  fiscal: suficiente para que la primera corrida enseñe valor, y acotado para
 *  que no se traiga una década en la primera llamada. Que sea un supuesto —y
 *  no "todo"— es justamente lo que la pantalla declara. */
export const VENTANA_INICIAL_DIAS = 90;

/** Cuántas solicitudes vivas se verifican por flota en una corrida. */
const MAX_VERIFICAR = 10;

/** Cuántos paquetes se bajan por corrida. Bajar es lo caro (un ZIP con miles
 *  de CFDI) y la función tiene reloj: mejor tres paquetes por corrida cuatro
 *  veces al día que un timeout que no deja nada.
 *
 *  ESTE TOPE SÓLO ES SANO SI EL AVANCE SE GUARDA. Hasta la 0236 no se
 *  guardaba: el cuarto paquete agotaba el tope, la solicitud no cerraba, y la
 *  corrida siguiente volvía a empezar POR EL PRIMERO — los mismos tres
 *  paquetes cada 6 horas, para siempre, contra el buzón fiscal real. Ahora
 *  cada paquete ingerido se anota en `paquetes_bajados` y la vuelta siguiente
 *  reanuda por el primero pendiente. */
const MAX_PAQUETES = 3;

/** Cuánto puede quedarse una solicitud VIVA SIN FOLIO DEL SAT antes de que el
 *  ciclo la suelte.
 *
 *  El caso: `prov.solicitar` no contesta (clase 'red'). El trámite PUDO haber
 *  quedado abierto del lado del SAT, así que la fila se deja viva para que
 *  nadie vuelva a pedir el mismo rango a ciegas — hasta ahí, correcto. El
 *  problema es que sin `request_id` NO SE PUEDE VERIFICAR NI DESCARGAR NUNCA:
 *  la fila no avanza sola, bloquea el rango por el candado de traslape, y
 *  `hayViva` impide pedir cualquier otro. La descarga masiva de esa flota
 *  queda muerta desde ese martes, con la pantalla diciendo «solicitada» y el
 *  contralor creyendo que el SAT está tardando (la propia 0231 le dijo que
 *  tarda hasta 6 días). Y NO EXISTE el humano que la destrabe: no hay acción,
 *  ni ruta, ni pantalla que suelte una solicitud (contraste con la 0227, que
 *  sí tiene su `soltarReserva`).
 *
 *  24 horas: de sobra para que un corte de red se haya resuelto, y muy por
 *  debajo de los 6 días que el SAT puede tardar en un trámite que SÍ tiene
 *  folio. Al soltarla se dice qué pasó y qué cuesta —si el SAT sí abrió el
 *  trámite, volver a pedir consume otra vez el tope diario del RFC—, y el
 *  error entra al resumen para que el latido salga 'parcial', no 'ok'. */
const HORAS_SOLICITUD_ATORADA = 24;

/** Los códigos con los que la base dice «ese rango ya tiene un trámite vivo»:
 *  23505 es el rebote de un índice único; 23P01, el de la restricción de
 *  exclusión que la 0236 puso para cubrir el TRASLAPE y no sólo el par exacto
 *  de fechas. Cualquier OTRO código es un fallo de verdad y jamás se lee como
 *  «ya lo pidió otro». */
const CODIGOS_RANGO_YA_VIVO = new Set(['23505', '23P01']);

/** El SQLSTATE que PostgREST propaga en `code`. No confundir con
 *  `codigoDeError` de `observability/sentry`, que es otra cosa: aquél
 *  resume un error en una etiqueta estable para agrupar incidencias. */
function sqlstateDe(e: unknown): string | null {
  if (e !== null && typeof e === 'object' && 'code' in e) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string') return c;
  }
  return null;
}

export interface ResumenFlota {
  tenantId: string;
  verificadas: number;
  descargadas: number;
  solicitadas: number;
  cfdisNuevos: number;
  cfdisRepetidos: number;
  casados: number;
  ambiguos: number;
  disponibles: number;
  consolidados: number;
  /** Lo que NO se pudo hacer, con el mensaje del proveedor TAL CUAL. */
  errores: string[];
  /** Unidades de trabajo de ESTA flota que el RELOJ DE LA VUELTA dejó sin
   *  mirar: solicitudes vivas sin verificar y paquetes listos sin bajar.
   *
   *  NO son errores y por eso no van en `errores`: nada falló, simplemente no
   *  alcanzó el tiempo. Pero tampoco es una corrida limpia, y la ruta las suma
   *  para que el latido diga `'parcial'`. Un 0 aquí significa «esta flota se
   *  atendió completa», no «no se sabe». */
  sinTurno: number;
}

interface ConfigFlota {
  tenantId: string;
  rfc: string;
  ultimaHasta: string | null;
}

function vacio(tenantId: string): ResumenFlota {
  return {
    tenantId, verificadas: 0, descargadas: 0, solicitadas: 0,
    cfdisNuevos: 0, cfdisRepetidos: 0,
    casados: 0, ambiguos: 0, disponibles: 0, consolidados: 0, errores: [],
    sinTurno: 0,
  };
}

function sumarDias(iso: string, dias: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * El rango que toca pedir, o `null` si no hay nada pendiente.
 *
 * PURO a propósito: decidir qué pedazo del calendario se pide es la clase de
 * cosa que se rompe en silencio (un día repetido, un día saltado) y se prueba
 * mejor sin base de datos.
 */
export function rangoPendiente(
  ultimaHasta: string | null,
  hoy: string,
  ventanaMax = VENTANA_MAX_DIAS,
  ventanaInicial = VENTANA_INICIAL_DIAS,
): { desde: string; hasta: string } | null {
  // NULL significa NUNCA SE HA DESCARGADO — no "desde el principio". Se abre
  // una ventana acotada y declarada, jamás un rango abierto.
  const desde = ultimaHasta === null ? sumarDias(hoy, -ventanaInicial) : sumarDias(ultimaHasta, 1);
  if (desde > hoy) return null; // ya está al día
  const tope = sumarDias(desde, ventanaMax - 1);
  return { desde, hasta: tope < hoy ? tope : hoy };
}

/**
 * ¿Esta solicitud completada puede mover `ultima_descarga_hasta`? (A37-S57-02)
 * Solo 'recibidos' y sin hueco: arranca a más tardar el día siguiente al
 * calendario (o, si nunca se descargó, en la ventana inicial). PURA.
 */
export function avanzaCalendario(
  tipo: string, desde: string, ultimaHasta: string | null, hoy: string,
): boolean {
  if (tipo !== 'recibidos') return false;
  const primerDiaSinCubrir = ultimaHasta === null
    ? sumarDias(hoy, -VENTANA_INICIAL_DIAS)
    : sumarDias(ultimaHasta, 1);
  return desde <= primerDiaSinCubrir;
}

/**
 * Los gastos de la flota que TODAVÍA no tienen comprobante — el fondo contra
 * el que se cruza. Se acota por fecha alrededor del rango bajado: cruzar
 * contra el histórico entero sería lento y no más correcto (el CFDI y su
 * ticket son del mismo periodo).
 *
 * AUDITORÍA 25, MEDIO (REND-A5): era `.limit(5000)`, que PostgREST recorta a
 * 1,000 en silencio (`pg.ts:38-48`). Con una flota de 100 unidades y ~2,000
 * gastos sin comprobante en el mes, `decidirCruce` solo veía la mitad del
 * fondo: los CFDI cuyo ticket cayó fuera del corte se marcaban `disponible`
 * en vez de `casado`, y el sello de dedup impide una segunda oportunidad
 * automática. `traerTodoPorLlave` trae el fondo COMPLETO o lanza.
 */
export async function gastosSinCfdi(
  tenantId: string, desde: string, hasta: string, venceEn?: number,
): Promise<Gasto[]> {
  const leidos = await traerTodoPorLlave<{
    id: string; concepto: unknown; monto: unknown; fecha: unknown;
    rfc_emisor: unknown; cfdi_uuid: unknown; ocr_extra: unknown;
  }, LlaveFechaId>(
    (despuesDe) => {
      let q = supabaseAdmin()
        .from('gasto')
        .select('id, concepto, monto, fecha, rfc_emisor, cfdi_uuid, ocr_extra', despuesDe === null ? { count: 'exact' as const } : {})
        .eq('tenant_id', tenantId)
        .is('cfdi_uuid', null)
        // Un día de holgura a cada lado: la fecha del ticket (OCR) y la del
        // timbrado pueden diferir en uno, igual que en la conciliación de
        // consolidados (VENTANA_DIAS_FECHA, 0076).
        .gte('fecha', sumarDias(desde, -1))
        .lte('fecha', sumarDias(hasta, 1));
      // RONDA 16 (carga de 250 camiones): cursor `(fecha, id)` y no `range(d, h)`.
      // Con 10-23k tickets sin CFDI en el rango son hasta 23 páginas; por offset
      // cada una cuesta más (O(n²)) y un ticket nuevo mientras se pagina corre las
      // posiciones. Y no `id > último` a secas: con una ventana de ~1 mes (6% de la
      // flota) recorre el índice de `id` de TODA la flota (1.8 s contra 0.24 s,
      // scripts/carga/250-camiones/07-offset-vs-cursor.sql).
      if (despuesDe !== null) q = q.gte('fecha', despuesDe.fecha).or(despuesDeFechaId(despuesDe));
      return acotada(q.order('fecha').order('id').limit(PAGINA), 'sat_descarga.gastos_sin_cfdi');
    },
    (r) => llaveFechaId({ fecha: r.fecha, id: r.id }),
    'sat_descarga.gastos_sin_cfdi',
    { venceEn },
  );
  // Antes salían ordenados por `id` y `decidirCruce` los recorre en ese orden: se conserva EXACTO.
  const data = leidos.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return data.map((r) => ({
    id: r.id as string,
    concepto: r.concepto as Gasto['concepto'],
    monto: Number(r.monto),
    fecha: (r.fecha as string) || undefined,
    rfcEmisor: (r.rfc_emisor as string) || undefined,
    cfdiUuid: (r.cfdi_uuid as string) || undefined,
    ocrExtra: (r.ocr_extra as Record<string, unknown>) || undefined,
  }));
}

/**
 * Liga un CFDI a un gasto Y copia los campos fiscales de su XML (auditoría 35,
 * R04-fiscal-01: antes solo se marcaba `xml_verificado` y el gasto se quedaba
 * sin sub_total, IVA ni RFC receptor). La guardia optimista `cfdi_uuid is null`
 * es lo que hace segura la carrera contra el camino de WhatsApp: si entre la
 * lectura y la escritura alguien ya le pegó su XML al mismo ticket, no se toca
 * ninguna fila y se devuelve `false` — no se pisa un comprobante que ya estaba.
 * Toda la lógica vive en `liga_campos.ts` (con respaldo si la migración 0858
 * aún no está aplicada).
 */
async function ligar(tenantId: string, gastoId: string, cfdiUuid: string, xml: string): Promise<'ligado' | 'perdio_carrera' | 'fallo'> {
  const r = await ligarGastoAutomatico(tenantId, gastoId, cfdiUuid, xml);
  return r.ligado ? 'ligado' : r.fallo ? 'fallo' : 'perdio_carrera';
}

/**
 * Los conteos de UNA solicitud, separados del acumulador de la flota.
 *
 * Existen porque `ResumenFlota` acumula TODA la corrida: al cerrar la segunda
 * solicitud de una flota se escribía en `cfdis_nuevos` la suma de las dos, y
 * la columna promete literalmente «cuántos folios fiscales entraron NUEVOS en
 * ESTA solicitud» (0231:204). Una cifra inflada que el contador lee como
 * exacta.
 */
interface ConteoSolicitud { nuevos: number; repetidos: number }

/**
 * Ingiere los XML de un paquete: dedup por folio, cruce y escritura.
 *
 * AUDITORÍA 25, ALTO (REND-A3): un paquete real del SAT es «un ZIP con
 * MILES de CFDI» (cabecera del archivo) y a 3-4 viajes de red por CFDI aquí
 * dentro caben ~311 en los 280s de `venceEn` — un paquete de 2,000 pide
 * ~1,800s contra un `maxDuration` de 300. Sin reloj propio, Vercel mataba la
 * función A MEDIO PAQUETE: el heartbeat del cron nunca se escribía y el aviso
 * de cierre de peaje que corre DESPUÉS nunca llegaba, para NINGUNA flota.
 *
 * El checkpoint/reanudación no es nuevo: YA EXISTE, es el sello de dedup —
 * cada CFDI se marca en `sat_cfdi_descargado` en cuanto se ingiere, así que
 * re-ingerir el mismo XML dos veces es barato (una consulta que dice
 * "repetido" y sigue) en vez de re-procesarlo entero. Lo que faltaba era
 * SOLTAR el reloj a tiempo para que ese checkpoint sirviera de algo: cortar
 * aquí, antes de que Vercel corte, deja que el llamador NO marque el paquete
 * como bajado (`bajados.push` no corre) y la corrida siguiente lo re-baja
 * — el SAT permite bajar un paquete dos veces — y retoma justo donde se
 * quedó, saltando en un viaje de red cada CFDI ya sellado.
 */
async function ingerir(
  cfg: ConfigFlota,
  solicitudId: string,
  xmls: string[],
  rango: { desde: string; hasta: string },
  r: ResumenFlota,
  conteo: ConteoSolicitud,
  venceEn?: number,
  tipo: TipoDescarga = 'recibidos',
): Promise<{ completo: boolean }> {
  // A37-S57-04: un fallo al PERSISTIR (sello, XML crudo, estatus) no puede dar
  // el paquete por bajado ni avanzar el calendario: la vuelta siguiente lo
  // reintenta (el sello de dedup hace barato lo ya hecho).
  let hayFallo = false;
  const rfcBuzon = normalizarRfc(cfg.rfc);
  // REN-32C3-C1: este prólogo corría SIN reloj, 72 líneas por encima de la
  // lectura que `fc811a0` acotó, y en TODOS los paquetes —no solo en los que
  // traen consolidado—. El corte se traduce al contrato que este archivo ya
  // tiene para «se acabó el tiempo» (`completo: false`, unas líneas más abajo)
  // en vez de propagarse: un throw se saltaría el `update` de avance del
  // llamador, que es lo que hace barata la vuelta siguiente.
  let gastos: Gasto[];
  try {
    gastos = await gastosSinCfdi(cfg.tenantId, rango.desde, rango.hasta, venceEn);
  } catch (e) {
    if (!(e instanceof LecturaCortadaPorReloj)) throw e;
    logger.warn('sat.ingerir.corte_por_reloj_en_prologo', {
      tenantId: cfg.tenantId, solicitudId, sinIngerir: xmls.length,
    });
    r.sinTurno += xmls.length;
    return { completo: false };
  }
  // El fondo se consume: un gasto que ya casó en este mismo paquete no puede
  // volver a casar con el siguiente CFDI. Sin esto, dos comprobantes del mismo
  // importe se pegarían los dos al mismo ticket… y el update optimista dejaría
  // el segundo en silencio.
  const fondo = new Map(gastos.map((g) => [g.id, g]));

  for (let ix = 0; ix < xmls.length; ix++) {
    if (venceEn !== undefined && Date.now() >= venceEn) {
      logger.warn('sat.ingerir.corte_por_reloj', {
        tenantId: cfg.tenantId, solicitudId, sinIngerir: xmls.length - ix,
      });
      r.sinTurno += xmls.length - ix;
      return { completo: false };
    }
    const xml = xmls[ix];
    const cfdi = parseCfdiXml(xml);
    if (cfdi === null || !cfdi.uuid) {
      // Un XML ilegible NO se cuenta como comprobante inexistente: se dice.
      r.errores.push('Un archivo del paquete no se pudo leer como CFDI (sin folio fiscal legible).');
      continue;
    }
    const uuid = cfdi.uuid.toLowerCase();

    // ── A37-S57-01 / A37-S18-01: NADA AJENO ENTRA AL BUZÓN DE ESTA FLOTA ───
    // Defensa en profundidad tras atar el RFC al tenant: un recibido tiene que
    // venir a nombre del RFC del buzón (receptor); un emitido, de su emisor.
    // Lo demás se descarta SIN sellar y se dice: jamás se guarda un CFDI de un
    // tercero en el tenant que lo pidió.
    const rfcDelLado = normalizarRfc(tipo === 'emitidos' ? cfdi.rfcEmisor : cfdi.rfcReceptor);
    if (rfcDelLado !== rfcBuzon) {
      r.errores.push(`El CFDI ${uuid} no es ${tipo === 'emitidos' ? 'emitido' : 'recibido'} por el RFC del buzón de esta flota y se descartó.`);
      logger.error('sat.cfdi_ajeno_descartado', { tenantId: cfg.tenantId, solicitudId, tipo });
      continue;
    }

    // ── EL SELLO DE DEDUP, en la base ─────────────────────────────────────
    // El insert con `ignoreDuplicates` es la idempotencia: el mismo folio no
    // entra dos veces aunque dos rangos se traslapen o el cron se repita. Se
    // pregunta ANTES de cruzar, porque cruzar es lo caro.
    const { data: metido, error: errSello } = await acotada(supabaseAdmin()
      .from('sat_cfdi_descargado')
      .upsert({
        tenant_id: cfg.tenantId,
        cfdi_uuid: uuid,
        solicitud_id: solicitudId,
        rfc_emisor: cfdi.rfcEmisor ?? null,
        rfc_receptor: cfdi.rfcReceptor ?? null,
        total: cfdi.total ?? null,
        fecha: cfdi.fecha ? cfdi.fecha.slice(0, 10) : null,
        tipo_comprobante: cfdi.tipoComprobante ?? null,
        // A37-S57-02: un EMITIDO es un ingreso de la propia flota, no un
        // comprobante de gasto: se sella como 'ignorado' y no entra al cruce.
        estatus: tipo === 'emitidos' ? 'ignorado' : 'disponible',
      }, { onConflict: 'tenant_id,cfdi_uuid', ignoreDuplicates: true })
      .select('id'), 'sat_descarga.sello');
    if (errSello) {
      r.errores.push(`No se pudo registrar el CFDI ${uuid}: ${errSello.message}`);
      hayFallo = true;
      continue;
    }
    // REN-C1 (auditoría 29): `yaDescargado` distingue "ya está en la tabla de
    // deduplicación" de "ya terminó de procesarse" — para `consolidado` NO son
    // lo mismo. `decidirCruce` es puro (depende solo del propio CFDI, nunca de
    // `fondo`), así que corre SIEMPRE, incluso en un repetido: si esta vez
    // resulta ser un consolidado, se reintenta la conciliación más abajo en
    // vez de darla por hecha solo porque el sello ya existía.
    const yaDescargado = (metido ?? []).length === 0;
    if (yaDescargado) { r.cfdisRepetidos++; conteo.repetidos++; }
    else { r.cfdisNuevos++; conteo.nuevos++; }

    // A37-S57-02: los emitidos se sellan y listo; nunca se cruzan contra gastos
    // (copiarían IVA y RFC de una factura de VENTA a un ticket de compra).
    if (tipo === 'emitidos') continue;

    const decision = decidirCruce(cfdi, [...fondo.values()]);

    if (decision.destino === 'consolidado') {
      // El camino que YA existe para estos (0076): concilia línea por línea.
      // Nunca 1:1 — es la regla 3.3.1.7 hecha código.
      //
      // REN-C1: `guardarYConciliarConsolidado` YA es idempotente y reanudable
      // (líneas ya escritas → regresa el resumen sin re-correr el JOIN;
      // gastos ya sellados de una corrida anterior → se respetan y solo se
      // concilia el resto) — la única razón por la que antes "nunca se
      // reintentaba" era que este bloque ni se alcanzaba en un repetido. Un
      // corte duro de Vercel a media conciliación deja el sello puesto pero
      // `cfdi_consolidado_linea` incompleta; la corrida SIGUIENTE ahora sí
      // vuelve a entrar aquí y retoma justo donde se quedó, en vez de saltarlo
      // para siempre. Se reintenta siempre, no solo cuando es nuevo.
      try {
        await guardarYConciliarConsolidado(cfg.tenantId, cfdi, xml, venceEn);
        // AG-C1 (auditoría 30): `marcar` va FUERA del `if (!yaDescargado)`.
        // Reintentar la conciliación y no cerrar el ciclo es peor que no
        // reintentarla: el sello nace en 'disponible' —que es literalmente
        // «nadie reportó este gasto»—, así que el ECC recién conciliado se le
        // seguía ofreciendo al contralor para ligarlo 1:1 contra un ticket
        // suelto, justo lo que prohíbe la regla 3.3.1.7, y con el
        // acreditamiento ya repartido línea por línea. `marcar` es un `update`
        // idempotente: repetirlo sobre un CFDI ya 'ignorado' no cambia nada.
        //
        // El CONTADOR sí se queda adentro: `r.consolidados` cuenta los
        // consolidados nuevos de ESTA corrida, y sacarlo haría que un repetido
        // ya conciliado se recontara en cada pasada.
        if (!await marcar(cfg.tenantId, uuid, 'ignorado', null, {
          motivo: `CFDI de ${decision.emisor}: se concilió línea por línea (complemento ECC), no como comprobante único.`,
        })) hayFallo = true;
        if (!yaDescargado) r.consolidados++;
      } catch (e) {
        r.errores.push(`El consolidado ${uuid} no se pudo conciliar: ${e instanceof Error ? e.message : String(e)}`);
      }
      continue;
    }

    // A37-S57-04: un CFDI ya sellado NO se da por procesado a ciegas. Si la
    // primera pasada murió entre el sello y el cruce (o falló al guardar el
    // XML), sigue 'disponible' y se vuelve a procesar. Un 'disponible' legítimo
    // (sin gasto que le corresponda) simplemente se reevalúa: es idempotente.
    if (yaDescargado && !(await sigueSinProcesar(cfg.tenantId, uuid))) continue;

    if (decision.destino === 'casado') {
      const res = await ligar(cfg.tenantId, decision.gastoId, uuid, xml);
      if (res === 'ligado') {
        fondo.delete(decision.gastoId);
        if (!await saveCfdiXmlRaw(cfg.tenantId, uuid, decision.gastoId, xml)) {
          hayFallo = true;
          r.errores.push(`No se pudo guardar el XML del CFDI ${uuid} (ya ligado al gasto ${decision.gastoId}); se reintenta en la siguiente vuelta.`);
        }
        if (!await marcar(cfg.tenantId, uuid, 'casado', decision.gastoId, null)) hayFallo = true;
        r.casados++;
      } else if (res === 'fallo') {
        // A36-R03-02: un fallo de la base o de la red NO es «el gasto ya tenía
        // comprobante». El sello ya está puesto y el paquete se da por bajado,
        // así que esta corrida es la única que tiene el XML: se guarda y el
        // CFDI queda como 'ambiguo' con ESE gasto de candidato, que es lo que
        // le permite al contralor ligarlo con un clic (y copiar los campos del
        // XML crudo) en vez de perderlo. Sin migración no hay estatus
        // 'pendiente_reintento'; este es el más cercano que la base acepta.
        const g = fondo.get(decision.gastoId);
        if (!await saveCfdiXmlRaw(cfg.tenantId, uuid, null, xml)) hayFallo = true;
        if (!await marcar(cfg.tenantId, uuid, 'ambiguo', null, {
          motivo: 'No se pudo ligar automáticamente por un fallo temporal (no porque el gasto ya tuviera comprobante). Liga con un clic al gasto sugerido.',
          candidatos: [{ gastoId: decision.gastoId, monto: g?.monto ?? null, fecha: g?.fecha ?? null, concepto: g?.concepto ?? null }],
        })) hayFallo = true;
        r.errores.push(`No se pudo ligar el CFDI ${uuid} al gasto ${decision.gastoId} por un fallo temporal; quedó en la bandeja para ligarlo a mano.`);
        r.ambiguos++;
      } else {
        // Perdió la carrera: alguien ya le pegó su comprobante a ese ticket.
        // Queda disponible y se dice — jamás se pisa un CFDI existente.
        if (!await saveCfdiXmlRaw(cfg.tenantId, uuid, null, xml)) hayFallo = true;
        if (!await marcar(cfg.tenantId, uuid, 'disponible', null, {
          motivo: 'El gasto que le correspondía ya tenía comprobante cuando se intentó ligar (llegó por otro camino).',
        })) hayFallo = true;
        r.disponibles++;
      }
      continue;
    }

    if (decision.destino === 'ambiguo') {
      // El XML crudo se conserva también aquí: si el contralor resuelve a mano,
      // `ligarComprobante` lo lee para copiar los campos fiscales (R04-fiscal-01).
      if (!await saveCfdiXmlRaw(cfg.tenantId, uuid, null, xml)) hayFallo = true;
      if (!await marcar(cfg.tenantId, uuid, 'ambiguo', null, { candidatos: decision.candidatos })) hayFallo = true;
      r.ambiguos++;
      continue;
    }

    if (!await saveCfdiXmlRaw(cfg.tenantId, uuid, null, xml)) hayFallo = true;
    if (!await marcar(cfg.tenantId, uuid, 'disponible', null, { motivo: decision.motivo })) hayFallo = true;
    r.disponibles++;
  }
  if (hayFallo) {
    r.errores.push('Hubo CFDI que no se pudieron guardar por completo; el paquete NO se da por bajado y se reintenta en la siguiente vuelta.');
    return { completo: false };
  }
  return { completo: true };
}

/** ¿El CFDI ya sellado quedó 'disponible' (nadie lo cruzó o su primera pasada murió)? Ante un
 *  error de lectura se asume que SÍ: reprocesar es idempotente, saltarlo lo pierde (A37-S57-04). */
async function sigueSinProcesar(tenantId: string, uuid: string): Promise<boolean> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('sat_cfdi_descargado')
    .select('estatus')
    .eq('tenant_id', tenantId)
    .eq('cfdi_uuid', uuid)
    .maybeSingle(), 'sat_descarga.estatus_sello');
  if (error) return true;
  const estatus = (data as { estatus?: unknown } | null)?.estatus;
  return estatus === undefined || estatus === 'disponible';
}

async function marcar(
  tenantId: string, uuid: string,
  estatus: 'casado' | 'disponible' | 'ambiguo' | 'ignorado',
  gastoId: string | null,
  candidatos: Record<string, unknown> | null,
): Promise<boolean> {
  const { error } = await acotada(supabaseAdmin()
    .from('sat_cfdi_descargado')
    .update({ estatus, gasto_id: gastoId, candidatos })
    .eq('tenant_id', tenantId)
    .eq('cfdi_uuid', uuid), 'sat_descarga.marcar');
  if (error) logger.warn('sat.marcar_fallo', { tenantId, err: error.message });
  // A37-S57-04: el retorno se mira. Un estatus que no se escribió deja el CFDI
  // 'disponible' para siempre aunque exista su gasto.
  return !error;
}

/**
 * Los paquetes que ESTA solicitud ya ingirió, leídos de `paquetes_bajados`.
 *
 * NULL significa «todavía no se ha bajado ninguno», y eso es una lista vacía
 * PARA REANUDAR — no una lista vacía medida. Cualquier cosa que no sea un
 * arreglo de textos se descarta con un aviso en vez de adivinar: reanudar
 * sobre basura sería peor que volver a empezar, porque el dedup por folio
 * (`unique (tenant_id, cfdi_uuid)`) protege la re-ingesta, pero nada protege
 * de dar por bajado un paquete que no se bajó.
 */
export function paquetesYaBajados(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((p): p is string => typeof p === 'string' && p.length > 0);
}

/**
 * Cuántos folios fiscales entraron NUEVOS por esta solicitud, contados sobre
 * el propio sello de dedup.
 *
 * Se cuenta en la base y no en una variable de JavaScript a propósito: el
 * sello `unique (tenant_id, cfdi_uuid)` es lo que define «nuevo», y una
 * solicitud puede cerrarse VARIAS CORRIDAS después de empezar a ingerir (los
 * paquetes se reanudan). Un contador en memoria no sobrevive a eso; una
 * consulta sobre `solicitud_id` sí, y da la misma cifra siempre.
 *
 * Devuelve `null` cuando la consulta falló — que NO es 0. Quien lo llama deja
 * la columna como estaba en vez de escribir un cero que nadie midió.
 */
async function contarNuevosDeSolicitud(tenantId: string, solicitudId: string): Promise<number | null> {
  const { count, error } = await acotada(supabaseAdmin()
    .from('sat_cfdi_descargado')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('solicitud_id', solicitudId), 'sat_descarga.contar_nuevos');
  if (error || typeof count !== 'number') return null;
  return count;
}

/** ¿Esta solicitud lleva atorada más de `HORAS_SOLICITUD_ATORADA` sin folio? */
export function solicitudAtorada(
  estado: string,
  requestId: string | null,
  solicitadaEn: string | null,
  ahora: Date,
  horas = HORAS_SOLICITUD_ATORADA,
): boolean {
  if (requestId !== null || estado !== 'solicitada') return false;
  if (solicitadaEn === null) return false; // sin fecha no se afirma nada
  const t = Date.parse(solicitadaEn);
  if (!Number.isFinite(t)) return false;
  return ahora.getTime() - t >= horas * 3_600_000;
}

/**
 * Suelta una solicitud que se quedó viva sin folio del SAT y DICE POR QUÉ.
 *
 * Pasa a 'error' —un estado terminal— para que el rango se pueda volver a
 * pedir: es la única salida, porque sin `request_id` ese trámite no se puede
 * verificar ni descargar jamás, exista o no del lado del SAT.
 */
async function soltarSolicitudAtorada(
  tenantId: string, solicitudId: string, intentos: number,
  desde: string, hasta: string, r: ResumenFlota,
): Promise<boolean> {
  const mensaje = `El proveedor no contestó al abrir este trámite y la solicitud se quedó más de ${HORAS_SOLICITUD_ATORADA} h viva sin folio del SAT. Sin folio no se puede verificar ni descargar, así que se cierra para que el rango ${desde}→${hasta} se pueda volver a pedir. Si el SAT sí llegó a abrir el trámite, la petición nueva vuelve a consumir el tope diario del RFC.`;
  const { error } = await acotada(supabaseAdmin().from('sat_descarga_solicitud')
    .update({ estado: 'error', proveedor_mensaje: mensaje, intentos: intentos + 1 })
    .eq('tenant_id', tenantId).eq('id', solicitudId)
    .eq('estado', 'solicitada').is('request_id', null), 'sat_descarga.soltar_atorada');
  if (error) {
    r.errores.push(`No se pudo soltar la solicitud atorada del rango ${desde}→${hasta}: ${error.message}`);
    return false;
  }
  r.errores.push(mensaje);
  logger.warn('sat.solicitud_atorada_soltada', { tenantId, solicitudId, desde, hasta });
  return true;
}

/** Empuja UN paso del ciclo para UNA flota.
 *
 *  `venceEn` es EL RELOJ DE LA VUELTA (epoch ms) — el instante a partir del
 *  cual esta invocación de Vercel ya no cabe. Ver la nota grande de
 *  `correrDescargaSat`. Sin él la flota se atiende entera, como siempre. */
export async function correrFlota(
  cfg: ConfigFlota,
  prov: ProveedorDescargaSat,
  hoy: string,
  ahora: Date = new Date(),
  venceEn?: number,
): Promise<ResumenFlota> {
  const r = vacio(cfg.tenantId);

  // ── 1. Verificar lo que ya está en curso ────────────────────────────────
  const { data: vivas, error: errVivas } = await acotada(supabaseAdmin()
    .from('sat_descarga_solicitud')
    .select('id, request_id, tipo, desde, hasta, estado, intentos, paquetes_bajados, cfdis_nuevos, cfdis_repetidos, solicitada_en')
    .eq('tenant_id', cfg.tenantId)
    .in('estado', ['solicitada', 'en_proceso', 'lista'])
    .order('solicitada_en', { ascending: true })
    .limit(MAX_VERIFICAR), 'sat_descarga.vivas');
  if (errVivas) throw new Error(`correrFlota.vivas: ${errVivas.message}`);

  let paquetesBajados = 0;
  /** Las que este barrido soltó: dejan de contar como vivas para el paso 2. */
  const soltadas = new Set<string>();
  const listaVivas = vivas ?? [];
  for (let iv = 0; iv < listaVivas.length; iv++) {
    const s = listaVivas[iv];
    // ── EL RELOJ, ANTES DE PREGUNTARLE AL PROVEEDOR (c7-1) ──────────────────
    // Cada vuelta de aquí es una llamada de RED al PAC (`prov.verificar`) más
    // uno o dos UPDATE, por hasta `MAX_VERIFICAR` solicitudes, en serie — y eso
    // multiplicado por cada flota del barrido de afuera.
    //
    // El punto seguro es ÉSTE: antes de `prov.verificar`, cuando todavía no se
    // ha tocado nada de esta solicitud. Cortar más adelante —entre la
    // verificación y el UPDATE que la anota— tiraría el resultado de una
    // llamada ya pagada y dejaría la solicitud con un `intentos` que no
    // corresponde. Cortar aquí no deja nada a medias: el ciclo entero está
    // diseñado para retomarse (el estado vive en `sat_descarga_solicitud`, no
    // en memoria), así que una solicitud sin verificar hoy se verifica en la
    // pasada de dentro de seis horas exactamente igual.
    if (venceEn !== undefined && Date.now() >= venceEn) {
      r.sinTurno += listaVivas.length - iv;
      logger.warn('sat.flota.corte_por_reloj', {
        tenantId: cfg.tenantId, sinVerificar: listaVivas.length - iv, verificadas: r.verificadas,
      });
      return r;
    }
    const requestId = s.request_id as string | null;
    if (requestId === null) {
      // Un intento sin trámite no se puede verificar: no hay qué preguntar.
      // Pero tampoco se puede dejar ahí para siempre (ver
      // HORAS_SOLICITUD_ATORADA) — a las 24 h se suelta y se dice.
      if (solicitudAtorada(s.estado as string, requestId, s.solicitada_en as string | null, ahora)) {
        const ok = await soltarSolicitudAtorada(
          cfg.tenantId, s.id as string, Number(s.intentos ?? 0),
          s.desde as string, s.hasta as string, r,
        );
        if (ok) soltadas.add(s.id as string);
      }
      continue;
    }
    const v = await prov.verificar(requestId);
    r.verificadas++;
    if (!v.ok) {
      r.errores.push(`Solicitud ${requestId}: ${v.mensaje}`);
      await acotada(supabaseAdmin().from('sat_descarga_solicitud')
        .update({
          verificada_en: new Date().toISOString(),
          intentos: Number(s.intentos ?? 0) + 1,
          proveedor_mensaje: v.mensaje,
          // Un fallo de red NO cierra el trámite: sigue vivo del lado del SAT.
          ...(v.clase === 'red' ? {} : { estado: 'error' }),
        })
        .eq('tenant_id', cfg.tenantId).eq('id', s.id), 'sat_descarga.verificar_err');
      continue;
    }

    if (v.estado !== 'lista') {
      await acotada(supabaseAdmin().from('sat_descarga_solicitud')
        .update({
          estado: v.estado === 'en_proceso' ? 'en_proceso' : v.estado,
          verificada_en: new Date().toISOString(),
          intentos: Number(s.intentos ?? 0) + 1,
          proveedor_mensaje: v.mensaje,
        })
        .eq('tenant_id', cfg.tenantId).eq('id', s.id), 'sat_descarga.verificar');
      continue;
    }

    // Lista: bajar sus paquetes, con tope por corrida.
    await acotada(supabaseAdmin().from('sat_descarga_solicitud')
      .update({ estado: 'lista', paquetes: v.paquetes, verificada_en: new Date().toISOString() })
      .eq('tenant_id', cfg.tenantId).eq('id', s.id), 'sat_descarga.lista');

    const rango = { desde: s.desde as string, hasta: s.hasta as string };

    // ── EL AVANCE POR PAQUETE (0236) ──────────────────────────────────────
    // Lo que ya se ingirió no se vuelve a bajar: se reanuda por el primero
    // pendiente. El paquete del SAT vive 72 h y se puede bajar 2 veces, así
    // que re-bajarlo no sólo es trabajo repetido — a partir de la tercera
    // vuelta es un RECHAZO del proveedor.
    const bajados = paquetesYaBajados(s.paquetes_bajados);
    const yaEstan = new Set(bajados);
    const pendientes = v.paquetes.filter((p) => !yaEstan.has(p));

    // Los conteos de ESTA solicitud, arrastrando lo que corridas anteriores
    // ya dejaron escrito. `?? 0` aquí no confunde null con cero: la columna
    // NULL significa «todavía no se ha ingerido nada», que es exactamente el
    // punto de partida correcto para sumarle lo que se acaba de ingerir.
    let nuevosDeLaSolicitud = Number(s.cfdis_nuevos ?? 0);
    let repetidosDeLaSolicitud = Number(s.cfdis_repetidos ?? 0);

    let todoBien = true;
    for (let ip = 0; ip < pendientes.length; ip++) {
      const p = pendientes[ip];
      if (paquetesBajados >= MAX_PAQUETES) { todoBien = false; break; }
      // ── EL RELOJ, ANTES DE QUEMAR CUOTA DEL SAT (c7-1 + criterio #160) ─────
      // ÉSTE ES EL CORTE MÁS DELICADO DEL ARCHIVO, y el que mejor ilustra la
      // regla de «se pregunta antes de reservar el sello, nunca entre reservar
      // y actuar». Aquí el sello no es una fila nuestra: es la CUOTA DEL SAT.
      // Un paquete se puede bajar DOS veces y a la tercera el proveedor lo
      // RECHAZA. Si el reloj cortara después de `prov.descargar` y antes del
      // UPDATE de `paquetes_bajados`, el paquete quedaría bajado para el SAT y
      // pendiente para nosotros: la próxima corrida lo volvería a pedir, y la
      // siguiente se llevaría el rechazo. Habríamos gastado el derecho a bajar
      // un paquete para tirar su contenido — el equivalente exacto de la
      // reserva tomada y no usada que enterraba el aviso de peaje del mes.
      //
      // Así que se pregunta AQUÍ: antes de contar el paquete, antes de la
      // llamada, cuando todavía no se le debe nada a nadie. Y NO se corta
      // dentro de `ingerir`: un paquete es la unidad atómica de este ciclo —se
      // baja, se ingiere y se anota— y partirlo por la mitad dejaría CFDI
      // ingeridos dentro de un paquete que no figura como bajado.
      //
      // `todoBien = false` NO ES OPCIONAL, y es la parte que de verdad muerde:
      // sin él, la solicitud se marcaría 'descargada' y `ultima_descarga_hasta`
      // AVANZARÍA con paquetes sin bajar. Ese calendario no retrocede nunca, así
      // que los CFDI de esos días quedarían fuera para siempre — el modo de
      // falla silencioso que el comentario de abajo ya declaraba inaceptable.
      // Un corte por reloj no puede convertirse en pérdida de datos fiscales.
      if (venceEn !== undefined && Date.now() >= venceEn) {
        todoBien = false;
        r.sinTurno += pendientes.length - ip;
        logger.warn('sat.paquetes.corte_por_reloj', {
          tenantId: cfg.tenantId, requestId, sinBajar: pendientes.length - ip, bajadosEnEstaVuelta: paquetesBajados,
        });
        break;
      }
      paquetesBajados++;
      const d = await prov.descargar(p);
      if (!d.ok) {
        r.errores.push(`Paquete de ${requestId}: ${d.mensaje}`);
        todoBien = false;
        continue;
      }
      const conteo: ConteoSolicitud = { nuevos: 0, repetidos: 0 };
      const resultado = await ingerir(cfg, s.id as string, d.xmls, rango, r, conteo, venceEn, s.tipo === 'emitidos' ? 'emitidos' : 'recibidos');
      nuevosDeLaSolicitud += conteo.nuevos;
      repetidosDeLaSolicitud += conteo.repetidos;

      // AUDITORÍA 25, ALTO (REND-A3): `ingerir` cortó por reloj a media pila
      // de XML del paquete. El paquete YA se descargó (`d.xmls` completo), así
      // que lo ingerido hasta el corte SÍ se cuenta abajo — solo NO se marca
      // como bajado (`bajados.push` se omite): el SAT deja bajarlo una segunda
      // vez, la corrida siguiente lo re-descarga e `ingerir` retoma barato
      // gracias al sello de dedup (cada CFDI ya sellado responde "repetido"
      // en un solo viaje de red, no se re-procesa). Los paquetes restantes de
      // esta vuelta ni se intentan.
      if (resultado.completo) bajados.push(p);
      else {
        todoBien = false;
        r.sinTurno += pendientes.length - ip - 1;
      }

      // El avance se anota PAQUETE POR PAQUETE, no al final: si la función
      // muere aquí (Vercel corta a los 300 s), lo ingerido ya está contado y
      // la vuelta siguiente arranca en el que sigue.
      const { error: errAvance } = await acotada(supabaseAdmin().from('sat_descarga_solicitud')
        .update({
          paquetes_bajados: bajados,
          cfdis_nuevos: nuevosDeLaSolicitud,
          cfdis_repetidos: repetidosDeLaSolicitud,
        })
        .eq('tenant_id', cfg.tenantId).eq('id', s.id), 'sat_descarga.avance_paquete');
      if (errAvance) {
        // Si el avance no se puede anotar, SEGUIR bajando sería quemar cuota
        // del SAT en paquetes que la próxima corrida volvería a pedir igual.
        // Se corta esta solicitud y se dice: fail-closed.
        r.errores.push(`No se pudo anotar el avance del paquete de ${requestId}: ${errAvance.message}`);
        todoBien = false;
        break;
      }
      if (!resultado.completo) break;
    }

    if (todoBien) {
      r.descargadas++;
      // La cifra exacta se cuenta sobre el sello de dedup; si la consulta
      // falla, se deja lo que el avance por paquete ya dejó escrito en vez de
      // inventar un total.
      const nuevosExactos = await contarNuevosDeSolicitud(cfg.tenantId, s.id as string);
      await acotada(supabaseAdmin().from('sat_descarga_solicitud')
        .update({
          estado: 'descargada', descargada_en: new Date().toISOString(),
          paquetes_bajados: bajados,
          cfdis_nuevos: nuevosExactos ?? nuevosDeLaSolicitud,
          cfdis_repetidos: repetidosDeLaSolicitud,
        })
        .eq('tenant_id', cfg.tenantId).eq('id', s.id), 'sat_descarga.descargada');
      // El avance del calendario SOLO cuando el rango se bajó COMPLETO. Mover
      // `ultima_descarga_hasta` con un paquete a medias saltaría días para
      // siempre — el modo de falla silencioso que este producto no acepta.
      //
      // A37-S57-02: SOLO una solicitud de RECIBIDOS contigua al calendario lo
      // mueve. Una descarga manual de «emitidos» —o un rango manual reciente
      // que deja un hueco— lo saltaba por encima de días de recibidos nunca
      // pedidos, y ese calendario no retrocede.
      if (rango.hasta > (cfg.ultimaHasta ?? '') && avanzaCalendario(s.tipo as string, rango.desde, cfg.ultimaHasta, hoy)) {
        await acotada(supabaseAdmin().from('sat_descarga_config')
          .update({ ultima_descarga_hasta: rango.hasta, actualizado_en: new Date().toISOString() })
          .eq('tenant_id', cfg.tenantId), 'sat_descarga.avanzar');
        cfg.ultimaHasta = rango.hasta;
      }
    }
  }

  // ── 2. Pedir el siguiente rango, si no hay nada vivo de ese tipo ─────────
  const tipo: TipoDescarga = 'recibidos'; // el buzón que da el valor
  // Las que este barrido acaba de soltar YA NO están vivas: si siguieran
  // contando, la flota que se destrabó a las 24 h tendría que esperar otras
  // 6 h a la corrida siguiente para volver a pedir.
  const hayViva = (vivas ?? []).some((s) => s.tipo === tipo
    && !soltadas.has(s.id as string)
    && ['solicitada', 'en_proceso', 'lista'].includes(s.estado as string));
  if (!hayViva) {
    const rango = rangoPendiente(cfg.ultimaHasta, hoy);
    if (rango !== null) {
      // Se registra el INTENTO antes de llamar (reserva-antes-de-llamar,
      // patrón 0227): si el proveedor contesta con un timeout ambiguo, la fila
      // ya existe y nadie vuelve a pedir el mismo rango a ciegas.
      const { data: fila, error: errIns } = await acotada(supabaseAdmin()
        .from('sat_descarga_solicitud')
        .insert({
          tenant_id: cfg.tenantId, proveedor: prov.nombre, tipo,
          desde: rango.desde, hasta: rango.hasta, estado: 'solicitada', intentos: 1,
        })
        .select('id')
        .single(), 'sat_descarga.reservar');
      if (errIns || fila === null) {
        // EL CANDADO REBOTANDO NO ES UN FALLO; CUALQUIER OTRA COSA, SÍ.
        //
        // Antes, TODO error entraba por esta puerta como un `logger.info`
        // benigno: base caída, tope de `acotada` agotado, violación del CHECK
        // de rango, permisos. La flota no pedía nada esa corrida y el latido
        // salía 'ok' porque `r.errores` quedaba vacío — fail-open silencioso
        // justo en la puerta que decide si se le pide algo al SAT.
        const codigo = sqlstateDe(errIns);
        if (codigo !== null && CODIGOS_RANGO_YA_VIVO.has(codigo)) {
          logger.info('sat.rango_ya_pedido', { tenantId: cfg.tenantId, codigo, ...rango });
        } else {
          const detalle = errIns?.message ?? 'la base no devolvió la fila reservada';
          r.errores.push(`No se pudo reservar la solicitud del rango ${rango.desde}→${rango.hasta}: ${detalle}`);
          logger.error('sat.reserva_fallo', { tenantId: cfg.tenantId, codigo, err: detalle, ...rango });
        }
      } else {
        const s = await prov.solicitar({ rfc: cfg.rfc, ...rango, tipo });
        if (s.ok) {
          r.solicitadas++;
          await acotada(supabaseAdmin().from('sat_descarga_solicitud')
            .update({ request_id: s.requestId, estado: 'en_proceso' })
            .eq('tenant_id', cfg.tenantId).eq('id', fila.id), 'sat_descarga.solicitada');
        } else {
          r.errores.push(s.mensaje);
          await acotada(supabaseAdmin().from('sat_descarga_solicitud')
            .update({
              proveedor_mensaje: s.mensaje,
              // Un timeout al SOLICITAR es AMBIGUO: el trámite pudo abrirse.
              // Se deja 'solicitada' (viva, sin request_id) para que nadie
              // vuelva a pedir el mismo rango, y un humano lo resuelva.
              ...(s.clase === 'red' ? {} : { estado: 'error' }),
            })
            .eq('tenant_id', cfg.tenantId).eq('id', fila.id), 'sat_descarga.solicitud_err');
        }
      }
    }
  }

  return r;
}

export interface ResumenCorrida {
  corrio: boolean;
  motivo?: string;
  /** El `configurado` de `estadoDescargaSat()`, tal cual — AUDITORÍA PROD
   *  29-AGO-2026 (ronda 21): antes de este campo, la única señal de "esto es
   *  un hueco de configuración, no una regresión" que viajaba hasta el latido
   *  era la PROSA de `motivo`, y `esHuecoDeConfiguracion` (`admin/salud.ts`)
   *  solo reconocía la redacción de UNA de las cuatro ramas de
   *  `estadoDescargaSat()` (proveedor ausente). Las otras tres — proveedor
   *  declarado y no construido, proveedor desconocido, credenciales
   *  incompletas — se leían como regresión real. Este booleano es el mismo
   *  que la función YA calculaba internamente; ahora viaja hasta
   *  `registrarLatido` (`cron/descarga-sat/route.ts`) para que la
   *  clasificación en `/api/health` se decida sobre un campo estructurado, no
   *  sobre si alguien redactó el motivo con las palabras correctas. */
  configurado: boolean;
  flotas: number;
  resumenes: ResumenFlota[];
  /** Unidades de trabajo que el RELOJ DE LA VUELTA dejó sin mirar en TODO el
   *  barrido: las flotas a las que no se llegó, más lo que quedó pendiente
   *  dentro de las que sí (`ResumenFlota.sinTurno`).
   *
   *  La ruta la mira para decidir el latido: `> 0` es `'parcial'`, nunca `'ok'`.
   *  Un barrido cortado que se reporta verde es la clase de mentira que dejó al
   *  runner mudo el 25 y el 28 de agosto de 2026. */
  sinTurno: number;
}

/**
 * El barrido de todas las flotas con descarga encendida.
 *
 * ── EL RELOJ DE LA VUELTA (auditoría ciclo 7, c7-1; deuda anotada por el fork
 * del #160) ─────────────────────────────────────────────────────────────────
 *
 * Este barrido corría SIN RELOJ PROPIO. La ruta ya calculaba un `venceEn` y se
 * lo pasaba a `avisarCierrePeaje`, que corre DESPUÉS — así que cuando la
 * descarga se comía la vuelta, lo que se veía era el aviso de peaje saliendo
 * con `sinTurno` alto y el latido diciendo `'parcial'`: el problema era VISIBLE
 * pero no estaba arreglado, y quien pagaba la factura era el otro trabajo.
 *
 * Y este barrido tiene todo para comérsela: hasta 200 flotas, cada una con
 * llamadas de RED a un PAC (verificar y descargar paquetes de miles de CFDI)
 * más la ingesta fila por fila. Nada de eso es acotable a ojo — depende del
 * proveedor, no de nosotros.
 *
 * El corte es LIMPIO por diseño del ciclo: el estado vive en
 * `sat_descarga_solicitud`, no en memoria, y cada paquete ingerido se anota en
 * cuanto se ingiere (0236). Una flota que no se miró hoy se mira en la pasada
 * de dentro de seis horas sin haber perdido nada.
 */
export async function correrDescargaSat(
  ahora: Date = new Date(),
  opts: {
    venceEn?: number;
    /** Flotas con perfil (0770) que esta descarga SALTA: la descarga del SAT es un módulo en stand-by. */
    excluirTenants?: ReadonlySet<string>;
  } = {},
): Promise<ResumenCorrida> {
  const estado = estadoDescargaSat();
  const prov = resolverDescargaSat();
  if (prov === null) {
    // NO se simula nada y NO se devuelve un verde de mentira: se dice qué
    // falta, con las palabras que la pantalla también usa.
    return {
      corrio: false, motivo: estado.motivo ?? 'La descarga masiva no está configurada.',
      configurado: estado.configurado, flotas: 0, resumenes: [], sinTurno: 0,
    };
  }

  const { data: configs, error } = await acotada(supabaseAdmin()
    .from('sat_descarga_config')
    .select('tenant_id, rfc, ultima_descarga_hasta')
    .eq('activa', true)
    // A37-L-07: con más de 200 flotas, `.limit(200)` sin orden devolvía 200
    // cualesquiera y las del final podían no atenderse nunca. Las más
    // atrasadas (NULL = nunca descargada, luego la fecha más vieja) van
    // primero; al avanzar `ultima_descarga_hasta` una flota atendida pasa al
    // final y las demás entran en la siguiente pasada (rotación sin cursor).
    .order('ultima_descarga_hasta', { ascending: true, nullsFirst: true })
    .order('tenant_id')
    .limit(200), 'sat_descarga.configs');
  if (error) throw new Error(`correrDescargaSat: ${error.message}`);

  const hoy = hoyMx(ahora);
  const resumenes: ResumenFlota[] = [];
  const saltarFlotas = opts.excluirTenants;
  const lista = saltarFlotas && saltarFlotas.size > 0
    ? (configs ?? []).filter((c) => !saltarFlotas.has(String(c.tenant_id)))
    : (configs ?? []);
  // A37-S57-01 / A37-S18-01 (CRÍTICO): el barrido SOLO pide el buzón cuyo RFC
  // es el fiscal verificado del tenant (`tenant.rfc`). Una fila con otro RFC
  // —declarada antes del candado o por una vía que lo rodee— no se pide: se
  // dice y la flota queda sin descargar, nunca descargando el buzón de otra.
  // Si `tenant.rfc` no se puede leer, el barrido entero falla cerrado.
  const rfcsFiscales = await rfcsFiscalesDeTenants(lista.map((c) => String(c.tenant_id)));
  let flotasSinTurno = 0;
  for (let i = 0; i < lista.length; i++) {
    const c = lista[i];
    // ── EL RELOJ, ANTES DE ABRIR OTRA FLOTA (c7-1) ─────────────────────────
    // La frontera entre flotas es el punto de corte más barato y más honesto
    // que tiene este barrido: cada flota es independiente y su ciclo es
    // reanudable por diseño. Cortar aquí no interrumpe ninguna conversación con
    // el PAC ni deja una solicitud a medio verificar — simplemente no se
    // empieza.
    //
    // Se cuentan las que se quedaron sin mirar, con nombre en el log y con
    // número en el resumen: «se acabó el tiempo» sin el número es media verdad,
    // y el latido necesita el número para decir `'parcial'` con fundamento.
    if (opts.venceEn !== undefined && Date.now() >= opts.venceEn) {
      flotasSinTurno = lista.length - i;
      logger.warn('sat.barrido.corte_por_reloj', {
        flotasSinTurno, atendidas: resumenes.length,
        pendientes: lista.slice(i).map((x) => x.tenant_id as string).slice(0, 20),
      });
      break;
    }
    if (rfcsFiscales.get(String(c.tenant_id)) !== normalizarRfc(c.rfc)) {
      const r = vacio(String(c.tenant_id));
      r.errores.push('El RFC del buzón no coincide con el RFC fiscal verificado de la flota: no se descarga. Un contacto de Likida debe revisarlo.');
      resumenes.push(r);
      logger.error('sat.rfc_buzon_no_es_del_tenant', { tenantId: String(c.tenant_id) });
      continue;
    }
    const cfg: ConfigFlota = {
      tenantId: c.tenant_id as string,
      rfc: c.rfc as string,
      ultimaHasta: (c.ultima_descarga_hasta as string) || null,
    };
    try {
      resumenes.push(await correrFlota(cfg, prov, hoy, ahora, opts.venceEn));
    } catch (e) {
      // Una flota que revienta no puede tumbar a las demás: se registra su
      // fallo como suyo y el barrido sigue.
      const r = vacio(cfg.tenantId);
      r.errores.push(e instanceof Error ? e.message : String(e));
      resumenes.push(r);
      logger.error('sat.flota_fallo', { tenantId: cfg.tenantId, err: e instanceof Error ? e.message : String(e) });
    }
  }
  // Las flotas que no se abrieron MÁS lo que quedó pendiente dentro de las que
  // sí. Se suman en un solo número porque para el latido significan lo mismo
  // —«esta pasada dejó trabajo del SAT sin hacer»—, y el detalle por flota
  // sigue estando en `resumenes[].sinTurno` para quien lo necesite.
  const sinTurno = flotasSinTurno + resumenes.reduce((n, x) => n + x.sinTurno, 0);
  return { corrio: true, configurado: true, flotas: resumenes.length, resumenes, sinTurno };
}
