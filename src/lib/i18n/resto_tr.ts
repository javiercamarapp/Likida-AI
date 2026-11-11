import { resto } from './es/resto';
import { crearTraductor, type Traductor } from './traducir';
import type { DiccionarioDe } from './catalogo';

/**
 * El traductor del namespace `resto` para helpers y vistas de servidor síncronas: reciben `t` como último parámetro y, si no se
 * lo pasan (pruebas, arneses), dicen lo de siempre, en español. Las páginas lo arman con `await getT('resto')`.
 */
export type TrResto = Traductor<DiccionarioDe<'resto'>>;
export type TResto = TrResto['t'];
export const TR_RESTO_ES: TrResto = crearTraductor<DiccionarioDe<'resto'>>('es', resto, resto);
export const T_RESTO_ES: TResto = TR_RESTO_ES.t;
