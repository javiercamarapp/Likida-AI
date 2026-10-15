// ═══════════════════════════════════════════════════════════════════════════
// CARTA PORTE MULTI-FORMATO — los campos que se extraen de un documento.
//
// UNA sola lista, de la que salen (a) el esquema que se le pide al modelo, (b) la
// validación, (c) la pantalla de revisión y (d) el mapeo de la exportación. Si un
// campo se agrega aquí, todos lo ven; si se agrega en otra parte, falta en tres.
//
// Son los datos del documento del CLIENTE (Apéndice 3 del Instructivo CCP 3.1,
// los 19 que le tocan al cliente) más los que el transportista necesita para
// armar el viaje en Likida (operador, unidad, remolque). `critico` marca los que,
// si el modelo duda o el valor no valida, BLOQUEAN la aprobación hasta que un
// humano los confirme: un RFC o un código postal equivocados no son un error de
// captura, son un complemento con dato falso (CFF 29-A fr. IX).
// ═══════════════════════════════════════════════════════════════════════════

export type TipoCampo =
  | 'texto' | 'rfc' | 'cp' | 'fecha' | 'numero' | 'clave_prod' | 'clave_unidad'
  | 'fraccion' | 'estado' | 'booleano' | 'moneda' | 'embalaje' | 'placa';

export type GrupoCampo = 'documento' | 'origen' | 'destino' | 'transporte' | 'carga';

export interface CampoDoc {
  clave: string;
  rotulo: string;
  grupo: GrupoCampo;
  tipo: TipoCampo;
  /** Bloquea la aprobación si está ausente, dudoso o inválido. */
  critico: boolean;
  /** Largo máximo del valor tal como se guarda. */
  max: number;
  /**
   * Se rellena por catálogo, perfil, JSON o Excel; NUNCA se le pide al modelo
   * (no deduce claves del SAT ni domicilios): se excluye de su esquema y su prompt,
   * pero sí se muestra en el visor y se exporta.
   */
  soloEnriquecimiento?: boolean;
}

