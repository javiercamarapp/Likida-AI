// Datos 100 % sintéticos para el servidor TMS falso. Nada aquí es real: nombres, folios, montos y coordenadas
// son inventados con un generador determinista (misma semilla = mismos datos). La FORMA imita la descrita en el
// levantamiento: liquidaciones con percepciones/deducciones, peajes por fechas, viajes y posiciones con `Icident`.

export interface RenglonSintetico {
  concepto: string; valor: number;
  /** Columna nueva `desglose` (el nombre que RH quiere ver); ausente = se usa `concepto`. SUPUESTO-API. */
  desglose?: string;
}
export interface LiquidacionSintetica {
  operador: string; unidad: string; bitacora: string; de: string; a: string; dias: number;
  percepciones: RenglonSintetico[]; deducciones: RenglonSintetico[];
  desglose: { texto: string; renglones: number }; enviado: boolean;
  /** Campos opcionales de la ruta de desglose por correo (SUPUESTO-API): faltar es un caso que se prueba. */
  poliza?: string | null; operador_numero?: string; tipo_operador?: string; terminal?: string;
}
export interface PeajeSintetico {
  punto_interes: string; latitud: number; longitud: number; fecha_posicion: string; viaje: string; fecha_recibido: string;
}
export interface ViajeSintetico { Icident: string; unidad: string; 'Fecha Salida': string; 'Fecha Llegada': string }
export interface PosicionSintetica { Icident: string; unidad: string; latitud: number; longitud: number; fecha: string }

export interface ConjuntoSintetico {
  liquidaciones: LiquidacionSintetica[];
  peajes: PeajeSintetico[];
  viajes: ViajeSintetico[];
  posiciones: PosicionSintetica[];
}

/** Bitácora de prueba cuyas SUMAS son las del caso citado en el plan; los renglones son inventados. */
export const BITACORA_1228 = '1228';
export const SUMAS_1228 = { percepciones: 1_140_746, deducciones: 511_423, neto: 629_323 } as const; // en centavos

/** Suma exacta (centavos enteros) para evitar errores de coma flotante. */
export const aCentavos = (v: number): number => Math.round(v * 100);
export const sumaCentavos = (rs: RenglonSintetico[]): number => rs.reduce((t, r) => t + aCentavos(r.valor), 0);

function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIA_MS = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const pad = (n: number): string => String(n).padStart(2, '0');
/** `YYYY-MM-DD HH:mm:ss` en UTC: el crudo pide «Fecha Salida» con segundos. */
const conSegundos = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

export function liquidacion1228(): LiquidacionSintetica {
  const base = Date.UTC(2026, 0, 5);
  return {
    operador: 'Operador Sintético 1228', unidad: 'UNI-1228', bitacora: BITACORA_1228,
    de: iso(base), a: iso(base + 9 * DIA_MS), dias: 10,
    percepciones: [
      { concepto: 'Sueldo base', valor: 8000.0 },
      { concepto: 'Bono por kilómetros', valor: 2500.0 },
      { concepto: 'Viáticos', valor: 907.46 },
    ],
    deducciones: [
      { concepto: 'Anticipo', valor: 3200.0 },
      { concepto: 'Impuesto retenido', valor: 1500.0 },
      { concepto: 'Descuento por faltante', valor: 414.23 },
    ],
    desglose: { texto: 'Desglose sintético de la bitácora 1228', renglones: 6 },
    enviado: false,
  };
}

/** Genera `n` bitácoras (la primera es siempre la 1228 sintética) y los peajes/viajes/posiciones asociados. */
export function generarDatos(opts: { semilla?: number; n?: number; inicio?: string } = {}): ConjuntoSintetico {
  const { semilla = 7, n = 12 } = opts;
  const inicio = Date.parse(opts.inicio ?? '2026-01-05T00:00:00.000Z');
  const rnd = mulberry32(semilla);
  const liquidaciones: LiquidacionSintetica[] = [];
  const peajes: PeajeSintetico[] = [];
  const viajes: ViajeSintetico[] = [];
  const posiciones: PosicionSintetica[] = [];

  for (let i = 0; i < n; i++) {
    const t0 = inicio + i * 10 * DIA_MS;
    if (i === 0) liquidaciones.push(liquidacion1228());
    else {
      const percepciones: RenglonSintetico[] = [
        { concepto: 'Sueldo base', valor: 7000 + Math.floor(rnd() * 3000) },
        { concepto: 'Bono por kilómetros', valor: Math.floor(rnd() * 2500) },
      ];
      const deducciones: RenglonSintetico[] = [{ concepto: 'Anticipo', valor: Math.floor(rnd() * 3000) }];
      liquidaciones.push({
        operador: `Operador Sintético ${String(i).padStart(2, '0')}`, unidad: `UNI-${100 + i}`,
        bitacora: String(2000 + i), de: iso(t0), a: iso(t0 + 9 * DIA_MS), dias: 10,
        percepciones, deducciones,
        desglose: { texto: `Desglose sintético ${i}`, renglones: percepciones.length + deducciones.length }, enviado: false,
      });
    }
    const unidad = liquidaciones[i].unidad;
    const salida = t0 + Math.floor(rnd() * 20) * 3_600_000 + Math.floor(rnd() * 60) * 1000;
    const icident = `SINT-${String(i + 1).padStart(4, '0')}`;
    viajes.push({ Icident: icident, unidad, 'Fecha Salida': conSegundos(salida), 'Fecha Llegada': conSegundos(salida + (6 + Math.floor(rnd() * 30)) * 3_600_000) });
    for (let k = 0; k < 3; k++) {
      const lat = Number((19 + rnd()).toFixed(5)); const lon = Number((-99 - rnd()).toFixed(5));
      const f = salida + (k + 1) * 3_600_000;
      posiciones.push({ Icident: icident, unidad, latitud: lat, longitud: lon, fecha: iso(f) });
    }
    for (let k = 0; k < 2; k++) {
      const f = salida + (k + 1) * 2 * 3_600_000;
      peajes.push({
        punto_interes: `Caseta sintética ${i}-${k}`, latitud: Number((19 + rnd()).toFixed(5)), longitud: Number((-99 - rnd()).toFixed(5)),
        fecha_posicion: iso(f), viaje: icident, fecha_recibido: iso(f + 10 * DIA_MS),
      });
    }
  }
  return { liquidaciones, peajes, viajes, posiciones };
}
