// ═══════════════════════════════════════════════════════════════════════════
// ENVÍO AL TMS — «aprobado» significa «preparar el envío a la plantilla/API del sistema del cliente».
//
// ESTE MÓDULO NO TIMBRA NI CREA CCP, y tampoco crea viajes: solo deja un registro `cp_envio_tms` en
// `pendiente_prechequeo` (el prechequeo del reque, el armado de la plantilla y el envío son de otras piezas).
// El reque y el timbrado se siguen haciendo a mano en el TMS del cliente.
//
//   · IDEMPOTENTE: la llave es sha256(flota | documento | versión | plantilla). Aprobar dos veces el mismo
//     documento deja UN envío; reabrir, corregir y volver a aprobar sube la versión ⇒ llave nueva, y el envío
//     anterior que aún no salía pasa a `descartado` (con su evento).
//   · NO importa nada del camino del timbre (PAC, CFDI, `carta_porte_timbre`): una prueba lee los imports.
//
// ── PERFIL «cinco_agentes» ──────────────────────────────────────────────────
// Bajo ese perfil «crear viaje» queda en stand-by (código intacto, inalcanzable). La guardia del perfil YA
// lee el dato real de B1 (`tenant_perfil`, mig. 0770, vía `perfilDeTenant`) — ver `PERFIL_REAL` abajo.
// `fijarGuardiaPerfil` sigue existiendo para las pruebas (simulan el perfil sin tocar la base real).
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import { leerConfigSalida } from './salida_config';
import * as repo from './repo';
import type { DocumentoFila, EnvioTmsFila, EstadoEnvioTms } from './repo';

export type GuardiaPerfil = (tenantId: string) => Promise<boolean>;

/**
 * La guardia de producción: ¿la flota tiene perfil (cinco_agentes es el único que existe hoy, mig. 0770)?
 *
 * `siNoSePuedeLeer: 'permitir'` A PROPÓSITO — al revés del default de `perfilDeTenant` ('restringir', el
 * lado seguro cuando el perfil RECORTA acceso). Aquí no se recorta: se BIFURCA a un flujo distinto
 * (preparar envío al TMS en vez de crear el viaje). Si la tabla no se puede leer y no hay valor previo,
 * asumir "cinco_agentes" sin saberlo desviaría a una flota NORMAL hacia un camino que no espera — peor
 * que mantenerle su comportamiento de siempre unos segundos mientras la base se recupera. Mismo patrón que
 * `interruptor_tenant.ts` (la palanca operativa del chofer, que tampoco se apaga por un bache de lectura).
 */
const PERFIL_REAL: GuardiaPerfil = async (tenantId) => (await perfilDeTenant(tenantId, Date.now(), 'permitir')) !== null;

let guardia: GuardiaPerfil = PERFIL_REAL;

/** Sustituye la guardia (las pruebas simulan el perfil sin tocar `tenant_perfil`). Sin argumento, vuelve a leer el perfil real. */
export function fijarGuardiaPerfil(g?: GuardiaPerfil): void { guardia = g ?? PERFIL_REAL; }

/** ¿La flota está bajo el perfil restringido (cinco agentes)? Ante un fallo de la guardia se asume que SÍ: es el lado seguro. */
export async function flotaBajoPerfil(tenantId: string): Promise<boolean> {
  try { return await guardia(tenantId); } catch { return true; }
}

export const MENSAJE_FUNCION_NO_DISPONIBLE = 'Esta función no está disponible en tu plan.';

/** La llave de idempotencia del envío: la misma flota, documento, versión y plantilla dan siempre la misma. */
export function llaveDeEnvio(tenantId: string, documentoId: string, version: number, plantilla: string): string {
  return createHash('sha256').update(`${tenantId}|${documentoId}|${version}|${plantilla}`).digest('hex');
}

/** Estados en los que un envío viejo todavía no salió y puede descartarse sin perder nada. */
const DESCARTABLES: EstadoEnvioTms[] = ['pendiente_prechequeo', 'pendiente_reque', 'listo', 'error_transitorio'];

/** De dónde se puede pasar a «subido a mano»: lo que aún no salió y también un rechazo del TMS (el caso típico: se sube a mano lo que el TMS no aceptó). */
const ORIGEN_SUBIDO_A_MANO: EstadoEnvioTms[] = [...DESCARTABLES, 'rechazado_tms'];

export type ResultadoEnvio =
  | { ok: true; envio: EnvioTmsFila; creado: boolean; descartados: number }
  | { ok: false; motivo: 'no_aprobado' | 'envio_en_curso' | 'error'; mensaje: string };

/**
 * Prepara el envío del documento APROBADO. No exige operador, unidad ni viaje.
 * Idempotente: la misma versión del documento devuelve el envío existente sin duplicar ni registrar de nuevo.
 */
