-- 0168 — Fase 1 del plan de asistencia/siniestros (docs/asistencia/PLAN-FASES.md):
-- los litros que hoy se tiran.
--
-- `cfdi_xml.ts` ya parsea `cantidad` (litros) de cada línea del consolidado —
-- tanto ECC12 (monedero de combustible) como concepto_base — pero
-- `cfdi_consolidado_linea` (migración 0076) no tiene dónde guardarlos: se leen
-- en memoria y se tiran al persistir (`guardarYConciliarConsolidado`,
-- consolidado.ts). Consecuencia real: TODA flota que paga diésel con monedero
-- llega a `engine.ts` con `gasto.ocr_extra.litros = 0` — cero litros
-- acreditables del estímulo LIF 2026 art. 20 ap. A, que es justo el segmento
-- (monedero) donde el estímulo vale más.
--
-- `litros`: la cantidad de la línea cuando es una unidad de volumen (LTR en
-- concepto_base; en ECC12 la ECC12 v1.2 no da ClaveUnidad por línea, solo
-- `Cantidad` — se guarda igual, la interpretación de unidad la fija el código
-- que la escribe, no esta columna).
--
-- `clave_prod_serv`: la clave SAT de la línea CUANDO SE CONOCE con confianza.
-- concepto_base la trae de forma nativa (`@ClaveProdServ`). ECC12 NO trae
-- ClaveProdServ por transacción — solo `TipoCombustible`, un catálogo cerrado
-- ("Diesel", "Gasolina Regular (Magna)", "Gasolina Premium", "Gas Natural",
-- "Gas L.P.", "Otros") — así que para esas líneas la columna solo se llena
-- cuando `TipoCombustible = 'Diesel'` (mapeado a 15101505, la única clave que
-- el estímulo reconoce hoy en `config.ts:130`); cualquier otro valor u
-- ausente se queda NULL a propósito — no es un dato que falte, es que ese
-- concepto no aplica al estímulo (ver `claveProdServDeLinea` en consolidado.ts).
alter table public.cfdi_consolidado_linea add column if not exists litros numeric(12,3);
alter table public.cfdi_consolidado_linea add column if not exists clave_prod_serv text;

comment on column public.cfdi_consolidado_linea.litros is
  'Cantidad de la linea (litros de combustible cuando aplica). Se propaga a gasto.ocr_extra.litros al ligar — ver ligarLineaAGasto en consolidado.ts. NULL = la linea no trae Cantidad (p.ej. una caseta).';
comment on column public.cfdi_consolidado_linea.clave_prod_serv is
  'Clave SAT (c_ClaveProdServ) de la linea cuando se conoce con confianza. concepto_base la trae nativa; ecc12 solo cuando TipoCombustible=Diesel (mapeada a 15101505). NULL a proposito en cualquier otro caso — ver claveProdServDeLinea en consolidado.ts.';
