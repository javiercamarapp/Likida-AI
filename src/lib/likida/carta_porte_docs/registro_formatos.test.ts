// T-A3-59 · Registro de formatos de entrada y selección por firma. Todo sintético: la FORMA de cada formato, ningún valor real.
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { prepararContenido, type ContenidoDoc } from './contenido';
import { pdfEscaneado } from './documentos_sinteticos.fixture';
import {
  clasificarFormato, elegirFormato, FORMATOS_ENTRADA, MARGEN_AMBIGUEDAD, puntuarFormatos, REGISTRO, UMBRAL_RECONOCIMIENTO,
  type EntradaClasificacion, type FormatoEntrada,
} from './registro_formatos';

const enc = (t: string): Uint8Array => new TextEncoder().encode(t);

function libro(hojas: Record<string, string[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [nombre, filas] of Object.entries(hojas)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), nombre);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

const HOJAS_A = (): Record<string, string[][]> => ({
  RemintenteDestinatario: [['LLENA CLIENTE'], [''], [''], [''], ['*Regimen Aduanero', 'EXD'], ['Referencia', 'R-1']],
  Mercancias: [['Bienes Transportados', 'Cantidad'], ['Pieza sintetica', '3']],
  Error: [['Descripcion del error']],
});
const HOJAS_B = (): Record<string, string[][]> => ({
  Datos: [['Regimen', 'EXD']],
  Origenes: [['Id Origen', 'Nombre'], ['OR000001', 'Origen sintetico']],
  Destinos: [['Id Destino', 'Nombre'], ['DE000001', 'Destino sintetico']],
  Mercancias: [['Id Origen', 'Id Destino', 'Bienes'], ['OR000001', 'DE000001', 'Pieza sintetica']],
  'Guia de Llenado': [['Regla', 'Detalle'], ['1', 'Texto de guia']],
});

const doc = (formato: ContenidoDoc['formato'], texto: string | null, extra: Partial<ContenidoDoc> = {}): ContenidoDoc =>
  ({ formato, texto, imagenes: [], tabla: null, xml: null, avisos: [], ...extra });

const ENCABEZADO_C = 'REMISIÓN No. 000123\nCANTIDAD  CLAVE  DESCRIPCIÓN  PESO BRUTO  VOLUMEN';
const TEXTO_D = 'BILL OF LADING\nShipper: Ejemplo Inc\nConsignee: Ejemplo SA\nCarrier: Transportes Ejemplo\nPieces | Description | Weight (LBS) | HM\nNotes: Fraccion 7308.90.01 Regimen EXD';
const TEXTO_E = 'ORDEN DE REMISIÓN\nORIGEN: Patio ejemplo\nREMITENTE: Fabricante Ejemplo\nIMPORTADOR: Importadora Ejemplo\nCAJA NO.: CJ-0001\nPLACAS: 00AB000\nREF | CANTIDAD | CONTENIDO | PEDIMENTO | PESO\n1 | 10 | Pieza | 26-24-3001-6001234 | 1,200';
const TEXTO_F1 = 'Asunto: Embarque sintetico\nDATOS DE LA MERCANCÍA\nCantidad | Clave unidad de producto SAT | Peso por embalaje | Fracción | Embalaje\n3 | 24112100 | 120 | 7308900100 | Z01'; // grep-limpio:ok
const TEXTO_F2 = 'Buen día,\nDatos para CP:\nTipo de materia: 03\nTipo de documento: 01\nRégimen: EXD\nCaja: CJ-0002';
const TEXTO_F3 = 'BIENES TRANSPORTADOS: Pieza sintetica\nCLAVE UNIDAD SAT: H87\nEMBALAJE: Z01\nPESO EN KILOS: 120';

const jsonG = (): Record<string, unknown> => ({
  id: 'sintetico', Version: '3.0',
  Ruta: { Mercancias: { Mercancia: [{ S_Descripcion: 'Pieza A' }, { S_Descripcion: 'Pieza B' }] } },
  DocumentacionAduanera: { S_TipoDocumento: '01' },
});