// NOTA (T-A3-06): `origen_pais`/`destino_pais` son obligatorios en la plantilla («*País»)
// pero NO son `critico` todavía: hoy nada los rellena (el modelo no los recibe y el
// enriquecimiento por catálogo es T-A3-20), así que marcarlos críticos bloquearía la
// aprobación de TODO documento. Pasan a `critico: true` cuando T-A3-20 los rellene.
export const CAMPOS_DOC: ReadonlyArray<CampoDoc> = [
  { clave: 'folio_cliente', rotulo: 'Folio / referencia del cliente', grupo: 'documento', tipo: 'texto', critico: false, max: 40 },
  { clave: 'fecha_salida', rotulo: 'Fecha y hora de salida', grupo: 'documento', tipo: 'fecha', critico: false, max: 25 },
  { clave: 'fecha_llegada', rotulo: 'Fecha y hora de llegada (cita)', grupo: 'documento', tipo: 'fecha', critico: false, max: 25 },
  { clave: 'distancia_km', rotulo: 'Distancia (km)', grupo: 'documento', tipo: 'numero', critico: false, max: 12 },
  { clave: 'transp_internac', rotulo: 'Transporte internacional', grupo: 'documento', tipo: 'booleano', critico: false, max: 5 },

  { clave: 'origen_nombre', rotulo: 'Remitente (nombre)', grupo: 'origen', tipo: 'texto', critico: false, max: 200 },
  { clave: 'origen_rfc', rotulo: 'RFC del remitente', grupo: 'origen', tipo: 'rfc', critico: true, max: 13 },
  { clave: 'origen_cp', rotulo: 'Código postal de origen', grupo: 'origen', tipo: 'cp', critico: true, max: 5 },
  { clave: 'origen_estado', rotulo: 'Estado de origen', grupo: 'origen', tipo: 'estado', critico: false, max: 3 },
  { clave: 'origen_domicilio', rotulo: 'Domicilio de origen', grupo: 'origen', tipo: 'texto', critico: false, max: 300 },
  { clave: 'origen_calle', rotulo: 'Calle de origen', grupo: 'origen', tipo: 'texto', critico: false, max: 60, soloEnriquecimiento: true },
  { clave: 'origen_num_ext', rotulo: 'Número exterior de origen', grupo: 'origen', tipo: 'texto', critico: false, max: 55, soloEnriquecimiento: true },
  { clave: 'origen_num_int', rotulo: 'Número interior de origen', grupo: 'origen', tipo: 'texto', critico: false, max: 55, soloEnriquecimiento: true },
  { clave: 'origen_colonia_clave', rotulo: 'Clave de colonia de origen', grupo: 'origen', tipo: 'texto', critico: false, max: 4, soloEnriquecimiento: true },
  { clave: 'origen_colonia', rotulo: 'Colonia de origen', grupo: 'origen', tipo: 'texto', critico: false, max: 120, soloEnriquecimiento: true },
  { clave: 'origen_localidad_clave', rotulo: 'Clave de localidad de origen', grupo: 'origen', tipo: 'texto', critico: false, max: 2, soloEnriquecimiento: true },
  { clave: 'origen_localidad', rotulo: 'Localidad de origen', grupo: 'origen', tipo: 'texto', critico: false, max: 120, soloEnriquecimiento: true },
  { clave: 'origen_municipio_clave', rotulo: 'Clave de municipio de origen', grupo: 'origen', tipo: 'texto', critico: false, max: 3, soloEnriquecimiento: true },
  { clave: 'origen_municipio', rotulo: 'Municipio de origen', grupo: 'origen', tipo: 'texto', critico: false, max: 120, soloEnriquecimiento: true },
  { clave: 'origen_pais', rotulo: 'País de origen', grupo: 'origen', tipo: 'texto', critico: false, max: 3, soloEnriquecimiento: true },

  { clave: 'destino_nombre', rotulo: 'Destinatario (nombre)', grupo: 'destino', tipo: 'texto', critico: false, max: 200 },
  { clave: 'destino_rfc', rotulo: 'RFC del destinatario', grupo: 'destino', tipo: 'rfc', critico: true, max: 13 },
  { clave: 'destino_cp', rotulo: 'Código postal de destino', grupo: 'destino', tipo: 'cp', critico: true, max: 5 },
  { clave: 'destino_estado', rotulo: 'Estado de destino', grupo: 'destino', tipo: 'estado', critico: false, max: 3 },
  { clave: 'destino_domicilio', rotulo: 'Domicilio de destino', grupo: 'destino', tipo: 'texto', critico: false, max: 300 },
  { clave: 'destino_calle', rotulo: 'Calle de destino', grupo: 'destino', tipo: 'texto', critico: false, max: 60, soloEnriquecimiento: true },
  { clave: 'destino_num_ext', rotulo: 'Número exterior de destino', grupo: 'destino', tipo: 'texto', critico: false, max: 55, soloEnriquecimiento: true },
  { clave: 'destino_num_int', rotulo: 'Número interior de destino', grupo: 'destino', tipo: 'texto', critico: false, max: 55, soloEnriquecimiento: true },
  { clave: 'destino_colonia_clave', rotulo: 'Clave de colonia de destino', grupo: 'destino', tipo: 'texto', critico: false, max: 4, soloEnriquecimiento: true },
  { clave: 'destino_colonia', rotulo: 'Colonia de destino', grupo: 'destino', tipo: 'texto', critico: false, max: 120, soloEnriquecimiento: true },
  { clave: 'destino_localidad_clave', rotulo: 'Clave de localidad de destino', grupo: 'destino', tipo: 'texto', critico: false, max: 2, soloEnriquecimiento: true },
  { clave: 'destino_localidad', rotulo: 'Localidad de destino', grupo: 'destino', tipo: 'texto', critico: false, max: 120, soloEnriquecimiento: true },
  { clave: 'destino_municipio_clave', rotulo: 'Clave de municipio de destino', grupo: 'destino', tipo: 'texto', critico: false, max: 3, soloEnriquecimiento: true },
  { clave: 'destino_municipio', rotulo: 'Municipio de destino', grupo: 'destino', tipo: 'texto', critico: false, max: 120, soloEnriquecimiento: true },
  { clave: 'destino_pais', rotulo: 'País de destino', grupo: 'destino', tipo: 'texto', critico: false, max: 3, soloEnriquecimiento: true },
  { clave: 'destino_id_fiscal', rotulo: 'ID fiscal del destinatario (extranjero, NumRegIdTrib)', grupo: 'destino', tipo: 'texto', critico: false, max: 40, soloEnriquecimiento: true },
  { clave: 'contacto_destino_nombre', rotulo: 'Contacto en destino (nombre)', grupo: 'destino', tipo: 'texto', critico: false, max: 120, soloEnriquecimiento: true },
  { clave: 'contacto_destino_telefono', rotulo: 'Contacto en destino (teléfono)', grupo: 'destino', tipo: 'texto', critico: false, max: 30, soloEnriquecimiento: true },
  { clave: 'contacto_destino_correo', rotulo: 'Contacto en destino (correo)', grupo: 'destino', tipo: 'texto', critico: false, max: 120, soloEnriquecimiento: true },

  { clave: 'operador_nombre', rotulo: 'Operador (nombre)', grupo: 'transporte', tipo: 'texto', critico: false, max: 200 },
  { clave: 'operador_rfc', rotulo: 'RFC del operador', grupo: 'transporte', tipo: 'rfc', critico: false, max: 13 },
  { clave: 'operador_licencia', rotulo: 'Licencia federal del operador', grupo: 'transporte', tipo: 'texto', critico: false, max: 16 },
  { clave: 'unidad_placas', rotulo: 'Placas de la unidad', grupo: 'transporte', tipo: 'placa', critico: false, max: 7 },
  { clave: 'unidad_economico', rotulo: 'Número económico de la unidad', grupo: 'transporte', tipo: 'texto', critico: false, max: 30 },
  { clave: 'remolque_placas', rotulo: 'Placas del remolque', grupo: 'transporte', tipo: 'placa', critico: false, max: 7 },

  { clave: 'peso_bruto_total', rotulo: 'Peso bruto total (kg)', grupo: 'carga', tipo: 'numero', critico: false, max: 14 },
  { clave: 'caja_numero', rotulo: 'Número de caja', grupo: 'transporte', tipo: 'texto', critico: false, max: 30 },
  { clave: 'piezas_total', rotulo: 'Total de piezas', grupo: 'carga', tipo: 'numero', critico: false, max: 14, soloEnriquecimiento: true },
  { clave: 'volumen_total', rotulo: 'Volumen total (m³)', grupo: 'carga', tipo: 'numero', critico: false, max: 14, soloEnriquecimiento: true },
  { clave: 'numero_cliente_interno', rotulo: 'Número de cliente interno (solo sistema)', grupo: 'documento', tipo: 'texto', critico: false, max: 40, soloEnriquecimiento: true },
];

