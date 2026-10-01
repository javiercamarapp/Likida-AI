import { politicasDetencion } from '../estadias/lector';
import { CONFIG_CONDUCTOR_DEFAULT, type ConfigConductor } from './config';
import { armarFilasEstadias, type ResultadoEstadiasPeriodo } from './estadias_lectura';
import { construirEstatus, type EstatusViaje } from './estatus_viaje';
import { evidenciaJornadaDeHitos, type EvidenciaJornada } from './jornada_hitos';
import { leerConfigConductor } from './repo';
import {
  leerDatosEstadias, leerHitosDeOperador, leerViajeConHitos, type DatosEstadias, type FiltrosTablero, type ViajeTablero,
} from './repo_validacion';
import type { HitoFila } from './tipos';
import { diaEnZona, TZ_MX } from '@/lib/formato';

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
}

export const depsServiciosReales: DepsServicios = {
  config: leerConfigConductor,
  viajeConHitos: leerViajeConHitos,
  datosEstadias: leerDatosEstadias,
  politicas: politicasDetencion,
  hitosDeOperador: leerHitosDeOperador,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function estatusViaje(tenantId: string, viajeId: string, ahora: Date = new Date(), d: DepsServicios = depsServiciosReales): Promise<EstatusViaje | null> {
  if (!UUID.test(viajeId)) return null;
  const datos = await d.viajeConHitos(tenantId, viajeId.toLowerCase());
  if (!datos) return null;
  // Un viaje de otra flota no sale de `viajeConHitos` (la consulta está anclada); se comprueba igual, por si un doble lo devolviera.
  const config = await d.config(tenantId).catch(() => ({ ...CONFIG_CONDUCTOR_DEFAULT }));
  return construirEstatus(datos.viaje, datos.hitos, config, ahora);
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
  const pol = await d.politicas(tenantId);
  return armarFilasEstadias(
    { viajes: [datos.viaje], hitos: datos.hitos, veredictos: [], evidencias: [], sitios: new Map(), truncada: false }, ahora, pol,
  );
}

export async function evidenciaJornadaDeViaje(
  tenantId: string, operadorId: string, dia: string, d: DepsServicios = depsServiciosReales,
): Promise<EvidenciaJornada> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new Error('evidenciaJornadaDeViaje: el día va como AAAA-MM-DD');
  // El día de MÉXICO, no el UTC del servidor (misma lección que el expediente de jornada).
  const desde = new Date(`${dia}T00:00:00-06:00`);
  const hitos = await d.hitosDeOperador(tenantId, operadorId, new Date(desde.getTime() - 3_600_000), new Date(desde.getTime() + 25 * 3_600_000));
  return evidenciaJornadaDeHitos(hitos.filter((h) => h.tenantId === tenantId), dia);
}

export const hoyMxDia = (ahora: Date = new Date()): string => diaEnZona(ahora, TZ_MX);
