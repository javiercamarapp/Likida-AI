import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { datoInvalido, etiqueta, textoDeDato } = await import('./errores');
const { TELEFONO_NO_DISPONIBLE } = await import('./administracion');
const { MENSAJE_SIN_TELEFONO_NO_PERMITIDO } = await import('./operador_sin_telefono');
const { mensajeRechazoAbono } = await import('./facturacion_escritura');
const { mensajes: es } = await import('@/lib/i18n/es/mensajes');

describe('DatoInvalido migrado al diccionario (F15)', () => {
  it('el mensaje en español es el texto de siempre, con la etiqueta del campo ya resuelta', () => {
    const e = datoInvalido('adm.es_obligatorio', { campo: etiqueta('etq.el_subtotal') });
    expect(e.message).toBe('El subtotal es obligatorio.');
    expect(textoDeDato(e)).toBe('El subtotal es obligatorio.');
  });

  it('en inglés la etiqueta del campo también sale traducida (no español pegado en una frase en inglés)', () => {
    const e = datoInvalido('adm.es_obligatorio', { campo: etiqueta('etq.el_subtotal') });
    expect(textoDeDato(e, 'en')).toBe('The subtotal is required.');
  });

  it('las constantes de texto que siguen exportadas coinciden con su clave', () => {
    expect(TELEFONO_NO_DISPONIBLE).toBe(es['adm.telefono_no_disponible']);
    expect(MENSAJE_SIN_TELEFONO_NO_PERMITIDO).toBe(es['adm.sin_telefono_no_permitido']);
  });

  it('el rechazo de abono dice lo mismo en español y se traduce con sus montos', () => {
    expect(mensajeRechazoAbono('cancelada', 0, 10)).toBe('Esa factura está cancelada: no se le abonan pagos.');
    const e = datoInvalido('fac.abono_sobrepago', { monto: '$10.00', saldo: '$5.00' });
    expect(textoDeDato(e, 'en')).toContain('($10.00) exceeds the invoice balance ($5.00)');
  });
});
