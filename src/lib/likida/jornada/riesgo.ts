import {
  TOPE_DIARIO_LFT_68_HORAS,
  DESCANSO_MINIMO_LFT_63_MINUTOS,
  DIAS_TRABAJO_ANTES_DE_DESCANSO_LFT_69,
  clasificarJornadaLFT60,
  topeSemanalDelAnio,
  LEYENDA_NOM_087,
  LEYENDA_SIN_DICTAMEN,
  type TipoJornadaLFT,
} from './topes';
import { componerJornada, sinRegistroDeclarado, type JornadaCompuesta } from './modelo';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ALERTAS DE RIESGO — y las tres cosas que este motor NUNCA dice.
//
//   1. NUNCA dice «cumple». No existe ese veredicto en el tipo `Veredicto`, y
//      no es un olvido: certificar cumplimiento es un dictamen jurídico, y
//      Likida no da asesoría jurídica. El motor emite EXCESO (con su artículo)
//      o DATO INSUFICIENTE. Lo más cerca que llega de la buena noticia es
//      `sin_senal_de_exceso`, que dice exactamente lo que midió y nada más.
//
//   2. NUNCA estima. Si al día le falta una punta, el veredicto es
//      `dato_insuficiente` — no una jornada supuesta con la hora que «suele»
//      salir el chofer. Un «cumple» falso es peor que un hueco declarado.
//
//   3. NUNCA evalúa la NOM-087. Sus topes son de CONDUCCIÓN y este registro es
//      de JORNADA (LFT art. 58: el tiempo a disposición del patrón). Likida no
//      sabe cuántas horas fueron volante, así que se abstiene y lo dice con
//      `LEYENDA_NOM_087`, citando la norma que no está aplicando.
//
// ── POR QUÉ REBASAR EL ART. 61 NO ES UNA ALERTA ROJA ─────────────────────
//
// El art. 61 fija la jornada ORDINARIA (ocho horas la diurna, siete la
// nocturna, siete y media la mixta). Rebasarlo no es una infracción: significa
// que hubo tiempo EXTRAORDINARIO, que la ley permite y manda pagar al doble
// (arts. 66 y 68). Marcarlo en rojo entrenaría al contralor a ignorar el
// tablero, que es la forma más rápida de que la alerta que sí importa se
// pierda. Se reporta como observación, con las horas extra que salieron.
//
// El rojo se lo lleva el art. 68, último párrafo: «La suma de las jornadas
// ordinaria y extraordinaria, en ningún caso podrá ser mayor a doce horas
// diarias». Ése sí es un tope duro y sin excepción en el texto.
// ═══════════════════════════════════════════════════════════════════════════

export type Veredicto =
  /** El día no tiene una sola marca viva. No son cero horas. */
  | 'sin_registro_declarado'
  /** Hay marcas, pero no alcanzan para medir el día. */
  | 'dato_insuficiente'
  /** Se midió y algo rebasa un tope citable. */
  | 'exceso'
  /** Se midió y nada de lo que este motor puede evaluar salió rebasado. */
  | 'sin_senal_de_exceso';

export type ClaseSenal =
  | 'exceso_tope_diario_lft_68'
  | 'exceso_tope_flota'
  | 'tiempo_extraordinario'
  | 'descanso_bajo_minimo_lft_63'
  | 'sin_descanso_registrado'
  | 'exceso_semanal'
  | 'sin_dia_de_descanso_lft_69'
  | 'procedencia_mezclada'
  | 'descanso_pudo_contar_lft_64'
  | 'cota_inferior_derivada';

export interface Senal {
  clase: ClaseSenal;
  /** `true` si esta señal es la que hace que el veredicto sea `exceso`. */
  esExceso: boolean;
  /** La frase para una persona, con su artículo cuando lo tiene. */
  dice: string;
  /** El fundamento citable, o `null` cuando la señal es de la flota y no de la ley. */
  fundamento: string | null;
}

/** Los umbrales que la flota se puso a sí misma. `null` = no declarado. */
export interface PoliticaFlota {
  horasMaxJornada: number | null;
  minutosMinDescanso: number | null;
  horasMinEntreJornadas: number | null;
  fundamento: string | null;
}

