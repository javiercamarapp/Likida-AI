import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
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
export const etiquetaInterruptorTr = (t: TSistema = T_SISTEMA_ES): Record<string, string> => ({
  'global': t('observabilidad_etiquetas.todo_el_sistema_global'),
  'agente:liquidacion': t('observabilidad_etiquetas.agente_de_liquidacion'),
  'agente:facturas': t('observabilidad_etiquetas.agente_de_facturas'),
  'agente:cobranza': t('observabilidad_etiquetas.agente_de_cobranza'),
  'agente:conductores': t('observabilidad_etiquetas.agente_de_conductores'),
  'agente:peajes': t('observabilidad_etiquetas.agente_de_peajes'),
  'agente:proveedores': t('observabilidad_etiquetas.agente_de_proveedores'),
  'agente:ventas': t('observabilidad_etiquetas.agente_de_ventas'),
  'agente:redactor': t('observabilidad_etiquetas.redactor_de_primer_contacto'),
  'agente:kpi_whatsapp': t('observabilidad_etiquetas.kpi_a_whatsapp_hoy_por_correo'),
  'agente:desempeno_startup': t('observabilidad_etiquetas.desempeno_de_la_startup'),
  'agente:orquestador': t('observabilidad_etiquetas.orquestador_80_20'),
  'agente:orquestador_semanal': t('observabilidad_etiquetas.orquestador_semanal_del_ciclo'),
  // Éxito del cliente (0218) — los seis que vigilan a la flota ya firmada.
  'agente:onboarding_cliente': t('observabilidad_etiquetas.onboarding_del_cliente'),
  'agente:exito_cliente': t('observabilidad_etiquetas.exito_del_cliente'),
  'agente:retencion': t('observabilidad_etiquetas.retencion'),
  'agente:cobranza_saas': t('observabilidad_etiquetas.cobranza_saas_mensualidades_de_likida'),
  'agente:soporte': t('observabilidad_etiquetas.soporte_sla_de_tickets'),
  'agente:atencion_faq': t('observabilidad_etiquetas.atencion_y_faq_borradores_de_ticket'),
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
  'agente:analista_metricas': t('observabilidad_etiquetas.analista_de_metricas'),
  'agente:control_costos': t('observabilidad_etiquetas.control_de_costos'),
  'agente:tesoreria': t('observabilidad_etiquetas.tesoreria'),
  'agente:cierre_mensual': t('observabilidad_etiquetas.cierre_mensual'),
  // Máquina de prospección (0217). `enriquecedor` es el id histórico del
  // investigador: se conserva porque es lo que `agente_corrida.agente` guarda.
  'agente:enriquecedor': t('observabilidad_etiquetas.enriquecedor_de_contacto'),
  'agente:sdr': t('observabilidad_etiquetas.sdr'),
  'agente:enviador': t('observabilidad_etiquetas.enviador_de_campana'),
  // Back office restante (0219).
  'agente:vigilante_calidad': t('observabilidad_etiquetas.vigilante_de_calidad'),
  'agente:documentacion': t('observabilidad_etiquetas.documentacion'),
  'agente:legal_compliance': t('observabilidad_etiquetas.legal_y_compliance'),
  'agente:talento': t('observabilidad_etiquetas.talento'),
  // Crecimiento (0230) — los diez que fabrican material de marca.
  'agente:contenido_fiscal': t('observabilidad_etiquetas.contenido_fiscal'),
  'agente:lead_magnet': t('observabilidad_etiquetas.lead_magnet'),
  'agente:seo_distribucion': t('observabilidad_etiquetas.seo_y_distribucion'),
  'agente:guiones': t('observabilidad_etiquetas.guiones_scripts_de_video'),
  'agente:noticias_mercado': t('observabilidad_etiquetas.noticias_del_mercado'),
  'agente:promos_diarias': t('observabilidad_etiquetas.promos_diarias'),
  'agente:visuales': t('observabilidad_etiquetas.visuales_de_marca'),
  'agente:video_demo': t('observabilidad_etiquetas.video_de_demo'),
  'agente:video_marketing': t('observabilidad_etiquetas.video_de_marketing'),
  'agente:alianzas': t('observabilidad_etiquetas.alianzas_y_gremio'),
  // Descarga masiva del SAT (0231). ES LA EXCEPCIÓN del mapa: no tiene fila
  // en `agente_definicion` porque no es un agente del catálogo — es la palanca
  // del motor que corre en el cron `descarga-sat`. Se rotula diciendo eso, en
  // vez de darle un nombre de agente que no existe.
  'agente:descarga_sat': t('observabilidad_etiquetas.descarga_masiva_del_sat_motor_del'),
  // Ingeniería (0234) — los ocho que cuidan la máquina por dentro.
  'agente:migraciones': t('observabilidad_etiquetas.vigia_de_migraciones'),
  'agente:seguridad': t('observabilidad_etiquetas.seguridad'),
  'agente:rendimiento': t('observabilidad_etiquetas.rendimiento'),
  'agente:pruebas': t('observabilidad_etiquetas.pruebas'),
  'agente:auditor_codigo': t('observabilidad_etiquetas.auditor_de_codigo'),
  'agente:releases': t('observabilidad_etiquetas.releases'),
  'agente:producto': t('observabilidad_etiquetas.producto'),
  'agente:datos_instrumentacion': t('observabilidad_etiquetas.datos_e_instrumentacion'),
  // Los nueve que cierran la compañía agente (0235): tres de dirección…
  'agente:automejora': t('observabilidad_etiquetas.automejora'),
  'agente:especialistas_incidente': t('observabilidad_etiquetas.especialistas_de_incidente_8'),
  'agente:fundraising': t('observabilidad_etiquetas.fundraising_e_inversionistas'),
  // …y seis de leads.
  'agente:scorer': t('observabilidad_etiquetas.scorer_de_senal'),
  'agente:dossier': t('observabilidad_etiquetas.dossier_del_prospecto'),
  'agente:vigia': t('observabilidad_etiquetas.vigia_de_leads_frios'),
  'agente:demo_prep': t('observabilidad_etiquetas.preparacion_de_demo'),
  'agente:propuestas': t('observabilidad_etiquetas.propuestas'),
  'agente:cazador': t('observabilidad_etiquetas.cazador_del_censo'),
  // Las 2 del 0250 — los agentes vivos que corrían sin poderse apagar.
  'agente:carta_porte': t('observabilidad_etiquetas.agente_de_carta_porte'),
  'agente:copiloto': t('observabilidad_etiquetas.copiloto_del_fundador'),
  // La salida de Carta Porte al sistema del cliente (T-A3-28).
  'agente:carta_porte_salida_tms': t('observabilidad_etiquetas.salida_de_carta_porte_al_sistema'),
});
export const ETIQUETA_INTERRUPTOR = etiquetaInterruptorTr();

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
const etiquetaPipeline = (t: TSistema = T_SISTEMA_ES): Record<string, string> => ({
  'pipeline:whatsapp': t('observabilidad_etiquetas.recepcion_de_whatsapp_router'),
  'pipeline:ocr': t('observabilidad_etiquetas.ocr_de_la_foto_del_ticket'),
  'pipeline:cuadre': t('observabilidad_etiquetas.cuadre_de_la_liquidacion'),
});

