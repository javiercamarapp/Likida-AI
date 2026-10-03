\set ON_ERROR_STOP on
-- AUDITORÍA 32, continuación 17-sep. DAT32C-C1 (CRÍTICO): regresión introducida
-- por la propia 0357, encontrada por el auditor de modelo de datos al revisar el
-- arreglo del orquestador y reproducida contra Postgres 16 con las 334
-- migraciones aplicadas.
--
-- LA 0357 METIÓ A LA LLAVE DE DEDUP EL ÚNICO CAMPO QUE EL OCR PUEDE PERDER
-- ENTERO. `intake/ocr.ts:560` hace `rfc = rfcDvOk ? rfcLeido : undefined`: si el
-- dígito verificador no cuadra —y el comentario de `:550-556` dice que pasa
-- seguido, «se le vio devolver PER/PEX/PTE donde decía PEC»— la fila entra con
-- `rfc_emisor = NULL`. Todos los demás elementos de esa partición vienen del OCR
-- y están normalizados contra la variación entre dos lecturas del mismo papel
-- (`concepto` con `unaccent(lower(...))`, el folio con `folio_norm`, el uuid con
-- `lower()`). El emisor no tiene normalización, y además puede desaparecer.
--
-- Consecuencia medida: DOS FOTOS DEL MISMO TICKET de $2,500 dejaron de ser
-- copias en cuanto el OCR leyó el RFC en una sola de las dos.
--   con la 0349 (antes de la 0357):  total 2500  ← correcto
--   con la 0357:                     total 5000  ← regresión
-- Y el error se amplifica: `engine.ts:812` calcula `tope = 0.15 * total` sobre
-- el total inflado, y el PDF imprime «el ejercicio lleva $5,000.00 de
-- combustible pagado con medios que la LISR 27-III no admite» cuando la flota
-- compró $2,500, negando los $375 de deducción que la facilidad sí concede.
--
-- LA REGLA QUE ESTE ARCHIVO FIJA, y son CUATRO direcciones, no tres:
--   1. emisores DISTINTOS y los dos conocidos → NO son copias (ARQ-A3, 0357).
--   2. mismo emisor                           → SÍ son copias.
--   3. emisor NULO en AMBOS                   → SÍ son copias (0349).
--   4. emisor en UNO y NULO en el otro        → SÍ son copias  ← LA QUE FALTABA
-- La cuarta es la dirección segura y es la que la cabecera de la 0357 declara
-- («fallar hacia "es copia" nunca infla el cupo») sin implementarla: un emisor
-- ausente no es evidencia de una estación distinta, es evidencia de nada.
begin;
insert into public.tenant(id,nombre) values
 ('35800000-0000-4000-8000-000000000001','Emisor358 A');
insert into public.operador(id,tenant_id,nombre,telefono) values
 ('35800000-0000-4000-8000-000000000001','35800000-0000-4000-8000-000000000001','Operador sintético 358','529999903581');
insert into public.viaje(id,tenant_id,operador_id,folio,estatus) values
 ('35800000-0000-4000-8000-000000000001','35800000-0000-4000-8000-000000000001','35800000-0000-4000-8000-000000000001','A358-1','liquidado'),
 ('35800000-0000-4000-8000-000000000002','35800000-0000-4000-8000-000000000001','35800000-0000-4000-8000-000000000001','A358-2','liquidado');

-- (4) DOS FOTOS DEL MISMO TICKET, $2,500, folio 1234. El OCR pasó el dígito
--     verificador en la primera y lo falló en la segunda. La verdad es $2,500.
insert into public.gasto(id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago) values
 ('35800000-0000-4000-8000-000000000301','35800000-0000-4000-8000-000000000001','35800000-0000-4000-8000-000000000001','diesel',2500,'2026-03-10','1234','1234','CCO8605231N4','01'),
 ('35800000-0000-4000-8000-000000000302','35800000-0000-4000-8000-000000000001','35800000-0000-4000-8000-000000000001','diesel',2500,'2026-03-10','1234','1234',null,'01');

set local role service_role;
do $$declare r record; begin
 select * into r from public.sumar_combustible_ejercicio('35800000-0000-4000-8000-000000000001',2026,null);
 -- Rojo con la 0357: total=5000 (el NULL abrió partición propia).
 if r.total <> 2500 then
  raise exception 'DAT32C-C1: el emisor perdido por el OCR partió en dos las dos fotos del MISMO ticket: total=% (esperado 2500)',r.total;
 end if;
 if r.efectivo <> 2500 then
  raise exception 'DAT32C-C1: mismo caso en efectivo: efectivo=% (esperado 2500)',r.efectivo;
 end if;
end $$;
reset role;

-- (4b) EL CASO MIXTO, que es el que separa un arreglo bueno de uno que barre el
--      emisor bajo la alfombra: dos estaciones CONOCIDAS y distintas (A y B) más
--      una tercera foto sin emisor, todas con folio 5678 y $1,000.
--      La verdad son $2,000: la estación A y la estación B son gastos reales, y
--      la foto sin emisor es una repetición de alguna de las dos. Un arreglo que
--      simplemente ignorara el emisor daría $1,000 (vuelve a ARQ-A3); uno que
--      conservara la 0357 daría $3,000.
insert into public.gasto(id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago) values
 ('35800000-0000-4000-8000-000000000303','35800000-0000-4000-8000-000000000001','35800000-0000-4000-8000-000000000001','diesel',1000,'2026-05-02','5678','5678','ESA030303CCC','01'),
 ('35800000-0000-4000-8000-000000000304','35800000-0000-4000-8000-000000000001','35800000-0000-4000-8000-000000000002','diesel',1000,'2026-06-02','5678','5678','ESB040404DDD','01'),
 ('35800000-0000-4000-8000-000000000305','35800000-0000-4000-8000-000000000001','35800000-0000-4000-8000-000000000001','diesel',1000,'2026-05-02','5678','5678',null,'01');

set local role service_role;
do $$declare r record; begin
 select * into r from public.sumar_combustible_ejercicio('35800000-0000-4000-8000-000000000001',2026,null);
 -- 2500 del caso (4) + 2000 de este.
 if r.total <> 4500 then
  raise exception 'DAT32C-C1 mixto: dos estaciones conocidas mas una foto sin emisor: total=% (esperado 4500 = 2500 + 2000)',r.total;
 end if;
end $$;
reset role;

rollback;
