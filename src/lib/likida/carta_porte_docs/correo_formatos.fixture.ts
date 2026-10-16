// Correos y capturas SINTÉTICOS con la FORMA de las tres variantes reales (F1 tabla, F2 «Datos para CP:», F3 bloque de rótulos),
// con todos los nombres, cifras, domicilios y referencias INVENTADOS. Nada de las muestras reales se copia aquí.
import { createHash } from 'node:crypto';
import { RFC } from './documentos_sinteticos.fixture';

const BOTON = 'Resumir este correo electrónico';

/** F1: tabla de dos columnas con título «DATOS DE LA MERCANCÍA»; rótulos engañosos; asunto con DN/TRL y botón de resumen. */
export const textoF1 = (): string => [
  `[EXTERNAL] DN 70000001 TRL 90001 - EJEMPLO     ${BOTON}`,
  '',
  'DATOS DE LA MERCANCÍA | 90001',
  'Peso total bruto | 12000.500',
  'Descripción del bien transportado | RESINA SINTETICA DE PRUEBA',
  'Clave unidad de producto SAT | 13111999',
  'Clave de embalaje | 4G',
  'Cantidad Embalaje | 20',
  'Peso por embalaje | 11800.000',
  'Clave unidad de peso | KGM',
  'Fracción Arancelaria | 3907.99.99 00',
  'Pedimento | 26 24 1234 1234567',
].join('\n');

/** F2: «Datos para CP:» con el domicilio en líneas sueltas y la carga en líneas sin rótulo (EXPO: sin número de pedimento). */
export const textoF2 = (): string => [
  `LFH 9000001 CI / Empresa Ficticia / 900002     ${BOTON}`,
  '',
  'Datos para CP:',
  'Lugar de origen:',
  'PARQUE INDUSTRIAL DE PRUEBA',
  'Manufacturas Ficticias del Bajío, S.A. de C.V.',
  'Calle Inventada # 31',
  'Zapopan, Jalisco 45200',
  `RFC: ${RFC.boreal}`,
  '',
  '194 piezas',
  '7,185.07   KGM',
  'Unidad de medida: H87',
  'Clave de producto 56111999 Muebles de prueba',
  'Fracción arancelaria: 9403.60.99.00',
  '',
  'Tipo de materia: 3 producto terminado',
  'Documento: 1 Pedimento',
  'Régimen aduanero: EXD',
].join('\n');

const ARRIBA_F3 = [
  'COMERCIALIZADORA DE PRUEBA SA DE CV',
  'CALLE FICTICIA 100',
  'COLONIA IMAGINARIA',
  'VILLA EJEMPLO,MICHOACÁN',
  'C.P. 59000',
  'Ant SR. PERSONA INVENTADA',
  'TEL 5555555555',
  '',
  'Caja 90077',
  '',
];
const BLOQUE_F3 = [
  'BIENES TRANSPORTADOS',
  'HERRAMIENTAS',
  '',
  'DESCRIPCIÓN BIENES TRANSPORTADOS',
  'HERRAMIENTAS 27111999',
  'CANTIDAD',
  '1175 CAJAS DE HERRAMIENTA',
  '',
  'CLAVE UNIDAD SAT',
  '(20) CAJA',
  'EMBALAJE CLABE SAT',
  '(20) CAJA',
  'DESCRIPCIÓN DEL EMBALAJE',
  'CARTONES',
  'PESO EN KILOS',
  '11385.75KILOS DE HERRAMIENTA',
  '',
  'FRACCIÓN ARANCELARIA',
];
/** F3 completo (con fracción) o CORTADO justo en el rótulo «FRACCIÓN ARANCELARIA», sin valor. */
export const textoF3 = (cortado = false): string => [...ARRIBA_F3, ...BLOQUE_F3, ...(cortado ? [] : ['8205.59.99.00'])].join('\n');

/** Un .eml mínimo (el cuerpo es el texto de la variante). */
export const emlDeCorreo = (cuerpo: string): string => [
  'From: Logística <logistica@cliente-ficticio.example>', 'To: cp-abc@mail.example', 'Subject: Datos de carga', 'Date: Fri, 16 Oct 2026 10:00:00 -0600',
  'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', cuerpo,
].join('\r\n');

/** Una captura PNG sintética: barra de asunto con el botón de resumen y el texto en líneas. El texto NO se lee por OCR en las pruebas. */
export async function capturaPng(texto: string, ancho: number, alto: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const esc = (t: string): string => t.replace(/[<>&"]/g, ' ');
  const lineas = texto.split('\n').map((l, i) => `<text x="12" y="${40 + i * 18}" font-size="14" font-family="sans-serif">${esc(l)}</text>`).join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}"><rect width="${ancho}" height="${alto}" fill="#fff"/><rect width="${ancho}" height="28" fill="#e8eef7"/>${lineas}</svg>`)).png().toBuffer();
}

/**
 * La visión falsa DETERMINISTA: devuelve el texto que corresponde a la captura (por la huella de la imagen ya reducida que le llega),
 * nunca llama a la red. Si no reconoce la imagen, devuelve texto vacío (una captura ilegible).
 */
export function transcriptorFalso(): { registrar: (dataUri: string, texto: string) => void; transcribir: (imagenes: string[]) => Promise<string>; llamadas: number } {
  const mapa = new Map<string, string>();
  const huella = (u: string): string => createHash('sha256').update(u).digest('hex');
  const t = {
    llamadas: 0,
    registrar: (u: string, texto: string): void => { mapa.set(huella(u), texto); },
    transcribir: async (imagenes: string[]): Promise<string> => { t.llamadas++; return mapa.get(huella(imagenes[0])) ?? ''; },
  };
  return t;
}