/** Los 9 formatos, uno por fixture, con su contenido preparado como lo hace el servicio. */
async function fixtures(): Promise<Record<FormatoEntrada, EntradaClasificacion>> {
  return {
    A: { contenido: await prepararContenido(libro(HOJAS_A()), 'excel') },
    B: { contenido: await prepararContenido(libro(HOJAS_B()), 'excel') },
    C: { contenido: await prepararContenido(await pdfEscaneado(), 'pdf'), textoVision: ENCABEZADO_C },
    D: { contenido: doc('pdf_texto', TEXTO_D) },
    E: { contenido: doc('pdf_texto', TEXTO_E) },
    F1: { contenido: await prepararContenido(enc(TEXTO_F1), 'correo') },
    F2: { contenido: await prepararContenido(enc(TEXTO_F2), 'correo') },
    F3: { contenido: doc('imagen', null), textoVision: TEXTO_F3 },
    G: { contenido: await prepararContenido(enc(JSON.stringify(jsonG())), 'json') },
  };
}

describe('clasificación por firma: 9 de 9 formatos', () => {
  for (const f of FORMATOS_ENTRADA) {
    it(`el fixture del formato ${f} se clasifica como ${f}`, async () => {
      const fx = (await fixtures())[f];
      const r = clasificarFormato(fx);
      expect(r.formato).toBe(f);
      expect(r.origen).toBe('automatica');
      expect(r.requiereRevision).toBe(false);
      expect(r.puntajes[f]).toBeGreaterThanOrEqual(UMBRAL_RECONOCIMIENTO);
      expect(r.mejor?.formato).toBe(f);
      expect(r.lector).toBe(REGISTRO[f].lector);
    });
  }

  it('9 de 9 en una sola pasada y ningún otro formato supera al elegido por menos del margen', async () => {
    const fx = await fixtures();
    let bien = 0;
    for (const f of FORMATOS_ENTRADA) {
      const r = clasificarFormato(fx[f]);
      if (r.formato === f) bien++;
      expect((r.mejor?.puntaje ?? 0) - (r.segundo?.puntaje ?? 0)).toBeGreaterThanOrEqual(MARGEN_AMBIGUEDAD);
    }
    expect(bien).toBe(9);
  });

  it('A y B se distinguen por sus hojas, no por parecerse', async () => {
    const fx = await fixtures();
    expect(puntuarFormatos(fx.A).B).toBe(0);
    expect(puntuarFormatos(fx.B).A).toBe(0);
  });

  it('solo A y G tienen lector hoy: el resto sigue el flujo genérico y no puede enviarse al TMS', async () => {
    const fx = await fixtures();
    for (const f of FORMATOS_ENTRADA) {
      const r = clasificarFormato(fx[f]);
      const hay = f === 'A' || f === 'G';
      expect(r.lectorDisponible).toBe(hay);
      expect(r.puedeEnviarAlTms).toBe(hay);
      expect(r.flujoSugerido).toBe(hay ? 'lector_determinista' : 'generico_llm');
    }
  });
});

describe('casos ambiguos: a revisión humana, nunca se adivina', () => {
  it('un libro que mezcla hojas de la plantilla normal y de la nueva ⇒ formato no reconocido', async () => {
    const mezclado = await prepararContenido(libro({ ...HOJAS_A(), Datos: [['Regimen', 'EXD']], Origenes: [['x']], Destinos: [['y']] }), 'excel');
    const r = clasificarFormato({ contenido: mezclado });
    expect(r.formato).toBeNull();
    expect(r.requiereRevision).toBe(true);
    expect(r.lector).toBeNull();
    expect(r.puedeEnviarAlTms).toBe(false);
    expect(r.flujoSugerido).toBe('generico_llm');
    expect(r.motivo).toMatch(/no reconocido|ambiguo/i);
  });

  it('un texto desconocido ⇒ formato no reconocido', () => {
    const r = clasificarFormato({ contenido: doc('correo', 'Hola, ¿podrían confirmar la hora de salida de mañana? Gracias.') });
    expect(r.formato).toBeNull();
    expect(r.requiereRevision).toBe(true);
    expect(r.mejor?.puntaje ?? 0).toBeLessThan(UMBRAL_RECONOCIMIENTO);
    expect(r.puedeEnviarAlTms).toBe(false);
  });

  it('un empate entre dos firmas fuertes ⇒ ambiguo, sin elegir', () => {
    // El mismo correo trae el bloque F2 y los rótulos de F3 completos.
    const r = clasificarFormato({ contenido: doc('correo', `${TEXTO_F2}\n${TEXTO_F3}`) });
    expect(r.puntajes.F2).toBeGreaterThanOrEqual(UMBRAL_RECONOCIMIENTO);
    expect(r.puntajes.F3).toBeGreaterThanOrEqual(UMBRAL_RECONOCIMIENTO);
    expect(r.formato).toBeNull();
    expect(r.requiereRevision).toBe(true);
    expect(r.motivo).toMatch(/ambiguo/i);
  });

  it('un escaneado sin texto de visión no se reconoce: el formato solo no basta', async () => {
    const r = clasificarFormato({ contenido: await prepararContenido(await pdfEscaneado(), 'pdf') });
    expect(r.formato).toBeNull();
    expect(r.requiereRevision).toBe(true);
  });

  it('un JSON que no es el de plataforma ⇒ no reconocido (lo siguen resolviendo los perfiles por cliente)', async () => {
    const otro = await prepararContenido(enc(JSON.stringify({ Version: '2.0', Datos: { x: 1 } })), 'json');
    expect(clasificarFormato({ contenido: otro }).formato).toBeNull();
  });

  it('un JSON de versión 3 sin mercancías ni documentación no alcanza el umbral', async () => {
    const flaco = await prepararContenido(enc(JSON.stringify({ Version: '3.0', id: 'x' })), 'json');
    const r = clasificarFormato({ contenido: flaco });
    expect(r.puntajes.G).toBeLessThan(UMBRAL_RECONOCIMIENTO);
    expect(r.formato).toBeNull();
  });
});

