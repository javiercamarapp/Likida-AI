-- 0058 — El viaje que el chofer todavía no acepta.
--
-- Hasta aquí, asignar un viaje era un hecho unilateral: el jefe lo creaba y se
-- daba por sentado que el chofer arrancaba. Se descubría lo contrario cuando no
-- llegaban fotos, con el viaje ya empezado tarde o ya perdido.
--
-- Cuatro marcas, y cada una responde a una pregunta distinta:
--   avisado_en      ¿se le dijo? Arranca el reloj de las 5 h. Sin esto puesto,
--                   el viaje es INVISIBLE para la escalación.
--   aceptado_en     ¿contestó que sí?
--   escalado_en     ¿ya se le avisó al jefe? Impide repetirle el mismo aviso en
--                   cada corrida del cron, que es como se quema un canal.
--   avisos_enviados cuántas veces se le insistió.
--
-- NOTA: esta migración se aplicó a producción el 4-ago-2026 desde la sesión y el
-- archivo se escribió DESPUÉS, al detectar que faltaba. El contenido se
-- reconstruyó leyendo el esquema real (information_schema, pg_indexes y
-- pg_constraint), no de memoria.

alter table public.viaje add column if not exists avisado_en      timestamptz;
alter table public.viaje add column if not exists aceptado_en     timestamptz;
alter table public.viaje add column if not exists escalado_en     timestamptz;
alter table public.viaje add column if not exists avisos_enviados integer not null default 0;

-- Parcial a propósito: la escalación solo mira viajes abiertos, sin aceptar y
-- sin escalar. Un índice completo sobre `avisado_en` sería casi todo el histórico
-- para servir una consulta que solo toca la cola viva.
create index if not exists viaje_sin_aceptar_idx
  on public.viaje (avisado_en)
  where aceptado_en is null and escalado_en is null and estatus = 'abierto';

-- Un viaje no se puede haber aceptado sin haberse avisado. Si esto se rompe, es
-- que alguien marcó la aceptación a mano y el reloj de las 5 h quedó sin origen.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.viaje'::regclass and conname = 'viaje_aceptado_requiere_aviso'
  ) then
    alter table public.viaje add constraint viaje_aceptado_requiere_aviso
      check (aceptado_en is null or avisado_en is not null);
  end if;
end $$;
