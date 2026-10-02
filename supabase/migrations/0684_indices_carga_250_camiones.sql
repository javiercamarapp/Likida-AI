-- ═══════════════════════════════════════════════════════════════════════════
-- 0684 — índices que faltaban a la escala de UNA flota de 250 camiones /
-- 5,000 viajes al mes (ronda 16, scripts/carga/250-camiones/).
--
-- Medido con EXPLAIN (ANALYZE, BUFFERS) sobre ~60k viajes, 240k gastos, 325k
-- hitos, 3.2 M posiciones y 20 flotas chicas de ruido (README de esa carpeta).
-- Cada índice cierra un Seq Scan sobre una tabla grande que una consulta REAL
-- del código dispara con filtro por tenant o con orden por fecha:
--
--   gasto_folio_sin_cfdi_idx        anomalias_gasto_tenant (rama «folio_duplicado»,
--                                    0685): agrupa los gastos sin UUID por
--                                    (concepto, folio, monto) de TODO el historial.
--   vigia_mensaje_aprobado_idx      vigia/repo.ts aprobadosAtorados (cron Vigía, cada pasada).
--   vigia_mensaje_enviado_idx       vigia/repo.ts cargarTablero «enviadas 7 días».
--   viaje_hito_mensaje_en_idx       conductor/repo_validacion.ts leerDatosEstadias
--                                    (tablero de estadías: llegadas por rango de mensaje_en).
--   viaje_hito_tenant_actualizado_idx  conductor/repo.ts leerHitos (/v1/hitos, order updated_at desc).
--   viaje_hito_evento_creado_idx / viaje_hito_aviso_creado_idx
--                                    purgar_conductor_auditoria (cron purgar, `created_at < …`).
--   vigia_evento_creado_idx          mantener_ledgers (0680, vigia_evento por created_at global).
--
-- Sin CONCURRENTLY a propósito en este archivo (el apply transaccional lo
-- prohíbe). Para una base con las tablas ya enormes, correr ANTES de migrar
-- scripts/ci/0684_preflight_indices_carga.sql (CONCURRENTLY, mismo nombre y
-- definición): `if not exists` hace que esta migración los dé por buenos.
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists gasto_folio_sin_cfdi_idx
  on public.gasto (tenant_id, concepto, folio, monto) include (viaje_id, id)
  where folio is not null and folio <> '' and (cfdi_uuid is null or cfdi_uuid = '');

create index if not exists vigia_mensaje_aprobado_idx
  on public.vigia_mensaje (aprobado_en)
  where direccion = 'saliente' and estado = 'aprobado';

create index if not exists vigia_mensaje_enviado_idx
  on public.vigia_mensaje (tenant_id, enviado_en desc)
  where direccion = 'saliente' and estado = 'enviado' and respuesta_a is not null;

create index if not exists viaje_hito_mensaje_en_idx
  on public.viaje_hito (tenant_id, mensaje_en)
  where mensaje_en is not null;

create index if not exists viaje_hito_tenant_actualizado_idx
  on public.viaje_hito (tenant_id, updated_at desc, id desc);

create index if not exists viaje_hito_evento_creado_idx on public.viaje_hito_evento (created_at);
create index if not exists viaje_hito_aviso_creado_idx on public.viaje_hito_aviso (created_at);
create index if not exists vigia_evento_creado_idx on public.vigia_evento (created_at);
