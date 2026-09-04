-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 25 · DATOS-M3 (MEDIO, REINCIDENTE DATOS-24) — la FK compuesta de
-- la 0290 seguía con `on delete set null` SIN lista de columnas: borrar un
-- operador vaciaba también `app_user.tenant_id`, no solo `operador_id`.
--
-- La 0290 (línea 111-113) dejó:
--   alter table public.app_user add constraint app_user_operador_tenant_fkey
--     foreign key (operador_id, tenant_id) references public.operador (id, tenant_id)
--     on delete set null not valid;
--
-- En Postgres, `ON DELETE SET NULL` SIN lista anula TODAS las columnas de la
-- FK — aquí las dos, `operador_id` Y `tenant_id`. El repo ya sabe hacerlo
-- bien: `0145:21-25` documenta por qué (Postgres 15+ admite `on delete set
-- null (columna)` para anular solo una), lo usa en sus otras 20 FK
-- compuestas, y la 0298:54 lo hace explícito con `on delete set null
-- (terminal_id)`. La 0290 fue la única que lo omitió.
--
-- Consecuencia real: soporte borra un operador duplicado
-- (`delete from operador where id = '…'`) → la fila de `app_user` del
-- encargado que lo tenía queda con `operador_id = null` Y `tenant_id = null`
-- —`app_user.tenant_id` es nullable desde `0001:17` porque NULL ahí significa
-- "superadmin"—. `get_user_tenant_ids()` devuelve `[]`, ese usuario abre
-- `/dashboard` y ve su flota vacía sin un solo error, con una fila que tiene
-- la forma reservada al superadmin.
--
-- Mismo patrón de la 0290 misma (sección 6): soltar, recrear con la lista, y
-- reintentar VALIDATE sin poder tumbar el deploy si una fila vieja ya quedó
-- mal (no debería: la 0290 ya vació ambas columnas en las filas que tocó, y
-- SET NULL (operador_id) es un subconjunto ESTRICTAMENTE más chico de lo que
-- SET NULL sin lista ya hacía, así que ninguna fila que pasaba antes deja de
-- pasar ahora).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.app_user drop constraint if exists app_user_operador_tenant_fkey;
alter table public.app_user add constraint app_user_operador_tenant_fkey
  foreign key (operador_id, tenant_id) references public.operador (id, tenant_id)
  on delete set null (operador_id) not valid;

comment on constraint app_user_operador_tenant_fkey on public.app_user is
  'FK compuesta con SET NULL de UNA sola columna (auditoría 25, DATOS-M3): borrar el operador vacía operador_id, nunca tenant_id. Sin la lista de columnas (como la dejó la 0290), Postgres anula TODA la FK y deja al usuario con la forma reservada al superadmin (tenant_id null, 0001:17).';

do $$
begin
  alter table public.app_user validate constraint app_user_operador_tenant_fkey;
exception when others then
  raise notice 'DATOS-M3/0310: app_user_operador_tenant_fkey sigue NOT VALID (hay filas previas que no cumplen): %', sqlerrm;
end $$;
