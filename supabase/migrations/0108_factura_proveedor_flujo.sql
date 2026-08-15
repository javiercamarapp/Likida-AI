-- ═══════════════════════════════════════════════════════════════════════════
-- 0108 — El flujo completo de la bandeja de proveedores (F6, escalones 1 y 2).
--
-- La 0091 dejó la bandeja mínima: XML entra, humano decide. Lo que faltaba
-- para cerrar los dos primeros escalones de la FASE 6 son cuatro datos que
-- HOY no tienen dónde vivir, y cada uno existe por una mentira que evitaría:
--
--   · `origen` — ¿la factura llegó por el buzón de correo o la subió alguien
--     a mano? Sin esto, la pantalla no puede decir de dónde vino cada una.
--     NULL = fila anterior a esta migración: NO se rellena con un valor
--     adivinado, porque afirmar "por correo" de una factura que quizá se
--     subió a mano es exactamente la clase de dato inventado que el producto
--     prohíbe.
--   · `ocr_confianza` — la 0091 decía "sin OCR a propósito" porque el CFDI
--     siempre trae XML. Sigue siendo verdad para el CFDI; pero el plan (F6)
--     incluye la FOTO de la factura como vía de entrada, y una cifra leída
--     por visión NO es dato duro: esta columna marca la fila para que la
--     cola de aprobación la priorice a revisión. NULL = entró por XML.
--   · `estado_sat` — el resultado de ConsultaCFDIService AL INGERIR. Un CFDI
--     cancelado en la bandeja sin marcarlo dejaría al humano aprobar una
--     factura que el SAT ya no reconoce. NULL = no se consultó (filas viejas
--     o SAT sin respuesta al ingerir se guarda 'pendiente', que es distinto:
--     'pendiente' afirma que SE INTENTÓ).
--   · `exportada_en` — el escalón 2 es el CSV importable a SAP B1/CONTPAQi.
--     Sin marca de export, la misma factura aprobada saldría dos veces en dos
--     descargas y se importaría doble al ERP del cliente. Es TIMESTAMP y no
--     un estado nuevo a propósito: la verificación 66 fija que el dominio de
--     `estado` es pendiente|aprobada|rechazada — "exportada" no sustituye a
--     "aprobada" (la decisión humana no se borra), la acompaña.
--
-- El índice de la cola (tenant_id, estado, created_at desc) ya existe desde
-- la 0091 (`idx_factura_proveedor_cola`) y cubre la bandeja y el export.
--
-- RLS: la tabla quedó deny-all en la 0091 (RLS activa, cero políticas — solo
-- el service role entra) y las columnas nuevas heredan eso sin tocar nada.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.factura_proveedor
  add column origen text,
  add column ocr_confianza numeric(3,2),
  add column estado_sat text,
  add column exportada_en timestamptz;

-- La foto no trae XML: `xml_crudo` deja de ser obligatorio…
alter table public.factura_proveedor
  alter column xml_crudo drop not null;

alter table public.factura_proveedor
  add constraint factura_proveedor_origen_dominio
    check (origen in ('correo', 'subida')),
  add constraint factura_proveedor_ocr_rango
    check (ocr_confianza >= 0 and ocr_confianza <= 1),
  add constraint factura_proveedor_sat_dominio
    check (estado_sat in ('vigente', 'cancelado', 'no_encontrado', 'pendiente')),
  -- …pero NUNCA una factura sin respaldo: o hay XML, o hay marca de OCR.
  -- Una fila sin ninguno de los dos no puede decir de dónde salió su cifra.
  add constraint factura_proveedor_respaldo
    check (xml_crudo is not null or ocr_confianza is not null),
  -- Solo lo APROBADO sale al ERP. `decidirFacturaProveedor` solo transiciona
  -- desde 'pendiente', así que 'aprobada' es terminal y este check no puede
  -- quedar huérfano por un cambio de decisión posterior.
  add constraint factura_proveedor_exporta_solo_aprobada
    check (exportada_en is null or estado = 'aprobada');

comment on column public.factura_proveedor.origen is
  'correo = entró por el buzón del tenant; subida = la subió alguien del panel (XML o foto). NULL = fila anterior a la 0108, origen no rastreado — no se adivina.';
comment on column public.factura_proveedor.ocr_confianza is
  'Confianza 0-1 de la extracción por visión cuando la factura entró como FOTO. NULL = entró por XML (dato duro del CFDI). Con valor, la cola prioriza revisión humana.';
comment on column public.factura_proveedor.estado_sat is
  'ConsultaCFDIService al ingerir: vigente|cancelado|no_encontrado|pendiente (pendiente = se intentó y el SAT no contestó). NULL = no se consultó (filas pre-0108).';
comment on column public.factura_proveedor.exportada_en is
  'Primera vez que esta factura salió en un export CSV para el ERP. Marca anti-doble-import; no sustituye al estado aprobada.';

-- ── La bitácora de corridas aprende el disparo `correo` ────────────────────
-- El agente de Proveedores no corre por reloj: corre cuando LLEGA un correo
-- al buzón (webhook de Resend). Registrar eso como 'cron' mentiría en la
-- ficha («Programado» sobre algo que disparó un correo). Mismo patrón que la
-- 0105 al ampliar el dominio de `agente`.
alter table public.agente_corrida
  drop constraint agente_corrida_disparo_dominio;
alter table public.agente_corrida
  add constraint agente_corrida_disparo_dominio
    check (disparo in ('cron', 'manual', 'correo'));
