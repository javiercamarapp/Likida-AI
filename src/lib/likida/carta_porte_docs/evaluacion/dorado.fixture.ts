// ═══════════════════════════════════════════════════════════════════════════
// CONJUNTO DORADO SINTÉTICO — 5 documentos con la FORMA de las 5 muestras recibidas.
//
// NO son las muestras: todo es inventado (empresas, RFC con dígito verificador válido de forma,
// folios, cifras). Lo único que se conserva es la forma que importa para el extractor:
//
//   M1  JSON estructurado (prefijos `S_`, `DatosAdicionales`, 2 mercancías, destino vacío).
//   M2  Excel = plantilla del TMS (3 hojas), con coma decimal y texto con unidad («812,35 km»).
//   M3  PDF con texto, español: 14 renglones de decimales y un total con PUNTO de miles.
//   M4  PDF con texto, INGLÉS: peso en LIBRAS y los datos fiscales en español dentro de «Notes».
//   M5  Excel de 2 pestañas = UN embarque (mismo delivery y caja), fecha mes/día (`MM/DD/AAAA`).
//
// La lectura del modelo la hace un doble DETERMINISTA (`llm_falso.fixture.ts`): lee lo que el documento
// dice, con la confianza y la evidencia literal que daría un buen modelo. Nunca llama a la red.
// ═══════════════════════════════════════════════════════════════════════════

import * as XLSX from 'xlsx';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { detectarFormato, prepararContenido, type ContenidoDoc } from '../contenido';
import { extraerDocumento, type EntradaLlm, type ResultadoExtraccion, type SalidaLlm } from '../extractor';
import { evaluarDivision } from '../multiembarque';
import { elegirPerfil, firmaDe, type Mapeo, type Perfil } from '../perfiles';
import { enriquecer, catalogoVacio, type CatalogoCliente, type ParteCat, type ProductoCat } from '../catalogo_cliente';
import type { Extraccion } from '../campos';
import { rfcValido } from '../documentos_sinteticos.fixture';
import { llmFalso, salida, type Fila, type Item } from '../llm_falso.fixture';
import type { LecturaVisionRemision, VisionRemision, CeldaVision } from '../lectores/remision';
import type { CampoEsperado } from './evaluar';

export type IdMuestra = 'M1' | 'M2' | 'M3' | 'M4' | 'M5';

// ── RFC sintéticos (forma y dígito válidos; no son de nadie) ────────────────
export const RFC_DORADO = {
  m1Remitente: rfcValido('FEJ100315XXX'), // grep-limpio:ok
  m2Remitente: rfcValido('FMJ110420XXX'), // grep-limpio:ok
  m3Remitente: rfcValido('PLF120815XXX'), // grep-limpio:ok
  m4Remitente: rfcValido('FEJ130920XXX'), // grep-limpio:ok
  m5Remitente: rfcValido('DSX140210XXX'), // grep-limpio:ok
  m5DestinatarioFisica: rfcValido('GOMA800515XXX'), // grep-limpio:ok
};

// ── Utilidades ──────────────────────────────────────────────────────────────

const enc = (o: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(o, null, 2));

function libro(hojas: Array<[string, string[][]]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [nombre, aoa] of hojas) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), nombre);
  return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
}

async function pdfDeLineas(lineas: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  lineas.forEach((l, i) => page.drawText(l.replace(/[^\x20-\x7e]/g, '?'), { x: 30, y: 815 - i * 16, size: 9, font: f }));
  return new Uint8Array(await doc.save());
}

/** Un valor leído con la evidencia literal (por omisión, el propio valor tal como está escrito). */
const L = (valor: string, conf = 0.97, evidencia: string | null = valor): Item => [valor, conf, evidencia];

// ═══════════════════════════════════════════════════════════════════════════
// M1 · JSON
// ═══════════════════════════════════════════════════════════════════════════

export const JSON_M1 = {
  folio: '740001', remitente: 'Fabricante Ejemplo SA de CV', cp: '66000',
  piezas: [52, 12], kilos: [9210, 3480],
} as const;

export function jsonM1(): Uint8Array {
  return enc({
    S_Version: '3.0',
    S_NombreRemitente: JSON_M1.remitente,
    S_RfcRemitente: RFC_DORADO.m1Remitente,
    S_CpRemitente: JSON_M1.cp,
    S_ResidenciaFiscal: 'Calle Ficticia 100, Parque Industrial Ejemplo',
    S_PaisDestino: '',
    DatosAdicionales: { NoEmbarque: JSON_M1.folio, Guia: 'GU-0001', Placa: 'PL4567', Piezas: 64, PesoTotal: 12690 },
    Mercancias: [
      { S_Descripcion: 'Estructura metálica tipo A', S_ClaveProdServ: '24112100', S_Cantidad: 52, S_ClaveUnidad: 'H87', S_PesoKg: 9210, S_Fraccion: '7308900100', S_Embalaje: 'Z01' }, // grep-limpio:ok
      { S_Descripcion: 'Estructura metálica tipo B', S_ClaveProdServ: '24112100', S_Cantidad: 12, S_ClaveUnidad: 'H87', S_PesoKg: 3480, S_Fraccion: '7308900100', S_Embalaje: 'Z01' }, // grep-limpio:ok
    ],
  });
}

