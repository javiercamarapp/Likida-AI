-- ═══════════════════════════════════════════════════════════════════════════
-- 0166 — RES-22 (auditoría prod, 22-ago-2026): UNA FACTURA SE IDENTIFICA POR
--        SERIE + FOLIO + EJERCICIO, NO POR FOLIO A SECAS. IDEMPOTENTE.
--
-- ── QUÉ PASABA ────────────────────────────────────────────────────────────
--
-- `factura_emitida` no tenía columna `serie` (verificado contra las 165
-- migraciones), y la unicidad del folio la ponían DOS índices, no uno:
--
--   · `factura_folio_unico`               (0049:69) → (tenant_id, folio)
--   · `factura_emitida_folio_upper_uidx`  (0158, DAT-36) → (tenant_id, upper(folio))
--
-- Ninguno mira la serie ni el ejercicio. Pero un CFDI se identifica por SERIE
-- + FOLIO, y el consecutivo se reinicia por serie y —lo normal en México—
-- cada año. O sea que hoy, dentro de UNA misma flota:
--
--   · la factura A-1 de 2025 y la B-1 de 2026 chocan (mismo folio «1» si la
--     flota teclea el folio desnudo, o folios distintos si mete la serie
--     dentro del folio, que es el apaño que la falta de columna obliga);
--   · el folio 1 del 2 de enero de 2026 choca con el folio 1 del 2 de enero
--     de 2025, que es OTRA factura, legítima, ya timbrada y ya declarada.
--
-- La flota que reinicia folios cada 1 de enero recibe «Ya tienes registrada
-- una factura con ese folio» y NO PUEDE CAPTURAR su cobranza. No es un caso
-- raro: es el calendario. A una flota le pasa cada enero, y a 50k viajes/mes
-- con varias flotas capturando en paralelo deja de ser anecdótico.
--
-- ── POR QUÉ EL COMENTARIO DE `facturacion_escritura.ts` NO ALCANZABA ──────
--
-- La propuesta escrita ahí (F2) dropeaba SOLO `factura_folio_unico`. Con eso
-- el bug seguía vivo entero: `factura_emitida_folio_upper_uidx` (0158) es
-- también único sobre (tenant_id, upper(folio)) y habría rechazado igual la
-- A-1 de 2026. Esta migración sustituye LOS DOS por uno solo — y ese «los
-- dos» es el hallazgo que la propuesta original no tenía a la vista.
--
-- ── EL CRITERIO ELEGIDO, Y POR QUÉ ────────────────────────────────────────
--
--   create unique index factura_folio_unico
--     on public.factura_emitida
--        (tenant_id, upper(coalesce(serie, '')), upper(folio),
--         extract(year from fecha))
--     where folio is not null;
--
--  · `tenant_id` — sin discusión: el consecutivo es de cada flota.
--  · `upper(...)` en serie Y en folio — NO es adorno: es DAT-36 (0158)
--    conservado. Ese hallazgo estableció que «vj-1», «VJ-1 » y «VJ-1» son
--    UN folio para la flota y tres para la base. Si el índice nuevo comparara
--    el texto crudo, arreglar RES-22 REABRIRÍA DAT-36. La serie entra con el
--    mismo criterio por la misma razón («a» y «A» son la misma serie).
--  · `coalesce(serie, '')` — un NULL no colisiona con nada en un índice
--    único, así que sin el coalesce las facturas SIN serie (todas las de hoy,
--    y todas las de una flota de serie única) quedarían fuera del candado y
--    el folio repetido volvería a entrar. El '' las mete a todas al mismo
--    grupo, que es exactamente lo que significa «no uso series».
--  · `extract(year from fecha)` — el ejercicio se LEE de la fecha de la
--    factura en vez de guardarse en una columna propia. Una columna
--    `ejercicio` sería un segundo origen de la misma verdad, y el día que no
--    coincidieran con `fecha` nadie sabría cuál manda. `fecha` es `date not
--    null` (0049), así que `extract` es inmutable y se puede indexar.
--    Se usa el AÑO CIVIL, no un ejercicio configurable: el consecutivo fiscal
--    mexicano se reinicia con el calendario.
--  · `where folio is not null` — igual que los dos índices que sustituye: una
--    factura en borrador sin folio todavía no ocupa lugar en ningún
--    consecutivo.
--
-- LO QUE **NO** SE HACE, a propósito: excluir las canceladas. Una factura
-- cancelada SIGUE ocupando su folio — es el consecutivo fiscal, no una lista
-- de pendientes. Recapturar el mismo folio de una cancelada sigue chocando, y
-- eso es correcto (lo dice ya el comentario de la compensación en
-- `facturacion_escritura.ts`).
--
-- ── POR QUÉ SE PUEDE APLICAR SIN LIMPIAR NADA ─────────────────────────────
--
-- EL ÍNDICE NUEVO AFLOJA A LOS DOS VIEJOS: les AGREGA dimensiones (serie y
-- año) sin quitarles ninguna. Dos filas que violen el índice nuevo comparten
-- tenant, serie, folio (en mayúsculas) Y año; en particular comparten tenant y
-- upper(folio), o sea que ya violaban `factura_emitida_folio_upper_uidx`, que
-- existe desde la 0158 y está validado. Por construcción, el conjunto de
-- filas que el índice nuevo rechaza es un SUBCONJUNTO del que ya rechazaba el
-- viejo: toda fila que hoy convive lo sigue haciendo, y no hay dato que
-- decidir a mano antes de aplicar.
--
-- Aun así se CUENTA y se REPORTA antes de crear (patrón de la 0145/0164): el
-- razonamiento de arriba es una demostración, no una medición, y una
-- migración que va a producción reporta lo que ve. El conteo esperado es 0; si
-- saliera >0 la migración FALLA RUIDOSA con los grupos, porque significaría
-- que uno de los dos índices viejos no estaba realmente en la base y el
-- razonamiento no aplicaba.
--
-- ── IDEMPOTENTE ───────────────────────────────────────────────────────────
-- `add column if not exists`, el CHECK sólo si no está en `pg_constraint`,
-- `drop index if exists` y `create unique index if not exists`. Re-correrla
-- sobre una base ya migrada no hace nada.
--
-- Reversible: `drop index factura_folio_unico`, recrear los dos de 0049/0158,
-- `alter table ... drop constraint factura_serie_btrim` y `drop column serie`.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. La columna ──────────────────────────────────────────────────────────
-- `text` y NULLABLE: la flota que no usa series (la mayoría de las pequeñas)
-- no tiene nada que teclear, y NULL significa «esta factura no lleva serie»,
-- no «no lo sé». El CHECK impide que ese NULL conviva con un '' que
-- significaría lo mismo escrito de otra forma.
alter table public.factura_emitida add column if not exists serie text;

