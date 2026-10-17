// T-A3-53 — correos en texto y capturas: rótulos engañosos y captura incompleta.
// Todo sintético: textos inventados, dibujados en PNG con sharp; la «visión» es un doble determinista (devuelve lo que se dibujó).
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { detectarFormato, prepararContenido, type ContenidoDoc } from './contenido';
import { extraerDocumento } from './extractor';
import { llmFalso, salida } from './llm_falso.fixture';
import {
  AREA_MINIMA_PX, CONF_BAJA_RESOLUCION, MAPA_ROTULOS, cajaDelAsunto, esBajaResolucion, leerRotulosCorreo, lecturaConfiable, llaveRotulo,
} from './rotulos';
import { validarExtraccion } from './validacion';

// ── Las tres capturas sintéticas ────────────────────────────────────────────

const FILAS_A = Array.from({ length: 9 }, (_, i) => {
  const n = i + 1;
  return `Pieza de plastico ${n} | 2412150${n % 10} | ${10 * n} | 4G | 3926.90.99 | ${100 + n * 10}.5 | 26 47 1234 56700${String(n).padStart(2, '0')}`;
});

/** (a) Tabla «DATOS DE LA MERCANCÍA» de 9 filas con rótulos engañosos, barra de asunto y botón de resumen. */
export const TEXTO_A = [
  'Asunto: RV: DN 99120 TRL-77 LFH caja AB1234 entrega urgente',
  'Resumir este correo',
  '',
  'DATOS DE LA MERCANCÍA',
  'Descripción | Clave unidad de producto SAT | Cantidad Embalaje | Embalaje | Fracción arancelaria | Peso por embalaje | Pedimento',
  ...FILAS_A,
  'Total | | | | | 1,354.5 |',
].join('\n');

/** (b) Bloque «Datos para CP:» con tipo de materia, tipo de documento y régimen. */
export const TEXTO_B = [
  'Asunto: Datos para CP caja XY98765',
  'Responder',
  'Reenviar',
  '',
  'Datos para CP:',
  'Tipo de materia: 05',
  'Tipo de documento: A1',
  'Régimen: EXD',
  'Descripción: Cajas de carton corrugado',
  'Clave de producto: 24121500',
  'Cantidad: 40',
  'Clave unidad SAT: H87',
  'Peso en kilos: 1250',
  'Fracción arancelaria: 4819.10.01',
].join('\n');

/** (c) Bloque cortado justo en un rótulo sin valor (la fracción). */
export const TEXTO_C = [
  'Asunto: Datos de embarque caja KL4455',
  'Resumir este correo',
  '',
  'BIENES TRANSPORTADOS: 24121500 Tarimas de madera',
  'CLAVE UNIDAD SAT: (20) CAJA',
  'EMBALAJE: (20) cartones',
  'PESO POR EMBALAJE: 880',
  'FRACCIÓN ARANCELARIA:',
].join('\n');

