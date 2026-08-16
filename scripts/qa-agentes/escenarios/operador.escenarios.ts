// ═══════════════════════════════════════════════════════════════════════════
// GENERADOR DE ESCENARIOS del agente Operador — Fase 1.
//
// Los 4 ataques mínimos del encargo, con TODO dato sintético derivado del
// PRNG sembrado (mulberry32 sobre sha256(fecha|nivel|agente|ataque|índice)):
//
//   (a) foto_duplicada — la MISMA foto byte a byte, dos viajes del MISMO
//       tenant (el índice uq_gasto_img_hash es unique(tenant_id, img_hash):
//       el pre-check del processor mira UN viaje, así que el segundo insert
//       tiene que chocar contra la BASE con `duplicate key value`).
//   (b) post_cierre — comprobante fechado 2 días antes del cierre, mandado
//       DESPUÉS de que el viaje ya quedó 'liquidado' → la liquidación no
//       cambia Y el papel cae a comprobante_huerfano (invariante #4).
//   (c) texto_sin_fotos — "ya subí todo" con CERO fotos → el sistema no debe
//       cerrar una liquidación con el anticipo entero en contra del chofer.
//   (d) borde_tope — dos tickets de diésel: tope+1 (debe salir
//       sobre_politica con exceso $1) y tope−1 (no debe salir) — el ataque
//       "$1 arriba del tope" del diseño §7, sobre la política real sembrada.
//
// El generador es PURO: mismo (fecha, índice) → mismo escenario. El "cuándo"
// (hoy, ayer) se ancla a la fecha de la corrida, no al reloj del momento.
// ═══════════════════════════════════════════════════════════════════════════

import { mulberry32, semillaDesde, pesos, entre, folioSintetico, fechaDesplazada, type Rng } from './rng';

export type AtaqueOperador = 'foto_duplicada' | 'post_cierre' | 'texto_sin_fotos' | 'borde_tope';

export const ATAQUES_FASE_1: AtaqueOperador[] = [
  'foto_duplicada', 'post_cierre', 'texto_sin_fotos', 'borde_tope',
];

export interface TicketEscenario {
  monto: number;
  fecha: string;      // YYYY-MM-DD impresa en el ticket
  folio: string;
  litros: number;     // solo cosmético del SVG
}

export interface EscenarioOperador {
  ataque: AtaqueOperador;
  semillaTexto: string;   // el texto exacto que se hasheó (auditable)
  seed: number;           // uint32 para mulberry32
  /** Invariantes del diseño §4 que este escenario debe disparar. */
  invariantes: string[];
  // Datos del viaje bajo ataque:
  anticipo: number;
  folioViaje: string;
  /** Solo (a): el folio del segundo viaje (otro operador, mismo tenant). */
  folioViaje2?: string;
  /** Tope de política por comprobante de diésel (sembrado en tenant.config). */
  topeDiesel: number;
  /** Fecha de inicio del viaje relativa a la corrida. */
  fechaInicioViaje: string;
  /** Solo (b): fecha en que el viaje se cerró (liquidación sembrada). */
  fechaCierre?: string;
  /** Solo (b): totales de la liquidación sembrada, para verificar que NO cambian. */
  liquidacionSembrada?: { totalComprobado: number; totalAnticipo: number; diferencia: number };
  tickets: TicketEscenario[];
  /** Mensajes de texto del chofer, en orden, después de las fotos. */
  textos: string[];
}

/** Semilla canónica del diseño §7: sha256(fecha + nivel + agente + índice). */
export function semillaEscenario(fecha: string, ataque: AtaqueOperador, indice: number): { texto: string; seed: number } {
  const texto = `${fecha}|nivel3|operador|${ataque}|${indice}`;
  return { texto, seed: semillaDesde(texto) };
}

function ticket(rng: Rng, monto: number, fecha: string): TicketEscenario {
  return {
    monto,
    fecha,
    folio: folioSintetico(rng, 'ZZZQA'),
    litros: entre(rng, 20, 180),
  };
}

export function generarEscenario(fecha: string, ataque: AtaqueOperador, indice = 0): EscenarioOperador {
  const { texto, seed } = semillaEscenario(fecha, ataque, indice);
  const rng = mulberry32(seed);
  const hoy = new Date(`${fecha}T12:00:00Z`);
  const anticipo = entre(rng, 80, 140) * 100;     // $8,000–$14,000, redondo como un anticipo real
  const topeDiesel = 4000;                         // política sembrada en tenant.config (fija, no del RNG: es la política, no el ataque)
  const base = {
    ataque, semillaTexto: texto, seed, anticipo, topeDiesel,
    folioViaje: folioSintetico(rng, 'ZZZQA-V'),
    fechaInicioViaje: fechaDesplazada(hoy, -1),
  };

  switch (ataque) {
    case 'foto_duplicada': {
      // UN ticket; se manda dos veces byte a byte (mismo dataUrl), la segunda
      // por OTRO operador del mismo tenant. Monto bajo el tope: el ataque es
      // el duplicado, no la política.
      const t = ticket(rng, pesos(rng, 300, Math.min(1500, topeDiesel - 100)), fechaDesplazada(hoy, 0));
      return {
        ...base,
        folioViaje2: folioSintetico(rng, 'ZZZQA-V'),
        invariantes: ['#3 dedup', '#8 bitacora'],
        tickets: [t],
        textos: [],
      };
    }
    case 'post_cierre': {
      const cierre = fechaDesplazada(hoy, -1);
      const totalComprobado = pesos(rng, 2000, 5000);
      const t = ticket(rng, pesos(rng, 300, 1200), fechaDesplazada(hoy, -3)); // 2 días ANTES del cierre
      return {
        ...base,
        fechaCierre: cierre,
        liquidacionSembrada: {
          totalComprobado,
          totalAnticipo: base.anticipo,
          diferencia: Math.round((base.anticipo - totalComprobado) * 100) / 100,
        },
        invariantes: ['#4 huerfano_post_cierre', '#8 bitacora'],
        tickets: [t],
        textos: [],
      };
    }
    case 'texto_sin_fotos':
      return {
        ...base,
        invariantes: ['#1 cuadre_balancea (no debe cerrar)', '#5 cifras_con_fuente', '#8 bitacora'],
        tickets: [],
        textos: ['ya subí todo'],
      };
    case 'borde_tope': {
      const f = fechaDesplazada(hoy, 0);
      return {
        ...base,
        invariantes: ['#1 cuadre_balancea', '#5 cifras_con_fuente', '#8 bitacora'],
        tickets: [
          ticket(rng, topeDiesel + 1, f),   // $1 ARRIBA del tope → sobre_politica, exceso exacto $1
          ticket(rng, topeDiesel - 1, f),   // $1 ABAJO del tope → limpio
        ],
        textos: ['listo'],
      };
    }
  }
}
