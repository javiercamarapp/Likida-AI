-- ═══════════════════════════════════════════════════════════════════════════
-- 0161 — EL DÍA DE LA BASE ES EL DÍA DE MÉXICO (auditoría prod, DAT-23).
--        IDEMPOTENTE: segura de re-correr.
--
-- Supabase corre en UTC (`show timezone` → UTC). `current_date` es, por lo
-- tanto, el día de LONDRES, y México va seis horas atrás: de las 18:00 a las
-- 24:00 hora local, `current_date` YA ES MAÑANA.
--
-- LO QUE ESO ROMPÍA, en orden de cuánto duele:
--
--  1. `factura_saldo.vencida` — `vence_en < current_date`. Una factura que
--     vence HOY se marcaba VENCIDA a partir de las 18:00, seis horas antes de
--     que el cliente dejara de estar en plazo. De ahí cuelga TODA la cobranza:
--     `cobranza_tenant` y `facturacion_clientes_tenant` (0152) leen `vencida`
--     de esta vista en vez de recalcularla, así que el "vencido" del panel, la
--     antigüedad por cubetas y el orden de la lista heredaban el error. El
--     contralor veía a un cliente moroso que no lo era, y la conversación de
--     cobranza empezaba con una cifra falsa.
--
--  2. Los defaults `current_date` de CUATRO columnas de fecha:
--       · factura_emitida.fecha   (0049:39)
--       · pago_recibido.fecha     (0049:97)
--       · tarifa.vigente_desde    (0048:116)
--       · suscripcion.inicio      (0052:57)
--     Un pago capturado a las 19:00 del 31 de diciembre se guardaba con fecha
--     del 1 de enero: el ingreso cambiaba de EJERCICIO FISCAL. `pago_recibido`
--     es la peor de las cuatro — es dinero que ya entró, y la flota lo declara
--     en el año en que la fila dice que entró.
--
-- POR QUÉ `(now() at time zone 'America/Mexico_City')::date` Y NO CAMBIAR EL
-- TIMEZONE DE LA BASE: mover el timezone de la sesión reinterpretaría TODOS
-- los `timestamptz` de todos los clientes a la vez (el navegador, PostgREST,
-- los crons) y es exactamente la clase de cambio global que no se puede
-- revisar leyendo un diff. Aquí solo cambian cinco expresiones, cada una en su
-- sitio, con la MISMA ortografía que ya usan las RPC de la 0112, la 0150, la
-- 0152 y la 0153 (que sí bucketean por día local desde el principio).
--
-- México NO tiene horario de verano desde 2022, así que este corte es fijo
-- (UTC−6) todo el año. Aun así se usa el nombre de la zona y no `-06:00`: si
-- la regla volviera a cambiar, la base la sigue sola.
--
-- LO QUE **NO** HACE ESTA MIGRACIÓN: tocar una sola fila ya escrita. Las
-- fechas viejas capturadas después de las 18:00 quedaron corridas un día y no
-- hay forma honesta de saber cuáles: `factura_emitida` no guarda el instante
-- del default, solo el `date` resultante, y `creada_en` es el insert, que
-- puede ser otro momento. Reescribirlas con una heurística sería inventar. Lo
-- que sí se hace es CONTARLAS y decirlo (`raise notice`), igual que la 0145
-- contó las FKs antes de imponerlas: el conteo es el que sale abajo, y si
-- alguna se tiene que corregir se corrige a mano, sabiendo cuántas son.
--
-- Reversible: `create or replace view` con `current_date` y cuatro
-- `alter column ... set default current_date`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. EL CONTEO PREVIO — cuántas filas trae hoy la sospecha ───────────────
-- Solo informativo (`notice`, nunca `exception`: esta migración no puede
-- fallar por datos históricos). Dos cifras:
--   · `vencidas_que_dejan_de_serlo`: facturas que la vista de HOY marca
--     vencidas y la nueva ya no. Es 0 salvo que la migración se aplique entre
--     las 18:00 y las 24:00 hora de México, que es justo cuando importa.
--   · `fecha_futura`: filas cuya fecha es POSTERIOR al día de México — la
--     huella que deja un default corrido (una factura de mañana no existe).
do $$
declare
  hoy_mx date := (now() at time zone 'America/Mexico_City')::date;
  hoy_utc date := current_date;
  n_vencidas bigint := 0;
  n_fact bigint; n_pago bigint; n_tarifa bigint; n_susc bigint;
begin
  -- Se lee la vista VIEJA (todavía con current_date): las que marca vencidas
  -- teniendo `vence_en` de hoy o del futuro son exactamente las que el corte
  -- UTC adelantaba.
  select count(*) into n_vencidas
    from public.factura_saldo
   where vencida and vence_en >= hoy_mx;

  select count(*) into n_fact   from public.factura_emitida where fecha > hoy_mx;
  select count(*) into n_pago   from public.pago_recibido where fecha > hoy_mx;
  select count(*) into n_tarifa from public.tarifa        where vigente_desde > hoy_mx;
  select count(*) into n_susc   from public.suscripcion   where inicio > hoy_mx;

  raise notice
    '0161 · dia_mx=%  dia_utc=%  facturas_que_dejan_de_estar_vencidas=%  con_fecha_futura: factura=% pago=% tarifa=% suscripcion=%',
    hoy_mx, hoy_utc, n_vencidas, n_fact, n_pago, n_tarifa, n_susc;
