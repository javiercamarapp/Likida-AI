-- ═══════════════════════════════════════════════════════════════════════════
-- 0054 — DOS AGUJEROS QUE ABRIÓ LA TANDA ANTERIOR. Los dos son míos.
--
-- ── 1. `factura_saldo` ignoraba el RLS de quien consulta (CRÍTICO) ─────────
--
-- Una vista en Postgres corre por default con los permisos de QUIEN LA CREÓ,
-- no de quien la consulta. Como la creó el rol de servicio, `factura_saldo`
-- devolvía las facturas de TODAS las flotas a cualquier usuario autenticado
-- que le pegara por PostgREST — aunque `factura_emitida` tuviera su RLS
-- perfectamente puesto. La política de la tabla no se hereda a la vista.
--
-- Comprobado contra la base antes de arreglarlo, con dos tenants y un
-- flota_admin del primero:
--
--     FUGA_VISTA  via-tabla=1  via-vista=2
--
-- Uno por la tabla (correcto) y DOS por la vista: la segunda factura era de la
-- otra flota. Es la fuga entre inquilinos más cara que puede tener este
-- producto —saldos de un cliente en la pantalla de otro— y no la habría
-- encontrado ninguna prueba de TypeScript, porque el código estaba bien: el
-- que estaba mal era el objeto de la base.
--
-- `security_invoker = true` hace que la vista se evalúe con los permisos y el
-- RLS de quien pregunta, que es lo que se quería desde el principio.
--
-- ── 2. `revoke ... from anon` no revocaba nada ────────────────────────────
--
-- Las funciones nuevas nacen con EXECUTE concedido a `PUBLIC`, y `anon` lo
-- hereda de ahí. Revocárselo a `anon` no le quita el que viene por PUBLIC, así
-- que las dos funciones seguían siendo endpoints RPC abiertos sin sesión:
--
--     ve_finanzas      → puede_ejecutar {anon, authenticated}
--     administra_flota → puede_ejecutar {anon, authenticated}
--
-- No es una fuga de datos —las dos miran `auth.uid()` y sin sesión devuelven
-- false— pero es superficie que nadie pidió, y el mismo error repetido en una
-- función que SÍ devolviera algo sí lo sería. Se revoca a PUBLIC, que es donde
-- vive el permiso, y se concede explícitamente solo a `authenticated`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. La vista, con el RLS de quien pregunta ──────────────────────────────
alter view public.factura_saldo set (security_invoker = true);

comment on view public.factura_saldo is
  'Saldo por factura, derivado de los pagos. security_invoker: se evalua con el RLS de quien consulta. Sin eso devolvia las facturas de TODAS las flotas (verificado: via-tabla=1, via-vista=2).';

-- ── 2. Los permisos donde de verdad viven ──────────────────────────────────
revoke execute on function public.ve_finanzas()      from public;
revoke execute on function public.administra_flota() from public;

grant execute on function public.ve_finanzas()      to authenticated;
grant execute on function public.administra_flota() to authenticated;
