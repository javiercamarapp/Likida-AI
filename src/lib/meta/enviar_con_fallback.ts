// ═══════════════════════════════════════════════════════════════════════════
// EL SELECTOR CENTRAL DE CANAL: texto/botones si la ventana de 24 h está
// abierta, plantilla si no — y constancia del motivo.
//
// Todo aviso que LIKIDA INICIA (jefe de tráfico, cobranza, escalación, «Mis
// reglas», relojes legales) pasa por aquí en vez de llamar a `sendText`:
//
//   · ventana ABIERTA      → texto (o botones). Si Meta aun así lo rechaza por
//                            ventana (el registro estaba viejo), plantilla.
//   · ventana CERRADA      → plantilla directa. Se evita la llamada de texto que
//                            Meta rechazaría con 131047 y la latencia que cuesta.
//   · ventana DESCONOCIDA  → texto y, si Meta lo rechaza por ventana, plantilla
//                            (el comportamiento de `avisarOficina` de siempre:
//                            un contacto sin fila puede tener la ventana abierta).
//
// ── LO QUE NO CAMBIA ───────────────────────────────────────────────────────
//   · Nunca lanza.
//   · Un rechazo que NO es de ventana (429, número inválido, red) NO cae a
//     plantilla: si es reintentable el texto ya quedó en `wa_outbox`, y mandar
//     además la plantilla duplicaría el aviso. El llamador recibe `reintentable`
//     para no consumir un sello/tier (RES-1).
//   · `ok:true` solo si Meta ACEPTÓ el mensaje (aceptado ≠ entregado).
//   · Cada decisión deja una fila en `wa_envio_registro` (motivo, canal, ventana)
//     y una línea de log — sin el teléfono completo.
// ═══════════════════════════════════════════════════════════════════════════
import { logger } from '@/lib/logger';
import { ventanaDeContacto, registrarDecisionEnvio, type EstadoVentana } from '@/lib/likida/wa_ventana';
import {
  enviarTexto, enviarBotones, sendTemplate, esReintentableMeta, motivoDeFalloWhatsApp,
  type BotonAcuse, type EnvioWhatsApp,
} from './client';
import type { OpcionesPlantilla } from './plantilla_payload';

/** Rechazos de Meta que significan «fuera de la ventana de 24 h / el destinatario
 *  no abrió conversación»: solo una plantilla los atraviesa. */
export const CODIGOS_FUERA_VENTANA: readonly number[] = [131047, 131026, 131042];

export function esFueraDeVentana(codigo?: number): boolean {
  return codigo !== undefined && CODIGOS_FUERA_VENTANA.includes(codigo);
}

/** (#132001) la plantilla no existe o no está aprobada. */
const PLANTILLA_NO_APROBADA = 132001;

export type MotivoEnvio =
  | 'ventana_abierta'
  | 'ventana_desconocida'
  | 'ventana_cerrada'
  | 'ventana_abierta_rechazada_por_meta'
  | 'ventana_desconocida_rechazada_por_meta'
  | 'ventana_cerrada_plantilla_no_aprobada_texto'
  | 'rechazo_no_ventana'
  | 'plantilla_rechazada';

export interface PlantillaRespaldo extends OpcionesPlantilla {
  nombre: string;
  idioma?: string;
}

export interface OpcionesEnvioConFallback {
  /** El mensaje completo para cuando se puede mandar texto libre. */
  texto: string;
  /** Si se dan, dentro de ventana salen como botones de respuesta rápida. */
  botones?: BotonAcuse[];
  /** Lo único que entra fuera de ventana. */
  plantilla: PlantillaRespaldo;
  /** Quién avisa («reglas.vigilante», «cobranza», …), para el registro. */
  contexto: string;
  tenantId?: string | null;
  ahora?: Date;
}

export type ResultadoEnvioConFallback =
  | { ok: true; via: 'texto' | 'botones' | 'plantilla'; id: string | null; motivo: MotivoEnvio; ventana: EstadoVentana }
  | {
    ok: false;
    motivo: MotivoEnvio;
    /** Lo que el encargado puede accionar, en palabras. */
    mensaje: string;
    codigo?: number;
    /** Código con que Meta rechazó el TEXTO (cuando se intentó) antes de la plantilla. */
    codigoTexto?: number;
    status?: number;
    /** El texto rebotó por ventana y la plantilla tampoco salió. */
    fueraDeVentana: boolean;
    /** «Vuelve más tarde» (429, bloqueo temporal): no consumir sellos/tiers. */
    reintentable: boolean;
    ventana: EstadoVentana;
  };

