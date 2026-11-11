import { describe, it, expect } from 'vitest';
import { casoDeEscalacion, hayDatoPersonal, redactarTexto, urlCasoExamen, claveDeEscalacion } from './casos-regresion';
import type { ItemEscalacion } from './escalaciones';

const item = (titulo: string, detalle: string | null = null): ItemEscalacion => ({
  fuente: 'liquidaciones', titulo, detalle, tenantNombre: 'Transportes Ficticios SA', desde: '2026-11-01T00:00:00Z', vence: null, href: null,
});

describe('redactarTexto', () => {
  it('quita RFC, teléfonos, correos, CURP, CLABE y UUID', () => {
    const { texto, reemplazos } = redactarTexto('RFC XAXX010101000, tel +52 55 1234 5678, correo juan@ej.com, CURP GOMC800101HDFRRL09, CLABE 012345678901234567, id 3f2a1b4c-1111-2222-3333-444455556666');
    expect(texto).not.toMatch(/XAXX|1234|juan@|GOMC|0123456789|3f2a1b4c/);
    expect(reemplazos).toBeGreaterThanOrEqual(5);
  });
  it('enmascara el nombre que sigue a una etiqueta de persona', () => {
    expect(redactarTexto('chofer: Juan Pérez López no comprobó').texto).toBe('chofer [NOMBRE] no comprobó');
  });
});

describe('casoDeEscalacion', () => {
  it('produce un caso sin datos personales, con flota seudónima y esperado por llenar', () => {
    const c = casoDeEscalacion(item('Gasto de chofer: Ana Ruiz Soto con RFC GOMC800101AB1', 'Llamar al 55 9876 5432'), { ahoraMs: Date.parse('2026-11-10T00:00:00Z') });
    const s = JSON.stringify(c);
    expect(s).not.toMatch(/Ana Ruiz|GOMC|9876|Ficticios/);
    expect(c.entrada.flota).toBe('FLOTA_A');
    expect(c.entrada.desde_dias_atras).toBe(9);
    expect(c.esperado.estado).toBe('por_llenar');
    expect(hayDatoPersonal(c)).toEqual([]);
  });
  it('el id es estable y la URL lleva solo fuente y clave, no contenido', () => {
    const a = item('X'); 
    expect(casoDeEscalacion(a, { ahoraMs: 1 }).id).toBe(casoDeEscalacion(a, { ahoraMs: 2 }).id);
    expect(urlCasoExamen(a)).toBe(`/api/admin/caso-examen?fuente=liquidaciones&clave=${claveDeEscalacion(a)}`);
  });
  it('si queda un dato con forma personal, falla cerrado', () => {
    expect(hayDatoPersonal({ x: 'correo a@b.co' })).toEqual(['CORREO']);
  });
});