describe('la elección manual se respeta', () => {
  it('sobre un documento no reconocido, la persona elige F2 ⇒ se usa F2, sin revisión pendiente', () => {
    const e = { contenido: doc('correo', 'Texto libre sin firma conocida.') };
    expect(clasificarFormato(e).formato).toBeNull();
    const r = elegirFormato(e, 'F2');
    expect(r.formato).toBe('F2');
    expect(r.origen).toBe('manual');
    expect(r.requiereRevision).toBe(false);
    expect(r.lector).toBe('correo_f2');
  });

  it('la persona puede contradecir a la firma: un fixture de A elegido como B queda como B', async () => {
    const fx = (await fixtures()).A;
    const r = elegirFormato(fx, 'B');
    expect(r.formato).toBe('B');
    expect(r.origen).toBe('manual');
    expect(r.motivo).toMatch(/firma automática decía A/);
    // los puntajes automáticos se conservan para mostrarlos en el visor
    expect(r.puntajes.A).toBeGreaterThanOrEqual(UMBRAL_RECONOCIMIENTO);
  });

  it('«generico» manda el documento al flujo con modelo y no habilita el TMS', async () => {
    const r = elegirFormato((await fixtures()).G, 'generico');
    expect(r.formato).toBeNull();
    expect(r.origen).toBe('manual');
    expect(r.flujoSugerido).toBe('generico_llm');
    expect(r.puedeEnviarAlTms).toBe(false);
  });

  it('sin elección manual devuelve la clasificación automática tal cual', async () => {
    const fx = (await fixtures()).D;
    expect(elegirFormato(fx)).toEqual(clasificarFormato(fx));
    expect(elegirFormato(fx, null)).toEqual(clasificarFormato(fx));
  });

  it('un formato inventado como elección manual se rechaza', async () => {
    const fx = (await fixtures()).D;
    expect(() => elegirFormato(fx, 'Z9' as never)).toThrow(/desconocido/i);
  });
});

describe('robustez', () => {
  it('es determinista: el mismo documento da el mismo resultado', async () => {
    const fx = (await fixtures()).E;
    expect(clasificarFormato(fx)).toEqual(clasificarFormato(fx));
  });

  it('un JSON con claves prohibidas no se lee por la cadena de prototipos', () => {
    const arbol = JSON.parse('{"__proto__":{"Version":"3.0"},"constructor":{"Ruta":1}}') as unknown;
    const r = clasificarFormato({ contenido: doc('json', null, { xml: arbol }) });
    expect(r.puntajes.G).toBe(0);
  });

  it('un documento vacío no se reconoce y no lanza', () => {
    const r = clasificarFormato({ contenido: doc('correo', '') });
    expect(r.formato).toBeNull();
    expect(r.requiereRevision).toBe(true);
  });
});
