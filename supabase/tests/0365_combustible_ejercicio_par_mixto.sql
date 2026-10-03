-- ═══════════════════════════════════════════════════════════════════════════
-- 0365 · Un ticket de diésel cuyas dos fotos son un par MIXTO (una con
--        `cfdi_uuid`, la otra sin él) debe contar UNA vez en `total`.
--
-- AUDITORÍA 32 (continuación 9), DAT-32C9-C1 / FIS-32C9-C2 / ARQ-32C9-C1
-- (CRÍTICO). Tres auditores llegaron por separado al mismo mecanismo.
--
-- LO QUE LA 0364 ROMPIÓ, Y POR QUÉ NINGÚN ARNÉS LO VEÍA. Las dos `row_number()`
-- de `marcados` se evalúan sobre EL MISMO conjunto de filas; el `case` sólo
-- elige cuál de los dos rangos ya calculados usa cada fila. Una fila con
-- `cfdi_uuid` toma su rango de la ventana del UUID —donde `uq_gasto_cfdi_uuid`
-- la deja SIEMPRE en 1— pero sigue ocupando rango en la ventana del FOLIO.
--
--   · Con la 0363 (`order by created_at, id`) esa fila absorbía el rango 1 del
--     grupo de folio cuando llegaba primero, y expulsaba a su copia.
--   · La 0364 le puso `order by sin_forma_pago_util, created_at, id` a esa misma
--     ventana. La fila con UUID de un CFDI PPD trae `forma_pago '99'` sin
--     `pagado_en` POR CONSTRUCCIÓN → `sin_forma_pago_util = 1` → pierde el rango
--     1 del folio, que se va a su copia. **Sobreviven las DOS.**
--
-- Y el par mixto no es un caso raro: es la ÚNICA forma que puede tomar un par de
-- copias de un comprobante con folio fiscal. `uq_gasto_img_hash` deja entrar la
-- segunda foto (es otra imagen) y `uq_gasto_cfdi_uuid` prohíbe que las dos
-- lleven el UUID, así que exactamente una lo trae.
--
-- POR QUÉ ES CRÍTICO, y en la dirección que la 0364 jura imposible. `total` es
-- el DENOMINADOR del tope del 15 % de la RFA 2026 regla 2.9
-- (`engine.ts:847`, `const tope = 0.15 * total`). Contar el ticket dos veces
-- infla el tope y vuelve deducible lo que la regla no concede. La cabecera de la
-- 0364 (`:53-56`) afirma que su error residual «sólo puede SUBIR `efectivo` …
-- se sub-deduce, nunca se sobre-deduce»: es FALSO. Mueve el denominador, no el
-- numerador, y hacia el lado que le cuesta al cliente frente al SAT.
--
-- MEDIDO sobre esta misma base (PostgreSQL 16.13, andamio + 341 migraciones
-- sobre base virgen), con el MISMO par de filas:
--     definición 0363 → total 10000.00 · tope 1500.00   (correcto)
--     definición 0364 → total 20000.00 · tope 3000.00   (el ticket dos veces)
--
-- LO QUE ESTE ARNÉS FIJA, en tres aserciones que se sostienen entre sí:
--   (a) el par mixto cuenta UNA vez  → si se cae, volvió el doble conteo;
--   (b) entre las dos sobrevive la LEGIBLE → si se cae, se perdió el criterio
--       de la 0364 y volvió FIS-32C8-C1;
--   (c) dos CFDI DISTINTOS que comparten folio, monto y emisor siguen contando
--       DOS veces → si se cae, el arreglo se pasó de largo y empezó a fusionar
--       comprobantes legítimos, que es el daño simétrico.
-- ═══════════════════════════════════════════════════════════════════════════
begin;
insert into public.tenant(id,nombre) values
 ('36500000-0000-4000-8000-000000000001','Mixto365');
insert into public.operador(id,tenant_id,nombre,telefono) values
 ('36500000-0000-4000-8000-000000000001','36500000-0000-4000-8000-000000000001','Operador sintético 365','529999903651');
insert into public.viaje(id,tenant_id,operador_id,folio,estatus) values
 ('36500000-0000-4000-8000-000000000001','36500000-0000-4000-8000-000000000001','36500000-0000-4000-8000-000000000001','A365-1','liquidado');