export async function enviarConFallback(
  telefono: string,
  op: OpcionesEnvioConFallback,
): Promise<ResultadoEnvioConFallback> {
  const ventana = await ventanaDeContacto(telefono, op.ahora);

  const enviarLibre = (): Promise<EnvioWhatsApp> => (
    op.botones && op.botones.length > 0
      ? enviarBotones(telefono, op.texto, op.botones)
      : enviarTexto(telefono, op.texto)
  );
  const viaLibre: 'texto' | 'botones' = op.botones && op.botones.length > 0 ? 'botones' : 'texto';
  const { nombre, idioma, ...resto } = op.plantilla;

  const registrar = async (r: ResultadoEnvioConFallback, canal: 'texto' | 'botones' | 'plantilla' | 'ninguno', codigo?: number) => {
    logger.info('wa.envio_con_fallback', {
      contexto: op.contexto, ventana: ventana.estado, canal, motivo: r.motivo, ok: r.ok, codigo,
    });
    await registrarDecisionEnvio({
      tenantId: op.tenantId, contexto: op.contexto, telefono, ventana: ventana.estado,
      canal, motivo: r.motivo, plantilla: canal === 'plantilla' ? nombre : null, ok: r.ok, codigoMeta: codigo,
    });
    return r;
  };

  const conPlantilla = async (motivoOk: MotivoEnvio, estadoTexto?: { codigo?: number; status?: number }): Promise<ResultadoEnvioConFallback> => {
    const p = await sendTemplate(telefono, nombre, { idioma, ...resto });
    if (p.ok) return registrar({ ok: true, via: 'plantilla', id: p.id, motivo: motivoOk, ventana: ventana.estado }, 'plantilla');

    // Plantilla sin aprobar con la ventana «cerrada» según el registro: el registro
    // puede estar viejo (el webhook anota con mejor esfuerzo). Un texto cuesta una
    // llamada y es lo único que aún podría entregar; si de verdad está cerrada,
    // Meta contesta 131047 y se reporta el motivo de la plantilla.
    if (ventana.estado === 'cerrada' && p.codigo === PLANTILLA_NO_APROBADA) {
      const t = await enviarLibre();
      if (t.ok) {
        return registrar({ ok: true, via: viaLibre, id: t.id, motivo: 'ventana_cerrada_plantilla_no_aprobada_texto', ventana: ventana.estado }, viaLibre);
      }
    }

    const reintentable = esReintentableMeta(p.codigo) || esReintentableMeta(undefined, estadoTexto?.status);
    return registrar({
      ok: false, motivo: 'plantilla_rechazada', mensaje: motivoDeFalloWhatsApp(p.error, p.codigo),
      codigo: p.codigo, codigoTexto: estadoTexto?.codigo, status: estadoTexto?.status, fueraDeVentana: true, reintentable, ventana: ventana.estado,
    }, 'ninguno', p.codigo);
  };

  try {
    if (ventana.estado === 'cerrada') return await conPlantilla('ventana_cerrada');

    const t = await enviarLibre();
    if (t.ok) {
      return await registrar({
        ok: true, via: viaLibre, id: t.id,
        motivo: ventana.estado === 'abierta' ? 'ventana_abierta' : 'ventana_desconocida',
        ventana: ventana.estado,
      }, viaLibre);
    }

    if (!esFueraDeVentana(t.codigo)) {
      // Rechazo que NO es de ventana: si es reintentable ya quedó en el outbox y
      // una plantilla duplicaría el aviso; si no, una plantilla no lo arregla.
      return await registrar({
        ok: false, motivo: 'rechazo_no_ventana',
        mensaje: t.codigo !== undefined ? motivoDeFalloWhatsApp(t.error, t.codigo) : t.error,
        codigo: t.codigo, status: t.status, fueraDeVentana: false,
        reintentable: esReintentableMeta(t.codigo, t.status), ventana: ventana.estado,
      }, 'ninguno', t.codigo);
    }

    return await conPlantilla(
      ventana.estado === 'abierta' ? 'ventana_abierta_rechazada_por_meta' : 'ventana_desconocida_rechazada_por_meta',
      { codigo: t.codigo, status: t.status },
    );
  } catch (e) {
    // Los envíos no lanzan; esto es el cinturón (p. ej. una variable de entorno
    // de Meta ausente lanza dentro de `token()` antes del fetch).
    const error = e instanceof Error ? e.message : 'error inesperado al enviar';
    logger.error('wa.envio_con_fallback.lanzo', { contexto: op.contexto, error });
    return {
      ok: false, motivo: 'rechazo_no_ventana', mensaje: error, fueraDeVentana: false, reintentable: false, ventana: ventana.estado,
    };
  }
}