export function etiquetaInterruptor(id: string, t: TSistema = T_SISTEMA_ES): string {
  return etiquetaInterruptorTr(t)[id] ?? etiquetaPipeline(t)[id] ?? id;
}

/**
 * B3 (ronda 19): hasta dónde mide `medirRuta` en rutas que responden ANTES de terminar su trabajo. El p95 de estas dos
 * NO es la latencia de procesamiento: el webhook devuelve el acuse a Meta y procesa en `after()`; el chat devuelve el
 * primer byte y sigue en streaming. Un rótulo tiene que ser verdad: la tabla lo dice junto al nombre.
 */
const notaLatenciaRuta = (t: TSistema = T_SISTEMA_ES): Record<string, string> => ({
  'webhook.whatsapp': t('observabilidad_etiquetas.hasta_el_acuse_el_procesamiento_corre'),
  'dashboard.chat': t('observabilidad_etiquetas.hasta_el_primer_byte_la_respuesta'),
});

/** La aclaración de qué mide la latencia de esta ruta, o `null` si mide la respuesta completa. */
export function notaDeLatenciaRuta(nombre: string, t: TSistema = T_SISTEMA_ES): string | null {
  return notaLatenciaRuta(t)[nombre] ?? null;
}

/**
 * T-A4-42: los contadores que el cron `vigia` deja en el latido, con el nombre que se lee en /admin/crons. Solo cuentas: ningún
 * texto, cliente ni operador de un aviso viaja por aquí. Una clave que no esté en el mapa se pinta cruda (visible, no rota).
 */
const etiquetaContadorVigiaTr = (t: TSistema = T_SISTEMA_ES): Record<string, string> => ({
  avisosCreados: t('observabilidad_etiquetas.avisos_de_viaje_creados'),
  avisosEnviados: t('observabilidad_etiquetas.avisos_de_viaje_enviados'),
  avisosFallidos: t('observabilidad_etiquetas.avisos_de_viaje_fallidos'),
  avisosOmitidos: t('observabilidad_etiquetas.avisos_de_viaje_omitidos_o_diferidos'),
  avisosPendientesViejos: t('observabilidad_etiquetas.avisos_de_viaje_esperando_confirmacion_mas'),
  avisosConError: t('observabilidad_etiquetas.el_modulo_de_avisos_de_viaje'),
});

export function etiquetaContadorVigia(clave: string, t: TSistema = T_SISTEMA_ES): string {
  return etiquetaContadorVigiaTr(t)[clave] ?? clave;
}
