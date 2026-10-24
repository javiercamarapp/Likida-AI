import { describe, expect, it } from 'vitest';
import { direccionDeRemitente, remitenteReconocido } from './remitente';

describe('remitente (A37-A3-16 / A37-S31-09)', () => {
  it('el nombre visible con un correo NO cuenta: solo la dirección entre < >', () => {
    expect(direccionDeRemitente('"compras@permitido.test" <x@otro.test>')).toBe('x@otro.test');
    expect(remitenteReconocido('"compras@permitido.test" <x@otro.test>', ['compras@permitido.test'])).toBe(false);
    expect(remitenteReconocido('"a@permitido.test" <x@otro.test>', ['permitido.test'])).toBe(false);
  });
  it('sigue reconociendo las formas legítimas', () => {
    expect(remitenteReconocido('Ana <Ana@Permitido.test>', ['ana@permitido.test'])).toBe(true);
    expect(remitenteReconocido('ana@permitido.test', ['@permitido.test'])).toBe(true);
    expect(remitenteReconocido('Ana <ana@permitido.test>', ['permitido.test'])).toBe(true);
    expect(remitenteReconocido('x@otro.test', [])).toBeNull();
  });
  it('sin dirección inequívoca no se reconoce', () => {
    expect(direccionDeRemitente('Ana a@b.test c@d.test')).toBeNull();
    expect(direccionDeRemitente('sin correo')).toBeNull();
    expect(direccionDeRemitente(null)).toBeNull();
  });
});
