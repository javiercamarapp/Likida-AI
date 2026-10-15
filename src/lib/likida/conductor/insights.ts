import type { FuenteHito, HitoFila } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// INSIGHTS DEL CONDUCTOR (T-A5-31) — reglas deterministas, SIN IA, sin I/O.
//
// Responde tres preguntas con números que se pueden defender (12 §F4, agente 5):
//   1. ¿cuántos hitos se registraron SIN intervención de la oficina?
//   2. ¿cuántos minutos pasan entre el evento y su registro?
//   3. ¿cuántas llamadas se evitaron? (solo con la línea base del cliente)
// y cuenta las excepciones y la escalera de avisos.
//
// DEFINICIONES (las mismas que ve el usuario en la pantalla):
//  • HITO SIN INTERVENCIÓN = hito registrado (estado recibido o validado) con fuente
//    sistema | boton | texto | ubicacion. Un hito con fuente `oficina` es una corrección
//    o captura de la oficina y NUNCA cuenta. Una fuente `foto` o desconocida no se
//    cuenta como «sin intervención» (la ficha no la incluye); se reporta aparte.
//  • MINUTOS ENTRE EVENTO Y REGISTRO — dos medidas que NO se mezclan:
//      GPS    = registrado_en − detectado_en de la tabla de cruces: el retraso del propio SISTEMA
//               (la muestra de GPS que prueba el cruce vs. la hora en que se registró).
//      CHOFER = recibido_en − mensaje_en: el retraso de ENTREGA del mensaje.
//               NO es telemetría del evento físico: el chofer pudo llegar antes de escribir (regla del 0380).
//    Un retraso negativo (reloj desordenado) se descarta y se cuenta, nunca se promedia.
//  • LLAMADAS EVITADAS = hitos sin intervención × consultas por hito de la línea base.
//    Es una ESTIMACIÓN y solo existe si hay línea base positiva; sin ella es `null`
//    y se muestra el mensaje que la pide. Nunca se inventa un porcentaje de ahorro.
//
// Cada cifra lleva su `fuente` (tabla/columna) y su rótulo: «medido» o «estimación».
// ═══════════════════════════════════════════════════════════════════════════

export type Rotulo = 'medido' | 'estimación';

export interface Cifra<T> {
  valor: T;
  /** De dónde sale: tabla.columna. */
  fuente: string;
  rotulo: Rotulo;
}

/** Fuentes que cuentan como «sin intervención» de la oficina. */
export const FUENTES_SIN_INTERVENCION: readonly FuenteHito[] = ['sistema', 'boton', 'texto', 'ubicacion'];

/** Fuentes en que el dato lo manda el chofer (tienen `mensaje_en`). */
const FUENTES_CHOFER: readonly FuenteHito[] = ['texto', 'boton', 'ubicacion', 'foto'];

export type HitoParaInsights = Pick<HitoFila, 'estado' | 'fuente' | 'mensajeEn' | 'recibidoEn'>;

/** Una fila de `viaje_cruce_geocerca`. */
export interface CruceParaInsights {
  detectadoEn: string;
  registradoEn: string;
}

/** Un episodio de señal de vida (`viaje_senal_vida`): solo lo que se cuenta. */
export interface EpisodioParaInsights {
  motivo: string;
  aviso1En: string | null;
  aviso2En: string | null;
  escaladoEn: string | null;
}

export interface LineaBase {
  /** Llamadas/consultas por viaje (u hito) que se hacían antes. Debe ser > 0. */
  llamadasPorViaje: number | null;
  /** Fecha (AAAA-MM-DD) en que el cliente la dio. */
  registradaEn: string | null;
}

export interface EntradaInsights {
  hitos: readonly HitoParaInsights[];
  cruces: readonly CruceParaInsights[];
  episodios: readonly EpisodioParaInsights[];
  /** Viajes que el GPS no pudo evaluar por no tener sitio asignado (contador de la corrida). `null` = no disponible. */
  viajesSinSitio: number | null;
  lineaBase: LineaBase | null;
}

export interface RetrasoMinutos {
  /** Promedio exacto en minutos; `null` si no hay ninguna medición válida. */
  promedioMin: number | null;
  mediciones: number;
  descartadas: number;
  fuente: string;
  rotulo: 'medido';
  /** Qué mide (y qué NO). */
  nota: string;
}

export interface InsightsConductor {
  hitosRegistrados: Cifra<number>;
  sinIntervencion: Cifra<number> & { porcentaje: number | null };
  /** Registrados con fuente oficina. */
  deOficina: Cifra<number>;
  /** Registrados con fuente foto o sin fuente: no cuentan como sin intervención ni como oficina. */
  otraFuente: Cifra<number>;
  retrasoGps: RetrasoMinutos;
  retrasoChofer: RetrasoMinutos;
  llamadasEvitadas: (Cifra<number | null> & { mensaje: string });
  excepciones: {
    sinRespuesta: Cifra<number>;
    sinSitio: Cifra<number | null>;
    sinSenal: Cifra<number>;
  };
  escalera: {
    aviso1: Cifra<number>;
    aviso2: Cifra<number>;
    jefe: Cifra<number>;
  };
}

