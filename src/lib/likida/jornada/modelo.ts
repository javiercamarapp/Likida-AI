import { FRASE_SIN_REGISTRO, FRASE_REGISTRO_INCOMPLETO, MAX_MINUTOS_JORNADA } from './topes';

// ═══════════════════════════════════════════════════════════════════════════
// COMPONER EL DÍA A PARTIR DE SUS ASIENTOS — puro, sin base de datos.
//
// Este módulo hace UNA cosa y por eso es puro: recibe los asientos crudos de un
// día y devuelve el día compuesto —inicio, fin, descansos, minutos— junto con
// LOS HUECOS, que son tan resultado como las cifras.
//
// ── LA REGLA QUE ORGANIZA TODO ESTE ARCHIVO ──────────────────────────────
//
// `null` jamás se vuelve 0. Aparece en tres sitios y en los tres significa cosas
// distintas que un cero borraría:
//
//   · `minutosBrutos === null`      → falta una punta del día. No se estima.
//   · `minutosDescanso === null`    → NO SE REPORTÓ NINGÚN DESCANSO. Que no es
//                                      «no descansó»: es que nadie lo anotó, y
//                                      afirmar lo primero sería inventar un
//                                      hecho en contra del propio patrón.
//   · `minutosEfectivos === null`   → no se puede restar lo que no se sabe.
//
// ── Y LA SEGUNDA: LA PROCEDENCIA NO SE MEZCLA ────────────────────────────
//
// Un día cuyo inicio lo declaró el chofer y cuyo fin lo derivó el GPS NO es un
// día «de ocho horas»: es un día con una punta declarada y otra observada, y
// eso se dice (`mezclada`). Presentar la resta de las dos como si fuera una
// sola medición es la manera exacta de convertir un registro en una afirmación
// que nadie hizo.
// ═══════════════════════════════════════════════════════════════════════════

export type TipoAsiento = 'inicio_jornada' | 'fin_jornada' | 'inicio_descanso' | 'fin_descanso';

export type Procedencia = 'declarado_operador' | 'hito_viaje' | 'gps' | 'capturado_contralor';

/** Cómo se nombra cada procedencia en pantalla y en el reporte. La lista es
 *  cerrada y vive aquí para que la pantalla y el CSV digan lo mismo. */
export const ROTULO_PROCEDENCIA: Readonly<Record<Procedencia, string>> = {
  declarado_operador: 'Declarado por el operador',
  hito_viaje: 'Derivado de un hito del viaje',
  gps: 'Derivado del GPS de la unidad',
  capturado_contralor: 'Capturado en oficina',
};

/** Qué sostiene cada procedencia — la letra chica que evita leer de más. */
export const ALCANCE_PROCEDENCIA: Readonly<Record<Procedencia, string>> = {
  declarado_operador: 'Es la declaración del operador, con la hora de su mensaje.',
  hito_viaje: 'Se derivó de un hito que el operador selló; él no declaró jornada.',
  gps: 'Prueba que la unidad se movió, no que el operador la manejara.',
  capturado_contralor: 'Lo capturó una persona de oficina, con su nombre y su hora.',
};

export interface Asiento {
  id: string;
  tipo: TipoAsiento;
  /** ISO 8601 con zona. */
  momento: string;
  procedencia: Procedencia;
  origenRef: string | null;
  waMessageId: string | null;
  viajeId: string | null;
  registradoPorEmail: string | null;
  nota: string | null;
  corrigeA: string | null;
  anuladoEn: string | null;
  anuladoPorEmail: string | null;
  anuladoMotivo: string | null;
}

export interface Descanso {
  inicio: Asiento;
  /** `null` = el descanso quedó abierto: nadie marcó el regreso. */
  fin: Asiento | null;
  /** `null` mientras el descanso siga abierto. Nunca 0 por omisión. */
  minutos: number | null;
}

/** Lo que falta, con su nombre. No es un error: es parte del resultado. */
export type ClaseHueco =
  | 'sin_marcas'
  | 'sin_inicio'
  | 'sin_fin'
  | 'descanso_abierto'
  | 'fin_antes_de_inicio'
  | 'duracion_imposible';

