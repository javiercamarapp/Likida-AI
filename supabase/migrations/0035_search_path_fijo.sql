-- ═══════════════════════════════════════════════════════════════════════════
-- `search_path` FIJO EN LAS DIEZ FUNCIONES QUE NO LO TENÍAN.
--
-- Lo reportó el linter de Supabase (`function_search_path_mutable`, 10 WARN) en
-- el barrido de producción del 31-jul.
--
-- QUÉ TAN GRAVE ES, DICHO CON HONESTIDAD: las diez son SECURITY INVOKER —se
-- comprobó en `pg_proc.prosecdef`, no se supuso— así que corren con los
-- privilegios de quien llama y no hay escalada. Y hoy solo las puede ejecutar
-- `service_role`. O sea: el hueco no está abierto.
--
-- Se cierra igual por dos razones concretas:
--
--   1. El día que entre el auth por usuario, `authenticated` va a poder llamar
--      algunas de éstas. Ahí un rol con un esquema propio antes que `public` en
--      su search_path puede hacer que la función resuelva a OTRA tabla con el
--      mismo nombre. Arreglarlo entonces es acordarse; arreglarlo hoy es una
--      línea.
--   2. `telefono_normalizado` se usa en el índice único de la 0024. Una función
--      de índice cuyo resultado dependa del search_path del que escribe es una
--      forma de corromper un índice sin que nadie lo note.
--
-- `alter function ... set` NO toca el cuerpo, así que ni redefine, ni pierde
-- permisos, ni deja dos firmas vivas — la trampa de la 0022.
-- ═══════════════════════════════════════════════════════════════════════════

alter function public.config_tenant_valida(p_config jsonb) set search_path = public, pg_catalog;
alter function public.confirmar_aviso_privacidad(p_operador uuid, p_tenant uuid, p_version text) set search_path = public, pg_catalog;
alter function public.enriquecer_gasto_codigo(p_gasto uuid, p_tenant uuid, p_extra jsonb, p_cfdi_uuid text) set search_path = public, pg_catalog;
alter function public.guardar_liquidacion_tx(p_tenant uuid, p_viaje uuid, p_total_comprobado numeric, p_total_anticipo numeric, p_diferencia numeric, p_estatus text, p_diferencias jsonb, p_ieps numeric, p_iva numeric, p_peaje numeric, p_pdf_url text, p_litros_diesel numeric) set search_path = public, pg_catalog;
alter function public.intake_delta(p_viaje uuid, p_delta integer) set search_path = public, pg_catalog;
alter function public.liberar_aviso_privacidad(p_operador uuid, p_tenant uuid) set search_path = public, pg_catalog;
alter function public.marcar_aviso_privacidad(p_operador uuid, p_tenant uuid, p_version text) set search_path = public, pg_catalog;
alter function public.telefono_normalizado(p_telefono text) set search_path = public, pg_catalog;
alter function public.try_lock_viaje(p_viaje uuid, p_ttl_ms integer) set search_path = public, pg_catalog;
alter function public.unlock_viaje(p_viaje uuid) set search_path = public, pg_catalog;
