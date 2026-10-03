// ═══════════════════════════════════════════════════════════════════════════
// ARCHIVOS QUE VIAJAN CON LA RESPUESTA AL CLIENTE — el POD, hoy.
//
// Antes el Vigía decía «el POD ya está recibido» y dejaba una tarea al gerente para
// mandar el archivo. Ahora, si el POD existe, la respuesta lo adjunta; pero con las
// mismas reglas que todo lo que sale hacia un cliente final:
//
//   1. NUNCA sin aprobación: un borrador con adjunto es de riesgo `medio`, así que la
//      política (politica.ts) no lo autoenvía; el gerente ve «adjuntará: POD».
//   2. SOLO DENTRO DE LA VENTANA DE 24 h: WhatsApp no deja mandar un archivo libre
//      fuera de ella y una plantilla con documento no está en el catálogo aprobado.
//      Si el texto salió como PLANTILLA (ventana cerrada), el archivo NO sale: queda un
//      evento `adjunto_pendiente` a la vista del gerente (y el texto no promete nada).
//   3. EL CLIENTE Y LA FLOTA SALEN DEL CONTACTO: el archivo se busca por (flota,
//      cliente, viaje); el POD de un viaje de OTRO cliente no existe para esta
//      conversación. La URL es firmada y vive 10 minutos (el bucket es privado).
//   4. UN SELLO POR (mensaje, archivo): el reintento de un envío no manda dos veces.
// ═══════════════════════════════════════════════════════════════════════════
import type { AdjuntoRef } from './tipos';

/** Un archivo ya resuelto, listo para entregarse a Meta. */
export interface ArchivoParaEnviar {
  /** URL firmada de corta vida del bucket privado. */
  url: string;
  nombre: string;
  pie: string;
}

/** La vida de la URL firmada que se le da a Meta para descargar el archivo. */
export const SEGUNDOS_URL_ADJUNTO = 600;

const ETIQUETA: Record<AdjuntoRef['clave'], string> = { pod: 'Comprobante de entrega (POD)' };

export const nombreDeAdjunto = (clave: AdjuntoRef['clave']): string => ETIQUETA[clave];

/** Solo rutas que cuelgan del prefijo de la flota y no escapan de él. PURA. */
export function rutaEsDeLaFlota(tenantId: string, ruta: string): boolean {
  return ruta.startsWith(`${tenantId}/`) && !ruta.includes('..') && !ruta.includes('//') && !ruta.includes('\\');
}

/** «POD-F-1042.pdf»: sin caracteres raros, y con la extensión que ya tenía la ruta (o `.pdf`). PURA. */
export function nombreDeArchivo(clave: AdjuntoRef['clave'], folio: string | null, ruta: string): string {
  const ext = /\.([A-Za-z0-9]{2,5})$/.exec(ruta)?.[1]?.toLowerCase() ?? 'pdf';
  const base = (folio ?? 'viaje').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'viaje';
  return `${clave.toUpperCase()}-${base}.${ext}`;
}

export function pieDeAdjunto(clave: AdjuntoRef['clave'], folio: string | null): string {
  return folio ? `${ETIQUETA[clave]} · viaje ${folio}` : ETIQUETA[clave];
}

/** Lo que el respaldo de un mensaje guarda de sus adjuntos (para el gerente y para el envío). PURA. */
export function adjuntosDeRespaldo(respaldo: unknown): AdjuntoRef[] {
  if (!respaldo || typeof respaldo !== 'object') return [];
  const r = respaldo as { adjuntos?: unknown; viajeId?: unknown; folio?: unknown };
  if (!Array.isArray(r.adjuntos) || typeof r.viajeId !== 'string') return [];
  const folio = typeof r.folio === 'string' ? r.folio : null;
  const claves = [...new Set(r.adjuntos.filter((x): x is AdjuntoRef['clave'] => x === 'pod'))];
  return claves.map((clave) => ({ clave, viajeId: r.viajeId as string, folio }));
}
