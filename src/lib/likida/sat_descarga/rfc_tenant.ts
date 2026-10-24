// ═══════════════════════════════════════════════════════════════════════════
// A37-S57-01 / A37-S18-01 (CRÍTICO): EL RFC DEL BUZÓN SE ATA AL TENANT.
//
// La cuenta del PAC es UNA para todas las flotas, y su bóveda de e.firma está
// indexada por RFC. Si el RFC del buzón se tomara de lo que teclea la flota
// (forma de RFC y nada más), la flota A podía declarar el RFC de la flota B
// —que es público, sale en cada CFDI— y bajar e ingerir su buzón: fuga de
// datos fiscales entre flotas.
//
// El ÚNICO RFC verificado de un tenant es `tenant.rfc`: la columna que alimenta
// la validación de receptor del motor (`config.ts`) y que ninguna pantalla de
// la flota escribe (la fija el alta/onboarding del lado de Likida). NO se usa
// `flota_fiscal.rfc`: ése lo captura la propia flota desde su pantalla de
// timbrado, así que no prueba nada.
//
// Ante la duda se rechaza: sin `tenant.rfc` no se declara ningún buzón, y un
// RFC distinto del fiscal del tenant exige que Likida lo autorice cargando
// primero `tenant.rfc`.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';

export function normalizarRfc(v: unknown): string {
  return typeof v === 'string' ? v.trim().toUpperCase() : '';
}

/** El RFC fiscal verificado del tenant (`tenant.rfc`), o `null` si no hay. */
export async function rfcFiscalDelTenant(tenantId: string): Promise<string | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('tenant').select('rfc').eq('id', tenantId).maybeSingle(), 'sat_descarga.rfc_fiscal_tenant');
  if (error) throw new Error(error.message);
  const rfc = normalizarRfc((data as { rfc?: unknown } | null)?.rfc);
  return rfc === '' ? null : rfc;
}

/** `tenant.rfc` de varias flotas en una sola consulta (el barrido del cron). */
export async function rfcsFiscalesDeTenants(ids: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (ids.length === 0) return mapa;
  const { data, error } = await acotada(supabaseAdmin()
    .from('tenant').select('id, rfc').in('id', ids).order('id').limit(ids.length + 1), 'sat_descarga.rfcs_fiscales');
  if (error) throw new Error(error.message);
  for (const f of (data ?? []) as Array<{ id: string; rfc?: unknown }>) {
    const rfc = normalizarRfc(f.rfc);
    if (rfc !== '') mapa.set(f.id, rfc);
  }
  return mapa;
}

export const MENSAJE_RFC_NO_VERIFICADO =
  'Likida todavía no tiene verificado el RFC fiscal de tu flota, así que no puede abrir tu buzón del SAT. Pídele a tu contacto de Likida que lo registre y vuelve a intentarlo.';

export function mensajeRfcAjeno(): string {
  return 'El RFC del buzón tiene que ser el RFC fiscal verificado de tu flota. Con otro RFC —aunque sea de tu grupo— Likida no abre el buzón sin que antes lo autorice tu contacto de Likida.';
}
