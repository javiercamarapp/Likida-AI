// ═══════════════════════════════════════════════════════════════════════════
// RESUMEN DE NEGOCIO — la consola de superadmin, no el panel de una flota.
//
// Cruza TODOS los tenants a propósito: es la única función del repo con
// permiso de ver toda la base a la vez. `usd()` (formato.ts) ya lo advierte
// en su propio comentario — "nunca para el cliente" — y esta es la primera
// pantalla que de verdad lo pinta: costo de IA en dólares, por fase, de
// Likida completa. Vive fuera de analytics.ts (tenant-scoped en cada línea)
// para que nadie copie un patrón de aquí a una consulta de cliente y filtre
// de menos.
//
// Sin paginación: hoy son 131 filas de llm_costo y 1 tenant. El día que
// crezca de verdad, esto necesita el mismo `traerTodo` que ya usa
// analytics.ts — no antes.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { round2 } from '@/lib/formato';

export interface ResumenNegocio {
  tenants: number;
  viajesProcesados: number;
  costoIaUsd: number;
  tokensIn: number;
  tokensOut: number;
  porFase: Array<{ fase: string; n: number; costoUsd: number }>;
}

export async function getResumenNegocio(): Promise<ResumenNegocio> {
  const admin = supabaseAdmin();
  const [tenantsRes, viajesRes, costoRes] = await Promise.all([
    admin.from('tenant').select('id'),
    admin.from('viaje').select('id'),
    admin.from('llm_costo').select('fase, tokens_in, tokens_out, costo_usd'),
  ]);
  // Los tres fallan POR VALOR (supabase-js), no lanzando: sin este chequeo
  // explícito, una base caída se lee "0 tenants, $0 gastados" — que es
  // indistinguible de que Likida de verdad no tiene nada, el mismo error que
  // ya se cerró para el panel de una flota (analytics.ts).
  if (tenantsRes.error) throw new Error(`getResumenNegocio/tenant: ${tenantsRes.error.message}`);
  if (viajesRes.error) throw new Error(`getResumenNegocio/viaje: ${viajesRes.error.message}`);
  if (costoRes.error) throw new Error(`getResumenNegocio/llm_costo: ${costoRes.error.message}`);

  const filas = (costoRes.data ?? []) as Array<{ fase: string; tokens_in: number; tokens_out: number; costo_usd: number }>;
  const porFaseMap = new Map<string, { n: number; costoUsd: number }>();
  let costoIaUsd = 0, tokensIn = 0, tokensOut = 0;
  for (const f of filas) {
    costoIaUsd += Number(f.costo_usd);
    tokensIn += Number(f.tokens_in);
    tokensOut += Number(f.tokens_out);
    const acc = porFaseMap.get(f.fase) ?? { n: 0, costoUsd: 0 };
    acc.n += 1;
    acc.costoUsd += Number(f.costo_usd);
    porFaseMap.set(f.fase, acc);
  }
  const porFase = [...porFaseMap.entries()]
    .map(([fase, v]) => ({ fase, n: v.n, costoUsd: round2(v.costoUsd) }))
    .sort((a, b) => b.costoUsd - a.costoUsd);

  return {
    tenants: (tenantsRes.data ?? []).length,
    viajesProcesados: (viajesRes.data ?? []).length,
    costoIaUsd: round2(costoIaUsd),
    tokensIn,
    tokensOut,
    porFase,
  };
}
