import { publico } from './es/publico';
import { cargarDiccionarios, type DiccionarioDe } from './catalogo';
import { crearTraductor, type Traductor } from './traducir';
import type { Idioma } from './idioma';

/**
 * El traductor del namespace `publico` (páginas públicas). Las páginas ESTÁTICAS (calculadora, blog, aviso/prospectos) no leen
 * cookies —eso las volvería dinámicas—: piden `trPublico(idioma)` con el idioma que les dé su subruta `/en` (hoy siempre 'es').
 * Las dinámicas (estado, pago, mcp) usan `getT('publico')`. Sin pasar nada, o sin proveedor, dice lo de siempre en español.
 */
export type TrPublico = Traductor<DiccionarioDe<'publico'>>;
export const TR_PUBLICO_ES: TrPublico = crearTraductor<DiccionarioDe<'publico'>>('es', publico, publico);

export async function trPublico(idioma: Idioma = 'es'): Promise<TrPublico> {
  if (idioma === 'es') return TR_PUBLICO_ES;
  const dic = (await cargarDiccionarios(idioma, ['publico'])).publico;
  return crearTraductor<DiccionarioDe<'publico'>>(idioma, dic, publico);
}
