import { describe, expect, it } from 'vitest';
import { remitenteDeEncabezado, resolverClientePorRemitente } from './cliente_remitente';

const C = [
  { id: 'a', correo: 'Ana <ana@acme.example>; compras@acme.example' },
  { id: 'b', correo: 'luis@beta.example' },
  { id: 'c', correo: 'otro@gmail.com' },
  { id: 'd', correo: 'x@dup.example' },
  { id: 'e', correo: 'y@dup.example' },
];

describe('resolverClientePorRemitente', () => {
  it('correo exacto', () => expect(resolverClientePorRemitente('Ana Pérez <ANA@acme.example>', C)).toEqual({ clienteId: 'a', via: 'correo' }));
  it('dominio de un solo cliente', () => expect(resolverClientePorRemitente('nuevo@beta.example', C)).toEqual({ clienteId: 'b', via: 'dominio' }));
  it('dominio público nunca identifica', () => expect(resolverClientePorRemitente('rando@gmail.com', C)).toMatchObject({ clienteId: null, motivo: 'dominio_publico' }));
  it('correo exacto de un dominio público sí', () => expect(resolverClientePorRemitente('otro@gmail.com', C)).toEqual({ clienteId: 'c', via: 'correo' }));
  it('dominio compartido por dos clientes es ambiguo', () => expect(resolverClientePorRemitente('z@dup.example', C)).toMatchObject({ clienteId: null, motivo: 'ambiguo' }));
  it('sin remitente o desconocido', () => {
    expect(resolverClientePorRemitente('WhatsApp · Pau', C)).toMatchObject({ motivo: 'sin_remitente' });
    expect(resolverClientePorRemitente('q@nadie.example', C)).toMatchObject({ motivo: 'sin_coincidencia' });
  });
  it('lee el De: de un texto pegado', () => {
    expect(remitenteDeEncabezado('hola\nDe: Ana <ana@acme.example>\nAsunto: x')).toBe('ana@acme.example');
    expect(remitenteDeEncabezado('sin encabezado')).toBeNull();
  });
});
