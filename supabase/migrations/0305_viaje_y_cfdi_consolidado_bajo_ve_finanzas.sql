-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 25 · SEGURIDAD, ALTO (línea 88) — `viaje` y `cfdi_consolidado_linea`
-- entran al dominio de `ve_finanzas()`.
--
-- El jefe de tráfico (`encargado`) NO debe ver finanzas — `visibilidad.ts:41`
-- solo le da el área 'operacion', y el panel lo respeta. Pero el panel lee con
-- `supabaseAdmin()` (service_role, que SALTA RLS por completo — confirmado
-- contra `src/lib/supabase/admin.ts` y contra el grep de todos los `.from
-- ('viaje')`/`.from('cfdi_consolidado_linea')` de `src/`: ninguno pasa por el
-- cliente de sesión de `@/lib/supabase/server`). La única frontera real contra
-- un `curl` directo a PostgREST con la cookie del propio encargado es RLS, y
-- `viaje`/`cfdi_consolidado_linea` se quedaron con el `tenant_data` genérico
-- que la 0086 recreó (por tenant, sin mirar rol) cuando `ve_finanzas()` (0048)
-- ya se había aplicado tabla por tabla a `cliente`/`tarifa`/`factura_emitida`/
-- `pago_recibido`/`cotizacion`/`liquidacion`/`gasto`/`cfdi_xml`/`llm_costo`. La
-- 0292 pasó ese `tenant_data` de `for all` a `for select` copiando el MISMO
-- `qual` del catálogo — no lo endureció, y la fuga pasó de escritura a lectura
-- intacta.
--
-- `viaje.anticipo` (0001:52) e `ingreso_flete` (0048:145) son las dos entradas
-- del margen por viaje; `cfdi_consolidado_linea.monto` (0076) es cada
-- transacción de monedero de diésel/TAG de casetas. Un `encargado` con
-- `curl 'https://<ref>.supabase.co/rest/v1/viaje?select=folio,anticipo,
-- ingreso_flete' -H 'Authorization: Bearer <su propio access_token>'` los lee
-- completos, sin pasar por la app y sin dejar fila en `bitacora_auditoria`.
--
-- POR QUÉ EL TABLÓN COMPLETO Y NO SOLO LAS DOS COLUMNAS: RLS filtra FILAS, no
-- columnas, y `viaje` mezcla dato operativo (folio, origen, destino, operador)
-- con dinero — una vista con máscara de columna serviría, pero NINGÚN camino
-- real del producto lee estas dos tablas por PostgREST con la sesión del
-- usuario (confirmado arriba): cerrar la tabla entera a `ve_finanzas()` no le
-- quita nada al `encargado` que hoy use, y es el mismo molde ya aplicado nueve
-- veces en este repo — el que la 0146 declaró (de más) como el cierre final.
--
-- Verificado en rojo contra Postgres real con las 282 migraciones antes de
-- este archivo: un `encargado` impersonado leía 1 fila de `viaje` y 1 de
-- `cfdi_consolidado_linea` de su propio tenant, y ninguna de las dos policies
-- mencionaba `ve_finanzas`. El bloque 251 de `verificaciones.sql` fija el caso
-- en verde.
--
-- OJO CON EL NOMBRE EN `viaje`: no es `tenant_data`. La 0158 (DAT-03) partió
-- su entonces `tenant_data` (for all) en tres policies nombradas por sufijo
-- —`tenant_data_select`/`_insert`/`_update`— ANTES de que la 0292 corriera su
-- barrido genérico (que solo busca `policyname in ('tenant_data',
-- 'tenant_finanzas') and cmd = 'ALL'` en el catálogo). Por eso el barrido de
-- la 0292 nunca tocó `viaje`: ya no había ningún `tenant_data` que calzara.
-- La 0292 sí retiró `tenant_data_insert`/`_update` a mano (comentario propio:
-- «viaje ya no tiene policy de INSERT/UPDATE»), dejando `tenant_data_select`
-- como la ÚNICA policy viva de `viaje` hoy — confirmado contra `pg_policies`
-- en Postgres real, no contra el texto de las migraciones (un primer intento
-- de este archivo creó una `tenant_data` NUEVA que no dropeaba nada, y las
-- dos policies permisivas se combinan con OR: la vieja seguía abriendo la
-- fuga completa mientras la nueva, más estricta, no restringía nada).
-- `cfdi_consolidado_linea` no pasó por la 0158 (no está en su lista de tres
-- tablas) y conserva el nombre `tenant_data` que la 0292 sí convirtió.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists tenant_data_select on public.viaje;
create policy tenant_data_select on public.viaje for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());

drop policy if exists tenant_data on public.cfdi_consolidado_linea;
create policy tenant_data on public.cfdi_consolidado_linea for select
  using ((tenant_id = any(get_user_tenant_ids()) and ve_finanzas()) or is_superadmin());
