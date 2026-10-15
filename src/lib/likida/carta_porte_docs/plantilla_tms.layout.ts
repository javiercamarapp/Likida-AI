// ═══════════════════════════════════════════════════════════════════════════
// LAYOUT DECLARATIVO DE LA PLANTILLA DEL TMS («normal») — solo estructura, sin datos.
//
// La plantilla del TMS NO es una tabla plana: son hojas con celdas fijas (valores
// en la columna C) y tablas con encabezado propio. Aquí se declara DÓNDE cae cada
// campo; `plantilla_tms.ts` lo aplica. Todo es JSON serializable (se guarda en
// `cp_salida_config.layout`), así que cuando llegue la plantilla real en blanco se
// carga como configuración sin tocar código.
//
// PROVISIONAL (bloqueo externo B-2): la forma sale de la muestra M2 (hojas
// RemintenteDestinatario, Mercancias y Error). El bloque del destinatario
// (C29..C47) replica el del remitente +18 filas y el contacto va en C45..C47: eso
// se confirma con la plantilla en blanco. Cuáles columnas llevan «*» también.
// ═══════════════════════════════════════════════════════════════════════════

export type TransformacionPlantilla = 'nombre_estado' | 'si_no' | 'entero' | 'distancia';

export interface EntradaCelda {
  /** Coordenada fija, p. ej. `C12`. */
  celda: string;
  /** Campo del documento (`origen_rfc`), de la mercancía (`mercancia.peso_kg`) o del contexto (`ctx.clienteInterno`). */
  campo: string;
  /** Segundo campo a usar si el primero viene vacío. */
  alterno?: string;
  transformacion?: TransformacionPlantilla;
  /** Valor si el campo viene vacío (no cuenta como faltante). */
  defecto?: string;
  obligatorio: boolean;
  /** Se escribe como celda de TEXTO (jamás fórmula). Los números van con `texto:false`. */
  texto: boolean;
}

export interface ColumnaTabla {
  columna: string;
  encabezado: string;
  campo?: string;
  alterno?: string;
  constante?: string | number;
  transformacion?: TransformacionPlantilla;
  defecto?: string;
  obligatorio: boolean;
  texto: boolean;
  /** El valor es el número de fila de la tabla (IdDestino 1..n). */
  indice?: boolean;
  /** El valor es el destino al que va la mercancía (`mercancia.id_destino`); con un solo destino es 1. */
  idDestino?: boolean;
}

export interface TablaLayout {
  id: 'destinos' | 'mercancias';
  /** La tabla admite varias filas de destino (campos `destino_N_*` para N ≥ 2). */
  multi?: boolean;
  filaEncabezado: number;
  primeraFila: number;
  maxFilas: number;
  columnas: ColumnaTabla[];
}

export interface HojaLayout { hoja: string; celdas: EntradaCelda[]; tablas: TablaLayout[] }

export interface LayoutPlantilla {
  nombre: 'normal' | 'nueva';
  version: number;
  /** true mientras no exista la plantilla real en blanco (B-2). */
  provisional: boolean;
  /** `false` ⇒ solo sirve para DESCARGAR con aviso; el worker no la usa para enviar al TMS. Ausente = sin restricción. */
  verificada?: boolean;
  nota?: string;
  hojas: HojaLayout[];
}

const c = (celda: string, campo: string, obligatorio: boolean, extra: Partial<EntradaCelda> = {}): EntradaCelda =>
  ({ celda, campo, obligatorio, texto: true, ...extra });

/** Bloque de domicilio (remitente o destinatario): mismas 16 filas, desplazadas. */
function bloque(lado: 'origen' | 'destino', base: number): EntradaCelda[] {
  const f = (n: number) => `C${base + n}`;
  return [
    c(f(0), `${lado}_nombre`, true),
    c(f(1), `${lado}_rfc`, true),
    c(f(3), `${lado}_calle`, true),
    c(f(4), `${lado}_num_ext`, false),
    c(f(5), `${lado}_num_int`, false),
    c(f(6), `${lado}_colonia_clave`, false),
    c(f(7), `${lado}_colonia`, false),
    c(f(8), `${lado}_cp`, true),
    c(f(9), `${lado}_localidad_clave`, false),
    c(f(10), `${lado}_localidad`, false),
    c(f(11), `${lado}_municipio_clave`, false),
    c(f(12), `${lado}_municipio`, false),
    c(f(13), `${lado}_estado`, true),
    c(f(14), `${lado}_estado`, true, { transformacion: 'nombre_estado' }),
    c(f(15), `${lado}_pais`, true),
  ];
}

const t = (columna: string, encabezado: string, campo: string, obligatorio: boolean, extra: Partial<ColumnaTabla> = {}): ColumnaTabla =>
  ({ columna, encabezado, campo, obligatorio, texto: true, ...extra });

