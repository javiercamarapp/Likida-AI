import type { GrupoPorVencer, CandidatoPlazo, OpcionesPlazo } from './plazo_reclamo';
import { clasificarPlazos, estadoPlazo, fechaLocalMX } from './plazo_reclamo';
import { logger } from '@/lib/logger';
import { codigoDeError } from '@/lib/observability/sentry';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO DE «ESTÁ POR VENCER EL PLAZO DE RECLAMO».
//
// Avisa a quien ve DINERO de los cobros sin reclamar a punto de perder su plazo
// de 3 meses, agrupados por desglose y por umbral (30 y 7 días), con cuántos son y
// cuánto suman. El texto es una señal para actuar, no una acusación: la regla de los
// 3 meses la dijo el cliente de palabra y aún no está confirmada por escrito por el
// proveedor, y el aviso lo dice.
//
// IDEMPOTENTE por (desglose, umbral): cada aviso se RESERVA antes de enviarse
// (`reservar` es un compare-and-set: dos procesos no mandan dos avisos); si el envío
// falla, la reserva se libera para que el siguiente barrido lo reintente. Un
// candidato ya reclamado no entra a ningún grupo. NO cambia el estado de ningún reclamo.
//
// Sin acceso a base ni red aquí: todo entra por `DepsAvisoPlazo`. La implementación
// real (tabla de avisos enviados, lectura de candidatos) es la pieza que falta cablear
// en el cron: ver `_construccion/T-A2-16.md`.
// ═══════════════════════════════════════════════════════════════════════════

/** Opciones de `avisarPlazosReclamo`: las del plazo más si la evaluación de los archivos de la flota fue COMPLETA (H759-6). */
export interface OpcionesAvisoPlazo extends OpcionesPlazo {
  /** `false` = esta corrida no alcanzó a evaluar todos los archivos de la ventana: sus cifras de «vencidos» son parciales y NO se avisan. Por omisión, `true`. */
  evaluacionCompleta?: boolean;
}

export interface DepsAvisoPlazo {
  /**
   * Reserva el aviso (desglose, umbral, grupo). `grupo` identifica QUÉ cobros tiene el grupo (A2P-02: el día límite más lejano):
   * un grupo al que entran cruces nuevos tiene otro `grupo` y vuelve a avisar. `false` si ya estaba reservado/enviado.
   */
  reservar: (tenantId: string, desgloseId: string, umbral: number, grupo?: string) => Promise<boolean>;
  /** Devuelve la reserva cuando el envío falló, para reintentar. */
  liberar: (tenantId: string, desgloseId: string, umbral: number, grupo?: string) => Promise<void>;
  telefono: (tenantId: string) => Promise<string | null>;
  enviar: (telefono: string, texto: string) => Promise<boolean>;
  /** Liga de la pantalla de peajes. */
  liga: () => string;
}

