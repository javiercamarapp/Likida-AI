import { tenantDemo } from '@/lib/auth/tenant-demo';
import { validarInsight } from './regla';
import type { Insight } from './tipos';

// T-INS-06 — «real / ejemplo / simulado»: de dónde viene lo que se ve en pantalla.
// Función pura y determinista; no cambia ninguna cifra, solo dice cómo rotularla.

export const ORIGENES = ['real', 'ejemplo', 'simulado'] as const;
export type Origen = (typeof ORIGENES)[number];

/** Tenant sintético del kit de demostración (datos inventados, sin relación con operación real). */
export const TENANT_SINTETICO_KIT = 'eeeeeeee-0620-4000-8000-000000000250';

/** Prefijos de folio y teléfono que el kit sintético usa; solo se miran al nivel de la fila. */
export const PREFIJO_FOLIO_SINTETICO = 'DEMO-';
export const PREFIJO_TELEFONO_SINTETICO = '28999';

export const TEXTO_BANDA: Record<Exclude<Origen, 'real'>, string> = {
  ejemplo: 'Estás viendo datos de ejemplo: no son de tu operación.',
  simulado: 'Estás viendo datos simulados: no son de tu operación.',
};

/** Fila mínima que `origenDe` sabe leer; cualquier otra columna se ignora. */
export interface FilaOrigen {
  tenant_id?: string | null;
  folio?: string | null;
  telefono?: string | null;
  origen?: string | null;
}

const PESO: Record<Origen, number> = { real: 0, ejemplo: 1, simulado: 2 };

/** El más «no real» manda: una sola fila de ejemplo/simulada rotula todo el conjunto. */
export function peorOrigen(...origenes: Origen[]): Origen {
  return origenes.reduce<Origen>((a, o) => (PESO[o] > PESO[a] ? o : a), 'real');
}

function origenDeTenant(tenantId: string | null | undefined): Origen {
  if (!tenantId) return 'real';
  const t = tenantId.toLowerCase();
  if (t === TENANT_SINTETICO_KIT) return 'simulado';
  if (t === tenantDemo().toLowerCase()) return 'ejemplo';
  return 'real';
}

function origenDeUnaFila(fila: FilaOrigen): Origen {
  if (fila.origen === 'ejemplo' || fila.origen === 'simulado') return fila.origen;
  if (typeof fila.folio === 'string' && fila.folio.startsWith(PREFIJO_FOLIO_SINTETICO)) return 'simulado';
  if (typeof fila.telefono === 'string' && fila.telefono.replace(/\D/g, '').replace(/^52/, '').startsWith(PREFIJO_TELEFONO_SINTETICO)) {
    return 'simulado';
  }
  return origenDeTenant(fila.tenant_id);
}

/**
 * Origen de lo que se muestra. `fila` puede ser una fila, varias (fila mezclada → manda la peor)
 * o nada (solo se juzga el tenant).
 */
export function origenDe(
  tenantId: string | null | undefined,
  fila?: FilaOrigen | readonly FilaOrigen[] | null,
): Origen {
  const filas = fila == null ? [] : Array.isArray(fila) ? (fila as readonly FilaOrigen[]) : [fila as FilaOrigen];
  return peorOrigen(origenDeTenant(tenantId), ...filas.map(origenDeUnaFila));
}

/** Los `Insight` heredan el tipo: bajo origen no real, pasan a `ejemplo`/`simulado` con su rótulo visible. */
export function heredarOrigen(insight: Insight, origen: Origen): Insight {
  if (origen === 'real') return insight;
  return validarInsight({ ...insight, tipo: origen, rotulo: TEXTO_BANDA[origen] } as Insight);
}

/** Rótulo corto que el Resumen suma a cada tarjeta; `null` si el origen es real. */
export function rotuloResumen(origen: Origen): string | null {
  return origen === 'real' ? null : origen === 'ejemplo' ? 'Dato de ejemplo' : 'Dato simulado';
}
