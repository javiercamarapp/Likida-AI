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

// ═══════════════════════════════════════════════════════════════════════════
// LAS 12 PLANTILLAS DEL CICLO CON BOTONES (T-A5-59; N01–N12 de la reunión del 15-oct). Aquí vive lo que NO es texto de la
// plantilla: su prioridad, qué perfil la exige y en qué estado está ante el proveedor (Meta). Nada de esto llama a Meta.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que el proveedor (Meta) dice de la plantilla. Se actualiza a mano cuando Javier crea, Meta aprueba o rechaza. */
export type EstadoProveedor = 'no_enviada' | 'pendiente' | 'aprobada' | 'rechazada';

/** `piloto` = perfil del piloto (solo lo P0); `cinco_agentes` = perfil de los cinco agentes (P0 y P1). La P2 es opcional. */
export type PerfilPlantillas = 'piloto' | 'cinco_agentes';

export interface PlantillaCiclo { codigo: string; nombre: string; prioridad: 'P0' | 'P1' | 'P2' }

export const PLANTILLAS_CICLO: readonly PlantillaCiclo[] = [
  { codigo: 'N01', nombre: 'viaje_asignado_confirmar_v1', prioridad: 'P0' },
  { codigo: 'N02', nombre: 'viaje_instrucciones_ruta_v1', prioridad: 'P0' },
  { codigo: 'N03', nombre: 'viaje_gastos_etc_v1', prioridad: 'P1' },
  { codigo: 'N04', nombre: 'conductor_foto_sello_v1', prioridad: 'P0' },
  { codigo: 'N05', nombre: 'conductor_detencion_sin_aviso_v1', prioridad: 'P0' },
  { codigo: 'N06', nombre: 'conductor_confirma_patio_v1', prioridad: 'P0' },
  { codigo: 'N07', nombre: 'conductor_estadia_descarga_v1', prioridad: 'P1' },
  { codigo: 'N08', nombre: 'aviso_supervisor_patio_distinto_v1', prioridad: 'P0' },
  { codigo: 'N09', nombre: 'aviso_supervisor_estadia_descarga_v1', prioridad: 'P0' },
  { codigo: 'N10', nombre: 'aviso_supervisor_caja_cargada_v1', prioridad: 'P1' },
  { codigo: 'N11', nombre: 'conductor_pedir_evidencia_v1', prioridad: 'P1' },
  { codigo: 'N12', nombre: 'conductor_llegada_detectada_v1', prioridad: 'P2' },
];

/**
 * Estado ante Meta de cada una de las 12, según lo asentado por Javier el 15-oct (RESPUESTAS-javier.md: 7 enviadas a revisión,
 * aprobadas ese mismo día). Las otras 5 esperan respuestas del cliente (gastos/ETC, estadía, caja cargada, evidencia, llegada
 * detectada). NO se consulta a Meta desde aquí: `scripts/verificar-plantillas-meta.ts --consultar` lo contrasta. Si una se
 * rechaza o su texto cambia, se corrige el catálogo con nombre nuevo (`siguienteVersion`) y se marca aquí la nueva.
 */
export const ESTADO_PROVEEDOR_CICLO: Readonly<Record<string, EstadoProveedor>> = {
  viaje_asignado_confirmar_v1: 'aprobada',
  viaje_instrucciones_ruta_v1: 'aprobada',
  viaje_gastos_etc_v1: 'no_enviada',
  conductor_foto_sello_v1: 'aprobada',
  conductor_detencion_sin_aviso_v1: 'aprobada',
  conductor_confirma_patio_v1: 'aprobada',
  conductor_estadia_descarga_v1: 'no_enviada',
  aviso_supervisor_patio_distinto_v1: 'aprobada',
  aviso_supervisor_estadia_descarga_v1: 'aprobada',
  aviso_supervisor_caja_cargada_v1: 'no_enviada',
  conductor_pedir_evidencia_v1: 'no_enviada',
  conductor_llegada_detectada_v1: 'no_enviada',
};

/** Las del ciclo que exige un perfil: piloto = P0; cinco_agentes = P0 y P1; la P2 no la exige ninguno. */
export function plantillasDelCicloPorPerfil(perfil: PerfilPlantillas): string[] {
  const admite = perfil === 'piloto' ? ['P0'] : ['P0', 'P1'];
  return PLANTILLAS_CICLO.filter((p) => admite.includes(p.prioridad)).map((p) => p.nombre);
}

/** Las del perfil que NO están aprobadas (vacío = el perfil puede encenderse en lo que a plantillas toca). */
export function faltantesPorAprobar(perfil: PerfilPlantillas, estados: Readonly<Record<string, EstadoProveedor>> = ESTADO_PROVEEDOR_CICLO): string[] {
  return plantillasDelCicloPorPerfil(perfil).filter((n) => estados[n] !== 'aprobada');
}

/** Regla de versionado: una plantilla aprobada no se edita; un cambio o un rechazo se reenvía con el sufijo siguiente (`_v2`). */
export function siguienteVersion(nombre: string): string {
  const m = /^(.*)_v(\d+)$/.exec(nombre);
  return m ? `${m[1]}_v${Number(m[2]) + 1}` : `${nombre}_v2`;
}

/**
 * Las plantillas que Meta ya aprobó: las 7 del ciclo asentadas por Javier el 15-oct (se derivan de `ESTADO_PROVEEDOR_CICLO`;
 * una prueba exige que sean del catálogo). Las demás del Conductor siguen «nueva para aprobación» en
 * docs/operacion/plantillas-meta.md. Javier marca aquí la aprobación cuando Meta la da.
 */
export const APROBADAS: readonly string[] = PLANTILLAS_CICLO.filter((p) => ESTADO_PROVEEDOR_CICLO[p.nombre] === 'aprobada').map((p) => p.nombre);

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
  const delCiclo = PLANTILLAS_CICLO.find((p) => p.nombre === nombre);
  if (delCiclo) {
    if (delCiclo.prioridad === 'P2') return 'Ciclo del chofer: opcional (ningún perfil la exige)';
    return delCiclo.prioridad === 'P0' ? 'Ciclo del chofer: piloto y cinco_agentes' : 'Ciclo del chofer: solo cinco_agentes';
  }
  const base: EntradaPlantillas = { perfilSeguimiento: 'esenciales', avisarSenalVida: false, solicitudesMin: [0, 1, 2, 3] };
  if ((PLANTILLAS_SENAL_VIDA as readonly string[]).includes(nombre)) return 'Ambos, si la señal de vida está encendida';
  if (plantillasRequeridas(base).includes(nombre)) return 'Esenciales y completo';
  if (plantillasRequeridas({ ...base, perfilSeguimiento: 'completo' }).includes(nombre)) return 'Solo completo';
  return '—';
}