export interface RiesgoDia {
  veredicto: Veredicto;
  senales: Senal[];
  /** El tipo de jornada del art. 60, si se pudo clasificar sin inventar. */
  tipoJornada: TipoJornadaLFT | null;
  /** Horas extraordinarias sobre el tope ordinario del art. 61. `null` si no
   *  se pudo medir el día. Nunca 0 por omisión: 0 aquí significa medido y sin
   *  tiempo extra. */
  horasExtraordinarias: number | null;
  /** Lo que el motor NO evaluó, dicho. Siempre trae al menos la NOM-087. */
  noEvaluado: string[];
}

const HORAS = (min: number) => Math.round((min / 60) * 100) / 100;

/**
 * Evalúa UN día. `politica` puede venir sin un solo umbral: entonces el motor
 * evalúa solo los topes de la LFT, que son los que sí puede citar.
 */
export function evaluarRiesgoDia(
  jornada: JornadaCompuesta,
  politica: PoliticaFlota | null,
): RiesgoDia {
  const senales: Senal[] = [];
  const noEvaluado: string[] = [LEYENDA_NOM_087];

  if (sinRegistroDeclarado(jornada)) {
    return {
      veredicto: 'sin_registro_declarado',
      senales,
      tipoJornada: null,
      horasExtraordinarias: null,
      noEvaluado,
    };
  }

  // El inicio y el fin de procedencias distintas no invalidan el día, pero el
  // que lo lea tiene que saberlo antes de sacar conclusiones de la resta.
  if (jornada.mezclada && jornada.inicio && jornada.fin) {
    senales.push({
      clase: 'procedencia_mezclada',
      esExceso: false,
      dice:
        'El inicio y el fin de este día vienen de fuentes distintas ' +
        `(${jornada.inicio.procedencia} y ${jornada.fin.procedencia}). ` +
        'La diferencia entre los dos no es una sola medición.',
      fundamento: null,
    });
  }

  if (jornada.minutosBrutos === null || jornada.inicio === null || jornada.fin === null) {
    return { veredicto: 'dato_insuficiente', senales, tipoJornada: null, horasExtraordinarias: null, noEvaluado };
  }

  const clasificacion = clasificarJornadaLFT60(new Date(jornada.inicio.momento), new Date(jornada.fin.momento));
  if (clasificacion === null) {
    return { veredicto: 'dato_insuficiente', senales, tipoJornada: null, horasExtraordinarias: null, noEvaluado };
  }

  // ── QUÉ CIFRA SE COMPARA CONTRA EL TOPE ─────────────────────────────────
  //
  // La jornada es «el tiempo durante el cual el trabajador está a disposición
  // del patrón» (art. 58). Un descanso del que puede salir no es jornada; uno
  // del que NO puede salir sí lo es, y se computa como tiempo efectivo (art.
  // 64). Likida no tiene forma de saber cuál de los dos fue: no sabe si el
  // chofer podía irse de la caseta donde comió.
  //
  // Así que se compara la cifra que le da la RAZÓN AL PATRÓN cuando hay
  // descansos registrados (los efectivos), y si con los descansos adentro el
  // día SÍ rebasaría, se dice — con el artículo — en vez de esconderlo. El
  // contralor decide, que es quien conoce las condiciones del descanso.
  const minutosEvaluados = jornada.minutosEfectivos ?? jornada.minutosBrutos;
  const topeDiarioMin = TOPE_DIARIO_LFT_68_HORAS * 60;

  if (minutosEvaluados > topeDiarioMin) {
    senales.push({
      clase: 'exceso_tope_diario_lft_68',
      esExceso: true,
      dice:
        `La jornada registrada es de ${HORAS(minutosEvaluados)} h y rebasa el tope de ` +
        `${TOPE_DIARIO_LFT_68_HORAS} h diarias.`,
      fundamento: 'LFT art. 68, último párrafo: la suma de las jornadas ordinaria y extraordinaria en ningún caso podrá ser mayor a doce horas diarias.',
    });
  } else if (
    jornada.minutosEfectivos !== null
    && jornada.minutosBrutos > topeDiarioMin
  ) {
    // Con los descansos descontados no rebasa; con ellos adentro, sí.
    senales.push({
      clase: 'descanso_pudo_contar_lft_64',
      esExceso: false,
      dice:
        `Descontando los descansos son ${HORAS(jornada.minutosEfectivos)} h y no rebasa el tope; ` +
        `de punta a punta son ${HORAS(jornada.minutosBrutos)} h y sí lo rebasaría. ` +
        'Si el operador no podía salir durante esos descansos, cuentan como jornada efectiva y el día está excedido.',
      fundamento: 'LFT art. 64: cuando el trabajador no pueda salir del lugar donde presta sus servicios durante las horas de reposo o de comidas, el tiempo correspondiente le será computado como tiempo efectivo de la jornada.',
    });
  }

  // ── EL TIEMPO EXTRAORDINARIO (observación, no alerta) ───────────────────
  const topeOrdinarioMin = clasificacion.topeOrdinarioHoras * 60;
  const extraordinarioMin = Math.max(0, minutosEvaluados - topeOrdinarioMin);
  if (extraordinarioMin > 0) {
    senales.push({
      clase: 'tiempo_extraordinario',
      esExceso: false,
      dice:
        `Jornada ${clasificacion.tipo}: ${HORAS(extraordinarioMin)} h por encima de las ` +
        `${clasificacion.topeOrdinarioHoras} h ordinarias. No es una infracción: es tiempo extraordinario, ` +
        'y la ley manda pagarlo con un cien por ciento más.',
      fundamento: 'LFT art. 61 (ocho horas la diurna, siete la nocturna, siete y media la mixta) y art. 66.',
    });
  }

  // ── EL DESCANSO DEL ART. 63 ─────────────────────────────────────────────
  if (jornada.minutosDescanso === null) {
    // NO se afirma que no descansó. Se dice que nadie lo anotó.
    senales.push({
      clase: 'sin_descanso_registrado',
      esExceso: false,
      dice:
        'No hay descanso registrado en este día. Eso no significa que no lo hubo: ' +
        'significa que nadie lo anotó, y sin el dato no se puede evaluar el descanso de ley.',
      fundamento: 'LFT art. 63: durante la jornada continua se concederá al trabajador un descanso de media hora, por lo menos.',
    });
  } else if (jornada.minutosDescanso < DESCANSO_MINIMO_LFT_63_MINUTOS) {
    senales.push({
      clase: 'descanso_bajo_minimo_lft_63',
      esExceso: true,
      dice:
        `El descanso registrado suma ${jornada.minutosDescanso} min, por debajo de los ` +
        `${DESCANSO_MINIMO_LFT_63_MINUTOS} min mínimos de la jornada continua.`,
      fundamento: 'LFT art. 63.',
    });
  }

  // ── EL UMBRAL PROPIO DE LA FLOTA ────────────────────────────────────────
  if (politica?.horasMaxJornada != null && minutosEvaluados > politica.horasMaxJornada * 60) {
    senales.push({
      clase: 'exceso_tope_flota',
      esExceso: true,
      dice:
        `La jornada de ${HORAS(minutosEvaluados)} h rebasa el tope de ${politica.horasMaxJornada} h ` +
        'que esta flota declaró para sí misma.',
      fundamento: politica.fundamento
        ? `Fundamento declarado por la flota: ${politica.fundamento}`
        : null,
    });
  }
  if (
    politica?.minutosMinDescanso != null
    && jornada.minutosDescanso !== null
    && jornada.minutosDescanso < politica.minutosMinDescanso
  ) {
    senales.push({
      clase: 'descanso_bajo_minimo_lft_63',
      esExceso: true,
      dice:
        `El descanso de ${jornada.minutosDescanso} min queda por debajo de los ` +
        `${politica.minutosMinDescanso} min que esta flota declaró para sí misma.`,
      fundamento: politica.fundamento
        ? `Fundamento declarado por la flota: ${politica.fundamento}`
        : null,
    });
  }

  // ── UNA COTA INFERIOR PRUEBA EL EXCESO Y NO LO DESCARTA ─────────────────
  //
  // Un inicio derivado de la primera posición del GPS —o del momento en que
  // aceptó el viaje— NO es la hora en que el operador empezó a trabajar: es lo
  // más temprano que Likida puede demostrar. La jornada real fue esa o MÁS
  // larga.
  //
  // La consecuencia lógica es asimétrica, y el motor la respeta: si con la cota
  // ya se rebasa el tope, la jornada real también lo rebasa —el exceso queda
  // probado—. Si con la cota no se rebasa, no se concluye nada: pudo rebasarse
  // con la hora verdadera. Por eso un día con puntas derivadas jamás sale como
  // `sin_senal_de_exceso`; sale como `dato_insuficiente`, con esta señal
  // diciendo exactamente qué falta.
  const derivadas = [jornada.inicio, jornada.fin].filter(
    (a) => a !== null && (a.procedencia === 'gps' || a.procedencia === 'hito_viaje'),
  );
  const hayExceso = senales.some((s) => s.esExceso);
  if (derivadas.length > 0 && !hayExceso) {
    senales.push({
      clase: 'cota_inferior_derivada',
      esExceso: false,
      dice:
        'El inicio o el fin de este día no los declaró el operador: se derivaron del GPS o de un ' +
        'hito del viaje, y eso solo acota la jornada por abajo. Con esos datos se puede demostrar ' +
        'un exceso, pero no descartarlo. Pídele al operador que declare sus horas, o captúralas aquí.',
      fundamento: null,
    });
    return {
      veredicto: 'dato_insuficiente',
      senales,
      tipoJornada: clasificacion.tipo,
      horasExtraordinarias: HORAS(extraordinarioMin),
      noEvaluado,
    };
  }

  return {
    veredicto: hayExceso ? 'exceso' : 'sin_senal_de_exceso',
    senales,
    tipoJornada: clasificacion.tipo,
    horasExtraordinarias: HORAS(extraordinarioMin),
    noEvaluado,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LA SEMANA — y por qué se niega a concluir con huecos.
// ═══════════════════════════════════════════════════════════════════════════

export interface DiaDeSemana {
  /** AAAA-MM-DD, día de México. */
  dia: string;
  jornada: JornadaCompuesta;
}

export interface RiesgoSemana {
  /** El año calendario contra cuya tabla de transitorios se comparó. */
  anio: number;
  /** El tope aplicable, o `null` si ninguna fuente lo respalda para ese año. */
  topeOrdinariaHoras: number | null;
  /** Horas medidas de la semana. `null` si algún día no se pudo medir. */
  horasMedidas: number | null;
  /** Días de la ventana que no se pudieron medir. Su sola existencia es la
   *  razón por la que `horasMedidas` puede venir en `null`. */
  diasSinDato: string[];
  senales: Senal[];
  veredicto: Veredicto;
}

/**
 * Evalúa una semana (o la ventana que se le pase). El año lo decide el PRIMER
 * día de la ventana: la tabla del Transitorio Segundo cambia «a partir del 1 de
 * enero», y una semana a caballo entre dos años se evalúa contra el año en que
 * empezó — el criterio conservador, porque el tope del año anterior es siempre
 * el más alto de los dos.
 *
 * UNA SEMANA CON HUECOS NO SE CONCLUYE. Si un solo día no se pudo medir, las
 * horas de la semana son `null` y el veredicto es `dato_insuficiente`: sumar
 * los días que sí se midieron y compararlo contra el tope semanal daría siempre
 * un total MENOR al real, o sea, un falso «va bien» construido con los huecos.
 */
export function evaluarRiesgoSemana(
  dias: readonly DiaDeSemana[],
  politica: PoliticaFlota | null,
): RiesgoSemana {
  const senales: Senal[] = [];
  const primerDia = dias.length > 0 ? dias[0].dia : null;
  const anio = primerDia ? Number(primerDia.slice(0, 4)) : Number.NaN;
  const tope = Number.isFinite(anio) ? topeSemanalDelAnio(anio) : null;

  const diasSinDato = dias.filter((d) => d.jornada.minutosBrutos === null).map((d) => d.dia);

  if (diasSinDato.length > 0 || dias.length === 0) {
    return {
      anio,
      topeOrdinariaHoras: tope?.ordinaria ?? null,
      horasMedidas: null,
      diasSinDato,
      senales,
      veredicto: 'dato_insuficiente',
    };
  }

  const minutos = dias.reduce(
    (s, d) => s + (d.jornada.minutosEfectivos ?? d.jornada.minutosBrutos ?? 0),
    0,
  );
  const horasMedidas = HORAS(minutos);

  if (tope === null) {
    // Sin tope verificado para ese año no hay contra qué comparar, y el
    // producto no inventa uno. Se reportan las horas y se dice por qué no hay
    // veredicto.
    return {
      anio,
      topeOrdinariaHoras: null,
      horasMedidas,
      diasSinDato,
      senales,
      veredicto: 'dato_insuficiente',
    };
  }

  if (horasMedidas > tope.ordinaria) {
    const extra = Math.round((horasMedidas - tope.ordinaria) * 100) / 100;
    senales.push({
      clase: 'exceso_semanal',
      esExceso: extra > tope.extra,
      dice:
        `La semana suma ${horasMedidas} h contra las ${tope.ordinaria} h ordinarias que aplican en ${anio}: ` +
        `${extra} h por encima. El tope de horas extra de ese año es ${tope.extra} h.` +
        (extra > tope.extra ? ' Las horas por encima rebasan también ese tope.' : ''),
      fundamento:
        'LFT art. 59 y Transitorios Segundo y Cuarto del decreto publicado en el DOF el 01-05-2026, ' +
        'que escalonan la jornada semanal y las horas extra por año calendario.',
    });
  }

  // ── EL DÍA DE DESCANSO DEL ART. 69 ──────────────────────────────────────
  // Solo se concluye si TODOS los días de la ventana se pudieron medir — y a
  // este punto ya sabemos que sí, porque arriba se devolvió si había huecos.
  const diasTrabajados = dias.filter((d) => d.jornada.minutosBrutos !== null && d.jornada.minutosBrutos > 0).length;
  if (dias.length > DIAS_TRABAJO_ANTES_DE_DESCANSO_LFT_69 && diasTrabajados > DIAS_TRABAJO_ANTES_DE_DESCANSO_LFT_69) {
    senales.push({
      clase: 'sin_dia_de_descanso_lft_69',
      esExceso: true,
      dice:
        `Se registraron ${diasTrabajados} días trabajados sin un día de descanso en la ventana. ` +
        'La ley pide al menos uno por cada seis.',
      fundamento: 'LFT art. 69: por cada seis días de trabajo se deberá otorgar, por lo menos, un día de descanso con goce de salario íntegro.',
    });
  }

  if (politica?.horasMinEntreJornadas != null) {
    const cortos = descansosEntreJornadasCortos(dias, politica.horasMinEntreJornadas);
    if (cortos.length > 0) {
      senales.push({
        clase: 'exceso_tope_flota',
        esExceso: true,
        dice:
          `Entre jornadas hubo menos de las ${politica.horasMinEntreJornadas} h que esta flota declaró ` +
          `para sí misma, en: ${cortos.join(', ')}.`,
        fundamento: politica.fundamento ? `Fundamento declarado por la flota: ${politica.fundamento}` : null,
      });
    }
  }

  return {
    anio,
    topeOrdinariaHoras: tope.ordinaria,
    horasMedidas,
    diasSinDato,
    senales,
    veredicto: senales.some((s) => s.esExceso) ? 'exceso' : 'sin_senal_de_exceso',
  };
}

/** Los días cuyo inicio quedó a menos de `horasMin` del fin del día anterior.
 *  Solo mira pares CONSECUTIVOS con las dos puntas: un hueco no produce
 *  conclusión. */
function descansosEntreJornadasCortos(dias: readonly DiaDeSemana[], horasMin: number): string[] {
  const cortos: string[] = [];
  for (let i = 1; i < dias.length; i++) {
    const finAnterior = dias[i - 1].jornada.fin;
    const inicioHoy = dias[i].jornada.inicio;
    if (!finAnterior || !inicioHoy) continue;
    const horas = (Date.parse(inicioHoy.momento) - Date.parse(finAnterior.momento)) / 3_600_000;
    if (Number.isFinite(horas) && horas >= 0 && horas < horasMin) cortos.push(dias[i].dia);
  }
  return cortos;
}

/** Atajo para quien tiene los asientos y no la jornada compuesta. */
export function evaluarDesdeAsientos(
  asientos: Parameters<typeof componerJornada>[0],
  politica: PoliticaFlota | null,
): RiesgoDia {
  return evaluarRiesgoDia(componerJornada(asientos), politica);
}

/** La leyenda que acompaña a cualquier presentación de estos veredictos. */
export const LEYENDA_VEREDICTOS = LEYENDA_SIN_DICTAMEN;

/** Cómo se nombra cada veredicto en pantalla. Cerrado a propósito: no existe
 *  un rótulo «cumple» que alguien pueda añadir sin tocar el tipo. */
export const ROTULO_VEREDICTO: Readonly<Record<Veredicto, string>> = {
  sin_registro_declarado: 'Sin registro declarado',
  dato_insuficiente: 'Dato insuficiente',
  exceso: 'Posible exceso',
  sin_senal_de_exceso: 'Sin señal de exceso en lo registrado',
};
