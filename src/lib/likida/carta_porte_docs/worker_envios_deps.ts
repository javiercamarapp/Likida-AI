// Los puertos REALES del worker de envíos al TMS (T-A3-28): Supabase por `repo_envios.ts` / `repo.ts`, la configuración de
// salida por `salida_config.ts`, la reapertura del documento por `bandeja.ts` y la alerta por `alertarOperador`.
// Aparte de `worker_envios.ts` para que el motor se pruebe entero con dobles (mismo patrón que `worker_deps.ts`).

import { logger } from '@/lib/logger';
import { alertarOperador } from '@/lib/observability/alerta';
import { appUrl } from '@/lib/env';
import { enviarCorreo } from '@/lib/correo/enviar';
import { avisarOficina } from '@/lib/meta/aviso_oficina';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { telefonoDeUsuario, telefonoJefeDe } from '../contactos';
import { acotada } from '../presupuesto';
import { crearAlertarEnvio } from './alerta_envio';
import { ConflictoDeVersion, reabrirDocumento, reabrirPorRechazoTms } from './bandeja';
import * as repo from './repo';
import { repoEnvios } from './repo_envios';
import { leerConfigSalida } from './salida_config';
import { esFlotaSimulada, salidaSimulada } from './salida_simulada';
import { SALIDA_NO_DISPONIBLE, SIN_TMS, type SalidaTms } from './tms_puerto';
import type { DepsEnvios } from './worker_envios';
import { DatoInvalido } from '../errores';

/** Cómo se obtiene el puerto de una flota. La implementación real del TMS es de PS (B-1): se enchufa aquí cuando exista. */
export type ProveedorSalida = (tenantId: string) => Promise<SalidaTms | null>;

/** Hasta que PS entregue el conector, ninguna flota tiene puerto: todas quedan en modo manual (`SIN_TMS`). */
const SIN_PROVEEDOR: ProveedorSalida = async () => null;
let proveedor: ProveedorSalida = SIN_PROVEEDOR;

/** Sustituye el proveedor de puertos (PS pasa aquí su fábrica por flota). Sin argumento, vuelve a «ninguna flota tiene conector». */
export function fijarProveedorSalida(p?: ProveedorSalida): void { proveedor = p ?? SIN_PROVEEDOR; }

/** Un solo simulador por proceso: así recuerda las llaves vistas. */
const salidaSimuladaUnica: SalidaTms = salidaSimulada();

/** El puerto de la flota; `SIN_TMS` si no tiene conector; `SALIDA_NO_DISPONIBLE` si el proveedor FALLA (no se sube nada, pero
 *  tampoco se trata como modo manual: el worker reintenta pronto — A37-S33-09). */
export async function salidaDeFlota(tenantId: string): Promise<SalidaTms> {
  // Una flota declarada sintética (SALIDA_TMS_SIMULADA, T-A3-42) sale por el simulador; ninguna otra.
  if (esFlotaSimulada(tenantId)) return salidaSimuladaUnica;
  try {
    return (await proveedor(tenantId)) ?? SIN_TMS;
  } catch (e) {
    logger.error('cp_envios.proveedor_salida_fallo', { tenantId, err: e instanceof Error ? e.message.slice(0, 200) : 'desconocido' });
    return SALIDA_NO_DISPONIBLE;
  }
}

/** El correo de un usuario ACTIVO de ESTA flota (un usuario de otra flota, o dado de baja, no recibe el aviso). */
async function correoDeUsuario(userId: string, tenantId: string): Promise<string | null> {
  const { data, error } = await acotada(supabaseAdmin().from('app_user').select('email, activo').eq('id', userId).eq('tenant_id', tenantId).maybeSingle(), 'correoDeUsuario');
  if (error) throw new Error(`correoDeUsuario: ${error.message}`);
  const f = data as { email: string | null; activo: boolean | null } | null;
  return f && f.activo !== false ? f.email : null;
}

export function depsEnviosReales(): DepsEnvios {
  // Una función por pasada: lleva la cuenta de los avisos de la pasada (`TOPE_AVISOS_POR_PASADA`).
  const alertarEnvio = crearAlertarEnvio({
    leerConfig: (tenantId) => leerConfigSalida(tenantId),
    leerFolio: async (tenantId, documentoId) => (await repo.leerDocumento(tenantId, documentoId))?.extraccion?.campos.folio_cliente?.valor ?? null,
    correoDeUsuario,
    telefonoDeUsuario,
    telefonoJefe: telefonoJefeDe,
    enviarCorreo: (para, correo) => enviarCorreo(para, correo),
    avisar: (telefono, texto, parametros, contexto) => avisarOficina(telefono, texto, { parametros, contexto }),
    alertarOperador: (evento, detalle) => alertarOperador(evento, detalle),
    urlBandeja: `${appUrl()}/dashboard/carta-porte/documentos`,
  });
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
    devolverPorRechazo: async (tenantId, documentoId, versionDoc, hallazgos, ubicaciones) => {
      try {
        await reabrirPorRechazoTms(tenantId, documentoId, versionDoc, hallazgos, ubicaciones);
      } catch (e) {
        // Igual que arriba: si el documento cambió entre tanto, la persona ya lo tiene en las manos y no hay nada que devolver.
        if (e instanceof ConflictoDeVersion || e instanceof DatoInvalido) {
          logger.warn('cp_envios.devolver_por_rechazo_omitido', { documentoId });
          return;
        }
        throw e;
      }
    },
    huellasRechazadas: async (tenantId, documentoId) =>
      (await repoEnvios.listarPorDocumento(tenantId, documentoId)).filter((x) => x.estado === 'rechazado_tms' && x.plantillaSha256 !== null).map((x) => x.plantillaSha256 as string),
    // T-A3-30: correo + WhatsApp al destinatario configurable (jefe de tráfico si no hay); lanza si no salió por ningún canal.
    alertarEnvio: async (a) => { await alertarEnvio(a); },
    alertarOperador: (evento, detalle) => alertarOperador(evento, detalle),
    ahora: () => Date.now(),
    senal: (ms) => AbortSignal.timeout(ms),
  };
}