comment on column public.factura_emitida.serie is
  'La SERIE del CFDI (0166, RES-22). NULL = la flota no usa series. Un CFDI se identifica por serie + folio, y el folio se reinicia por serie y por ejercicio: sin esta columna, la A-1 de 2025 y la B-1 de 2026 chocaban en `factura_folio_unico` siendo documentos distintos.';

-- ── 2. Normalizada, con el MISMO criterio que el folio (0158, DAT-36) ──────
-- Se guarda tal como se compara: sin espacios de sobra y nunca vacía. Una
-- serie de puros espacios NO es una serie: la captura la convierte en NULL
-- antes de llegar aquí, y este CHECK es la red por si alguien escribe por otro
-- camino. `char_length <= 25` es el tope del SAT para el atributo Serie.
do $$
declare n bigint;
begin
  if exists (select 1 from pg_constraint where conname = 'factura_serie_btrim') then
    return;   -- idempotente
  end if;

  -- Nada que limpiar en una columna recién nacida, pero si la migración se
  -- corre sobre una base donde alguien ya escribió la columna a mano, los
  -- espacios se normalizan igual que hizo la 0158 con `folio`.
  update public.factura_emitida
     set serie = nullif(btrim(serie), '')
   where serie is distinct from nullif(btrim(serie), '');

  select count(*) into n from public.factura_emitida
   where serie is not null and (serie <> btrim(serie) or serie = '' or char_length(serie) > 25);
  if n > 0 then
    raise exception 'No se puede fijar factura_emitida.serie: quedan % fila(s) con serie vacía, con espacios o de más de 25 caracteres.', n;
  end if;

  alter table public.factura_emitida
    add constraint factura_serie_btrim
    check (serie is null or (serie = btrim(serie) and serie <> '' and char_length(serie) <= 25));
