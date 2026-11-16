import { crearTraductor, type Traductor } from './traducir';
import type { DiccionarioDe } from './catalogo';
import type { Idioma } from './idioma';
import type { TrDe } from './tr_tipos';
import { dashboard_b } from './es/dashboard_b';
import { dashboard_b as dashboard_bEn } from './en/dashboard_b';

// Traductor del namespace `dashboard_b` para componentes y utilidades SÍNCRONOS de /dashboard que ya reciben el idioma (p. ej. por
// `tr.idioma` de `operacion`): evita pasar una segunda prop por todas las páginas. Sin idioma (pruebas, arneses) habla español.
type D = DiccionarioDe<'dashboard_b'>;
export const trBCompletoEs: Traductor<D> = crearTraductor<D>('es', dashboard_b, dashboard_b);
export const trDashboardBEs: TrDe<'dashboard_b'> = trBCompletoEs.t;

/** El traductor completo (`t`, `tp`, `idioma`) de `dashboard_b` para un idioma. */
export function trBCompleto(idioma: Idioma = 'es'): Traductor<D> {
  return idioma === 'en' ? crearTraductor<D>('en', dashboard_bEn, dashboard_b) : trBCompletoEs;
}