const ruta = (campo: string, r: string, mercancia = false): Mapeo => ({ campo, mercancia, fuente: { tipo: 'ruta', ruta: r } });
export const MAPEOS_M1: Mapeo[] = [
  ruta('folio_cliente', 'DatosAdicionales.NoEmbarque'),
  ruta('origen_nombre', 'S_NombreRemitente'),
  ruta('origen_rfc', 'S_RfcRemitente'),
  ruta('origen_cp', 'S_CpRemitente'),
  ruta('origen_domicilio', 'S_ResidenciaFiscal'),
  ruta('peso_bruto_total', 'DatosAdicionales.PesoTotal'),
  ruta('descripcion', 'Mercancias[*].S_Descripcion', true),
  ruta('bienes_transp', 'Mercancias[*].S_ClaveProdServ', true),
  ruta('cantidad', 'Mercancias[*].S_Cantidad', true),
  ruta('clave_unidad', 'Mercancias[*].S_ClaveUnidad', true),
  ruta('peso_kg', 'Mercancias[*].S_PesoKg', true),
  ruta('fraccion_arancelaria', 'Mercancias[*].S_Fraccion', true),
  ruta('embalaje', 'Mercancias[*].S_Embalaje', true),
];

// ═══════════════════════════════════════════════════════════════════════════
// M2 · Excel con la forma de la plantilla del TMS (3 hojas)
// ═══════════════════════════════════════════════════════════════════════════

export const M2 = {
  remitente: 'Fabricante Maquila Ejemplo SA de CV', cp: '45000', destinatario: 'Receiver Ejemplo Inc', idFiscal: '58-1234567',
  distancia: '812,35 km', descripcion: 'Racks de red', clave: '43211500', cantidad: '18', unidad: 'H87', kilos: '13020', fraccion: '8471.50.01.00', embalaje: '5H4',
} as const;

export function excelM2(): Uint8Array {
  return libro([
    ['RemintenteDestinatario', [
      ['Datos del remitente'],
      ['Identificador de cliente (no cambiar)', 'CL-0001'],
      ['Load/Pro Number', ''],
      ['Nombre del remitente', M2.remitente],
      ['RFC del remitente', RFC_DORADO.m2Remitente],
      ['Codigo postal del remitente', M2.cp],
      ['Nombre del destinatario', M2.destinatario],
      ['ID fiscal del destinatario', M2.idFiscal],
      ['Distancia recorrida', M2.distancia],
    ]],
    ['Mercancias', [
      ['Descripcion', 'Clave producto', 'Cantidad', 'Clave unidad', 'Peso (kg)', 'Fraccion arancelaria', 'Embalaje', 'Valor'],
      [M2.descripcion, M2.clave, M2.cantidad, M2.unidad, M2.kilos, M2.fraccion, M2.embalaje, ''],
    ]],
    ['Error', [['Descripcion del error']]],
  ]);
}

export function guionM2(): (e: EntradaLlm) => SalidaLlm {
  return () => salida(1, {
    origen_nombre: L(M2.remitente),
    origen_rfc: L(RFC_DORADO.m2Remitente),
    origen_cp: L(M2.cp),
    destino_nombre: L(M2.destinatario),
    destino_rfc: L(M2.idFiscal, 0.9),
    distancia_km: L(M2.distancia, 0.95),
  }, [{
    descripcion: L(M2.descripcion), bienes_transp: L(M2.clave), cantidad: L(M2.cantidad, 0.97, `${M2.descripcion} | ${M2.clave} | ${M2.cantidad} | ${M2.unidad}`), clave_unidad: L(M2.unidad),
    peso_kg: L(M2.kilos), fraccion_arancelaria: L(M2.fraccion), embalaje: L(M2.embalaje),
  }]);
}

// ═══════════════════════════════════════════════════════════════════════════
// M3 · PDF en español: 14 renglones con decimales y un total con punto de miles
// ═══════════════════════════════════════════════════════════════════════════

const PIEZAS_M3 = [80, 70, 60, 60, 50, 50, 60, 70, 80, 60, 60, 70, 50, 60] as const; // suma 880
const KG_POR_PIEZA_M3 = 15.942;
const miles = (n: number): string => `${Math.floor(n / 1000)}.${String(n % 1000).padStart(3, '0')}`;