const COLUMNAS_DESTINOS: ColumnaTabla[] = [
  { columna: 'A', encabezado: 'IdDestino', constante: 1, transformacion: 'entero', obligatorio: true, texto: false, indice: true },
  t('B', 'Distancia', 'distancia_km', false, { texto: false, transformacion: 'distancia' }),
  t('C', 'Razón Social', 'destino_nombre', true),
  t('D', 'RFC', 'destino_rfc', true),
  t('E', 'Calle', 'destino_calle', true),
  t('F', 'Num Ext', 'destino_num_ext', false),
  t('G', 'Num Int', 'destino_num_int', false),
  t('H', 'Clave Colonia', 'destino_colonia_clave', false),
  t('I', 'Colonia', 'destino_colonia', false),
  t('J', 'CP', 'destino_cp', true),
  t('K', 'Clave Localidad', 'destino_localidad_clave', false),
  t('L', 'Localidad', 'destino_localidad', false),
  t('M', 'Clave Municipio', 'destino_municipio_clave', false),
  t('N', 'Municipio', 'destino_municipio', false),
  t('O', 'Clave Estado', 'destino_estado', true),
  t('P', 'Estado', 'destino_estado', true, { transformacion: 'nombre_estado' }),
  t('Q', 'País', 'destino_pais', true),
  t('R', 'Contacto', 'contacto_destino_nombre', false),
  t('S', 'Teléfono', 'contacto_destino_telefono', false),
  t('T', 'Correo', 'contacto_destino_correo', false),
];

const COLUMNAS_MERCANCIAS: ColumnaTabla[] = [
  { columna: 'A', encabezado: 'Id Destino', constante: 1, transformacion: 'entero', obligatorio: true, texto: false, idDestino: true },
  t('B', 'Bienes Transportados', 'mercancia.bienes_transp', true),
  t('C', 'Descripción', 'mercancia.descripcion', true),
  t('D', 'Cantidad', 'mercancia.cantidad', true, { texto: false }),
  t('E', 'Clave Unidad', 'mercancia.clave_unidad', true),
  t('F', 'Unidad', 'mercancia.unidad_descripcion', false, { alterno: 'mercancia.unidad_texto' }),
  t('G', 'Embalaje', 'mercancia.embalaje', false),
  t('H', 'Descripción embalaje', 'mercancia.embalaje_descripcion', false),
  t('I', 'Peso kg', 'mercancia.peso_kg', true, { texto: false }),
  t('J', 'Fracción', 'mercancia.fraccion_arancelaria', false),
  t('K', 'Tipo de Materia', 'mercancia.tipo_materia', false),
  t('L', 'Régimen Aduanero', 'mercancia.regimen_aduanero', false),
  t('M', 'RFC Agente Aduanal', 'mercancia.rfc_agente_aduanal', false),
  t('N', 'Número de Pedimento', 'mercancia.pedimento', false),
  t('O', 'Material Peligroso', 'mercancia.material_peligroso', true, { transformacion: 'si_no', defecto: 'NO' }),
  t('P', 'Clave Material Peligroso', 'mercancia.clave_material_peligroso', true, { defecto: 'N/A' }),
];

export const LAYOUT_NORMAL: LayoutPlantilla = {
  nombre: 'normal',
  version: 1,
  provisional: true,
  hojas: [
    {
      hoja: 'RemintenteDestinatario',
      celdas: [
        c('C7', 'ctx.clienteInterno', true),
        c('C8', 'folio_cliente', false),
        ...bloque('origen', 11),
        ...bloque('destino', 29),
        c('C45', 'contacto_destino_nombre', false),
        c('C46', 'contacto_destino_telefono', false),
        c('C47', 'contacto_destino_correo', false),
      ],
      tablas: [{ id: 'destinos', multi: true, filaEncabezado: 49, primeraFila: 50, maxFilas: 4, columnas: COLUMNAS_DESTINOS }],
    },
    { hoja: 'Mercancias', celdas: [], tablas: [{ id: 'mercancias', filaEncabezado: 21, primeraFila: 22, maxFilas: 100, columnas: COLUMNAS_MERCANCIAS }] },
    { hoja: 'Error', celdas: [], tablas: [] },
  ],
};

/**
 * Plantilla «nueva» (varias razones sociales): PROVISIONAL y NO VERIFICADA. Misma estructura que la normal más las hojas
 * `Origenes` y `Destinos` vacías. Qué columnas llevan esas hojas y cuándo se usa esta plantilla en vez de la normal lo
 * define el cliente con la plantilla en blanco (bloqueo B-2); hasta entonces solo sirve para descargar con aviso.
 */
const PENDIENTE_NUEVA = 'pendiente de especificación (B-2)';
export const LAYOUT_NUEVA: LayoutPlantilla = {
  ...LAYOUT_NORMAL,
  nombre: 'nueva',
  verificada: false,
  nota: `Hojas Origenes y Destinos ${PENDIENTE_NUEVA}.`,
  hojas: [
    ...LAYOUT_NORMAL.hojas,
    { hoja: 'Origenes', celdas: [], tablas: [] },
    { hoja: 'Destinos', celdas: [], tablas: [] },
  ],
};

/** El layout de cada plantilla. */
export function layoutDe(plantilla: 'normal' | 'nueva'): LayoutPlantilla {
  return plantilla === 'nueva' ? LAYOUT_NUEVA : LAYOUT_NORMAL;
}

/** Un layout con `verificada:false` no se usa para enviar al TMS, solo para descargar. */
export const layoutPuedeEnviarse = (l: LayoutPlantilla): boolean => l.verificada !== false;

/** Coordenadas que el layout declara: celdas fijas + encabezados + primera fila de cada tabla. */
export function coordenadasLayout(l: LayoutPlantilla): string[] {
  const out: string[] = [];
  for (const h of l.hojas) {
    for (const e of h.celdas) out.push(`${h.hoja}!${e.celda}`);
    for (const tb of h.tablas) for (const col of tb.columnas) {
      out.push(`${h.hoja}!${col.columna}${tb.filaEncabezado}`, `${h.hoja}!${col.columna}${tb.primeraFila}`);
    }
  }
  return out;
}
