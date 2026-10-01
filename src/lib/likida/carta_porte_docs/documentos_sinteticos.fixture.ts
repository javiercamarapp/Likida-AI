// ═══════════════════════════════════════════════════════════════════════════
// FIXTURES SINTÉTICOS de documentos de clientes grandes. NO son documentos reales
// (esos son un bloqueo externo): son tres clientes inventados, con RFC válidos de
// forma y dígito verificador, cada uno con SU formato. Sirven para probar el
// pipeline entero con bytes de verdad (PDF, PNG, XLSX, XML, EML).
// ═══════════════════════════════════════════════════════════════════════════

import * as XLSX from 'xlsx';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { rfcChecksumOk } from '../intake/cfdi';

const ALFABETO = '0123456789A';

/** Completa un RFC con su dígito verificador correcto (fuerza bruta sobre el último carácter). */
export function rfcValido(base: string): string {
  const sinDigito = base.toUpperCase().slice(0, base.length - 1);
  for (const c of ALFABETO) if (rfcChecksumOk(sinDigito + c)) return sinDigito + c;
  throw new Error(`no hay dígito para ${base}`);
}

// Los RFC de los tres clientes sintéticos y de sus destinatarios.
export const RFC = {
  atlas: rfcValido('DAT150312XXX'),
  boreal: rfcValido('GBO090704XXX'),
  golfo: rfcValido('CGO120921XXX'),
  destino1: rfcValido('CMO101215XXX'),
  destino2: rfcValido('SUP080530XXX'),
  operador: rfcValido('PEPJ850214XXX'),
};

export interface EmbarqueFixture {
  folio: string;
  fechaSalida: string; // dd/mm/yyyy
  origenNombre: string; origenRfc: string; origenCp: string; origenEstado: string;
  destinoNombre: string; destinoRfc: string; destinoCp: string; destinoEstado: string;
  producto: string; claveSat: string; cantidad: string; unidad: string; pesoKg: string;
  operador: string; placas: string;
}

export const EMBARQUE_ATLAS: EmbarqueFixture = {
  folio: 'ATL-20481', fechaSalida: '15/10/2026',
  origenNombre: 'Distribuidora Atlas SA de CV', origenRfc: RFC.atlas, origenCp: '44100', origenEstado: 'Jalisco',
  destinoNombre: 'Comercializadora Monterrey SA de CV', destinoRfc: RFC.destino1, destinoCp: '64000', destinoEstado: 'Nuevo León',
  producto: 'Botellas de vidrio vacías', claveSat: '24131500', cantidad: '1,200', unidad: 'Cajas', pesoKg: '8,400',
  operador: 'Juan Pérez López', placas: 'ABC1234',
};

export const ENCABEZADOS_ATLAS = [
  'Folio Embarque', 'Fecha Salida', 'Remitente', 'RFC Remitente', 'CP Origen', 'Estado Origen', 'Destinatario',
  'RFC Destinatario', 'CP Destino', 'Estado Destino', 'Producto', 'Clave SAT', 'Cantidad', 'Unidad', 'Peso (kg)', 'Operador', 'Placas',
];

export const filaAtlas = (e: EmbarqueFixture): string[] => [
  e.folio, e.fechaSalida, e.origenNombre, e.origenRfc, e.origenCp, e.origenEstado, e.destinoNombre, e.destinoRfc,
  e.destinoCp, e.destinoEstado, e.producto, e.claveSat, e.cantidad, e.unidad, e.pesoKg, e.operador, e.placas,
];

