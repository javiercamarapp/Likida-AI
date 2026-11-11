import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionInterruptores, type InterruptorParaUi } from './interruptores-ui';

// El kill switch se toca desde el teléfono en pleno incidente: esta prueba fija lo que SE VE al renderizar (estado, firma y la palanca
// correcta por fila) para que un rediseño no lo rompa en silencio. La interacción (motivo obligatorio) la cubre la prueba del control.
const accion = vi.fn(async () => null);
const base = (id: string, extra: Partial<InterruptorParaUi> = {}): InterruptorParaUi => ({
  id, apagado: false, motivo: null, cambiadoPorNombre: null, cambiadoEn: null, ...extra,
});

describe('SeccionInterruptores (kill switch)', () => {
  const html = renderToStaticMarkup(
    <SeccionInterruptores accion={accion} interruptores={[
      base('cobranza'),
      base('global', { apagado: true, motivo: 'incidente de prueba', cambiadoPorNombre: 'Ana', cambiadoEn: '2026-11-09T18:00:00Z' }),
      base('facturas'),
    ]} />,
  );
  it('pinta una fila con su propio formulario por interruptor', () => {
    expect((html.match(/<form/g) ?? []).length).toBe(3);
    expect(html).toContain('value="global"');
    expect(html).toContain('value="cobranza"');
  });
  it('lo apagado va primero y se ve APAGADO con motivo y firma', () => {
    expect(html.indexOf('value="global"')).toBeLessThan(html.indexOf('value="cobranza"'));
    expect(html).toContain('APAGADO');
    expect(html).toContain('Motivo: incidente de prueba');
    expect(html).toContain('Apagado por Ana');
  });
  it('un apagado ofrece Encender con la operación correcta; un encendido ofrece Apagar', () => {
    expect(html).toContain('value="encender"');
    expect(html).toContain('value="apagar"');
    expect(html).toContain('>Encender<');
    expect(html).toContain('>Apagar<');
  });
  it('un interruptor nunca tocado lo dice (encendido por omisión)', () => {
    expect(html).toContain('Nunca se ha tocado');
  });
  it('sin motivo en la fila de un encendido: el motivo solo aparece al pedir apagar', () => {
    expect(html).not.toContain('name="motivo"');
  });
});
