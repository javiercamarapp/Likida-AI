import { logger } from '@/lib/logger';
import { politicasDetencion } from '../estadias/lector';
import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from './config';
import { armarFilasEstadias, type ResultadoEstadiasPeriodo } from './estadias_lectura';
import { construirEstatus, type EstatusViaje } from './estatus_viaje';
import { evidenciaJornadaDeHitos, type EvidenciaJornada } from './jornada_hitos';
import { leerConfigConductor } from './repo';
import {
  leerDatosEstadias, leerEvidencias, leerHitosDeOperador, leerNombresSitiosDeViajes, leerVeredictos, leerViajeConHitos, type DatosEstadias, type EvidenciaFila, type FiltrosTablero, type VeredictoFila, type ViajeTablero,
} from './repo_validacion';
import type { HitoFila } from './tipos';
import { diaEnZona, inicioDiaEnZona, TZ_MX } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// LOS SERVICIOS INTERNOS que el Agente 5 le ofrece a los demás agentes. Todos reciben el TENANT
// primero y lo anclan en cada consulta: un id de viaje de otra flota es «no existe», nunca un dato.
//
//   estatusViaje(tenant, viaje)                 → el Vigía: último hito, siguiente hito con su ETA, andén.
//   estadiasDelPeriodo(tenant, desde, hasta)    → el cobro de estadías (CSV de /v1/estadias).
//   estadiasDeViaje(tenant, viaje)              → la liquidación: las estancias de UN viaje, con el pacto.
//   evidenciaJornadaDeViaje(tenant, operador…)  → el agente de jornada: el último hito del día (cota de fin).
// ═══════════════════════════════════════════════════════════════════════════

export interface DepsServicios {
  config(tenantId: string): Promise<ConfigConductor>;
  viajeConHitos(tenantId: string, viajeId: string): Promise<{ viaje: ViajeTablero; hitos: HitoFila[] } | null>;
  datosEstadias(tenantId: string, desde: Date, hasta: Date, f: FiltrosTablero): Promise<DatosEstadias>;
  politicas: typeof politicasDetencion;
  hitosDeOperador(tenantId: string, operadorId: string, desde: Date, hasta: Date): Promise<HitoFila[]>;
  /** Los veredictos de ubicación de UN viaje de esa flota (para saber qué llegadas siguen sin confirmar). Opcional: sin él, nada se da por confirmado. */
  veredictos?(tenantId: string, viajeId: string): Promise<VeredictoFila[]>;
  /** A39-S36-02: las fotos de UN viaje de esa flota y los nombres de sus sitios, para el anexo de la liquidación. Opcionales: sin ellos NO se afirma «sin fotos» (el anexo se omite). */
  evidencias?(tenantId: string, viajeId: string): Promise<EvidenciaFila[]>;
  sitios?(tenantId: string, viaje: ViajeTablero): Promise<Map<string, string>>;
}

