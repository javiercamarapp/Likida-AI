import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
/** Cómo se lee cada tool del copiloto de superadmin en la traza viva (pasos REALES que el servidor transmite). */
export const etiquetaToolAdmin = (t: TResto = T_RESTO_ES): Record<string, string> => ({
  metrica_negocio: t('ch.leyendo_las_metricas_del_negocio'),
  conteos_plataforma: t('ch.contando_la_plataforma'),
  bandeja: t('ch.leyendo_la_bandeja_de_escalaciones'),
  guardia: t('ch.clasificando_la_bandeja_por_severidad'),
  metrica_norte: t('ch.midiendo_la_metrica_norte'),
  estado_agentes: t('ch.consultando_el_estado_de_los_agentes'),
  traza_corrida: t('ch.abriendo_la_traza_de_la_corrida'),
  pipeline_ventas: t('ch.leyendo_el_pipeline_de_ventas'),
  cobranza_saas: t('ch.revisando_la_cobranza_saas'),
  costo_por_fase_modelo: t('ch.desglosando_el_costo_de_ia'),
  bitacora: t('ch.leyendo_la_bitacora_de_auditoria'),
  ficha_cliente: t('ch.armando_la_ficha_360_del_cliente'),
  estado_runner: t('ch.leyendo_el_pulso_del_runner'),
  adquisicion: t('ch.midiendo_la_adquisicion'),
  decide_hoy: t('ch.armando_el_briefing_de_lo_que'),
  agentes_parados: t('ch.buscando_agentes_parados'),
  costo_ia_por_dia: t('ch.midiendo_el_costo_de_ia_por'),
  proponer_accion: t('ch.armando_la_previsualizacion'),
  entregar_respuesta_admin: t('op.armando_la_respuesta'),
});
export const ETIQUETA_TOOL_ADMIN = etiquetaToolAdmin();

/** tool → la pantalla de /admin que muestra lo mismo. Espejo cliente del mapa del servidor (copiloto-tools.ts arrastra supabaseAdmin al bundle). */
export const pantallaUi = (t: TResto = T_RESTO_ES): Record<string, { ruta: string; etiqueta: string }> => ({
  metrica_negocio: { ruta: '/admin', etiqueta: t('ch.consola') },
  conteos_plataforma: { ruta: '/admin', etiqueta: t('ch.consola') },
  bandeja: { ruta: '/admin/escalaciones', etiqueta: t('ch.escalaciones') },
  guardia: { ruta: '/admin/escalaciones', etiqueta: t('ch.escalaciones') },
  metrica_norte: { ruta: '/admin', etiqueta: t('ch.consola') },
  estado_agentes: { ruta: '/admin/observabilidad', etiqueta: t('ch.observabilidad') },
  traza_corrida: { ruta: '/admin/corridas', etiqueta: t('ch.corridas') },
  pipeline_ventas: { ruta: '/admin/vendedores', etiqueta: t('ch.vendedores') },
  cobranza_saas: { ruta: '/admin/costos-facturacion', etiqueta: t('ch.costos_y_facturacion') },
  costo_por_fase_modelo: { ruta: '/admin/costos-facturacion', etiqueta: t('ch.costos') },
  bitacora: { ruta: '/admin/observabilidad', etiqueta: t('ch.observabilidad') },
  ficha_cliente: { ruta: '/admin/flotas', etiqueta: t('ch.flotas_clientes') },
  estado_runner: { ruta: '/admin/observabilidad', etiqueta: t('ch.observabilidad') },
  adquisicion: { ruta: '/admin/crecimiento', etiqueta: t('ch.crecimiento') },
  decide_hoy: { ruta: '/admin/escalaciones', etiqueta: t('ch.escalaciones') },
  agentes_parados: { ruta: '/admin/agentes', etiqueta: t('op.agentes') },
  costo_ia_por_dia: { ruta: '/admin/costos-facturacion', etiqueta: t('ch.costos') },
});
export const PANTALLA_UI = pantallaUi();
