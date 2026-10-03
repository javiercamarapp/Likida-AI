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
}

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

  { clave: 'destino_nombre', rotulo: 'Destinatario (nombre)', grupo: 'destino', tipo: 'texto', critico: false, max: 200 },
  { clave: 'destino_rfc', rotulo: 'RFC del destinatario', grupo: 'destino', tipo: 'rfc', critico: true, max: 13 },
  { clave: 'destino_cp', rotulo: 'Código postal de destino', grupo: 'destino', tipo: 'cp', critico: true, max: 5 },
  { clave: 'destino_estado', rotulo: 'Estado de destino', grupo: 'destino', tipo: 'estado', critico: false, max: 3 },
  { clave: 'destino_domicilio', rotulo: 'Domicilio de destino', grupo: 'destino', tipo: 'texto', critico: false, max: 300 },

  { clave: 'operador_nombre', rotulo: 'Operador (nombre)', grupo: 'transporte', tipo: 'texto', critico: false, max: 200 },
  { clave: 'operador_rfc', rotulo: 'RFC del operador', grupo: 'transporte', tipo: 'rfc', critico: false, max: 13 },
  { clave: 'operador_licencia', rotulo: 'Licencia federal del operador', grupo: 'transporte', tipo: 'texto', critico: false, max: 16 },
  { clave: 'unidad_placas', rotulo: 'Placas de la unidad', grupo: 'transporte', tipo: 'placa', critico: false, max: 7 },
  { clave: 'unidad_economico', rotulo: 'Número económico de la unidad', grupo: 'transporte', tipo: 'texto', critico: false, max: 30 },
  { clave: 'remolque_placas', rotulo: 'Placas del remolque', grupo: 'transporte', tipo: 'placa', critico: false, max: 7 },

  { clave: 'peso_bruto_total', rotulo: 'Peso bruto total (kg)', grupo: 'carga', tipo: 'numero', critico: false, max: 14 },
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
  { clave: 'embalaje', rotulo: 'Embalaje (c_TipoEmbalaje)', grupo: 'carga', tipo: 'embalaje', critico: false, max: 3 },
  { clave: 'valor_mercancia', rotulo: 'Valor de la mercancía', grupo: 'carga', tipo: 'numero', critico: false, max: 16 },
  { clave: 'moneda', rotulo: 'Moneda del valor', grupo: 'carga', tipo: 'moneda', critico: false, max: 3 },
  { clave: 'material_peligroso', rotulo: 'Material peligroso', grupo: 'carga', tipo: 'booleano', critico: false, max: 5 },
];

export const CLAVES_DOC: readonly string[] = CAMPOS_DOC.map((c) => c.clave);
export const CLAVES_MERCANCIA: readonly string[] = CAMPOS_MERCANCIA.map((c) => c.clave);

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

export type Origen = 'xml' | 'perfil' | 'llm' | 'humano' | 'derivado';

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