export const M3 = {
  remision: '7100000001', remitente: 'Planta Llantera Ficticia SA de CV', destinatario: 'Centro de Distribucion Ficticio LLC', // grep-limpio:ok
  fecha: '07/10/2026',
  renglones: PIEZAS_M3.map((p, i) => {
    const codigo = `LL-C${String(i + 1).padStart(2, '0')}`;
    const kg = (p * KG_POR_PIEZA_M3).toFixed(3);
    const vol = (p * 0.14469).toFixed(3);
    return { codigo, descripcion: `LLANTA RADIAL ${codigo} TL`, piezas: String(p), kg, linea: `${String(i + 1).padStart(2, '0')}   ${codigo}  LLANTA RADIAL ${codigo} TL   ${p} PZA   ${kg} KG   ${vol} M3` };
  }),
  totalKg: miles(Math.round(PIEZAS_M3.reduce((s, p) => s + p, 0) * KG_POR_PIEZA_M3)),
} as const;

export async function pdfM3(): Promise<Uint8Array> {
  const piezas = PIEZAS_M3.reduce((s, p) => s + p, 0);
  return pdfDeLineas([
    'REMISION DE EXPORTACION - MX Export',
    `Remision: ${M3.remision}`,
    `Fecha: ${M3.fecha}`,
    `Origen: ${M3.remitente}, Planta 1`,
    `Destino: ${M3.destinatario}, Fort Worth TX`,
    '',
    'No   Codigo   Descripcion   Cantidad   Peso bruto   Volumen',
    ...M3.renglones.map((r) => r.linea),
    `TOTAL   ${piezas} PZA   ${M3.totalKg} KG   127.325 M3`,
  ]);
}

export function guionM3(): (e: EntradaLlm) => SalidaLlm {
  const total = `TOTAL   880 PZA   ${M3.totalKg} KG   127.325 M3`;
  return () => salida(1, {
    folio_cliente: L(M3.remision, 0.97, `Remision: ${M3.remision}`),
    fecha_salida: L(M3.fecha, 0.95, `Fecha: ${M3.fecha}`),
    origen_nombre: L(M3.remitente, 0.97, `Origen: ${M3.remitente}`),
    destino_nombre: L(M3.destinatario, 0.97, `Destino: ${M3.destinatario}`),
    peso_bruto_total: L(M3.totalKg, 0.95, total),
  }, M3.renglones.map((r) => ({
    descripcion: L(r.descripcion, 0.97, r.linea), cantidad: L(r.piezas, 0.97, r.linea), clave_unidad: L('PZA', 0.97, r.linea), peso_kg: L(r.kg, 0.97, r.linea),
  })));
}

/** Catálogo sintético del cliente de M3: su remitente (con RFC) y los SKU de sus llantas. */
export const TENANT_DORADO = 'tttttttt-tttt-4ttt-8ttt-tttttttttttt';
export const CLIENTE_DORADO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

export function catalogoM3(): CatalogoCliente {
  const parte: ParteCat = {
    tenantId: TENANT_DORADO, clienteId: CLIENTE_DORADO, rol: 'remitente', alias: M3.remitente, razonSocial: M3.remitente, rfc: RFC_DORADO.m3Remitente,
    idFiscalExtranjero: null, calle: null, numExt: null, numInt: null, coloniaClave: null, colonia: null, cp: null, localidadClave: null, localidad: null,
    municipioClave: null, municipio: null, estado: null, pais: null, contacto: null, telefono: null, correo: null,
  };
  const productos: ProductoCat[] = M3.renglones.map((r) => ({
    tenantId: TENANT_DORADO, clienteId: CLIENTE_DORADO, sku: r.codigo, descripcionPatron: null, bienesTransp: '25172500', claveUnidad: 'H87', embalaje: '1A',
    fraccion: '4011100100', tipoMateria: '01', materialPeligroso: false, claveMaterialPeligroso: null, // grep-limpio:ok
  }));
  return { ...catalogoVacio(), partes: [parte], productos };
}

// ═══════════════════════════════════════════════════════════════════════════
// M4 · PDF en inglés (Bill of Lading): libras y datos fiscales en español dentro de «Notes»
// ═══════════════════════════════════════════════════════════════════════════

export const M4 = {
  bol: '310001-1', ship: '12-Oct-2026', delivery: '16-Oct-2026', shipper: 'Fabrica Ejemplo SA de CV', consignee: 'Receiver Example LLC',
  piezas: '26', descripcion: 'Plastic cases', libras: '14502', fraccion: '39231003 01',
} as const;

export const NOTAS_M4 = `Notes: RFC ${RFC_DORADO.m4Remitente} Fraccion ${M4.fraccion} Regimen EXD Unidad 20 Embalaje 1`;

