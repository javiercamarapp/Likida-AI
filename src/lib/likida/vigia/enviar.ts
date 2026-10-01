// ═══════════════════════════════════════════════════════════════════════════
// LA ÚNICA SALIDA HACIA UN CLIENTE FINAL.
//
// Todo mensaje que el Vigía manda a un cliente pasa por `enviarAlCliente`, y esa
// función aplica los límites ANTES de tocar a Meta:
//
//   1. el agente de la flota está encendido;
//   2. el contacto está ACTIVO, con consentimiento y SIN baja (un cliente que
//      escribió BAJA, o que la flota dio de baja, no recibe nada más);
//   3. el texto no está vacío ni se pasa del tope;
//   4. la ventana de 24 h la decide el selector `enviarConFallback`: abierta →
//      texto; cerrada → la plantilla `vigia_respuesta_cliente_v1` del catálogo
//      (nunca un texto libre fuera de ventana). Una plantilla sin aprobar no se
//      «arregla» con texto: se devuelve el rechazo y queda en bitácora.
//
// `enviar` se inyecta para las pruebas; en producción es el selector real.
// ═══════════════════════════════════════════════════════════════════════════
import { opcionesDeEnvio, PLANTILLA } from '@/lib/meta/plantillas_catalogo';
import { enviarConFallback, type ResultadoEnvioConFallback } from '@/lib/meta/enviar_con_fallback';
import { aLineaPlantilla } from './redactor';
import type { Contacto } from './tipos';

/** Tope de un texto libre hacia el cliente (el de un mensaje cómodo de leer, no el de WhatsApp). */
export const MAX_TEXTO_AL_CLIENTE = 1000;
/** Tope del parámetro {{2}} de la plantilla. */
export const MAX_PARAMETRO_PLANTILLA = 300;

export type MotivoNoEnviado =
  | 'agente_apagado' | 'contacto_no_activo' | 'sin_consentimiento' | 'con_baja' | 'texto_vacio' | 'texto_demasiado_largo' | 'rechazado_por_meta';

export type ResultadoEnvioCliente =
  | { ok: true; via: 'texto' | 'botones' | 'plantilla'; id: string | null; ventana: 'abierta' | 'cerrada' | 'desconocida' }
  | { ok: false; motivo: MotivoNoEnviado; mensaje: string; reintentable: boolean };

export interface EntradaEnvioCliente {
  tenantId: string;
  contacto: Pick<Contacto, 'id' | 'tenantId' | 'telefono' | 'estado' | 'consentimientoEn' | 'optoutEn'>;
  texto: string;
  nombreFlota: string;
  agenteHabilitado: boolean;
}

export type Enviador = (telefono: string, op: Parameters<typeof enviarConFallback>[1]) => Promise<ResultadoEnvioConFallback>;

/** ¿Se le puede escribir a este contacto? Devuelve el motivo si no. PURA. */
export function puedeEscribirseA(
  c: EntradaEnvioCliente['contacto'], tenantId: string, agenteHabilitado: boolean,
): MotivoNoEnviado | null {
  if (!agenteHabilitado) return 'agente_apagado';
  // El contacto tiene que ser de ESTA flota: un id de contacto ajeno no recibe nada.
  if (c.tenantId !== tenantId) return 'contacto_no_activo';
  if (c.optoutEn) return 'con_baja';
  if (c.estado === 'baja') return 'con_baja';
  if (c.estado !== 'activo') return 'contacto_no_activo';
  if (!c.consentimientoEn) return 'sin_consentimiento';
  return null;
}

export async function enviarAlCliente(e: EntradaEnvioCliente, enviar: Enviador = enviarConFallback): Promise<ResultadoEnvioCliente> {
  const no = puedeEscribirseA(e.contacto, e.tenantId, e.agenteHabilitado);
  if (no) return { ok: false, motivo: no, mensaje: textoDeMotivo(no), reintentable: false };

  const texto = e.texto.trim();
  if (!texto) return { ok: false, motivo: 'texto_vacio', mensaje: textoDeMotivo('texto_vacio'), reintentable: false };
  if (texto.length > MAX_TEXTO_AL_CLIENTE) {
    return { ok: false, motivo: 'texto_demasiado_largo', mensaje: textoDeMotivo('texto_demasiado_largo'), reintentable: false };
  }

  const r = await enviar(e.contacto.telefono, {
    texto,
    plantilla: {
      nombre: PLANTILLA.vigiaRespuestaCliente,
      ...opcionesDeEnvio(PLANTILLA.vigiaRespuestaCliente, {
        cuerpo: [aLineaPlantilla(e.nombreFlota, 80), aLineaPlantilla(texto, MAX_PARAMETRO_PLANTILLA)],
      }),
    },
    contexto: 'vigia.cliente',
    tenantId: e.tenantId,
  });
  if (r.ok) return { ok: true, via: r.via, id: r.id, ventana: r.ventana };
  return { ok: false, motivo: 'rechazado_por_meta', mensaje: r.mensaje, reintentable: r.reintentable };
}

export function textoDeMotivo(m: MotivoNoEnviado): string {
  switch (m) {
    case 'agente_apagado': return 'El Vigía está apagado para esta flota.';
    case 'contacto_no_activo': return 'Ese contacto ya no está activo.';
    case 'sin_consentimiento': return 'Ese contacto no tiene constancia de consentimiento: no se le escribe.';
    case 'con_baja': return 'Ese contacto pidió la baja: no se le escribe.';
    case 'texto_vacio': return 'El mensaje está vacío.';
    case 'texto_demasiado_largo': return `El mensaje excede ${MAX_TEXTO_AL_CLIENTE} caracteres.`;
    case 'rechazado_por_meta': return 'WhatsApp rechazó el mensaje.';
  }
}
