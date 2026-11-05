/** Lo que una pantalla le dice a quien guarda después de que la flota cambió bajo sus pies. */
export const MENSAJE_FLOTA_CAMBIO =
  'La flota que estás viendo cambió desde que abriste esta pantalla (otra pestaña eligió otra flota). No se guardó nada: recarga la página y vuelve a intentarlo.';

/** El campo oculto con la flota pintada, firmada (`firmarFlotaPintada`). Vive aquí, sin `node:crypto`, para que lo importen componentes de cliente. */
export const CAMPO_FLOTA_PINTADA = 'flota_pintada';

/**
 * La marca con la que el error `FlotaCambioError` cruza de servidor a cliente. En producción Next BORRA el mensaje y el nombre de
 * un error lanzado por una server action o un render (deja solo un `digest`), pero respeta un `digest` ya puesto en el error: por
 * eso la clase lo fija y el error boundary de `/dashboard` lo reconoce y dice «cambiaste de flota, recarga» en vez del genérico
 * «No se pudo cargar el panel». Vive aquí, sin `node:crypto`, para que lo importe el componente de cliente.
 */
export const DIGEST_FLOTA_CAMBIO = 'LIKIDA_FLOTA_CAMBIO';

export function esErrorFlotaCambio(error: { digest?: string; name?: string } | null | undefined): boolean {
  return !!error && (error.digest === DIGEST_FLOTA_CAMBIO || error.name === 'FlotaCambioError');
}
