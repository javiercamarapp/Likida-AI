-- consultas.sql — las consultas calientes REALES del código, traducidas de PostgREST a SQL.
-- Formato: «-- @nombre:» abre una consulta; @tipo: cron|pantalla; @origen: archivo del repo; @muta: 1 si escribe
-- (se mide dentro de BEGIN…ROLLBACK). :T = flota grande, :C = una flota chica (ruido).

-- @nombre: cron.conductor.sembrar_hitos
-- @tipo: cron
-- @origen: conductor/trabajo.ts sembrarHitos → rpc sembrar_hitos_conductor
-- @muta: 1
select sembrar_hitos_conductor(500);

-- @nombre: cron.conductor.viajes_activos_repartidos
-- @tipo: cron
-- @origen: conductor/trabajo.ts leerViajesActivos → rpc 0661
select * from viajes_activos_repartidos(500, 1234, 30, now());

-- @nombre: cron.conductor.cerrar_hitos_vencidos
-- @tipo: cron
-- @origen: conductor/trabajo.ts cerrarHitosDeViajesVencidos → rpc 0661
-- @muta: 1
select cerrar_hitos_viajes_vencidos(30, 500, now());

-- @nombre: cron.conductor.viajes_lote150
-- @tipo: cron
-- @origen: conductor/trabajo.ts leerViajesActivos (viaje + operador embebido)
select v.id, v.tenant_id, v.folio, v.origen, v.destino, v.estatus, v.operador_id, v.terminal_id, v.unidad_id, v.aceptado_en, v.cita_origen_en, v.cita_destino_en, v.eta_origen_en, v.eta_destino_en, o.nombre, o.telefono
from viaje v left join operador o on o.id = v.operador_id
where v.id = any(array(select id from (select id from viaje where tenant_id = :T and estatus='abierto' order by id limit 150) x)) and v.estatus = 'abierto';

-- @nombre: cron.conductor.hitos_lote150
-- @tipo: cron
-- @origen: conductor/trabajo.ts leerHitosDeViajes (traerTodo, offset 0)
select * from viaje_hito where viaje_id = any(array(select id from (select id from viaje where tenant_id = :T and estatus='abierto' order by id limit 150) x)) order by id limit 1000;

-- @nombre: cron.conductor.avisos_lote150
-- @tipo: cron
-- @origen: conductor/trabajo.ts leerAvisosDeHitos
select viaje_hito_id, ciclo, clase, nivel from viaje_hito_aviso where viaje_hito_id = any(array(select h.id from viaje_hito h where h.viaje_id = any(array(select id from (select id from viaje where tenant_id = :T and estatus='abierto' order by id limit 150) x)))) order by id limit 1000;

-- @nombre: cron.conductor.tope_dia
-- @tipo: cron
-- @origen: conductor/trabajo.ts contarEnviadosPorChofer
select operador_id from viaje_hito_aviso where operador_id = any(array(select id from (select id from operador where tenant_id = :T order by id limit 150) x)) and clase in ('solicitud','recordatorio') and created_at >= date_trunc('day', now()) order by id limit 1000;

-- @nombre: cron.conductor.candidatos_validacion
-- @tipo: cron
-- @origen: conductor/trabajo.ts leerCandidatosValidacion (cruza flotas)
select * from viaje_hito where tipo in ('llegada_carga','llegada_descarga') and estado = 'recibido' and recibido_en >= now() - interval '6 hours' order by recibido_en desc, id limit 100;

-- @nombre: cron.conductor.candidatos_sitio_derivado
-- @tipo: cron
-- @origen: conductor/trabajo.ts leerCandidatosSitioDerivado (cruza flotas)
select id, tenant_id, origen, destino, cliente_id, origen_geocerca_id, destino_geocerca_id from viaje where estatus='abierto' and aceptado_en is not null and (origen_geocerca_id is null or destino_geocerca_id is null) order by aceptado_en desc, id limit 200;

