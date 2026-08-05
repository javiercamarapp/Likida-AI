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
 * Escribe `cfdi_uuid` + `cfdi_orden` en el `gasto` que gana el match — el
 * ÚNICO lugar que decide qué significa "ligar" una línea del consolidado a
 * un gasto. Lo usan los dos caminos: el JOIN automático de
 * `guardarYConciliarConsolidado` y la resolución a mano de
 * `resolverLineaAMano`. Dos copias de este `update` habrían sido dos
 * oportunidades de que una se quedara sin el guardia `.is('cfdi_uuid', null)`
 * y ligara el mismo comprobante dos veces.
 *
 * El guardia existe porque entre "se calculó el candidato" y "se escribe" hay
 * una ventana: en el camino automático son milisegundos (mismo request); en
 * el manual pueden ser MINUTOS —lo que tarda un contador en mirar la pantalla
 * y hacer clic—, tiempo de sobra para que otra línea, u otro humano resolviendo
 * en paralelo, ya se haya llevado ese mismo gasto. Devuelve `false`, no lanza:
 * el llamador decide qué hacer con eso (best-effort en el automático, un error
 * explícito para el humano en el manual).
 */
async function ligarLineaAGasto(tenantId: string, cfdiUuid: string, orden: number, gastoId: string): Promise<boolean> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('gasto')
    .update({ cfdi_uuid: cfdiUuid, cfdi_orden: orden })
    .eq('id', gastoId)
    .eq('tenant_id', tenantId)
    .is('cfdi_uuid', null)
    .select('id'), 'consolidado.ligar_gasto');
  if (error) {
    logger.error('consolidado.ligar_gasto_error', { tenant: tenantId, gasto: gastoId, err: error.message });
    return false;
  }
  return (data?.length ?? 0) > 0;
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
    // Best-effort por línea: que UNA falle no debe perder el resto del
    // consolidado ni la fila de auditoría que se escribe abajo. `ligarLineaAGasto`
    // ya loguea su propio error; un `false` sin error (el guardia negó la fila)
    // también se registra aquí porque ese caso, en el camino automático, no
    // debería ocurrir nunca —el candidato salió de una lectura con
    // `.is('cfdi_uuid', null)` milisegundos antes— y si ocurre es señal de una
    // carrera real que vale la pena ver en el log.
    const ligado = await ligarLineaAGasto(tenantId, xml.uuid, r.linea.indice, r.gastoId);
    if (!ligado) logger.error('consolidado.marcar_gasto_no_disponible', { tenant: tenantId, gasto: r.gastoId });
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

// ═══════════════════════════════════════════════════════════════════════════
// LA RESOLUCIÓN A MANO — el otro lado del hallazgo CRÍTICO de auditoría 10.
//
// `guardarYConciliarConsolidado` deja las líneas ambiguas o sin candidato en
// `cfdi_consolidado_linea` con `estatus = 'por_conciliar'` y sus candidatos
// en JSON — pero hasta esta ronda no había ninguna función (ni pantalla) que
// pudiera CERRAR esa línea. Un contador que abría el panel de Combustible &
// Casetas veía "3 por revisar" y no tenía dónde revisarlas: quedaban ahí para
// siempre, un contador que no lee árabe leyendo un número que nunca baja.
// ═══════════════════════════════════════════════════════════════════════════

export type ResolucionLineaManual =
  | { tipo: 'ligar'; gastoId: string }
  | { tipo: 'sin_match' };

export interface ResultadoResolverLinea {
  ok: boolean;
  /** Presente solo cuando `ok === false` — por qué no se pudo cerrar. */
  motivo?: 'linea_no_encontrada' | 'ya_resuelta' | 'candidato_no_ofrecido' | 'gasto_ya_no_disponible' | 'error_bd';
}

/**
 * La resolución A MANO de una línea que el JOIN automático no pudo ligar
 * sola. Un contador ve LOS MISMOS candidatos que calculó `conciliarLineas`
 * (columna `candidatos`, JSON — no se vuelve a correr el matcher) y elige
 * uno —liga la línea al gasto, con EXACTAMENTE el mismo mecanismo que el
 * camino automático (`ligarLineaAGasto`, no una copia)— o declara que
 * ninguno corresponde (`estatus = 'sin_match'`, migración 0077), lo que la
 * saca de la cola sin inventarle un gasto que no tiene.
 *
 * SOLO SE PUEDE ELEGIR UN CANDIDATO QUE EL JOIN AUTOMÁTICO YA OFRECIÓ (la
 * propia columna `candidatos` de la línea): esta función no es un buscador
 * libre de gastos. Es una decisión de diseño, no un descuido — un buscador
 * libre necesitaría su propia UI de búsqueda y su propia superficie de
 * error, y el caso real (0, 2 o 3 candidatos por ambigüedad de fecha/monto)
 * no lo pide. Si el gasto correcto NUNCA apareció como candidato —porque
 * cayó fuera de la ventana de fecha del JOIN (`VENTANA_DIAS_FECHA`)— hoy no
 * hay forma de ligarlo desde este panel; se documenta como límite conocido
 * en `docs/auditoria-10/fiscal.md`, no se resuelve aquí.
 *
 * Vuelve a comprobar `estatus === 'por_conciliar'` antes de escribir, con el
 * mismo `estatus = 'por_conciliar'` repetido en el `WHERE` del UPDATE: dos
 * personas mirando el mismo panel al mismo tiempo (o un humano resolviendo
 * mientras un reenvío de WhatsApp corre el JOIN automático otra vez) no
 * pueden cerrar la misma línea dos veces — la segunda escritura no encuentra
 * fila que actualizar y vuelve `ya_resuelta`, no un éxito silencioso que
 * pisa al primero.
 */
