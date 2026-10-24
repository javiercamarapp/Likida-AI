import { TZ_MX } from '@/lib/formato';
import type { CandidatoCobro } from './reglas_cobro';
import type { HallazgoAtipico } from './atipicos';
import { normalizarTelefonoAviso } from './aviso_atipicos';

// ═══════════════════════════════════════════════════════════════════════════
// EL REPORTE DE «DISCREPANCIA GEOGRÁFICA» (T-A2-37). PURO: sin base, sin red, no envía nada.
//
// Cuando un cruce de TAG no cuadra con lo que se sabe de la unidad (la unidad estaba inmovilizada,
// o los cruces son imposibles en el tiempo), el cliente pidió un protocolo: qué pasó, con qué
// evidencia, y qué hacer (bloquear el TAG, avisar a seguridad). Esta pieza arma ese reporte sobre
// un candidato CRÍTICO (T-A2-36) o ATÍPICO (T-A2-11). Documento: docs/operacion/peajes-discrepancia.md.
//
// DOCTRINA. Es un candidato a validar, jamás una acusación: ni a una persona ni al proveedor. Basta
// teclear el número del TAG en la caseta, así que el cruce puede no haberlo hecho la unidad; también
// puede ser un error del proveedor o una fecha mal capturada. El reporte lo dice.
//
// EL DESTINATARIO NO SE ADIVINA. Sale de la configuración del aviso de atípicos (T-A2-14,
// `umbrales.aviso.telefono`). Sin destinatario configurado NO se envía y el reporte lo dice
// (`enviar: false` + `motivoNoEnvio`): ni al dueño ni al contador «por lo menos». El protocolo
// actual del cliente (a quién avisar, plazos) sigue siendo BLOQUEO EXTERNO: lo único que se
// recomienda aquí es la acción, la decide una persona.
//
// STAND-BY: el bloqueo automático del TAG NO se hace; el reporte solo recomienda pedirlo al proveedor.
// Sin posición GPS conocida no se afirma nada sobre dónde estaba la unidad: se dice que falta.
// ═══════════════════════════════════════════════════════════════════════════

export type OrigenDiscrepancia = 'unidad_inmovilizada' | 'atipico';

/** Última posición conocida de la unidad (de `posicion`); `t` en ms UTC. */
export interface PosicionConocida { lat: number; lng: number; t: number }

export interface DiscrepanciaEntrada {
  origen: OrigenDiscrepancia;
  unidad: string | null;
  tag: string | null;
  /** Casetas involucradas (una o varias). */
  casetas: readonly string[];
  /** Instante del cruce (o del primero), reloj de México en texto «AAAA-MM-DD HH:MM», o solo fecha. */
  cuando: string | null;
  /** Texto llano del detector: qué pasó. */
  quePaso: string;
  /** Referencia corta (p. ej. «taller del … al …» o la regla). */
  referencia: string;
}

export interface ReporteDiscrepancia {
  /** `true` solo si hay destinatario configurado y válido. Este módulo no envía: lo hace el flujo de aviso. */
  enviar: boolean;
  /** Teléfono (solo dígitos) o `null`. */
  destinatario: string | null;
  /** Si `enviar` es false, por qué (llano). */
  motivoNoEnvio: string | null;
  quePaso: string;
  evidencia: string[];
  queHacer: string[];
  /** Mensaje listo para mostrar o enviar. Sin acusaciones. */
  texto: string;
}

