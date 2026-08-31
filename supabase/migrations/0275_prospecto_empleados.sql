-- ═══════════════════════════════════════════════════════════════════════════
-- `empleados` EN /getdemo: TAMAÑO DEL BACK OFFICE, NO DE LA FLOTA (31-ago-2026).
--
-- `unidades` (mig. 0137) califica el tamaño de la FLOTA. Esta columna es
-- distinta a propósito: cuántas personas trabajan en el back office (tráfico,
-- contabilidad, administración) — el equipo que Likida le quita trabajo
-- manual, no los camiones. Mismo patrón que `unidades`: CÓDIGO estable del
-- <select> ('1-3', '4-10', '11-30', '30+'), nunca la etiqueta traducida.
--
-- NULL sigue siendo un valor real: el censo del DENUE no lo trae y ningún
-- lead anterior a esta fecha lo preguntó.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.prospecto
  add column if not exists empleados text;

comment on column public.prospecto.empleados is
  'Cuántas personas trabajan en el back office del prospecto (tráfico, contabilidad, administración), como CÓDIGO estable del select de /getdemo: 1-3, 4-10, 11-30, 30+. Nunca la etiqueta traducida. NULL = no se sabe/no se preguntó.';

alter table public.prospecto
  drop constraint if exists prospecto_empleados_dominio;
alter table public.prospecto
  add constraint prospecto_empleados_dominio
    check (empleados is null or empleados in ('1-3', '4-10', '11-30', '30+'));