const svg = (texto: string, ancho: number, alto: number): string => {
  const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const lineas = texto.split('\n').map((l, i) => `<text x="8" y="${18 + i * 16}" font-size="12" font-family="sans-serif">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}"><rect width="100%" height="100%" fill="white"/>${lineas}</svg>`;
};

/** Un PNG de verdad (con el texto inventado dibujado) a la resolución pedida. */
const png = (texto: string, ancho: number, alto: number): Promise<Buffer> => sharp(Buffer.from(svg(texto, ancho, alto))).png().toBuffer();

/** Visión falsa determinista: «lee» el texto que se dibujó. */
const visionFalsa = (texto: string) => async (_imagenes: string[]): Promise<string> => texto;

async function captura(texto: string, ancho: number, alto: number): Promise<ContenidoDoc> {
  const bytes = await png(texto, ancho, alto);
  const d = detectarFormato(bytes);
  if (!d.ok) throw new Error(d.motivo);
  return prepararContenido(bytes, d.clase);
}

const sinModelo = () => llmFalso(() => salida(1, {}, []));
const extraer = (c: ContenidoDoc, texto: string) => extraerDocumento(c, { llm: sinModelo(), transcribir: visionFalsa(texto), nivelMaximo: 1, marcador: () => 'm' });
const val = (c: Record<string, { valor: string | null }> | undefined, k: string): string | null | undefined => c?.[k]?.valor;

describe('el mapa de rótulos', () => {
  it('los tres rótulos engañosos apuntan al campo real y lo dicen', () => {
    expect(MAPA_ROTULOS[llaveRotulo('Clave unidad de producto SAT')]).toMatchObject({ clave: 'bienes_transp' });
    expect(MAPA_ROTULOS[llaveRotulo('Clave unidad de producto SAT')].enganoso).toMatch(/PRODUCTO/);
    expect(MAPA_ROTULOS[llaveRotulo('*Peso por embalaje:')]).toMatchObject({ clave: 'peso_kg', pesoTipo: 'por embalaje' });
    expect(MAPA_ROTULOS[llaveRotulo('CLAVE UNIDAD SAT')]).toMatchObject({ clave: 'clave_unidad' }); // el verdadero NO se confunde con el engañoso
  });
  it('la llave ignora acentos, mayúsculas, asteriscos y dos puntos', () => {
    expect(llaveRotulo('*FRACCIÓN  Arancelaria:')).toBe('fraccion arancelaria');
  });
  it('la caja sale del asunto aunque traiga referencias internas', () => {
    expect(cajaDelAsunto('RV: DN 99120 TRL-77 LFH caja AB1234 entrega')).toBe('AB1234');
    expect(cajaDelAsunto('Caja no. 53-AB urgente')).toBe('53-AB');
    expect(cajaDelAsunto('DN 99120 TRL-77 sin dato de caja aquí')).toBeNull();
  });
});

describe('(a) tabla «DATOS DE LA MERCANCÍA» de 9 filas, con rótulos engañosos', () => {
  it('extrae los campos correctos de las 9 filas y no confunde la clave de producto con la de unidad', async () => {
    const c = await captura(TEXTO_A, 820, 409);
    expect(c.formato).toBe('imagen');
    expect(c.resolucion).toEqual({ ancho: 820, alto: 409 });
    const r = await extraer(c, TEXTO_A);
    const m = r.extraccion.mercancias;
    expect(m).toHaveLength(9);
    expect(val(m[0], 'bienes_transp')).toBe('24121501');
    expect(val(m[0], 'clave_unidad')).toBeUndefined(); // «Clave unidad de producto SAT» NO es la unidad
    expect(val(m[0], 'cantidad')).toBe('10');
    expect(val(m[0], 'embalaje')).toBe('4G');
    expect(val(m[0], 'peso_kg')).toBe('110.5');
    expect(val(m[8], 'peso_kg')).toBe('190.5');
    expect(val(m[0], 'peso_tipo')).toBe('por embalaje');
    expect(m[0].peso_kg.notas?.join(' ')).toMatch(/engaña: es el peso NETO total/);
    expect(m[0].peso_kg.notas?.join(' ')).toMatch(/neto|embalaje/i); // y derivar anota que se usó como bruto
    expect(val(m[0], 'pedimento')).toBe('26 47 1234 5670001');
    expect(val(m[8], 'pedimento')).toBe('26 47 1234 5670009');
    expect(m[0].bienes_transp.notas?.join(' ')).toMatch(/engaña: es la clave de PRODUCTO/);
  });
  it('ignora la barra de asunto y el botón, toma la caja del asunto y no marca corte', async () => {
    const r = await extraer(await captura(TEXTO_A, 820, 409), TEXTO_A);
    expect(val(r.extraccion.campos, 'caja_numero')).toBe('AB1234');
    expect(r.extraccion.campos.caja_numero.origen).toBe('derivado');
    expect(r.capturaIncompleta).toBeNull();
    expect(r.avisos.join(' ')).toMatch(/Se ignoró la interfaz del correo/);
    // Ni «Resumir este correo» ni las referencias internas se volvieron datos.
    expect(JSON.stringify(r.extraccion)).not.toMatch(/Resumir|DN 99120|TRL-77/);
  });
  it('la fila de totales no es una mercancía y a 820×409 la confianza es normal', async () => {
    const r = await extraer(await captura(TEXTO_A, 820, 409), TEXTO_A);
    expect(r.extraccion.mercancias.some((f) => /total/i.test(f.descripcion?.valor ?? ''))).toBe(false);
    expect(r.extraccion.mercancias[0].bienes_transp.confianza).toBeGreaterThanOrEqual(0.85);
    expect(r.origen).toBe('llm');
  });
});

describe('(b) bloque «Datos para CP:» con tipo de materia, documento y régimen', () => {
  it('extrae tipo de materia, régimen y la mercancía; el tipo de documento se reconoce sin campo', async () => {
    const c = await captura(TEXTO_B, 763, 420);
    const r = await extraer(c, TEXTO_B);
    const m = r.extraccion.mercancias;
    expect(m).toHaveLength(1);
    expect(val(m[0], 'tipo_materia')).toBe('05');
    expect(val(m[0], 'regimen_aduanero')).toBe('EXD');
    expect(val(m[0], 'descripcion')).toBe('Cajas de carton corrugado');
    expect(val(m[0], 'bienes_transp')).toBe('24121500');
    expect(val(m[0], 'cantidad')).toBe('40');
    expect(val(m[0], 'clave_unidad')).toBe('H87');
    expect(val(m[0], 'peso_kg')).toBe('1250');
    expect(val(r.extraccion.campos, 'caja_numero')).toBe('XY98765');
    expect(r.capturaIncompleta).toBeNull();
    expect(JSON.stringify(r.extraccion)).not.toContain('A1');
  });
});

describe('(c) captura cortada en un rótulo final sin valor', () => {
  it('devuelve captura_incompleta con el último rótulo', async () => {
    const c = await captura(TEXTO_C, 337, 526);
    const r = await extraer(c, TEXTO_C);
    expect(r.capturaIncompleta).toEqual({ ultimoRotulo: 'FRACCIÓN ARANCELARIA' });
    expect(r.avisos.join(' ')).toMatch(/llegó cortada: termina en «FRACCIÓN ARANCELARIA»/);
    expect(val(r.extraccion.mercancias[0], 'fraccion_arancelaria')).toBeUndefined(); // no se inventa
  });
  it('la validación BLOQUEA por corte y no se puede aprobar', async () => {
    const r = await extraer(await captura(TEXTO_C, 337, 526), TEXTO_C);
    const v = validarExtraccion(r.extraccion, { capturaIncompleta: r.capturaIncompleta });
    const h = v.hallazgos.find((x) => x.codigo === 'captura_incompleta');
    expect(h).toMatchObject({ severidad: 'bloqueo', campo: 'documento', renglon: null });
    expect(h?.mensaje).toMatch(/FRACCIÓN ARANCELARIA/);
    expect(h?.mensaje).toMatch(/texto copiado|captura completa/);
    expect(v.listoParaAprobar).toBe(false);
    // Sin la bandera no hay hallazgo: no se inventa un corte donde no lo hay.
    expect(validarExtraccion(r.extraccion).hallazgos.some((x) => x.codigo === 'captura_incompleta')).toBe(false);
  });
  it('«(20) CAJA» es cantidad 20 de CAJA, no una clave; el embalaje con paréntesis es su descripción', async () => {
    const r = await extraer(await captura(TEXTO_C, 337, 526), TEXTO_C);
    const f = r.extraccion.mercancias[0];
    expect(val(f, 'cantidad')).toBe('20');
    expect(val(f, 'unidad_texto')).toBe('CAJA');
    expect(val(f, 'embalaje_descripcion')).toBe('cartones');
    expect(val(f, 'bienes_transp')).toBe('24121500');
    expect(val(f, 'descripcion')).toBe('Tarimas de madera');
    expect(val(f, 'peso_kg')).toBe('880');
    expect(r.avisos.join(' ')).toMatch(/«\(20\) CAJA».*cantidad 20/);
  });
  it('337×526 es baja resolución: toda la lectura queda con confianza baja y el aviso lo dice', async () => {
    const c = await captura(TEXTO_C, 337, 526);
    expect(esBajaResolucion(c.resolucion)).toBe(true);
    const r = await extraer(c, TEXTO_C);
    const f = r.extraccion.mercancias[0];
    for (const k of ['bienes_transp', 'peso_kg', 'cantidad']) expect(f[k].confianza, k).toBeLessThanOrEqual(CONF_BAJA_RESOLUCION);
    expect(r.avisos.join(' ')).toMatch(/baja resolución \(337×526 px\)/);
    // Y como son campos críticos con confianza < 0,85, la revisión pide confirmarlos.
    const v = validarExtraccion(r.extraccion);
    expect(v.hallazgos.some((x) => x.codigo === 'confianza_baja' && x.campo === 'bienes_transp')).toBe(true);
  });
});

describe('correo en TEXTO (sin imagen) y falsos positivos', () => {
  it('un correo pegado como texto se lee igual, sin transcribir nada', async () => {
    const bytes = Buffer.from(`From: ana@ejemplo.test\nSubject: Datos para CP\n\n${TEXTO_B.split('\n').slice(3).join('\n')}`);
    const d = detectarFormato(bytes);
    if (!d.ok) throw new Error(d.motivo);
    const c = await prepararContenido(bytes, d.clase);
    expect(c.formato).toBe('correo');
    const r = await extraerDocumento(c, { llm: sinModelo(), nivelMaximo: 1, marcador: () => 'm' });
    expect(val(r.extraccion.mercancias[0], 'tipo_materia')).toBe('05');
    expect(val(r.extraccion.mercancias[0], 'peso_kg')).toBe('1250');
  });
  it('un correo común con un «Cantidad: 10» suelto NO se toma por bloque de rótulos', () => {
    const l = leerRotulosCorreo('Hola, te mando lo de la semana.\nCantidad: 10\nSaludos');
    expect(lecturaConfiable(l)).toBe(false);
  });
  it('líneas «Rótulo: valor» sin la firma de un formato de correo conocido no se toman por captura (no pisan lo que ya funcionaba)', () => {
    const l = leerRotulosCorreo('Folio: EX-200\nMercancia: Piezas de plastico\nRégimen aduanero: EXD\nPedimento: 26 47 1234 5670001\nRFC importador: AAA010101AAA'); // grep-limpio:ok (RFC generico de relleno)
    expect(l?.firma).toBe(false);
    expect(lecturaConfiable(l)).toBe(false);
  });
  it('sin texto o sin rótulos devuelve null', () => {
    expect(leerRotulosCorreo(null)).toBeNull();
    expect(leerRotulosCorreo('   ')).toBeNull();
    expect(leerRotulosCorreo('Buen día, adjunto el archivo.')).toBeNull();
  });
  it('una imagen sin puerto de transcripción sigue el camino de siempre (el modelo la lee)', async () => {
    const c = await captura(TEXTO_B, 763, 420);
    const llm = llmFalso(() => salida(1, {}, [{ descripcion: ['Cajas', 0.97, null] }]));
    const r = await extraerDocumento(c, { llm, nivelMaximo: 1, marcador: () => 'm' });
    expect(llm.llamadas).toHaveLength(1);
    expect(r.capturaIncompleta).toBeNull();
    expect(val(r.extraccion.mercancias[0], 'tipo_materia')).toBeUndefined();
  });
  it('el corte a media fila de una tabla también se declara', () => {
    const t = ['DATOS DE LA MERCANCÍA', 'Descripción | Clave unidad de producto SAT | Peso por embalaje | Fracción arancelaria',
      'Pieza A | 24121500 | 10 | 3926.90.99', 'Pieza B | 24121500 | 20 | 3926.90.99', 'Pieza C | 24121500 | 30'].join('\n');
    const l = leerRotulosCorreo(t);
    expect(l?.capturaIncompleta).toEqual({ ultimoRotulo: 'Fracción arancelaria' });
  });
  it('el umbral de baja resolución es el documentado', () => {
    expect(AREA_MINIMA_PX).toBe(250_000);
    expect(esBajaResolucion({ ancho: 820, alto: 409 })).toBe(false);
    expect(esBajaResolucion({ ancho: 763, alto: 420 })).toBe(false);
    expect(esBajaResolucion({ ancho: 337, alto: 526 })).toBe(true);
    expect(esBajaResolucion(null)).toBe(false);
  });
});
