// Inventario de las variables de entorno cuya ausencia sí rompe algo, y quién
// falta de cada grupo.
//
// ═══════════════════════════════════════════════════════════════════════════
// POR QUÉ ESTO REPORTA Y YA NO LANZA (auditoría 5, MEDIO)
//
// Aquí vivía `requireEnv(group)`, que lanzaba con un mensaje claro y cuyo propio
// comentario decía «llamar en los paths críticos». Verificado con dos búsquedas
// distintas: la única aparición en todo el repo era su definición. Nunca se
// invocó. Un validador que nadie llama no es una defensa, es una promesa: al
// leer el archivo parece que la configuración está vigilada.
//
// No se le buscó un sitio donde lanzar, se cambió el mecanismo, por dos razones:
//
//   · Lanzar en el arranque de una función serverless no detiene nada — Vercel
//     vuelve a levantar la instancia en la siguiente petición. Convierte un
//     problema de configuración en una tormenta de 500 sin explicación, que es
//     peor que arrancar mal y decirlo.
//   · El resto del sistema ya decidió reportar en vez de lanzar cuando la
//     alternativa es tumbar el turno de un operador (`observability/arranque.ts`,
//     `cuadra/startup.ts`). Dos criterios distintos para lo mismo es lo que hace
//     que uno de los dos se ignore.
//
// Ahora `faltantes()` tiene un consumidor real: `avisarConfiguracionSilenciosa()`
// lo emite en el arranque de cada instancia desplegada. Si vuelve a quedarse sin
// llamar, sobra.
// ═══════════════════════════════════════════════════════════════════════════

const GROUPS = {
  llm: ['OPENROUTER_API_KEY'],
  whatsapp: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET'],
  supabase: ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
} as const;

export type EnvGroup = keyof typeof GROUPS;

const GRUPOS = Object.keys(GROUPS) as EnvGroup[];

/**
 * Qué variable falta de cada grupo. Objeto vacío = todo puesto.
 *
 * Devuelve NOMBRES, nunca valores: lo consume el log de arranque de producción.
 */
export function faltantes(): Partial<Record<EnvGroup, string[]>> {
  const out: Partial<Record<EnvGroup, string[]>> = {};
  for (const g of GRUPOS) {
    const sinPoner = GROUPS[g].filter((k) => !process.env[k]);
    if (sinPoner.length) out[g] = sinPoner;
  }
  return out;
}

/** Reporte de configuración (para un health-check / panel admin). */
export function envHealth(): Record<EnvGroup, boolean> {
  return {
    llm: GROUPS.llm.every((k) => !!process.env[k]),
    whatsapp: GROUPS.whatsapp.every((k) => !!process.env[k]),
    supabase: GROUPS.supabase.every((k) => !!process.env[k]),
  };
}
