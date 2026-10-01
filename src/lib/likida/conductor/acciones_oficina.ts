import { TZ_MX } from '@/lib/formato';
import { puedeAsignar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import {
  atenderEscalacionOficina, capturarHitoOficina, validarHitoOficina, type Actor, type ResultadoAccion,
} from './repo_validacion';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES DEL JEFE DE TRÁFICO SOBRE UN HITO — capturarlo a mano, validarlo y
// marcar atendida su escalación. Todas con MOTIVO obligatorio y bitácora (quién,
// cuándo y por qué se escribe en la MISMA transacción que el cambio: 0385).
//
// ── PERMISOS ───────────────────────────────────────────────────────────────
// Mover una hora que el sistema le atribuye a un chofer, o validar lo que él dijo, es
// un acto de operación: dueño, encargado y superadmin (`puedeAsignar`). El contador no
// ve ni la pantalla (área `operacion`), y un rol desconocido nunca puede (fail closed).
// El permiso se comprueba AQUÍ además de en la página: una acción de servidor es un
// endpoint, y un botón oculto no es un control de acceso.
// ═══════════════════════════════════════════════════════════════════════════

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 200;

export type AccionPedida =
  | { tipo: 'capturar'; hitoId: string; hora: Date; motivo: string }
  | { tipo: 'validar'; hitoId: string; motivo: string }
  | { tipo: 'atender'; viajeId: string; motivo: string };

export type ResultadoOficina = { ok: true; mensaje: string } | { ok: false; error: string };

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * «2026-10-02T14:32» (lo que manda un `datetime-local`) es hora de MÉXICO, no del servidor: se convierte con
 * la zona de la flota. Devuelve `null` si no es una fecha-hora real (el 31 de febrero no existe).
 */
export function horaMxAUtc(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  const comoUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const prueba = new Date(comoUtc);
  if (prueba.getUTCFullYear() !== y || prueba.getUTCMonth() !== mo - 1 || prueba.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null;
  // Se busca el instante cuyo reloj de México marca esa hora (sin suponer el huso: ya no hay horario de verano, pero la
  // frontera norte lo conserva en algunos municipios y TZ_MX es la zona de la flota).
  const marca = (t: number): number => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ_MX, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)?.value ?? '0');
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
  };
  let t = comoUtc - (marca(comoUtc) - comoUtc);
  t = t - (marca(t) - comoUtc);
  return new Date(t);
}

/** Valida lo que llega de un formulario. El motivo se recorta y no admite caracteres de control. */
export function leerAccion(fd: { get(k: string): unknown }): { ok: AccionPedida } | { error: string } {
  const tipo = texto(fd.get('tipo'));
  const motivo = texto(fd.get('motivo')).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (motivo.length < MOTIVO_MIN) return { error: `Escribe el motivo (mínimo ${MOTIVO_MIN} letras): queda en la bitácora junto con tu nombre y la hora.` };
  if (motivo.length > MOTIVO_MAX) return { error: `El motivo admite hasta ${MOTIVO_MAX} caracteres.` };

  if (tipo === 'atender') {
    const viajeId = texto(fd.get('viajeId'));
    if (!UUID.test(viajeId)) return { error: 'No reconozco el viaje.' };
    return { ok: { tipo, viajeId: viajeId.toLowerCase(), motivo } };
  }
  const hitoId = texto(fd.get('hitoId'));
  if (!UUID.test(hitoId)) return { error: 'No reconozco el hito.' };
  if (tipo === 'validar') return { ok: { tipo, hitoId: hitoId.toLowerCase(), motivo } };
  if (tipo === 'capturar') {
    const hora = horaMxAUtc(texto(fd.get('hora')));
    if (!hora) return { error: 'Escribe la fecha y la hora del hito (hora de México).' };
    return { ok: { tipo, hitoId: hitoId.toLowerCase(), hora, motivo } };
  }
  return { error: 'No reconozco la acción.' };
}

export interface DepsAcciones {
  capturar: typeof capturarHitoOficina;
  validar: typeof validarHitoOficina;
  atender: typeof atenderEscalacionOficina;
}
export const depsAccionesReales: DepsAcciones = { capturar: capturarHitoOficina, validar: validarHitoOficina, atender: atenderEscalacionOficina };

export interface ContextoOficina {
  tenantId: string;
  rol: string;
  usuarioId: string | null;
  email: string | null;
}

const RESPUESTA: Record<Exclude<ResultadoAccion, 'ok'>, string> = {
  hito_cambio: 'Ese hito ya cambió (el chofer lo reportó, o alguien más lo atendió): recarga la pantalla y revisa.',
  hora_invalida: 'Esa hora no sirve: no puede ser futura ni anterior a la aceptación del viaje.',
  fallo: 'No pude guardarlo ahorita. Intenta de nuevo en un momento.',
};

export async function ejecutarAccionOficina(
  ctx: ContextoOficina, a: AccionPedida, ahora: Date = new Date(), deps: DepsAcciones = depsAccionesReales,
): Promise<ResultadoOficina> {
  if (!puedeAsignar(ctx.rol)) return { ok: false, error: 'Solo el dueño de la flota o el jefe de tráfico pueden hacer esto.' };
  // Sin correo no hay firma: la bitácora exige quién lo hizo, y «alguien» no es una firma.
  if (!ctx.email) return { ok: false, error: 'No pude identificar tu cuenta para firmar la bitácora. Vuelve a iniciar sesión.' };
  const actor: Actor = { usuarioId: ctx.usuarioId, email: ctx.email };
  try {
    if (a.tipo === 'atender') {
      const n = await deps.atender(ctx.tenantId, a.viajeId, actor, a.motivo, ahora);
      if (n === null) return { ok: false, error: RESPUESTA.fallo };
      return n > 0
        ? { ok: true, mensaje: 'Listo: la escalación quedó marcada como atendida y el agente deja de insistir por este viaje.' }
        : { ok: false, error: 'No había nada pendiente de atender en ese viaje (ya estaba atendido o el chofer ya respondió).' };
    }
    const r = a.tipo === 'capturar'
      ? await deps.capturar(ctx.tenantId, a.hitoId, a.hora, actor, a.motivo, ahora)
      : await deps.validar(ctx.tenantId, a.hitoId, actor, a.motivo, ahora);
    if (r !== 'ok') return { ok: false, error: RESPUESTA[r] };
    return { ok: true, mensaje: a.tipo === 'capturar' ? 'Listo: el hito quedó capturado por la oficina, con tu nombre y el motivo en la bitácora.' : 'Listo: el hito quedó validado por la oficina.' };
  } catch (e) {
    logger.error('conductor.accion_oficina_fallo', { tipo: a.tipo, err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: RESPUESTA.fallo };
  }
}
