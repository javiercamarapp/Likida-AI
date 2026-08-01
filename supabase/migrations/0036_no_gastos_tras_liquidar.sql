-- ═══════════════════════════════════════════════════════════════════════════
-- EL TEXTO Y EL PDF DE LA MISMA RESPUESTA SALÍAN DE DOS FOTOGRAFÍAS DISTINTAS.
--
-- Último crítico de código abierto de las siete rondas de auditoría.
--
-- `guardar_liquidacion` calcula el cuadre y genera los DOS PDF en ese instante
-- (T1). Después el agente hace al menos una ronda más de LLM para redactar, y ya
-- en el processor `guardiaCifras` VUELVE A CALCULAR con `cuadrarDesdeDB` (T2) y
-- con eso arma el texto que lee el operador.
--
-- Entre T1 y T2 hay segundos, y la entrada de ese cálculo —la tabla `gasto`—
-- seguía abierta a escritura: las fotos corren en su propio `processInbound`, NO
-- toman el mutex del viaje, y `addGasto` insertaba sin mirar nada.
--
-- ── EL ESCENARIO, CON NÚMEROS ──────────────────────────────────────────────
--
-- Anticipo $5,000, 5 tickets = $4,850. El operador escribe "listo"; 6 segundos
-- después manda UNA FOTO MÁS (un diésel de $800 que se le había pasado). Esa
-- foto entra a OCR (~10 s) y hace su `addGasto` mientras el agente redacta:
--
--   T1  5 gastos, $4,850 → PDF: "Sobró $150.00 (a favor de la empresa)"
--   T2  6 gastos, $5,650 → WhatsApp: "Pusiste $650.00 de tu bolsa"
--
-- El operador recibe las dos cosas seguidas, con $800 de diferencia y DE SIGNO
-- CONTRARIO. Lo que queda archivado —y lo que ve el contralor— es la versión
-- chica. Y el sexto gasto queda huérfano: el viaje ya está liquidado, nunca se
-- vuelve a cuadrar, y el operador ni siquiera recibe acuse de esa foto.
--
-- ── POR QUÉ EN LA BASE Y NO EN TypeScript ──────────────────────────────────
--
-- Un `if (viaje.estatus === 'abierto')` antes del insert es comprobar y luego
-- escribir, y la carrera cabe justo en medio: el cierre puede ocurrir entre las
-- dos líneas. Solo la base puede hacerlo atómico.
--
-- El `for update` sobre el viaje es lo que lo cierra: `guardar_liquidacion_tx`
-- inserta la liquidación y DESPUÉS actualiza `viaje`, así que tomar ese candado
-- obliga a esperar a que el cierre confirme. Al soltarse, la liquidación ya es
-- visible y el insert se rechaza. Sin el `for update`, en READ COMMITTED el
-- trigger no vería la liquidación aún sin confirmar y dejaría pasar el gasto —
-- que es exactamente el bug, movido de sitio.
--
-- ── POR QUÉ CONTRA LA LIQUIDACIÓN Y NO CONTRA `estatus` ────────────────────
--
-- El daño no es que el viaje esté cerrado: es que el gasto NO ESTÉ en el papel
-- que ya se emitió. Un viaje marcado `liquidado` sin liquidación emitida no ha
-- hecho daño a nadie — y es, además, lo que hace el bloque 8 de
-- `verificaciones.sql` para probar la deduplicación entre viajes, que con la
-- 0029 no puede tener dos abiertos del mismo operador.
--
-- SQLSTATE `CU001`: propio, para que el processor lo distinga de un 23505 (foto
-- duplicada) y le pueda decir al operador la verdad — que su foto llegó tarde—
-- en vez de tragárselo o de tratarlo como un duplicado.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function gasto_no_tras_liquidar()
returns trigger
language plpgsql
as $$
declare ya boolean;
begin
  -- Serializa contra el cierre. No se usa el valor: se usa el candado.
  perform 1 from viaje where id = new.viaje_id for update;

  select exists (select 1 from liquidacion where viaje_id = new.viaje_id) into ya;
  if ya then
    raise exception 'el viaje % ya tiene liquidación emitida: el gasto llegó tarde', new.viaje_id
      using errcode = 'CU001';
  end if;
  return new;
end $$;

comment on function gasto_no_tras_liquidar() is
  'Impide agregar gastos a un viaje cuya liquidación YA se emitió. Sin esto, una foto que entra entre el cálculo del PDF y el del texto hace que los dos digan cifras distintas y de signo contrario, y el gasto queda huérfano. Ver 0036.';

drop trigger if exists trg_gasto_no_tras_liquidar on gasto;
create trigger trg_gasto_no_tras_liquidar
  before insert on gasto
  for each row execute function gasto_no_tras_liquidar();
