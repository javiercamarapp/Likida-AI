// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES DE SERVIDOR ATADAS A LA FLOTA QUE LA PANTALLA PINTÓ (MX-002 / PT-02).
//
// Una acción de servidor vuelve a resolver la flota cuando se envía el
// formulario. Para un superadmin sin `?tenant=` eso es la cookie de selección,
// COMPARTIDA entre pestañas: elegir la flota Y en otra pestaña hacía que «Emitir»
// o «Timbrar» en la pestaña de la flota X escribiera sobre Y. El hueco vive en
// las acciones de dinero y de plazo legal, por eso aquí hay UNA sola puerta
// obligatoria para ellas y una prueba (`tenant_atado_arquitectura.test.ts`) que
// enumera las acciones de la lista cerrada y falla si una no la llama.
//
// Dos formas, la misma regla («la flota que se pintó es la flota donde se escribe»):
//
//  1. CLOSURE (acciones declaradas dentro de la página): `resolverTenantAtadoAccion
//     (RUTA, sp, tenantId)` con el `tenantId` que la página resolvió al pintar. Next
//     cifra lo capturado por closure; nunca viaja en claro ni lo decide el cliente.
//
//  2. MÓDULO (`'use server'` a nivel de archivo, sin closure): la pantalla firma la
//     flota pintada (`firmarFlotaPintada`) y la manda en un campo oculto
//     (`CAMPO_FLOTA_PINTADA`); la acción la verifica con `resolverTenantAtadoFirmado`.
//     La firma liga flota + usuario + caducidad con la misma llave HMAC de la cookie
//     de selección (`LIKIDA_FLOTA_COOKIE_LLAVE`): no es transferible a otro usuario.
//
// Para una sesión que NO es superadmin la atadura es trivial —su flota es la
// única que existe para ella—, así que un campo ausente no la bloquea (no se
// rompe a los dueños si la llave no está configurada); uno PRESENTE y distinto sí.
// Para un superadmin el campo es obligatorio: sin él, o con otra flota, se niega.
// Cualquier negativa se dice con `MENSAJE_FLOTA_CAMBIO`.
// ═══════════════════════════════════════════════════════════════════════════
import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolverTenantEfectivo, type TenantEfectivo } from './tenant-efectivo';
import { MENSAJE_FLOTA_CAMBIO, CAMPO_FLOTA_PINTADA, DIGEST_FLOTA_CAMBIO } from './flota_cambio';
import { getSessionTenant } from './session';

export { MENSAJE_FLOTA_CAMBIO, CAMPO_FLOTA_PINTADA };
/** Una pantalla abierta más de esto ya no puede escribir sin recargar. */
export const TTL_FLOTA_PINTADA_MS = 2 * 60 * 60 * 1000;

type Sp = { vista?: string; tenant?: string; rol?: string } | undefined;

function llave(): string | null {
  const l = process.env.LIKIDA_FLOTA_COOKIE_LLAVE;
  return l && l.trim() ? l : null;
}

function mac(l: string, tenantId: string, userId: string, expira: number): string {
  return createHmac('sha256', l).update(`flota-pintada.${tenantId}.${userId}.${expira}`, 'utf8').digest('base64url');
}

/** Firma la flota que la pantalla está pintando para este usuario. `null` si no hay llave (se dice, no se esconde). */
export function firmarFlotaPintada(tenantId: string, userId: string, ahoraMs: number = Date.now()): string | null {
  const l = llave();
  if (!l || !tenantId || !userId) return null;
  const expira = ahoraMs + TTL_FLOTA_PINTADA_MS;
  return `fp1.${tenantId}.${expira}.${mac(l, tenantId, userId, expira)}`;
}

