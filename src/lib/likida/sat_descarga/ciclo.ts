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
import { logger } from '@/lib/logger';
import { hoyMx } from '@/lib/formato';
import type { Gasto } from '@/types/likida';
import { parseCfdiXml } from '../intake/cfdi_xml';
import { guardarYConciliarConsolidado } from '../intake/consolidado';
import { saveCfdiXmlRaw } from '../repo';
import { resolverDescargaSat, estadoDescargaSat } from './index';
import { decidirCruce } from './cruce';
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
 *  veces al día que un timeout que no deja nada. */
const MAX_PAQUETES = 3;

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

/** Los gastos de la flota que TODAVÍA no tienen comprobante — el fondo contra
 *  el que se cruza. Se acota por fecha alrededor del rango bajado: cruzar
 *  contra el histórico entero sería lento y no más correcto (el CFDI y su
 *  ticket son del mismo periodo). */
async function gastosSinCfdi(tenantId: string, desde: string, hasta: string): Promise<Gasto[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('gasto')
    .select('id, concepto, monto, fecha, rfc_emisor, cfdi_uuid, ocr_extra')
    .eq('tenant_id', tenantId)
    .is('cfdi_uuid', null)
    // Un día de holgura a cada lado: la fecha del ticket (OCR) y la del
    // timbrado pueden diferir en uno, igual que en la conciliación de
    // consolidados (VENTANA_DIAS_FECHA, 0076).
    .gte('fecha', sumarDias(desde, -1))
    .lte('fecha', sumarDias(hasta, 1))
    .limit(5000), 'sat_descarga.gastos_sin_cfdi');
  if (error) throw new Error(`gastosSinCfdi: ${error.message}`);
  return (data ?? []).map((r) => ({
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
 * Liga un CFDI a un gasto. La guardia optimista `.is('cfdi_uuid', null)` es lo
 * que hace segura la carrera contra el camino de WhatsApp: si entre la lectura
 * y la escritura alguien ya le pegó su XML al mismo ticket, este update no
 * afecta ninguna fila y se devuelve `false` — no se pisa un comprobante que ya
 * estaba. Mismo patrón que `ligarLineaAGasto` (0076).
 */
async function ligar(tenantId: string, gastoId: string, cfdiUuid: string): Promise<boolean> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('gasto')
    .update({ cfdi_uuid: cfdiUuid, cfdi_orden: 1, xml_verificado: true })
    .eq('tenant_id', tenantId)
    .eq('id', gastoId)
    .is('cfdi_uuid', null)
    .select('id'), 'sat_descarga.ligar');
  if (error) {
    logger.warn('sat.ligar_fallo', { tenantId, err: error.message });
    return false;
  }
  return (data ?? []).length === 1;
}

/** Ingiere los XML de un paquete: dedup por folio, cruce y escritura. */
async function ingerir(
  cfg: ConfigFlota,
  solicitudId: string,
  xmls: string[],
  rango: { desde: string; hasta: string },
  r: ResumenFlota,
): Promise<void> {
  const gastos = await gastosSinCfdi(cfg.tenantId, rango.desde, rango.hasta);
  // El fondo se consume: un gasto que ya casó en este mismo paquete no puede
  // volver a casar con el siguiente CFDI. Sin esto, dos comprobantes del mismo
  // importe se pegarían los dos al mismo ticket… y el update optimista dejaría
  // el segundo en silencio.
  const fondo = new Map(gastos.map((g) => [g.id, g]));

  for (const xml of xmls) {
    const cfdi = parseCfdiXml(xml);
    if (cfdi === null || !cfdi.uuid) {
      // Un XML ilegible NO se cuenta como comprobante inexistente: se dice.
      r.errores.push('Un archivo del paquete no se pudo leer como CFDI (sin folio fiscal legible).');
      continue;
    }
    const uuid = cfdi.uuid.toLowerCase();

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
        estatus: 'disponible',
      }, { onConflict: 'tenant_id,cfdi_uuid', ignoreDuplicates: true })
      .select('id'), 'sat_descarga.sello');
    if (errSello) {
      r.errores.push(`No se pudo registrar el CFDI ${uuid}: ${errSello.message}`);
      continue;
    }
    if ((metido ?? []).length === 0) { r.cfdisRepetidos++; continue; }
    r.cfdisNuevos++;

    const decision = decidirCruce(cfdi, [...fondo.values()]);

    if (decision.destino === 'consolidado') {
      // El camino que YA existe para estos (0076): concilia línea por línea.
      // Nunca 1:1 — es la regla 3.3.1.7 hecha código.
      try {
        await guardarYConciliarConsolidado(cfg.tenantId, cfdi, xml);
        r.consolidados++;
        await marcar(cfg.tenantId, uuid, 'ignorado', null, {
          motivo: `CFDI de ${decision.emisor}: se concilió línea por línea (complemento ECC), no como comprobante único.`,
        });
      } catch (e) {
        r.errores.push(`El consolidado ${uuid} no se pudo conciliar: ${e instanceof Error ? e.message : String(e)}`);
      }
      continue;
    }

    if (decision.destino === 'casado') {
      const ok = await ligar(cfg.tenantId, decision.gastoId, uuid);
      if (ok) {
        fondo.delete(decision.gastoId);
        await saveCfdiXmlRaw(cfg.tenantId, uuid, decision.gastoId, xml);
        await marcar(cfg.tenantId, uuid, 'casado', decision.gastoId, null);
        r.casados++;
      } else {
        // Perdió la carrera: alguien ya le pegó su comprobante a ese ticket.
        // Queda disponible y se dice — jamás se pisa un CFDI existente.
        await marcar(cfg.tenantId, uuid, 'disponible', null, {
          motivo: 'El gasto que le correspondía ya tenía comprobante cuando se intentó ligar (llegó por otro camino).',
        });
        r.disponibles++;
      }
      continue;
    }

    if (decision.destino === 'ambiguo') {
      await marcar(cfg.tenantId, uuid, 'ambiguo', null, { candidatos: decision.candidatos });
      r.ambiguos++;
      continue;
    }

    await saveCfdiXmlRaw(cfg.tenantId, uuid, null, xml);
    await marcar(cfg.tenantId, uuid, 'disponible', null, { motivo: decision.motivo });
    r.disponibles++;
  }
}

