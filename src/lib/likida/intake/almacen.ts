// ═══════════════════════════════════════════════════════════════════════════
// GUARDAR LA FOTO DEL COMPROBANTE.
//
// Hasta el 1-ago-2026 no se guardaba ninguna: 22 gastos en producción, 19 con
// hash de imagen y CERO con `imagen_url`. La foto se bajaba de Meta, se hashea-
// ba, se le pagaba la visión y se tiraba.
//
// DOS REGLAS, y las dos vienen de que esto vive en el camino del dinero:
//
//   1. NUNCA tumba el intake. Si la subida falla, el gasto entra igual sin foto.
//      Perder el comprobante por no poder guardar su retrato sería cambiar un
//      problema chico por el grande.
//   2. El nombre del archivo es el HASH del contenido. Así el reenvío de la
//      misma foto sobrescribe su propio objeto en vez de acumular copias, y el
//      objeto es localizable desde el gasto sin guardar nada más.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { logger } from '@/lib/logger';

/** `image/jpeg` → `jpg`. Lo que Meta manda es jpeg o png. */
function extension(dataUrl: string): string {
  const m = /^data:image\/([a-z0-9.+-]+);/i.exec(dataUrl);
  const t = (m?.[1] ?? 'jpeg').toLowerCase();
  return t === 'jpeg' ? 'jpg' : t.replace(/[^a-z0-9]/g, '');
}

function bytes(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

/**
 * Sube la foto y devuelve la RUTA dentro del bucket (no una URL): el bucket es
 * privado y la liga se firma al momento de servirla, con TTL. Guardar una URL
 * firmada en la base la dejaría caducada a la hora y sin forma de renovarla.
 *
 * `undefined` = no se pudo, y el llamador sigue como si nada.
 */
export async function subirComprobante(
  tenantId: string,
  viajeId: string,
  nombre: string,
  dataUrl: string,
): Promise<string | undefined> {
  try {
    const ruta = `${tenantId}/${viajeId}/${nombre}.${extension(dataUrl)}`;
    // ── ERA LA ÚNICA LLAMADA DEL CAMINO SIN TECHO, Y LA DEL PAYLOAD MÁS GRANDE ─
    //
    // `acotada` puso techo a cada consulta y RPC de Supabase; ésta se quedó
    // fuera porque no pasa por `repo.ts`. Sin él hereda el default de undici
    // —300 000 ms— contra un `maxDuration` de 120: un socket aceptado que no
    // contesta se lleva la invocación ENTERA, y con ella las otras veintiuna
    // fotos de la ráfaga que corren en el mismo `after()`. Meta ya tiene su 200
    // y no reintenta, así que esas veintiuna se pierden por el cuelgue de una.
    //
    // OJO CON LO QUE ESTE TECHO **NO** HACE: `upload()` de storage-js no acepta
    // `AbortSignal` (su `FileOptions` solo lleva cacheControl, contentType,
    // upsert, duplex, metadata y headers — verificado en el paquete instalado),
    // así que aquí solo actúa la red de seguridad de `acotada`: la carrera
    // contra el temporizador. El socket puede quedarse colgado por su cuenta,
    // pero la invocación deja de esperarlo, que es lo que cuesta dinero. Lo
    // otro se arregla dándole un `fetch` propio al cliente admin, y eso vive
    // fuera de este archivo.
    const { error } = await acotada(supabaseAdmin().storage
      .from('comprobantes')
      .upload(ruta, bytes(dataUrl), {
        contentType: dataUrl.slice(5, dataUrl.indexOf(';')) || 'image/jpeg',
        // El mismo contenido produce la misma ruta: reenviar la foto reescribe
        // su propio objeto. Sin esto, el segundo intento falla con 409 y el
        // gasto se queda sin imagen por un motivo que no es un error.
        upsert: true,
      }), 'subirComprobante');
    if (error) {
      logger.warn('comprobante.subida_falló', { viaje: viajeId, err: error.message });
      return undefined;
    }
    return ruta;
  } catch (e) {
    // Incluye el caso de que la 0039 no esté aplicada: el bucket no existe y el
    // cliente lanza. El intake no se entera.
    logger.warn('comprobante.subida_error', { err: e instanceof Error ? e.message : String(e) });
    return undefined;
  }
}

/**
 * Liga temporal para mirar el comprobante desde el panel.
 *
 * Una hora, igual que los PDF. El bucket es privado a propósito: un ticket trae
 * RFC, domicilio y a veces lo que se compró —dato sensible del art. 2 fr. VI—,
 * y una URL pública sería un expediente de gastos indexable.
 */
export async function ligaComprobante(ruta: string, segundos = 3600): Promise<string | undefined> {
  try {
    const { data, error } = await supabaseAdmin().storage
      .from('comprobantes').createSignedUrl(ruta, segundos);
    if (error) {
      logger.warn('comprobante.liga_falló', { err: error.message });
      return undefined;
    }
    return data?.signedUrl;
  } catch {
    return undefined;
  }
}
