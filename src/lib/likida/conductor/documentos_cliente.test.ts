import { describe, it, expect } from 'vitest';
import {
  MAX_DOCUMENTOS_POR_CLIENTE, MAX_LARGO_NOMBRE_DOC, catalogoDeCliente, normalizarNombreDocumento, validarDocumento, type DocumentoCliente,
} from './documentos_cliente';

// T-A5-52 (R24): el catálogo de documentos por cliente. Todos los nombres son sintéticos.

const doc = (extra: Partial<DocumentoCliente> = {}): DocumentoCliente => ({
  id: 'd1', clienteId: 'c1', nombre: 'Documento demo A', tipo: 'basico', requiereFirma: true, requiereSello: false, ...extra,
});

describe('validarDocumento', () => {
  it('acepta un documento válido y normaliza el nombre (espacios simples, sin extremos)', () => {
    const r = validarDocumento({ clienteId: 'c1', nombre: '  Documento   demo  A ', tipo: 'complementario', requiereFirma: 'on', requiereSello: undefined });
    expect(r).toEqual({ ok: true, doc: { clienteId: 'c1', nombre: 'Documento demo A', tipo: 'complementario', requiereFirma: true, requiereSello: false } });
  });
  it('rechaza lo que falta o está fuera de dominio, con el motivo en palabras', () => {
    expect(validarDocumento({ clienteId: '', nombre: 'X', tipo: 'basico' })).toMatchObject({ ok: false, error: expect.stringMatching(/cliente/i) });
    expect(validarDocumento({ clienteId: 'c1', nombre: '   ', tipo: 'basico' })).toMatchObject({ ok: false, error: expect.stringMatching(/nombre/i) });
    expect(validarDocumento({ clienteId: 'c1', nombre: 'a'.repeat(MAX_LARGO_NOMBRE_DOC + 1), tipo: 'basico' })).toMatchObject({ ok: false, error: expect.stringMatching(/pasa de/) });
    expect(validarDocumento({ clienteId: 'c1', nombre: 'X', tipo: 'otro' })).toMatchObject({ ok: false, error: expect.stringMatching(/básico o complementario/i) });
    expect(validarDocumento({ clienteId: 'c1', nombre: 'X', tipo: undefined })).toMatchObject({ ok: false });
  });
  it('las casillas solo valen true con «on», «true» o true', () => {
    const r = (v: unknown) => (validarDocumento({ clienteId: 'c1', nombre: 'X', tipo: 'basico', requiereFirma: v, requiereSello: v }) as { ok: true; doc: DocumentoCliente }).doc.requiereFirma;
    expect([r('on'), r('true'), r(true), r('false'), r(''), r(null), r(0)]).toEqual([true, true, true, false, false, false, false]);
  });
  it('el tope por cliente es un número razonable', () => { expect(MAX_DOCUMENTOS_POR_CLIENTE).toBe(30); });
});

describe('normalizarNombreDocumento', () => {
  it('junta espacios y quita los extremos sin tocar mayúsculas ni acentos', () => {
    expect(normalizarNombreDocumento('  Ticket\t de   báscula  ')).toBe('Ticket de báscula');
  });
});

describe('catalogoDeCliente', () => {
  it('cliente sin catálogo: no usa catálogo (solo el comprobante de entrega de siempre)', () => {
    const r = catalogoDeCliente([doc({ clienteId: 'c2' })], 'c1');
    expect(r).toEqual({ usaCatalogo: false, basicos: [], complementarios: [] });
  });
  it('separa básicos y complementarios del cliente pedido, en orden de nombre, sin mezclar clientes', () => {
    const r = catalogoDeCliente([
      doc({ id: '1', nombre: 'Zeta', tipo: 'complementario' }), doc({ id: '2', nombre: 'Beta' }), doc({ id: '3', nombre: 'Alfa' }),
      doc({ id: '4', clienteId: 'c2', nombre: 'Ajeno' }),
    ], 'c1');
    expect(r.usaCatalogo).toBe(true);
    expect(r.basicos.map((d) => d.nombre)).toEqual(['Alfa', 'Beta']);
    expect(r.complementarios.map((d) => d.nombre)).toEqual(['Zeta']);
  });
  it('un cliente con solo complementarios sí usa catálogo (no hay básicos que exigir)', () => {
    expect(catalogoDeCliente([doc({ tipo: 'complementario' })], 'c1')).toMatchObject({ usaCatalogo: true, basicos: [] });
  });
});
