import { logger } from '@/lib/logger';
import { enviarConFallback, type ResultadoEnvioConFallback } from '@/lib/meta/enviar_con_fallback';
import {
  cerrarEnvio, ConveniosNoDisponibles, leerContextoEnvio, leerLigado, ligarConvenioAViaje, liberarEnvio, reclamarEnvio, reiniciarEnvios,
  type ContextoEnvio, type Envio, type ResultadoLigar, type ViajeLigado,
} from './repo';
import { armarMensajeAcercamiento, armarMensajeDespacho, type MensajeInstrucciones } from './mensajes';
import type { LadoViaje } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// MANDARLE AL OPERADOR LA CALLE DE INSTRUCCIONES — al despachar y al acercarse a la planta.
//
//   · NUNCA LANZA. El viaje ya existe y esa es la operación que el jefe pidió: un convenio mal capturado, una base sin
//     migrar o un WhatsApp caído se loguean y se dicen en el resultado, no deshacen el despacho (mismo criterio que
//     `avisarAlChofer` en `crearViaje`).
//   · CLAIM PRIMERO: el envío se reclama con un UPDATE condicionado ANTES de mandar (ver `reclamarEnvio`). Quien pierde
//     no manda nada: dos corridas del cron, o dos gestos, no le mandan dos veces la misma calle de instrucciones.
//   · Sale por `enviarConFallback`: texto dentro de la ventana de 24 h, plantilla fuera de ella.
//   · Un rechazo REINTENTABLE (429, bloqueo temporal) libera el reclamo para que la corrida siguiente lo intente; uno que
//     no lo es (plantilla sin aprobar, número inválido) deja el reclamo puesto: no se repite el mismo fallo cada 5 min.
//     El motivo queda en el log y en el resultado.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoEnvioInstrucciones =
  | { estado: 'enviado'; canal: 'texto' | 'botones' | 'plantilla' }
  | { estado: 'sin_convenio' | 'sin_instrucciones' | 'ya_enviado' | 'sin_destinatario' | 'perdido' | 'no_disponible' | 'viaje_cerrado' }
  | { estado: 'rechazado'; motivo: string; reintentable: boolean }
  | { estado: 'fallo'; motivo: string };

export interface PuertosEnvio {
  ligar(tenantId: string, viajeId: string): Promise<ResultadoLigar>;
  ligado(tenantId: string, viajeId: string): Promise<ViajeLigado | null>;
  contexto(tenantId: string, viajeId: string): Promise<ContextoEnvio | null>;
  reclamar(tenantId: string, viajeId: string, cual: Envio, ahora: Date): Promise<'ganado' | 'perdido' | 'fallo'>;
  cerrar(tenantId: string, viajeId: string, cual: Envio, canal: 'texto' | 'botones' | 'plantilla', ahora: Date): Promise<void>;
  liberar(tenantId: string, viajeId: string, cual: Envio): Promise<void>;
  reiniciar(tenantId: string, viajeId: string): Promise<void>;
  enviar(telefono: string, m: MensajeInstrucciones, contexto: string, tenantId: string, ahora: Date): Promise<ResultadoEnvioConFallback>;
}

export const puertosEnvioReales: PuertosEnvio = {
  ligar: (t, v) => ligarConvenioAViaje(t, v),
  ligado: leerLigado,
  contexto: leerContextoEnvio,
  reclamar: reclamarEnvio,
  cerrar: cerrarEnvio,
  liberar: liberarEnvio,
  reiniciar: reiniciarEnvios,
  enviar: (telefono, m, contexto, tenantId, ahora) => enviarConFallback(telefono, { texto: m.texto, plantilla: m.plantilla, contexto, tenantId, ahora }),
};

