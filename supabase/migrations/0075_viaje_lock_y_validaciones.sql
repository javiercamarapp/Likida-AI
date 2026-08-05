-- 0075 — La FK que le falta a `viaje_lock`, y las dos restricciones que llevan
--        meses en `NOT VALID` sin que nadie las valide.
--
-- ═══ 1. `viaje_lock` NO TENÍA FK CONTRA `viaje` (auditoría, MENOR) ═══════
--
-- Es el mutex de un viaje: `(viaje_id, locked_until)`. Sin FK, un proceso que
-- muere entre tomar el candado y soltarlo deja una fila que ya no corresponde a
-- ningún viaje —o que sobrevive al borrado del viaje— y ahí se queda para
-- siempre. La tabla del mutex acumula basura que nada limpia.
--
-- Con `ON DELETE CASCADE` el candado se va con su viaje, que es la única
-- semántica que tiene sentido: un candado sobre algo que ya no existe no protege
-- nada. Ojo: esto NO arregla el candado colgado de un viaje que SÍ existe — de
-- eso se encarga `locked_until`, que es el TTL. Arregla la fila huérfana.
--
-- La FK no necesita índice nuevo: `viaje_lock_pkey` es exactamente `(viaje_id)`,
-- así que el sondeo de la FK ya entra por la PK (mismo criterio que la 0071).

alter table public.viaje_lock
  add constraint viaje_lock_viaje_id_fkey
  foreign key (viaje_id) references public.viaje (id) on delete cascade;

-- ═══ 2. LAS DOS `NOT VALID` PERMANENTES ══════════════════════════════════
--
-- Comprobado en el catálogo: `convalidated = false` en las dos.
--
--     viaje_ingreso_no_negativo  CHECK (ingreso_flete is null or ingreso_flete >= 0)  NOT VALID
--     viaje_km_sanos             CHECK (km_recorridos is null or (km_recorridos > 0
--                                        and km_recorridos < 20000))                  NOT VALID
--
-- `NOT VALID` significa que Postgres las aplica a las filas NUEVAS pero nunca
-- comprobó las viejas. Se pusieron así para no bloquear la tabla al crearlas —
-- razón buena entonces— y quedaron así. Mientras no se validen, el catálogo no
-- puede afirmar que la tabla entera las cumple, y el planner no las puede usar
-- para razonar.
--
-- La base está VACÍA (0 viajes), así que `VALIDATE` no lee ni una fila, no puede
-- fallar, y toma un lock corto. Es exactamente el momento en que sale gratis;
-- con 240 mil viajes al año, dentro de unos meses ya no.

alter table public.viaje validate constraint viaje_ingreso_no_negativo;
alter table public.viaje validate constraint viaje_km_sanos;
