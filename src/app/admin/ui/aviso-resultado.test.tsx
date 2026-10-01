import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AvisoResultado, leerResultado } from './aviso-resultado';

// El aviso de resultado es UNO para todo el panel: tiene que aceptar las tres
// formas de resultado que los server actions ya devuelven, para que migrar una
// pantalla sea cambiar el import y no la acción.

describe('leerResultado — las tres formas de resultado de los server actions', () => {
  it('{ ok: true, mensaje } y { ok: false, error }', () => {
    expect(leerResultado({ ok: true, mensaje: 'Guardado.' })).toEqual({ tono: 'ok', texto: 'Guardado.' });
    expect(leerResultado({ ok: false, error: 'Ese teléfono ya existe.' })).toEqual({ tono: 'error', texto: 'Ese teléfono ya existe.' });
  });

  it('{ ok: string } y { error: string } (admin/ui/forma.tsx)', () => {
    expect(leerResultado({ ok: 'Listo.' })).toEqual({ tono: 'ok', texto: 'Listo.' });
    expect(leerResultado({ error: 'Falló.' })).toEqual({ tono: 'error', texto: 'Falló.' });
  });

  it('{ ok: boolean, mensaje?, error? } (jornada)', () => {
    expect(leerResultado({ ok: true, mensaje: 'Corregido.' })).toEqual({ tono: 'ok', texto: 'Corregido.' });
    expect(leerResultado({ ok: false, error: 'Sin permiso.' })).toEqual({ tono: 'error', texto: 'Sin permiso.' });
  });

  it('sin enviar todavía, o un éxito sin mensaje, no enseña nada (callar, no inventar un «listo»)', () => {
    expect(leerResultado(null)).toBeNull();
    expect(leerResultado(undefined)).toBeNull();
    expect(leerResultado({ ok: true })).toBeNull();
    expect(leerResultado({ ok: '' })).toBeNull();
  });

  it('un fallo sin texto NO se calla: sale un mensaje genérico en rojo', () => {
    expect(leerResultado({ ok: false } as never)).toEqual({ tono: 'error', texto: 'No se pudo completar la acción.' });
  });

  it('si trae error Y ok, gana el error (nunca un éxito encima de un rechazo)', () => {
    expect(leerResultado({ ok: true, error: 'Rechazado.' })).toEqual({ tono: 'error', texto: 'Rechazado.' });
  });
});

describe('AvisoResultado — el HTML', () => {
  it('el error es role="alert" y el texto sale VERBATIM, escapado', () => {
    const html = renderToStaticMarkup(<AvisoResultado estado={{ ok: false, error: 'Ya existe «Patio <Norte>».' }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Ya existe «Patio &lt;Norte&gt;».');
    expect(html).not.toContain('<Norte>');
  });

  it('el éxito es role="status", con ícono decorativo (aria-hidden): nunca color solo', () => {
    const html = renderToStaticMarkup(<AvisoResultado estado={{ ok: true, mensaje: 'Operador actualizado.' }} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('Operador actualizado.');
  });

  it('sin resultado no pinta nada', () => {
    expect(renderToStaticMarkup(<AvisoResultado estado={null} />)).toBe('');
  });

  it('la versión compacta lleva su propio tamaño y margen', () => {
    const html = renderToStaticMarkup(<AvisoResultado compacto estado={{ ok: true, mensaje: 'x' }} />);
    expect(html).toContain('text-[12px]');
    expect(html).toContain('mt-2');
  });
});