export async function pdfM4(): Promise<Uint8Array> {
  return pdfDeLineas([
    'BILL OF LADING',
    `BOL #: ${M4.bol}`,
    `Ship Date: ${M4.ship}`,
    `Delivery Date: ${M4.delivery}`,
    `Shipper: ${M4.shipper}, Jalisco MX`,
    `Consignee: ${M4.consignee}, Laredo TX`,
    `Pieces: ${M4.piezas}`,
    `Description: ${M4.descripcion}`,
    `Weight: ${M4.libras} lb`,
    NOTAS_M4,
  ]);
}

/** Lo que lee el modelo; `conPesoUnidad:false` simula el error que se quiere vigilar (no avisar que el peso viene en libras). */
export function guionM4(op: { conPesoUnidad?: boolean } = {}): (e: EntradaLlm) => SalidaLlm {
  const conUnidad = op.conPesoUnidad ?? true;
  return () => {
    const merc: Fila = {
      descripcion: L(M4.descripcion, 0.97, `Description: ${M4.descripcion}`),
      bienes_transp: L('39231003', 0.75, NOTAS_M4),
      cantidad: L(M4.piezas, 0.97, `Pieces: ${M4.piezas}`),
      clave_unidad: L('20', 0.7, NOTAS_M4),
      peso_kg: L(M4.libras, 0.97, `Weight: ${M4.libras} lb`),
      fraccion_arancelaria: L(M4.fraccion, 0.75, NOTAS_M4),
      embalaje: L('1', 0.7, NOTAS_M4),
    };
    if (conUnidad) merc.peso_unidad = L('lb', 0.97, `Weight: ${M4.libras} lb`);
    return salida(1, {
      folio_cliente: L(M4.bol, 0.97, `BOL #: ${M4.bol}`),
      fecha_salida: L(M4.ship, 0.97, `Ship Date: ${M4.ship}`),
      origen_nombre: L(M4.shipper, 0.97, `Shipper: ${M4.shipper}`),
      origen_rfc: L(RFC_DORADO.m4Remitente, 0.7, NOTAS_M4),
      destino_nombre: L(M4.consignee, 0.97, `Consignee: ${M4.consignee}`),
    }, [merc]);
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// M5 · Excel de 2 pestañas, un solo embarque, fecha mes/día
// ═══════════════════════════════════════════════════════════════════════════

export const M5 = {
  delivery: 'DLV-8001', caja: 'CAJA-12', fecha: '10/14/2026', cpOrigen: '47750', cpDestino: '88000',
  productos: [
    { hoja: 'Producto A', descripcion: 'Producto sintetico tipo A', clave: '50202200', cantidad: '1200', unidad: 'XBX', kilos: '11120.5', fraccion: '2208900301', embalaje: 'XBX' }, // grep-limpio:ok
    { hoja: 'Producto B', descripcion: 'Producto sintetico tipo B', clave: '50202200', cantidad: '640', unidad: 'XBX', kilos: '6012.4', fraccion: '2208900300', embalaje: 'XBX' }, // grep-limpio:ok
  ],
} as const;

const ENC_M5 = ['Delivery', 'Caja', 'Fecha', 'RFC Remitente', 'CP Origen', 'RFC Destinatario', 'CP Destino', 'Producto', 'Clave SAT', 'Cantidad', 'Unidad', 'Peso (kg)', 'Fraccion', 'Embalaje'];

export function excelM5(): Uint8Array {
  return libro(M5.productos.map((p): [string, string[][]] => [p.hoja, [
    ENC_M5,
    [M5.delivery, M5.caja, M5.fecha, RFC_DORADO.m5Remitente, M5.cpOrigen, RFC_DORADO.m5DestinatarioFisica, M5.cpDestino, p.descripcion, p.clave, p.cantidad, p.unidad, p.kilos, p.fraccion, p.embalaje],
  ]]));
}

/** El perfil del cliente de M5 sabe leer sus identificadores y SU fecha (mes/día); las mercancías las lee el modelo de las dos pestañas. */
export function perfilM5(c: ContenidoDoc): Perfil {
  const col = (campo: string, encabezado: string, extra: Partial<Mapeo> = {}): Mapeo => ({ campo, mercancia: false, fuente: { tipo: 'columna', encabezado }, ...extra });
  return {
    id: 'dorado-m5', clave: 'dorado-m5', nombre: 'Cliente sintético M5', clienteId: null, formato: c.formato, firma: firmaDe(c), versionActiva: 1,
    activa: {
      version: 1, ejemplos: [],
      mapeos: [
        col('folio_cliente', 'Delivery'), col('fecha_salida', 'Fecha', { ordenFecha: 'mdy' }),
        col('origen_rfc', 'RFC Remitente'), col('destino_rfc', 'RFC Destinatario'),
      ],
    },
  };
}

export function guionM5(): (e: EntradaLlm) => SalidaLlm {
  return (e) => {
    if (!e.hojasMismoEmbarque || e.hojasMismoEmbarque.length !== 2) throw new Error('M5: el modelo debía recibir las 2 pestañas como UN embarque');
    return salida(1, {
      folio_cliente: L(M5.delivery), fecha_salida: L(M5.fecha),
      origen_rfc: L(RFC_DORADO.m5Remitente), origen_cp: L(M5.cpOrigen),
      destino_rfc: L(RFC_DORADO.m5DestinatarioFisica), destino_cp: L(M5.cpDestino),
    }, M5.productos.map((p) => ({
      descripcion: L(p.descripcion), bienes_transp: L(p.clave), cantidad: L(p.cantidad), clave_unidad: L(p.unidad),
      peso_kg: L(p.kilos), fraccion_arancelaria: L(p.fraccion), embalaje: L(p.embalaje),
    })));
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// El conjunto y el corredor
// ═══════════════════════════════════════════════════════════════════════════

export interface MuestraDorada {
  id: IdMuestra;
  forma: string;
  bytes: () => Promise<Uint8Array>;
  /** Perfiles del cliente (a partir del contenido, para que la firma sea la de ESTE documento). */
  perfiles?: (c: ContenidoDoc) => Perfil[];
  /** `true` = el módulo lee esta forma sin modelo (rama determinista). */
  sinModelo?: boolean;
  guion: () => (e: EntradaLlm) => SalidaLlm;
}

export const MUESTRAS: ReadonlyArray<MuestraDorada> = [
  {
    id: 'M1', forma: 'JSON estructurado', sinModelo: true, bytes: async () => jsonM1(),
    perfiles: (c) => [{ id: 'dorado-m1', clave: 'dorado-m1', nombre: 'Cliente sintético M1', clienteId: null, formato: c.formato, firma: firmaDe(c), versionActiva: 1, activa: { version: 1, mapeos: MAPEOS_M1, ejemplos: [] } }],
    // El destino viene vacío: lo único que puede pasar es que el modelo (no recibe nada que leer) no invente.
    guion: () => () => salida(1, {}),
  },
  { id: 'M2', forma: 'Excel plantilla del TMS', bytes: async () => excelM2(), guion: guionM2 },
  { id: 'M3', forma: 'PDF español, decimales y miles', bytes: pdfM3, guion: guionM3 },
  { id: 'M4', forma: 'PDF inglés, libras y Notes', bytes: pdfM4, guion: () => guionM4() },
  { id: 'M5', forma: 'Excel de 2 pestañas, fecha MM/DD', bytes: async () => excelM5(), perfiles: (c) => [perfilM5(c)], guion: guionM5 },
];

export interface OpcionesCorrida {
  /** No cargar el perfil del cliente (para vigilar lo que el perfil aporta). */
  sinPerfil?: boolean;
  catalogo?: CatalogoCliente;
  /** Sustituye la lectura del modelo (p. ej. para simular una regresión). */
  guion?: (e: EntradaLlm) => SalidaLlm;
}

export interface ResultadoCorrida {
  extraccion: Extraccion;
  extraido: ResultadoExtraccion;
  llamadasModelo: number;
  contenido: ContenidoDoc;
}

/** El mismo camino que el servicio: leer → ¿un embarque o varios? → perfil/modelo → catálogo. (La validación la hace `evaluar`.) */
export async function correrMuestra(m: MuestraDorada, op: OpcionesCorrida = {}): Promise<ResultadoCorrida> {
  const bytes = await m.bytes();
  const d = detectarFormato(bytes);
  if (!d.ok) throw new Error(`${m.id}: ${d.motivo}`);
  const contenido = await prepararContenido(bytes, d.clase);
  const perfiles = op.sinPerfil ? [] : (m.perfiles?.(contenido) ?? []);
  const div = evaluarDivision(contenido, elegirPerfil(perfiles, contenido, null, null).perfil);
  if (div.plan) throw new Error(`${m.id}: el documento sintético se partió en ${div.plan.embarques.length} embarques; debe ser UNO`);
  if (div.mismoEmbarque) contenido.hojasMismoEmbarque = div.mismoEmbarque.hojas;
  const llm = llmFalso((op.guion ?? m.guion())) ;
  const extraido = await extraerDocumento(contenido, { llm, perfiles, nivelMaximo: 1, marcador: () => 'dorado' });
  let extraccion = extraido.extraccion;
  if (op.catalogo) extraccion = enriquecer(extraccion, op.catalogo, { tenantId: TENANT_DORADO, clienteId: CLIENTE_DORADO }).extraccion;
  return { extraccion, extraido, llamadasModelo: llm.llamadas.length, contenido };
}

// ═══════════════════════════════════════════════════════════════════════════
// LOS TRES CASOS DE LOS LECTORES C, D y E (T-A3-60). Se leen SIN pasar por `extraerDocumento` genérico:
// cada formato tiene su lector (lectores/remision.ts, bol.ts, orden_agente.ts). Van aparte de MUESTRAS a propósito:
// M1–M5 miden el camino con modelo/perfil y su matriz está congelada; estos miden el camino por formato.
//
//   M6  Remisión ESCANEADA (formato C): PDF-imagen sin capa de texto, 14 renglones, la línea vertical sobre la columna de
//       claves (SKU truncado), el borde izquierdo recortado (cantidad del primer renglón cortada) y un TOTAL con punto de miles.
//   M7  Bill of Lading en INGLÉS (formato D): peso en libras con coma de miles y «Notes» fiscales en español.
//   M8  Orden de remisión de un AGENTE ADUANAL (formato E): pedimento `patente-consecutivo`, caja, placas, sello, peso con coma.
//
// Todo inventado: empresas, folios, placas, sellos, pedimentos y RFC con la forma y el dígito válidos, sin ser de nadie.
// ═══════════════════════════════════════════════════════════════════════════

export const RFC_LECTORES = {
  m7Notes: rfcValido('MEJ150610XXX'), // grep-limpio:ok
  m8Importador: rfcValido('CEJ160720XXX'), // grep-limpio:ok
};

// ── M6 · remisión escaneada ─────────────────────────────────────────────────

const PIEZAS_M6 = [120, 100, 90, 80, 80, 70, 60, 60, 50, 50, 40, 40, 30, 30] as const; // suma 900
const KG_POR_PIEZA_M6 = 7.771;
const M3_POR_PIEZA_M6 = 0.0912;

export const M6 = {
  remision: '88000002', fecha: '07/10/2026', remitente: 'Planta Neumaticos Ficticia SA de CV', destinatario: 'Distribuidora Ficticia LLC', ordenCompra: 'OC-5501',
  renglones: PIEZAS_M6.map((p, i) => {
    const clave = `NP-${String(i + 1).padStart(2, '0')}01`;
    const descripcion = `NEUMATICO CARGA ${String(i + 1).padStart(2, '0')}`;
    const kg = (p * KG_POR_PIEZA_M6).toFixed(3);
    const vol = (p * M3_POR_PIEZA_M6).toFixed(3);
    return { clave, descripcion, piezas: String(p), kg, vol, linea: `${String(i + 1).padStart(2, '0')} | ${p} PZA | ${clave} | ${descripcion} | ${kg} | ${vol}` };
  }),
  /** El total con PUNTO de miles junto a renglones con punto DECIMAL (suma real: 6 993.900 kg). */
  totalKg: '6.994',
  totalPiezas: '900',
  totalVol: '82.080',
} as const;

/** PDF-imagen SIN capa de texto: la remisión dibujada como imagen, con borde izquierdo recortado y una línea vertical sobre las claves. */
export async function pdfM6(): Promise<Uint8Array> {
  const sharp = (await import('sharp')).default;
  const filas = M6.renglones.map((r, i) => `<text x="-12" y="${110 + i * 26}" font-size="16" font-family="sans-serif">${r.linea.replace(/[<&]/g, ' ')}</text>`).join('');
  const png = await sharp(Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="white"/>'
    + `<text x="-8" y="40" font-size="22" font-family="sans-serif">REMISION ${M6.remision}</text>${filas}`
    + '<line x1="250" y1="0" x2="250" y2="600" stroke="black" stroke-width="3"/></svg>',
  )).png().toBuffer();
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const img = await doc.embedPng(png);
  page.drawImage(img, { x: 20, y: 400, width: 555, height: 370 });
  return new Uint8Array(await doc.save());
}

const C = (texto: string | null, confianza = 0.95, cortada = false): CeldaVision => ({ texto, confianza, ...(cortada ? { cortada: true } : {}) });

export interface OpcionesVisionM6 {
  /** Las claves de planta salen truncadas (la línea vertical las tapa). Por omisión sí: es la forma de la muestra. */
  claveCortada?: boolean;
  /** Reemplaza el texto del total de kg (p. ej. un total que NO cuadra). */
  totalKg?: string;
}

/** La visión FALSA determinista: devuelve lo que un buen modelo leería de M6, sin tocar la red ni mirar los píxeles. */
export function visionFalsaM6(op: OpcionesVisionM6 = {}): VisionRemision & { llamadas: number } {
  const claveCortada = op.claveCortada ?? true;
  const contador = { llamadas: 0 };
  const f = async (): Promise<LecturaVisionRemision> => {
    contador.llamadas++;
    return {
      encabezado: {
        remision: C(M6.remision, 0.97), fecha: C(M6.fecha, 0.95), orden_compra: C(M6.ordenCompra, 0.9),
        origen_nombre: C(M6.remitente, 0.95), destino_nombre: C(M6.destinatario, 0.95),
      },
      filas: M6.renglones.map((r, i) => ({
        // El recorte izquierdo se come parte de la cantidad del PRIMER renglón.
        cantidad: C(`${r.piezas} PZA`, 0.95, i === 0),
        clave: C(claveCortada ? r.clave.slice(0, 5) : r.clave, claveCortada ? 0.5 : 0.95, claveCortada),
        descripcion: C(r.descripcion, 0.95),
        peso_bruto: C(r.kg, 0.95),
        volumen: C(r.vol, 0.9),
        linea: r.linea,
      })),
      total: { cantidad: C(M6.totalPiezas, 0.95), peso_bruto: C(op.totalKg ?? M6.totalKg, 0.95), volumen: C(M6.totalVol, 0.9), linea: `TOTAL | ${M6.totalPiezas} PZA | ${op.totalKg ?? M6.totalKg} | ${M6.totalVol}` },
      columnasCortadas: claveCortada ? ['clave'] : [],
      notas: null,
    };
  };
  // El contador se lee en vivo (getter), no se copia: las pruebas miran `vision.llamadas` después de llamar.
  return Object.defineProperty(f, 'llamadas', { get: () => contador.llamadas, enumerable: true }) as unknown as VisionRemision & { llamadas: number };
}

/** Catálogo sintético del cliente de M6: sus claves de planta (las de 4 dígitos completas) con la clave SAT del producto. */
export function catalogoM6(): CatalogoCliente {
  const productos: ProductoCat[] = M6.renglones.map((r) => ({
    tenantId: TENANT_DORADO, clienteId: CLIENTE_DORADO, sku: r.clave, descripcionPatron: null, bienesTransp: '25172500', claveUnidad: 'H87', embalaje: '1A',
    fraccion: '4011200100', tipoMateria: '01', materialPeligroso: false, claveMaterialPeligroso: null, // grep-limpio:ok
  }));
  return { ...catalogoVacio(), productos };
}

// ── M7 · Bill of Lading en inglés ───────────────────────────────────────────

export const M7 = {
  bol: '420002-1', ship: '13-Oct-2026', delivery: '17-Oct-2026', shipper: 'Manufactura Ejemplo SA de CV', shipperDom: 'Nuevo Leon MX',
  consignee: 'Buyer Example Inc', consigneeDom: 'Dallas TX', piezas: '18', descripcion: 'Steel brackets', libras: '8,820', kilos: '4000.685', fraccion: '7326.90.99.00', claveSat: '24112100',
} as const;

export const NOTAS_M7 = `Notes: RFC ${RFC_LECTORES.m7Notes} Fraccion ${M7.fraccion} Regimen EXD Clave SAT ${M7.claveSat} Unidad 20 Embalaje 1`;

export async function pdfM7(): Promise<Uint8Array> {
  return pdfDeLineas([
    'BILL OF LADING',
    `BOL #: ${M7.bol}`,
    `Ship Date: ${M7.ship}`,
    `Delivery Date: ${M7.delivery}`,
    `Shipper: ${M7.shipper}, ${M7.shipperDom}`,
    `Consignee: ${M7.consignee}, ${M7.consigneeDom}`,
    'Carrier: Freight Example LLC',
    `Pieces: ${M7.piezas}`,
    `Description: ${M7.descripcion}`,
    `Weight (LBS): ${M7.libras}`,
    NOTAS_M7,
  ]);
}

// ── M8 · orden de remisión del agente aduanal ───────────────────────────────

export const M8 = {
  control: '5500123', origen: 'Laredo TX', remitente: 'Proveedor Ejemplo Inc', importador: 'Comercializadora Ejemplo SA de CV', caja: 'TRL-4412', placas: '12AB3C', sello: 'A1234567',
  pedimento: '3456-7890123', instrucciones: 'DESTINO PLANTA SALTILLO',
  renglones: [
    { ref: 'LFH-01', cantidad: '120', clase: 'CARTONES', contenido: 'Juguetes de plastico', kg: '6,577.50' },
    { ref: 'LFH-02', cantidad: '45', clase: 'TARIMAS', contenido: 'Piezas metalicas', kg: '2,010.00' },
  ],
} as const;

export async function pdfM8(): Promise<Uint8Array> {
  return pdfDeLineas([
    'ORDEN DE REMISION - AGENTE ADUANAL',
    `CONTROL No.: ${M8.control}`,
    `ORIGEN: ${M8.origen}`,
    `REMITENTE: ${M8.remitente}`,
    `IMPORTADOR: ${M8.importador}  RFC: ${RFC_LECTORES.m8Importador}`,
    `CAJA NO.: ${M8.caja}`,
    `PLACAS: ${M8.placas}`,
    `SELLO: ${M8.sello}`,
    '',
    'REF   CANTIDAD   CLASE   CONTENIDO   PEDIMENTO   PESO(KG)',
    ...M8.renglones.map((r) => `${r.ref}   ${r.cantidad}   ${r.clase}   ${r.contenido}   ${M8.pedimento}   ${r.kg}`),
    '',
    `INSTRUCCIONES: ${M8.instrucciones}`,
  ]);
}

// ── Las matrices esperadas de los tres casos ────────────────────────────────

const ok = (campo: string, valor: string): CampoEsperado => ({ campo, valor, estado: 'ok' });
const rev = (campo: string, valor: string): CampoEsperado => ({ campo, valor, estado: 'revisar' });
const falta = (campo: string, valor: string | null = null): CampoEsperado => ({ campo, valor, estado: 'falta' });
const m0 = (clave: string): string => `mercancias[0].${clave}`;

export type IdCasoLector = 'M6' | 'M7' | 'M8';

/**
 * ✔ lo que el documento escribe y el lector deja pasar; ◐ lo que se convirtió o se leyó con duda; ✗ lo que el documento no trae
 * (queda vacío para T-A3-62: régimen, cliente, distancia, claves SAT, tramo mexicano). Los valores esperados son los que traería
 * el CCP verdadero.
 */
export const MATRIZ_LECTORES: Readonly<Record<IdCasoLector, ReadonlyArray<CampoEsperado>>> = Object.freeze({
  M6: [
    ok('folio_cliente', M6.remision),
    rev('fecha_salida', '2026-10-07'), // 07/10/2026: día/mes o mes/día, el documento no lo dice
    falta('origen_rfc'),
    falta('destino_rfc'),
    falta('distancia_km'),
    rev('peso_bruto_total', '6994'), // «6.994» con punto de MILES: se resuelve solo porque cuadra con la suma de renglones (6 993.9 kg)
    falta(m0('bienes_transp'), '25172500'), // la clave de planta no es del SAT: la pone el catálogo (T-A3-62)
    ok(m0('descripcion'), 'NEUMATICO CARGA 01'),
    rev(m0('cantidad'), '120'), // el recorte izquierdo se come parte de la cantidad del primer renglón
    rev(m0('clave_unidad'), 'H87'), // «PZA» traducido a H87, con la misma confianza de la celda cortada
    ok(m0('peso_kg'), '932.52'),
    falta(m0('fraccion_arancelaria'), '4011200100'), // grep-limpio:ok
    falta(m0('embalaje'), '1A'),
    falta(m0('valor_mercancia')),
    ok('n_mercancias', '14'),
  ],
  M7: [
    ok('folio_cliente', M7.bol),
    ok('fecha_salida', '2026-10-13'),
    ok('fecha_llegada', '2026-10-17'),
    rev('origen_rfc', RFC_LECTORES.m7Notes), // en «Notes»: es de un fiscal, no se da por del remitente
    falta('destino_rfc'),
    falta('distancia_km'),
    ok('peso_bruto_total', M7.kilos), // suma de renglones YA convertidos a kg
    rev(m0('bienes_transp'), M7.claveSat), // «Clave SAT» en Notes: de segunda mano
    ok(m0('descripcion'), M7.descripcion),
    ok(m0('cantidad'), M7.piezas),
    falta(m0('clave_unidad'), 'H87'), // la unidad «20» no es una clave del SAT: queda como texto
    rev(m0('peso_kg'), M7.kilos), // 8 820 lb × 0.45359237
    rev(m0('fraccion_arancelaria'), '7326909900'), // grep-limpio:ok
    rev(m0('embalaje'), '1'),
    rev(m0('regimen_aduanero'), 'EXD'),
    falta(m0('valor_mercancia')),
    ok('n_mercancias', '1'),
  ],
  M8: [
    ok('folio_cliente', M8.control),
    ok('caja_numero', M8.caja),
    ok('unidad_placas', M8.placas),
    falta('origen_rfc'),
    falta('destino_rfc'),
    falta('distancia_km'),
    ok('peso_bruto_total', '8587.5'), // suma de renglones (la coma de miles queda demostrada por «6,577.50»)
    falta(m0('bienes_transp')),
    ok(m0('descripcion'), 'Juguetes de plastico'),
    ok(m0('cantidad'), '120'),
    falta(m0('clave_unidad')),
    rev(m0('peso_kg'), '6577.5'), // «6,577.50»: coma de miles
    rev(m0('pedimento'), M8.pedimento), // patente-consecutivo: faltan año y aduana
    ok(m0('rfc_importador'), RFC_LECTORES.m8Importador),
    falta(m0('regimen_aduanero')), // IMPO → IMD lo infiere T-A3-62
    falta(m0('valor_mercancia')),
    ok('n_mercancias', '2'),
  ],
});
