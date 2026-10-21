-- 0854 — El chofer que dijo EXPLÍCITAMENTE que no.
--
-- AUDITORÍA A8 ESCALACIÓN (confirmado, dos ángulos del mismo hueco).
-- `armarRecordatorioChofer` (escalar_viaje.ts) le promete al chofer: "con
-- cualquiera de las dos [sí o no] le aviso a tu encargado." El caso del "sí"
-- ya tenía dónde quedar escrito (`aceptado_en`, 0058); el caso del "no" NO
-- tenía NADA: `decidirInicio` (inicio_viaje.ts) interpreta la negación y
-- devuelve `estado: 'sin_viaje'`, pero ningún código escribía un campo en la
-- base ni avisaba al jefe. El jefe no se enteraba de que el chofer SÍ
-- contestó y dijo que no le tocaba — solo veía, horas después, que el reloj
-- de 5 h de A8 lo trataba como "no contestó", perdiendo la información real.
--
-- `rechazado_en` es esa marca. Igual que `aceptado_en` (0058), es un sello de
-- UNA sola vez: el UPDATE que lo escribe se acota con `is('rechazado_en',
-- null)` para que un segundo "no" del mismo chofer no lo reescriba.
--
-- POR QUÉ EXCLUYE AL VIAJE DE `viajesSinAceptar` (escalar_viaje.ts): un viaje
-- rechazado explícitamente YA se avisó al jefe de inmediato (el código que
-- usa esta columna); dejar que la escalación de las 5 h lo vuelva a tratar
-- como "no contestó" sería reportar como silencio una respuesta que sí llegó.
--
-- Reversible: `alter table public.viaje drop column rechazado_en;` y el
-- índice/constraint de abajo se van con ella.

alter table public.viaje add column if not exists rechazado_en timestamptz;

-- Mismo criterio que `viaje_aceptado_requiere_aviso` (0058): un viaje no se
-- puede haber rechazado sin haberse avisado primero.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.viaje'::regclass and conname = 'viaje_rechazado_requiere_aviso'
  ) then
    alter table public.viaje add constraint viaje_rechazado_requiere_aviso
      check (rechazado_en is null or avisado_en is not null);
  end if;
end $$;

-- El índice parcial de la 0058 (`viaje_sin_aceptar_idx`) servía exactamente la
-- consulta de `viajesSinAceptar`; esa consulta ahora también filtra
-- `rechazado_en is null` (este mismo commit, escalar_viaje.ts), así que el
-- índice se recrea con el mismo predicado para seguir cubriéndola.
drop index if exists public.viaje_sin_aceptar_idx;
create index if not exists viaje_sin_aceptar_idx
  on public.viaje (avisado_en)
  where aceptado_en is null and escalado_en is null and rechazado_en is null and estatus = 'abierto';
