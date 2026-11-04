/** Lo que una pantalla le dice a quien guarda después de que la flota cambió bajo sus pies. */
export const MENSAJE_FLOTA_CAMBIO =
  'La flota que estás viendo cambió desde que abriste esta pantalla (otra pestaña eligió otra flota). No se guardó nada: recarga la página y vuelve a intentarlo.';

/** El campo oculto con la flota pintada, firmada (`firmarFlotaPintada`). Vive aquí, sin `node:crypto`, para que lo importen componentes de cliente. */
export const CAMPO_FLOTA_PINTADA = 'flota_pintada';
