// ═══════════════════════════════════════════════════════════════════════════
// LA VENTANA DE 24 H DE WHATSAPP, POR CONTACTO (migración 0360).
//
// WhatsApp solo entrega texto libre y botones dentro de las 24 h posteriores al
// ÚLTIMO mensaje del usuario; fuera de ellas solo entra una plantilla aprobada.
// Aquí vive el registro de ese último mensaje (lo escribe el webhook) y su
// lectura (la usa `enviarConFallback`).
//
// ── ES UNA CACHÉ DE UNA VERDAD QUE ES DE META ──────────────────────────────
// Por eso NADA de este archivo lanza, y un fallo de lectura es `desconocida`, no
// `cerrada`: el selector, ante la duda, prueba texto y cae a plantilla (lo que
// hacía `avisarOficina` antes de existir esta tabla). Fallar «cerrado» aquí
// significaría mandar plantillas —que se cobran— a quien sí tiene ventana, o
// peor, no mandar nada.
//
// ── ORDEN Y DUPLICADOS ─────────────────────────────────────────────────────
// Meta reentrega el POST completo y puede entregar fuera de orden. La función SQL
// solo AVANZA la hora (greatest) y recorta horas futuras al reloj de la base:
// registrar dos veces lo mismo, o un mensaje viejo después de uno nuevo, no
// cambia nada, y un `timestamp` hostil no puede alargar la ventana.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';

export const VENTANA_HORAS = 24;
const VENTANA_MS = VENTANA_HORAS * 3_600_000;

export type EstadoVentana = 'abierta' | 'cerrada' | 'desconocida';

export interface VentanaContacto {
  estado: EstadoVentana;
  ultimoEntranteEn: string | null;
  expiraEn: string | null;
}

/** Misma regla que `wa_normalizar_telefono` (SQL) y `destinatarioWhatsApp`:
 *  521 + 10 dígitos → 52 + 10 dígitos. */
export function normalizarTelefonoWa(telefono: string): string {
  const d = String(telefono ?? '').replace(/[^\d]/g, '');
  const mx = /^521(\d{10})$/.exec(d);
  return mx ? `52${mx[1]}` : d;
}

const FORMA_TELEFONO = /^[1-9]\d{7,14}$/;

/** Decisión pura: la misma que `ventana_estado_wa` en SQL (24 h exactas = cerrada). */
export function estadoDeVentana(ultimoEntrante: Date | null, ahora: Date): VentanaContacto {
  if (!ultimoEntrante || Number.isNaN(ultimoEntrante.getTime())) {
    return { estado: 'desconocida', ultimoEntranteEn: null, expiraEn: null };
  }
  const expira = new Date(ultimoEntrante.getTime() + VENTANA_MS);
  return {
    estado: ultimoEntrante.getTime() > ahora.getTime() - VENTANA_MS ? 'abierta' : 'cerrada',
    ultimoEntranteEn: ultimoEntrante.toISOString(),
    expiraEn: expira.toISOString(),
  };
}

/** ¿Está abierta la ventana de este contacto? Nunca lanza; sin dato → `desconocida`. */
export async function ventanaDeContacto(telefono: string, ahora: Date = new Date()): Promise<VentanaContacto> {
  const desconocida: VentanaContacto = { estado: 'desconocida', ultimoEntranteEn: null, expiraEn: null };
  try {
    if (!FORMA_TELEFONO.test(normalizarTelefonoWa(telefono))) return desconocida;
    const { data, error } = await acotada(supabaseAdmin().rpc('ventana_estado_wa', {
      p_telefono: telefono, p_ahora: ahora.toISOString(),
    }), 'wa.ventana.leer');
    if (error) {
      logger.warn('wa.ventana.lectura_fallo', { err: error.message });
      return desconocida;
    }
    const fila = (Array.isArray(data) ? data[0] : data) as
      { estado?: string; ultimo_entrante_en?: string | null; expira_en?: string | null } | null | undefined;
    if (!fila || !['abierta', 'cerrada', 'desconocida'].includes(String(fila.estado))) return desconocida;
    return {
      estado: fila.estado as EstadoVentana,
      ultimoEntranteEn: fila.ultimo_entrante_en ?? null,
      expiraEn: fila.expira_en ?? null,
    };
  } catch (e) {
    logger.warn('wa.ventana.lectura_lanzo', { err: e instanceof Error ? e.message : String(e) });
    return desconocida;
  }
}

