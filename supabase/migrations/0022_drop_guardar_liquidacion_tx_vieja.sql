-- ═══════════════════════════════════════════════════════════════════════════
-- 0022 — Elimina la sobrecarga VIEJA de guardar_liquidacion_tx (11 parámetros).
--
-- ESTA MIGRACIÓN YA ESTABA APLICADA EN PRODUCCIÓN Y NO EXISTÍA EN EL REPO.
--
-- Hallazgo CRÍTICO de la auditoría 5 (modelo de datos), verificado:
--   · `supabase/migrations/` salta de 0021 a 0023;
--   · `git log --all --diff-filter=A -- 'supabase/migrations/0022*'` sale vacío
--     — nunca existió en la historia;
--   · el mensaje del commit 52adedb dice "Mig. 0022 elimina la vieja", pero el
--     `--stat` de ese mismo commit solo trae 0021.
-- Se aplicó a mano contra producción y el repo se quedó sin ella.
--
-- POR QUÉ IMPORTA. 0013 creó la función con 11 parámetros; 0021 la recreó con
-- 12, siendo el último `p_litros_diesel numeric default 0`. `create or replace`
-- NO reemplaza una firma distinta: crea una SOBRECARGA. Con las dos vivas, una
-- llamada de 11 argumentos casa con ambas y Postgres responde
-- `function guardar_liquidacion_tx(...) is not unique` — que es exactamente lo
-- que el commit 52adedb describe como "habría roto TODO cierre en producción".
--
-- Sin este archivo, cualquier `supabase db push` sobre un proyecto limpio (una
-- rama de Supabase, staging, un restore, o el segundo tenant que se dé de alta
-- para el demo) aplica 0013 y 0021 y **nace roto**. Y el arranque no lo
-- detectaba: `verificarMigracionesCriticas` sondea 0005, 0011, 0016 y 0017, no
-- esta, así que habría dicho `ok: true` sobre una base que no puede cerrar una
-- sola liquidación.
--
-- Es idempotente: `if exists` la deja pasar donde ya se aplicó a mano.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists guardar_liquidacion_tx(
  uuid, uuid, numeric, numeric, numeric, text, jsonb, numeric, numeric, numeric, text
);

-- Comprobación dura: después de esto tiene que quedar UNA sola. Si quedaran dos,
-- la migración falla aquí en vez de dejar la base en el estado que rompe el
-- cierre — que es el modo de falla que este archivo viene a impedir.
do $$
declare n int;
begin
  select count(*) into n
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'guardar_liquidacion_tx';

  if n <> 1 then
    raise exception
      'guardar_liquidacion_tx debe quedar con UNA sola firma y hay %. Con más de una, toda llamada de 11 argumentos falla con "is not unique" y ninguna liquidación cierra.', n;
  end if;
end $$;
