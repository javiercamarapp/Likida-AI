import { mensajeParaPantalla } from '@/lib/likida/errores';
import { getT, type ClaveDe } from '@/lib/i18n/servidor';

/**
 * El mensaje de una falla inesperada en una acción de /admin: el verbo («guardar el precio del plan») sale del diccionario
 * `admin_resto` y el idioma se pasa a `mensajeParaPantalla`, que en otro idioma dice la versión genérica. En español, lo de siempre.
 * Va en su propio módulo (no en un archivo `'use server'`) para poder importarse desde cualquier acción.
 */
export async function mensajeDeFalla(e: unknown, verbo: ClaveDe<'admin_resto'>): Promise<string> {
  const { t, idioma } = await getT('admin_resto');
  return mensajeParaPantalla(e, t(verbo), idioma);
}
