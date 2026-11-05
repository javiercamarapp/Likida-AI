import { createHash } from 'node:crypto';
import { logger } from '@/lib/logger';
import { enviarCorreo } from '@/lib/correo/enviar';
import type { Correo } from '@/lib/correo/plantilla';
import { enmascararCorreo, type EnvioCorreoPuerto } from '../liquidacion_externa/entrega_correo';
import type { AvisoPeajes, CanalAvisoPeajes } from './aviso_canal';

// ═══════════════════════════════════════════════════════════════════════════
// EL CANAL DE CORREO DE LOS AVISOS PROACTIVOS DE PEAJES (A2, ronda 4).
//
// Se engancha en el punto de extensión de `aviso_canal.ts` y REUTILIZA el transporte de correo de la Liquidación
// (`EnvioCorreoPuerto` / `enviarCorreo` de Resend y el enmascarado de `entrega_correo.ts`): no hay otra infraestructura de correo.
//
// CONFIGURACIÓN (sin migración): jsonb `peaje_atipico_config.umbrales.correo_avisos` de la flota —
//   { activo: boolean, destinatarios: string[] (≤5), asunto: string|null, noEnviarAntes: 'AAAA-MM-DD'|null }
// Lo lee/escribe `repo.ts` (`leerCorreoAvisos` / `guardarCorreoAvisos`) con las reglas de este archivo.
//
// FAIL-CERRADO: sin configuración, apagado, o sin ningún destinatario válido, el canal no tiene a quién mandarle y NO envía
// (el barrido lo cuenta como «sin destinatario»/omitido). Resend sin configurar tampoco cuenta como enviado.
// Idempotencia: un correo por destinatario con `Idempotency-Key` = tipo + flota + clave del aviso (periodo/umbral) + destinatario;
// el reintento tras un corte ambiguo repite la misma llave y Resend no lo duplica. El sello `peaje_aviso_enviado` del barrido
// evita además el reenvío entre corridas.
// ═══════════════════════════════════════════════════════════════════════════

export const MAX_DESTINATARIOS_CORREO_AVISOS = 5;
/** Intentos por destinatario dentro de UNA pasada del cron (el cron vuelve a pasar cada ~15 min con el sello soltado). */
export const MAX_INTENTOS_CORREO_AVISO = 3;
const ESPERA_ENTRE_INTENTOS_MS = [1_000, 3_000];
const MAX_ASUNTO = 120;

export interface ConfigCorreoAvisos {
  activo: boolean;
  destinatarios: string[];
  /** Asunto fijo de la flota; `null` = el asunto sobrio por tipo de aviso. */
  asunto: string | null;
  /** Fecha de corte (AAAA-MM-DD): no se avisa de archivos cuyo periodo terminó antes. `null` = sin corte. */
  noEnviarAntes: string | null;
}

export const CONFIG_CORREO_AVISOS_DEFAULT: ConfigCorreoAvisos = { activo: false, destinatarios: [], asunto: null, noEnviarAntes: null };

const RE_CORREO = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const limpiarAsunto = (s: unknown): string | null => {
  if (typeof s !== 'string') return null;
  const t = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_ASUNTO).trim();
  return t === '' ? null : t;
};

export type ValidadoCorreoAvisos = { ok: true; valor: ConfigCorreoAvisos } | { ok: false; motivo: string };

/** Valida lo que llega de una pantalla/API (rechaza con mensaje llano; no «arregla»). `null`/`undefined` = todo apagado. */
export function validarCorreoAvisos(entrada: unknown): ValidadoCorreoAvisos {
  if (entrada == null) return { ok: true, valor: { ...CONFIG_CORREO_AVISOS_DEFAULT } };
  if (typeof entrada !== 'object' || Array.isArray(entrada)) return { ok: false, motivo: 'La configuración de correo no es válida.' };
  const e = entrada as Record<string, unknown>;
  if (e.activo !== undefined && typeof e.activo !== 'boolean') return { ok: false, motivo: 'Indica si el correo está encendido (sí o no).' };
  const crudos = e.destinatarios === undefined ? [] : e.destinatarios;
  if (!Array.isArray(crudos)) return { ok: false, motivo: 'Los destinatarios deben ser una lista de correos.' };
  const destinatarios: string[] = [];
  for (const d of crudos) {
    const c = typeof d === 'string' ? d.trim() : '';
    if (!RE_CORREO.test(c)) return { ok: false, motivo: `«${typeof d === 'string' ? d.slice(0, 60) : ''}» no parece un correo válido.` };
    if (!destinatarios.some((x) => x.toLowerCase() === c.toLowerCase())) destinatarios.push(c);
  }
  if (destinatarios.length > MAX_DESTINATARIOS_CORREO_AVISOS) return { ok: false, motivo: `Máximo ${MAX_DESTINATARIOS_CORREO_AVISOS} destinatarios.` };
  const corte = e.noEnviarAntes == null || e.noEnviarAntes === '' ? null : e.noEnviarAntes;
  if (corte !== null && !(typeof corte === 'string' && RE_FECHA.test(corte) && !Number.isNaN(Date.parse(`${corte}T00:00:00Z`)))) {
    return { ok: false, motivo: 'La fecha de corte debe ser AAAA-MM-DD.' };
  }
  const activo = e.activo === true;
  if (activo && destinatarios.length === 0) return { ok: false, motivo: 'Para encender el correo indica al menos un destinatario.' };
  return { ok: true, valor: { activo, destinatarios, asunto: limpiarAsunto(e.asunto), noEnviarAntes: corte as string | null } };
}

