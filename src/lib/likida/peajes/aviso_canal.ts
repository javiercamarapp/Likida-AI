import { logger } from '@/lib/logger';
import { quedoEnCola } from './aviso_en_cola';
import { avisarOficina, parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';

// ═══════════════════════════════════════════════════════════════════════════
// EL CANAL DE LOS AVISOS PROACTIVOS DE PEAJES — PUNTO DE EXTENSIÓN.
//
// Hoy sale por UN canal: WhatsApp de la oficina (`avisarOficina`: texto en ventana de 24 h, plantilla
// `aviso_operacion_v1` fuera). El destinatario es el teléfono que la flota capturó en «A quién se avisa»
// (el mismo de los cruces atípicos); sin él no se manda nada.
//
// ► DÓNDE ENGANCHAR EL CORREO (lo construye el carril A3 como módulo genérico): agregar un segundo
//   `CanalAvisoPeajes` a `CANALES_AVISO_PEAJES` que reciba el mismo `AvisoPeajes` (tipo, texto, resumen, liga).
//   `enviarPorCanales` ya entrega el aviso a todos los canales configurados y cuenta como enviado si ALGUNO lo
//   aceptó; el sello de «avisar una sola vez» (`peaje_aviso_enviado`) no depende del canal. El destinatario de correo
//   tendrá que salir de la configuración de la flota (hoy solo existe el teléfono).
// ═══════════════════════════════════════════════════════════════════════════

export interface AvisoPeajes {
  tenantId: string;
  tipo: 'plazo' | 'recordatorio_archivo';
  /** El texto completo (WhatsApp en ventana; correo). */
  texto: string;
  /** ≤ 60 caracteres: el parámetro de la plantilla de WhatsApp. */
  resumen: string;
  /** Liga a la pantalla de peajes. */
  liga: string;
}

export interface CanalAvisoPeajes {
  nombre: string;
  /** ¿Este canal tiene a quién mandarle? (WhatsApp: el teléfono.) */
  destinatario: (tenantId: string) => Promise<string | null>;
  /** `true` = el canal lo aceptó (o lo dejó en cola para entregarlo solo). Nunca lanza. */
  enviar: (destinatario: string, aviso: AvisoPeajes) => Promise<boolean>;
}

/** El canal actual: WhatsApp de la oficina. El teléfono lo entrega el llamador (`telefonoPorFlota`). */
export function canalWhatsAppPeajes(telefonoPorFlota: (tenantId: string) => Promise<string | null>): CanalAvisoPeajes {
  return {
    nombre: 'whatsapp',
    destinatario: telefonoPorFlota,
    async enviar(tel, a) {
      const r = await avisarOficina(tel, a.texto, {
        parametros: parametrosAvisoOficina('Peajes', a.resumen, a.liga),
        contexto: { tenantId: a.tenantId, agente: 'peajes', aviso: a.tipo },
      });
      // En cola del outbox = enviado: saldrá solo, y soltar el sello lo duplicaría.
      if (quedoEnCola(r)) { logger.warn('peajes.aviso_en_cola', { tenant: a.tenantId, tipo: a.tipo }); return true; }
      if (!r.ok) logger.error('peajes.aviso_rechazado', { tenant: a.tenantId, tipo: a.tipo, motivo: r.motivo, codigo: r.codigo });
      return r.ok;
    },
  };
}

/** Manda el aviso por todos los canales que tengan destinatario. `false` si ninguno lo aceptó o no había a quién. */
export async function enviarPorCanales(canales: readonly CanalAvisoPeajes[], aviso: AvisoPeajes): Promise<'enviado' | 'sin_destinatario' | 'fallido'> {
  let hubo = false;
  let ok = false;
  for (const c of canales) {
    let dest: string | null = null;
    try { dest = await c.destinatario(aviso.tenantId); } catch (e) {
      logger.error('peajes.aviso_destinatario', { tenant: aviso.tenantId, canal: c.nombre, err: e instanceof Error ? e.message : String(e) });
      continue;
    }
    if (!dest) continue;
    hubo = true;
    try { if (await c.enviar(dest, aviso)) ok = true; } catch (e) {
      logger.error('peajes.aviso_canal', { tenant: aviso.tenantId, canal: c.nombre, err: e instanceof Error ? e.message : String(e) });
    }
  }
  return ok ? 'enviado' : hubo ? 'fallido' : 'sin_destinatario';
}