/** Excel de «Distribuidora Atlas»: un renglón de mercancía por fila, cabecera tras un título. */
export function excelAtlas(filas: string[][] = [filaAtlas(EMBARQUE_ATLAS)], opciones: { extras?: string[][] } = {}): Buffer {
  const aoa: string[][] = [['PLAN DE EMBARQUES — Distribuidora Atlas'], [], ENCABEZADOS_ATLAS, ...filas, ...(opciones.extras ?? [])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Embarques');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

export function csvAtlas(filas: string[][] = [filaAtlas(EMBARQUE_ATLAS)]): Buffer {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return Buffer.from([ENCABEZADOS_ATLAS, ...filas].map((f) => f.map(esc).join(',')).join('\n'), 'utf8');
}

/** PDF con texto de «Grupo Boreal»: formulario de etiquetas «Campo: valor». */
export async function pdfBoreal(opciones: { inyeccion?: string; folio?: string; pesoTotal?: string } = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const lineas = [
    'GRUPO BOREAL - ORDEN DE EMBARQUE',
    `Orden: ${opciones.folio ?? 'BOR-77120'}`,
    'Fecha de salida: 2026-10-16 08:30',
    `Remitente: Grupo Boreal SA de CV`,
    `RFC remitente: ${RFC.boreal}`,
    'CP origen: 66600',
    'Estado origen: NL',
    'Destinatario: Supermercados del Centro SA de CV',
    `RFC destinatario: ${RFC.destino2}`,
    'CP destino: 06600',
    'Estado destino: CDMX',
    'Mercancia: Alimentos enlatados',
    'Clave producto: 50202300',
    'Cantidad: 30',
    'Unidad: Toneladas',
    'Peso: 30 ton',
    `Peso total: ${opciones.pesoTotal ?? '30 ton'}`,
    'Operador: Maria Hernandez Soto',
    'Placas: XYZ9876',
  ];
  if (opciones.inyeccion) lineas.push(opciones.inyeccion);
  lineas.forEach((l, i) => page.drawText(l.replace(/[^\x20-\x7e]/g, '?'), { x: 40, y: 800 - i * 18, size: 11, font: f }));
  return Buffer.from(await doc.save());
}

/** PDF ESCANEADO: una página con una imagen y SIN capa de texto. */
export async function pdfEscaneado(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const png = await sharp(Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="white"/>'
    + '<text x="30" y="60" font-size="28" font-family="sans-serif">REMISION 5521 - Cementos del Golfo</text></svg>',
  )).png().toBuffer();
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const img = await doc.embedPng(png);
  page.drawImage(img, { x: 20, y: 400, width: 555, height: 416 });
  return Buffer.from(await doc.save());
}

/** «Foto» de una remisión (PNG renderizado de un SVG). */
export async function fotoRemision(texto = 'REMISION 5521 - Cementos del Golfo'): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp(Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#eee"/>'
    + `<text x="40" y="80" font-size="36" font-family="sans-serif">${texto.replace(/[<&]/g, ' ')}</text></svg>`,
  )).png().toBuffer();
}

