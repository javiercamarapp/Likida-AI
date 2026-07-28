// ═══════════════════════════════════════════════════════════════════════════
// RELOJ DE CADUCIDAD — cuánto le queda a un ticket para poder facturarse.
//
// El plazo es el riesgo que no se ve. Medido el 27-jul-2026 sobre 60 guías de
// comercios: las gasolineras dan 7–15 días y la mayoría no factura pasado el
// mes natural de la compra.
//
// Para una flota que liquida por quincena eso es una trampa silenciosa: el
// ticket de diésel del día 2 puede estar VENCIDO cuando la oficina cierra el
// día 16. Y un gasto sin CFDI no es deducible — el dinero ya salió y el IVA se
// pierde. Por eso esto no es un adorno del panel: es lo que permite avisar
// ANTES, cuando todavía se puede hacer algo.
// ═══════════════════════════════════════════════════════════════════════════

/** Cuánto tiempo da el comercio para facturar. */
export type Plazo = { dias: number } | 'mes_natural' | 'mes_siguiente';

export interface Caducidad {
  /** Último día en que el comercio acepta facturar (ISO, inclusive). */
  fechaLimite?: string;
  /** Días que faltan; 0 el mismo día del vencimiento. */
  diasRestantes: number;
  vencido: boolean;
  /** Quedan 2 días o menos: hay que empujarlo ya. */
  urgente: boolean;
  /** Sin fecha de ticket confiable: no se afirma nada. */
  desconocido: boolean;
}

const DIA_MS = 86_400_000;
const UMBRAL_URGENTE = 2;

/** Convierte 'YYYY-MM-DD' a UTC medianoche, para restar sin líos de zona horaria. */
function aUtc(iso: string): number {
  const [a, m, d] = iso.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function calcularCaducidad(args: {
  fechaTicket: string | undefined;
  plazo: Plazo;
  /** Se inyecta para que la prueba no dependa del reloj de la máquina. */
  hoy: string;
}): Caducidad {
  // El OCR falla en fechas —se le vio devolver 2023 en un ticket de 2026—, y
  // afirmar "vigente" sobre una fecha inventada es peor que no decir nada: la
  // oficina dejaría de revisarlo.
  if (!args.fechaTicket) {
    return { diasRestantes: 0, vencido: false, urgente: false, desconocido: true };
  }

  const compra = aUtc(args.fechaTicket);
  const c = new Date(compra);
  const limite =
    args.plazo === 'mes_natural'
      ? // Día 0 del mes siguiente = último día de este mes; cubre 28, 30 y 31.
        Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 0)
      : args.plazo === 'mes_siguiente'
        ? // Último día del mes SIGUIENTE al de la compra. No es lo mismo que el
          // mes natural y la diferencia es de semanas: el ticket de Office Depot
          // del 25-jul dice "solicitarla a más tardar dentro del mes siguiente a
          // la fecha de emisión", así que vence el 31-AGO, no el 31-jul.
          // Avisarle "te quedan 3 días" habría sido falso.
          Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 2, 0)
        : compra + args.plazo.dias * DIA_MS;

  const hoyMs = aUtc(args.hoy);
  // El plazo vence al FINAL del día límite: el mismo día todavía se puede facturar.
  const restantes = Math.round((limite - hoyMs) / DIA_MS);

  return {
    fechaLimite: iso(limite),
    diasRestantes: Math.max(0, restantes),
    vencido: restantes < 0,
    urgente: restantes >= 0 && restantes <= UMBRAL_URGENTE,
    desconocido: false,
  };
}
