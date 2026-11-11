import { mensajes as mensajesEs } from './es/mensajes';
import { mensajes as mensajesEn } from './en/mensajes';
import { crearTraductor, type Traductor, type Variables } from './traducir';
import { IDIOMA_POR_OMISION, idiomaValido, type Idioma } from './idioma';

/**
 * El traductor de `mensajes`, SÍNCRONO: lo usan `DatoInvalido` (que se lanza en lógica pura) y `mensajeParaPantalla`, que no
 * pueden esperar a un `import()`. Son servidor y pocas decenas de textos. Sin idioma o con uno ajeno, español.
 */
export type TrMensajes = Traductor<typeof mensajesEs>;
export type ClaveMensaje = keyof typeof mensajesEs;

export function trMensajes(idioma?: unknown): TrMensajes {
  const i: Idioma = idiomaValido(idioma) ? idioma : IDIOMA_POR_OMISION;
  return crearTraductor<typeof mensajesEs>(i, i === 'en' ? mensajesEn : mensajesEs, mensajesEs);
}

export type { Variables };
