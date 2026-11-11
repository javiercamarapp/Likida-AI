// Avisos de /admin, leídos: UNA lectura compartida (caché corta de 45 s, como la campana de antes) para el pie y para la pantalla.
// `server-only` por contenido (toca la base con la llave de servicio): nunca se importa desde un componente de cliente.
import { obtenerPanoramaAccion } from '@/app/admin/requiere-accion';
import { getResumenNegocio, type ResumenNegocio } from '@/lib/admin/negocio';
import { avisosDeAdmin } from './generar-admin';
import type { FuenteAvisos } from '@/lib/avisos/bandeja';

const TTL_MS = 45_000;
let cacheResumen: { valor: ResumenNegocio; vence: number } | null = null;

/** El resumen del negocio con la misma caché corta. Una lectura caída NO se cachea (se reintenta en la siguiente) y se devuelve `null`. */
async function resumen(ahoraMs: number): Promise<ResumenNegocio | null> {
  if (cacheResumen && ahoraMs < cacheResumen.vence) return cacheResumen.valor;
  try {
    const valor = await getResumenNegocio();
    cacheResumen = { valor, vence: ahoraMs + TTL_MS };
    return valor;
  } catch { return null; }
}

/** Solo para pruebas. */
export function vaciarCacheAvisosAdmin(): void { cacheResumen = null; }

/** Nunca lanza: lo que no se pudo leer sale como aviso crítico, no como silencio. */
export async function leerAvisosAdmin(ahoraMs: number = Date.now()): Promise<FuenteAvisos> {
  const [panorama, r] = await Promise.all([obtenerPanoramaAccion(ahoraMs), resumen(ahoraMs)]);
  const avisos = avisosDeAdmin({
    bandeja: panorama.bandeja ? { conteos: panorama.bandeja.conteos, cola: panorama.bandeja.cola } : null,
    extras: panorama.extras,
    resumen: r,
  });
  return { avisos, generadoEn: new Date(ahoraMs).toISOString() };
}
