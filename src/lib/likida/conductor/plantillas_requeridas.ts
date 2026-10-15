import type { ConfigConductor } from './config';
import { HITOS_DEL_PERFIL } from './perfil';
import type { TipoHito } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// QUÉ PLANTILLAS DE META NECESITA UNA FLOTA (T-A5-24). Sin I/O, sin consultar a Meta.
//
// Fuera de la ventana de 24 h solo entra una plantilla APROBADA; mientras Meta no la apruebe el envío devuelve 132001 y el
// agente calla. Esta función dice, para una configuración, cuáles hay que tener aprobadas ANTES de encender al conductor, y
// las compara con la lista de las aprobadas (`APROBADAS`, que se actualiza a mano cuando Meta aprueba). Los nombres son los
// del catálogo (`src/lib/meta/plantillas_catalogo.ts`) y NO cambian: una plantilla aprobada no se edita.
// ═══════════════════════════════════════════════════════════════════════════

/** Plantilla con que se le pide (solicitud, nivel 0) cada hito; `llegada_carga` tiene dos según haya cita. Espejo de `solicitudes.ts`. */
export const PLANTILLAS_POR_HITO: Readonly<Record<TipoHito, readonly string[]>> = {
  llegada_carga: ['conductor_solicitud_llegada_carga_v1', 'conductor_llegada_carga_sin_cita_v1'],
  salida_carga: ['conductor_salida_carga_v1'],
  llegada_descarga: ['conductor_llegada_descarga_v1'],
  salida_descarga: ['conductor_salida_descarga_v1'],
  regreso: ['conductor_solicitud_regreso_v1'],
};

/** Los recordatorios del chofer (niveles 1 a 3 de la escalera). */
export const PLANTILLAS_RECORDATORIO = [
  'conductor_recordatorio_1_v1', 'conductor_recordatorio_2_v1', 'conductor_recordatorio_3_v1',
] as const;

/** El aviso al jefe de tráfico cuando la escalera del chofer se agota. */
export const PLANTILLA_AVISO_JEFE = 'aviso_jefe_trafico_v1';

/** Solo si `avisarSenalVida` está encendido: la pregunta al chofer y el aviso al jefe. */
export const PLANTILLAS_SENAL_VIDA = ['conductor_senal_vida_v1', 'aviso_jefe_senal_vida_v1'] as const;

/** Las que solo el ciclo completo usa además de las anteriores (contacto de andén y llegada sin confirmar). */
const PLANTILLAS_SOLO_COMPLETO = ['conductor_contacto_anden_v1', 'conductor_llegada_sin_confirmar_v1'] as const;

/**
 * Las plantillas del Conductor que Meta ya aprobó. HOY NINGUNA (docs/operacion/plantillas-meta.md: las 14 del Conductor están
 * «nueva para aprobación»). Javier agrega aquí el nombre cuando Meta la marca `APPROVED`; una prueba exige que sea del catálogo.
 */
export const APROBADAS: readonly string[] = [];

export type EntradaPlantillas = Pick<ConfigConductor, 'perfilSeguimiento' | 'avisarSenalVida' | 'solicitudesMin'>;

/** Los recordatorios que la escalera de `solicitudesMin` llega a mandar: el nivel 0 es la solicitud; del 1 al 3, recordatorios. */
function recordatoriosDeLaEscalera(solicitudesMin: readonly number[]): readonly string[] {
  const n = Math.min(Math.max(solicitudesMin.length - 1, 0), PLANTILLAS_RECORDATORIO.length);
  return PLANTILLAS_RECORDATORIO.slice(0, n);
}

/**
 * Las plantillas que hay que tener aprobadas para esta configuración, sin repetidas y en orden estable.
 *  · `completo`: las 12 del Conductor (los 5 hitos con sus variantes, 3 recordatorios, aviso al jefe, contacto de andén y
 *    llegada sin confirmar), pase lo que pase con la escalera: es el piso seguro para el ciclo entero.
 *  · `esenciales`: lo de los hitos del perfil (`salida_carga`), los recordatorios que la escalera usa y el aviso al jefe.
 *  · `avisarSenalVida` encendido suma las 2 de señal de vida en cualquier perfil.
 */
export function plantillasRequeridas(config: EntradaPlantillas): string[] {
  const lista: string[] = [];
  if (config.perfilSeguimiento === 'completo') {
    for (const p of Object.values(PLANTILLAS_POR_HITO).flat()) lista.push(p);
    lista.push(...PLANTILLAS_RECORDATORIO, PLANTILLA_AVISO_JEFE, ...PLANTILLAS_SOLO_COMPLETO);
  } else {
    for (const hito of HITOS_DEL_PERFIL[config.perfilSeguimiento]) lista.push(...PLANTILLAS_POR_HITO[hito]);
    lista.push(...recordatoriosDeLaEscalera(config.solicitudesMin), PLANTILLA_AVISO_JEFE);
  }
  if (config.avisarSenalVida) lista.push(...PLANTILLAS_SENAL_VIDA);
  return [...new Set(lista)];
}

export interface ComparacionPlantillas {
  requeridas: string[];
  aprobadas: string[];
  /** Las que faltan por aprobar: sin ellas el agente calla fuera de la ventana de 24 h. */
  faltantes: string[];
  lista: boolean;
}

export function compararConAprobadas(requeridas: readonly string[], aprobadas: readonly string[] = APROBADAS): ComparacionPlantillas {
  const ok = new Set(aprobadas);
  const faltantes = requeridas.filter((n) => !ok.has(n));
  return { requeridas: [...requeridas], aprobadas: requeridas.filter((n) => ok.has(n)), faltantes, lista: faltantes.length === 0 };
}

/** Texto copiable para pegarle a quien somete las plantillas a Meta: un nombre por línea. */
export function listaCopiableParaMeta(requeridas: readonly string[]): string {
  return requeridas.join('\n');
}

/** Para la columna «Perfil» del documento de plantillas: en qué perfil se necesita cada plantilla del Conductor. */
export function perfilDePlantilla(nombre: string): string {
  const base: EntradaPlantillas = { perfilSeguimiento: 'esenciales', avisarSenalVida: false, solicitudesMin: [0, 1, 2, 3] };
  if ((PLANTILLAS_SENAL_VIDA as readonly string[]).includes(nombre)) return 'Ambos, si la señal de vida está encendida';
  if (plantillasRequeridas(base).includes(nombre)) return 'Esenciales y completo';
  if (plantillasRequeridas({ ...base, perfilSeguimiento: 'completo' }).includes(nombre)) return 'Solo completo';
  return '—';
}