-- @nombre: cron.conductor.ciclo_muestras_gps_4h
-- @tipo: cron
-- @origen: conductor/trabajo.ts leerMuestrasGps (100 unidades, ventana 4 h, offset 0)
select tenant_id, unidad_id, lat, lng, medida_en, ignicion from posicion where tenant_id = any(array[:T]) and unidad_id = any(array(select id from (select id from unidad where tenant_id = :T order by id limit 100) x)) and proveedor <> 'whatsapp' and medida_en >= now() - interval '4 hours' order by medida_en, id limit 1000 offset 0;

-- @nombre: cron.conductor.ciclo_muestras_gps_4h_pag4
-- @tipo: cron
-- @origen: idem, página 5 (offset 4000)
select tenant_id, unidad_id, lat, lng, medida_en, ignicion from posicion where tenant_id = any(array[:T]) and unidad_id = any(array(select id from (select id from unidad where tenant_id = :T order by id limit 100) x)) and proveedor <> 'whatsapp' and medida_en >= now() - interval '4 hours' order by medida_en, id limit 1000 offset 4000;

-- @nombre: cron.conductor.ultima_muestra_unidad
-- @tipo: cron
-- @origen: conductor/trabajo.ts leerUltimaMuestraGps / repo.ts ultimaPosicionUnidad
select lat, lng, medida_en, ignicion from posicion where tenant_id = :T and unidad_id = (select id from unidad where tenant_id = :T order by id limit 1) and proveedor <> 'whatsapp' and medida_en >= now() - interval '12 hours' order by medida_en desc, id limit 1;

-- @nombre: cron.conductor.senal_episodios
-- @tipo: cron
-- @origen: conductor/trabajo.ts leerEpisodiosSenalVida
select id, tenant_id, viaje_id, motivo, abierto_en from viaje_senal_vida where viaje_id = any(array(select id from (select id from viaje where tenant_id = :T and estatus='abierto' order by id limit 150) x)) and (cerrado_en is null or silenciado_hasta > now()) order by abierto_en desc, id limit 450;

-- @nombre: cron.conductor.sitios_flota
-- @tipo: cron
-- @origen: conductor/trabajo.ts leerSitiosGeometriaDeFlotas
select id, tenant_id, nombre, lat, lng, radio_m from geocerca where tenant_id = any(array[:T, :C]) and catalogo = 'conductor' and activa order by id limit 1000;

-- @nombre: cron.conductor.hitos_de_un_viaje
-- @tipo: cron
-- @origen: conductor/repo.ts cargarHitos (por viaje, en el procesamiento de cada mensaje)
select * from viaje_hito where tenant_id = :T and viaje_id = (select id from viaje where tenant_id = :T and estatus='abierto' order by id limit 1);

-- @nombre: cron.vigia.en_espera
-- @tipo: cron
-- @origen: vigia/repo.ts conversacionesEnEspera
select * from vigia_conversacion where estado='activa' and sin_respuesta_desde is not null and escalamiento_nivel < 2 and ((tenant_id = :T and (sin_respuesta_desde <= now() - interval '15 minutes' or molestia_nivel >= 2 or entradas_sin_respuesta >= 5)) or (tenant_id = :C and sin_respuesta_desde <= now() - interval '15 minutes')) order by sin_respuesta_desde, id limit 180;

-- @nombre: cron.vigia.config_habilitada
-- @tipo: cron
-- @origen: vigia/repo.ts conversacionesEnEspera (vigia_config)
select * from vigia_config where habilitado order by tenant_id limit 1000;

-- @nombre: cron.vigia.expirar_ciclos
-- @tipo: cron
-- @origen: vigia/repo.ts expirarCiclosInactivos
select id, tenant_id from vigia_conversacion where estado='activa' and sin_respuesta_desde is not null and sin_respuesta_desde < now() - interval '3 days' order by sin_respuesta_desde, id limit 50;

