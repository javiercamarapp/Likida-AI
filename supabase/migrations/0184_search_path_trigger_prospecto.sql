-- Cierra el único search_path mutable reportado por el advisor de seguridad.
-- Es una función trigger INVOKER; el trigger no necesita que los roles web
-- puedan invocarla como RPC.
alter function public.prospecto_marca_updated() set search_path = public, pg_catalog;
revoke all on function public.prospecto_marca_updated() from public, anon, authenticated;