end $$;

-- ── 1. LA VISTA DEL SALDO ──────────────────────────────────────────────────
-- Idéntica a la de la 0049 salvo el `current_date`. `create or replace view`
-- exige mismos nombres, tipos y orden de columnas: se copia entera a
-- propósito, para que el diff enseñe que solo cambió esa línea.
--
-- ⚠ `with (security_invoker = true)` NO ES DECORACIÓN, Y NO SE PUEDE OMITIR.
-- La 0054 lo puso con un `alter view` porque la vista, creada por el rol de
-- servicio, devolvía las facturas de TODAS las flotas a cualquier autenticado
-- que le pegara por PostgREST (`FUGA_VISTA via-tabla=1 via-vista=2`, la fuga
-- entre inquilinos más cara que puede tener este producto). Un
-- `create or replace view` SIN la cláusula RESETEA las reloptions de la vista
-- y reabre esa fuga en silencio — la base no avisa, el código de TypeScript
-- sigue estando bien, y lo único que cambia es que el saldo de un cliente
-- aparece en la pantalla de otro. Se comprobó: escrita sin la cláusula, el
-- bloque 33 de verificaciones.sql (mig. 0054) se puso rojo (`via-vista=2`) en cuanto se
-- aplicó esta migración sobre una base con las 0049/0054 ya puestas.
create or replace view public.factura_saldo
  with (security_invoker = true)
  as
  select f.id                                    as factura_id,
         f.tenant_id,
         f.cliente_id,
         f.total,
         coalesce(sum(p.monto), 0)               as pagado,
         f.total - coalesce(sum(p.monto), 0)     as saldo,
         f.estatus,
         f.vence_en,
         -- Vencida solo si HAY fecha pactada y queda saldo. Sin fecha no se
         -- puede decir que algo se venció: no se pactó cuándo.
         -- DAT-23: el día es el DE MÉXICO. Con `current_date` (UTC) una
         -- factura que vence hoy se marcaba vencida desde las 18:00 locales.
         (f.vence_en is not null
          and f.vence_en < (now() at time zone 'America/Mexico_City')::date
          and f.total - coalesce(sum(p.monto), 0) > 0.01
          and f.estatus not in ('cancelada', 'borrador')) as vencida
    from public.factura_emitida f
    left join public.pago_recibido p on p.factura_id = f.id
   group by f.id;

comment on view public.factura_saldo is
  'Saldo por factura, derivado de los pagos. NO es una columna: una guardada se desincroniza al cancelar un pago y entonces la pantalla y la suma dicen cosas distintas del mismo dinero. security_invoker (0054): se evalua con el RLS de quien consulta — sin eso devolvia las facturas de TODAS las flotas (verificado: via-tabla=1, via-vista=2). `vencida` se juzga contra el dia de MEXICO (0161), no contra current_date (UTC): entre las 18:00 y las 24:00 locales el dia UTC ya es el siguiente y una factura en plazo se leia como morosa.';

-- Cinturón y tirantes: si alguien re-corre una versión vieja de este bloque
-- (o la 0049) encima, esto vuelve a poner la opción. Es idempotente.
alter view public.factura_saldo set (security_invoker = true);

-- ── 2. LOS CUATRO DEFAULTS ─────────────────────────────────────────────────
alter table if exists public.factura_emitida
  alter column fecha set default (now() at time zone 'America/Mexico_City')::date;
alter table if exists public.pago_recibido
  alter column fecha set default (now() at time zone 'America/Mexico_City')::date;
alter table if exists public.tarifa
  alter column vigente_desde set default (now() at time zone 'America/Mexico_City')::date;
alter table if exists public.suscripcion
  alter column inicio set default (now() at time zone 'America/Mexico_City')::date;

comment on column public.factura_emitida.fecha is
  'Fecha del documento, en días de México (0161). El default era current_date = día UTC: una factura emitida después de las 18:00 nacía fechada mañana.';
comment on column public.pago_recibido.fecha is
  'Día en que entró el abono, en días de México (0161). Es la peor de las cuatro columnas que tenían default UTC: un pago capturado a las 19:00 del 31 de diciembre cambiaba de ejercicio fiscal.';
comment on column public.tarifa.vigente_desde is
  'Inicio de vigencia, en días de México (0161). Con el default UTC una tarifa capturada de noche empezaba a regir un día después de lo que su capturista creyó.';
comment on column public.suscripcion.inicio is
  'Alta de la suscripción, en días de México (0161).';
