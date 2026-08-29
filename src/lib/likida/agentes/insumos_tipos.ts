// ═══════════════════════════════════════════════════════════════════════════
// LOS TIPOS PUROS DE LA BANDEJA DE CONTEXTO UNIVERSAL (0267) — SIN IO.
//
// Vive APARTE de `insumos.ts` por una razón de bundle, no de gusto:
// `zona-insumos.tsx` ('use client', el formulario de arrastrar-y-soltar)
// necesita `TIPOS_ARCHIVO`/`TipoInsumo`/`InsumoAgente` para pintar los
// botones de tipo — y CUALQUIER import de un VALOR de `insumos.ts` arrastra,
// transitivamente, `@/lib/supabase/admin` (que usa `node:async_hooks`) al
// bundle del navegador. Webpack lo revienta en build ("UnhandledSchemeError:
// Reading from node:async_hooks") porque ese módulo nunca debió cruzar al
// cliente. Este archivo no importa NADA de IO — es seguro de importar desde
// un Client Component — y `insumos.ts` re-exporta todo esto para que el
// resto del repo (finanzas.ts, la página server, las pruebas) lo siga
// encontrando en el mismo sitio de siempre.
// ═══════════════════════════════════════════════════════════════════════════

export const TIPOS_INSUMO = ['documento', 'imagen', 'video', 'link', 'texto'] as const;
export type TipoInsumo = (typeof TIPOS_INSUMO)[number];

export function esTipoInsumo(v: string): v is TipoInsumo {
  return (TIPOS_INSUMO as readonly string[]).includes(v);
}

/** Los tipos que van a Storage (`storage_path`) contra los que viven en la
 *  propia fila (`contenido_texto`) — el mismo criterio que el CHECK
 *  `agente_insumo_contenido_segun_tipo` de la 0267. */
export const TIPOS_ARCHIVO: readonly TipoInsumo[] = ['documento', 'imagen', 'video'];
export const TIPOS_TEXTO: readonly TipoInsumo[] = ['link', 'texto'];

/**
 * Qué tipos acepta CADA agente — la tabla que el plan pide ("tipificada
 * según lo que ese agente en particular puede usar"), leída de lo que cada
 * agente YA hace hoy (finanzas.ts, crecimiento.ts, backoffice.ts,
 * ingenieria.ts, leads.ts — un agente que hoy arma un parte de Excel no
 * necesita video, uno que arma piezas de marca no necesita un PDF fiscal).
 *
 * Un agente sin entrada explícita cae al default de su DEPARTAMENTO
 * (`TIPOS_POR_DEPARTAMENTO`) y, si el departamento tampoco declara nada,
 * a `['texto']` — el piso del plan ("ideas en texto libre a cualquiera").
 */
export const TIPOS_POR_DEPARTAMENTO: Record<string, readonly TipoInsumo[]> = {
  producto: ['documento', 'texto'],
  leads: ['link', 'texto'],
  exito_cliente: ['documento', 'texto'],
  crecimiento: ['imagen', 'video', 'link', 'texto'],
  back_office: ['documento', 'texto'],
  ingenieria: ['texto', 'documento'],
  direccion: ['documento', 'texto'],
};

export const TIPOS_POR_AGENTE: Record<string, readonly TipoInsumo[]> = {
  // ── Financieros (0215) — "documentos y Exceles al financiero" (el plan,
  // textual). Cero LLM hoy (finanzas.ts): el insumo es contexto para que
  // Javier explique una cifra o adjunte un estado de cuenta, no un prompt.
  analista_metricas: ['documento', 'texto'],
  control_costos: ['documento', 'texto'],
  tesoreria: ['documento', 'texto'],
  cierre_mensual: ['documento', 'texto'],

  // ── Crecimiento (0230) — "imágenes y videos de referencia a los de
  // marca". `guiones` destila hooks de video (crecimiento.ts); los tres de
  // imagen/video son los que de verdad componen material visual.
  guiones: ['imagen', 'video', 'texto'],
  visuales: ['imagen', 'video', 'texto'],
  video_demo: ['video', 'imagen', 'texto'],
  video_marketing: ['video', 'imagen', 'texto'],
  promos_diarias: ['imagen', 'texto'],
  contenido_fiscal: ['documento', 'link', 'texto'],
  lead_magnet: ['documento', 'link', 'texto'],
  seo_distribucion: ['link', 'texto'],
  noticias_mercado: ['link', 'texto'],
  alianzas: ['link', 'texto'],

  // ── Leads (0217/0235) — "links y noticias al vigía de competencia".
  vigia: ['link', 'texto'],
  cazador: ['link', 'texto'],
  scorer: ['texto'],
  enriquecedor: ['link', 'texto'],
  dossier: ['link', 'documento', 'texto'],
  demo_prep: ['documento', 'texto'],
  propuestas: ['documento', 'texto'],
  sdr: ['texto'],
  redactor: ['texto'],
  enviador: ['texto'],
  ventas: ['texto'],

  // ── Ingeniería (0234) — "tickets al ejército QA": el ticket es texto,
  // con un adjunto ocasional (log, captura empaquetada como documento).
  pruebas: ['texto', 'documento'],
  auditor_codigo: ['texto', 'documento'],
  seguridad: ['texto', 'documento'],
  rendimiento: ['texto', 'documento'],
  migraciones: ['texto'],
  releases: ['texto'],
  producto: ['texto', 'documento'],
  datos_instrumentacion: ['texto', 'documento'],

  // ── Éxito del cliente (0218) y back office (0219/0116) — documentos y
  // texto libre: pólizas, políticas internas, contexto de un caso.
  onboarding_cliente: ['documento', 'texto'],
  exito_cliente: ['documento', 'texto'],
  retencion: ['documento', 'texto'],
  cobranza_saas: ['texto'],
  soporte: ['documento', 'texto'],
  atencion_faq: ['documento', 'texto'],
  vigilante_calidad: ['texto'],
  documentacion: ['documento', 'texto'],
  legal_compliance: ['documento', 'texto'],
  talento: ['documento', 'texto'],

  // ── Dirección (0216/0235).
  automejora: ['texto'],
  fundraising: ['documento', 'texto'],
  desempeno_startup: ['documento', 'texto'],
  kpi_whatsapp: ['texto'],
  orquestador: ['texto'],
  orquestador_semanal: ['texto'],
  especialistas_incidente: ['texto'],
};

/** Los tipos que un agente acepta — el mapa explícito, luego el default de
 *  su departamento, luego el piso universal del plan (texto libre). */
export function tiposAceptadosPorAgente(agenteId: string, departamento: string): TipoInsumo[] {
  const explicito = TIPOS_POR_AGENTE[agenteId];
  if (explicito) return [...explicito];
  const porDepto = TIPOS_POR_DEPARTAMENTO[departamento];
  return porDepto ? [...porDepto] : ['texto'];
}

// ── El modelo (forma de fila, sin IO) ───────────────────────────────────────

export interface InsumoAgente {
  id: string;
  agente: string;
  tenantId: string | null;
  tipo: TipoInsumo;
  titulo: string;
  storagePath: string | null;
  contenidoTexto: string | null;
  subidoPor: string;
  subidoEn: string;
  procesadoEn: string | null;
  resumenUso: string | null;
}
