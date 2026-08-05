// ═══════════════════════════════════════════════════════════════════════════
// EL JOIN DEL CFDI CONSOLIDADO — auditoría 10, hallazgo CRÍTICO fiscal.
//
// Diésel por monedero y peaje por TAG son ~54% del gasto real de una flota
// (INEGI EAT 2024) y NUNCA generan un ticket por transacción: llegan como UN
// CFDI que ampara muchos días de consumo. `cfdi_xml.ts` ya sabe extraer esas
// líneas (`CfdiLineaXml[]`, ver ese archivo). Este módulo hace lo que falta:
// decidir a qué `gasto` ya capturado pertenece cada línea, o admitir que no
// se sabe y dejarlo para un humano.
//
// ── EL CANAL: WHATSAPP, NO UNO NUEVO ─────────────────────────────────────
//
// El operador YA manda el XML del CFDI por WhatsApp (`processor.ts`, camino
// de `document`) y la oficina/contador YA tiene un número reconocido
// (`contactos.ts:resolverCuentaOficina`). Construir un buzón de correo nuevo
// (`facturas-<tenant>@likida.ai`, decidido el 29-jul y nunca hecho) habría
// significado IMAP, un dominio de correo entrante y una superficie de ataque
// nueva — para resolver un problema que el canal existente ya resuelve al
// 90%: SUBIR un archivo. Lo único que faltaba era reconocer que un XML con
// más de una línea NO es un ticket 1:1 y darle un camino distinto. Ese es el
// alcance real de esta ronda; el buzón de correo sigue sin construirse y
// sigue siendo una opción legítima para cuando WhatsApp no alcance (p. ej. si
// el emisor manda el XML solo por correo y nadie en la flota lo reenvía).
//
// ── LA REGLA DURA, LA MISMA DE `emparejar.ts` ────────────────────────────
//
// "Ante la duda no se adivina." Una línea con más de un candidato razonable,
// o con cero, NO se liga a nada — se queda en `cfdi_consolidado_linea` con
// `estatus = 'por_conciliar'` para que un contador la resuelva viendo el
// mismo CFDI que va a defender ante el SAT. Colgarle a una línea el gasto
// equivocado es peor que dejarla suelta: mueve litros/IVA/IEPS de un viaje a
// otro sin que nadie lo note hasta el cuadre.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { logger } from '@/lib/logger';
import type { Gasto } from '@/types/cuadra';
import type { CfdiLineaXml, CfdiXmlData } from './cfdi_xml';

/**
 * Tolerancia de monto: rondeos entre lo que el ticket fotografiado (u OCR)
 * capturó y lo que el emisor del monedero/TAG declara en su propio estado de
 * cuenta. NO es margen para una cifra distinta — una diferencia de $10 o más
 * es otra transacción (o un error de OCR que se corrige por su propio
 * camino), no algo que este módulo deba perdonar en silencio.
 */
export const TOLERANCIA_MONTO_MXN = 1;

/**
 * Ventana de fecha: ±1 día alrededor de la fecha real de la línea. Cubre
 * compras cerca de medianoche y el rezago normal entre "el chofer cargó" y
 * "la oficina capturó el ticket" — NO una ventana ancha: entre más días se
 * acepten, más probable que dos comprobantes distintos del mismo monto caigan
 * dentro y la línea se vuelva ambigua por diseño de este mismo código.
 */
export const VENTANA_DIAS_FECHA = 1;

function diasDeDiferencia(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Infinity;
  return Math.abs(ta - tb) / 86_400_000;
}

