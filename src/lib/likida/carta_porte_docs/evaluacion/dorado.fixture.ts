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
