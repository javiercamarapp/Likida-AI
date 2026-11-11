import type { DiccionarioDe, Namespace } from './catalogo';
import type { Traductor } from './traducir';

/** La función `t` de un namespace, para pasarla como parámetro a funciones puras y constantes que arman columnas o etiquetas. */
export type TrDe<N extends Namespace> = Traductor<DiccionarioDe<N>>['t'];
