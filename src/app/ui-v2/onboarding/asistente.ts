import { hrefsConPestanas, menuPorPerfil } from '@/app/dashboard/shell/menu-por-perfil';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import type { Idioma } from '@/lib/i18n/idioma';
import { ctxOnb } from './idioma';

// El asistente de configuración que corresponde a un rol/perfil: Puesta en marcha (flotas con los cinco agentes) o Arranque
// (flotas sin perfil). El avance NO se calcula aquí: lo mide la propia pantalla con señales reales; aquí solo se decide a dónde
// lleva la Guía y el cierre del recorrido, y solo si el menú del rol la muestra.
export interface AsistenteDe { href: string; nombre: string }

export function asistenteDe(rol: string, perfil: PerfilTenant | null | undefined, idioma: Idioma = 'es'): AsistenteDe | null {
  const cx = ctxOnb(idioma);
  const hrefs = hrefsConPestanas(menuPorPerfil(rol, perfil));
  if (hrefs.includes('/dashboard/puesta-en-marcha')) return { href: '/dashboard/puesta-en-marcha', nombre: cx.t('asistente.puesta') };
  if (hrefs.includes('/dashboard/arranque')) return { href: '/dashboard/arranque', nombre: cx.t('asistente.arranque') };
  return null;
}