-- @nombre: cron.vigia.aprobados_atorados
-- @tipo: cron
-- @origen: vigia/repo.ts aprobadosAtorados
select id, tenant_id from vigia_mensaje where direccion='saliente' and estado='aprobado' and aprobado_en < now() - interval '10 minutes' order by id limit 50;

-- @nombre: cron.vigia.purgar
-- @tipo: cron
-- @origen: vigia/repo.ts purgar → rpc vigia_purgar
-- @muta: 1
select vigia_purgar(500);

-- @nombre: cron.cartaporte.pendientes
-- @tipo: cron
-- @origen: carta_porte_docs/repo.ts → rpc cp_documentos_pendientes
select * from cp_documentos_pendientes(20, 3, 60);

-- @nombre: cron.cartaporte.agotados
-- @tipo: cron
-- @origen: carta_porte_docs/repo.ts → rpc cp_documentos_agotados
select * from cp_documentos_agotados(20, 3, 30);

-- @nombre: cron.cartaporte.por_avisar
-- @tipo: cron
-- @origen: carta_porte_docs/repo.ts → rpc cp_documentos_por_avisar
select * from cp_documentos_por_avisar(20, 0.8, 30);

-- @nombre: cron.cartaporte.vencidos
-- @tipo: cron
-- @origen: carta_porte_docs/repo.ts → rpc cp_documentos_vencidos
select * from cp_documentos_vencidos(50);

-- @nombre: cron.peajes.archivo_reclamar
-- @tipo: cron
-- @origen: peajes/ingesta.ts → rpc peaje_archivo_reclamar
-- @muta: 1
select * from peaje_archivo_reclamar(5, 120);

-- @nombre: cron.peajes.pull_reclamar
-- @tipo: cron
-- @origen: peajes/datos.ts → rpc peaje_pull_reclamar
-- @muta: 1
select * from peaje_pull_reclamar(5, 120);

-- @nombre: cron.peajes.avisos_pendientes
-- @tipo: cron
-- @origen: peajes/datos.ts → rpc peaje_avisos_pendientes
select * from peaje_avisos_pendientes(20, 5);

-- @nombre: cron.peajes.posiciones_ventana_100
-- @tipo: cron
-- @origen: peajes/datos.ts traerMuestrasPorLinea (100 ventanas ±15 min, cruce PASE×GPS)
select * from peaje_posiciones_ventana(:T, (select jsonb_agg(jsonb_build_object('linea_id', l.id, 'unidad_id', l.unidad_id, 'desde', l.cruce_en - interval '15 minutes', 'hasta', l.cruce_en + interval '15 minutes')) from (select id, unidad_id, cruce_en from desglose_peaje_linea where tenant_id = :T and desglose_id = (select id from desglose_peaje where tenant_id = :T order by periodo_desde desc limit 1) order by indice, id limit 100) l)) order by linea_id, medida_en, lat, lng limit 1000;

-- @nombre: cron.peajes.posiciones_por_unidad_dia
-- @tipo: cron
-- @origen: peajes/evidencia_gps.ts → rpc posiciones_por_unidad_dia
select * from posiciones_por_unidad_dia(:T, (select array_agg(id) from (select id from unidad where tenant_id = :T order by id limit 100) x), current_date - 30, current_date) order by unidad_id, dia limit 1000;

-- @nombre: cron.peajes.conciliar_gastos_caseta
-- @tipo: cron
-- @origen: intake/desglose_peaje.ts conciliarDesgloseInterno (gasto caseta del rango del archivo)
select id, viaje_id, monto, fecha from gasto where tenant_id = :T and concepto = 'caseta' and fecha >= current_date - 45 and fecha <= current_date order by id limit 1000;

-- @nombre: cron.peajes.lineas_desglose
-- @tipo: cron
-- @origen: intake/desglose_peaje.ts leer_lineas
select id, indice, fecha, monto, caseta, tag, cruce_en from desglose_peaje_linea where tenant_id = :T and desglose_id = (select id from desglose_peaje where tenant_id = :T order by periodo_desde desc limit 1) order by indice, id limit 1000;

