import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { DatoInvalido, datoInvalido, mensajeParaPantalla, textoDeDato } = await import('./errores');
const { validarPropuesta, montoTecleado } = await import('./portal_pago');
const { mensajes: es } = await import('@/lib/i18n/es/mensajes');

describe('DatoInvalido por clave', () => {
  it('el mensaje sigue siendo el texto en español (lo que ven las pruebas y los logs)', () => {
    const e = datoInvalido('pp.metodo_falta');
    expect(e).toBeInstanceOf(DatoInvalido);
    expect(e.message).toBe(es['pp.metodo_falta']);
    expect(textoDeDato(e)).toBe(es['pp.metodo_falta']);
  });

  it('se dice en inglés cuando se pide, con sus variables', () => {
    const e = datoInvalido('pp.referencia_larga', { max: 80 });
    expect(e.message).toBe('La referencia no puede pasar de 80 caracteres.');
    expect(textoDeDato(e, 'en')).toBe('The reference cannot be longer than 80 characters.');
  });

  it('un DatoInvalido de texto suelto (sin migrar) se muestra tal cual en cualquier idioma', () => {
    expect(textoDeDato(new DatoInvalido('Falta el nombre.'), 'en')).toBe('Falta el nombre.');
  });

  it('un idioma ajeno cae a español', () => {
    expect(textoDeDato(datoInvalido('pp.monto_cero'), 'fr')).toBe(es['pp.monto_cero']);
  });
});

describe('mensajeParaPantalla', () => {
  it('en español dice lo de siempre, con la operación', () => {
    expect(mensajeParaPantalla(new Error('pg: boom'), 'guardar el patio')).toBe(
      'No se pudo guardar el patio, y no es por lo que capturaste: es una falla del sistema y quedó registrada. Vuelve a intentarlo; si se repite, avísale a Likida.',
    );
  });
  it('en inglés no mezcla idiomas (la operación es una frase en español) y no filtra el error interno', () => {
    const t = mensajeParaPantalla(new Error('pg: relation "x" does not exist'), 'guardar el patio', 'en');
    expect(t).toContain('system failure');
    expect(t).not.toContain('patio');
    expect(t).not.toContain('relation');
  });
  it('un DatoInvalido con clave se traduce; los demás errores jamás se enseñan verbatim', () => {
    expect(mensajeParaPantalla(datoInvalido('pp.monto_cero'), 'x', 'en')).toBe('The amount must be greater than zero.');
    expect(mensajeParaPantalla(new Error('secreto interno'), 'x')).not.toContain('secreto');
  });
});

describe('portal de pago: la validación sale en el idioma pedido sin cambiar su lógica', () => {
  const ctx = { fechaFactura: '2026-10-01', saldo: 1000, hoy: '2026-10-20' };
  const ok = { fecha: '2026-10-10', monto: '500', referencia: 'ABC', metodo: 'transferencia' };

  it('acepta lo mismo que antes', () => {
    expect(validarPropuesta(ok, ctx).monto).toBe(500);
  });
  it('rechaza con el mismo texto en español y con su equivalente en inglés', () => {
    let err: unknown;
    try { validarPropuesta({ ...ok, monto: '5000' }, ctx); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(DatoInvalido);
    expect((err as Error).message).toContain('El saldo pendiente de esta factura es $1,000.00');
    expect(textoDeDato(err as InstanceType<typeof DatoInvalido>, 'en')).toContain('The outstanding balance of this invoice is $1,000.00');
  });
  it('el monto por omisión y el monto con nombre dicen cosas distintas', () => {
    expect(() => montoTecleado('')).toThrow('Escribe el monto que pagaste.');
    expect(() => montoTecleado('', 'el importe pagado del complemento')).toThrow('Escribe el importe pagado del complemento.');
  });
});
