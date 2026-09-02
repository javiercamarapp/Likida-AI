import { TZ_MX } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// LOS ÚNICOS NÚMEROS DE HORAS QUE ESTE PRODUCTO PUEDE CITAR.
//
// Cada constante de este archivo está transcrita del texto vigente de la Ley
// Federal del Trabajo (última reforma DOF 14-05-2026) y verificada contra
// diputados.gob.mx. Su ficha es `normas/lft-132-XXXIV-jornada.yaml`, y ahí está
// el texto literal de cada artículo. Si un número no tiene artículo al lado, no
// entra aquí: la regla de la casa es que una cifra sin fuente no se afirma.
//
// ── LO QUE ESTE ARCHIVO DELIBERADAMENTE NO TRAE ──────────────────────────
//
// No trae los tiempos de conducción de la NOM-087-SCT-2-2017 (30 minutos de
// pausa por cada cinco horas continuas, máximo 14 horas de conducción en 24).
// Están verificados —ver `normas/nom-087-sct-2-2017.yaml`— y aun así el motor
// NO los evalúa, porque no puede: la NOM mide CONDUCCIÓN EFECTIVA y Likida
// registra JORNADA, que el art. 58 de la LFT define como el tiempo a
// disposición del patrón, esté o no al volante. De las diez horas de un día
// Likida no sabe cuántas fueron carretera y cuántas fueron esperar andén.
//
// Estimarlo desde el GPS sería inventar el dato que decide la alerta. Así que
// el producto se calla y DICE que se calla, con `LEYENDA_NOM_087`. Un «cumple»
// falso es peor que un hueco declarado — y este hueco tiene nombre, artículo y
// motivo.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * El tope DURO del día. LFT art. 68, último párrafo, texto vigente:
 * «La suma de las jornadas ordinaria y extraordinaria, en ningún caso podrá
 * ser mayor a doce horas diarias.»
 *
 * Es el único tope diario absoluto de la ley y no depende del tipo de jornada.
 * Rebasarlo es lo que el motor sí llama EXCESO.
 */
export const TOPE_DIARIO_LFT_68_HORAS = 12;

/**
 * El tope de la jornada ORDINARIA por día, LFT art. 61: «La duración de la
 * jornada diaria será de ocho horas la diurna, siete la nocturna y siete horas
 * y media la mixta.»
 *
 * OJO CON LEERLO COMO UN LÍMITE LEGAL DURO: no lo es. Rebasarlo no es una
 * infracción por sí mismo — significa que hubo TIEMPO EXTRAORDINARIO, que la
 * ley permite (arts. 66 y 68) y manda pagar al doble. Por eso el motor lo
 * reporta como observación, no como exceso.
 */
export const TOPE_ORDINARIO_LFT_61_HORAS: Readonly<Record<TipoJornadaLFT, number>> = {
  diurna: 8,
  nocturna: 7,
  mixta: 7.5,
};

/**
 * LFT art. 63: «Durante la jornada continua de trabajo se concederá al
 * trabajador un descanso de media hora, por lo menos.»
 */
export const DESCANSO_MINIMO_LFT_63_MINUTOS = 30;

/** LFT art. 69: un día de descanso por cada seis de trabajo. */
export const DIAS_TRABAJO_ANTES_DE_DESCANSO_LFT_69 = 6;

/** El tipo de jornada del art. 60, que decide cuál tope del 61 aplica. */
export type TipoJornadaLFT = 'diurna' | 'nocturna' | 'mixta';

// ── LAS VENTANAS DE RELOJ DEL ART. 60, EN MINUTOS DESDE MEDIANOCHE ─────────
// «Jornada diurna es la comprendida entre las seis y las veinte horas. Jornada
// nocturna es la comprendida entre las veinte y las seis horas.»
const INICIO_DIURNA_MIN = 6 * 60;   // 06:00
const FIN_DIURNA_MIN = 20 * 60;     // 20:00

/**
 * «…siempre que el período nocturno sea menor de tres horas y media, pues si
 * comprende tres y media o más, se reputará jornada nocturna.» (art. 60)
 */
const NOCTURNO_QUE_VUELVE_NOCTURNA_MIN = 3.5 * 60;

