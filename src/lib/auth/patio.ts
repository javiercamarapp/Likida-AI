// ═══════════════════════════════════════════════════════════════════════════
// EL ALCANCE DE PATIO DEL JEFE DE TRÁFICO (W2 «producto», mig. 0460).
//
// `puedeEditarCatalogoOperativo` (permisos.ts) dice si el ROL puede corregir
// operadores, unidades y jornadas. Esto dice HASTA DÓNDE: un encargado con patio
// asignado (`app_user.terminal_id`) solo toca lo de su patio; sin patio ve y
// corrige toda la flota (el jefe de oficina central), y el dueño y el soporte de
// Likida nunca están acotados.
//
// FALLA CERRADO. Si el rol es encargado y su patio no se pudo leer, el alcance
// es `null` —niega todo—: «no sé de qué patio es» no es «es de toda la flota».
//
// Y SE DECIDE CON LA BASE, no con el formulario: el patio del registro lo lee
// `terminalDeRegistro` (terminales.ts) por id y tenant. Un POST directo que
// invente un `terminalId` no mueve el alcance.
// ═══════════════════════════════════════════════════════════════════════════

import { DatoInvalido } from '@/lib/likida/errores';
import { terminalDeUsuario } from '@/lib/likida/terminales';
import { puedeEditarCatalogoOperativo } from './permisos';

export type AlcancePatio =
  | { tipo: 'flota' }
  | { tipo: 'patio'; terminalId: string };

/**
 * El alcance de quien opera, o `null` si no puede editar el catálogo (rol sin
 * el permiso, o un jefe cuyo patio no se pudo leer).
 *
 * Solo se consulta el patio cuando el rol efectivo es encargado. Un superadmin
 * que PREVISUALIZA el panel como encargado (`?rol=encargado`) no tiene fila de
 * encargado en esa flota: su patio no se encuentra y el alcance es `null`
 * (niega) — la previsualización se queda en lectura, que es lo seguro.
 */
export async function alcanceDePatio(
  tenantId: string,
  userId: string,
  rol: string,
): Promise<AlcancePatio | null> {
  if (!puedeEditarCatalogoOperativo(rol)) return null;
  if (rol !== 'encargado') return { tipo: 'flota' };
  let terminalId: string | null | undefined;
  try {
    terminalId = await terminalDeUsuario(tenantId, userId);
  } catch {
    terminalId = undefined;
  }
  if (terminalId === undefined) return null;
  return terminalId === null ? { tipo: 'flota' } : { tipo: 'patio', terminalId };
}

/** ¿Un registro con este patio cae dentro del alcance? Con alcance de patio, un
 *  registro SIN patio NO cae: lo sin asignar es del dueño o de la oficina central. */
export function dentroDelAlcance(alcance: AlcancePatio | null, terminalDelRegistro: string | null): boolean {
  if (!alcance) return false;
  if (alcance.tipo === 'flota') return true;
  return terminalDelRegistro === alcance.terminalId;
}

/** El patio con que se CREA un registro: el del jefe si lo tiene (no puede
 *  crear fuera de su patio), el pedido si la flota entera es suya. */
export function patioParaCrear(alcance: AlcancePatio, pedido: string | null | undefined): string | null {
  if (alcance.tipo === 'patio') return alcance.terminalId;
  const p = (pedido ?? '').trim();
  return p === '' ? null : p;
}

/** El patio al que un jefe con patio puede MOVER un registro: solo al suyo. Con
 *  la flota entera, a cualquiera (el llamador lo resuelve contra la flota). */
export function movimientoPermitido(alcance: AlcancePatio, destino: string | null): boolean {
  if (alcance.tipo === 'flota') return true;
  return destino === alcance.terminalId;
}

export const MENSAJE_FUERA_DE_PATIO =
  'Ese registro no es de tu patio. Pídele a quien administra la flota que lo corrija o que te lo asigne.';

/** Lanza `DatoInvalido` (con el mensaje que la pantalla enseña tal cual) si el
 *  registro cae fuera del alcance. */
export function exigirDentroDelAlcance(alcance: AlcancePatio | null, terminalDelRegistro: string | null): void {
  if (!dentroDelAlcance(alcance, terminalDelRegistro)) throw new DatoInvalido(MENSAJE_FUERA_DE_PATIO);
}
