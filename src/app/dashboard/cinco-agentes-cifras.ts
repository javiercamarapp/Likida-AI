import { puedeVerArea } from '@/lib/auth/visibilidad';
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import { cierreDosMesesDeFlota } from '@/lib/likida/peajes/revision_cobros';
import { hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { logger } from '@/lib/logger';
import {
  PERFIL_CIFRAS_PESOS, cifrasDeCierre, cifrasSinDato, type CifrasPesosCincoAgentes,
} from './cinco-agentes-cifras-modelo';

export * from './cinco-agentes-cifras-modelo';

// ═══════════════════════════════════════════════════════════════════════════
// LECTOR de las cifras en pesos del Inicio de una flota con perfil `cinco_agentes`. Solo componentes de servidor: el
// modelo puro (tipos, cifras, rótulos) vive en `cinco-agentes-cifras-modelo.ts`.
//
// Una sola lectura (`cierreDosMesesDeFlota`: el mes de hoy y el anterior, con sus archivos IAVE) alimenta las dos cifras.
// NO usa `peajesDeGasto`, `getKpis` ni `getDineroObservadoPorTipo` (ver el modelo).
//
// LA PUERTA va ANTES de cualquier lectura de datos: rol con el área de dinero Y perfil `cinco_agentes`. Si no se cumple
// devuelve `null` (la pantalla no pinta nada, ni siquiera «Sin dato»). Un fallo de lectura NUNCA es $0: son dos cifras
// «Sin dato» con `reintentar`.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `null` = no corresponde mostrarlas (rol sin dinero, o flota sin ese perfil). Nunca lanza.
 * `hoy` (AAAA-MM-DD, hora de México) solo se pasa en pruebas.
 */
export async function leerCifrasPesosCincoAgentes(
  tenantId: string, rol: string, hoy: string = hoyMx(new Date(ahoraMs())),
): Promise<CifrasPesosCincoAgentes | null> {
  if (!puedeVerArea(rol, 'dinero')) return null; // el encargado nunca: ni siquiera se consulta el perfil
  if ((await perfilDeTenant(tenantId)) !== PERFIL_CIFRAS_PESOS) return null;
  try {
    const dos = await cierreDosMesesDeFlota(tenantId, hoy.slice(0, 7));
    if ('error' in dos) {
      logger.warn('cinco_agentes.cifras_pesos.cierre_invalido', { tenant: tenantId });
      return cifrasSinDato('No se pudo leer el estado de cuenta.', true);
    }
    return cifrasDeCierre(dos, hoy);
  } catch (e) {
    // Sin el mensaje de la base: puede traer TAG, unidad o importe.
    logger.warn('cinco_agentes.cifras_pesos.lectura', { tenant: tenantId, err: e instanceof Error ? e.name : 'desconocido' });
    return cifrasSinDato('No se pudo leer el estado de cuenta.', true);
  }
}
