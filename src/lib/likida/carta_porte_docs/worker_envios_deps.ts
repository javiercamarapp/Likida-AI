// Los puertos REALES del worker de envíos al TMS (T-A3-28): Supabase por `repo_envios.ts` / `repo.ts`, la configuración de
// salida por `salida_config.ts`, la reapertura del documento por `bandeja.ts` y la alerta por `alertarOperador`.
// Aparte de `worker_envios.ts` para que el motor se pruebe entero con dobles (mismo patrón que `worker_deps.ts`).

import { logger } from '@/lib/logger';
import { alertarOperador } from '@/lib/observability/alerta';
import { ConflictoDeVersion, reabrirDocumento } from './bandeja';
import * as repo from './repo';
import { repoEnvios } from './repo_envios';
import { leerConfigSalida } from './salida_config';
import { SIN_TMS, type SalidaTms } from './tms_puerto';
import type { DepsEnvios } from './worker_envios';
import { DatoInvalido } from '../errores';

/** Cómo se obtiene el puerto de una flota. La implementación real del TMS es de PS (B-1): se enchufa aquí cuando exista. */
export type ProveedorSalida = (tenantId: string) => Promise<SalidaTms | null>;

/** Hasta que PS entregue el conector, ninguna flota tiene puerto: todas quedan en modo manual (`SIN_TMS`). */
const SIN_PROVEEDOR: ProveedorSalida = async () => null;
let proveedor: ProveedorSalida = SIN_PROVEEDOR;

/** Sustituye el proveedor de puertos (PS pasa aquí su fábrica por flota). Sin argumento, vuelve a «ninguna flota tiene conector». */
export function fijarProveedorSalida(p?: ProveedorSalida): void { proveedor = p ?? SIN_PROVEEDOR; }

/** El puerto de la flota; `SIN_TMS` si no tiene conector o si el proveedor falla (lo prudente: no se sube nada, se descarga a mano). */
export async function salidaDeFlota(tenantId: string): Promise<SalidaTms> {
  try {
    return (await proveedor(tenantId)) ?? SIN_TMS;
  } catch (e) {
    logger.error('cp_envios.proveedor_salida_fallo', { tenantId, err: e instanceof Error ? e.message.slice(0, 200) : 'desconocido' });
    return SIN_TMS;
  }
}

export function depsEnviosReales(): DepsEnvios {
  return {
    reclamar: (limite) => repoEnvios.reclamar(limite),
    leerEnvio: (tenantId, id) => repoEnvios.leer(tenantId, id),
    actualizarEnvio: (tenantId, id, desde, cambios) => repoEnvios.actualizar(tenantId, id, desde, cambios),
    marcarAlerta: (tenantId, id) => repoEnvios.marcarAlerta(tenantId, id),
    liberarAlerta: (tenantId, id) => repoEnvios.liberarAlerta(tenantId, id),
    leerDocumento: (tenantId, id) => repo.leerDocumento(tenantId, id),
    leerConfig: (tenantId) => leerConfigSalida(tenantId),
    salida: salidaDeFlota,
    evento: (tenantId, documentoId, tipo, detalle) => repo.registrarEvento(tenantId, documentoId, tipo, null, detalle),
    devolverARevision: async (tenantId, documentoId, versionDoc, motivo) => {
      try {
        await reabrirDocumento(tenantId, documentoId, versionDoc, null);
      } catch (e) {
        // Si alguien cambió o reabrió el documento entre tanto, ya no hay nada que devolver; cualquier otra falla sube.
        if (e instanceof ConflictoDeVersion || e instanceof DatoInvalido) {
          logger.warn('cp_envios.devolver_a_revision_omitido', { documentoId, motivo: motivo.slice(0, 120) });
          return;
        }
        throw e;
      }
    },
    // Provisional hasta T-A3-30: el aviso a la oficina (destinatario configurable) sustituye este correo al operador.
    alertarEnvio: async (a) => {
      await alertarOperador(`cron.carta_porte_envio.${a.motivo}`, { error: a.mensaje, codigo: `cp_envio_${a.motivo}`, tenantId: a.tenantId, envioId: a.envioId, documentoId: a.documentoId });
    },
    alertarOperador: (evento, detalle) => alertarOperador(evento, detalle),
    ahora: () => Date.now(),
    senal: (ms) => AbortSignal.timeout(ms),
  };
}
