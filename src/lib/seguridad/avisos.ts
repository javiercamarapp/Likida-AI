import { appUrl } from '@/lib/env';
import { logger, redactarTexto } from '@/lib/logger';
import { enviarCorreo, correoConfigurado } from '@/lib/correo/enviar';
import { fechaHoraMx } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// EL BARRIDO DE AVISOS DE SEGURIDAD (CT-SEG-11).
//
// Hasta hoy ninguna fila de severidad `alta` de evento_seguridad le avisaba a
// nadie: el registro existía y el único lector era una pantalla que alguien tenía
// que abrir. Este barrido reclama en la base (0955, `reclamar_avisos_seguridad`)
// las filas `alta` que merecen correo y manda UN correo con todas.
//
// LOS LÍMITES DE AVISO viven en la base, no aquí, para que valgan con varias
// instancias: máximo 3 avisos por incidente, 1 hora entre dos, solo con
// repeticiones nuevas, solo filas maduras (60 s) y dentro de 24 h (el histórico
// previo a la migración jamás se avisa). Reclamar MARCA el aviso antes de enviar:
// si el correo no sale se pierde ese aviso (como mucho 3 intentos por incidente,
// nunca más) — por eso, sin canal (sin destinatario o sin correo configurado) NO se
// reclama: no se queman los avisos de un incidente que nadie va a poder leer.
//
// APAGADO POR OMISIÓN. Se enciende con SEGURIDAD_AVISOS=encendido (valor exacto,
// puesto a propósito por Javier en Vercel). Destinatarios: SEGURIDAD_EMAIL (varios,
// separados por coma) o, si no hay, ALERTA_EMAIL. Reusa el mismo mailer
// (`enviarCorreo`, Resend) que el resto de los avisos del operador.
// ═══════════════════════════════════════════════════════════════════════════

export const MAX_AVISOS_POR_INCIDENTE = 3;
const DIAS_RED = 30;
const MAX_FILAS_POR_CORREO = 20;

export function avisosSeguridadEncendidos(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SEGURIDAD_AVISOS === 'encendido';
}

export function destinatariosSeguridad(env: NodeJS.ProcessEnv = process.env): string[] {
  const crudo = env.SEGURIDAD_EMAIL?.trim() ? env.SEGURIDAD_EMAIL : env.ALERTA_EMAIL ?? '';
  return crudo.split(',').map((d) => d.trim()).filter((d) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d));
}

export interface ResultadoBarrido {
  estado: 'apagado' | 'sin_canal' | 'sin_migrar' | 'ok' | 'parcial' | 'error';
  reclamados: number;
  enviados: number;
  fallidos: number;
  error?: string;
}

const VACIO = { reclamados: 0, enviados: 0, fallidos: 0 };

function rpcAusente(e: { message?: string; code?: string }, nombre: string): boolean {
  return e.code === 'PGRST202' || e.code === '42883' || ((e.message ?? '').includes(nombre) && /could not find|does not exist|no existe/i.test(e.message ?? ''));
}

interface FilaAviso {
  id: string; origen: string; tipo: string; tenant_id: string | null; actor: string | null;
  creado_en: string; repeticiones: number; avisos_enviados: number;
}

function lineaDe(f: FilaAviso): [string, string] {
  const rep = f.repeticiones > 1 ? ` ×${f.repeticiones}` : '';
  const flota = f.tenant_id ? `flota ${f.tenant_id.slice(0, 8)}` : 'sin flota';
  const actor = f.actor ? ` · ${redactarTexto(f.actor).slice(0, 60)}` : '';
  const aviso = `aviso ${Math.min(f.avisos_enviados, MAX_AVISOS_POR_INCIDENTE)} de ${MAX_AVISOS_POR_INCIDENTE}${f.avisos_enviados >= MAX_AVISOS_POR_INCIDENTE ? ' (último: no habrá más de este incidente)' : ''}`;
  return [`${f.tipo.replace(/_/g, ' ')} · ${f.origen}${rep}`, `${fechaHoraMx(f.creado_en)} · ${flota}${actor} · ${aviso}`];
}