export const depsServiciosReales: DepsServicios = {
  config: leerConfigConductor,
  viajeConHitos: leerViajeConHitos,
  datosEstadias: leerDatosEstadias,
  politicas: politicasDetencion,
  hitosDeOperador: leerHitosDeOperador,
  veredictos: (tenantId, viajeId) => leerVeredictos(tenantId, [viajeId]),
  evidencias: (tenantId, viajeId) => leerEvidencias(tenantId, [viajeId]),
  sitios: (tenantId, viaje) => leerNombresSitiosDeViajes(tenantId, [viaje]),
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function estatusViaje(tenantId: string, viajeId: string, ahora: Date = new Date(), d: DepsServicios = depsServiciosReales): Promise<EstatusViaje | null> {
  if (!UUID.test(viajeId)) return null;
  const datos = await d.viajeConHitos(tenantId, viajeId.toLowerCase());
  if (!datos) return null;
  // Un viaje de otra flota no sale de `viajeConHitos` (la consulta está anclada); se comprueba igual, por si un doble lo devolviera.
  const config = await d.config(tenantId).catch(() => ({ ...CONFIG_CONDUCTOR_DEFAULT }));
  // Los veredictos de ubicación: sin ellos (no se pueden leer) una llegada que solo dijo el chofer no se afirma como hecha.
  const lista = d.veredictos ? await d.veredictos(tenantId, viajeId.toLowerCase()).catch(() => null) : null;
  // Solo el veredicto del CICLO vigente de cada hito (una corrección retira el hito y deja el veredicto viejo en el historial).
  const ciclos = new Map(datos.hitos.map((h) => [h.id, h.ciclo]));
  const vigentes = new Map<string, { resultado: string; motivo: string | null }>();
  for (const f of lista ?? []) if (ciclos.get(f.hitoId) === f.ciclo) vigentes.set(f.hitoId, { resultado: f.resultado, motivo: f.motivo });
  return construirEstatus(datos.viaje, datos.hitos, config, ahora, vigentes);
}

export async function estadiasDelPeriodo(
  tenantId: string, desde: Date, hasta: Date, f: FiltrosTablero = {}, ahora: Date = new Date(), d: DepsServicios = depsServiciosReales,
): Promise<ResultadoEstadiasPeriodo> {
  const [datos, pol] = await Promise.all([d.datosEstadias(tenantId, desde, hasta, f), d.politicas(tenantId)]);
  return armarFilasEstadias(datos, ahora, pol);
}

/** Las estancias de UN viaje de ESA flota con el pacto de detención. `null` = el viaje no existe en esa flota. */
export async function estadiasDeViaje(
  tenantId: string, viajeId: string, ahora: Date = new Date(), d: DepsServicios = depsServiciosReales,
): Promise<ResultadoEstadiasPeriodo | null> {
  if (!UUID.test(viajeId)) return null;
  const datos = await d.viajeConHitos(tenantId, viajeId.toLowerCase());
  if (!datos || datos.viaje.id !== viajeId.toLowerCase()) return null;
  // A39-S36-02: antes se armaba con `veredictos: [], evidencias: [], sitios: new Map()` y el papel que se archiva decía SIEMPRE «sin fotos ·
  // sin veredicto de ubicación». Se leen de verdad; si no se pueden leer, LANZA (estadiasParaLiquidacion lo convierte en «sin anexo»):
  // afirmar «sin fotos» sin haber mirado es un documento archivado con respaldo falso.
  if (!d.veredictos || !d.evidencias || !d.sitios) throw new Error('estadiasDeViaje: faltan las lecturas de veredictos/evidencias/sitios');
  const id = viajeId.toLowerCase();
  const [pol, veredictos, evidencias, sitios] = await Promise.all([
    d.politicas(tenantId), d.veredictos(tenantId, id), d.evidencias(tenantId, id), d.sitios(tenantId, datos.viaje),
  ]);
  return armarFilasEstadias({ viajes: [datos.viaje], hitos: datos.hitos, veredictos, evidencias, sitios, truncada: false }, ahora, pol);
}

/**
 * Las estadías de UN viaje para el anexo del PDF de la liquidación (ejemplar del contralor). NUNCA lanza: el papel de
 * una liquidación jamás se pierde por no poder leer un anexo informativo; sin lectura, no hay anexo (`null`) y se loguea.
 */
export async function estadiasParaLiquidacion(
  tenantId: string, viajeId: string, ahora: Date = new Date(), d: DepsServicios = depsServiciosReales,
): Promise<ResultadoEstadiasPeriodo | null> {
  try {
    return await estadiasDeViaje(tenantId, viajeId, ahora, d);
  } catch (e) {
    logger.warn('conductor.estadias_para_liquidacion_fallo', { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export async function evidenciaJornadaDeViaje(
  tenantId: string, operadorId: string, dia: string, d: DepsServicios = depsServiciosReales,
): Promise<EvidenciaJornada> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new Error('evidenciaJornadaDeViaje: el día va como AAAA-MM-DD');
  // El día de la FLOTA (su `zonaHoraria`; México si no se pudo leer), no el UTC del servidor ni un -06:00 fijo (A37-S36-10).
  const zona = (await d.config(tenantId).catch(() => ({ ...CONFIG_CONDUCTOR_DEFAULT }))).zonaHoraria;
  const desde = inicioDiaEnZona(dia, zona);
  if (Number.isNaN(desde.getTime())) throw new Error('evidenciaJornadaDeViaje: el día no existe');
  const hitos = await d.hitosDeOperador(tenantId, operadorId, new Date(desde.getTime() - 3_600_000), new Date(desde.getTime() + 25 * 3_600_000));
  return evidenciaJornadaDeHitos(hitos.filter((h) => h.tenantId === tenantId), dia, zona);
}

export const hoyMxDia = (ahora: Date = new Date()): string => diaEnZona(ahora, TZ_MX);