export interface Hueco {
  clase: ClaseHueco;
  /** La frase que se le enseña a una persona, ya redactada. */
  dice: string;
}

export interface JornadaCompuesta {
  inicio: Asiento | null;
  fin: Asiento | null;
  descansos: Descanso[];
  /** Minutos entre inicio y fin, SIN restar descansos. `null` si falta una punta. */
  minutosBrutos: number | null;
  /** Minutos de descanso PAREADOS. `null` si no se reportó ninguno, o si alguno
   *  quedó abierto: sumar los cerrados e ignorar el abierto daría una cifra
   *  menor a la real y presentada como si fuera completa. */
  minutosDescanso: number | null;
  /** Brutos menos descansos. `null` en cuanto cualquiera de los dos lo sea. */
  minutosEfectivos: number | null;
  huecos: Hueco[];
  /**
   * Las marcas VIVAS que no encontraron sitio: un `fin_descanso` sin su inicio,
   * o una segunda marca del mismo tipo que sobrevivió a la composición.
   *
   * NO SE TIRAN EN SILENCIO, y eso es el punto. Un asiento que existe en la base
   * pero que ninguna vista enseña es un asiento que nadie puede anular ni
   * corregir: se queda en el expediente, fuera del documento, y aparece el día
   * que alguien exporta la tabla cruda en un juicio. Se sacan aquí para que la
   * pantalla los pinte y el contralor pueda anularlos.
   */
  sueltos: Asiento[];
  /** `true` si el inicio y el fin no vienen de la misma procedencia. */
  mezclada: boolean;
  /** Los asientos ANULADOS del día, en orden. No se esconden: son parte del
   *  expediente y de la historia de sus correcciones. */
  anulados: Asiento[];
}

const HUECO: Readonly<Record<ClaseHueco, string>> = {
  sin_marcas: FRASE_SIN_REGISTRO,
  sin_inicio: 'Falta la marca de inicio de jornada. No se estima la hora de entrada.',
  sin_fin: 'Falta la marca de fin de jornada. No se estima la hora de salida.',
  descanso_abierto: 'Un descanso quedó abierto: se marcó el inicio y no el regreso. No se estima cuánto duró.',
  fin_antes_de_inicio: 'El fin de jornada quedó registrado antes del inicio. Hay que corregirlo a mano: el sistema no reordena marcas.',
  duracion_imposible: 'La jornada mediría más de 24 horas. Eso no es un día largo: son dos marcas mal capturadas, y hay que corregirlas.',
};

function hueco(clase: ClaseHueco): Hueco {
  return { clase, dice: HUECO[clase] };
}

/** El milisegundo del asiento, o `NaN` si la fecha no es legible. */
function ms(a: Asiento): number {
  return Date.parse(a.momento);
}

/** Vivos = no anulados. Un asiento anulado sigue en el expediente pero ya no
 *  cuenta para las cifras — esa es toda la diferencia entre anular y borrar. */
export function estaVivo(a: Asiento): boolean {
  return a.anuladoEn === null;
}

/**
 * Compone el día. Nunca lanza y nunca inventa: lo que no se puede calcular sale
 * como `null` con su hueco al lado.
 */