end $$;

comment on constraint factura_serie_btrim on public.factura_emitida is
  'La serie se guarda tal como se compara (0166, mismo criterio que `factura_emitida_folio_btrim` de la 0158): sin espacios y nunca vacía, porque «A », «A» y «» serían tres series para la base y una sola para la flota. 25 caracteres es el tope del atributo Serie del SAT.';

-- ── 3. El conteo ANTES de tocar los índices (patrón 0145/0164) ─────────────
-- Cuántas filas violarían el índice nuevo. Esperado: 0, y por construcción no
-- puede ser otra cosa mientras exista alguno de los dos índices viejos —
-- ver la demostración de la cabecera. Si sale >0, se grita con los grupos.
do $$
declare r record; msg text := ''; grupos bigint := 0; filas bigint := 0;
begin
  for r in
    select tenant_id,
           upper(coalesce(serie, '')) s,
           upper(folio) f,
           extract(year from fecha) anio,
           count(*) n,
           array_agg(id) ids
      from public.factura_emitida
     where folio is not null
     group by 1, 2, 3, 4
    having count(*) > 1
  loop
    grupos := grupos + 1;
    filas := filas + r.n;
    msg := msg || format(E'\n  tenant %s · serie %L · folio %L · ejercicio %s · %s facturas: %s',
                         r.tenant_id, r.s, r.f, r.anio, r.n, r.ids);
  end loop;

  raise notice 'RES-22 · filas que violarían el índice nuevo: % (en % grupo(s)). Esperado 0: el índice nuevo AFLOJA a los dos viejos.', filas, grupos;

  if grupos > 0 then
    raise exception E'RES-22: % grupo(s) de facturas comparten tenant + serie + folio + ejercicio:%\n\nEsto NO debería poder pasar mientras existan `factura_folio_unico` (0049) o `factura_emitida_folio_upper_uidx` (0158), que son más estrictos. Que pase significa que alguno se dropeó fuera de migración: revisa cuál factura es la buena antes de volver a aplicar.', grupos, msg;
  end if;
end $$;

-- ── 4. Un solo índice, en lugar de los dos ────────────────────────────────
-- Se conserva el NOMBRE `factura_folio_unico` a propósito: `traducirChoque`
-- en `facturacion_escritura.ts` discrimina el 23505 por él, igual que
-- `processor.ts` hace con `uq_gasto_wa_message_id`. Cambiarle el nombre
-- dejaría el choque de folio saliendo como error genérico.
drop index if exists public.factura_folio_unico;
drop index if exists public.factura_emitida_folio_upper_uidx;

create unique index if not exists factura_folio_unico
  on public.factura_emitida
     (tenant_id, upper(coalesce(serie, '')), upper(folio), extract(year from fecha))
  where folio is not null;

comment on index public.factura_folio_unico is
  'Un consecutivo fiscal = flota + serie + ejercicio (0166, RES-22). Sustituye al (tenant_id, folio) de la 0049 Y al (tenant_id, upper(folio)) de la 0158: absorbe la insensibilidad a mayúsculas de DAT-36 y le agrega las dos dimensiones que faltaban. Sin ellas, una flota que reinicia folios cada año no podía capturar su cobranza de enero.';
