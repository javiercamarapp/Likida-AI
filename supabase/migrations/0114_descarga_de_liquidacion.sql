-- ═══════════════════════════════════════════════════════════════════════════
-- 0114 — Saber si el contador ABRIÓ el papel, no solo si se lo generamos.
--
-- Nace de la pregunta de PMF del 15-ago-2026, con las primeras citas ya
-- agendadas (Grupo GAL, TL del Sur, Súper Akí, Tresguerras) y el envío a
-- Transportes Innovativos. De las tres señales que probarían que el producto
-- se usa de verdad, dos YA se podían medir con lo que el esquema guarda:
--
--   1. El chofer manda comprobantes sin que se lo recuerden
--      → `viaje.recordatorio_comprobacion_en` (si el viaje cerró y esa columna
--        quedó NULL, lo hizo solo).
--   2. El cliente se queja cuando algo se rompe
--      → `ticket_soporte.abierto_por` (NULL = lo abrió Javier). Ojo con la
--        lectura: a esta escala, CERO tickets del cliente NO es buena señal.
--
-- La tercera —y la más importante, porque es la que dice si la liquidación
-- entró al cierre contable de verdad— no se podía medir: `liquidacion` guarda
-- `pdf_url` desde la 0001, pero nada registra si alguien lo bajó. Un PDF
-- generado y nunca abierto se ve idéntico en la base a uno que el contador
-- imprimió y archivó.
--
-- POR QUÉ AHORA Y NO DESPUÉS: esto no se puede medir hacia atrás. Si el
-- primer piloto corre sin la columna, la señal de esos meses se pierde para
-- siempre. Es una columna, y llega antes que el primer cliente.
--
-- QUÉ NO ES: no es analítica de producto ni telemetría de uso general. Es UNA
-- pregunta concreta —¿el papel llegó a manos de quien lo necesita?— y por eso
-- son dos columnas y no una tabla de eventos.
-- ═══════════════════════════════════════════════════════════════════════════

alter table liquidacion
  add column if not exists primera_descarga_en timestamptz,
  add column if not exists descargas integer not null default 0,
  add column if not exists primera_descarga_rol text;

comment on column liquidacion.primera_descarga_en is
  'Cuándo se bajó el PDF por PRIMERA vez, o NULL si nunca. La señal de PMF: una liquidación cuyo papel nadie abrió no entró al cierre de nadie. Lo escribe GET /api/export/pdf/[id] (mig. 0114, 15-ago-2026).';

comment on column liquidacion.descargas is
  'Cuántas veces se bajó el PDF. La primera descarga dice que llegó; que se repita dice que lo consultan. Nunca decrece.';

comment on column liquidacion.primera_descarga_rol is
  'El rol de quien la bajó primero. Distingue la señal REAL (contador/flota_admin la abrió) del ensayo (superadmin = Javier enseñando el producto). Sin esto, una demo se lee igual que un cierre contable.';

-- Índice parcial: la consulta de PMF pregunta "de las liquidaciones de esta
-- flota en este periodo, ¿cuántas se bajaron?" — y las que interesan son las
-- que SÍ tienen fecha. Un índice sobre toda la tabla desperdiciaría espacio en
-- las que están en NULL, que al principio serán casi todas.
create index if not exists liquidacion_descargada_idx
  on liquidacion (tenant_id, primera_descarga_en)
  where primera_descarga_en is not null;

-- ── El registro, en UNA sentencia atómica ───────────────────────────────────
--
-- Va como RPC y no como tres consultas desde el route por dos razones. La
-- primera es la carrera: leer "¿ya tiene primera descarga?" y luego escribirla
-- deja una ventana en la que dos descargas simultáneas del mismo PDF —el
-- contador y su auxiliar apretando a la vez— pisan la fecha o pierden un
-- conteo. Con `coalesce` dentro del propio UPDATE, la primera gana y la
-- segunda no la mueve, sin transacción explícita ni bloqueo.
--
-- La segunda es el tenant: el filtro `tenant_id = p_tenant` viaja DENTRO de la
-- función, no confiado al llamador. El route lo pasa desde la sesión, y aunque
-- el id de liquidación se pudiera adivinar, un id de otra flota no encuentra
-- fila que actualizar.
--
-- SECURITY INVOKER (el default) por la misma razón que la 0112: la app llama
-- con `service_role`, que ya salta RLS —un `definer` no daría un permiso más—
-- y sí haría daño si algún día se olvidara el `revoke`.
create or replace function public.registrar_descarga_liquidacion(
  p_liquidacion uuid,
  p_tenant uuid,
  p_rol text
)
returns void
language sql
volatile
set search_path = public, pg_catalog
as $$
  update liquidacion
     set descargas = descargas + 1,
         primera_descarga_en = coalesce(primera_descarga_en, now()),
         primera_descarga_rol = coalesce(primera_descarga_rol, p_rol)
   where id = p_liquidacion
     and tenant_id = p_tenant;
$$;

comment on function public.registrar_descarga_liquidacion(uuid, uuid, text) is
  'Suma una descarga al PDF de una liquidación y fija la PRIMERA (fecha y rol) si aún no existe, en una sola sentencia: dos descargas simultáneas no se pisan. La llama GET /api/export/pdf/[id]. Falla en silencio si el id no es de esa flota — no hay fila que tocar. SECURITY INVOKER; p_tenant sin default.';

revoke all on function public.registrar_descarga_liquidacion(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.registrar_descarga_liquidacion(uuid, uuid, text) to service_role;