-- @nombre: cron.liqext.trabajo_pendiente
-- @tipo: cron
-- @origen: liquidacion_externa/trabajo.ts trabajoPendiente (cruza flotas)
select * from liquidacion_externa where estado = 'en_cola' or (estado = 'pendiente' and proximo_intento_en <= now()) order by proximo_intento_en, id limit 50;

-- @nombre: cron.liqext.avisos_trabajo
-- @tipo: cron
-- @origen: liquidacion_externa/trabajo.ts avisosPendientes
select liquidacion_externa_id, tenant_id, ciclo, estado from liquidacion_aviso_discrepancia where (estado = 'pendiente' and proximo_intento_en <= now()) or (estado = 'enviando' and claim_expira_en <= now()) order by proximo_intento_en, liquidacion_externa_id, ciclo limit 50;

-- @nombre: cron.gps.ultimas_posiciones_tenant
-- @tipo: cron
-- @origen: comercial.ts getUltimasPosiciones → rpc 0269/0287/0603
select * from ultimas_posiciones_tenant(:T);

-- @nombre: cron.gps.estado_rastreo
-- @tipo: cron
-- @origen: comercial.ts getEstadoRastreo → rpc 0162
select * from estado_rastreo_tenant(:T);

-- @nombre: cron.gps.poll_estado
-- @tipo: cron
-- @origen: conductor/trabajo.ts leerFlotasConConectorDegradado
select tenant_id from conector_poll_estado where tenant_id = any(array[:T, :C]) and recurso = 'posiciones' and errores_seguidos > 0 limit 1000;

-- @nombre: cron.purgar.posicion_90d
-- @tipo: cron
-- @origen: cron/purgar → rpc purgar_posicion (0155)
-- @muta: 1
select * from purgar_posicion(90, now(), now() + interval '60 seconds');

-- @nombre: cron.purgar.mantener_ledgers
-- @tipo: cron
-- @origen: retencion_ledgers.ts → rpc mantener_ledgers (0680)
-- @muta: 1
select mantener_ledgers(now(), now() + interval '60 seconds', 90, 90, 90, 90);

-- @nombre: cron.purgar.mantenimiento_de_datos
-- @tipo: cron
-- @origen: cron/purgar → rpc mantenimiento_de_datos
-- @muta: 1
select mantenimiento_de_datos(30, now());

-- @nombre: cron.purgar.liquidacion_externa
-- @tipo: cron
-- @origen: rpc purgar_liquidacion_externa
-- @muta: 1
select purgar_liquidacion_externa(24, 500, now());

-- @nombre: cron.purgar.conductor_auditoria
-- @tipo: cron
-- @origen: conductor/repo.ts correrMantenimientoConductor
-- @muta: 1
select purgar_conductor_auditoria(365, 500);

-- @nombre: pantalla.resumen.kpis
-- @tipo: pantalla
-- @origen: analytics.ts getKpis → kpis_liquidacion_tenant
select * from kpis_liquidacion_tenant(:T, null);

-- @nombre: pantalla.resumen.acreditables
-- @tipo: pantalla
-- @origen: analytics.ts getAcreditables
select * from acreditables_liquidacion_tenant(:T, date_trunc('year', now()));

-- @nombre: pantalla.resumen.serie_comparativa_30
-- @tipo: pantalla
-- @origen: analytics.ts getSerieComparativa
select * from serie_comparativa_tenant(:T, 30, 12, current_date);

-- @nombre: pantalla.resumen.anomalias
-- @tipo: pantalla
-- @origen: analytics.ts detectarAnomalias
select * from anomalias_gasto_tenant(:T);

-- @nombre: pantalla.resumen.gasto_semanal_52
-- @tipo: pantalla
-- @origen: analytics.ts getGastoPorSemana
select * from gasto_semanal_tenant(:T, current_date - 364, current_date);

