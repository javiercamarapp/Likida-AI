// ═══════════════════════════════════════════════════════════════════════════
// A37-S57-01 / A37-S18-01 (CRÍTICO): EL RFC DEL BUZÓN SE ATA AL TENANT.
//
// La cuenta del PAC es UNA para todas las flotas, y su bóveda de e.firma está
// indexada por RFC. Si el RFC del buzón se tomara de lo que teclea la flota
// (forma de RFC y nada más), la flota A podía declarar el RFC de la flota B
// —que es público, sale en cada CFDI— y bajar e ingerir su buzón: fuga de
// datos fiscales entre flotas.
//
// A39-S57-01 (CRÍTICO): `tenant.rfc` NO sirve de ancla. Es el RFC del receptor
// de la factura de Likida a la flota y la propia flota lo edita desde
// Suscripción (`guardarDatosFiscales`): con él la flota A escribía el RFC de B
// y rodeaba este candado. El ÚNICO RFC verificado de un tenant es
// `tenant.rfc_sat_verificado` (0925): lo fija Likida (alta o UPDATE de Likida)
// y NINGUNA pantalla de la flota lo escribe (hay una prueba que lo vigila).
// Nace vacío: sin él no se abre ningún buzón. NO se usa `flota_fiscal.rfc`
// ni `tenant.rfc`: los captura la propia flota, así que no prueban nada.
//
// Ante la duda se rechaza: sin `tenant.rfc_sat_verificado` no se declara ningún
// buzón, y un RFC distinto del fiscal del tenant exige que Likida lo autorice
// cargando primero `tenant.rfc_sat_verificado`.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';

export function normalizarRfc(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : '';
}

/** El RFC verificado por Likida (`tenant.rfc_sat_verificado`), o `null` si no hay. */
export async function rfcFiscalDelTenant(tenantId: string): Promise<string | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('tenant').select('rfc_sat_verificado').eq('id', tenantId).maybeSingle(), 'sat_descarga.rfc_fiscal_tenant');
  if (error) throw new Error(error.message);
  const rfc = normalizarRfc((data as { rfc_sat_verificado?: unknown } | null)?.rfc_sat_verificado);
  return rfc === '' ? null : rfc;
}

/** `tenant.rfc_sat_verificado` de varias flotas en una sola consulta (el barrido del cron). */
export async function rfcsFiscalesDeTenants(ids: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (ids.length === 0) return mapa;
  const { data, error } = await acotada(supabaseAdmin()
    .from('tenant').select('id, rfc_sat_verificado').in('id', ids).order('id').limit(ids.length + 1), 'sat_descarga.rfcs_fiscales');
  if (error) throw new Error(error.message);
  for (const f of (data ?? []) as Array<{ id: string; rfc_sat_verificado?: unknown }>) {
    const rfc = normalizarRfc(f.rfc_sat_verificado);
    if (rfc !== '') mapa.set(f.id, rfc);
  }
  return mapa;
}

export const MENSAJE_RFC_NO_VERIFICADO =
  'Likida todavía no tiene verificado el RFC de tu flota para el buzón del SAT, así que no puede abrir tu buzón del SAT. Pídele a tu contacto de Likida que lo registre y vuelve a intentarlo.';

export function mensajeRfcAjeno(): string {
  return 'El RFC del buzón tiene que ser el RFC fiscal verificado de tu flota. Con otro RFC —aunque sea de tu grupo— Likida no abre el buzón sin que antes lo verifique tu contacto de Likida.';
}
