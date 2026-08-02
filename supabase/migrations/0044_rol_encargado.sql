-- ═══════════════════════════════════════════════════════════════════════════
-- 0044 — Quinto rol: `encargado`. Ve todo el tenant como `flota_admin`, pero
-- solo puede asignar viajes a choferes — no factura, no invita usuarios
-- (docs/superpowers/plans/2026-08-02-roles-flota.md).
--
-- RLS no cambia: `tenant_data` (0001:113-118) es por tenant, no por rol, así
-- que `encargado` hereda el mismo acceso de lectura/escritura que
-- `flota_admin`/`contador` ya tienen hoy. Lo que sí distingue es el permiso
-- de nivel aplicación (`src/lib/auth/permisos.ts`), que decide qué botones
-- se pintan — igual que hoy decide si se pinta "Exportar CSV".
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
    check (rol in ('superadmin', 'flota_admin', 'contador', 'operador', 'encargado'));
end $$;

comment on constraint app_user_rol_dominio on app_user is
  'De este dominio depende is_superadmin() y por tanto la RLS de las 7 tablas de negocio. encargado agregado en 0044.';