function sumarDias(fechaIso: string, delta: number): string {
  const d = new Date(`${fechaIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** El rango [desde, hasta] que cubre TODAS las líneas con fecha, con la
 *  ventana ya aplicada — o `null` si NINGUNA línea trae fecha (consolidado
 *  tipo TAG sin ECC12: ver `cfdi_xml.ts`). Sin rango no se trae ni un
 *  candidato: filtrar por monto solo, contra el historial entero de la
 *  flota, es justo lo que este módulo existe para no hacer. */
export function rangoFechasLineas(lineas: CfdiLineaXml[]): { desde: string; hasta: string } | null {
  const fechas = lineas.map((l) => l.fecha?.slice(0, 10)).filter((f): f is string => !!f);
  if (fechas.length === 0) return null;
  const ordenadas = [...fechas].sort();
  return {
    desde: sumarDias(ordenadas[0], -VENTANA_DIAS_FECHA),
    hasta: sumarDias(ordenadas[ordenadas.length - 1], VENTANA_DIAS_FECHA),
  };
}

export type EstatusLineaConsolidado = 'conciliada' | 'por_conciliar';

export interface CandidatoConciliacion { gastoId: string; monto: number; fecha: string | null }

export interface ResultadoLinea {
  linea: CfdiLineaXml;
  estatus: EstatusLineaConsolidado;
  gastoId: string | null;
  /** Solo cuando `estatus === 'por_conciliar'`: por qué no fue automático —
   *  vacío (0 candidatos) o varios (ambiguo). Se guarda para que un humano no
   *  tenga que volver a correr el matcher a mano. */
  candidatos: CandidatoConciliacion[];
}

/**
 * El JOIN. Puro: no toca la base, para poder probarlo sin mockear Supabase.
 *
 * Un `gasto` que ya se le asignó a una línea SALE del fondo antes de evaluar
 * la siguiente — dos líneas de un mismo consolidado no pueden reclamar el
 * mismo comprobante, y quitar al ya-asignado puede volver ÚNICO a un
 * candidato que antes era ambiguo (misma idea que `emparejarPorMonto` en
 * `emparejar.ts`).
 */
export function conciliarLineas(lineas: CfdiLineaXml[], gastosDisponibles: Gasto[]): ResultadoLinea[] {
  let disponibles = [...gastosDisponibles];
  const resultados: ResultadoLinea[] = [];

  for (const linea of lineas) {
    // Sin fecha, CERO intento de match automático. Ver el porqué en el
    // encabezado del archivo y en `cfdi_xml.ts`.
    if (!linea.fecha) {
      resultados.push({ linea, estatus: 'por_conciliar', gastoId: null, candidatos: [] });
      continue;
    }

    const dia = linea.fecha.slice(0, 10);
    const candidatos = disponibles.filter((g) =>
      g.fecha != null &&
      Math.abs(g.monto - linea.monto) <= TOLERANCIA_MONTO_MXN &&
      diasDeDiferencia(g.fecha.slice(0, 10), dia) <= VENTANA_DIAS_FECHA);

    if (candidatos.length === 1) {
      const [match] = candidatos;
      disponibles = disponibles.filter((g) => g.id !== match.id);
      resultados.push({ linea, estatus: 'conciliada', gastoId: match.id, candidatos: [] });
    } else {
      resultados.push({
        linea,
        estatus: 'por_conciliar',
        gastoId: null,
        candidatos: candidatos.map((g) => ({ gastoId: g.id, monto: g.monto, fecha: g.fecha ?? null })),
      });
    }
  }
  return resultados;
}

export interface ResumenConciliacion {
  cfdiXmlId: string;
  totalLineas: number;
  conciliadas: number;
  porConciliar: number;
}

/**
 * Guarda el CFDI consolidado, corre el JOIN contra el `gasto` del tenant y
 * deja rastro de las dos cosas: lo que ligó solo y lo que le tocó a un
 * humano. Idempotente por `(tenant_id, cfdi_uuid)` / `(cfdi_xml_id, indice)`:
 * reenviar el mismo XML dos veces (WhatsApp reintenta) no duplica nada.
 *
 * NO toca `monto`/`fecha` del gasto que concilia: ya coincidían —fue la
 * llave del match— y tocarlos aquí solo abriría la puerta a mover dinero por
 * un bug de este archivo. Solo se escribe `cfdi_uuid` + `cfdi_orden`
 * (migración 0065 — el mismo mecanismo que ya usa CAPUFE para "N gastos, un
 * solo CFDI").
 */
export async function guardarYConciliarConsolidado(
  tenantId: string,
  xml: CfdiXmlData,
  xmlText: string,
): Promise<ResumenConciliacion> {
  if (!xml.uuid) throw new Error('guardarYConciliarConsolidado: el CFDI no trae UUID');

  const { data: filaXml, error: errXml } = await acotada(supabaseAdmin()
    .from('cfdi_xml')
    .upsert(
      {
        tenant_id: tenantId,
        cfdi_uuid: xml.uuid,
        gasto_id: null, // un consolidado no es 1:1 con un solo gasto
        xml: xmlText,
        tiene_multiples_conceptos: true,
        total_conceptos: xml.lineas.length,
      },
      { onConflict: 'tenant_id,cfdi_uuid' },
    )
    .select('id')
    .single(), 'consolidado.guardar_cfdi_xml');
  if (errXml || !filaXml) {
    throw new Error(`guardarYConciliarConsolidado: ${errXml?.message ?? 'sin id de cfdi_xml'}`);
  }
  const cfdiXmlId = filaXml.id as string;

  // ── IDEMPOTENCIA REAL, no solo del upsert de arriba ──────────────────────
  // Si este CFDI YA se conció una vez (reenvío del mismo archivo — humano o
  // reintento), las líneas ya están escritas. NO se vuelve a correr el JOIN:
  // un `gasto` que la primera pasada ya ligó sale de `candidatosDb` (su
  // `cfdi_uuid` deja de ser null), así que una segunda pasada lo vería como
  // "no disponible" y reportaría esa línea como huérfana — un reenvío
  // legítimo desligaría en apariencia lo que ya estaba bien ligado.
  const { data: existentes, error: errExistentes } = await acotada(supabaseAdmin()
    .from('cfdi_consolidado_linea')
    .select('estatus')
    .eq('cfdi_xml_id', cfdiXmlId), 'consolidado.lineas_existentes');
  if (!errExistentes && existentes && existentes.length > 0) {
    const conciliadasYa = existentes.filter((f) => f.estatus === 'conciliada').length;
    return { cfdiXmlId, totalLineas: existentes.length, conciliadas: conciliadasYa, porConciliar: existentes.length - conciliadasYa };
  }

  const rango = rangoFechasLineas(xml.lineas);
  let candidatosDb: Gasto[] = [];
  if (rango) {
    const { data, error } = await acotada(supabaseAdmin()
      .from('gasto')
      .select('id, concepto, monto, fecha')
      .eq('tenant_id', tenantId)
      .is('cfdi_uuid', null)
      .gte('fecha', rango.desde)
      .lte('fecha', rango.hasta), 'consolidado.candidatos_gasto');
    if (error) throw new Error(`guardarYConciliarConsolidado: ${error.message}`);
    candidatosDb = (data ?? []).map((g) => ({
      id: g.id as string,
      concepto: g.concepto as Gasto['concepto'],
      monto: Number(g.monto),
      fecha: (g.fecha as string | null) ?? undefined,
    }));
  }

  const resultados = conciliarLineas(xml.lineas, candidatosDb);

  for (const r of resultados) {
    if (r.estatus !== 'conciliada' || !r.gastoId) continue;
    const { error } = await acotada(supabaseAdmin()
      .from('gasto')
      .update({ cfdi_uuid: xml.uuid, cfdi_orden: r.linea.indice })
      .eq('id', r.gastoId)
      .eq('tenant_id', tenantId), 'consolidado.marcar_gasto');
    // Best-effort por línea: que UNA falle no debe perder el resto del
    // consolidado ni la fila de auditoría que se escribe abajo.
    if (error) logger.error('consolidado.marcar_gasto_error', { tenant: tenantId, gasto: r.gastoId, err: error.message });
  }

  const filasLinea = resultados.map((r) => ({
    tenant_id: tenantId,
    cfdi_xml_id: cfdiXmlId,
    indice: r.linea.indice,
    fuente: r.linea.fuente,
    fecha: r.linea.fecha ? r.linea.fecha.slice(0, 10) : null,
    monto: r.linea.monto,
    descripcion: r.linea.descripcion ?? null,
    estacion_rfc: r.linea.estacionRfc ?? null,
    estacion_clave: r.linea.estacionClave ?? null,
    folio_operacion: r.linea.folioOperacion ?? null,
    estatus: r.estatus,
    gasto_id: r.gastoId,
    candidatos: r.candidatos.length ? r.candidatos : null,
  }));
  const { error: errLineas } = await acotada(supabaseAdmin()
    .from('cfdi_consolidado_linea')
    .upsert(filasLinea, { onConflict: 'cfdi_xml_id,indice' }), 'consolidado.guardar_lineas');
  if (errLineas) {
    logger.error('consolidado.guardar_lineas_error', { tenant: tenantId, cfdiXmlId, err: errLineas.message });
  }

  const conciliadas = resultados.filter((r) => r.estatus === 'conciliada').length;
  return { cfdiXmlId, totalLineas: resultados.length, conciliadas, porConciliar: resultados.length - conciliadas };
}

/**
 * El acuse por WhatsApp. Dice la verdad de las tres formas en que puede salir
 * — nunca "listo" cuando quedó pendiente, ni "revísalo" cuando ya no hace
 * falta: un contador que lee "0 pendientes" dos veces deja de abrir el panel.
 */
export function mensajeConsolidadoRecibido(r: ResumenConciliacion): string {
  const n = r.totalLineas === 1 ? '1 movimiento' : `${r.totalLineas} movimientos`;
  if (r.porConciliar === 0) {
    return `Recibí tu XML consolidado (${n}) y ya quedó ligado ✅. Los ${r.totalLineas} coincidieron uno a uno contra tickets que ya tenías cargados.`;
  }
  if (r.conciliadas === 0) {
    return `Recibí tu XML consolidado con ${n} 📄. Ninguno lo pude ligar solo contra un ticket ya cargado — quedaron en el panel, en *Combustible & Casetas*, para que tu contador los revise a mano.`;
  }
  return `Recibí tu XML consolidado (${n}) ✅. *${r.conciliadas}* ya quedaron ligados a su ticket; *${r.porConciliar}* necesitan revisión — están en el panel, en *Combustible & Casetas*.`;
}
