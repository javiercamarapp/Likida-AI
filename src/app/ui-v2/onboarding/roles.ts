import { puedeAdministrar, puedeAsignar, puedeEditarCatalogoOperativo, puedeExportar, puedeTimbrar } from '@/lib/auth/permisos';
import type { Permiso, Pista } from './tipos';

// Rol de la sesión → pista de recorrido. `vendedor` y cualquier rol desconocido no tienen (su panel no es /dashboard).
export function pistaDeRol(rol: string): Pista | null {
  if (rol === 'flota_admin' || rol === 'superadmin') return 'dueno';
  if (rol === 'encargado') return 'encargado';
  if (rol === 'contador') return 'contador';
  if (rol === 'nomina') return 'nomina';
  return null;
}

// Firmar una liquidación: mismo criterio que `puedeFirmarLiquidacion` (lib/likida/revision.ts, que arrastra la base y no
// se importa aquí). Una prueba compara ambos para que no se separen.
const FIRMA = new Set(['superadmin', 'flota_admin', 'contador']);

/** ¿El rol tiene la capacidad que pide un paso `accion`? Sale de `permisos.ts`; nunca se copia. */
export function rolTienePermiso(rol: string, permiso: Permiso): boolean {
  switch (permiso) {
    case 'asignar': return puedeAsignar(rol);
    case 'administrar': return puedeAdministrar(rol);
    case 'timbrar': return puedeTimbrar(rol);
    case 'catalogo': return puedeEditarCatalogoOperativo(rol);
    case 'exportar': return puedeExportar(rol);
    case 'firmar': return FIRMA.has(rol);
  }
}