-- @nombre: pantalla.resumen.liquidado_semanal_52
-- @tipo: pantalla
-- @origen: analytics.ts getLiquidadoPorSemana
select * from liquidado_semanal_tenant(:T, now() - interval '364 days');

-- @nombre: pantalla.resumen.top_rutas
-- @tipo: pantalla
-- @origen: analytics.ts getTopRutasPorGasto
select * from top_rutas_gasto_tenant(:T, 5, null, null);

-- @nombre: pantalla.resumen.viajes_por_mes
-- @tipo: pantalla
-- @origen: analytics.ts getViajesPorMes
select * from viajes_por_mes_tenant(:T);

-- @nombre: pantalla.resumen.gastos_fiscales_ejercicio
-- @tipo: pantalla
-- @origen: fiscal.ts getGastosFiscales (periodo ejercicio)
select * from gastos_fiscales_agregados_tenant(:T, date_trunc('year', now())::date, current_date, 2000, 750, array['alimentacion','viaticos'], array[]::date[], array['15101514'], null, null, 3, '\yoxxo\y', current_date);

-- @nombre: pantalla.resumen.documentos
-- @tipo: pantalla
-- @origen: analytics.ts getValorAhorro → resumen_documentos_tenant
select * from resumen_documentos_tenant(:T);

-- @nombre: pantalla.resumen.viajes_recientes_100
-- @tipo: pantalla
-- @origen: analytics.ts getViajes
select * from viaje where tenant_id = :T order by created_at desc limit 100;

-- @nombre: pantalla.resumen.documentos_recientes_100
-- @tipo: pantalla
-- @origen: analytics.ts getDocumentos
select * from gasto where tenant_id = :T order by created_at desc limit 100;

-- @nombre: pantalla.liquidaciones.lista_50
-- @tipo: pantalla
-- @origen: analytics.ts getLiquidaciones
select * from liquidacion where tenant_id = :T order by created_at desc limit 50;

-- @nombre: pantalla.operacion.tablero
-- @tipo: pantalla
-- @origen: operacion.ts getTableroOperacion
select * from tablero_operacion_tenant(:T);

-- @nombre: pantalla.operacion.carga_operadores
-- @tipo: pantalla
-- @origen: operacion.ts getCargaOperadores
select * from carga_operadores_tenant(:T, now() - interval '30 days');

-- @nombre: pantalla.operacion.incidencias
-- @tipo: pantalla
-- @origen: operacion.ts getIncidencias
select * from incidencias_tenant(:T, now() - interval '30 days', 100);

-- @nombre: pantalla.operacion.viajes_sin_asignar
-- @tipo: pantalla
-- @origen: operacion.ts getViajesSinAsignar (inicio y despacho)
select id, folio, origen, destino, created_at from viaje where tenant_id = :T and operador_id is null and estatus <> 'liquidado' limit 1000;

-- @nombre: pantalla.viajes.registro_todos
-- @tipo: pantalla
-- @origen: viajes_registro.ts → rpc viajes_registro_tenant (primera página)
select * from viajes_registro_tenant(:T, 'todos', null, null, null, null, 50);

-- @nombre: pantalla.viajes.registro_busqueda_folio
-- @tipo: pantalla
-- @origen: viajes_registro.ts → busqueda p_q
select * from viajes_registro_tenant(:T, 'todos', 'ZZZ-0-03000', null, null, null, 50);

-- @nombre: pantalla.viajes.registro_busqueda_origen
-- @tipo: pantalla
-- @origen: viajes_registro.ts → busqueda por texto de ciudad
select * from viajes_registro_tenant(:T, 'todos', 'Monterrey', null, null, null, 50);

-- @nombre: pantalla.viajes.registro_cursor_profundo
-- @tipo: pantalla
-- @origen: viajes_registro.ts → página con cursor a mitad de historia
select * from viajes_registro_tenant(:T, 'todos', null, current_date - 180, now() - interval '180 days', '00000000-0000-0000-0000-000000000000', 50);