export interface ResumenAvisoPlazo {
  enviados: number;
  yaAvisados: number;
  sinDestinatario: number;
  fallidos: number;
  /** Cuántos cruces quedaron «ya no reclamables» (salen de «qué hacer»). */
  vencidosCruces: number;
  vencidosMonto: number;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const dinero = (n: number) => `$${n.toFixed(2)}`;

/** El texto del aviso de lo que YA se venció (puro, para probarlo). */
export function textoAvisoVencidos(v: { cruces: number; monto: number }, liga: string): string {
  return `⏰ Peajes: se vencieron ${plural(v.cruces, 'cobro', 'cobros')} (${dinero(v.monto)} en total) sin reclamar: pasó el plazo de 3 meses del proveedor y ya no se pueden reclamar `
    + `(aún sin confirmar por escrito con el proveedor). Es un resumen para que lo sepas, no afirma que el cobro fuera indebido. Revísalo: ${liga}`;
}

/** El texto del aviso (puro, para probarlo). */
export function textoAvisoPlazo(g: Pick<GrupoPorVencer, 'cruces' | 'monto' | 'diasMinimos' | 'fechaLimiteMasProxima'>, liga: string): string {
  const cuando = g.diasMinimos === 0 ? 'vence HOY' : `vence en ${plural(g.diasMinimos, 'día', 'días')}`;
  return `⏰ Peajes: ${plural(g.cruces, 'cobro sin reclamar', 'cobros sin reclamar')} (${dinero(g.monto)} en total) ${cuando} (último día: ${g.fechaLimiteMasProxima}). `
    + `Según la regla de 3 meses del proveedor, después ya no se puede reclamar (aún sin confirmar por escrito con el proveedor). `
    + `Es una señal para revisar, no afirma que el cobro sea indebido. Revísalo: ${liga}`;
}

/** Avisa los grupos por vencer de UNA flota, una vez por (desglose, umbral). Nunca lanza. */
export async function avisarPlazosReclamo(
  tenantId: string,
  candidatos: readonly CandidatoPlazo[],
  hoy: string | Date,
  deps: DepsAvisoPlazo,
  opciones: OpcionesAvisoPlazo = {},
): Promise<ResumenAvisoPlazo> {
  const r: ResumenAvisoPlazo = { enviados: 0, yaAvisados: 0, sinDestinatario: 0, fallidos: 0, vencidosCruces: 0, vencidosMonto: 0 };
  let clase;
  try { clase = clasificarPlazos(candidatos, hoy, opciones); } catch (e) { r.fallidos++; logger.error('cron.peajes.plazos_fallo', { tenant: tenantId, paso: 'clasificar', codigo: codigoDeError(e) }); return r; }
  r.vencidosCruces = clase.vencidos.cruces;
  r.vencidosMonto = clase.vencidos.monto;
  // A2P-02: el día límite más lejano de cada grupo identifica sus cobros: un cruce nuevo que entra al umbral lo mueve y el grupo vuelve a avisar.
  const limiteDe = new Map<string, string>();
  for (const c of candidatos) {
    if (c.reclamado) continue;
    const e = estadoPlazo(c.fechaCruce, hoy, opciones);
    if (e.estado === 'vencido') continue;
    const k = `${c.desgloseId}\u0000${c.lineaId}`;
    limiteDe.set(k, e.fechaLimite);
  }
  const tareas: Array<{ desgloseId: string; umbral: number; grupo: string; texto: string }> = [];
  for (const g of clase.porVencer) {
    const lejana = g.lineaIds.map((id) => limiteDe.get(`${g.desgloseId}\u0000${id}`) ?? '').sort().at(-1) ?? '';
    tareas.push({ desgloseId: g.desgloseId, umbral: g.umbral, grupo: lejana, texto: textoAvisoPlazo(g, deps.liga()) });
  }
  // H759-6: el resumen de vencidos sale UNA vez por (flota, mes) y solo con la evaluación COMPLETA: sellado por el conjunto de cobros (huella) avisaba otra vez
  // cada vez que un cruce entraba o salía de la ventana, y con una corrida parcial mandaba «se vencieron N» con N incompleto y luego otro con el total.
  if (clase.vencidos.cruces > 0 && opciones.evaluacionCompleta !== false) {
    tareas.push({ desgloseId: 'vencidos', umbral: 0, grupo: fechaLocalMX(hoy).slice(0, 7), texto: textoAvisoVencidos(clase.vencidos, deps.liga()) });
  }
  if (tareas.length === 0) return r;

  let tel: string | null;
  try { tel = await deps.telefono(tenantId); } catch (e) { r.fallidos += tareas.length; logger.error('cron.peajes.plazos_fallo', { tenant: tenantId, paso: 'destinatario', codigo: codigoDeError(e) }); return r; }
  if (!tel) { r.sinDestinatario = tareas.length; return r; }

  for (const g of tareas) {
    let reservado = false;
    try {
      reservado = await deps.reservar(tenantId, g.desgloseId, g.umbral, g.grupo);
      if (!reservado) { r.yaAvisados++; continue; }
      const ok = await deps.enviar(tel, g.texto);
      if (ok) { r.enviados++; continue; }
      r.fallidos++;
      await deps.liberar(tenantId, g.desgloseId, g.umbral, g.grupo);
    } catch (e) {
      r.fallidos++;
      logger.error('cron.peajes.plazos_fallo', { tenant: tenantId, paso: 'aviso', codigo: codigoDeError(e) });
      if (reservado) { try { await deps.liberar(tenantId, g.desgloseId, g.umbral, g.grupo); } catch { /* el siguiente barrido lo recupera por vencimiento de la reserva */ } }
    }
  }
  return r;
}
