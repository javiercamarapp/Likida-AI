-- ═══════════════════════════════════════════════════════════════════════════
-- 09 — Resumen: conteos por entidad (la prueba de idempotencia compara esto
-- entre la corrida 1 y la 2, y el kit lo usa para «cómo ver el resultado»).
-- ═══════════════════════════════════════════════════════════════════════════
\echo
\echo '── DEMO Innovativos: filas sembradas ──'
with t as (select current_setting('inn.tenant')::uuid as id)
select entidad, filas from (
  select 1 as o, 'terminales' as entidad, count(*) as filas from terminal, t where tenant_id = t.id
  union all select 2, 'clientes', count(*) from cliente, t where tenant_id = t.id
  union all select 3, 'geocercas', count(*) from geocerca, t where tenant_id = t.id
  union all select 4, 'tractos (unidad)', count(*) from unidad, t where tenant_id = t.id
  union all select 5, 'operadores', count(*) from operador, t where tenant_id = t.id
  union all select 6, 'viajes en curso', count(*) from viaje, t where tenant_id = t.id and estatus = 'abierto'
  union all select 7, 'viajes cerrados (7 días)', count(*) from viaje, t where tenant_id = t.id and estatus = 'liquidado'
  union all select 8, 'hitos del conductor', count(*) from viaje_hito, t where tenant_id = t.id
  union all select 9, '  · recibidos SIN confirmar por GPS', count(*) from viaje_hito, t where tenant_id = t.id and estado = 'recibido'
  union all select 10, '  · escalados (sin señal de vida)', count(*) from viaje_hito, t where tenant_id = t.id and estado = 'escalado'
  union all select 11, 'posiciones GPS (public.posicion)', count(*) from posicion, t where tenant_id = t.id
  union all select 12, 'posiciones GPS (su tabla propia, innovativos_sim)', count(*) from innovativos_sim.gps_posicion
  union all select 13, 'casetas (catálogo)', count(*) from peaje_caseta, t where tenant_id = t.id
  union all select 14, 'líneas de pase de peaje', count(*) from desglose_peaje_linea, t where tenant_id = t.id
  union all select 15, '  · cruces fuera de ruta (no_coincide)', count(*) from desglose_peaje_linea, t where tenant_id = t.id and gps_veredicto = 'no_coincide'
  union all select 16, '  · cobros duplicados sembrados', count(*) from desglose_peaje_linea, t where tenant_id = t.id and detalle ->> 'origen_demo' = 'duplicado'
  union all select 17, 'liquidaciones de su sistema (fase 1)', count(*) from liquidacion_externa, t where tenant_id = t.id
  union all select 18, '  · discrepancias (no coincide)', count(*) from liquidacion_externa, t where tenant_id = t.id and acuse_tipo = 'no_coincide'
  union all select 19, 'documentos de Carta Porte', count(*) from cp_documento, t where tenant_id = t.id
  union all select 20, 'perfiles de Carta Porte', count(*) from cp_perfil, t where tenant_id = t.id
  union all select 21, 'conversaciones del Vigía', count(*) from vigia_conversacion, t where tenant_id = t.id
  union all select 22, 'mensajes del Vigía', count(*) from vigia_mensaje, t where tenant_id = t.id
  union all select 23, 'contactos de escalamiento (tráfico/flota)', count(*) from conductor_contacto_trafico, t where tenant_id = t.id
  union all select 24, 'convenios (copia de su sistema)', count(*) from innovativos_sim.convenio
  union all select 25, 'instrucciones de operación', count(*) from innovativos_sim.convenio_instruccion
) x order by o;
