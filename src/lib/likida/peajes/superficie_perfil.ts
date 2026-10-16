// ═══════════════════════════════════════════════════════════════════════════
// SUPERFICIE DE PEAJES SEGÚN EL PERFIL DE LA FLOTA (T-A2-31).
//
// Bajo el perfil `cinco_agentes` el agente de peajes enseña y opera SOLO lo que la
// flota pidió (revisión de cobros contra los viajes, archivo decenal tal cual,
// candidatos, vínculos, reclamos). Lo demás es STAND-BY: el código sigue en el
// repo, pero la pantalla no lo pinta y el servidor no lo ejecuta.
//
//   · estimulo           — la ficha del estímulo de peaje (50 %) y su acreditable.
//   · cfdiYTickets       — el CFDI consolidado, la cola «esperan a un humano» (tickets de
//                          caseta de la mesa), el barrido y el KPI de estados de cuenta.
//   · bitacoraEstimulo   — las bitácoras del estímulo (RMF 9.1.8 y la conciliada).
//   · gps                — la evidencia GPS por línea, el estado conciliado con GPS, el reporte
//                          de reclamación con GPS y las geocercas.
//   · cursos             — corredores / cursos autorizados y convenios.
//
// El perfil solo QUITA (como en `perfil_tenant.ts`): sin perfil, todo igual que siempre.
// FALLA CERRADO: si el perfil no se puede leer, `perfilDeTenant` asume el restringido, y
// esta función hereda esa dirección. Diésel y urea no tienen superficie en peajes
// (spike documental T-A2-40): no hay nada que ocultar.
// ═══════════════════════════════════════════════════════════════════════════
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';

export interface SuperficiePeajes {
  estimulo: boolean;
  cfdiYTickets: boolean;
  bitacoraEstimulo: boolean;
  gps: boolean;
  cursos: boolean;
}

/** Sin perfil: comportamiento de siempre. */
export const SUPERFICIE_PEAJES_COMPLETA: SuperficiePeajes = Object.freeze({
  estimulo: true, cfdiYTickets: true, bitacoraEstimulo: true, gps: true, cursos: true,
});

/** Perfil `cinco_agentes`: lista cerrada, todo el stand-by apagado. */
export const SUPERFICIE_PEAJES_RESTRINGIDA: SuperficiePeajes = Object.freeze({
  estimulo: false, cfdiYTickets: false, bitacoraEstimulo: false, gps: false, cursos: false,
});

/** Pura: la superficie que corresponde a un perfil (`null` = flota sin perfil). */
export function superficiePeajesDePerfil(perfil: string | null): SuperficiePeajes {
  return perfil === null ? SUPERFICIE_PEAJES_COMPLETA : SUPERFICIE_PEAJES_RESTRINGIDA;
}

/** La superficie de una flota. Nunca lanza; sin poder leer el perfil, restringida (falla cerrado). */
export async function superficiePeajesDeTenant(tenantId: string | null | undefined): Promise<SuperficiePeajes> {
  return superficiePeajesDePerfil(await perfilDeTenant(tenantId));
}

/** Lo que dice una acción de servidor de stand-by cuando la flota tiene perfil. */
export const MOTIVO_STAND_BY_PERFIL = 'Esta función no está incluida en el plan de tu cuenta.';