/** Lo guardado en la base, leído con tolerancia: una fila corrupta NO enciende nada (cae a apagado). */
export function correoAvisosEfectivo(guardado: unknown): ConfigCorreoAvisos {
  const v = validarCorreoAvisos(guardado);
  return v.ok ? v.valor : { ...CONFIG_CORREO_AVISOS_DEFAULT };
}

/** El asunto: el de la flota o uno sobrio por tipo. Nunca lleva importes. */
export function asuntoAviso(cfg: Pick<ConfigCorreoAvisos, 'asunto'>, tipo: AvisoPeajes['tipo']): string {
  return cfg.asunto ?? (tipo === 'plazo' ? 'Peajes: cobros sin reclamar cerca de su plazo' : 'Peajes: falta el archivo de cobros de una decena');
}

const SIN_DATOS = 'Sin datos para detallar este aviso. Abre Peajes para revisarlo.';

/** El correo SOBRIO: el mismo texto del aviso, sin emojis ni la liga incrustada (la liga va en el botón). Texto vacío = «sin datos». */
export function armarCorreoAviso(aviso: AvisoPeajes, asunto: string): Correo {
  const cuerpo = aviso.texto
    .split(aviso.liga).join('')
    .replace(/^[^\p{L}\p{N}$]+/u, '')
    .replace(/\s*Rev[ií]salo:\s*\.?\s*$/i, '')
    .replace(/:\s*\.\s*/g, '. ')
    .replace(/\s+/g, ' ').trim();
  return {
    asunto,
    avance: aviso.resumen || 'Aviso de Peajes',
    titulo: 'Aviso de Peajes',
    parrafos: [cuerpo === '' ? SIN_DATOS : cuerpo, 'Aviso automático. Es una señal para revisar; no afirma que ningún cobro sea indebido.'],
    boton: { texto: 'Abrir Peajes', href: aviso.liga },
  };
}

const hash12 = (s: string): string => createHash('sha256').update(s.toLowerCase()).digest('hex').slice(0, 12);

/** La llave estable entre reintentos: tipo + flota + clave del aviso (archivo/umbral o decena) + destinatario. `null` si el aviso no trae clave. */
export function llaveAvisoCorreo(aviso: Pick<AvisoPeajes, 'tenantId' | 'tipo' | 'clave'>, destinatario: string): string | null {
  return aviso.clave ? `peajes:${aviso.tipo}:${aviso.tenantId}:${aviso.clave}:${hash12(destinatario)}`.slice(0, 250) : null;
}

const esTransitorio = (status: number | undefined): boolean =>
  status === 408 || status === 409 || status === 425 || status === 429 || (status !== undefined && status >= 500);

export interface DepsCanalCorreoPeajes {
  leerConfig: (tenantId: string) => Promise<ConfigCorreoAvisos>;
  enviar?: EnvioCorreoPuerto;
  esperar?: (ms: number) => Promise<void>;
}

/** El canal de correo. Un correo por destinatario; `true` solo si TODOS lo aceptaron (los que ya salieron no se duplican al reintentar). */
export function canalCorreoPeajes(deps: DepsCanalCorreoPeajes): CanalAvisoPeajes {
  const enviar = deps.enviar ?? ((para, correo, op) => enviarCorreo(para, correo, op));
  const esperar = deps.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const configs = new Map<string, ConfigCorreoAvisos>();
  return {
    nombre: 'correo',
    async destinatario(tenantId) {
      const c = await deps.leerConfig(tenantId);
      if (!c.activo || c.destinatarios.length === 0) return null;
      configs.set(tenantId, c);
      return c.destinatarios.join(',');
    },
    async enviar(destinatarios, aviso) {
      const cfg = configs.get(aviso.tenantId) ?? (await deps.leerConfig(aviso.tenantId));
      if (!cfg.activo) return false;
      const correo = armarCorreoAviso(aviso, asuntoAviso(cfg, aviso.tipo));
      let todos = true;
      for (const dest of destinatarios.split(',').map((d) => d.trim()).filter(Boolean)) {
        const llave = llaveAvisoCorreo(aviso, dest);
        let aceptado = false;
        for (let intento = 1; intento <= MAX_INTENTOS_CORREO_AVISO && !aceptado; intento++) {
          const r = await enviar(dest, correo, { sobrio: true, ...(llave ? { idempotencyKey: llave } : {}) });
          if (r.ok) { aceptado = true; break; }
          const ambiguo = r.motivo === 'red' && !r.previoAConexion;
          // Reintento acotado: solo lo transitorio; un corte ambiguo solo se repite con llave (si no, podría duplicar).
          const reintentable = (r.motivo === 'rechazado' && esTransitorio(r.status)) || (r.motivo === 'red' && (!ambiguo || llave !== null));
          logger.warn('peajes.aviso_correo_fallo', { tenant: aviso.tenantId, tipo: aviso.tipo, para: enmascararCorreo(dest), motivo: r.motivo, intento, reintentable });
          if (!reintentable || intento >= MAX_INTENTOS_CORREO_AVISO) break;
          await esperar(ESPERA_ENTRE_INTENTOS_MS[intento - 1] ?? 3_000);
        }
        if (!aceptado) todos = false;
      }
      return todos;
    },
  };
}