-- @nombre: pantalla.viajes.conteos
-- @tipo: pantalla
-- @origen: viajes_registro.ts → conteos_viajes_tenant
select * from conteos_viajes_tenant(:T);

-- @nombre: pantalla.hitos.tablero_viajes
-- @tipo: pantalla
-- @origen: conductor/repo_validacion.ts leerDatosTablero (viajes abiertos aceptados)
select * from viaje where tenant_id = :T and estatus = 'abierto' and aceptado_en is not null order by aceptado_en, id limit 301;

-- @nombre: pantalla.hitos.tablero_hitos
-- @tipo: pantalla
-- @origen: leerDatosTablero (hitos de los viajes en tandas)
select * from viaje_hito where tenant_id = :T and viaje_id = any(array(select id from (select id from viaje where tenant_id = :T and estatus='abierto' and aceptado_en is not null order by aceptado_en, id limit 150) x));

-- @nombre: pantalla.hitos.indicadores
-- @tipo: pantalla
-- @origen: repo_validacion.ts leerIndicadores → rpc conductor_indicadores
select * from conductor_indicadores(:T, now() - interval '7 days', now() + interval '1 minute', null, null, null);

-- @nombre: pantalla.hitos.estadias_llegadas_30d
-- @tipo: pantalla
-- @origen: repo_validacion.ts leerDatosEstadias
select viaje_id from viaje_hito where tenant_id = :T and tipo in ('llegada_carga','llegada_descarga') and estado in ('recibido','validado') and mensaje_en >= now() - interval '30 days' and mensaje_en < now() order by mensaje_en, id limit 3001;

-- @nombre: pantalla.hitos.api_v1_hitos
-- @tipo: pantalla
-- @origen: conductor/repo.ts leerHitos (/v1/hitos)
select * from viaje_hito where tenant_id = :T order by updated_at desc, id desc offset 0 limit 101;

-- @nombre: pantalla.hitos.api_v1_eventos
-- @tipo: pantalla
-- @origen: conductor/repo.ts leerEventos
select id, viaje_id, viaje_hito_id, tipo_hito, evento, detalle, created_at from viaje_hito_evento where tenant_id = :T and id > 100000 order by id limit 101;

-- @nombre: pantalla.peajes.desgloses_recibidos
-- @tipo: pantalla
-- @origen: analytics.ts getDesglosesRecibidos
select * from desglose_peaje where tenant_id = :T and anulado_en is null order by creado_en desc limit 8;

-- @nombre: pantalla.peajes.agregar_estatus_desglose
-- @tipo: pantalla
-- @origen: intake/desglose_peaje.ts agregarEstatus (por desglose)
select estatus from desglose_peaje_linea where tenant_id = :T and desglose_id = (select id from desglose_peaje where tenant_id = :T order by creado_en desc limit 1) order by id limit 1000;

-- @nombre: pantalla.peajes.bitacora_lineas
-- @tipo: pantalla
-- @origen: peajes/bitacora_conciliada.ts
select indice, fecha, hora, cruce_en, caseta, monto, tag, estatus, viaje_id, unidad_id, caseta_id, gps_veredicto from desglose_peaje_linea where tenant_id = :T and desglose_id = (select id from desglose_peaje where tenant_id = :T order by creado_en desc limit 1) order by indice, id limit 1000;

-- @nombre: pantalla.peajes.conciliacion_consolidado
-- @tipo: pantalla
-- @origen: analytics.ts getConciliacionConsolidado
select * from conciliacion_consolidado_tenant(:T);

-- @nombre: pantalla.vigia.tablero_conversaciones
-- @tipo: pantalla
-- @origen: vigia/repo.ts cargarTablero
select * from vigia_conversacion where tenant_id = :T and estado='activa' order by updated_at desc, id limit 100;

