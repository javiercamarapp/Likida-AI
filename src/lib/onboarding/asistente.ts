import { hrefsDelMenu, menuPorPerfil } from '@/app/dashboard/shell/menu-por-perfil';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import type { IdPaso } from '@/lib/likida/asistente/pasos_cinco_agentes';

// El asistente de configuración que corresponde a un rol/perfil: Puesta en marcha (flotas con los cinco agentes) o Arranque
// (flotas sin perfil). El avance NO se calcula aquí: lo mide la propia pantalla con señales reales; aquí solo se decide a dónde
// lleva la Guía y el cierre del recorrido, y solo si el menú del rol la muestra.
export interface AsistenteDe { href: string; nombre: string }

export function asistenteDe(rol: string, perfil: PerfilTenant | null | undefined): AsistenteDe | null {
  const hrefs = hrefsDelMenu(menuPorPerfil(rol, perfil));
  if (hrefs.includes('/dashboard/puesta-en-marcha')) return { href: '/dashboard/puesta-en-marcha', nombre: 'Puesta en marcha' };
  if (hrefs.includes('/dashboard/arranque')) return { href: '/dashboard/arranque', nombre: 'Arranque' };
  return null;
}

/** Ids de paso de Puesta en marcha (lib/likida/asistente) que una pantalla da por hechos antes de usarse bien. Declarativo. */
export const PRERREQUISITO_POR_PANTALLA: Readonly<Record<string, { paso: IdPaso; nota: string }>> = {
  '/dashboard/usuarios': { paso: 'equipo', nota: 'Se completa con el paso «Tu equipo» de Puesta en marcha.' },
  '/dashboard/conexiones': { paso: 'tms', nota: 'Se completa con el paso «Tu sistema de transporte» de Puesta en marcha.' },
  '/dashboard/agentes/liquidacion': { paso: 'correo', nota: 'El desglose por correo se activa en el paso «Correo» de Puesta en marcha.' },
  '/dashboard/operadores': { paso: 'catalogos', nota: 'Se completa con el paso «Operadores, unidades y supervisores».' },
  '/dashboard/unidades': { paso: 'catalogos', nota: 'Se completa con el paso «Operadores, unidades y supervisores».' },
  '/dashboard/agentes/carta-porte': { paso: 'carta_porte', nota: 'Define quién revisa la Carta Porte en Puesta en marcha.' },
  '/dashboard/whatsapp': { paso: 'whatsapp', nota: 'Depende de la verificación del número ante Meta; Likida la gestiona.' },
  '/dashboard/agentes/peajes': { paso: 'peajes', nota: 'Se arma cuando mandas tu primer estado de cuenta de casetas.' },
  '/dashboard/legal': { paso: 'legal', nota: 'Likida y tu gerencia lo cierran con la versión vigente.' },
};