/**
 * EL TOPE SEMANAL NO ES EL DEL ARTÍCULO, Y ÉSTE ES EL ERROR MÁS FÁCIL DE
 * COMETER CON LA REFORMA DEL 01-05-2026.
 *
 * El art. 59 vigente ya dice cuarenta horas semanales y el 66 ya dice doce
 * horas extras. Pero los Transitorios Segundo y Cuarto del propio decreto los
 * escalonan por AÑO CALENDARIO, «a partir del 1 de enero» de cada uno:
 *
 *     año | ordinaria semanal | extras semanales
 *     2026|        48         |        9
 *     2027|        46         |        9
 *     2028|        44         |       10
 *     2029|        42         |       11
 *     2030|        40         |       12
 *
 * Un motor que hardcodee 40 estaría marcando en rojo, hoy, a una flota que va
 * en regla — y esa alerta falsa es exactamente lo que la casa prohíbe.
 *
 * ANTES DE 2026 NO HAY ENTRADA, Y ES A PROPÓSITO: el régimen anterior a la
 * reforma no se verificó en esta ronda, así que el motor no lo afirma. Un día
 * de 2025 se reporta con sus horas medidas y SIN veredicto semanal.
 */
export const TOPE_SEMANAL_POR_ANIO: Readonly<Record<number, { ordinaria: number; extra: number }>> = {
  2026: { ordinaria: 48, extra: 9 },
  2027: { ordinaria: 46, extra: 9 },
  2028: { ordinaria: 44, extra: 10 },
  2029: { ordinaria: 42, extra: 11 },
  2030: { ordinaria: 40, extra: 12 },
};

/** El primer año que la tabla de transitorios cubre. */
export const PRIMER_ANIO_CON_TOPE_SEMANAL = 2026;
/** El año en que el escalonamiento alcanza el texto del artículo. */
export const ANIO_REGIMEN_PLENO = 2030;

/**
 * El tope semanal aplicable a un año, o `null` si ninguna fuente lo respalda.
 *
 * De 2030 en adelante rige el texto del artículo (40 ordinarias, 12 extras),
 * que es donde el escalonamiento termina. Antes de 2026, `null`: no se
 * verificó el régimen anterior y el producto no inventa uno.
 */
export function topeSemanalDelAnio(anio: number): { ordinaria: number; extra: number } | null {
  if (!Number.isInteger(anio)) return null;
  if (anio < PRIMER_ANIO_CON_TOPE_SEMANAL) return null;
  if (anio >= ANIO_REGIMEN_PLENO) return TOPE_SEMANAL_POR_ANIO[ANIO_REGIMEN_PLENO];
  return TOPE_SEMANAL_POR_ANIO[anio] ?? null;
}

// ── LAS LEYENDAS QUE EL PRODUCTO PONE POR ESCRITO ─────────────────────────
//
// No son texto de UI que se pueda reescribir al gusto: son las frases con las
// que Likida declara los límites de lo que afirma. Viven aquí, junto a las
// cifras que sí puede citar, para que quien cambie una vea la otra.

/** Lo que se dice de la NOM-087 — que no se evalúa, y por qué. */
export const LEYENDA_NOM_087 =
  'Este registro mide jornada, no tiempo de conducción. Los tiempos de la ' +
  'NOM-087-SCT-2-2017 se miden sobre conducción efectiva, que Likida no ' +
  'registra: no se emite juicio sobre ellos.';

/** Lo que se dice del reporte exportable — que no es la bitácora del art. 83. */
export const LEYENDA_NO_ES_BITACORA_83 =
  'Este documento es el registro de jornada del artículo 132 fracción XXXIV de ' +
  'la Ley Federal del Trabajo. NO es la bitácora de horas de servicio del ' +
  'artículo 83 del Reglamento de Tránsito en Carreteras y Puentes de ' +
  'Jurisdicción Federal, que exige diez campos que Likida no tiene (placas del ' +
  'vehículo, número y vigencia de la licencia, ruta, y las firmas del conductor ' +
  'y del permisionario).';

/** Lo que se dice de los veredictos — que Likida no dictamina cumplimiento. */
export const LEYENDA_SIN_DICTAMEN =
  'Likida registra lo que ocurrió y avisa de lo que parece un exceso. No ' +
  'certifica cumplimiento legal ni da asesoría jurídica: quien dictamina si la ' +
  'flota cumple es su abogado o su contador.';

/**
 * LA FRASE DEL DÍA SIN DATO. Es la que más importa de este archivo.
 *
 * Un día sin marcas NO es un día de cero horas, y la diferencia no es de
 * matiz: en un juicio, «cero horas» es una afirmación del patrón sobre la
 * jornada del trabajador, y si es falsa, la firmó él.
 */
export const FRASE_SIN_REGISTRO =
  'Sin registro declarado: el operador no reportó y Likida no tuvo de dónde ' +
  'derivarlo. No son cero horas.';

