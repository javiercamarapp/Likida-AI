// ═══════════════════════════════════════════════════════════════════════════
// CATÁLOGOS SAT — SOLO LO QUE SE PUEDE AFIRMAR DESDE AQUÍ.
//
// Los catálogos completos del complemento (c_ClaveProdServCP ≈ miles de claves,
// c_CodigoPostal ≈ 150 mil filas, c_TipoEmbalaje, c_FraccionArancelaria) NO están
// embebidos en el repo: cambian con cada versión del SAT y el PAC los valida al
// timbrar. Lo que hay aquí es:
//
//   · el catálogo COMPLETO de c_Estado (32 entidades, son pocas y no cambian);
//   · un SUBCONJUNTO de c_ClaveUnidad: las claves de uso común en autotransporte
//     (las que cada flota ve a diario) y los alias con que los clientes las
//     escriben. Una clave fuera del subconjunto NO se rechaza: se avisa «no
//     está en el subconjunto local, confírmala» y el campo (que es crítico) exige
//     confirmación humana si además viene con baja confianza;
//   · la relación PREFIJO DE CÓDIGO POSTAL → ESTADO (los dos primeros dígitos).
//     Es una aproximación: sirve para cazar un CP mal leído (OCR) o un estado
//     tecleado en la columna equivocada, NO para certificar domicilios. Una
//     discrepancia pide confirmar, no bloquea.
//
// Si un día se cargan los catálogos completos, este es el único archivo que cambia.
// ═══════════════════════════════════════════════════════════════════════════

export interface EstadoSat { codigo: string; nombre: string; alias: string[] }

/** c_Estado de México (el catálogo del complemento usa claves de 3 letras). */
export const ESTADOS_SAT: ReadonlyArray<EstadoSat> = [
  { codigo: 'AGU', nombre: 'Aguascalientes', alias: ['ags', 'ags.'] },
  { codigo: 'BCN', nombre: 'Baja California', alias: ['bc', 'b.c.', 'baja california norte'] },
  { codigo: 'BCS', nombre: 'Baja California Sur', alias: ['bcs', 'b.c.s.'] },
  { codigo: 'CAM', nombre: 'Campeche', alias: ['camp', 'camp.'] },
  { codigo: 'CHP', nombre: 'Chiapas', alias: ['chis', 'chis.'] },
  { codigo: 'CHH', nombre: 'Chihuahua', alias: ['chih', 'chih.'] },
  { codigo: 'COA', nombre: 'Coahuila', alias: ['coah', 'coah.', 'coahuila de zaragoza'] },
  { codigo: 'COL', nombre: 'Colima', alias: ['col', 'col.'] },
  { codigo: 'CMX', nombre: 'Ciudad de México', alias: ['cdmx', 'cd mx', 'cd. mx', 'cd. de mexico', 'ciudad de mexico', 'df', 'd.f.', 'distrito federal'] },
  { codigo: 'DUR', nombre: 'Durango', alias: ['dgo', 'dgo.'] },
  { codigo: 'GUA', nombre: 'Guanajuato', alias: ['gto', 'gto.'] },
  { codigo: 'GRO', nombre: 'Guerrero', alias: ['gro', 'gro.'] },
  { codigo: 'HID', nombre: 'Hidalgo', alias: ['hgo', 'hgo.'] },
  { codigo: 'JAL', nombre: 'Jalisco', alias: ['jal', 'jal.'] },
  { codigo: 'MEX', nombre: 'Estado de México', alias: ['edomex', 'edo mex', 'edo. mex.', 'edo. de mexico', 'estado de mexico', 'mex', 'mex.', 'mexico'] },
  { codigo: 'MIC', nombre: 'Michoacán', alias: ['mich', 'mich.', 'michoacan de ocampo'] },
  { codigo: 'MOR', nombre: 'Morelos', alias: ['mor', 'mor.'] },
  { codigo: 'NAY', nombre: 'Nayarit', alias: ['nay', 'nay.'] },
  { codigo: 'NLE', nombre: 'Nuevo León', alias: ['nl', 'n.l.', 'nvo leon', 'nvo. leon'] },
  { codigo: 'OAX', nombre: 'Oaxaca', alias: ['oax', 'oax.'] },
  { codigo: 'PUE', nombre: 'Puebla', alias: ['pue', 'pue.'] },
  { codigo: 'QUE', nombre: 'Querétaro', alias: ['qro', 'qro.', 'queretaro de arteaga'] },
  { codigo: 'ROO', nombre: 'Quintana Roo', alias: ['q roo', 'q. roo', 'q.roo', 'qroo'] },
  { codigo: 'SLP', nombre: 'San Luis Potosí', alias: ['s.l.p.', 'slp.'] },
  { codigo: 'SIN', nombre: 'Sinaloa', alias: ['sin', 'sin.'] },
  { codigo: 'SON', nombre: 'Sonora', alias: ['son', 'son.'] },
  { codigo: 'TAB', nombre: 'Tabasco', alias: ['tab', 'tab.'] },
  { codigo: 'TAM', nombre: 'Tamaulipas', alias: ['tamps', 'tamps.', 'tam', 'tam.'] },
  { codigo: 'TLA', nombre: 'Tlaxcala', alias: ['tlax', 'tlax.'] },
  { codigo: 'VER', nombre: 'Veracruz', alias: ['ver', 'ver.', 'veracruz de ignacio de la llave'] },
  { codigo: 'YUC', nombre: 'Yucatán', alias: ['yuc', 'yuc.'] },
  { codigo: 'ZAC', nombre: 'Zacatecas', alias: ['zac', 'zac.'] },
];

