-- REVERSA (sin datos de `nomina`; si los hay, primero pasar esos usuarios a otro rol o desactivarlos y borrarlos):
--   alter table public.app_user drop constraint if exists app_user_rol_dominio;
--   alter table public.app_user add constraint app_user_rol_dominio
--     check (rol in ('superadmin', 'flota_admin', 'contador', 'encargado', 'vendedor'));
--   (la constraint nueva falla si queda una fila con rol = 'nomina': por eso el paso previo.)
-- APLICACION DOBLE: idempotente (suelta la constraint si existe y la recrea con la lista completa).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 0949 — Rol `nomina` (Nomina y RH de una flota con perfil cinco_agentes).
--
-- Solo AMPLIA el dominio de `app_user.rol` con 'nomina' (mismo patron que 0044/0086/0105). Conserva exactamente
-- el resto del dominio de la 0105: superadmin, flota_admin, contador, encargado, vendedor.
--
-- LO QUE NO CAMBIA (a proposito):
--   · is_superadmin(), ve_finanzas(), administra_flota() y ve_operacion() filtran por listas POSITIVAS de
--     roles (`rol in (...)`), asi que 'nomina' da false en las cuatro sin tocarlas. No se redefinen aqui:
--     redefinirlas arriesgaria cambiar el comportamiento de los roles existentes.
--   · La RLS de las tablas de negocio (patron tenant_data) tampoco cambia. En produccion authenticated solo
--     lee app_user (0947); el panel lee con service_role y decide la visibilidad en visibilidad.ts.
--   · Sin tablas ni funciones nuevas, por lo tanto sin grants nuevos.
--
-- Mientras esta migracion no este aplicada nadie puede tener rol `nomina` (la constraint lo rechaza), asi que
-- el codigo que lo reconoce es inerte para los demas roles.
-- ═══════════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'app_user_rol_dominio' and conrelid = 'public.app_user'::regclass
  ) then
    alter table public.app_user drop constraint app_user_rol_dominio;
  end if;

  alter table public.app_user
    add constraint app_user_rol_dominio
    check (rol in ('superadmin', 'flota_admin', 'contador', 'encargado', 'vendedor', 'nomina'));
end $$;

comment on constraint app_user_rol_dominio on app_user is
  'De este dominio depende is_superadmin() y por tanto la RLS de las tablas de negocio. operador retirado en 0086 (el chofer solo tiene WhatsApp); vendedor agregado en 0105 (rol de LIKIDA, tenant_id null, panel /vendedor); nomina agregado en 0949 (Nomina y RH de una flota con perfil cinco_agentes: solo conteos del Agente de Liquidacion; ve_finanzas/ve_operacion/administra_flota/is_superadmin son false para este rol).';
