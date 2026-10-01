import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProveedorNotificaciones, agregarNotificacion, duracionDe, MAX_NOTIFICACIONES, useNotificar } from './notificaciones';

// El sistema de toasts. La política de la cola vive en funciones puras (se
// prueba sin navegador) y el proveedor se prueba por lo que DEBE dejar servido:
// las dos regiones vivas, siempre montadas.

const n = (id: number, mensaje: string, tono: 'ok' | 'error' | 'aviso' | 'info' = 'ok') => ({ id, tono, mensaje });

describe('agregarNotificacion — la cola', () => {
  it('agrega al final', () => {
    expect(agregarNotificacion([n(1, 'a')], n(2, 'b')).map((x) => x.id)).toEqual([1, 2]);
  });

  it('el MISMO mensaje repetido no se apila: renueva el que ya estaba (queda al final, con el id nuevo)', () => {
    const cola = agregarNotificacion([n(1, 'Guardado'), n(2, 'otro')], n(3, 'Guardado'));
    expect(cola.map((x) => x.id)).toEqual([2, 3]);
  });

  it('el mismo texto con OTRO tono es otra notificación', () => {
    const cola = agregarNotificacion([n(1, 'Algo', 'ok')], n(2, 'Algo', 'error'));
    expect(cola).toHaveLength(2);
  });

  it(`nunca pasa de ${MAX_NOTIFICACIONES}: salen las más viejas`, () => {
    let cola: ReturnType<typeof agregarNotificacion> = [];
    for (let i = 1; i <= 10; i++) cola = agregarNotificacion(cola, n(i, `m${i}`));
    expect(cola).toHaveLength(MAX_NOTIFICACIONES);
    expect(cola.map((x) => x.id)).toEqual([7, 8, 9, 10]);
  });

  it('no muta la cola de entrada', () => {
    const cola = Object.freeze([n(1, 'a')]);
    expect(() => agregarNotificacion(cola, n(2, 'b'))).not.toThrow();
  });
});

describe('duracionDe — un error NO se va solo', () => {
  it('ok 5 s, info 6 s, aviso 9 s; error se queda hasta que lo cierren (WCAG 2.2.1)', () => {
    expect(duracionDe({ tono: 'ok', mensaje: 'x' })).toBe(5_000);
    expect(duracionDe({ tono: 'info', mensaje: 'x' })).toBe(6_000);
    expect(duracionDe({ tono: 'aviso', mensaje: 'x' })).toBe(9_000);
    expect(duracionDe({ tono: 'error', mensaje: 'x' })).toBeNull();
  });

  it('una duración explícita manda, incluida `null` para fijar un ok', () => {
    expect(duracionDe({ tono: 'ok', mensaje: 'x', duracionMs: 1_000 })).toBe(1_000);
    expect(duracionDe({ tono: 'ok', mensaje: 'x', duracionMs: null })).toBeNull();
  });
});

describe('ProveedorNotificaciones — lo servido', () => {
  it('monta las DOS regiones vivas siempre (un aria-live que aparece con su texto no se anuncia)', () => {
    const html = renderToStaticMarkup(<ProveedorNotificaciones><p>contenido</p></ProveedorNotificaciones>);
    expect(html).toContain('contenido');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it('el visor no intercepta clics de la página (pointer-events-none en el contenedor)', () => {
    const html = renderToStaticMarkup(<ProveedorNotificaciones>x</ProveedorNotificaciones>);
    expect(html).toContain('pointer-events-none');
  });
});

describe('useNotificar sin proveedor', () => {
  it('NO truena: notificar es un no-op (un aviso perdido es mejor que una pantalla caída)', () => {
    function Sonda() {
      const { notificar } = useNotificar();
      return <p>{String(notificar({ tono: 'ok', mensaje: 'x' }))}</p>;
    }
    expect(renderToStaticMarkup(<Sonda />)).toContain('-1');
  });
});
