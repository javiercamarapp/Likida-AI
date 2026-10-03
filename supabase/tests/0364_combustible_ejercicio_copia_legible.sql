-- ═══════════════════════════════════════════════════════════════════════════
-- 0364 · Entre dos copias del MISMO ticket, el numerador del 15 % se toma de la
--        que SÍ trae forma de pago — no de la que llegó primero.
--
-- AUDITORÍA 32 (continuación 8), FIS-32C8-C1 (CRÍTICO).
--
-- LA 0363 ARREGLÓ EL DETERMINISMO Y ERRÓ EL CRITERIO. Su `order by created_at,
-- id` hace ganar a la PRIMERA copia en llegar, y su cabecera lo dice con estas
-- palabras: «LA BUENA: llega a las 10:00, trae forma_pago '01'». Ese supuesto es
-- al revés de lo que el producto produce:
--
--   1. llega la foto, el OCR la lee mal y `forma_pago` se escribe `null`
--      (`intake/ocr.ts:620` devuelve `undefined`, `repo.ts:378` lo escribe);
--   2. `decidirAcuse` ve `confianza < CONFIANZA_LEGIBLE` (0.65) y devuelve
--      `refoto` (`acuse_ticket.ts:202`);
--   3. **el gasto YA está guardado** cuando se pide la segunda foto — lo dice el
--      comentario de `processor.ts:3163` textualmente;
--   4. la foto buena llega después y crea fila nueva (`repo.ts:404/:456`).
--
-- Así que la BORROSA es SIEMPRE la de `created_at` menor, y con la 0363 gana
-- SIEMPRE. `forma_pago` viaja FUERA de la partición, así que la copia que gana
-- decide `forma_pago_efectiva` → `efectivo`, el NUMERADOR del tope del 15 % de
-- la RFA 2026 regla 2.9 (`normas/rfa-2026-2.9.yaml`).
--
-- MEDIDO sobre esta misma base antes del arreglo, con el par sembrado en el
-- orden que el producto produce: `total 2500.00 · efectivo 0`. Con `order by id`
-- (la 0358) el mismo par daba 2500 o 0 según qué uuid saliera mayor: un volado.
-- **La 0363 no cambió la cifra: cambió el 50 % de error por el 100 %**, y hacia
-- el lado que le cuesta dinero al cliente — un numerador corto hace creer que
-- queda cupo del 15 % donde ya no queda, y el PDF imprime «deducible» donde
-- debía imprimir «el excedente NO se deduce».
--
-- EL CRITERIO QUE ESTE ARNÉS FIJA: las dos copias describen EL MISMO pago. Que
-- una no haya podido leer la forma de pago no cambia cómo se pagó; sólo dice
-- que esa foto trae menos información. Entre las dos se conserva la que permite
-- derivar el numerador, y el orden de llegada queda de desempate — determinista
-- y total, como lo dejó la 0363.
--
-- DOS PAREJAS, y las dos importan:
--   (a) la borrosa llega primero y tiene el uuid MENOR  → `order by id` también fallaba;
--   (b) la borrosa llega primero y tiene el uuid MAYOR  → `order by id` acertaba
--       por casualidad y `created_at, id` falla. Es la que prueba que el arreglo
--       de ayer EMPEORÓ este caso, y por eso se siembra explícita.
--
-- El `total` no se mueve en ninguna de las dos: `monto` está en la partición, y
-- ése es justamente el motivo por el que ningún arnés anterior veía el daño.
-- ═══════════════════════════════════════════════════════════════════════════
begin;
insert into public.tenant(id,nombre) values
 ('36400000-0000-4000-8000-000000000001','Legible364');
insert into public.operador(id,tenant_id,nombre,telefono) values
 ('36400000-0000-4000-8000-000000000001','36400000-0000-4000-8000-000000000001','Operador sintético 364','529999903641');
insert into public.viaje(id,tenant_id,operador_id,folio,estatus) values
 ('36400000-0000-4000-8000-000000000001','36400000-0000-4000-8000-000000000001','36400000-0000-4000-8000-000000000001','A364-1','liquidado');

-- ── PAREJA (a) · folio 888, $2,500 en efectivo. Borrosa primero, uuid MENOR. ──
insert into public.gasto
 (id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,created_at) values
 ('00000364-0000-4000-8000-0000000000a1','36400000-0000-4000-8000-000000000001','36400000-0000-4000-8000-000000000001',
  'diesel',2500,'2026-04-01','888','888','ESA030303CC1',null,'2026-04-01 10:00:00+00'),
 ('ffff0364-0000-4000-8000-0000000000a2','36400000-0000-4000-8000-000000000001','36400000-0000-4000-8000-000000000001',
  'diesel',2500,'2026-04-01','888','888','ESA030303CC1','01','2026-04-01 11:00:00+00');

-- ── PAREJA (b) · folio 999, $1,500 en efectivo. Borrosa primero, uuid MAYOR. ──
insert into public.gasto
 (id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,created_at) values
 ('ffff0364-0000-4000-8000-0000000000b1','36400000-0000-4000-8000-000000000001','36400000-0000-4000-8000-000000000001',
  'diesel',1500,'2026-04-02','999','999','ESA030303CC1',null,'2026-04-02 10:00:00+00'),
 ('00000364-0000-4000-8000-0000000000b2','36400000-0000-4000-8000-000000000001','36400000-0000-4000-8000-000000000001',
  'diesel',1500,'2026-04-02','999','999','ESA030303CC1','01','2026-04-02 11:00:00+00');

set local role service_role;
do $$
declare
  r_total     numeric;
  r_efectivo  numeric;
begin
  select total, efectivo into r_total, r_efectivo
    from public.sumar_combustible_ejercicio(
           '36400000-0000-4000-8000-000000000001', 2026, array['15101505']);

  -- (a) El dedup sigue contando cada ticket UNA vez. La partición no se toca, y
  --     si esta aserción se cayera el arreglo habría roto la 0349/0357/0358.
  if r_total <> 4000 then
    raise exception 'FIS-32C8-C1: el dedup del ejercicio dejó de contar copias: total=% (esperado 4000 = 2500 + 1500, dos tickets, cuatro fotos)',
      r_total;
  end if;

  -- (b) LO NUEVO: sobrevive la copia que SÍ trae forma de pago, aunque haya
  --     llegado DESPUÉS. Con `order by created_at, id` (la 0363) sobreviven las
  --     dos borrosas y esto da 0 en las dos parejas.
  if r_efectivo <> 4000 then
    raise exception 'FIS-32C8-C1: el ejercicio conserva la copia ilegible y pierde el numerador del 15%%: efectivo=% (esperado 4000). El producto guarda la foto borrosa ANTES de pedir la buena (processor.ts:3163), así que con el desempate por orden de llegada la ilegible gana SIEMPRE y el PDF imprime "deducible" donde debia imprimir "el excedente NO se deduce".',
      r_efectivo;
  end if;
end $$;
reset role;

rollback;
