// ═══════════════════════════════════════════════════════════════════════════
// «VER COMO» SOLO LECTURA — F9, CT-ENT-01.
//
// Un superadmin que mira la flota de un cliente (`?tenant=`, o la flota elegida en /admin/elegir-flota) hoy puede ESCRIBIR en ella
// por las mismas server actions del dueño. Mirar y operar son cosas distintas: para un cliente enterprise, «soporte de Likida vio mi
// panel» y «soporte de Likida cambió mi panel» no son lo mismo, y la segunda tiene que ser una decisión visible, no un efecto lateral.
//
// DECISIÓN DE JAVIER PENDIENTE: apagado por omisión (soporte hoy opera dentro de flotas). Se enciende con
// `LIKIDA_VER_COMO_SOLO_LECTURA=activo`. Encendido, toda acción de escritura atada a la flota (`resolverTenantAtadoAccion`,
// `resolverTenantAtadoOLanza`, `resolverTenantAtadoFirmado`) rechaza una sesión REAL de superadmin sobre una flota real. La flota demo
// (`tenantNombre === null`) no cuenta: probar en la demo no es tocar a un cliente.
// ═══════════════════════════════════════════════════════════════════════════

export const DIGEST_VER_COMO_SOLO_LECTURA = 'LIKIDA_VER_COMO_SOLO_LECTURA';

export const MENSAJE_VER_COMO_SOLO_LECTURA =
  'Estás viendo esta flota como superadmin de Likida: el modo «ver como» es de solo lectura. No se guardó nada.';

export function verComoSoloLecturaActivo(env: Record<string, string | undefined> = process.env): boolean {
  return (env.LIKIDA_VER_COMO_SOLO_LECTURA ?? '').trim().toLowerCase() === 'activo';
}

/** PURA. ¿Esta sesión resuelta es un superadmin mirando una flota real? (`rolReal` lo pone `resolverTenantEfectivo`). */
export function esVerComoDeFlotaReal(s: { rolReal?: string; tenantNombre?: string | null }): boolean {
  return s.rolReal === 'superadmin' && !!s.tenantNombre;
}

export class VerComoSoloLecturaError extends Error {
  readonly digest = DIGEST_VER_COMO_SOLO_LECTURA;
  constructor() {
    super(MENSAJE_VER_COMO_SOLO_LECTURA);
    this.name = 'VerComoSoloLecturaError';
  }
}

/** Lanza `VerComoSoloLecturaError` si la palanca está encendida y la sesión es «ver como» de una flota real. */
export function exigirEscrituraPermitida(
  s: { rolReal?: string; tenantNombre?: string | null },
  env: Record<string, string | undefined> = process.env,
): void {
  if (verComoSoloLecturaActivo(env) && esVerComoDeFlotaReal(s)) throw new VerComoSoloLecturaError();
}
