import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';
import { decenasDelMes, diasEntre, mesAnterior, mesDeFecha } from './periodo';
import { fechaLocalMX } from './plazo_reclamo';
import { DIAS_GRACIA_DEFAULT } from './config_avisos';

// ═══════════════════════════════════════════════════════════════════════════
// EL RECORDATORIO DEL ARCHIVO DECENAL FALTANTE (T-A2-30). OPCIONAL, APAGADO POR OMISIÓN.
//
// Requisito del cliente: «un agente le recuerda al equipo por WhatsApp que mande o que lo suba
// directamente al software» (el equipo elige cualquiera de las dos formas).
//
// Si pasaron `diasGracia` desde el cierre de una decena (día 10, día 20 y fin de mes) y NO hay
// ningún desglose vigente cuyo periodo CUBRA esa decena completa, se manda UN solo recordatorio
// por decena al destinatario configurado. Si el archivo llega, no se avisa. Solo se evalúa la
// decena vencida más reciente: avisar de decenas viejas sería ruido, no ayuda.
//
// PURO: sin base ni red; todo lo externo entra por `DepsRecordatorio` (igual que `aviso_plazo.ts`).
// El día se toma en la zona de la flota (America/Mexico_City). Nunca lanza.
//
// BLOQUEO EXTERNO: el canal y el destinatario no los ha decidido el cliente. Por eso el interruptor
// nace apagado y sin destinatario NO envía. El texto es una señal, no una acusación.
// ═══════════════════════════════════════════════════════════════════════════

export interface DesgloseCobertura {
  /** Primer y último día que cubre el archivo (ISO); `null` = el archivo no declara periodo. */
  periodoDesde: string | null;
  periodoHasta: string | null;
  /** Un desglose anulado no cuenta como archivo recibido. */
  anulado?: boolean;
}

export interface ConfigRecordatorio {
  /** Interruptor `recordatorio_archivo` de la flota. */
  activo: boolean;
  diasGracia: number;
}

export interface DepsRecordatorio {
  /** Reserva el recordatorio (flota, decena). `false` si ya estaba reservado/enviado. */
  reservar: (tenantId: string, decena: string) => Promise<boolean>;
  /** Devuelve la reserva cuando el envío falló, para reintentar en el siguiente barrido. */
  liberar: (tenantId: string, decena: string) => Promise<void>;
  /** Destinatario configurado; `null`/vacío = no se envía. */
  telefono: (tenantId: string) => Promise<string | null>;
  enviar: (telefono: string, texto: string) => Promise<boolean>;
  /** Liga de la pantalla de peajes. */
  liga: () => string;
}

export type EstadoRecordatorio =
  | 'apagado' | 'sin_decena' | 'cubierta' | 'ya_recordado' | 'sin_destinatario' | 'enviado' | 'fallido';

export interface ResultadoRecordatorio {
  estado: EstadoRecordatorio;
  /** La decena evaluada («2026-09-21/2026-09-30»), si hubo una vencida. */
  decena?: string;
}

export interface DecenaVencida { desde: string; hasta: string; etiqueta: string }

/** Clave estable de una decena: la que usa la reserva para no avisar dos veces. */
export const claveDecena = (d: { desde: string; hasta: string }): string => `${d.desde}/${d.hasta}`;

/**
 * La decena MÁS RECIENTE cuyo cierre ya quedó `diasGracia` días atrás (o más) a `hoy`.
 * Decenas: 1–10, 11–20, 21–fin de mes (28/29/30/31). `null` si ninguna de este mes ni del anterior.
 */
export function decenaVencida(hoy: string | Date, diasGracia: number): DecenaVencida | null {
  const dia = fechaLocalMX(hoy);
  const mesActual = mesDeFecha(dia);
  const previo = mesAnterior(mesActual);
  const candidatas = [...(previo ? decenasDelMes(previo) : []), ...decenasDelMes(mesActual)];
  let elegida: DecenaVencida | null = null;
  for (const d of candidatas) {
    if (diasEntre(d.hasta, dia) >= diasGracia) elegida = d;
  }
  return elegida;
}

/** ¿Algún desglose vigente cubre la decena completa? */
export function decenaCubierta(d: { desde: string; hasta: string }, desgloses: readonly DesgloseCobertura[]): boolean {
  return desgloses.some((x) => !x.anulado && !!x.periodoDesde && !!x.periodoHasta && x.periodoDesde <= d.desde && x.periodoHasta >= d.hasta);
}

/** El texto del recordatorio (puro, para probarlo). */
export function textoRecordatorioArchivo(d: DecenaVencida, liga: string): string {
  const [, mm] = d.desde.split('-');
  return `📎 Peajes: todavía no recibimos el archivo de cobros del ${d.etiqueta.replace(' a ', ' al ')} (${d.desde} a ${d.hasta}, mes ${mm}). `
    + `Mándalo por correo o súbelo directamente aquí, como te quede más fácil: ${liga}. `
    + `Es un recordatorio; si ya lo enviaste, ignóralo.`;
}

/**
 * Evalúa UNA flota y, si corresponde, manda el recordatorio de la decena vencida más reciente.
 * Apagado por omisión (`config.activo` falso no consulta ni envía nada). Nunca lanza.
 */
export async function recordarArchivoDecenal(
  tenantId: string,
  hoy: string | Date,
  desgloses: readonly DesgloseCobertura[],
  config: ConfigRecordatorio,
  deps: DepsRecordatorio,
): Promise<ResultadoRecordatorio> {
  if (config.activo !== true) return { estado: 'apagado' };
  let decena: DecenaVencida | null;
  try {
    const g = Number.isInteger(config.diasGracia) && config.diasGracia >= 0 ? config.diasGracia : DIAS_GRACIA_DEFAULT;
    decena = decenaVencida(hoy, g);
  } catch (e) {
    logger.error('cron.peajes.recordatorio_fallo', { tenant: tenantId, paso: 'fecha', codigo: codigoDeError(e) });
    return { estado: 'fallido' };
  }
  if (!decena) return { estado: 'sin_decena' };
  const clave = claveDecena(decena);
  if (decenaCubierta(decena, desgloses)) return { estado: 'cubierta', decena: clave };

  let reservado = false;
  try {
    const tel = (await deps.telefono(tenantId))?.trim();
    if (!tel) return { estado: 'sin_destinatario', decena: clave };
    reservado = await deps.reservar(tenantId, clave);
    if (!reservado) return { estado: 'ya_recordado', decena: clave };
    const ok = await deps.enviar(tel, textoRecordatorioArchivo(decena, deps.liga()));
    if (ok) return { estado: 'enviado', decena: clave };
    await deps.liberar(tenantId, clave);
    return { estado: 'fallido', decena: clave };
  } catch (e) {
    logger.error('cron.peajes.recordatorio_fallo', { tenant: tenantId, paso: 'envio', codigo: codigoDeError(e) });
    if (reservado) { try { await deps.liberar(tenantId, clave); } catch { /* el siguiente barrido lo recupera */ } }
    return { estado: 'fallido', decena: clave };
  }
}
