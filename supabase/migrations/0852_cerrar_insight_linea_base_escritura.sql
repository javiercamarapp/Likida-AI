-- ═══════════════════════════════════════════════════════════════════════════
-- 0852 — Cierra la policy `for all` de `insight_linea_base` que la 0841 dejó
-- FUERA de su barrido (AUDITORÍA DE SEGURIDAD 21-OCT-2026).
--
-- MISMO HALLAZGO que cerró la 0841 (léela primero si hace falta contexto):
-- la 0805 le puso a `insight_linea_base` una policy `for all` acotada por
-- `administra_flota()` y tenant, y además otorgó INSERT/UPDATE/DELETE a mano
-- a `authenticated` — abierta vía PostgREST con el propio JWT + anon key, sin
-- pasar por la app ni dejar rastro en `bitacora_auditoria`, para cualquier
-- sesión cuyo rol satisfaga `administra_flota()` sobre su tenant.
--
-- La 0841 enumeró 10 tablas con ese MISMO patrón (`for all` + sin escritor de
-- aplicación) y las cerró, pero `insight_linea_base` no estaba en su lista —
-- se creó en la 0805, ANTES de la auditoría que originó la 0841, y nadie
-- volvió a barrerla en esa ronda. Verificado hoy, igual que la 0841 verificó
-- las suyas: CERO escritores de aplicación llaman esta tabla. Los tres
-- archivos que la mencionan en todo el repo son
-- `src/lib/likida/insights/linea_base.ts` (cómputo puro: usa el nombre de la
-- tabla solo como ETIQUETA de una fuente en el resultado, no hace I/O),
-- `src/lib/likida/insights/invariantes.test.ts` (prueba de invariantes sobre
-- ese cómputo) y `src/lib/likida/migraciones_verificadas.test.ts` (este mismo
-- registro). El panel para que la flota capture su línea base todavía no
-- existe; cuando exista, escribirá por `service_role` desde código de
-- servidor, igual que el resto del producto (ver cabecera 0841) — ese día
-- hará falta una policy de escritura nueva y acotada, no reabrir ésta.
--
-- CIERRE — mismo patrón que la 0841: se sustituye el `for all` por un
-- `for select` (la lectura del panel de insights NO se rompe, sigue acotada
-- a tenant + `administra_flota()`/superadmin) y se revoca la escritura
-- directa por PostgREST. A diferencia de las 10 tablas de la 0841 (que nunca
-- tuvieron GRANT explícito de escritura y dependían solo de la ausencia de
-- policy), la 0805 SÍ otorgó INSERT/UPDATE/DELETE a `authenticated` a mano —
-- así que aquí además se revoca ese grant explícito, para que la tabla quede
-- cerrada por las DOS capas (el grant Y la policy), no solo por una.
--
-- `capturada_por` (FK simple a `app_user(id)`, sin acotar a `tenant_id`): se
-- deja A PROPÓSITO, no por descuido. No es el mismo patrón que las FK
-- compuestas de 0385/0809/0823 — esas acotan referencias entre ENTIDADES de
-- negocio dentro del tenant (`cliente`, `geocerca`, `viaje_hito`,
-- `cliente_documento_requerido`), donde una fila que apunte a la entidad de
-- OTRO tenant es un bug de lógica silencioso. `capturada_por` es una columna
-- de AUDITORÍA ("quién lo capturó a mano"), y el patrón establecido para ese
-- tipo de columna —grep confirma más de 40 columnas iguales: `creada_por`,
-- `actualizado_por`, `resuelto_por`, `autorizada_por`, `decidida_por`,
-- `conciliada_por`, `confirmado_por`, `invitado_por`, `actor_id`… en 0047,
-- 0051, 0053, 0057, 0076, 0088, 0093, 0094, 0105, 0107, 0110, 0117, 0118,
-- 0121, 0123, 0169, 0178, 0185, 0198, 0207, 0209, 0213, 0214, 0215, 0225,
-- 0226, 0228, 0229, 0231, 0241 y más— es SIEMPRE la FK simple contra
-- `app_user(id) on delete set null`, nunca una compuesta. `app_user` ni
-- siquiera tiene hoy una `unique (id, tenant_id)` que soportara una FK
-- compuesta. Convertir SOLO ésta a compuesta no cerraría un hallazgo: abriría
-- una inconsistencia nueva contra el patrón real del repo. Lo que de verdad
-- impedía que `capturada_por` se llenara con el id de un usuario ajeno vía
-- PostgREST era la escritura directa que este archivo cierra — por
-- `service_role` la rellena la propia app con el id correcto, igual que las
-- otras 40.
--
-- Aditiva e idempotente (drop + create dentro de la misma transacción: nunca
-- se deja la tabla sin policy de lectura entre los dos pasos).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

drop policy if exists administra_flota on public.insight_linea_base;
create policy administra_flota on public.insight_linea_base for select
  using ((tenant_id = any(public.get_user_tenant_ids()) and public.administra_flota()) or public.is_superadmin());

revoke insert, update, delete on table public.insight_linea_base from authenticated;

commit;