async function marcar(
  tenantId: string, uuid: string,
  estatus: 'casado' | 'disponible' | 'ambiguo' | 'ignorado',
  gastoId: string | null,
  candidatos: Record<string, unknown> | null,
): Promise<void> {
  const { error } = await acotada(supabaseAdmin()
    .from('sat_cfdi_descargado')
    .update({ estatus, gasto_id: gastoId, candidatos })
    .eq('tenant_id', tenantId)
    .eq('cfdi_uuid', uuid), 'sat_descarga.marcar');
  if (error) logger.warn('sat.marcar_fallo', { tenantId, err: error.message });
}

/** Empuja UN paso del ciclo para UNA flota. */
export async function correrFlota(
  cfg: ConfigFlota,
  prov: ProveedorDescargaSat,
  hoy: string,
): Promise<ResumenFlota> {
  const r = vacio(cfg.tenantId);

  // ── 1. Verificar lo que ya está en curso ────────────────────────────────
  const { data: vivas, error: errVivas } = await acotada(supabaseAdmin()
    .from('sat_descarga_solicitud')
    .select('id, request_id, tipo, desde, hasta, estado, intentos')
    .eq('tenant_id', cfg.tenantId)
    .in('estado', ['solicitada', 'en_proceso', 'lista'])
    .order('solicitada_en', { ascending: true })
    .limit(MAX_VERIFICAR), 'sat_descarga.vivas');
  if (errVivas) throw new Error(`correrFlota.vivas: ${errVivas.message}`);

  let paquetesBajados = 0;
  for (const s of vivas ?? []) {
    const requestId = s.request_id as string | null;
    if (requestId === null) continue; // intento sin trámite: no hay qué verificar
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
    let todoBien = true;
    for (const p of v.paquetes) {
      if (paquetesBajados >= MAX_PAQUETES) { todoBien = false; break; }
      paquetesBajados++;
      const d = await prov.descargar(p);
      if (!d.ok) {
        r.errores.push(`Paquete de ${requestId}: ${d.mensaje}`);
        todoBien = false;
        continue;
      }
      await ingerir(cfg, s.id as string, d.xmls, rango, r);
    }

    if (todoBien) {
      r.descargadas++;
      await acotada(supabaseAdmin().from('sat_descarga_solicitud')
        .update({
          estado: 'descargada', descargada_en: new Date().toISOString(),
          cfdis_nuevos: r.cfdisNuevos, cfdis_repetidos: r.cfdisRepetidos,
        })
        .eq('tenant_id', cfg.tenantId).eq('id', s.id), 'sat_descarga.descargada');
      // El avance del calendario SOLO cuando el rango se bajó COMPLETO. Mover
      // `ultima_descarga_hasta` con un paquete a medias saltaría días para
      // siempre — el modo de falla silencioso que este producto no acepta.
      if (rango.hasta > (cfg.ultimaHasta ?? '')) {
        await acotada(supabaseAdmin().from('sat_descarga_config')
          .update({ ultima_descarga_hasta: rango.hasta, actualizado_en: new Date().toISOString() })
          .eq('tenant_id', cfg.tenantId), 'sat_descarga.avanzar');
        cfg.ultimaHasta = rango.hasta;
      }
    }
  }

  // ── 2. Pedir el siguiente rango, si no hay nada vivo de ese tipo ─────────
  const tipo: TipoDescarga = 'recibidos'; // el buzón que da el valor
  const hayViva = (vivas ?? []).some((s) => s.tipo === tipo
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
      if (errIns) {
        // El índice parcial `uq_sat_solicitud_viva` rebotando aquí NO es un
        // fallo: significa que otra corrida ya pidió este rango. Se dice y ya.
        logger.info('sat.rango_ya_pedido', { tenantId: cfg.tenantId, ...rango });
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
  flotas: number;
  resumenes: ResumenFlota[];
}

/** El barrido de todas las flotas con descarga encendida. */
export async function correrDescargaSat(ahora: Date = new Date()): Promise<ResumenCorrida> {
  const estado = estadoDescargaSat();
  const prov = resolverDescargaSat();
  if (prov === null) {
    // NO se simula nada y NO se devuelve un verde de mentira: se dice qué
    // falta, con las palabras que la pantalla también usa.
    return { corrio: false, motivo: estado.motivo ?? 'La descarga masiva no está configurada.', flotas: 0, resumenes: [] };
  }

  const { data: configs, error } = await acotada(supabaseAdmin()
    .from('sat_descarga_config')
    .select('tenant_id, rfc, ultima_descarga_hasta')
    .eq('activa', true)
    .limit(200), 'sat_descarga.configs');
  if (error) throw new Error(`correrDescargaSat: ${error.message}`);

  const hoy = hoyMx(ahora);
  const resumenes: ResumenFlota[] = [];
  for (const c of configs ?? []) {
    const cfg: ConfigFlota = {
      tenantId: c.tenant_id as string,
      rfc: c.rfc as string,
      ultimaHasta: (c.ultima_descarga_hasta as string) || null,
    };
    try {
      resumenes.push(await correrFlota(cfg, prov, hoy));
    } catch (e) {
      // Una flota que revienta no puede tumbar a las demás: se registra su
      // fallo como suyo y el barrido sigue.
      const r = vacio(cfg.tenantId);
      r.errores.push(e instanceof Error ? e.message : String(e));
      resumenes.push(r);
      logger.error('sat.flota_fallo', { tenantId: cfg.tenantId, err: e instanceof Error ? e.message : String(e) });
    }
  }
  return { corrio: true, flotas: resumenes.length, resumenes };
}
