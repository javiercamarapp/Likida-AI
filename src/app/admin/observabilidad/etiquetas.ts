/**
 * El nombre de cada interruptor (0110) como se enseña en pantalla — lo usan
 * la sección de Interruptores de /admin/observabilidad y el ⌘K.
 *
 * Módulo plano SIN 'use client' a propósito (mismo criterio que rutas.ts):
 * lo consumen Server y Client Components. No puede importar el catálogo de
 * `agentes/notificaciones.ts` (arrastra supabaseAdmin al bundle del cliente),
 * así que los nombres se repiten aquí — la prueba de dominio vive en la base
 * (CHECK de la 0110) y en `INTERRUPTORES` (interruptores.ts), no en este mapa:
 * un id que falte aquí se pinta crudo, visible, no roto.
 */
export const ETIQUETA_INTERRUPTOR: Record<string, string> = {
  'global': 'TODO el sistema (global)',
  'agente:liquidacion': 'Agente de Liquidación',
  'agente:facturas': 'Agente de Facturas',
  'agente:cobranza': 'Agente de Cobranza',
  'agente:conductores': 'Agente de Conductores',
  'agente:peajes': 'Agente de Peajes',
  'agente:proveedores': 'Agente de Proveedores',
  'agente:ventas': 'Agente de Ventas',
  'agente:redactor': 'Redactor de Primer Contacto',
  'agente:kpi_whatsapp': 'KPI a WhatsApp (hoy por correo)',
  'agente:desempeno_startup': 'Desempeño de la startup',
  'agente:orquestador': 'Orquestador 80/20',
  'agente:orquestador_semanal': 'Orquestador semanal del ciclo',
  // Éxito del cliente (0218) — los seis que vigilan a la flota ya firmada.
  'agente:onboarding_cliente': 'Onboarding del cliente',
  'agente:exito_cliente': 'Éxito del cliente',
  'agente:retencion': 'Retención',
  'agente:cobranza_saas': 'Cobranza SaaS (mensualidades de Likida)',
  'agente:soporte': 'Soporte (SLA de tickets)',
  'agente:atencion_faq': 'Atención y FAQ (borradores de ticket)',
  // ── Los 39 que faltaban ─────────────────────────────────────────────────
  // Este mapa tenía 18 de las 58 palancas. Las otras 39 se pintaban con el id
  // crudo (`agente:datos_instrumentacion`) en Observabilidad, en el ⌘K y en la
  // columna Agente de /admin/corridas. La nota de arriba dice que un id que
  // falte «se pinta crudo, visible, no roto» — y es cierto que no se rompe,
  // pero una lista de 58 filas donde 39 son jerga es una lista que no se lee:
  // el kill switch más caro de encontrar es el que está entre otros 57.
  //
  // Los nombres NO están inventados: salen de la columna `nombre` de
  // `agente_definicion`, que es la que el propio /admin/agentes ya pinta. Así
  // la misma palanca se llama igual en las dos pantallas.
  // Financieros del back office (0215).
  'agente:analista_metricas': 'Analista de métricas',
  'agente:control_costos': 'Control de costos',
  'agente:tesoreria': 'Tesorería',
  'agente:cierre_mensual': 'Cierre mensual',
  // Máquina de prospección (0217). `enriquecedor` es el id histórico del
  // investigador: se conserva porque es lo que `agente_corrida.agente` guarda.
  'agente:enriquecedor': 'Enriquecedor de contacto',
  'agente:sdr': 'SDR',
  'agente:enviador': 'Enviador de Campaña',
  // Back office restante (0219).
  'agente:vigilante_calidad': 'Vigilante de calidad',
  'agente:documentacion': 'Documentación',
  'agente:legal_compliance': 'Legal y compliance',
  'agente:talento': 'Talento',
  // Crecimiento (0230) — los diez que fabrican material de marca.
  'agente:contenido_fiscal': 'Contenido fiscal',
  'agente:lead_magnet': 'Lead magnet',
  'agente:seo_distribucion': 'SEO y distribución',
  'agente:guiones': 'Guiones (scripts de video)',
  'agente:noticias_mercado': 'Noticias del mercado',
  'agente:promos_diarias': 'Promos diarias',
  'agente:visuales': 'Visuales de marca',
  'agente:video_demo': 'Video de demo',
  'agente:video_marketing': 'Video de marketing',
  'agente:alianzas': 'Alianzas y gremio',
  // Descarga masiva del SAT (0231). ES LA EXCEPCIÓN del mapa: no tiene fila
  // en `agente_definicion` porque no es un agente del catálogo — es la palanca
  // del motor que corre en el cron `descarga-sat`. Se rotula diciendo eso, en
  // vez de darle un nombre de agente que no existe.
  'agente:descarga_sat': 'Descarga masiva del SAT (motor del cron)',
  // Ingeniería (0234) — los ocho que cuidan la máquina por dentro.
  'agente:migraciones': 'Vigía de migraciones',
  'agente:seguridad': 'Seguridad',
  'agente:rendimiento': 'Rendimiento',
  'agente:pruebas': 'Pruebas',
  'agente:auditor_codigo': 'Auditor de código',
  'agente:releases': 'Releases',
  'agente:producto': 'Producto',
  'agente:datos_instrumentacion': 'Datos e instrumentación',
  // Los nueve que cierran la compañía agente (0235): tres de dirección…
  'agente:automejora': 'Automejora',
  'agente:especialistas_incidente': 'Especialistas de incidente (8)',
  'agente:fundraising': 'Fundraising e inversionistas',
  // …y seis de leads.
  'agente:scorer': 'Scorer de señal',
  'agente:dossier': 'Dossier del prospecto',
  'agente:vigia': 'Vigía de leads fríos',
  'agente:demo_prep': 'Preparación de demo',
  'agente:propuestas': 'Propuestas',
  'agente:cazador': 'Cazador del censo',
  // Las 2 del 0250 — los agentes vivos que corrían sin poderse apagar.
  'agente:carta_porte': 'Agente de Carta Porte',
  'agente:copiloto': 'Copiloto del fundador',
};

/**
 * Pipeline del chofer, POR FLOTA (0297, ADM-6 auditoría 24) — tabla
 * `interruptor_tenant`, un dominio DISTINTO de `interruptor`/`INTERRUPTORES`
 * (estos ids solo se usan en /admin/flotas/[id], nunca en el catálogo
 * global de arriba). Mapa APARTE, no dentro de `ETIQUETA_INTERRUPTOR`:
 * `etiquetas.test.ts` exige que esa constante sea EXACTAMENTE el dominio de
 * `INTERRUPTORES` (ni de más ni de menos) — meterlos ahí habría hecho que
 * la prueba viera tres "rótulos huérfanos" de una palanca que nunca existió
 * en ese catálogo.
 */
const ETIQUETA_PIPELINE: Record<string, string> = {
  'pipeline:whatsapp': 'Recepción de WhatsApp (router)',
  'pipeline:ocr': 'OCR de la foto del ticket',
  'pipeline:cuadre': 'Cuadre de la liquidación',
};

export function etiquetaInterruptor(id: string): string {
  return ETIQUETA_INTERRUPTOR[id] ?? ETIQUETA_PIPELINE[id] ?? id;
}
