-- ═══════════════════════════════════════════════════════════════════════════
-- AUDITORÍA 24 · DAT-10 y DAT-11 (MEDIO) — LA BASE NO SABÍA QUÉ FORMA TIENE
-- UN TELÉFONO, UN RFC NI UNA PLACA, Y `app_user.operador_id` PODÍA APUNTAR A
-- UN CHOFER DE OTRA FLOTA.
--
-- ── DAT-10: LA UNICIDAD GLOBAL QUE UNA FLOTA LE ROMPE A OTRA ──────────────
-- `administracion.ts:275` valida el teléfono en la app, pero el conector ERP y
-- la importación masiva de Innovativos (cientos de operadores, 800 unidades)
-- NO pasan por esa función. Probado en la auditoría (S10): `operador (tenant A,
-- telefono 'abc')` entra; y como `uq_operador_telefono_activo` es un único
-- GLOBAL sobre `telefono_normalizado(telefono)`, todo teléfono sin dígitos
-- colapsa en la MISMA cadena vacía: el segundo operador sin celular —de
-- CUALQUIER otra flota— revienta con
--   23505 uq_operador_telefono_activo Key ()=() already exists
-- La flota B no puede dar de alta a su chofer porque la flota A cargó uno con
-- el campo en blanco. Es cruce de flotas por la puerta de atrás, y el mensaje
-- no dice nada útil.
--
-- La causa no es el índice (que está bien): es que `telefono` admitía texto
-- que no es un teléfono. Con la forma impuesta, `telefono_normalizado` nunca
-- devuelve `''` y el choque entre flotas desaparece.
--
-- Y en `unidad`, el mismo hueco con otra cara (S11): `placas 'ABC-123-A'` dos
-- veces en el mismo tenant, `anio = 3000`, `km_actual = -5`, y
-- `numero_economico ' 12'` conviviendo con `'12'` —porque
-- `unidad_economico_unico` es sobre el texto CRUDO— así que el jefe de
-- tráfico ve dos unidades 12 y le asigna el viaje a la que no es.
--
-- ── DAT-11: `app_user.operador_id` sin `tenant_id` ────────────────────────
-- `app_user_operador_id_fkey` es simple (`references operador(id)`), así que
-- un usuario de la flota A podía quedar ligado al chofer de la flota B (S4,
-- ACEPTADO). `operador` ya tiene `unique (id, tenant_id)`: la FK compuesta es
-- el mismo barrido que las 0145-0149 hicieron en 72 columnas y que ésta dejó
-- fuera. Con MATCH SIMPLE, la fila del superadmin (`tenant_id` NULL,
-- `operador_id` NULL) no la toca.
--
-- Las OTRAS 47 columnas del hallazgo (`resuelto_por`, `autorizada_por`,
-- `cerrado_por`… → `app_user`) NO se atan aquí, y la razón está escrita en el
-- bloque 238 y en `EXENTAS`: el superadmin tiene `tenant_id` NULL y sí actúa
-- sobre filas de un tenant (`impersonacion_dia`), así que una FK compuesta
-- contra `app_user (id, tenant_id)` rechazaría al actor legítimo. Atarlas
-- exige antes decidir cómo se representa ese actor; queda anotado, no hecho a
-- medias.
--
-- ── POR QUÉ `not valid` ───────────────────────────────────────────────────
-- Producción va en la 0271 y no se ha medido; `not valid` impone la regla a
-- TODA fila nueva o modificada sin exigir un barrido de la tabla entera al
-- aplicar. El `validate` va aparte, abajo, envuelto para que una fila vieja
-- sucia no tumbe el deploy: si no valida, la restricción SIGUE activa para lo
-- nuevo y el aviso queda en el log.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. `operador.telefono` tiene forma de teléfono ────────────────────────
-- Entre 10 (nacional MX) y 15 dígitos (máximo de E.164). `telefono_normalizado`
-- ya quita todo lo que no sea dígito y colapsa el `1` de móvil mexicano, así
-- que la regla se impone sobre la MISMA cadena que indexan
-- `uq_operador_telefono_activo` y `uq_operador_tenant_telefono_norm`.
--
-- LA EXCEPCIÓN QUE NO ES UNA GRIETA: el operador ANONIMIZADO. La cancelación
-- ARCO (`ejecutar_arco_cancelacion`, 0273/0286) deja `telefono =
-- 'anon:<16 hex>'` a propósito —el seudónimo tiene que ocupar la columna para
-- que el número real desaparezca y la fila siga existiendo—. Sin este brazo,
-- imponer la forma le prohibiría a la flota ejercer el derecho de cancelación:
-- la regla que protege el alta acabaría bloqueando el borrado. Se ancla a
-- `anonimizado_en`, no al prefijo del texto, para que sólo valga cuando la
-- fila está DECLARADA anónima.
alter table public.operador drop constraint if exists operador_telefono_forma;
alter table public.operador add constraint operador_telefono_forma
  check (anonimizado_en is not null
         or public.telefono_normalizado(telefono) ~ '^[0-9]{10,15}$') not valid;

