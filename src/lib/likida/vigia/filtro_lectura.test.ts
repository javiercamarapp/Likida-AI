import { describe, it, expect } from 'vitest';
import { prioridadDe, etiquetaDeLectura } from './prioridad';
import { normalizarLigaPortal, lineaLigaPortal, MAX_LIGA_PORTAL } from './respuestas_rapidas';
import { redactarBorrador, MAX_RESPUESTA, type EntradaRedaccion } from './redactor';
import { AHORA, estatus } from './datos.fixture';

const etiqueta = (t: string, ctx = {}) => etiquetaDeLectura(prioridadDe(t, ctx));

describe('etiquetaDeLectura (T-A4-47)', () => {
  it('agradecimientos y acuses: no requiere respuesta', () => {
    for (const t of ['gracias', 'Ok, enterado', 'Muchas gracias, perfecto', 'recibido']) expect(etiqueta(t)).toBe('no_requiere_respuesta');
  });
  it('monitoreo, stickers y mensajes vacíos: no requiere respuesta', () => {
    expect(etiqueta('UNIDAD C2-08 DETENIDA')).toBe('no_requiere_respuesta');
    expect(etiqueta('', { sticker: true })).toBe('no_requiere_respuesta');
    expect(etiqueta('   ')).toBe('no_requiere_respuesta');
  });
  it('preguntas y urgencias: escalar', () => {
    expect(etiqueta('¿Dónde está mi unidad?')).toBe('escalar');
    expect(etiqueta('necesito el comprobante ASAP')).toBe('escalar');
  });
  it('un mensaje normal o un adjunto sin texto: atender (ni ignorar ni escalar)', () => {
    expect(etiqueta('mañana paso a firmar')).toBe('atender');
    expect(etiqueta('', { adjunto: true })).toBe('atender');
  });
  it('«gracias» con una pregunta no se ignora', () => {
    expect(etiqueta('gracias, ¿y la caja?')).toBe('escalar');
  });
  it('no cambia la forma de Prioridad', () => {
    expect(Object.keys(prioridadDe('gracias')).sort()).toEqual(['motivos', 'nivel']);
  });
});

describe('liga al portal', () => {
  it('solo https válido, sin espacios ni credenciales', () => {
    expect(normalizarLigaPortal('  https://portal.ejemplo.test/seguimiento ')).toBe('https://portal.ejemplo.test/seguimiento');
    for (const mala of ['', '   ', null, undefined, 42, 'http://portal.ejemplo.test', 'javascript:alert(1)', 'portal.ejemplo.test', 'https://a b.test', 'https://u:p@portal.ejemplo.test', `https://x.test/${'a'.repeat(MAX_LIGA_PORTAL)}`]) {
      expect(normalizarLigaPortal(mala)).toBeNull();
    }
    expect(lineaLigaPortal(null)).toBe('');
  });
});

describe('liga al portal en «datos de la unidad»', () => {
  const LIGA = 'https://portal.ejemplo.test/seguimiento';
  const datos = { caja: 'CJ-100', placasCaja: 'ABC123', estadoCaja: 'cargada', unidad: 'C2-08', placasUnidad: 'XYZ789', operador: 'Operador Uno' };
  const base = (intencion: 'datos_unidad' | 'ubicacion', extra: Partial<EntradaRedaccion> = {}): EntradaRedaccion => ({
    clasificacion: { intencion, secundarias: [], senales: [] },
    nombreContacto: 'María Pérez', nombreFlota: 'Transportes del Norte',
    viaje: { tipo: 'uno', estatus: estatus(datos) }, ahora: AHORA, primerContacto: false, avisoPrivacidadUrl: null,
    ...extra,
  });

  it('con liga configurada se añade al final', () => {
    const b = redactarBorrador(base('datos_unidad', { ligaPortalUrl: LIGA }));
    expect(b.texto).toContain(LIGA);
    expect(b.texto.endsWith(LIGA)).toBe(true);
    expect(b.respaldo.ligaPortal).toBe(true);
    expect(b.riesgo).toBe('medio'); // sigue a aprobación humana
  });
  it('sin liga (ausente, vacía, nula o inválida) el texto es idéntico al de antes', () => {
    const sin = redactarBorrador(base('datos_unidad')).texto;
    for (const v of [null, '', '  ', 'http://inseguro.test']) {
      const b = redactarBorrador(base('datos_unidad', { ligaPortalUrl: v }));
      expect(b.texto).toBe(sin);
      expect(b.respaldo.ligaPortal).toBeUndefined();
    }
    expect(sin).not.toContain('portal');
  });
  it('otras intenciones no llevan la liga', () => {
    expect(redactarBorrador(base('ubicacion', { ligaPortalUrl: LIGA })).texto).not.toContain(LIGA);
  });
  it('con el pie de primer contacto, la liga va antes del pie y entera', () => {
    const b = redactarBorrador(base('datos_unidad', { ligaPortalUrl: LIGA, primerContacto: true, avisoPrivacidadUrl: 'https://x.test/privacidad' }));
    expect(b.texto.indexOf(LIGA)).toBeGreaterThan(-1);
    expect(b.texto.indexOf(LIGA)).toBeLessThan(b.texto.indexOf('BAJA'));
  });
  it('un cuerpo larguísimo se recorta pero la liga no se corta', () => {
    const largo = estatus({ ...datos, operador: 'O'.repeat(MAX_RESPUESTA * 2) });
    const b = redactarBorrador(base('datos_unidad', { ligaPortalUrl: LIGA, viaje: { tipo: 'uno', estatus: largo } }));
    expect(b.texto.endsWith(LIGA)).toBe(true);
    expect(b.texto.length).toBeLessThanOrEqual(MAX_RESPUESTA + lineaLigaPortal(LIGA).length);
  });
});
