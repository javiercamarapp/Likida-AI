import type { GrupoPorVencer, CandidatoPlazo, OpcionesPlazo } from './plazo_reclamo';
import { clasificarPlazos } from './plazo_reclamo';

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

export interface DepsAvisoPlazo {
  /** Reserva el aviso (desglose, umbral). `false` si ya estaba reservado/enviado. */
  reservar: (tenantId: string, desgloseId: string, umbral: number) => Promise<boolean>;
  /** Devuelve la reserva cuando el envío falló, para reintentar. */
  liberar: (tenantId: string, desgloseId: string, umbral: number) => Promise<void>;
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
  opciones: OpcionesPlazo = {},
): Promise<ResumenAvisoPlazo> {
  const r: ResumenAvisoPlazo = { enviados: 0, yaAvisados: 0, sinDestinatario: 0, fallidos: 0, vencidosCruces: 0, vencidosMonto: 0 };
  let clase;
  try { clase = clasificarPlazos(candidatos, hoy, opciones); } catch { r.fallidos++; return r; }
  r.vencidosCruces = clase.vencidos.cruces;
  r.vencidosMonto = clase.vencidos.monto;
  if (clase.porVencer.length === 0) return r;

  let tel: string | null;
  try { tel = await deps.telefono(tenantId); } catch { r.fallidos += clase.porVencer.length; return r; }
  if (!tel) { r.sinDestinatario = clase.porVencer.length; return r; }

  for (const g of clase.porVencer) {
    let reservado = false;
    try {
      reservado = await deps.reservar(tenantId, g.desgloseId, g.umbral);
      if (!reservado) { r.yaAvisados++; continue; }
      const ok = await deps.enviar(tel, textoAvisoPlazo(g, deps.liga()));
      if (ok) { r.enviados++; continue; }
      r.fallidos++;
      await deps.liberar(tenantId, g.desgloseId, g.umbral);
    } catch {
      r.fallidos++;
      if (reservado) { try { await deps.liberar(tenantId, g.desgloseId, g.umbral); } catch { /* el siguiente barrido lo recupera por vencimiento de la reserva */ } }
    }
  }
  return r;
}