-- ── 2. `operador.rfc` con el molde del SAT ────────────────────────────────
-- Persona física (4 letras) y moral (3), homoclave incluida. Nulo sigue
-- valiendo: no todo chofer trae RFC capturado.
alter table public.operador drop constraint if exists operador_rfc_forma;
alter table public.operador add constraint operador_rfc_forma
  check (anonimizado_en is not null or rfc is null
         or upper(rfc) ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$') not valid;

-- ── 3. `unidad`: año, kilometraje y económico sin espacios ────────────────
-- El techo del año es una constante y no `extract(year from now())`: un CHECK
-- tiene que ser IMMUTABLE, y una regla que cambia sola el 1-ene invalidaría
-- filas ya escritas. 2100 corta el `3000` del ataque sin caducar.
alter table public.unidad drop constraint if exists unidad_anio_sano;
alter table public.unidad add constraint unidad_anio_sano
  check (anio is null or (anio between 1980 and 2100)) not valid;

alter table public.unidad drop constraint if exists unidad_km_no_negativo;
alter table public.unidad add constraint unidad_km_no_negativo
  check (km_actual is null or km_actual >= 0) not valid;

-- `unidad_economico_unico` es sobre el texto crudo: `' 12'` y `'12'` son dos
-- filas distintas para el índice y la MISMA unidad para el jefe de tráfico.
-- Se prohíbe el espacio de orilla en vez de cambiar el índice (que ya existe
-- y que otras migraciones nombran).
alter table public.unidad drop constraint if exists unidad_economico_sin_orillas;
alter table public.unidad add constraint unidad_economico_sin_orillas
  check (numero_economico is null or
         (numero_economico = btrim(numero_economico) and length(numero_economico) > 0)) not valid;

-- ── 4. Las placas son únicas por flota, sin importar mayúsculas ───────────
-- `where placas is not null`: una unidad puede estar dada de alta antes de
-- que le lleguen las placas, y dos NULL no son la misma placa.
create unique index if not exists uq_unidad_placas_por_tenant
  on public.unidad (tenant_id, upper(btrim(placas)))
  where placas is not null and btrim(placas) <> '';

-- ── 5. DAT-11: el operador ligado a un usuario es de SU flota ─────────────
alter table public.app_user drop constraint if exists app_user_operador_id_fkey;
alter table public.app_user drop constraint if exists app_user_operador_tenant_fkey;
alter table public.app_user add constraint app_user_operador_tenant_fkey
  foreign key (operador_id, tenant_id) references public.operador (id, tenant_id)
  on delete set null not valid;

-- ── 6. Validar lo viejo sin poder tumbar el deploy ────────────────────────
-- Si una fila anterior no cumple, la restricción se queda `not valid`: sigue
-- imponiéndose a todo lo nuevo (que es lo que protege al piloto) y el NOTICE
-- dice exactamente qué queda por limpiar. Fallar cerrado hacia adelante y
-- decirlo, en vez de abortar la migración entera.
do $$
declare
  c record;
begin
  for c in
    select unnest(array[
      'operador'::text, 'operador', 'unidad', 'unidad', 'unidad', 'app_user'
    ]) as tabla,
    unnest(array[
      'operador_telefono_forma'::text, 'operador_rfc_forma', 'unidad_anio_sano',
      'unidad_km_no_negativo', 'unidad_economico_sin_orillas', 'app_user_operador_tenant_fkey'
    ]) as restriccion
  loop
    begin
      execute format('alter table public.%I validate constraint %I', c.tabla, c.restriccion);
    exception when others then
      raise notice 'AUD24/0290: % sigue NOT VALID (hay filas previas que no cumplen): %',
        c.restriccion, sqlerrm;
    end;
  end loop;
end $$;

comment on constraint operador_telefono_forma on public.operador is
  'AUD24 DAT-10: sin esto, todo teléfono sin dígitos colapsa en la misma cadena vacía y el único GLOBAL uq_operador_telefono_activo hace que una flota le impida a otra dar de alta a su chofer.';
comment on index public.uq_unidad_placas_por_tenant is
  'AUD24 DAT-10: las placas son únicas por flota sin importar mayúsculas ni espacios de orilla.';
comment on constraint app_user_operador_tenant_fkey on public.app_user is
  'AUD24 DAT-11: el operador ligado a un usuario es de su misma flota. MATCH SIMPLE deja pasar al superadmin (tenant_id y operador_id NULL).';
