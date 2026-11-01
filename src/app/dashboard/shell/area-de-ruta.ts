import { hrefActivo, type MenuV2 } from './menu-por-perfil';

/** Etiqueta del pie del menú (Notificaciones, Mi perfil, Centro de ayuda, Plan, Configuración). */
export const AREA_PIE = 'Cuenta';
/** Etiqueta del Resumen (Inicio y el panel del contador). */
export const AREA_RESUMEN = 'Resumen';

/**
 * El área del menú a la que pertenece una ruta: el título del grupo que contiene su ítem activo (el de href más largo que sea la
 * ruta o su prefijo), «Resumen» para el Resumen y «Cuenta» para el pie. null si la ruta no está en el menú de ese rol: entonces la
 * pantalla pasa su `area` a mano o no lleva etiqueta (nunca una inventada).
 */
export function areaDeRuta(pathname: string, menu: MenuV2): string | null {
  const href = hrefActivo(pathname, menu);
  if (!href) return null;
  if (menu.resumen.some((i) => i.href === href)) return AREA_RESUMEN;
  const grupo = menu.grupos.find((g) => g.items.some((i) => i.href === href));
  if (grupo) return grupo.titulo;
  if (menu.pie.some((i) => i.href === href)) return AREA_PIE;
  return null;
}
