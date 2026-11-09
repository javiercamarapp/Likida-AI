import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ControlApagar } from './control-apagar';

const base = { id: 'agente:cazador', pendiente: false, enviar: () => {} };

it('encendido: UNA línea con «Apagar» y SIN campo Motivo visible hasta accionar', () => {
  const h = renderToStaticMarkup(<ControlApagar {...base} apagado={false} />);
  expect(h).toContain('>Apagar<');
  expect(h).not.toContain('name="motivo"');
  expect(h).toContain('name="id"');
  expect(h).toContain('value="apagar"');
});

it('apagado: «Encender» directo, sin motivo (encender no lo exige)', () => {
  const h = renderToStaticMarkup(<ControlApagar {...base} apagado />);
  expect(h).toContain('>Encender<');
  expect(h).toContain('value="encender"');
  expect(h).not.toContain('name="motivo"');
});