async function enviarInstrucciones(
  tenantId: string, viajeId: string, cual: Envio, p: PuertosEnvio, ahora: Date,
): Promise<ResultadoEnvioInstrucciones> {
  try {
    // El despacho LIGA (fotografía) el convenio; el acercamiento solo lee la foto que el despacho dejó.
    let ligado: ViajeLigado | null;
    if (cual === 'despacho') {
      const r = await p.ligar(tenantId, viajeId);
      if (r.estado === 'viaje_no_encontrado' || r.estado === 'sin_convenio') {
        if (r.estado === 'sin_convenio') logger.info('convenios.sin_convenio', { viajeId, motivo: r.motivo });
        return { estado: 'sin_convenio' };
      }
      ligado = r.ligado;
    } else {
      ligado = await p.ligado(tenantId, viajeId);
      if (!ligado) return { estado: 'sin_convenio' };
    }
    const yaEnviado = cual === 'despacho' ? ligado.despachoEnviado : cual === 'acercamiento_origen' ? ligado.acercamientoOrigenEnviado : ligado.acercamientoDestinoEnviado;
    if (yaEnviado) return { estado: 'ya_enviado' };

    const ctx = await p.contexto(tenantId, viajeId);
    if (!ctx) return { estado: 'sin_convenio' };
    if (ctx.estatus === 'liquidado') return { estado: 'viaje_cerrado' };
    if (!ctx.telefono) {
      logger.warn('convenios.sin_destinatario', { viajeId, cual });
      return { estado: 'sin_destinatario' };
    }
    const base = { operadorNombre: ctx.operadorNombre, folio: ctx.folio, origen: ctx.origen, destino: ctx.destino };
    const mensaje = cual === 'despacho'
      ? armarMensajeDespacho(base, ligado.instrucciones)
      : armarMensajeAcercamiento(base, ligado.instrucciones, cual === 'acercamiento_origen' ? 'origen' : 'destino');
    if (!mensaje) return { estado: 'sin_instrucciones' };

    const reclamo = await p.reclamar(tenantId, viajeId, cual, ahora);
    if (reclamo === 'perdido') return { estado: 'perdido' };
    if (reclamo === 'fallo') return { estado: 'fallo', motivo: 'no se pudo reclamar el envío' };

    const r = await p.enviar(ctx.telefono, mensaje, `convenios.${cual}`, tenantId, ahora);
    if (r.ok) {
      await p.cerrar(tenantId, viajeId, cual, r.via, ahora);
      return { estado: 'enviado', canal: r.via };
    }
    if (r.reintentable) await p.liberar(tenantId, viajeId, cual);
    logger.warn('convenios.envio_rechazado', { viajeId, cual, motivo: r.motivo, reintentable: r.reintentable });
    return { estado: 'rechazado', motivo: r.mensaje, reintentable: r.reintentable };
  } catch (e) {
    if (e instanceof ConveniosNoDisponibles) return { estado: 'no_disponible' };
    const motivo = e instanceof Error ? e.message : String(e);
    logger.error('convenios.envio_fallo', { viajeId, cual, err: motivo });
    return { estado: 'fallo', motivo };
  }
}

/** Al despachar: liga el convenio al viaje (foto de instrucciones) y manda las de `despacho`/`ambos` al operador. */
export function despacharInstrucciones(tenantId: string, viajeId: string, p: PuertosEnvio = puertosEnvioReales, ahora: Date = new Date()): Promise<ResultadoEnvioInstrucciones> {
  return enviarInstrucciones(tenantId, viajeId, 'despacho', p, ahora);
}

/** Al acercarse a la planta del `lado`: manda las de `acercamiento`/`ambos` de ESA planta, una vez POR PLANTA (cada una con su sello). */
export function acercarInstrucciones(tenantId: string, viajeId: string, lado: LadoViaje, p: PuertosEnvio = puertosEnvioReales, ahora: Date = new Date()): Promise<ResultadoEnvioInstrucciones> {
  return enviarInstrucciones(tenantId, viajeId, lado === 'origen' ? 'acercamiento_origen' : 'acercamiento_destino', p, ahora);
}

/**
 * Se cambió (o se puso por primera vez) el operador de un viaje ya existente: le llegan SUS instrucciones del convenio.
 *
 *   · Primera asignación (`operadorAnteriorId` null, el viaje se creó sin chofer): no hay nada ligado todavía; liga el convenio
 *     y manda, igual que al crear el viaje con operador.
 *   · Reasignación a otro chofer: los sellos de lo ya enviado se reinician y todo vuelve a salir hacia el nuevo, una vez.
 *   · Mismo operador (el gesto no cambió nada) o `cambio: false`: no manda nada, para no duplicar el mensaje.
 *
 * NUNCA LANZA y no deshace la reasignación (el viaje ya cambió de manos); el resultado dice qué pasó para quien quiera contarlo.
 */
export async function instruccionesAlCambiarOperador(
  tenantId: string, viajeId: string, cambio: { cambio: boolean; operadorAnteriorId: string | null } | void,
  p: PuertosEnvio = puertosEnvioReales, ahora: Date = new Date(),
): Promise<ResultadoEnvioInstrucciones | { estado: 'sin_cambio' }> {
  // Quien no informa el cambio (un doble de prueba, un llamador viejo) se trata como «cambió»: peor es no mandarlas.
  if (cambio && cambio.cambio === false) return { estado: 'sin_cambio' };
  try {
    if (cambio && cambio.operadorAnteriorId) await p.reiniciar(tenantId, viajeId);
    return await enviarInstrucciones(tenantId, viajeId, 'despacho', p, ahora);
  } catch (e) {
    if (e instanceof ConveniosNoDisponibles) return { estado: 'no_disponible' };
    const motivo = e instanceof Error ? e.message : String(e);
    logger.error('convenios.reasignar_fallo', { viajeId, err: motivo });
    return { estado: 'fallo', motivo };
  }
}
