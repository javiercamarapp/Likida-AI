import { operacion } from './es/operacion';
import { crearTraductor, type Traductor } from './traducir';
import type { DiccionarioDe } from './catalogo';

/**
 * El traductor del namespace `operacion` que las VISTAS de servidor (componentes sin 'use client' que arma una `page.tsx`)
 * reciben como prop `tr`. Un componente de servidor no puede llamar a `useT` (es un hook de cliente), así que la página lo arma
 * con `await getT('operacion')` y lo baja por prop; sin la prop (pruebas de render, arneses), dice lo de siempre, en español.
 * Los componentes de cliente que cuelgan de la vista leen el idioma del proveedor con `useT`.
 */
export type TrOperacion = Traductor<DiccionarioDe<'operacion'>>;
export const TR_OPERACION_ES: TrOperacion = crearTraductor<DiccionarioDe<'operacion'>>('es', operacion, operacion);
