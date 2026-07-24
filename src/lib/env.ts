// Validación de variables de entorno — falla temprano con mensaje claro en
// vez de errores crípticos en runtime. Llamar en los paths críticos.

const GROUPS = {
  llm: ['OPENROUTER_API_KEY'],
  whatsapp: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET'],
  supabase: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
} as const;

export type EnvGroup = keyof typeof GROUPS;

/** Lanza si falta alguna env del grupo. Úsalo al arranque de un flujo. */
export function requireEnv(group: EnvGroup): void {
  const missing = GROUPS[group].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Config faltante (${group}): ${missing.join(', ')}. Revisa .env.local (ver .env.example).`);
  }
}

/** Reporte de configuración (para un health-check / panel admin). */
export function envHealth(): Record<EnvGroup, boolean> {
  return {
    llm: GROUPS.llm.every((k) => !!process.env[k]),
    whatsapp: GROUPS.whatsapp.every((k) => !!process.env[k]),
    supabase: GROUPS.supabase.every((k) => !!process.env[k]),
  };
}
