-- ═══════════════════════════════════════════════════════════════════════════
-- 0126 · HARDENING DE LA BASE — los hallazgos del advisor de Supabase que la
-- auditoría externa del 16-ago-2026 confirmó contra la base LIVE.
--
-- Tres frentes, todos medidos (nada de este archivo es especulativo):
--  1. Las 4 funciones SECURITY DEFINER tenían EXECUTE más amplio de lo
--     necesario (anon incluido). Sus cuerpos solo consultan auth.uid() y no
--     aceptan parámetros — no hay escalación HOY — pero anon no tiene ningún
--     motivo para poder ejecutarlas, y una due diligence pregunta exactamente
--     esto. Se conservan para authenticated (las usan las policies RLS al
--     evaluar como el usuario consultante) y service_role.
--  2. De los 32 FKs sin índice de la base real, se indexan LOS 12 CALIENTES
--     (cola de aprobación, corridas, prospectos, cadencia, chat, conciliado,
--     peajes, SaaS, incidencias, códigos). Los 20 restantes son tablas
--     muertas (campania, politica_gasto, terminal, invitacion,
--     ticket_mensaje), chicas (interruptor: 9 filas) o columnas de actor que
--     nadie filtra — indexarlas sería ruido de mantenimiento, no velocidad.
--  3. Las 4 policies RLS que re-evaluaban auth.*/funciones POR FILA pasan al
--     patrón initplan ((select ...)): con 5 viajes no importa; con millones
--     de comprobantes, sí (el hallazgo literal del advisor).
--
-- La protección de contraseñas filtradas (HIBP) NO es SQL y NO se pudo
-- activar por la Management API (el PATCH regresa false — feature del plan
-- Pro). Relevancia MENOR aquí: el login de Likida es magic link (decisión
-- 4-ago, no se reabre) — no hay contraseñas de usuarios que filtrar. Queda
-- anotado para el día que el plan suba o el login cambie.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1 · SECURITY DEFINER: anon fuera ───────────────────────────────────────
revoke execute on function public.is_superadmin() from anon, public;
revoke execute on function public.get_user_tenant_ids() from anon, public;
revoke execute on function public.administra_flota() from anon, public;
revoke execute on function public.ve_finanzas() from anon, public;
grant execute on function public.is_superadmin() to authenticated, service_role;
grant execute on function public.get_user_tenant_ids() to authenticated, service_role;
grant execute on function public.administra_flota() to authenticated, service_role;
grant execute on function public.ve_finanzas() to authenticated, service_role;

-- ── 2 · Los 12 índices de FKs calientes ────────────────────────────────────
create index if not exists idx_agente_corrida_agente        on public.agente_corrida (agente);
create index if not exists idx_cola_aprobacion_tenant       on public.cola_aprobacion (tenant_id);
create index if not exists idx_cola_aprobacion_prospecto    on public.cola_aprobacion (prospecto_id);
create index if not exists idx_cola_aprobacion_agente       on public.cola_aprobacion (agente);
create index if not exists idx_prospecto_tenant             on public.prospecto (tenant_id);
create index if not exists idx_prospecto_contacto_pieza     on public.prospecto_contacto (pieza_id);
create index if not exists idx_chat_conversacion_user       on public.chat_conversacion (user_id);
create index if not exists idx_ccl_gasto                    on public.cfdi_consolidado_linea (gasto_id);
create index if not exists idx_desglose_peaje_linea_viaje   on public.desglose_peaje_linea (viaje_id);
create index if not exists idx_factura_saas_suscripcion     on public.factura_saas (suscripcion_id);
create index if not exists idx_incidencia_gasto             on public.incidencia (gasto_id);
create index if not exists idx_codigo_pendiente_tenant      on public.codigo_pendiente (tenant_id);

-- ── 3 · RLS initplan: auth.* se evalúa UNA vez, no por fila ────────────────
-- app_user_self era la peor: tres llamadas (auth.uid, get_user_tenant_ids,
-- is_superadmin) por CADA fila del roster.
alter policy app_user_self on public.app_user
  using (
    (id = (select auth.uid()))
    or (tenant_id in (select unnest(public.get_user_tenant_ids())))
    or (select public.is_superadmin())
  );
alter policy plan_lectura on public.plan
  using ((select auth.uid()) is not null);
alter policy avatares_propio_update on storage.objects
  using (
    bucket_id = 'avatares'
    and (storage.foldername(name))[1] = ((select auth.uid()))::text
  );
alter policy avatares_propio_delete on storage.objects
  using (
    bucket_id = 'avatares'
    and (storage.foldername(name))[1] = ((select auth.uid()))::text
  );