-- @nombre: pantalla.vigia.tablero_ultimos_entrantes
-- @tipo: pantalla
-- @origen: cargarTablero (último mensaje del cliente por conversación activa)
select conversacion_id, texto, created_at from vigia_mensaje where tenant_id = :T and direccion='entrante' and conversacion_id = any(array(select id from (select id from vigia_conversacion where tenant_id = :T and estado='activa' order by updated_at desc, id limit 100) x)) order by created_at desc, id limit 300;

-- @nombre: pantalla.vigia.tablero_pendientes
-- @tipo: pantalla
-- @origen: cargarTablero (cola de aprobación)
select * from vigia_mensaje where tenant_id = :T and direccion='saliente' and estado='pendiente_aprobacion' order by created_at, id limit 50;

-- @nombre: pantalla.vigia.tablero_fallidos_24h
-- @tipo: pantalla
-- @origen: cargarTablero
select * from vigia_mensaje where tenant_id = :T and direccion='saliente' and estado='fallido' and created_at >= now() - interval '24 hours' order by created_at desc, id limit 20;

-- @nombre: pantalla.vigia.tablero_eventos
-- @tipo: pantalla
-- @origen: cargarTablero (bitácora)
select id, tipo, nivel, created_at, conversacion_id from vigia_evento where tenant_id = :T order by id desc limit 40;

-- @nombre: pantalla.vigia.tablero_enviadas_7d
-- @tipo: pantalla
-- @origen: cargarTablero (tiempo de primera respuesta)
select respuesta_a, enviado_en from vigia_mensaje where tenant_id = :T and direccion='saliente' and estado='enviado' and respuesta_a is not null and enviado_en >= now() - interval '7 days' order by enviado_en desc, id limit 100;

-- @nombre: pantalla.admin.resumen_negocio
-- @tipo: pantalla
-- @origen: admin/negocio.ts getResumenNegocio → rpc resumen_negocio
select resumen_negocio(now() - interval '30 days');

-- @nombre: pantalla.admin.resumen_negocio_12m
-- @tipo: pantalla
-- @origen: admin/negocio.ts (ventana de un año)
select resumen_negocio(now() - interval '365 days');

-- @nombre: pantalla.admin.salud_latidos
-- @tipo: pantalla
-- @origen: admin/salud.ts (cron_latido)
select * from cron_latido limit 100;

-- @nombre: pantalla.admin.liquidaciones_en_revisar
-- @tipo: pantalla
-- @origen: admin/negocio.ts getLiquidacionesEnRevisar (cruza flotas)
select id, tenant_id, viaje_id, estatus, created_at from liquidacion where estatus = 'revisar' order by created_at desc, id limit 200;

-- @nombre: pantalla.ruta.importar_viajes_folios
-- @tipo: pantalla
-- @origen: importar_viajes.ts:341 (folios existentes del tenant, sin ventana; traerTodo offset)
select folio from viaje where tenant_id = :T and folio is not null order by id limit 1000 offset 50000;

-- @nombre: pantalla.ruta.cotizador_liquidadas_366d
-- @tipo: pantalla
-- @origen: cotizador/lector.ts:146 (liquidacion por ventana, offset)
select * from liquidacion where tenant_id = :T and created_at >= now() - interval '366 days' order by id limit 1000 offset 60000;

-- @nombre: pantalla.ruta.facturas_por_facturar
-- @tipo: pantalla
-- @origen: facturacion/pendientes.ts:159 getPorFacturar
select id, viaje_id, monto, fecha from gasto where tenant_id = :T and cfdi_uuid is null and fecha >= current_date - 45 and concepto <> 'factura' order by fecha, id limit 1000 offset 5000;

-- @nombre: pantalla.ruta.admin_viaje_sin_ventana_global
-- @tipo: pantalla
-- @origen: sat_descarga/peaje_cierre.ts:246 (gasto de todos los tenants, caseta sin CFDI, mes en curso)
select id, tenant_id, viaje_id, monto, fecha from gasto where concepto = 'caseta' and cfdi_uuid is null and fecha >= date_trunc('month', now())::date order by tenant_id, fecha, id limit 1000;
