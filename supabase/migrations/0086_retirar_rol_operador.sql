-- ═══════════════════════════════════════════════════════════════════════════
-- 0086 — Retira `operador` del dominio de roles. El chofer ya no tiene
-- cuenta ni login (/chofer y /mis-viajes salieron el 7-ago-2026): su única
-- interfaz es WhatsApp, que ya corre con el service-role y no pasa por RLS
-- de sesión.
--
-- `is_operador()` NO se quedó donde la 0045 la puso — migraciones
-- posteriores (0047, 0048, 0050, 0051, 0053, 0074) la fueron sumando al
-- patrón `tenant_data` de CADA tabla nueva, hasta 22 policies en 21 tablas
-- (confirmado contra `pg_policies`, no contra el historial de migraciones —
-- el primer intento de esta migración asumía solo 3 y CASCADE hubiera
-- tirado políticas de seguridad reales sin recrearlas). Cada una se
-- reescribe explícita, sin CASCADE, para no perder RLS en el camino.
--
-- NO se toca `app_user.operador_id` (columna) ni la tabla `operador`
-- (negocio — nombre/teléfono/licencia del chofer, identidad de WhatsApp):
-- esa liga sigue existiendo para el bot. Lo que se retira es el LOGIN.
-- ═══════════════════════════════════════════════════════════════════════════

-- Las policies de solo-lectura (y una de escritura, `pod`) que se fueron
-- sumando para el chofer con sesión propia. Lista confirmada contra
-- `pg_depend` en vivo (no contra texto ni memoria) — el primer intento de
-- esta migración se quedó corto en dos (`operador_ve_su_pod`,
-- `operador_sube_su_pod`) por buscar solo "is_operador" en vez de preguntarle
-- al catálogo quién depende de verdad de las funciones.
drop policy if exists operador_ve_su_viaje on public.viaje;
drop policy if exists operador_ve_sus_gastos on public.gasto;
drop policy if exists operador_ve_sus_liquidaciones on public.liquidacion;
drop policy if exists operador_ve_su_pod on public.pod;
drop policy if exists operador_sube_su_pod on public.pod;

-- Las 19 tablas con el patrón simple `tenant_data`: se le quita
-- `and not is_operador()`, que ahora es un chequeo contra un rol que no
-- puede existir. Lista sacada de `pg_policies` en vivo, no de memoria.
do $$
declare t text;
begin
  foreach t in array array[
    'campania', 'cfdi_consolidado_linea', 'cfdi_xml', 'envio_mensaje', 'gasto',
    'geocerca', 'incidencia', 'liquidacion', 'llm_costo', 'mantenimiento',
    'operador', 'pod', 'politica_gasto', 'posicion', 'terminal',
    'ticket_soporte', 'unidad', 'viaje', 'wa_conversacion'
  ]
  loop
    execute format('drop policy if exists tenant_data on %I', t);
    execute format($p$
      create policy tenant_data on %I for all
      using (tenant_id = any(get_user_tenant_ids()) or is_superadmin())
      with check (tenant_id = any(get_user_tenant_ids()) or is_superadmin())
    $p$, t);
  end loop;
end $$;

-- `ticket_mensaje`: mismo criterio, pero su `tenant_data` filtra vía join a
-- `ticket_soporte` (no tiene `tenant_id` propio).
drop policy if exists tenant_data on public.ticket_mensaje;
create policy tenant_data on public.ticket_mensaje for all
  using (exists (
    select 1 from ticket_soporte t
    where t.id = ticket_mensaje.ticket_id
      and (t.tenant_id = any(get_user_tenant_ids()) or is_superadmin())
  ))
  with check (exists (
    select 1 from ticket_soporte t
    where t.id = ticket_mensaje.ticket_id
      and (t.tenant_id = any(get_user_tenant_ids()) or is_superadmin())
  ));

-- `app_user_self`: deja de excluir al operador (ya no puede existir).
drop policy if exists app_user_self on public.app_user;
create policy app_user_self on public.app_user for select
  using (id = auth.uid() or tenant_id = any(get_user_tenant_ids()) or is_superadmin());

-- `bitacora_insercion`: mismo criterio, solo INSERT.
drop policy if exists bitacora_insercion on public.bitacora_auditoria;
create policy bitacora_insercion on public.bitacora_auditoria for insert
  with check (tenant_id = any(get_user_tenant_ids()) or is_superadmin());

-- Ahora sí, sin nada que dependa de ellas.
drop function if exists public.is_operador();
drop function if exists public.get_user_operador_id();

-- El dominio de rol pierde `operador`. Si quedara alguna fila con ese valor
-- (no debería — el código nunca la creó, ver provisionar.ts), el constraint
-- nuevo la rechazaría con un error explícito en vez de aplicarse en
-- silencio: mejor eso que una migración que borra cuentas sin decirlo.
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
    check (rol in ('superadmin', 'flota_admin', 'contador', 'encargado'));
end $$;

comment on constraint app_user_rol_dominio on app_user is
  'De este dominio depende is_superadmin() y por tanto la RLS de las 7 tablas de negocio. operador retirado en 0086 — el chofer ya no tiene login, solo WhatsApp.';