/** La flota que trae un valor firmado, o `null` si la firma no cuadra, caducó, es de otro usuario o está mal formado. */
export function flotaPintadaVerificada(valor: unknown, userId: string, ahoraMs: number = Date.now()): string | null {
  if (typeof valor !== 'string' || !valor) return null;
  const l = llave();
  if (!l) return null;
  const partes = valor.split('.');
  if (partes.length !== 4 || partes[0] !== 'fp1') return null;
  const [, tenantId, expiraCrudo, firma] = partes;
  const expira = Number(expiraCrudo);
  if (!tenantId || !Number.isFinite(expira) || ahoraMs > expira) return null;
  // TextEncoder (UTF-8, los mismos bytes que el Buffer de texto): no confundirse con una consulta directa a Supabase en el guardian de la frontera.
  const codificar = new TextEncoder();
  const esperada = codificar.encode(mac(l, tenantId, userId, expira));
  const recibida = codificar.encode(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
  return tenantId;
}

/**
 * Forma 1 (closure). Igual que `resolverTenantEfectivo` pero devuelve `null`
 * si la flota de ahora no es la que la pantalla pintó. La acción debe negarse
 * con `MENSAJE_FLOTA_CAMBIO` y NO escribir nada.
 */
export async function resolverTenantAtadoAccion(
  destino: string,
  sp: Sp,
  tenantRenderizado: string,
): Promise<TenantEfectivo | null> {
  const s = await resolverTenantEfectivo(destino, sp);
  return s.tenantId === tenantRenderizado ? s : null;
}

/** La flota cambió bajo los pies de la pantalla: la acción se niega y NO escribe nada (MX-002). */
export class FlotaCambioError extends Error {
  /** Next conserva un `digest` ya puesto al serializar el error al cliente; el mensaje y el nombre no sobreviven en producción. */
  readonly digest = DIGEST_FLOTA_CAMBIO;
  constructor() {
    super(MENSAJE_FLOTA_CAMBIO);
    this.name = 'FlotaCambioError';
  }
}

/**
 * Forma 1 para acciones que no tienen una forma propia de decir «no» (devuelven resultados de tipos muy distintos o `void`):
 * igual que `resolverTenantAtadoAccion`, pero LANZA `FlotaCambioError` en vez de devolver `null`. La acción no llega a escribir:
 * el lanzamiento corta antes de cualquier efecto. Es el caso raro (un superadmin con dos pestañas en flotas distintas); para el
 * resto de los roles la atadura es trivial y nunca se dispara.
 */
export async function resolverTenantAtadoOLanza(
  destino: string,
  sp: Sp,
  tenantRenderizado: string,
): Promise<TenantEfectivo> {
  const s = await resolverTenantAtadoAccion(destino, sp, tenantRenderizado);
  if (!s) throw new FlotaCambioError();
  return s;
}

/**
 * Forma 3 (páginas que resuelven la flota por su cuenta, como el detalle de
 * liquidación `/dashboard/[id]`, cuya ruta dinámica no pasa por
 * `resolverTenantEfectivo`): la flota que la acción acaba de resolver tiene
 * que ser la que la página pintó. `false` = negarse con `MENSAJE_FLOTA_CAMBIO`.
 */
export function exigirFlotaPintada(tenantResuelto: string | null | undefined, tenantRenderizado: string): boolean {
  return !!tenantResuelto && tenantResuelto === tenantRenderizado;
}

/**
 * Forma 2 (módulo). `flotaFirmada` es lo que vino en `CAMPO_FLOTA_PINTADA`.
 * Se resuelve la sesión apuntando a la flota firmada (un superadmin queda
 * impersonando exactamente la que vio, con su firma de bitácora) y se exige que
 * la resolución caiga en ella.
 */
export async function resolverTenantAtadoFirmado(
  destino: string,
  flotaFirmada: unknown,
): Promise<TenantEfectivo | null> {
  // La identidad sale de la sesión real, nunca del cliente.
  const real = await getSessionTenant();
  if (!real) return null;
  const pintada = flotaPintadaVerificada(flotaFirmada, real.userId);

  if (real.rol !== 'superadmin') {
    // Su flota es la de su sesión. Una firma válida que diga otra cosa es una manipulación.
    if (pintada && real.tenantId && pintada !== real.tenantId) return null;
    return resolverTenantEfectivo(destino, undefined);
  }
  // Superadmin: sin la flota firmada que vio, o con otra distinta a la que se resuelve, no se escribe.
  if (!pintada) return null;
  const s = await resolverTenantEfectivo(destino, { tenant: pintada });
  return s.tenantId === pintada ? s : null;
}
