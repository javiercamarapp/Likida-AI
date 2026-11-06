import type { ResumenGrupoSinAtender } from '../sin_atender_aviso/acciones';

// Nombres de grupo de la subida de varios chats. PURO (sin base ni servidor): lo usan la acción de servidor y el formulario.

/** Minúsculas, sin acentos y con espacios colapsados: para comparar nombres de grupo. */
export function claveNombre(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** El nombre de grupo por omisión de un archivo: «Chat de WhatsApp con Operación A.txt» → «Operación A». */
export function nombreGrupoDeArchivo(nombreArchivo: string): string {
  const base = nombreArchivo.replace(/^.*[\\/]/, '').replace(/\.(txt|zip)$/i, '');
  return base.replace(/^(chat de whatsapp con|whatsapp chat with|whatsapp chat -|chat de whatsapp -)\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Lo que el sistema NO revisa de un chat exportado: lo dice la pantalla y los mensajes de resultado. */
export const AVISO_SOLO_TEXTO = 'El sistema solo lee el texto de los mensajes: las fotos, los audios, los videos y los documentos adjuntos no se leen ni se guardan.';

export function textoAdjuntosSinTexto(n: number): string {
  return `${n} ${n === 1 ? 'archivo adjunto sin texto' : 'archivos adjuntos sin texto'} que el sistema no revisa`;
}

/** Tope de archivos por envío. */
export const MAX_ARCHIVOS_LOTE = 20;
export type EstadoArchivoLote = 'importado' | 'duplicado' | 'error';
export interface ResultadoArchivoLote {
  archivo: string;
  grupo: string;
  estado: EstadoArchivoLote;
  /** Texto en español para la pantalla: lo que pasó con este archivo. */
  detalle: string;
  mensajes?: number;
  /** Adjuntos sin texto contados en ESTE archivo (solo se cuentan al importar; no se guardan). */
  adjuntosSinTexto?: number;
  sinAtender?: ResumenGrupoSinAtender;
}
export type ResultadoLote =
  | { ok: true; mensaje: string; archivos: ResultadoArchivoLote[]; importados: number; hayImportados: boolean }
  | { ok: false; error: string; archivos?: ResultadoArchivoLote[] };