/** Cuando hay una punta pero falta la otra. */
export const FRASE_REGISTRO_INCOMPLETO =
  'Registro incompleto: falta una de las dos marcas del día. No se estima la ' +
  'hora que falta.';

/** Los dos plazos de conservación, que son distintos y se enseñan por separado. */
export const CONSERVACION_NOM_087_ANIOS = 2;
export const CONSERVACION_LFT_804 =
  'El control de asistencia se conserva durante el último año y un año después ' +
  'de que se extinga la relación laboral (LFT art. 804). La bitácora de horas ' +
  'de servicio, al menos dos años (NOM-087-SCT-2-2017, numeral 8.5). Son dos ' +
  'plazos distintos.';

// ── EL RELOJ DE MÉXICO ────────────────────────────────────────────────────

/**
 * Minuto del día (0-1439) en hora de México. La clasificación del art. 60 es
 * por RELOJ DE PARED —«entre las seis y las veinte horas»— y el reloj del
 * trabajador es el suyo, no el UTC del servidor: una jornada de 19:30 a 03:00
 * en Mérida se clasificaría al revés leyéndola en UTC.
 */
export function minutoDelDiaMx(fecha: Date): number {
  const partes = new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ_MX, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(fecha);
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? '0');
  const minuto = Number(partes.find((p) => p.type === 'minute')?.value ?? '0');
  // `hour12: false` puede rendir "24" a la medianoche en algunos runtimes.
  return ((hora % 24) * 60) + minuto;
}

/** Duración máxima que este módulo acepta clasificar. Una jornada de más de
 *  24 h no es una jornada larga: es un par de marcas mal capturadas, y
 *  clasificarla daría un tipo inventado. */
export const MAX_MINUTOS_JORNADA = 24 * 60;

export interface ClasificacionJornada {
  tipo: TipoJornadaLFT;
  minutosDiurnos: number;
  minutosNocturnos: number;
  /** El tope ordinario del art. 61 que corresponde a este tipo, en horas. */
  topeOrdinarioHoras: number;
}

/**
 * Clasifica la jornada según el art. 60 de la LFT y devuelve, con ella, el
 * tope ordinario del art. 61 que le toca.
 *
 * `null` cuando no se puede clasificar sin inventar: sin las dos puntas, con
 * el fin antes del inicio, o con una duración mayor a 24 horas. En esos casos
 * el motor NO adivina un tipo — dice que el registro no alcanza.
 *
 * ── EL CONTEO ES MINUTO A MINUTO, Y ESO ES DELIBERADO ────────────────────
 * La alternativa (aritmética de intervalos contra las dos ventanas) es más
 * corta y se equivoca en los casos que importan: la jornada que cruza la
 * medianoche, la que empieza y termina dentro del mismo tramo nocturno, la
 * que da la vuelta completa al reloj. Mil cuatrocientas cuarenta iteraciones
 * como techo es un costo que no se nota y una lectura que cualquiera puede
 * comprobar contra el texto del artículo.
 */
export function clasificarJornadaLFT60(inicio: Date, fin: Date): ClasificacionJornada | null {
  const inicioMs = inicio.getTime();
  const finMs = fin.getTime();
  if (!Number.isFinite(inicioMs) || !Number.isFinite(finMs)) return null;

  const duracionMin = Math.round((finMs - inicioMs) / 60_000);
  if (duracionMin <= 0) return null;
  if (duracionMin > MAX_MINUTOS_JORNADA) return null;

  const arranque = minutoDelDiaMx(inicio);
  let minutosNocturnos = 0;
  for (let m = 0; m < duracionMin; m++) {
    const reloj = (arranque + m) % 1440;
    // Nocturno = [20:00, 24:00) ∪ [00:00, 06:00), que es «entre las veinte y
    // las seis» del art. 60 leído como el complemento del tramo diurno.
    if (reloj >= FIN_DIURNA_MIN || reloj < INICIO_DIURNA_MIN) minutosNocturnos++;
  }
  const minutosDiurnos = duracionMin - minutosNocturnos;

  const tipo: TipoJornadaLFT =
    minutosNocturnos === 0 ? 'diurna'
      : minutosDiurnos === 0 ? 'nocturna'
        // «si comprende tres y media o más, se reputará jornada nocturna»
        : minutosNocturnos >= NOCTURNO_QUE_VUELVE_NOCTURNA_MIN ? 'nocturna'
          : 'mixta';

  return {
    tipo,
    minutosDiurnos,
    minutosNocturnos,
    topeOrdinarioHoras: TOPE_ORDINARIO_LFT_61_HORAS[tipo],
  };
}