-- ── PAR MIXTO · UN ticket de $10,000, folio 'MIX', pagado EN EFECTIVO ('01'). ──
--    fila A  10:00  CON cfdi_uuid, `forma_pago '99'` sin `pagado_en`  → util = 1
--    fila B  11:00  SIN cfdi_uuid, `forma_pago '01'` (efectivo)       → util = 0
--    Es el orden que el producto produce: el CFDI PPD llega primero y la foto
--    que sí deja leer la forma de pago llega después.
insert into public.gasto
 (id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,pagado_en,cfdi_uuid,created_at) values
 ('00000365-0000-4000-8000-0000000000a1','36500000-0000-4000-8000-000000000001','36500000-0000-4000-8000-000000000001',
  'diesel',10000,'2026-05-01','MIX','MIX','ESA030303CC1','99',null,'36533333-3333-4333-8333-333333333333','2026-05-01 10:00:00+00'),
 ('00000365-0000-4000-8000-0000000000a2','36500000-0000-4000-8000-000000000001','36500000-0000-4000-8000-000000000001',
  'diesel',10000,'2026-05-01','MIX','MIX','ESA030303CC1','01',null,null,'2026-05-01 11:00:00+00');

-- ── CONTROL · dos CFDI DISTINTOS que comparten folio, monto, concepto y emisor.
--    No son copias: son dos comprobantes con folio fiscal propio, y el doble
--    conteo aquí es CORRECTO. Está sembrado para que el arreglo no pueda
--    comprarse la aserción (a) fusionando todo lo que comparte folio.
insert into public.gasto
 (id,tenant_id,viaje_id,concepto,monto,fecha,folio,folio_norm,rfc_emisor,forma_pago,pagado_en,cfdi_uuid,created_at) values
 ('00000365-0000-4000-8000-0000000000b1','36500000-0000-4000-8000-000000000001','36500000-0000-4000-8000-000000000001',
  'diesel',3000,'2026-05-02','DOS','DOS','ESA030303CC1','01',null,'36544444-4444-4444-8444-444444444444','2026-05-02 10:00:00+00'),
 ('00000365-0000-4000-8000-0000000000b2','36500000-0000-4000-8000-000000000001','36500000-0000-4000-8000-000000000001',
  'diesel',3000,'2026-05-02','DOS','DOS','ESA030303CC1','01',null,'36555555-5555-4555-8555-555555555555','2026-05-02 11:00:00+00');

set local role service_role;
do $$
declare
  r_total     numeric;
  r_efectivo  numeric;
begin
  select total, efectivo into r_total, r_efectivo
    from public.sumar_combustible_ejercicio(
           '36500000-0000-4000-8000-000000000001', 2026, array['15101505']);

  -- (a) DAT-32C9-C1: el par mixto cuenta UNA vez. 10,000 del par + 3,000 + 3,000
  --     de los dos CFDI distintos del control = 16,000. Con la 0364 esto da
  --     26,000 y el tope del 15 % sube de $2,400 a $3,900.
  if r_total <> 16000 then
    raise exception 'DAT-32C9-C1: el par MIXTO (una foto con cfdi_uuid, su copia sin el) cuenta dos veces en `total`, que es el DENOMINADOR del tope del 15%% de la RFA 2.9: total=% (esperado 16000 = 10000 del par + 3000 + 3000 del control). La fila con uuid toma rango 1 de su propia ventana y ya no absorbe el rango 1 de la ventana del folio, asi que sobreviven las dos: el tope se infla y el PDF imprime "deducible" donde la regla no concede.',
      r_total;
  end if;

  -- (b) FIS-32C8-C1 (0364): entre las dos copias del par sobrevive la LEGIBLE,
  --     la que trae `forma_pago '01'`. Si se cayera, el arreglo del par mixto se
  --     habria comprado quedandose con la fila del CFDI PPD, que no deja derivar
  --     el numerador, y volveria el critico de la c8.
  --     10,000 del par + 6,000 del control, los tres en efectivo = 16,000.
  if r_efectivo <> 16000 then
    raise exception 'FIS-32C8-C1: el ejercicio perdio el numerador del 15%% del par mixto: efectivo=% (esperado 16000). Entre dos copias debe sobrevivir la que SI trae forma de pago util; quedarse con la fila `99` sin `pagado_en` deja `forma_pago_efectiva` en NULL y el excedente en efectivo se imprime como deducible.',
      r_efectivo;
  end if;
end $$;
reset role;

rollback;
