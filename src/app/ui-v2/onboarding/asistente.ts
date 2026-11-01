import { hrefsDelMenu, menuPorPerfil } from '@/app/dashboard/shell/menu-por-perfil';
import type { PerfilTenant } from '@/lib/auth/visibilidad';

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