export const MENSAJE_SIN_LINEA_BASE = 'Falta tu línea base: cuántas llamadas hacen hoy tus supervisores por viaje';

const resuelto = (h: HitoParaInsights) => h.estado === 'recibido' || h.estado === 'validado';

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

function promediar(pares: ReadonlyArray<readonly [string | null, string | null]>, fuente: string, nota: string): RetrasoMinutos {
  let suma = 0;
  let n = 0;
  let descartadas = 0;
  for (const [desde, hasta] of pares) {
    const a = ms(desde);
    const b = ms(hasta);
    if (a === null || b === null || b < a) { descartadas++; continue; }
    suma += (b - a) / 60_000;
    n++;
  }
  return { promedioMin: n > 0 ? suma / n : null, mediciones: n, descartadas, fuente, rotulo: 'medido', nota };
}

function fechaLegible(f: string | null): string {
  return f && /^\d{4}-\d{2}-\d{2}/.test(f) ? f.slice(0, 10) : 'fecha no registrada';
}

export function calcularInsights(e: EntradaInsights): InsightsConductor {
  const registrados = e.hitos.filter(resuelto);
  const sinInt = registrados.filter((h) => h.fuente !== null && FUENTES_SIN_INTERVENCION.includes(h.fuente));
  const deOficina = registrados.filter((h) => h.fuente === 'oficina');
  const otra = registrados.filter((h) => h.fuente === null || h.fuente === 'foto');

  // GPS y chofer en grupos separados: nunca se mezclan.
  const delChofer = registrados.filter((h) => h.fuente !== null && FUENTES_CHOFER.includes(h.fuente));

  const base = e.lineaBase;
  const hayBase = !!base && typeof base.llamadasPorViaje === 'number' && Number.isFinite(base.llamadasPorViaje) && base.llamadasPorViaje > 0;
  const llamadas: InsightsConductor['llamadasEvitadas'] = hayBase
    ? {
        valor: sinInt.length * (base!.llamadasPorViaje as number),
        fuente: 'viaje_hito.fuente × agente_conductor_config.linea_base_llamadas_por_viaje',
        rotulo: 'estimación',
        mensaje: `Estimación con tu línea base de ${fechaLegible(base!.registradaEn)}`,
      }
    : {
        valor: null,
        fuente: 'agente_conductor_config.linea_base_llamadas_por_viaje',
        rotulo: 'estimación',
        mensaje: MENSAJE_SIN_LINEA_BASE,
      };

  return {
    hitosRegistrados: { valor: registrados.length, fuente: 'viaje_hito.estado', rotulo: 'medido' },
    sinIntervencion: {
      valor: sinInt.length,
      fuente: 'viaje_hito.fuente',
      rotulo: 'medido',
      porcentaje: registrados.length > 0 ? Math.round((sinInt.length / registrados.length) * 1000) / 10 : null,
    },
    deOficina: { valor: deOficina.length, fuente: 'viaje_hito.fuente', rotulo: 'medido' },
    otraFuente: { valor: otra.length, fuente: 'viaje_hito.fuente', rotulo: 'medido' },
    retrasoGps: promediar(
      e.cruces.map((c) => [c.detectadoEn, c.registradoEn] as const),
      'viaje_cruce_geocerca.registrado_en − detectado_en',
      'Retraso del propio sistema entre la muestra de GPS que prueba el cruce y su registro.',
    ),
    retrasoChofer: promediar(
      delChofer.map((h) => [h.mensajeEn, h.recibidoEn] as const),
      'viaje_hito.recibido_en − mensaje_en',
      'Retraso de entrega del mensaje del chofer; no mide cuándo ocurrió el evento físico.',
    ),
    llamadasEvitadas: llamadas,
    excepciones: {
      sinRespuesta: { valor: e.hitos.filter((h) => h.estado === 'escalado').length, fuente: 'viaje_hito.estado = escalado', rotulo: 'medido' },
      sinSitio: { valor: e.viajesSinSitio, fuente: 'corrida del GPS: viajes sin sitio asignado', rotulo: 'medido' },
      sinSenal: { valor: e.episodios.length, fuente: 'viaje_senal_vida', rotulo: 'medido' },
    },
    escalera: {
      aviso1: { valor: e.episodios.filter((x) => x.aviso1En !== null).length, fuente: 'viaje_senal_vida.aviso_1_en', rotulo: 'medido' },
      aviso2: { valor: e.episodios.filter((x) => x.aviso2En !== null).length, fuente: 'viaje_senal_vida.aviso_2_en', rotulo: 'medido' },
      jefe: { valor: e.episodios.filter((x) => x.escaladoEn !== null).length, fuente: 'viaje_senal_vida.escalado_en', rotulo: 'medido' },
    },
  };
}
