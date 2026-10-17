import { sinTenantsDePerfil } from '@/lib/auth/perfil_tenant';

// ═══════════════════════════════════════════════════════════════════════════
// El Conductor (A5) está en «Próximamente» para las flotas con perfil
// `cinco_agentes` (fase 1): el cron `conductor-hitos` NO les manda nada. Todas
// las pasadas del cron parten de una lista de viajes (o de candidatos que traen
// su viaje); aquí se les quitan las flotas a saltar ANTES de que la pasada
// decida nada. Sin flotas a saltar no cambia nada (misma lista).
//
// Las filas de `viaje_hito` que la siembra de la base (RPC) cree para esas
// flotas quedan sin avisos ni validaciones: nadie las recorre.
// ═══════════════════════════════════════════════════════════════════════════

type Saltar = ReadonlySet<string>;

/** Los puertos de una pasada que leen viajes: `viajesActivos` (motor, estadías, llegadas) o `viajes` (GPS, señal de vida). */
export function sinFlotasEnViajes<P extends object>(p: P, saltar: Saltar): P {
  if (saltar.size === 0) return p;
  const puertos = p as Record<string, unknown>;
  const envuelto: Record<string, unknown> = { ...puertos };
  for (const nombre of ['viajesActivos', 'viajes']) {
    const leer = puertos[nombre] as ((limite: number) => Promise<Array<{ tenantId: string }>>) | undefined;
    if (typeof leer === 'function') {
      envuelto[nombre] = async (limite: number) => sinTenantsDePerfil(await leer(limite), saltar, (v) => v.tenantId);
    }
  }
  // T-A5-66: las flotas con eventos huérfanos tampoco incluyen a las que están en «Próximamente».
  const flotas = puertos.flotasConHuerfanos as (() => Promise<string[]>) | undefined;
  if (typeof flotas === 'function') {
    envuelto.flotasConHuerfanos = async () => sinTenantsDePerfil(await flotas(), saltar, (t) => t);
  }
  return envuelto as P;
}

/** Candidatos que traen su flota directo (`tenantId`): sitio derivado, acercamiento. */
export function sinFlotasEnCandidatos<A extends unknown[], T extends { tenantId: string }>(
  leer: (...a: A) => Promise<T[]>, saltar: Saltar,
): (...a: A) => Promise<T[]> {
  if (saltar.size === 0) return leer;
  return async (...a: A) => sinTenantsDePerfil(await leer(...a), saltar, (c) => c.tenantId);
}

/** Candidatos de validación: la flota viene en `viaje.tenantId`. */
export function sinFlotasEnValidacion<A extends unknown[], T extends { viaje: { tenantId: string } }>(
  leer: (...a: A) => Promise<T[]>, saltar: Saltar,
): (...a: A) => Promise<T[]> {
  if (saltar.size === 0) return leer;
  return async (...a: A) => sinTenantsDePerfil(await leer(...a), saltar, (c) => c.viaje.tenantId);
}
