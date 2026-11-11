import { crearTraductor, type Traductor } from './traducir';
import { dinero } from './es/dinero';
import type { DiccionarioDe } from './catalogo';

// ═══════════════════════════════════════════════════════════════════════════
// TRADUCTOR DE «DINERO» PARA COMPONENTES SÍNCRONOS DE SERVIDOR (paquete P3).
//
// Un Server Component síncrono no puede llamar `await getT()` (si lo hiciera async, `renderToStaticMarkup(<Vista/>)` de las pruebas
// dejaría de poder renderizarlo) ni `useT()` (no hay contexto en el servidor). Recibe el traductor por la propiedad `tr`; la página
// (async) lo obtiene con `getT('dinero')` y lo pasa. Sin `tr`, el componente habla español: `trEs`, el mismo texto que antes.
// ═══════════════════════════════════════════════════════════════════════════
export type Tr = Traductor<DiccionarioDe<'dinero'>>['t'];
export const trEs: Tr = crearTraductor<DiccionarioDe<'dinero'>>('es', dinero, dinero).t;
