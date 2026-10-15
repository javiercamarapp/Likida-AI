-- 0804 — CONDUCTOR: estado de tránsito del viaje y las marcas de salida/llegada que sella el TMS del cliente.
--
-- Hoy el estado «en patio / en ruta / pendiente de cruce» lo mantiene a mano una persona en el programa de despacho y no
-- siempre está al día. Esta migración solo da dónde guardarlo en el viaje, sin decidir quién lo escribe (eso es de los importadores):
--   (a) `viaje.transito_estado`        — vocabulario cerrado de 4 valores, o null (sin dato). `otro` guarda lo que no se reconoce.
--   (b) `viaje.transito_actualizado_en` — cuándo se tomó ese dato (para saber qué tan viejo es).
--   (c) `viaje.transito_texto_origen`  — el texto CRUDO tal como vino, para auditar el mapeo al vocabulario.
--   (d) `viaje.tms_salida_en` / `viaje.tms_llegada_en` — marcas con segundos que sella el TMS («Fecha Salida»); informativas.
--
-- Solo aditiva e idempotente: columnas nullable, sin default, sin triggers ni funciones. RLS sin cambios (la tabla ya la tiene).
-- El CHECK se crea con nombre fijo y solo si falta, para poder reaplicar la migración sin error.

alter table public.viaje add column if not exists transito_estado          text;
alter table public.viaje add column if not exists transito_actualizado_en  timestamptz;
alter table public.viaje add column if not exists transito_texto_origen    text;
alter table public.viaje add column if not exists tms_salida_en            timestamptz;
alter table public.viaje add column if not exists tms_llegada_en           timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.viaje'::regclass and conname = 'viaje_transito_estado_check'
  ) then
    alter table public.viaje
      add constraint viaje_transito_estado_check
      check (transito_estado is null or transito_estado in ('en_patio', 'en_ruta', 'pendiente_cruce', 'otro'));
  end if;
end $$;

comment on column public.viaje.transito_estado is
  'Estado de tránsito normalizado: en_patio | en_ruta | pendiente_cruce | otro (texto no reconocido, ver transito_texto_origen). Null = sin dato.';
comment on column public.viaje.transito_actualizado_en is
  'Cuándo se tomó el dato de tránsito (de la fuente que lo mantiene), no cuándo se importó.';
comment on column public.viaje.transito_texto_origen is
  'Texto crudo del tránsito tal como vino de la fuente; se conserva para auditar el mapeo a transito_estado.';
comment on column public.viaje.tms_salida_en is
  'Marca de salida sellada por el TMS del cliente (con segundos). Informativa; no es un hito hasta que se decida.';
comment on column public.viaje.tms_llegada_en is
  'Marca de llegada sellada por el TMS del cliente. Informativa.';
