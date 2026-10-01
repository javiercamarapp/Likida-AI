// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — la RUTA del PDF en Storage (bucket privado
// `liquidaciones`, 0008). Pura: subir y firmar viven en `repo.ts`, que es el
// único archivo de este módulo con acceso directo a Supabase.
//
// La ruta está DIRECCIONADA POR CONTENIDO: `<tenant>/externas/<clave>-<huella>.pdf`.
// Dos peticiones concurrentes con la misma clave y el mismo contenido escriben
// los mismos bytes en la misma ruta (idempotente), y dos con el mismo folio y
// OTRO contenido escriben en rutas DISTINTAS: la perdedora de la carrera por el
// unique de la base no puede pisarle el PDF a la ganadora.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';

export function rutaPdfExterno(tenantId: string, claveExterna: string, huella: string): string {
  // La clave va HASHEADA: una clave hostil (`../../otra-flota/x`) no puede
  // salirse de su carpeta, y una muy larga no revienta el límite de la ruta.
  const clave = createHash('sha256').update(claveExterna, 'utf8').digest('hex').slice(0, 24);
  return `${tenantId}/externas/${clave}-${huella.slice(0, 16)}.pdf`;
}
