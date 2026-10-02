// ═══════════════════════════════════════════════════════════════════════════
// DEMO — LOS TIPOS DE ARCHIVO DEL KIT DE CARGA.
//
// Antes este archivo fijaba como CONTRATO lo que otras ramas construían (el lector de tabla propia, el importador de
// convenios, el de WhatsApp). Ya están integrados: cada tipo de archivo se valida con el importador real del producto
// (ver `archivos.ts` y `catalogo_kit.ts`), así que aquí solo queda la lista cerrada de tipos.
// ═══════════════════════════════════════════════════════════════════════════

/** Los 9 tipos de archivo que entrega el cliente de demo y que el kit sabe validar. `tags` y `casetas` acompañan a `pases`: sin ellos no hay cruce con GPS. */
export const TIPOS_ARCHIVO_KIT = ['gps_posiciones', 'geocercas', 'pases', 'tags', 'casetas', 'liquidaciones', 'convenios', 'whatsapp', 'carta_porte'] as const;
export type TipoArchivoKit = (typeof TIPOS_ARCHIVO_KIT)[number];