/** CFDI de traslado con complemento Carta Porte 3.1, con todo lo crítico. */
export function xmlCartaPorte(over: Partial<{ cpOrigen: string; rfcDestino: string; peso: string; unidad: string }> = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:cartaporte31="http://www.sat.gob.mx/CartaPorte31" Version="4.0" Serie="T" Folio="9001" TipoDeComprobante="T">
  <cfdi:Complemento>
    <cartaporte31:CartaPorte Version="3.1" TranspInternac="No" TotalDistRec="920">
      <cartaporte31:Ubicaciones>
        <cartaporte31:Ubicacion TipoUbicacion="Origen" RFCRemitenteDestinatario="${RFC.golfo}" NombreRemitenteDestinatario="Cementos del Golfo SA de CV" FechaHoraSalidaLlegada="2026-10-17T06:00:00">
          <cartaporte31:Domicilio CodigoPostal="${over.cpOrigen ?? '91700'}" Estado="VER" Pais="MEX" Calle="Av. Industria" NumeroExterior="100"/>
        </cartaporte31:Ubicacion>
        <cartaporte31:Ubicacion TipoUbicacion="Destino" RFCRemitenteDestinatario="${over.rfcDestino ?? RFC.destino1}" NombreRemitenteDestinatario="Constructora Monterrey SA de CV" FechaHoraSalidaLlegada="2026-10-18T18:00:00" DistanciaRecorrida="920">
          <cartaporte31:Domicilio CodigoPostal="64000" Estado="NLE" Pais="MEX"/>
        </cartaporte31:Ubicacion>
      </cartaporte31:Ubicaciones>
      <cartaporte31:Mercancias PesoBrutoTotal="${over.peso ?? '24000'}" NumTotalMercancias="1">
        <cartaporte31:Mercancia BienesTransp="30111500" Descripcion="Cemento gris a granel" Cantidad="24" ClaveUnidad="${over.unidad ?? 'TNE'}" PesoEnKg="${over.peso ?? '24000'}" MaterialPeligroso="No"/>
        <cartaporte31:Autotransporte><cartaporte31:IdentificacionVehicular PlacaVM="GHI4567"/></cartaporte31:Autotransporte>
      </cartaporte31:Mercancias>
      <cartaporte31:FiguraTransporte>
        <cartaporte31:TiposFigura TipoFigura="01" RFCFigura="${RFC.operador}" NombreFigura="Pedro Pérez Jiménez" NumLicencia="LIC123456"/>
      </cartaporte31:FiguraTransporte>
    </cartaporte31:CartaPorte>
  </cfdi:Complemento>
</cfdi:Comprobante>`;
}

/** XML propio de un cliente (no es CFDI). */
export function xmlPropio(): string {
  return `<?xml version="1.0"?>
<Embarque folio="XP-300">
  <Origen><Nombre>Plásticos del Bajío SA de CV</Nombre><RFC>${rfcValido('PBA110225XXX')}</RFC><CP>37000</CP></Origen>
  <Destino><Nombre>Autopartes Norte SA de CV</Nombre><RFC>${rfcValido('ANO130618XXX')}</RFC><CP>25000</CP></Destino>
  <Carga><Item><Desc>Resina plástica</Desc><Clave>13111000</Clave><Cant>10</Cant><Uni>TNE</Uni><PesoKg>10000</PesoKg></Item></Carga>
</Embarque>`;
}

/** Cuerpo de un correo (texto plano) de «Cementos del Golfo». */
export function correoTexto(extra = ''): string {
  return [
    'Buen día,',
    '',
    'Les confirmo el embarque de mañana:',
    'Folio: CG-5521',
    'Salida: 17/10/2026 06:00',
    `Remitente: Cementos del Golfo SA de CV (RFC ${RFC.golfo}) CP 91700 Veracruz`,
    `Destinatario: Constructora Monterrey SA de CV (RFC ${RFC.destino1}) CP 64000 Nuevo León`,
    'Mercancía: Cemento gris a granel, clave 30111500, 24 toneladas, 24000 kg',
    'Operador: Pedro Pérez Jiménez, placas GHI4567',
    extra,
    '',
    'Saludos',
  ].join('\n');
}

export function emlConAsunto(cuerpo: string, de = 'logistica@cementosgolfo.example'): string {
  return [
    `From: Logística <${de}>`, 'To: cp-abc@mail.example', 'Subject: Embarque CG-5521', 'Date: Fri, 16 Oct 2026 10:00:00 -0600',
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', cuerpo,
  ].join('\r\n');
}

// ── Defectuosos ─────────────────────────────────────────────────────────────
export const defectuosos = {
  vacio: Buffer.alloc(0),
  pdfTruncado: async () => (await pdfBoreal()).subarray(0, 300),
  xlsxCorrupto: () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xl/workbook.xml'), Buffer.alloc(200, 7)]),
  ejecutable: Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(300, 1)]),
  binarioRaro: Buffer.alloc(400, 0),
  xmlMalFormado: Buffer.from('<?xml version="1.0"?><Embarque><Origen></Embarque>'),
  imagenCorrupta: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(100, 9)]),
};

// ── Constructores de Extracción para las pruebas ────────────────────────────
import type { CampoValor, Extraccion, Origen } from './campos';

export const cv = (valor: string | null, confianza = 0.95, origen: Origen = 'llm', evidencia: string | null = null): CampoValor => ({ valor, confianza, evidencia, origen });

/** Una extracción COMPLETA y válida (la de Atlas, ya normalizada). */
export function extraccionAtlasOk(origen: Origen = 'llm', confianza = 0.95): Extraccion {
  const c = (v: string) => cv(v, confianza, origen);
  return {
    campos: {
      folio_cliente: c('ATL-20481'), fecha_salida: c('2026-10-15'),
      origen_nombre: c('Distribuidora Atlas SA de CV'), origen_rfc: c(RFC.atlas), origen_cp: c('44100'), origen_estado: c('JAL'),
      destino_nombre: c('Comercializadora Monterrey SA de CV'), destino_rfc: c(RFC.destino1), destino_cp: c('64000'), destino_estado: c('NLE'),
      operador_nombre: c('Juan Pérez López'), unidad_placas: c('ABC1234'),
      peso_bruto_total: c('8400'),
    },
    mercancias: [{
      descripcion: c('Botellas de vidrio vacías'), bienes_transp: c('24131500'), cantidad: c('1200'), clave_unidad: c('XBX'),
      unidad_texto: c('Cajas'), peso_kg: c('8400'),
    }],
  };
}
