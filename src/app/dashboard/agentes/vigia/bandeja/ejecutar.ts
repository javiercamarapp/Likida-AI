import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { crearDepsVigia } from '@/lib/likida/vigia/deps';
import {
  aprobarMensaje, rechazarMensaje, tomarConversacion, devolverConversacion, responderComoHumano, cerrarConversacion,
  type ResultadoDecision,
} from '@/lib/likida/vigia/servicio';
import type { TAgentes } from '../../i18n-agentes';
import type { ResultadoVigia } from '../controles';

// Las MISMAS decisiones que el panel del Vigía (`../page.tsx`): aprobar o descartar una respuesta propuesta, tomar, devolver, cerrar y
// responder. La bandeja no abre ningún camino de envío nuevo: cada una pasa por el servicio de siempre (ventana de 24 h, límites, bitácora).
// Módulo plano (no es un archivo de acciones de servidor): lo llaman las acciones de `page.tsx`, que ya resolvieron sesión, rol y flota desde la cookie.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (fd: FormData, k: string): string => String(fd.get(k) ?? '');
const aResultado = (r: ResultadoDecision): ResultadoVigia => (r.ok ? { ok: true, mensaje: r.mensaje } : { ok: false, error: r.mensaje });

export interface ActorBandeja { tenantId: string; userId: string }

/** Una respuesta propuesta por el agente: aprobar (con la edición), descartar, o tomar el hilo desde el mensaje. */
export async function ejecutarDecidir(a: ActorBandeja, fd: FormData, tx: TAgentes): Promise<ResultadoVigia> {
  const id = texto(fd, 'id');
  if (!UUID.test(id)) return { ok: false, error: tx('rest.mensaje_no_valido') };
  const que = texto(fd, 'accion');
  try {
    const deps = crearDepsVigia();
    let r: ResultadoDecision;
    if (que === 'aprobar') {
      const editado = texto(fd, 'texto');
      r = await aprobarMensaje(a, id, deps, editado ? { textoEditado: editado } : {});
    } else if (que === 'rechazar') r = await rechazarMensaje(a, id, deps);
    else if (que === 'tomar') {
      const m = await deps.repo.mensaje(a.tenantId, id);
      r = m ? await tomarConversacion(a, m.conversacionId, deps) : { ok: false, motivo: 'no_encontrado', mensaje: tx('rest.no_encuentro_ese_mensaje_en_tu') };
    } else return { ok: false, error: tx('rest.accion_no_valida') };
    return aResultado(r);
  } catch (e) {
    logger.error('vigia.bandeja_decidir_fallo', { tenant: a.tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'atender al cliente') };
  }
}

/** Una conversación: tomar, devolver al Vigía, cerrar o responder como persona. */
export async function ejecutarConversacion(a: ActorBandeja, fd: FormData, tx: TAgentes): Promise<ResultadoVigia> {
  const id = texto(fd, 'id');
  if (!UUID.test(id)) return { ok: false, error: tx('rest.conversacion_no_valida') };
  const que = texto(fd, 'accion');
  try {
    const deps = crearDepsVigia();
    let r: ResultadoDecision;
    if (que === 'tomar') r = await tomarConversacion(a, id, deps);
    else if (que === 'devolver') r = await devolverConversacion(a, id, deps);
    else if (que === 'cerrar') r = await cerrarConversacion(a, id, deps);
    else if (que === 'responder') r = await responderComoHumano(a, id, texto(fd, 'texto'), deps);
    else return { ok: false, error: tx('rest.accion_no_valida') };
    return aResultado(r);
  } catch (e) {
    logger.error('vigia.bandeja_conversacion_fallo', { tenant: a.tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: mensajeParaPantalla(e, 'atender al cliente') };
  }
}
