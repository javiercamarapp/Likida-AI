/** Cómo se lee cada tool del copiloto de superadmin en la traza viva (pasos REALES que el servidor transmite). */
export const ETIQUETA_TOOL_ADMIN: Record<string, string> = {
  metrica_negocio: 'Leyendo las métricas del negocio',
  conteos_plataforma: 'Contando la plataforma',
  bandeja: 'Leyendo la bandeja de escalaciones',
  guardia: 'Clasificando la bandeja por severidad',
  metrica_norte: 'Midiendo la métrica norte',
  estado_agentes: 'Consultando el estado de los agentes',
  traza_corrida: 'Abriendo la traza de la corrida',
  pipeline_ventas: 'Leyendo el pipeline de ventas',
  cobranza_saas: 'Revisando la cobranza SaaS',
  costo_por_fase_modelo: 'Desglosando el costo de IA',
  bitacora: 'Leyendo la bitácora de auditoría',
  ficha_cliente: 'Armando la ficha 360 del cliente',
  estado_runner: 'Leyendo el pulso del runner',
  adquisicion: 'Midiendo la adquisición',
  proponer_accion: 'Armando la previsualización',
  entregar_respuesta_admin: 'Armando la respuesta',
};

/** tool → la pantalla de /admin que muestra lo mismo. Espejo cliente del mapa del servidor (copiloto-tools.ts arrastra supabaseAdmin al bundle). */
export const PANTALLA_UI: Record<string, { ruta: string; etiqueta: string }> = {
  metrica_negocio: { ruta: '/admin', etiqueta: 'Consola' },
  conteos_plataforma: { ruta: '/admin', etiqueta: 'Consola' },
  bandeja: { ruta: '/admin/escalaciones', etiqueta: 'Escalaciones' },
  guardia: { ruta: '/admin/escalaciones', etiqueta: 'Escalaciones' },
  metrica_norte: { ruta: '/admin', etiqueta: 'Consola' },
  estado_agentes: { ruta: '/admin/observabilidad', etiqueta: 'Observabilidad' },
  traza_corrida: { ruta: '/admin/corridas', etiqueta: 'Corridas' },
  pipeline_ventas: { ruta: '/admin/vendedores', etiqueta: 'Vendedores' },
  cobranza_saas: { ruta: '/admin/costos-facturacion', etiqueta: 'Costos y facturación' },
  costo_por_fase_modelo: { ruta: '/admin/costos-facturacion', etiqueta: 'Costos' },
  bitacora: { ruta: '/admin/observabilidad', etiqueta: 'Observabilidad' },
  ficha_cliente: { ruta: '/admin/flotas', etiqueta: 'Flotas / Clientes' },
  estado_runner: { ruta: '/admin/observabilidad', etiqueta: 'Observabilidad' },
  adquisicion: { ruta: '/admin/crecimiento', etiqueta: 'Crecimiento' },
};
