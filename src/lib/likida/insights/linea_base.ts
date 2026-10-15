// Línea base del cliente y ahorro defendible (T-INS-05).
// Regla única: SIN línea base, SIN medida suficiente, NO hay porcentaje. Se dice «pendiente» y por qué.
// Todo se expresa en minutos por unidad; aquí no hay dinero ni sueldos. Fechas en ISO; el periodo se
// describe en la zona America/Mexico_City de la flota (la duración en días no depende de la zona).

import type { Fuente } from './tipos';

/** Una medida necesita al menos este periodo y esta muestra para llamarse «de hoy» con cifra. */
export const DIAS_MIN_MEDIDA = 30;
export const N_MIN_MEDIDA = 10;

export const MOTIVO_PENDIENTE = 'pendiente: falta la medida de hoy';

/** Lo que la flota capturó (fila de `insight_linea_base`, migración 0805). */
export interface LineaBase {
  proceso: string;
  minutosPorUnidad: number;
  unidad: string;
  /** De dónde sale el dato (p. ej. «cronometraje de 10 casos»). */
  fuente: string;
  capturadaEn: string;
}

/** Lo que mide el sistema hoy para el mismo proceso. */
export interface Medida {
  proceso: string;
  minutosPorUnidad: number;
  unidad: string;
  /** Casos que respaldan el promedio. */
  n: number;
  /** Inicio y fin (ISO) del periodo medido. */
  desde: string;
  hasta: string;
  fuente: string;
}

export interface AhorroSeguro {
  /** Porcentaje de ahorro (puede ser negativo si hoy tarda MÁS). `null` = no se muestra cifra. */
  pct: number | null;
  /** Minutos ahorrados por unidad (negativo si hoy tarda más); `null` si no hay cifra. */
  minutosAhorrados: number | null;
  /** Por qué hay cifra o por qué no, en lenguaje llano. */
  motivo: string;
  /** Fuente de cada lado; solo con cifra. */
  fuente: { base: Fuente; medida: Fuente } | null;
}

function sinCifra(motivo: string): AhorroSeguro {
  return { pct: null, minutosAhorrados: null, motivo, fuente: null };
}

const MS_DIA = 86_400_000;

function numeroValido(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

export function ahorroSeguro(
  linea: LineaBase | null | undefined,
  medida: Medida | null | undefined,
): AhorroSeguro {
  if (!linea) return sinCifra(`${MOTIVO_PENDIENTE}: falta la línea base de este proceso`);
  if (!numeroValido(linea.minutosPorUnidad) || linea.minutosPorUnidad <= 0 || !linea.fuente.trim()) {
    return sinCifra(`${MOTIVO_PENDIENTE}: la línea base no tiene un valor y una fuente válidos`);
  }
  if (!medida) return sinCifra(MOTIVO_PENDIENTE);
  if (medida.proceso !== linea.proceso) {
    return sinCifra(`${MOTIVO_PENDIENTE}: la medida es de otro proceso`);
  }
  if (medida.unidad.trim().toLowerCase() !== linea.unidad.trim().toLowerCase()) {
    return sinCifra(`${MOTIVO_PENDIENTE}: la línea base y la medida no usan la misma unidad`);
  }
  if (!numeroValido(medida.minutosPorUnidad) || medida.minutosPorUnidad < 0 || !medida.fuente.trim()) {
    return sinCifra(`${MOTIVO_PENDIENTE}: la medida no tiene un valor y una fuente válidos`);
  }
  const desde = Date.parse(medida.desde);
  const hasta = Date.parse(medida.hasta);
  if (!Number.isFinite(desde) || !Number.isFinite(hasta) || hasta < desde) {
    return sinCifra(`${MOTIVO_PENDIENTE}: el periodo de la medida no es válido`);
  }
  const dias = (hasta - desde) / MS_DIA;
  if (dias < DIAS_MIN_MEDIDA) {
    return sinCifra(
      `${MOTIVO_PENDIENTE}: la medida cubre ${Math.floor(dias)} días y se necesitan al menos ${DIAS_MIN_MEDIDA}`,
    );
  }
  if (!Number.isInteger(medida.n) || medida.n < N_MIN_MEDIDA) {
    return sinCifra(
      `${MOTIVO_PENDIENTE}: la medida tiene ${Number.isFinite(medida.n) ? medida.n : 0} casos y se necesitan al menos ${N_MIN_MEDIDA}`,
    );
  }

  const minutosAhorrados = redondear(linea.minutosPorUnidad - medida.minutosPorUnidad);
  const pct = redondear((minutosAhorrados / linea.minutosPorUnidad) * 100);
  return {
    pct,
    minutosAhorrados,
    motivo:
      minutosAhorrados >= 0
        ? `ahorro medido contra la línea base capturada (${linea.fuente})`
        : `hoy tarda más que la línea base capturada (${linea.fuente})`,
    fuente: {
      base: {
        tabla: 'insight_linea_base',
        calculo: linea.fuente,
        periodo: `capturada el ${linea.capturadaEn.slice(0, 10)}`,
        n: 1,
      },
      medida: {
        calculo: medida.fuente,
        periodo: `${medida.desde.slice(0, 10)} al ${medida.hasta.slice(0, 10)} (hora del Centro de México)`,
        n: medida.n,
      },
    },
  };
}

function redondear(x: number): number {
  return Math.round(x * 10) / 10;
}
