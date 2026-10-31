// Las escenas SVG tipo dibujo se retiraron (ESTILO §13: estado vacío = UNA línea punteada, sin ilustración).
// Se conserva solo el tipo para no romper la API del recorrido (`PasoTour.escena`), que ahora se ignora.
/** @deprecated sin efecto. */
export type EscenaId = 'desglose-correo' | 'documento-revision' | 'conexion-tms' | 'bienvenida' | 'listo';
