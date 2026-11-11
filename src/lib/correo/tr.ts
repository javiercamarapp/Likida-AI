import { correo as correoEs } from '@/lib/i18n/es/correo';
import { correo as correoEn } from '@/lib/i18n/en/correo';
import { crearTraductor, type Traductor } from '@/lib/i18n/traducir';
import { IDIOMA_POR_OMISION, idiomaValido, type Idioma } from '@/lib/i18n/idioma';

/**
 * El traductor de los correos. SÍNCRONO a propósito: los avisos son funciones puras que se prueban por su texto, y un correo
 * no puede esperar a un `import()`. Los dos diccionarios son pequeños y viven solo en el servidor.
 * El idioma es el del DESTINATARIO cuando se conoce (`user_metadata.idioma`); si no, es español.
 */
export type TrCorreo = Traductor<typeof correoEs>;

export function trCorreo(idioma?: unknown): TrCorreo {
  const i: Idioma = idiomaValido(idioma) ? idioma : IDIOMA_POR_OMISION;
  return crearTraductor<typeof correoEs>(i, i === 'en' ? correoEn : correoEs, correoEs);
}

/** Solo se marca el idioma en el `Correo` cuando NO es español: el español es lo de siempre y no añade ninguna propiedad. */
export function marcoIdioma(tr: TrCorreo): { idioma?: Idioma } {
  return tr.idioma === 'es' ? {} : { idioma: tr.idioma };
}
