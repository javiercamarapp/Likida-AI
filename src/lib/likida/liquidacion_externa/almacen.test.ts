import { describe, it, expect } from 'vitest';
import { rutaPdfExterno } from './almacen';

// La ruta del PDF está direccionada por CONTENIDO. Lo que se fija: la misma
// clave y el mismo contenido caen en la MISMA ruta (idempotente), el mismo folio
// con otro contenido cae en una DISTINTA (la perdedora de una carrera no puede
// pisarle el PDF a la ganadora), y una clave hostil no puede salirse de su
// carpeta de flota.

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

describe('rutaPdfExterno', () => {
  it('es determinista y vive bajo la carpeta de la flota', () => {
    const r = rutaPdfExterno('t-1', 'SAP-1', H1);
    expect(r).toBe(rutaPdfExterno('t-1', 'SAP-1', H1));
    expect(r.startsWith('t-1/externas/')).toBe(true);
  });

  it('mismo folio con OTRO contenido → otra ruta (no se pisan)', () => {
    expect(rutaPdfExterno('t-1', 'SAP-1', H1)).not.toBe(rutaPdfExterno('t-1', 'SAP-1', H2));
  });

  it('el mismo folio en OTRA flota → otra ruta', () => {
    expect(rutaPdfExterno('t-1', 'SAP-1', H1)).not.toBe(rutaPdfExterno('t-2', 'SAP-1', H1));
  });

  it('un folio distinto en la misma flota → otra ruta', () => {
    expect(rutaPdfExterno('t-1', 'SAP-1', H1)).not.toBe(rutaPdfExterno('t-1', 'SAP-2', H1));
  });

  it('una clave hostil no puede salirse de su carpeta: va hasheada, no en la ruta', () => {
    for (const k of ['../../t-2/secreto', '..\\..\\x', 'a/b/c', '%2e%2e/x', 'x'.repeat(5000)]) {
      const r = rutaPdfExterno('t-1', k, H1);
      expect(r).not.toContain('..');
      expect(r).toMatch(/^t-1\/externas\/[0-9a-f]{24}-[0-9a-f]{16}\.pdf$/);
    }
  });
});
