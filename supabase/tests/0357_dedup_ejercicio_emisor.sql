\set ON_ERROR_STOP on
-- AUDITORÍA 32, ARQ-A3 (CRÍTICO, reincidente desde la 30 y reproducido con
-- cifras por primera vez en esta ronda contra un Postgres real).
--
-- EL FOLIO SE REINICIA POR EMISOR. La numeración de un ticket de gasolinera la
-- lleva cada estación, no el SAT: dos estaciones distintas emiten su folio
-- `1234` el mismo año sin ninguna anomalía. `sumar_combustible_ejercicio`
-- (0349) dedupa por `(concepto, folio_norm, monto)` sin mirar quién emitió, y
-- ese criterio —correcto dentro de UN viaje, que es el fajo de un operador—
-- colapsa comprobantes legítimos cuando se aplica al EJERCICIO COMPLETO: un
-- año, todos los viajes, todas las estaciones.
--
-- Lo que se regala, medido en la reproducción de la 32: dos tickets de $2,500
-- de estaciones distintas con folio 1234 entran, la función devuelve uno, y el
-- motor (engine.ts:811-819) calcula `tope = 0.15 * total` sobre un total
-- deflactado. Los dos errores van en la misma dirección —el universo grande
-- nunca dedupa menos que el chico—, así que SIEMPRE se regala cupo del 15 %:
-- con $1,400,000 de ejercicio, `cupoRestante` sale $3,625 donde debe ser
-- $1,500, y el PDF declara deducibles $2,500 cuando $1,000 no lo son.
--
-- Este archivo fija las TRES direcciones, porque arreglar una rompiendo otra
-- es el modo de falla del dedup:
--   1. emisores DISTINTOS  → NO son copias (lo que 0349 rompía).
--   2. mismo emisor        → SÍ son copias (dos fotos del mismo ticket).
--   3. emisor NULO en ambos→ SÍ son copias (conserva el comportamiento de
--      0349: sin emisor no hay con qué distinguirlos, y fallar hacia
--      "es copia" nunca infla el cupo).
begin;
insert into public.tenant(id,nombre) values
 ('35700000-0000-4000-8000-000000000001','Emisor357 A');
insert into public.operador(id,tenant_id,nombre,telefono) values
 ('35700000-0000-4000-8000-000000000001','35700000-0000-4000-8000-000000000001','Operador sintético 357','529999903571');
insert into public.viaje(id,tenant_id,operador_id,folio,estatus) values
 ('35700000-0000-4000-8000-000000000001','35700000-0000-4000-8000-000000000001','35700000-0000-4000-8000-000000000001','A357-1','liquidado'),
 ('35700000-0000-4000-8000-000000000002','35700000-0000-4000-8000-000000000001','35700000-0000-4000-8000-000000000001','A357-2','liquidado');

-- (1) Dos ESTACIONES DISTINTAS, mismo folio 1234, mismo monto, viajes y meses
--     distintos del mismo ejercicio. No son copias: son $5,000 de diésel.
insert into public.gasto(id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago) values
 ('35700000-0000-4000-8000-000000000301','35700000-0000-4000-8000-000000000001','35700000-0000-4000-8000-000000000001','diesel',2500,'2026-01-15','1234','1234','ESA030303CCC','01'),
 ('35700000-0000-4000-8000-000000000302','35700000-0000-4000-8000-000000000001','35700000-0000-4000-8000-000000000002','diesel',2500,'2026-08-20','1234','1234','ESB040404DDD','01');

set local role service_role;
do $$declare r record; begin
 select * into r from public.sumar_combustible_ejercicio('35700000-0000-4000-8000-000000000001',2026,null);
 -- Rojo antes del arreglo: total=2500, efectivo=2500 (uno de los dos se cae).
 if r.total <> 5000 then
  raise exception 'ARQ-A3: dos emisores distintos con el mismo folio se colapsaron: total=% (esperado 5000)',r.total;
 end if;
 if r.efectivo <> 5000 then
  raise exception 'ARQ-A3: dos emisores distintos con el mismo folio se colapsaron en efectivo: efectivo=% (esperado 5000)',r.efectivo;
 end if;
end $$;
reset role;

-- (2) El MISMO emisor, mismo folio, mismo monto: dos fotos del mismo ticket.
--     Tiene que seguir contando una sola vez.
insert into public.gasto(id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago) values
 ('35700000-0000-4000-8000-000000000303','35700000-0000-4000-8000-000000000001','35700000-0000-4000-8000-000000000001','diesel',700,'2026-04-01','0088','88','ESC050505EEE','01'),
 ('35700000-0000-4000-8000-000000000304','35700000-0000-4000-8000-000000000001','35700000-0000-4000-8000-000000000001','diesel',700,'2026-04-01','88','88','ESC050505EEE','01');

set local role service_role;
do $$declare r record; begin
 select * into r from public.sumar_combustible_ejercicio('35700000-0000-4000-8000-000000000001',2026,null);
 -- 5000 + 700 (una sola vez), no 5000 + 1400.
 if r.total <> 5700 then
  raise exception 'ARQ-A3: dos fotos del MISMO ticket dejaron de deduparse: total=% (esperado 5700)',r.total;
 end if;
 if r.efectivo <> 5700 then
  raise exception 'ARQ-A3: dos fotos del MISMO ticket dejaron de deduparse en efectivo: efectivo=% (esperado 5700)',r.efectivo;
 end if;
end $$;
reset role;

-- (3) Emisor NULO en ambos: se conserva el comportamiento de 0349 —siguen
--     siendo copias—. Sin emisor no hay con qué distinguirlas, y fallar hacia
--     "es copia" nunca imprime una deducción de más.
insert into public.gasto(id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago) values
 ('35700000-0000-4000-8000-000000000305','35700000-0000-4000-8000-000000000001','35700000-0000-4000-8000-000000000001','diesel',400,'2026-05-01','0059','59',null,'01'),
 ('35700000-0000-4000-8000-000000000306','35700000-0000-4000-8000-000000000001','35700000-0000-4000-8000-000000000001','diesel',400,'2026-05-01','59','59',null,'01');

set local role service_role;
do $$declare r record; begin
 select * into r from public.sumar_combustible_ejercicio('35700000-0000-4000-8000-000000000001',2026,null);
 -- 5700 + 400 (una sola vez), no 5700 + 800.
 if r.total <> 6100 then
  raise exception 'ARQ-A3: sin emisor, dos copias dejaron de deduparse: total=% (esperado 6100)',r.total;
 end if;
 -- Idempotencia: dos corridas seguidas dan lo mismo.
 select * into r from public.sumar_combustible_ejercicio('35700000-0000-4000-8000-000000000001',2026,null);
 if r.total <> 6100 or r.efectivo <> 6100 then
  raise exception 'ARQ-A3: no es idempotente: total=%, efectivo=%',r.total,r.efectivo;
 end if;
end $$;
reset role;
rollback;