export async function prepararEnvioTms(
  tenantId: string, doc: DocumentoFila, actor: { id: string | null; email?: string },
): Promise<ResultadoEnvio> {
  if (doc.estado !== 'aprobado') return { ok: false, motivo: 'no_aprobado', mensaje: 'Solo se prepara el envío de un documento aprobado.' };
  const config = await leerConfigSalida(tenantId);
  const plantilla = config.plantillaPorDefecto;
  const llave = llaveDeEnvio(tenantId, doc.id, doc.version, plantilla);

  const previos = await repo.enviosDeDocumento(tenantId, doc.id);
  const mismo = previos.find((e) => e.idempotencyKey === llave);
  if (mismo) return { ok: true, envio: mismo, creado: false, descartados: 0 };

  // Una versión nueva del documento invalida el envío anterior que aún no salió.
  let descartados = 0;
  for (const viejo of previos) {
    if (!DESCARTABLES.includes(viejo.estado)) continue;
    if (await repo.descartarEnvioTms(tenantId, viejo.id, DESCARTABLES)) {
      descartados++;
      await repo.registrarEvento(tenantId, doc.id, 'envio_error', actor.id, { envioId: viejo.id, causa: 'descartado_por_nueva_version', versionNueva: doc.version });
    }
  }

  const r = await repo.insertarEnvioTms(tenantId, { documentoId: doc.id, versionDoc: doc.version, idempotencyKey: llave, plantilla });
  if (!r) return { ok: false, motivo: 'envio_en_curso', mensaje: 'El envío anterior de este documento se está enviando ahora. Espera a que termine para volver a prepararlo.' };
  if (r.creado) await repo.registrarEvento(tenantId, doc.id, 'envio_preparado', actor.id, { envioId: r.envio.id, plantilla, versionDoc: doc.version });
  return { ok: true, envio: r.envio, creado: r.creado, descartados };
}

export type ResultadoSubidoAMano =
  | { ok: true; envio: EnvioTmsFila; yaEstaba: boolean }
  | { ok: false; motivo: 'no_aprobado' | 'version_cambio' | 'ya_enviado' | 'envio_en_curso' | 'error'; mensaje: string };

const MENSAJE_YA_ENVIADO = 'Este documento ya se envió al TMS: no hay nada que subir a mano.';

/**
 * «Ya la subí a mano»: la persona descargó la plantilla y la subió al TMS ella misma (33c4d51b 38:34). El envío de la versión
 * vigente del documento pasa a `subido_a_mano` (terminal): cierra lo pendiente y el worker no lo reintenta. No habla con el TMS.
 *
 *   · Acepta cualquier envío que aún no salió y también `rechazado_tms`.
 *   · Respeta el candado de versión: si el documento cambió desde que la persona abrió la pantalla, no se marca nada.
 *   · IDEMPOTENTE: si esa versión ya está `subido_a_mano` devuelve el mismo envío sin segundo evento.
 *   · Si todavía no hay envío de esta versión (p. ej. flota sin perfil), se prepara y se marca en el acto.
 */
export async function marcarSubidoAMano(
  tenantId: string, doc: DocumentoFila, versionVista: number, actor: { id: string | null; email?: string },
): Promise<ResultadoSubidoAMano> {
  if (doc.estado !== 'aprobado') return { ok: false, motivo: 'no_aprobado', mensaje: 'Solo se marca como subido a mano un documento aprobado.' };
  if (doc.version !== versionVista) return { ok: false, motivo: 'version_cambio', mensaje: 'Otra persona cambió este documento mientras lo revisabas. Recarga la pantalla y vuelve a intentarlo.' };

  const previos = await repo.enviosDeDocumento(tenantId, doc.id);
  let envio = previos.find((e) => e.versionDoc === doc.version && e.estado !== 'descartado');
  if (envio?.estado === 'subido_a_mano') return { ok: true, envio, yaEstaba: true };
  if (envio?.estado === 'enviado') return { ok: false, motivo: 'ya_enviado', mensaje: MENSAJE_YA_ENVIADO };
  if (envio?.estado === 'enviando') return { ok: false, motivo: 'envio_en_curso', mensaje: 'El envío se está haciendo ahora. Espera a que termine antes de marcarlo como subido a mano.' };

  if (!envio) {
    const p = await prepararEnvioTms(tenantId, doc, actor);
    if (!p.ok) return { ok: false, motivo: p.motivo === 'envio_en_curso' ? 'envio_en_curso' : 'error', mensaje: p.mensaje };
    envio = p.envio;
  }
  const estadoPrevio = envio.estado;
  if (!(await repo.marcarEnvioSubidoAMano(tenantId, envio.id, ORIGEN_SUBIDO_A_MANO))) {
    // Alguien lo movió entre la lectura y el UPDATE: se vuelve a leer para decir la verdad.
    const ahora = (await repo.enviosDeDocumento(tenantId, doc.id)).find((e) => e.id === envio!.id);
    if (ahora?.estado === 'subido_a_mano') return { ok: true, envio: ahora, yaEstaba: true };
    if (ahora?.estado === 'enviado') return { ok: false, motivo: 'ya_enviado', mensaje: MENSAJE_YA_ENVIADO };
    if (ahora?.estado === 'enviando') return { ok: false, motivo: 'envio_en_curso', mensaje: 'El envío se está haciendo ahora. Espera a que termine antes de marcarlo como subido a mano.' };
    return { ok: false, motivo: 'error', mensaje: 'Este envío ya no admite marcarse como subido a mano (quedó descartado o cambió). Recarga la pantalla para ver su estado actual.' };
  }
  await repo.registrarEvento(tenantId, doc.id, 'envio_subido_a_mano', actor.id, { envioId: envio.id, versionDoc: doc.version, estadoPrevio });
  return { ok: true, envio: { ...envio, estado: 'subido_a_mano' }, yaEstaba: false };
}
