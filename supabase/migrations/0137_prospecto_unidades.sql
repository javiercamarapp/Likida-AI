-- ═══════════════════════════════════════════════════════════════════════════
-- EL TAMAÑO DE FLOTA DEL PROSPECTO (18-ago-2026).
--
-- `/getdemo` pregunta cuántas unidades trae la flota y esa respuesta se estaba
-- TIRANDO: el formulario solo le pasaba nombre, apellido y correo al embed de
-- Cal.com, así que `empresa`, `unidades` y `whatsapp` no llegaban a ningún
-- lado. Quien abandonaba antes de agendar no dejaba rastro.
--
-- POR QUÉ COLUMNA Y NO `notas`. Las unidades son la señal que decide el plan
-- —50 viajes/mes es `demo`, 500 es `flota`, más es `empresa`— y con eso se
-- segmenta una campaña. En `notas` es prosa que nadie puede agrupar.
--
-- NULL ES UN VALOR REAL: la mayoría de los 33,070 del censo entraron sin este
-- dato porque el DENUE no lo trae. `null` = no se sabe, y eso NO es lo mismo
-- que una flota chica. El check exige > 0 por lo mismo que en `plan`: un cero
-- diría "flota sin camiones", que es una flota que no existe.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.prospecto
  add column if not exists unidades int;

comment on column public.prospecto.unidades is
  'Cuantas unidades declara la flota. NULL = no se sabe (el censo del DENUE no lo trae); nunca es "flota chica". Lo captura /getdemo.';

alter table public.prospecto
  drop constraint if exists prospecto_unidades_positivas;

alter table public.prospecto
  add constraint prospecto_unidades_positivas
    check (unidades is null or unidades > 0);
