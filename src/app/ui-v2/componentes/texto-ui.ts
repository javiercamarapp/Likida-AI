import { crearTraductor, type Variables } from '@/lib/i18n/traducir';
import type { Idioma } from '@/lib/i18n/idioma';
import { ui_comun as es } from '@/lib/i18n/es/ui_comun';
import { ui_comun as en } from '@/lib/i18n/en/ui_comun';

// Textos de los componentes compartidos que se pintan en servidor SIN proveedor de idioma (no pueden usar `useT`): reciben `idioma`
// por prop (por omisión es, idéntico a antes) y traducen con las dos tablas de `ui_comun`, que son pequeñas. Los componentes de cliente
// usan `useT('ui_comun', es)` y leen el idioma del proveedor.
export type ClaveUi = keyof typeof es;
export function textoUi(idioma: Idioma = 'es'): (clave: ClaveUi, variables?: Variables) => string {
  const tr = crearTraductor(idioma, idioma === 'en' ? en : es, es);
  return (clave, variables) => tr.t(clave, variables);
}
