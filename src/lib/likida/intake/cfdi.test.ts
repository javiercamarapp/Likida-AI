import { describe, it, expect } from 'vitest';
import { parseCfdiQr, esRfcValido, esUuidValido } from './cfdi';

describe('parseCfdiQr', () => {
  it('extrae uuid/rfc/total del QR del SAT', () => {
    const qr = 'https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=A1B2C3D4-E5F6-7890-ABCD-EF1234567890&re=AAA010101AAA&rr=BBB020202BB1&tt=1234.56&fe=abcdefgh';
    const r = parseCfdiQr(qr);
    expect(r.uuid).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890'); // lowercased
    expect(r.rfcEmisor).toBe('AAA010101AAA');
    expect(r.rfcReceptor).toBe('BBB020202BB1');
    expect(r.total).toBe(1234.56);
  });

  it('ignora un UUID malformado (no inventa)', () => {
    const r = parseCfdiQr('https://x?id=NO-ES-UUID&re=AAA010101AAA&tt=100');
    expect(r.uuid).toBeUndefined();
    expect(r.rfcEmisor).toBe('AAA010101AAA');
    expect(r.total).toBe(100);
  });

  it('devuelve vacío si el texto no es un QR de CFDI', () => {
    expect(parseCfdiQr('cualquier cosa')).toEqual({});
  });
});

describe('validadores fiscales', () => {
  it('valida RFC persona moral (12) y física (13)', () => {
    expect(esRfcValido('AAA010101AAA')).toBe(true);
    expect(esRfcValido('CAPJ850101XYZ')).toBe(true);
    expect(esRfcValido('MAL')).toBe(false);
  });
  it('valida formato UUID', () => {
    expect(esUuidValido('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
    expect(esUuidValido('123')).toBe(false);
  });
});
