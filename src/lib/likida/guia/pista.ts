import type { PistaGuia } from './tipos';

/** Rol de la sesión y perfil de la flota → pista de la guía (SPEC 2.6). Un rol desconocido no tiene pista (`null`). */
export function pistaGuiaDe(rol: string, perfil: string | null | undefined): PistaGuia | null {
  switch (rol) {
    case 'flota_admin': return perfil === 'cinco_agentes' ? 'dueno_ca' : 'dueno';
    case 'superadmin': return 'superadmin';
    case 'contador': return 'contador';
    case 'encargado': return 'encargado';
    case 'nomina': return 'nomina';
    case 'vendedor': return 'vendedor';
    case 'operador': return 'operador';
    default: return null;
  }
}
