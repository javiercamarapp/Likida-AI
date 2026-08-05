-- 0074 — `pg_temp` en las cuatro funciones que resuelven TODAS las políticas RLS.
--
-- AUDITORÍA DE DATOS, MEDIO. Comprobado contra el catálogo:
--
--     is_superadmin         search_path=public              ← sin pg_temp
--     get_user_tenant_ids   search_path=public              ← sin pg_temp
--     is_operador           search_path=public              ← sin pg_temp
--     get_user_operador_id  search_path=public              ← sin pg_temp
--     ve_finanzas           search_path=public, pg_temp     ← sí lo tiene
--     administra_flota      search_path=public, pg_temp     ← sí lo tiene
--
-- Las dos de la 0048 lo tienen y las cuatro de antes no: es olvido, no decisión.
--
-- POR QUÉ IMPORTA EN ESTAS CUATRO. Son `SECURITY DEFINER` y son las que toda
-- política RLS del esquema llama para decidir qué flota ve cada quien. Cuando
-- `pg_temp` no está NOMBRADO en `search_path`, Postgres lo antepone igual de
-- forma implícita: cualquier rol puede crear una tabla o una función temporal
-- en su propia sesión y ganarle la resolución de nombre a la del esquema
-- `public`. En una función que corre con los permisos de su dueño, eso es un
-- camino a suplantar la respuesta de "¿de qué flotas es este usuario?".
--
-- Nombrar `pg_temp` AL FINAL lo fija en último lugar y cierra el camino. Es la
-- misma corrección que la 0035 hizo para el resto del esquema y que la 0048
-- aplicó bien desde el principio.
--
-- Se usa `alter function … set search_path` a propósito, y NO un
-- `create or replace`: cambia solo el atributo y no puede alterar por accidente
-- el cuerpo de las cuatro funciones de las que cuelga toda la seguridad.
-- Tampoco toca permisos ni dueños.

alter function public.is_superadmin()        set search_path = public, pg_temp;
alter function public.get_user_tenant_ids()  set search_path = public, pg_temp;
alter function public.is_operador()          set search_path = public, pg_temp;
alter function public.get_user_operador_id() set search_path = public, pg_temp;

-- ── El trigger: la auditoría lo llamó `SECURITY DEFINER` y NO lo es ──────
--
-- Verificado en el catálogo: `gasto_no_tras_liquidar` tiene `prosecdef = false`,
-- así que corre con los permisos de quien dispara el INSERT, no con los del
-- dueño. El riesgo de suplantación por `pg_temp` es por eso mucho menor que en
-- las cuatro de arriba — pero la función no tiene NINGÚN `search_path` fijo
-- (`proconfig` viene vacío), que es un hueco distinto y peor de lo que la
-- auditoría describió: no le falta `pg_temp`, le falta el `search_path` entero.
--
-- Es el trigger que la 0036 llama "el peor bug histórico del camino del dinero"
-- (PDF y WhatsApp diciendo cifras contrarias del mismo viaje), así que se le
-- fija igual: cuesta nada y quita la duda.
alter function public.gasto_no_tras_liquidar() set search_path = public, pg_temp;
