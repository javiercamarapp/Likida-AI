-- ═══════════════════════════════════════════════════════════════════════════
-- INTEGRACIÓN AUDITORÍA 24 — reconcilia dos redefiniciones independientes de
-- `gasto_no_tras_liquidar()` que se pisaron sin que ninguno de los dos
-- constructores lo supiera: dos ramas en paralelo, la misma función SQL.
--
-- La 0283 (fiscal, DAT-4) le agregó la punta que faltaba: mirar TAMBIÉN
-- `old.viaje_id` en un UPDATE, para que mover un gasto FUERA de un viaje ya
-- liquidado también rebote (antes solo miraba `new.viaje_id`, así que mover
-- un gasto DESDE un viaje liquidado HACIA uno abierto pasaba limpio).
--
-- La 0299 (revision, BLOQ-6), aplicada DESPUÉS en el orden de archivo, hizo
-- `create or replace function` de la MISMA función con SU propio cuerpo —
-- que necesitaba el escape de la RPC de revisión (GUC
-- `likida.revision_en_curso`) y que una liquidación `rechazada` no cuente
-- como "emitida" — pero partió de la forma VIEJA (solo `new.viaje_id`, sin
-- la mitad de la 0283), no de la que la 0283 ya había dejado. `create or
-- replace` no fusiona: la última definición gana entera, y la 0299 se llevó
-- la mitad de la 0283 sin que ninguna prueba lo notara hasta que la batería
-- completa de esta integración corrió las dos migraciones en orden contra
-- Postgres real (bloque 230, INMUTABLE_TRAS_LIQUIDAR_0283 — mover/reten/
-- descuento en falso).
--
-- Esta migración no es un tercer diseño: es la UNIÓN de las dos necesidades,
-- verificada de nuevo contra el bloque 230 después de aplicarse.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.gasto_no_tras_liquidar()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  ya boolean;
begin
  -- 0299 (revision): la RPC de revisión ajusta montos dentro de su propia
  -- transacción, con el candado ya tomado por revisar_liquidacion() —
  -- ella misma decide si el ajuste es válido; este trigger no la bloquea.
  if coalesce(current_setting('likida.revision_en_curso', true), '') = '1' then
    return new;
  end if;

  -- Serializa contra el cierre. No se usa el valor: se usa el candado.
  perform 1 from viaje where id = new.viaje_id for update;

  -- 0299: una liquidación RECHAZADA no cuenta como "emitida" — el chofer
  -- tiene que poder mandar el ticket bueno y el motor vuelve a cuadrar.
  select exists (
    select 1 from liquidacion where viaje_id = new.viaje_id and revision <> 'rechazada'
  ) into ya;
  if ya then
    raise exception 'el viaje % ya tiene liquidación emitida: el gasto llegó tarde', new.viaje_id
      using errcode = 'CU001';
  end if;

  -- 0283 (fiscal, DAT-4): LA PUNTA DE DONDE SALE. Un gasto que se va de un
  -- viaje ya liquidado (y con esa liquidación NO rechazada) deja ese papel
  -- diciendo una cifra que la base ya no puede reproducir — el daño es
  -- idéntico al de agregarlo tarde. Solo aplica en UPDATE: en INSERT `old`
  -- no está asignado.
  if tg_op = 'UPDATE' and old.viaje_id is distinct from new.viaje_id then
    perform 1 from viaje where id = old.viaje_id for update;
    select exists (
      select 1 from liquidacion where viaje_id = old.viaje_id and revision <> 'rechazada'
    ) into ya;
    if ya then
      raise exception 'el viaje % ya tiene liquidación emitida: su gasto no se puede mover a otro viaje', old.viaje_id
        using errcode = 'CU001';
    end if;
  end if;

  return new;
end $$;

comment on function public.gasto_no_tras_liquidar() is
  'Impide agregar o editar gastos de un viaje cuya liquidación YA se emitió y no fue rechazada (CU001), y (0283) mover un gasto FUERA de uno liquidado. Escape para revisar_liquidacion() vía el GUC likida.revision_en_curso. Reconciliación de la 0283 (fiscal) y la 0299 (revision), que se pisaron — ver la cabecera de esta migración (0300).';