export function componerJornada(asientos: readonly Asiento[]): JornadaCompuesta {
  const vivos = asientos.filter(estaVivo).slice().sort((a, b) => ms(a) - ms(b));
  const anulados = asientos.filter((a) => !estaVivo(a)).slice().sort((a, b) => ms(a) - ms(b));
  const huecos: Hueco[] = [];

  // La primera de cada tipo. `jornada_asiento_marca_unica` (0241) garantiza que
  // solo hay UNA viva de cada una, así que en la práctica no hay sobrantes; si
  // los hubiera —una lectura de una base sin esa migración, o una prueba que
  // arma asientos a mano— NO se descartan en silencio: se van a `sueltos`.
  const iniciosVivos = vivos.filter((a) => a.tipo === 'inicio_jornada');
  const finesVivos = vivos.filter((a) => a.tipo === 'fin_jornada');
  const inicio = iniciosVivos[0] ?? null;
  const fin = finesVivos[0] ?? null;

  // ── LOS DESCANSOS SE PAREAN EN ORDEN ────────────────────────────────────
  // Un `inicio_descanso` se cierra con el siguiente `fin_descanso` que venga
  // después. Un `fin_descanso` sin inicio previo NO abre un descanso hacia
  // atrás: sería inventar a qué hora empezó.
  const descansos: Descanso[] = [];
  const sueltos: Asiento[] = [];
  let abierto: Asiento | null = null;
  for (const a of vivos) {
    if (a.tipo === 'inicio_descanso') {
      // Dos inicios seguidos: el primero queda abierto y se dice.
      if (abierto) descansos.push({ inicio: abierto, fin: null, minutos: null });
      abierto = a;
      continue;
    }
    if (a.tipo === 'fin_descanso') {
      if (abierto) {
        const minutos = Math.round((ms(a) - ms(abierto)) / 60_000);
        descansos.push({ inicio: abierto, fin: a, minutos: minutos >= 0 ? minutos : null });
        abierto = null;
      } else {
        // Un regreso de descanso sin salida NO abre un descanso hacia atrás:
        // sería inventar a qué hora empezó. Queda SUELTO, visible y anulable.
        sueltos.push(a);
      }
    }
  }
  if (abierto) descansos.push({ inicio: abierto, fin: null, minutos: null });

  const hayDescansoAbierto = descansos.some((d) => d.minutos === null);
  if (hayDescansoAbierto) huecos.push(hueco('descanso_abierto'));

  // `null` cuando NADIE reportó un descanso. Cero significaría «no descansó»,
  // que es una afirmación distinta y que Likida no puede hacer.
  const minutosDescanso = descansos.length === 0 || hayDescansoAbierto
    ? null
    : descansos.reduce((s, d) => s + (d.minutos ?? 0), 0);

  // ── LOS MINUTOS DEL DÍA ─────────────────────────────────────────────────
  let minutosBrutos: number | null = null;
  if (inicio === null && fin === null) {
    huecos.push(hueco('sin_marcas'));
  } else if (inicio === null) {
    huecos.push(hueco('sin_inicio'));
  } else if (fin === null) {
    huecos.push(hueco('sin_fin'));
  } else {
    const delta = Math.round((ms(fin) - ms(inicio)) / 60_000);
    if (!Number.isFinite(delta) || delta < 0) {
      huecos.push(hueco('fin_antes_de_inicio'));
    } else if (delta > MAX_MINUTOS_JORNADA) {
      huecos.push(hueco('duracion_imposible'));
    } else {
      minutosBrutos = delta;
    }
  }

  const minutosEfectivos = minutosBrutos === null || minutosDescanso === null
    ? null
    : Math.max(0, minutosBrutos - minutosDescanso);

  sueltos.push(...iniciosVivos.slice(1), ...finesVivos.slice(1));
  sueltos.sort((a, b) => ms(a) - ms(b));

  return {
    inicio,
    fin,
    descansos,
    minutosBrutos,
    minutosDescanso,
    minutosEfectivos,
    huecos,
    sueltos,
    mezclada: inicio !== null && fin !== null && inicio.procedencia !== fin.procedencia,
    anulados,
  };
}

/** `true` si el día no tiene una sola marca viva. Es el caso que el producto
 *  jamás debe presentar como cero horas. */
export function sinRegistroDeclarado(j: JornadaCompuesta): boolean {
  return j.huecos.some((h) => h.clase === 'sin_marcas');
}

/** La frase corta que la pantalla y el CSV enseñan cuando no hay con qué
 *  medir. Se resuelve aquí para que las dos digan exactamente lo mismo. */
export function fraseDelHueco(j: JornadaCompuesta): string | null {
  if (j.huecos.length === 0) return null;
  if (sinRegistroDeclarado(j)) return FRASE_SIN_REGISTRO;
  const puntaFaltante = j.huecos.find((h) => h.clase === 'sin_inicio' || h.clase === 'sin_fin');
  if (puntaFaltante) return `${FRASE_REGISTRO_INCOMPLETO} ${puntaFaltante.dice}`;
  return j.huecos[0].dice;
}

/** Horas con dos decimales para presentar, o `null`. NUNCA cae a 0. */
export function aHoras(minutos: number | null): number | null {
  if (minutos === null) return null;
  return Math.round((minutos / 60) * 100) / 100;
}
