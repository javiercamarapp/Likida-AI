-- ═══════════════════════════════════════════════════════════════════════════
-- 0363 · El desempate del dedup del ejercicio de combustible es EL MISMO que el
--        de las otras implementaciones: `created_at, id`, no `id` a secas.
--
-- AUDITORÍA 32 (continuación 7), ARQ-32C7-C1 (CRÍTICO).
--
-- `sumar_combustible_ejercicio` era la QUINTA implementación del dedup y la
-- única que seguía desempatando por uuid, hacia el lado contrario del cierre
-- (0360), del panel (0362) y del motor TS:
--
--   cierre       0360:161       order by created_at, id        → la primera en llegar
--   panel        0362:168/:180  order by bc.created_at, bc.id  → la primera en llegar
--   motor TS     engine.ts `copiasDeComprobante`               → la primera de la lista
--   ejercicio    0358:90/:102   order by id                    → min(uuid) ← LA RAREZA
--
-- POR QUÉ NINGÚN ARNÉS LO VEÍA, y es la razón de existir de este archivo: el
-- TOTAL no se mueve (`monto` está en la partición), y los tres arneses que
-- tocan esta función —`0357_dedup_ejercicio_emisor.sql:39-46`,
-- `0358_dedup_emisor_ocr_nulo.sql:44-46` y hasta el nuevo
-- `0362_panel_fiscal_desempate_estable.sql:41-49`— siembran `forma_pago='01'`
-- en las DOS copias. Con la forma de pago idéntica, el desempate no puede
-- cambiar `efectivo` en ninguna aserción: el guardia existía y no vigilaba.
--
-- ESTE ARNÉS ROMPE ESE VICIO: siembra formas de pago DISTINTAS en las dos
-- copias, que es el único modo de que la elección se note. `forma_pago`,
-- `pagado_en` y `pagado_forma` viajan FUERA de la partición, y de ellos `base`
-- deriva `forma_pago_efectiva` → `efectivo`, que es el NUMERADOR del tope del
-- 15 % de la RFA 2026 regla 2.9. El volado no movía una cifra de presentación:
-- movía la cuenta con la que el PDF decide si un comprobante se deduce.
--
-- EL CASO REAL: el chofer manda la foto buena de un ticket de diésel pagado en
-- efectivo y luego una borrosa del MISMO ticket. La buena trae la forma de pago
-- ('01'); en la borrosa el OCR no la leyó (`intake/ocr.ts:620` devuelve
-- `undefined`, `repo.ts:378` lo escribe `null`). Si sobrevive la borrosa, esos
-- $2,500 de efectivo desaparecen del numerador y el motor cree que queda cupo
-- del 15 % donde ya no queda: el PDF imprime «deducible por la facilidad» donde
-- debía imprimir «el excedente NO se deduce».
--
-- DETERMINISTA A PROPÓSITO, igual que el arnés de la 0362: en las dos parejas la
-- fila buena llega ANTES (created_at 10:00) y tiene el uuid MAYOR; la borrosa
-- llega después y tiene el uuid MENOR. Con `order by id` gana la borrosa; con
-- `order by created_at, id` gana la buena. Si este arnés pasara con las dos
-- reglas, dejaría de probar algo — por eso los uuid no se dejan al azar.
--
-- UNA PAREJA, y la razón importa. La 0358 tenía DOS `order by id` —la rama del
-- `cfdi_uuid` (:90) y la del folio (:102)— y este arnés sólo puede ejercitar la
-- segunda, porque la primera es INALCANZABLE para copias: la base tiene
-- `uq_gasto_cfdi_uuid` sobre `(tenant_id, cfdi_uuid, cfdi_orden)`, así que dos
-- filas del mismo tenant NO pueden compartir uuid y orden. Medido: el intento
-- de sembrarlas muere con «duplicate key value violates unique constraint
-- uq_gasto_cfdi_uuid». Dos copias del mismo ticket sólo pueden coexistir por la
-- rama del folio, que es exactamente donde vive el daño. El `order by` de la
-- rama del uuid se corrige igual, por coherencia, pero no se le puede escribir
-- arnés y se dice en vez de fingir que se cubrió.
-- ═══════════════════════════════════════════════════════════════════════════
begin;
insert into public.tenant(id,nombre) values
 ('36300000-0000-4000-8000-000000000001','Desempate363');
insert into public.operador(id,tenant_id,nombre,telefono) values
 ('36300000-0000-4000-8000-000000000001','36300000-0000-4000-8000-000000000001','Operador sintético 363','529999903631');
insert into public.viaje(id,tenant_id,operador_id,folio,estatus) values
 ('36300000-0000-4000-8000-000000000001','36300000-0000-4000-8000-000000000001','36300000-0000-4000-8000-000000000001','A363-1','liquidado');

-- ── LA PAREJA — rama del FOLIO (0358:102). $2,500 en efectivo. ───────────
-- LA BUENA: llega a las 10:00, trae forma_pago '01', uuid MAYOR.
insert into public.gasto
 (id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,created_at) values
 ('ffff0363-0000-4000-8000-0000000000a1','36300000-0000-4000-8000-000000000001','36300000-0000-4000-8000-000000000001',
  'diesel',2500,'2026-04-01','888','888','ESA030303CC1','01','2026-04-01 10:00:00+00');
-- LA BORROSA: la misma foto una hora después, SIN forma de pago, uuid MENOR.
insert into public.gasto
 (id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,created_at) values
 ('00000363-0000-4000-8000-0000000000a2','36300000-0000-4000-8000-000000000001','36300000-0000-4000-8000-000000000001',
  'diesel',2500,'2026-04-01','888','888','ESA030303CC1',null,'2026-04-01 11:00:00+00');

set local role service_role;
do $$
declare
  r_total     numeric;
  r_efectivo  numeric;
begin
  select total, efectivo into r_total, r_efectivo
    from public.sumar_combustible_ejercicio(
           '36300000-0000-4000-8000-000000000001', 2026, array['15101505']);

  -- (a) El dedup sigue funcionando: dos fotos, UN comprobante. Esto es lo que la 0349/0357/0358 ya garantizaban y este
  --     arreglo NO debe cambiar — la partición no se tocó.
  if r_total <> 2500 then
    raise exception 'ARQ-32C7-C1: el dedup del ejercicio dejó de contar copias: total=% (esperado 2500: dos fotos del mismo ticket cuentan UNA vez)',
      r_total;
  end if;

  -- (b) LO NUEVO: la fila que sobrevive en cada pareja es la que SÍ trae la
  --     forma de pago — la primera en llegar, la misma que conservan el cierre
  --     (0360), el panel (0362) y el motor TS. Con `order by id` sobrevivían las
  --     borrosas y esto daba 0: los $4,000 de efectivo desaparecían del
  --     numerador del tope del 15 %.
  if r_efectivo <> 2500 then
    raise exception 'ARQ-32C7-C1: el ejercicio conserva la copia sin forma de pago y pierde el numerador del 15%%: efectivo=% (esperado 2500). Con order by id sobrevive la foto borrosa (uuid menor) y efectivo cae a 0, así que el motor cree que queda cupo del 15%% donde ya no queda.',
      r_efectivo;
  end if;
end $$;
reset role;

rollback;
