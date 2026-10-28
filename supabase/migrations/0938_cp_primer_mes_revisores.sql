-- REVERSA: alter table public.cp_salida_config drop constraint if exists cp_salida_config_revisores_forma, drop column if exists revisores_departamento, drop column if exists primer_mes_hasta;
-- ═══════════════════════════════════════════════════════════════════════════
-- 0938 — CARTA PORTE: «modo primer mes» con copia por correo a un revisor por departamento (OLA1-A3).
--
-- Durante el primer mes de operación de una flota, cada movimiento de un documento de Carta Porte (lectura lista, aprobado,
-- rechazado, listo para subir, subido a mano) se copia por correo a un revisor por departamento (captura de Carta Porte). Esta
-- migración solo agrega los DOS datos de configuración, por flota, en la fila que ya existe (`cp_salida_config`, 0790):
--
--   · primer_mes_hasta        date  — hasta qué día (inclusive) está encendido el modo; NULL = apagado (el valor de siempre).
--   · revisores_departamento  jsonb — arreglo de { "departamento": texto, "correo": texto }, hasta 20.
--
-- ADITIVA e IDEMPOTENTE; compatible hacia atrás: el código desplegado hoy no lee estas columnas y el nuevo las lee APARTE
-- (sin la migración el modo queda apagado y lo dice en el registro). No crea tablas: los permisos y la RLS de `cp_salida_config`
-- (deny-all, solo service_role) ya vienen de la 0790. Los correos son dato personal de la flota: se validan en la aplicación y
-- la bitácora solo anota los NOMBRES de los campos cambiados, jamás los correos.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.cp_salida_config add column if not exists primer_mes_hasta date;
alter table public.cp_salida_config add column if not exists revisores_departamento jsonb not null default '[]'::jsonb;

alter table public.cp_salida_config drop constraint if exists cp_salida_config_revisores_forma;
alter table public.cp_salida_config add constraint cp_salida_config_revisores_forma
  check (jsonb_typeof(revisores_departamento) = 'array' and jsonb_array_length(revisores_departamento) <= 20 and pg_column_size(revisores_departamento) <= 8192);

comment on column public.cp_salida_config.primer_mes_hasta is
  'Modo primer mes (0938): hasta este día (inclusive) cada movimiento de un documento se copia por correo a los revisores por departamento. NULL = apagado.';
comment on column public.cp_salida_config.revisores_departamento is
  'Revisores por departamento (0938): [{"departamento": "...", "correo": "..."}], hasta 20. Dato personal: no va a bitácoras.';