/** Los campos de CADA renglón de mercancía. */
export const CAMPOS_MERCANCIA: ReadonlyArray<CampoDoc> = [
  { clave: 'descripcion', rotulo: 'Descripción', grupo: 'carga', tipo: 'texto', critico: true, max: 500 },
  { clave: 'bienes_transp', rotulo: 'Clave de producto (c_ClaveProdServCP)', grupo: 'carga', tipo: 'clave_prod', critico: true, max: 8 },
  { clave: 'fraccion_arancelaria', rotulo: 'Fracción arancelaria', grupo: 'carga', tipo: 'fraccion', critico: false, max: 10 },
  { clave: 'cantidad', rotulo: 'Cantidad', grupo: 'carga', tipo: 'numero', critico: true, max: 14 },
  { clave: 'clave_unidad', rotulo: 'Clave de unidad (c_ClaveUnidad)', grupo: 'carga', tipo: 'clave_unidad', critico: true, max: 3 },
  { clave: 'unidad_texto', rotulo: 'Unidad (como la escribe el cliente)', grupo: 'carga', tipo: 'texto', critico: false, max: 40 },
  { clave: 'peso_kg', rotulo: 'Peso (kg)', grupo: 'carga', tipo: 'numero', critico: true, max: 14 },
  { clave: 'peso_unidad', rotulo: 'Unidad del peso en el documento', grupo: 'carga', tipo: 'texto', critico: false, max: 10 },
  { clave: 'peso_tipo', rotulo: 'Qué peso trae el documento (bruto, neto o por embalaje)', grupo: 'carga', tipo: 'texto', critico: false, max: 30, soloEnriquecimiento: true },
  { clave: 'embalaje', rotulo: 'Embalaje (c_TipoEmbalaje)', grupo: 'carga', tipo: 'embalaje', critico: false, max: 3 },
  { clave: 'valor_mercancia', rotulo: 'Valor de la mercancía', grupo: 'carga', tipo: 'numero', critico: false, max: 16 },
  { clave: 'moneda', rotulo: 'Moneda del valor', grupo: 'carga', tipo: 'moneda', critico: false, max: 3 },
  { clave: 'material_peligroso', rotulo: 'Material peligroso', grupo: 'carga', tipo: 'booleano', critico: false, max: 5 },
  { clave: 'pedimento', rotulo: 'Número de pedimento', grupo: 'carga', tipo: 'texto', critico: false, max: 21 },
  { clave: 'rfc_agente_aduanal', rotulo: 'RFC del agente aduanal', grupo: 'carga', tipo: 'rfc', critico: false, max: 13, soloEnriquecimiento: true },
  { clave: 'rfc_importador', rotulo: 'RFC del importador', grupo: 'carga', tipo: 'rfc', critico: false, max: 13 },
  { clave: 'regimen_aduanero', rotulo: 'Régimen aduanero', grupo: 'carga', tipo: 'texto', critico: false, max: 10 },
  { clave: 'tipo_materia', rotulo: 'Tipo de materia', grupo: 'carga', tipo: 'texto', critico: false, max: 10 },
  { clave: 'clave_material_peligroso', rotulo: 'Clave de material peligroso', grupo: 'carga', tipo: 'texto', critico: false, max: 6 },
  { clave: 'unidad_descripcion', rotulo: 'Descripción de la unidad', grupo: 'carga', tipo: 'texto', critico: false, max: 100, soloEnriquecimiento: true },
  { clave: 'embalaje_descripcion', rotulo: 'Descripción del embalaje', grupo: 'carga', tipo: 'texto', critico: false, max: 100, soloEnriquecimiento: true },
  { clave: 'volumen', rotulo: 'Volumen (m³)', grupo: 'carga', tipo: 'numero', critico: false, max: 14, soloEnriquecimiento: true },
];

