-- 0214 · FASE D DE CARTA PORTE (vía export XML) — la bitácora del XML.
--
-- Decisión de Javier (27-ago-2026): cerrar el ciclo por la vía EXPORT — el
-- XML del CFDI de ingreso con complemento CCP 3.1 se genera del borrador
-- VALIDADO y se descarga para timbrarse en el facturador de la flota. Likida
-- sigue sin timbrar (0049) y sin sellar (no hay CSD del cliente); la vía
-- PAC-por-API queda como upgrade documentado en carta_porte_xml.ts.
--
-- Estas dos columnas son el rastro: cuándo se generó el XML por última vez y
-- quién lo pidió. LA ÚLTIMA GANA a propósito — el XML se regenera tras
-- corregir datos del borrador, y lo citable es la generación más reciente
-- (mismo contrato de sobreescritura que un borrador reimpreso). El detalle de
-- cada generación (IdCCP asignado, omitidos) vive en el log del sistema.
--
-- Patrón de la 0208/0087: columnas nullables puras, cero lógica en SQL — la
-- garantía la da el código (solo la ruta de export escribe, tras generar con
-- éxito) y sus pruebas en TS. Va en EXENTAS de verificaciones con esta razón.

alter table public.viaje
  add column if not exists ccp_xml_generado_en  timestamptz,
  add column if not exists ccp_xml_generado_por uuid references public.app_user(id) on delete set null;

comment on column public.viaje.ccp_xml_generado_en is
  'Última vez que se generó el XML pre-timbrado de Carta Porte (Fase D, export). NULL = nunca. La última generación gana; el detalle por generación (IdCCP, omitidos) vive en el log. Solo escribe /api/export/carta-porte-xml.';
comment on column public.viaje.ccp_xml_generado_por is
  'Quién pidió la última generación del XML. Se conserva el rastro aunque el usuario se borre (set null).';
