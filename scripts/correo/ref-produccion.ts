// A37-S02-07: el proyecto Supabase al que escribe aplicar-auth-supabase.ts no se
// DEDUCE en silencio de .env.local (que puede ser de staging mientras el
// endpoint del hook apunta a producción): se exige `--ref=<ref>` explícito y
// que sea el de producción, y si .env.local trae otro, se aborta.
import { PRODUCTION_REF } from '../ci/production-candidate.mjs';

export function validarRef(argv: string[], deducido: string | undefined): { ok: true; ref: string } | { ok: false; motivo: string } {
  const arg = argv.find((a) => a.startsWith('--ref='))?.slice('--ref='.length);
  if (!arg) return { ok: false, motivo: 'Falta --ref=<project ref>: el proyecto ya no se deduce de .env.local.' };
  if (arg !== PRODUCTION_REF) return { ok: false, motivo: `--ref=${arg} no es el proyecto de producción (${PRODUCTION_REF}); este script solo escribe a producción.` };
  if (deducido && deducido !== arg) return { ok: false, motivo: `NEXT_PUBLIC_SUPABASE_URL apunta a ${deducido}, no a ${arg}: .env.local no es de producción.` };
  return { ok: true, ref: arg };
}