/** Reclama y avisa. Nunca lanza. Con el interruptor apagado no toca la base ni manda nada. */
export async function barrerAvisosSeguridad(opciones: { ahora?: Date } = {}): Promise<ResultadoBarrido> {
  if (!avisosSeguridadEncendidos()) return { estado: 'apagado', ...VACIO };
  try {
    const para = destinatariosSeguridad();
    if (para.length === 0 || !correoConfigurado()) {
      logger.warn('seguridad.avisos.sin_canal', { destinatarios: para.length, correo: correoConfigurado() });
      return { estado: 'sin_canal', ...VACIO };
    }
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    const { data, error } = await supabaseAdmin().rpc('reclamar_avisos_seguridad', {
      p_max_avisos: MAX_AVISOS_POR_INCIDENTE,
      p_limite: MAX_FILAS_POR_CORREO,
      p_ahora: (opciones.ahora ?? new Date()).toISOString(),
    });
    if (error) {
      if (rpcAusente(error, 'reclamar_avisos_seguridad')) return { estado: 'sin_migrar', ...VACIO };
      logger.warn('seguridad.avisos.reclamo_fallo', { err: error.message });
      return { estado: 'error', ...VACIO, error: error.message.slice(0, 200) };
    }
    const filas = (Array.isArray(data) ? data : []) as FilaAviso[];
    if (filas.length === 0) return { estado: 'ok', ...VACIO };

    const r = await enviarCorreo(para, {
      asunto: `[Likida] Seguridad: ${filas.length} incidente(s) de severidad alta`,
      avance: 'Eventos de severidad alta en el registro de seguridad; el detalle va adentro.',
      titulo: `${filas.length} incidente(s) de seguridad de severidad alta`,
      parrafos: [
        'El registro de seguridad de Likida marcó eventos de severidad alta. Cada línea es un incidente (la misma señal repetida se agrupa y se cuenta).',
        `De cada incidente llegan como máximo ${MAX_AVISOS_POR_INCIDENTE} avisos, con una hora entre uno y otro, y solo si hubo repeticiones nuevas.`,
      ],
      datos: filas.map(lineaDe),
      boton: { texto: 'Ver Trust & Safety', href: `${appUrl()}/admin/trust-safety` },
      tono: 'urgente',
      porQueLoRecibes: 'Recibes este aviso porque tu dirección está en SEGURIDAD_EMAIL (o en ALERTA_EMAIL si no hay otra): es el canal de seguridad del operador del sistema, no de una flota.',
    });
    if (!r.ok) {
      logger.warn('seguridad.avisos.no_salio', { motivo: r.motivo });
      return { estado: 'parcial', reclamados: filas.length, enviados: 0, fallidos: filas.length };
    }
    return { estado: 'ok', reclamados: filas.length, enviados: filas.length, fallidos: 0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('seguridad.avisos.fallo', { err: msg });
    return { estado: 'error', ...VACIO, error: msg.slice(0, 200) };
  }
}

/**
 * La retención de los datos de red: huella y user-agent se anonimizan a los 30 días (0955). Una vez al día basta.
 * Devuelve cuántas filas anonimizó, o null si no se pudo (sin la 0955 o con error): jamás un 0 inventado. Nunca lanza.
 */
export async function anonimizarRedEventosSeguridad(): Promise<number | null> {
  try {
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    const { data, error } = await supabaseAdmin().rpc('anonimizar_red_evento_seguridad', { p_dias: DIAS_RED });
    if (error) {
      if (!rpcAusente(error, 'anonimizar_red_evento_seguridad')) logger.warn('seguridad.anonimizar_fallo', { err: error.message });
      return null;
    }
    return typeof data === 'number' ? data : null;
  } catch (e) {
    logger.warn('seguridad.anonimizar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
