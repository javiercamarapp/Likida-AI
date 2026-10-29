-- REVERSA: `grant select on table public.tenant to authenticated;` (devuelve el SELECT de tabla completo, columna `buzon_token` incluida). Si
-- además se revierte la 0947, reaplicar ESTA migración después de la reversa de la 0947 (la reversa de la 0947 reabre `tenant` entero).
-- Aplicación doble: segura (revoke/grant repetidos son inocuos; la lista de columnas se recalcula desde el catálogo en cada corrida).
-- ═══════════════════════════════════════════════════════════════════════════
-- 0946 — SEGURIDAD OLA 1 · A1 (B-09, SEG-3-01): `tenant.buzon_token` deja de ser legible con el JWT de usuario.
--
-- `buzon_token` es la credencial de los buzones de correo entrante (`f-<token>@mail.likida.ai`, ver 0095): quien la conoce puede mandar
-- «facturas» al buzón de una flota. Vive en `tenant`, que tiene `tenant_self` (SELECT para todo miembro de la flota, chofer incluido) y
-- ningún revoke de columna, así que `GET {SUPABASE_URL}/rest/v1/tenant?select=buzon_token` con la anon key y el JWT de CUALQUIER rol de la
-- flota devolvía el token. Nadie en `src/` lee `tenant` con el JWT de usuario (todo pasa por `supabaseAdmin()`, service_role).
--
-- Mismo patrón que la 0923 §4 (`conector_credencial.valores_cifrados`): un REVOKE de columna no sirve mientras exista un GRANT de tabla,
-- así que se retira el SELECT de tabla a `anon` y `authenticated` y se vuelve a dar a `authenticated` SOLO sobre las demás columnas. La
-- lista sale de `pg_attribute` para no fijar a mano columnas que otras migraciones hayan añadido; `service_role` no se toca.
--
-- DESPUÉS de aplicar en producción (lo hace Javier, no esta migración): ROTAR los `buzon_token` de todas las flotas — el valor desplegado
-- pudo haberse leído por PostgREST antes del cierre.
-- La 0947 después revoca TODO a anon/authenticated sobre las tablas de `public`; esta migración queda como defensa en profundidad si
-- alguna vez se reabre el grant de tabla (p. ej. la reversa de la 0947).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  v_cols text;
begin
  if to_regclass('public.tenant') is null then
    raise notice '0946: public.tenant no existe; nada que hacer';
    return;
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'public.tenant'::regclass and attname = 'buzon_token' and not attisdropped) then
    raise notice '0946: public.tenant.buzon_token no existe; nada que hacer';
    return;
  end if;

  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.tenant'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'buzon_token';

  revoke select on table public.tenant from anon, authenticated;
  execute format('grant select (%s) on table public.tenant to authenticated', v_cols);
end $$;

commit;