export interface EntranteVentana {
  from: string;
  /** Hora de META (epoch ms). Sin ella se usa `recibidoMs` y, en último caso, ahora. */
  timestampMs?: number;
  recibidoMs?: number;
  waMessageId?: string;
}

/**
 * Anota el último mensaje entrante de cada contacto del lote. Un RPC por
 * teléfono (el más reciente del lote); idempotente y a prueba de desorden — ver
 * la cabecera. NUNCA lanza ni bloquea al webhook: el 200 a Meta no depende de
 * esto, y la caché se rehace con el siguiente mensaje.
 */
export async function registrarEntrantesWhatsApp(
  mensajes: EntranteVentana[],
  ahora: () => number = Date.now,
): Promise<{ registrados: number; fallidos: number }> {
  const porTelefono = new Map<string, { en: number; wamid?: string }>();
  for (const m of mensajes) {
    const tel = normalizarTelefonoWa(m.from);
    if (!FORMA_TELEFONO.test(tel)) continue;
    const bruto = m.timestampMs ?? m.recibidoMs ?? ahora();
    // Una hora ilegible o futura no puede alargar la ventana (la base también la recorta).
    const en = Number.isFinite(bruto) && bruto > 0 ? Math.min(bruto, ahora()) : ahora();
    const previo = porTelefono.get(tel);
    if (!previo || en > previo.en) porTelefono.set(tel, { en, wamid: m.waMessageId });
  }
  let registrados = 0;
  let fallidos = 0;
  await Promise.all([...porTelefono.entries()].map(async ([tel, v]) => {
    try {
      const { error } = await acotada(supabaseAdmin().rpc('registrar_entrante_wa', {
        p_telefono: tel, p_en: new Date(v.en).toISOString(), p_wamid: v.wamid ?? null,
      }), 'wa.ventana.registrar');
      if (error) { fallidos++; logger.warn('wa.ventana.registro_fallo', { err: error.message }); }
      else registrados++;
    } catch (e) {
      fallidos++;
      logger.warn('wa.ventana.registro_lanzo', { err: e instanceof Error ? e.message : String(e) });
    }
  }));
  return { registrados, fallidos };
}

export interface DecisionEnvio {
  tenantId?: string | null;
  contexto: string;
  telefono: string;
  ventana: EstadoVentana;
  canal: 'texto' | 'botones' | 'plantilla' | 'ninguno';
  motivo: string;
  plantilla?: string | null;
  ok: boolean;
  codigoMeta?: number | null;
}

/** Deja constancia de POR QUÉ un aviso salió por un canal u otro. Nunca lanza. */
export async function registrarDecisionEnvio(d: DecisionEnvio): Promise<void> {
  try {
    const digitos = String(d.telefono ?? '').replace(/[^\d]/g, '');
    const { error } = await acotada(supabaseAdmin().from('wa_envio_registro').insert({
      tenant_id: d.tenantId ?? null,
      contexto: d.contexto.slice(0, 120) || 'sin_contexto',
      contacto_ult4: digitos.slice(-4),
      ventana: d.ventana,
      canal: d.canal,
      motivo: d.motivo.slice(0, 80),
      plantilla: d.plantilla ?? null,
      ok: d.ok,
      codigo_meta: d.codigoMeta ?? null,
    }), 'wa.envio_registro');
    if (error) logger.warn('wa.envio_registro_fallo', { err: error.message });
  } catch (e) {
    logger.warn('wa.envio_registro_lanzo', { err: e instanceof Error ? e.message : String(e) });
  }
}