export const CODIGOS_ESTADO: ReadonlySet<string> = new Set(ESTADOS_SAT.map((e) => e.codigo));

/** Quita acentos, puntuación sobrante y mayúsculas, para comparar nombres. */
export function llaveTexto(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

const POR_LLAVE = new Map<string, string>();
for (const e of ESTADOS_SAT) {
  POR_LLAVE.set(llaveTexto(e.codigo), e.codigo);
  POR_LLAVE.set(llaveTexto(e.nombre), e.codigo);
  for (const a of e.alias) POR_LLAVE.set(llaveTexto(a), e.codigo);
}

/** «Jal.», «JALISCO», «jal» → `JAL`. `null` si no se reconoce (no se adivina). */
export function codigoEstado(texto: string): string | null {
  const l = llaveTexto(texto).replace(/[.,]+$/g, '');
  // «mexico» a secas es ambiguo (país, ciudad, estado): se resuelve como Estado de
  // México SOLO porque el texto viene de la columna «estado»; el validador lo avisa.
  return POR_LLAVE.get(l) ?? POR_LLAVE.get(`${l}.`) ?? null;
}

/** Rangos de los dos primeros dígitos del CP por entidad (aproximación documentada arriba). */
const PREFIJOS_CP: ReadonlyArray<[number, number, string]> = [
  [1, 16, 'CMX'], [20, 20, 'AGU'], [21, 22, 'BCN'], [23, 23, 'BCS'], [24, 24, 'CAM'],
  [25, 27, 'COA'], [28, 28, 'COL'], [29, 30, 'CHP'], [31, 33, 'CHH'], [34, 35, 'DUR'],
  [36, 38, 'GUA'], [39, 41, 'GRO'], [42, 43, 'HID'], [44, 49, 'JAL'], [50, 57, 'MEX'],
  [58, 61, 'MIC'], [62, 62, 'MOR'], [63, 63, 'NAY'], [64, 67, 'NLE'], [68, 71, 'OAX'],
  [72, 75, 'PUE'], [76, 76, 'QUE'], [77, 77, 'ROO'], [78, 79, 'SLP'], [80, 82, 'SIN'],
  [83, 85, 'SON'], [86, 86, 'TAB'], [87, 89, 'TAM'], [90, 90, 'TLA'], [91, 96, 'VER'],
  [97, 97, 'YUC'], [98, 99, 'ZAC'],
];

/** El estado que le corresponde al CP por su prefijo, o `null` si el prefijo no existe (p. ej. 00xxx, 17-19). */
export function estadoDeCp(cp: string): string | null {
  if (!/^\d{5}$/.test(cp)) return null;
  const p = Number(cp.slice(0, 2));
  for (const [d, h, e] of PREFIJOS_CP) if (p >= d && p <= h) return e;
  return null;
}

export interface UnidadSat { clave: string; nombre: string }

/** Subconjunto de c_ClaveUnidad de uso común en autotransporte. */
export const UNIDADES_SAT: ReadonlyArray<UnidadSat> = [
  { clave: 'KGM', nombre: 'Kilogramo' },
  { clave: 'GRM', nombre: 'Gramo' },
  { clave: 'TNE', nombre: 'Tonelada' },
  { clave: 'LBR', nombre: 'Libra' },
  { clave: 'H87', nombre: 'Pieza' },
  { clave: 'XBX', nombre: 'Caja' },
  { clave: 'XPK', nombre: 'Paquete' },
  { clave: 'LTR', nombre: 'Litro' },
  { clave: 'MTR', nombre: 'Metro' },
  { clave: 'MTK', nombre: 'Metro cuadrado' },
  { clave: 'MTQ', nombre: 'Metro cúbico' },
];
export const CLAVES_UNIDAD: ReadonlySet<string> = new Set(UNIDADES_SAT.map((u) => u.clave));

/** Cómo escriben los clientes la unidad → clave del catálogo. Solo lo inequívoco. */
const ALIAS_UNIDAD: Record<string, string> = {
  kg: 'KGM', kgs: 'KGM', kilo: 'KGM', kilos: 'KGM', kilogramo: 'KGM', kilogramos: 'KGM', kgm: 'KGM',
  g: 'GRM', gr: 'GRM', grs: 'GRM', gramo: 'GRM', gramos: 'GRM', grm: 'GRM',
  ton: 'TNE', tons: 'TNE', tonelada: 'TNE', toneladas: 'TNE', tne: 'TNE', t: 'TNE', 'ton.': 'TNE', 'ton. met.': 'TNE',
  lb: 'LBR', lbs: 'LBR', libra: 'LBR', libras: 'LBR', lbr: 'LBR',
  pza: 'H87', pzas: 'H87', pz: 'H87', pzs: 'H87', pieza: 'H87', piezas: 'H87', unidad: 'H87', unidades: 'H87', h87: 'H87',
  caja: 'XBX', cajas: 'XBX', cja: 'XBX', cjas: 'XBX', xbx: 'XBX',
  paquete: 'XPK', paquetes: 'XPK', pqt: 'XPK', xpk: 'XPK',
  l: 'LTR', lt: 'LTR', lts: 'LTR', litro: 'LTR', litros: 'LTR', ltr: 'LTR',
  m: 'MTR', mt: 'MTR', mts: 'MTR', metro: 'MTR', metros: 'MTR', mtr: 'MTR',
  m2: 'MTK', mtk: 'MTK', 'metro cuadrado': 'MTK', 'metros cuadrados': 'MTK',
  m3: 'MTQ', mtq: 'MTQ', 'metro cubico': 'MTQ', 'metros cubicos': 'MTQ',
};

/** «Kg», «TONELADAS», «pza» → clave SAT; `null` si no es inequívoco (no se adivina). */
export function claveUnidadDeTexto(texto: string): string | null {
  const l = llaveTexto(texto).replace(/\.+$/g, '');
  return ALIAS_UNIDAD[l] ?? ALIAS_UNIDAD[`${l}.`] ?? null;
}

/** Factores a kilogramos de las unidades de peso que un cliente puede usar. */
export const FACTOR_A_KG: Readonly<Record<string, number>> = { KGM: 1, GRM: 0.001, TNE: 1000, LBR: 0.45359237 };
