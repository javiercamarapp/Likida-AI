-- ═══════════════════════════════════════════════════════════════════════════
-- 0099 — CARTA PORTE: los datos del TRANSPORTISTA que el complemento exige.
--
-- El Apéndice 3 del Instructivo CCP 3.1 parte los 37 datos mínimos en 19 del
-- cliente y 18 del transportista, y la regla 2.7.7.1.1 (RMF 2026) limita la
-- responsabilidad de cada parte A SUS DATOS. De los 18 del transportista,
-- `unidad` ya tenía placas y año; esta migración agrega los seis que no
-- tenían dónde vivir, y las dos DECLARACIONES por viaje que deciden si el
-- complemento se necesita (reglas 2.7.7.2.1 y 2.7.7.2.8).
--
-- TODO NULLABLE Y SIN DEFAULTS DE CATÁLOGO, a propósito:
--  · Un permiso SICT no declarado NO es `TPXX00` ("no requiere permiso") —
--    esa clave es una declaración con consecuencias, no un relleno.
--  · Las claves de catálogo SAT (c_ConfigAutotransporte, c_TipoPermiso) NO
--    llevan CHECK en la base: los catálogos cambian por publicación del SAT
--    (el catCartaPorte.xsd cambió el 13-ene-2026 sin aviso) y un dominio
--    congelado en un constraint rechazaría claves nuevas legítimas. La
--    validación viva está en `lib/likida/carta_porte.ts`, junto a su ficha
--    (normas/rmf-2026-2.7.7.yaml) que la vigilancia normativa sí revisa.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── La unidad: identificación vehicular, seguro y permiso ──────────────────

alter table public.unidad
  add column if not exists config_vehicular text;
comment on column public.unidad.config_vehicular is
  'Clave del catálogo SAT c_ConfigAutotransporte (C2, C3, T3S2…). NULL = no declarada; el clasificador de Carta Porte no decide sin ella cuando el viaje pisa federal.';

alter table public.unidad
  add column if not exists peso_bruto_ton numeric(6,2);
comment on column public.unidad.peso_bruto_ton is
  'Peso bruto vehicular en TONELADAS (así lo pide el complemento, NOM-012-SCT-2-2017). NULL = no capturado.';

alter table public.unidad
  add column if not exists aseguradora_rc text;
alter table public.unidad
  add column if not exists poliza_rc_numero text;
comment on column public.unidad.aseguradora_rc is
  'Aseguradora de responsabilidad civil. Requerida en el complemento (AseguraRespCivil) y obligación reglamentaria (RAFSA art. 83). La VIGENCIA ya vivía en poliza_vence (0047); esto es quién asegura y con qué póliza.';

alter table public.unidad
  add column if not exists permiso_sict_tipo text;
alter table public.unidad
  add column if not exists permiso_sict_numero text;
comment on column public.unidad.permiso_sict_tipo is
  'Clave del catálogo c_TipoPermiso (TPAF01 carga general, TPAF02 transporte privado, TPXX00 sin permiso federal…). El SAT NO valida el número contra ningún padrón — la Guardia Nacional en carretera sí, y por eso se captura el real.';

-- El peso, si viene, tiene que ser un peso: el tractocamión más pesado
-- permitido (T3S2R4) ronda las 66.5 t brutas. 100 acota el dedazo sin
-- estorbar a nadie real.
alter table public.unidad
  add constraint unidad_peso_bruto_sano
  check (peso_bruto_ton is null or (peso_bruto_ton > 0 and peso_bruto_ton < 100)) not valid;

-- ── El viaje: las dos declaraciones que deciden el complemento ─────────────
--
-- La regla 2.7.7.2.1 exige "plena certeza" de no pisar federal para omitir el
-- complemento, y la 2.7.7.2.8 da la excepción del radio de 30 km para
-- unidades hasta C2. Ninguna de las dos se puede ADIVINAR desde el software:
-- se DECLARAN por quien conoce la ruta, y la declaración queda en la fila —
-- que es exactamente el rastro que el contralor necesita cuando la autoridad
-- pregunta por qué este viaje salió sin complemento.

alter table public.viaje
  add column if not exists ccp_pisa_federal boolean;
comment on column public.viaje.ccp_pisa_federal is
  '¿La ruta pisa tramo de jurisdicción federal? NULL = nadie lo ha declarado (y el clasificador dice "falta declarar", nunca "no necesita"). Lo declara quien conoce la ruta — RMF 2026 regla 2.7.7.2.1 exige plena certeza.';

alter table public.viaje
  add column if not exists ccp_radio_federal_km numeric(5,1);
comment on column public.viaje.ccp_radio_federal_km is
  'RADIO en km del tramo federal entre origen inicial y destino final, con puntos intermedios (regla 2.7.7.2.8). Es un radio geodésico, NO kilómetros de odómetro. NULL = no medido.';

alter table public.viaje
  add constraint viaje_ccp_radio_sano
  check (ccp_radio_federal_km is null or (ccp_radio_federal_km >= 0 and ccp_radio_federal_km < 5000)) not valid;
