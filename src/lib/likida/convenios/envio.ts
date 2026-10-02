import { logger } from '@/lib/logger';
import { enviarConFallback, type ResultadoEnvioConFallback } from '@/lib/meta/enviar_con_fallback';
import {
  cerrarEnvio, ConveniosNoDisponibles, leerContextoEnvio, leerLigado, ligarConvenioAViaje, liberarEnvio, reclamarEnvio,
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
  enviar(telefono: string, m: MensajeInstrucciones, contexto: string, tenantId: string, ahora: Date): Promise<ResultadoEnvioConFallback>;
}

export const puertosEnvioReales: PuertosEnvio = {
  ligar: (t, v) => ligarConvenioAViaje(t, v),
  ligado: leerLigado,
  contexto: leerContextoEnvio,
  reclamar: reclamarEnvio,
  cerrar: cerrarEnvio,
  liberar: liberarEnvio,
  enviar: (telefono, m, contexto, tenantId, ahora) => enviarConFallback(telefono, { texto: m.texto, plantilla: m.plantilla, contexto, tenantId, ahora }),
};

async function enviarInstrucciones(
  tenantId: string, viajeId: string, cual: Envio, lado: LadoViaje | null, p: PuertosEnvio, ahora: Date,
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
    if (cual === 'despacho' ? ligado.despachoEnviado : ligado.acercamientoEnviado) return { estado: 'ya_enviado' };

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
      : armarMensajeAcercamiento(base, ligado.instrucciones, lado ?? 'destino');
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
  return enviarInstrucciones(tenantId, viajeId, 'despacho', null, p, ahora);
}

/** Al acercarse a la planta del `lado`: manda las de `acercamiento`/`ambos` de ESA planta. */
export function acercarInstrucciones(tenantId: string, viajeId: string, lado: LadoViaje, p: PuertosEnvio = puertosEnvioReales, ahora: Date = new Date()): Promise<ResultadoEnvioInstrucciones> {
  return enviarInstrucciones(tenantId, viajeId, 'acercamiento', lado, p, ahora);
}