export const CLAVES_DOC: readonly string[] = CAMPOS_DOC.map((c) => c.clave);
export const CLAVES_MERCANCIA: readonly string[] = CAMPOS_MERCANCIA.map((c) => c.clave);

/** Lo que SÍ se le pide al modelo (sin los campos `soloEnriquecimiento`). */
export const CAMPOS_DOC_LLM: ReadonlyArray<CampoDoc> = CAMPOS_DOC.filter((c) => !c.soloEnriquecimiento);
export const CAMPOS_MERCANCIA_LLM: ReadonlyArray<CampoDoc> = CAMPOS_MERCANCIA.filter((c) => !c.soloEnriquecimiento);
export const CLAVES_DOC_LLM: readonly string[] = CAMPOS_DOC_LLM.map((c) => c.clave);
export const CLAVES_MERCANCIA_LLM: readonly string[] = CAMPOS_MERCANCIA_LLM.map((c) => c.clave);

const POR_CLAVE_DOC = new Map(CAMPOS_DOC.map((c) => [c.clave, c]));
const POR_CLAVE_MERC = new Map(CAMPOS_MERCANCIA.map((c) => [c.clave, c]));

export function campoDoc(clave: string): CampoDoc | undefined { return POR_CLAVE_DOC.get(clave); }
export function campoMercancia(clave: string): CampoDoc | undefined { return POR_CLAVE_MERC.get(clave); }

/** Máximo de renglones de mercancía que se leen de UN documento. */
export const MAX_MERCANCIAS = 100;

/** Confianza mínima de un campo crítico para NO pedir confirmación humana. */
export const UMBRAL_CRITICO = 0.85;
/** Por debajo de esta confianza en un campo crítico, se escala al siguiente modelo. */
export const UMBRAL_ESCALA = 0.8;

/** Cómo se llama un campo en pantalla y en las correcciones. `renglon` null = campo del documento. */
export function etiquetaCampo(clave: string, renglon: number | null): string {
  const c = renglon === null ? campoDoc(clave) : campoMercancia(clave);
  return renglon === null ? (c?.rotulo ?? clave) : `Mercancía ${renglon + 1} · ${c?.rotulo ?? clave}`;
}

export type Origen = 'xml' | 'perfil' | 'llm' | 'humano' | 'derivado' | 'catalogo';

/** Un valor extraído, con qué tan seguro está y de dónde salió. */
export interface CampoValor {
  /** Siempre texto normalizado (o null = el documento no lo trae / no se pudo leer). */
  valor: string | null;
  /** 0..1. Para un valor `humano` es 1; para `xml` 0.99 (dato estructurado). */
  confianza: number;
  /** El fragmento del documento del que se tomó (≤ 200 caracteres). */
  evidencia: string | null;
  origen: Origen;
  /** Avisos de normalización o validación en lenguaje del que revisa. */
  notas?: string[];
}

export interface Extraccion {
  campos: Record<string, CampoValor>;
  mercancias: Array<Record<string, CampoValor>>;
}

export const extraccionVacia = (): Extraccion => ({ campos: {}, mercancias: [] });
