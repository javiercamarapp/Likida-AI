import { describe, it, expect } from 'vitest';
import { rfcChecksumOk } from './cfdi';

// El último carácter del RFC es un dígito verificador calculado sobre los 12
// anteriores. Sirve justo para lo que nos falló en campo: el OCR leyó el RFC de
// Paquetexpress como PER / PEX / PTE en tres corridas del MISMO ticket, y las
// tres pasaron porque TIENEN FORMA de RFC válido. El dígito verificador no
// adivina el correcto, pero delata que está mal en vez de darlo por bueno.
describe('rfcChecksumOk', () => {
  // RFC reales, leídos de los comprobantes de campo del 27-jul-2026.
  it.each([
    ['PEC1411282LA', 'Operadora de Servicios Paquetexpress'],
    ['FGA091216EJ7', 'Fomento Gasolinero (La Gas)'],
    ['ODM950324V2A', 'Office Depot de México'],
    ['GMX0902279I1', 'G3M SA de CV (receptor)'],
  ])('acepta %s — %s', (rfc) => {
    expect(rfcChecksumOk(rfc)).toBe(true);
  });

  // Lecturas equivocadas del MISMO RFC, medidas en tres corridas. El regex no
  // caza ninguna; el dígito verificador caza estas dos.
  it.each(['PER1411282LA', 'PTE1411282LA'])('rechaza la lectura errónea %s', (rfc) => {
    expect(rfcChecksumOk(rfc)).toBe(false);
  });

  // COBERTURA PARCIAL, a propósito documentada: es aritmética módulo 11, así que
  // ~1 de cada 11 lecturas erróneas cae por casualidad en un dígito válido.
  // PEX1411282LA es una de ésas. O sea: el dígito verificador REDUCE el riesgo,
  // no lo elimina — no es sustituto de leer el RFC del QR o del XML.
  it('deja pasar ~1 de cada 11 errores: PEX1411282LA es uno', () => {
    expect(rfcChecksumOk('PEX1411282LA')).toBe(true);
  });

  it('acepta el RFC genérico del público en general', () => {
    expect(rfcChecksumOk('XAXX010101000')).toBe(true);
  });

  it('acepta el RFC genérico de residentes en el extranjero', () => {
    expect(rfcChecksumOk('XEXX010101000')).toBe(true);
  });

  it('no distingue mayúsculas', () => {
    expect(rfcChecksumOk('pec1411282la')).toBe(true);
  });

  it('rechaza longitudes que no son de RFC', () => {
    expect(rfcChecksumOk('PEC141128')).toBe(false);
    expect(rfcChecksumOk('')).toBe(false);
  });

  it('rechaza caracteres fuera del alfabeto del RFC', () => {
    expect(rfcChecksumOk('PE*1411282LA')).toBe(false);
  });
});
