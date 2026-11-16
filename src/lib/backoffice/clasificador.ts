// CLASIFICADOR DE GASTOS — PURO. Solo SUGIERE (prompts/clasificador-de-gastos.md): jamás decide deducibilidad de fondo (eso es del
// contador) ni inventa un RFC, un UUID o un monto. Sin RFC propio de Likida, TODO comprobante queda «no evaluable».

export const CATEGORIAS_GASTO = ['infraestructura', 'ia_modelos', 'correo_observabilidad', 'legal_firma', 'whatsapp', 'otro'] as const;
export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number];

export type ComprobanteGasto = 'sin_comprobante' | 'cfdi' | 'invoice_extranjero';
export type DeducibleEnForma = 'si' | 'no' | 'no_evaluable';

/** Reglas por proveedor/palabra, en orden: la primera que coincide gana. Texto en minúsculas y sin acentos. */
const REGLAS: ReadonlyArray<{ categoria: CategoriaGasto; palabras: readonly string[] }> = [
  { categoria: 'ia_modelos', palabras: ['claude', 'anthropic', 'openai', 'openrouter', 'gemini', 'modelo', 'tokens'] },
  { categoria: 'correo_observabilidad', palabras: ['resend', 'sentry', 'postmark', 'sendgrid', 'posthog', 'correo'] },
  { categoria: 'legal_firma', palabras: ['mifiel', 'facturapi', 'firma electronica', 'timbrado', 'notario', 'abogado'] },
  { categoria: 'whatsapp', palabras: ['whatsapp', 'meta', 'twilio'] },
  { categoria: 'infraestructura', palabras: ['vercel', 'supabase', 'dominio', 'godaddy', 'cloudflare', 'github', 'aws', 'hosting'] },
];

/** Cuenta contable PROPUESTA por categoría: rótulos genéricos, no códigos. El catálogo oficial lo define el contador. */
export const CUENTA_PROPUESTA: Readonly<Record<CategoriaGasto, string | null>> = {
  infraestructura: 'Costos de nube',
  ia_modelos: 'Costos de IA',
  correo_observabilidad: 'Gastos de software',
  legal_firma: 'Servicios legales y de firma',
  whatsapp: 'Gastos de comunicación',
  otro: null,
};

export function normalizarTexto(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export interface SugerenciaClasificacion {
  /** Siempre `true`: es una propuesta para que una persona la confirme, nunca un hecho. */
  esSugerencia: true;
  categoria: CategoriaGasto | null;
  cuentaContable: string | null;
  /** Qué regla coincidió (`vercel`), o `null` si ninguna: «no se pudo clasificar» es un resultado honesto. */
  coincidio: string | null;
}

/** Sugiere categoría y cuenta por el nombre del proveedor y, si no basta, por el concepto. Nunca inventa: sin coincidencia devuelve `null`. */
export function sugerirClasificacion(entrada: { proveedor?: string | null; concepto?: string | null }): SugerenciaClasificacion {
  for (const campo of [normalizarTexto(entrada.proveedor), normalizarTexto(entrada.concepto)]) {
    if (!campo) continue;
    for (const r of REGLAS) {
      const hit = r.palabras.find((p) => campo.includes(p));
      if (hit) return { esSugerencia: true, categoria: r.categoria, cuentaContable: CUENTA_PROPUESTA[r.categoria], coincidio: hit };
    }
  }
  return { esSugerencia: true, categoria: null, cuentaContable: null, coincidio: null };
}

/**
 * «Deducible EN FORMA» (no de fondo). Sin RFC propio no es evaluable y se dice así; con RFC propio solo se afirma lo mínimo verificable:
 * un CFDI con UUID es «sí» en forma; un gasto sin comprobante o con invoice extranjero es «no».
 * El receptor del CFDI y su estatus ante el SAT no se consultan aquí: por eso es «en forma», no «deducible».
 */
export function deducibleEnForma(p: { rfcPropio: boolean; comprobante: ComprobanteGasto; cfdiUuid: string | null }): DeducibleEnForma {
  if (!p.rfcPropio) return 'no_evaluable';
  if (p.comprobante === 'cfdi' && p.cfdiUuid) return 'si';
  return 'no';
}
