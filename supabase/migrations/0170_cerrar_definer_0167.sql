-- ═══════════════════════════════════════════════════════════════════════════
-- 0170 — cerrar `prospecto_toque_marca_prospecto` (fuga introducida por 0167)
--
-- La 0167 creó la función `security definer` y NO le revocó los permisos por
-- defecto. En Postgres una función nace con EXECUTE para PUBLIC, y `anon`
-- pertenece a PUBLIC: quedó una función definer ejecutable por cualquiera que
-- llegue con la llave anónima. Lo cazó el bloque 3683 de verificaciones.sql
-- (`funciones_security_definer_abiertas_a_anon`), que llevaba desde el 23-ago
-- poniendo CI Postgres en rojo — rojo que nadie miraba porque master no exige
-- ese check para fusionar.
--
-- Es una función de TRIGGER: nadie la invoca por nombre y no tiene por qué ser
-- ejecutable por ningún rol de cliente. El trigger la corre con los permisos
-- del dueño de la tabla, así que revocarla no le quita nada al producto.
--
-- La lección, para la próxima función definer: `security definer` sin su
-- `revoke ... from public` es una puerta abierta, no un detalle de estilo.
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on function public.prospecto_toque_marca_prospecto() from public;
revoke all on function public.prospecto_toque_marca_prospecto() from anon;
revoke all on function public.prospecto_toque_marca_prospecto() from authenticated;