const fmtHora = new Intl.DateTimeFormat('es-MX', {
  timeZone: TZ_MX, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

/** «AAAA-MM-DD HH:MM» en reloj de México. */
function textoInstante(ms: number): string {
  const p: Record<string, string> = {};
  for (const x of fmtHora.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

const coordValida = (p: PosicionConocida): boolean =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && Number.isFinite(p.t);

/** Adapta un candidato crítico de la revisión de cobros. `null` si no es crítico de unidad inmovilizada. */
export function discrepanciaDeCandidato(c: CandidatoCobro): DiscrepanciaEntrada | null {
  if (c.categoria !== 'unidad_inmovilizada' || c.severidad !== 'critica') return null;
  return {
    origen: 'unidad_inmovilizada', unidad: c.unidad, tag: c.tag, casetas: c.caseta ? [c.caseta] : [],
    cuando: c.fecha ? `${c.fecha}${c.hora ? ` ${c.hora.slice(0, 5)}` : ''}` : null, quePaso: c.quePaso, referencia: c.referencia,
  };
}

/** Adapta un hallazgo atípico del detector. */
export function discrepanciaDeAtipico(h: HallazgoAtipico, tag: string | null = null): DiscrepanciaEntrada {
  return {
    origen: 'atipico', unidad: h.unidad || null, tag, casetas: h.casetas,
    cuando: h.desdeLocal === h.hastaLocal ? h.desdeLocal : `${h.desdeLocal} a ${h.hastaLocal}`,
    quePaso: h.quePaso, referencia: h.regla,
  };
}

/**
 * Arma el reporte. `ultimaPosicion` = última posición GPS conocida de la unidad (o `null`);
 * `telefonoDestino` = el configurado en T-A2-14 (o `null`/inválido = no se envía).
 */
/** A37-A2-23: el TAG completo basta para teclearlo en una caseta; el texto solo lleva sus últimos 4 caracteres. */
export function enmascararTag(tag: string): string {
  const t = tag.trim();
  return t.length <= 4 ? '****' : `…${t.slice(-4)}`;
}

export function armarReporteDiscrepancia(
  d: DiscrepanciaEntrada, ultimaPosicion: PosicionConocida | null, telefonoDestino: string | null,
): ReporteDiscrepancia {
  const destinatario = normalizarTelefonoAviso(telefonoDestino);
  const motivoNoEnvio = destinatario ? null
    : 'No hay destinatario configurado para este aviso: no se envió a nadie. Captura el teléfono en la configuración de avisos de atípicos.';

  const unidad = d.unidad ? `la unidad ${d.unidad}` : 'una unidad de la flota';
  const casetas = d.casetas.length > 0 ? d.casetas.join(', ') : 'caseta sin identificar';

  const evidencia: string[] = [
    `Unidad: ${d.unidad ?? 'sin identificar'}`,
    `TAG: ${d.tag ? enmascararTag(d.tag) : 'no viene en el archivo'}`,
    `Caseta: ${casetas}`,
    `Hora del cruce: ${d.cuando ?? 'sin fecha legible'} (hora de México)`,
    `Motivo del reporte: ${d.referencia}`,
  ];
  if (ultimaPosicion && coordValida(ultimaPosicion)) {
    evidencia.push(`Última posición conocida de la unidad (aproximada, ~1 km): ${ultimaPosicion.lat.toFixed(2)}, ${ultimaPosicion.lng.toFixed(2)} a las ${textoInstante(ultimaPosicion.t)} (hora de México)`);
  } else {
    evidencia.push('Última posición conocida de la unidad: sin posición GPS disponible; no se puede decir dónde estaba.');
  }

  const queHacer = [
    'Confirma con la operación que los datos de la unidad y las fechas son correctos.',
    'Avisa a seguridad para que revise el caso y, si lo confirma, valide con el proveedor quién pasó por la caseta.',
    'Si se confirma el uso indebido del número, pide al proveedor dar de baja el TAG (el sistema no lo bloquea solo).',
    'Si los datos estaban mal, corrígelos; si fue una salida de servicio, justifícala.',
  ];

  // El «qué pasó» que armó el detector puede citar el TAG completo: se enmascara también ahí.
  const quePasoSinTag = d.tag && d.tag.trim().length > 0 ? d.quePaso.split(d.tag.trim()).join(enmascararTag(d.tag)) : d.quePaso;
  const quePaso = `${quePasoSinTag} Es un cruce que no cuadra con lo que se sabe de ${unidad}.`;
  const texto = [
    `⚠️ Peajes: discrepancia por revisar en ${unidad}.`,
    `Qué pasó: ${quePaso}`,
    `Evidencia: ${evidencia.join('; ')}.`,
    `Qué hacer: ${queHacer.join(' ')}`,
    'Es una señal para revisar, no afirma que alguien haya hecho algo indebido: el número del TAG puede teclearse en la caseta, y también puede ser un error del proveedor o de captura.',
  ].join('\n');

  return { enviar: destinatario !== null, destinatario, motivoNoEnvio, quePaso, evidencia, queHacer, texto };
}