export async function resolverLineaAMano(
  tenantId: string,
  lineaId: string,
  resolucion: ResolucionLineaManual,
  resueltoPor: string,
): Promise<ResultadoResolverLinea> {
  const { data: fila, error: errFila } = await acotada(supabaseAdmin()
    .from('cfdi_consolidado_linea')
    .select('id, cfdi_xml_id, indice, estatus, candidatos')
    .eq('id', lineaId)
    .eq('tenant_id', tenantId)
    .maybeSingle(), 'consolidado.leer_linea');
  if (errFila) return { ok: false, motivo: 'error_bd' };
  if (!fila) return { ok: false, motivo: 'linea_no_encontrada' };
  if (fila.estatus !== 'por_conciliar') return { ok: false, motivo: 'ya_resuelta' };

  if (resolucion.tipo === 'sin_match') {
    const { data, error } = await acotada(supabaseAdmin()
      .from('cfdi_consolidado_linea')
      .update({ estatus: 'sin_match', resuelto_por: resueltoPor, resuelto_en: new Date().toISOString() })
      .eq('id', lineaId).eq('tenant_id', tenantId).eq('estatus', 'por_conciliar')
      .select('id'), 'consolidado.marcar_sin_match');
    if (error) return { ok: false, motivo: 'error_bd' };
    if (!data || data.length === 0) return { ok: false, motivo: 'ya_resuelta' };
    return { ok: true };
  }

  // tipo === 'ligar' — el candidato tiene que ser uno de los que ya se ofrecieron.
  const candidatos = (fila.candidatos as CandidatoConciliacion[] | null) ?? [];
  const elegido = candidatos.find((c) => c.gastoId === resolucion.gastoId);
  if (!elegido) return { ok: false, motivo: 'candidato_no_ofrecido' };

  const { data: filaXml, error: errXml } = await acotada(supabaseAdmin()
    .from('cfdi_xml')
    .select('cfdi_uuid')
    .eq('id', fila.cfdi_xml_id as string)
    .eq('tenant_id', tenantId)
    .maybeSingle(), 'consolidado.leer_cfdi_xml');
  if (errXml || !filaXml?.cfdi_uuid) return { ok: false, motivo: 'error_bd' };

  const ligado = await ligarLineaAGasto(tenantId, filaXml.cfdi_uuid as string, fila.indice as number, resolucion.gastoId);
  if (!ligado) return { ok: false, motivo: 'gasto_ya_no_disponible' };

  const { data: actualizado, error: errUpdate } = await acotada(supabaseAdmin()
    .from('cfdi_consolidado_linea')
    .update({ estatus: 'conciliada', gasto_id: resolucion.gastoId, resuelto_por: resueltoPor, resuelto_en: new Date().toISOString() })
    .eq('id', lineaId).eq('tenant_id', tenantId).eq('estatus', 'por_conciliar')
    .select('id'), 'consolidado.marcar_conciliada_a_mano');
  if (errUpdate) {
    // El gasto YA quedó ligado (paso anterior) pero la línea no se pudo
    // marcar — inconsistencia rara (carrera) que se deja en el log en vez de
    // deshacer el `update` del gasto: revertirlo sin saber por qué falló el
    // segundo `update` podría desligar un gasto que otra línea ya reclamó
    // mientras tanto. Se documenta, no se adivina.
    logger.error('consolidado.marcar_conciliada_a_mano_error', { tenant: tenantId, linea: lineaId, gasto: resolucion.gastoId, err: errUpdate.message });
    return { ok: false, motivo: 'error_bd' };
  }
  if (!actualizado || actualizado.length === 0) {
    logger.error('consolidado.marcar_conciliada_a_mano_carrera', { tenant: tenantId, linea: lineaId, gasto: resolucion.gastoId });
    return { ok: false, motivo: 'ya_resuelta' };
  }
  return { ok: true };
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
