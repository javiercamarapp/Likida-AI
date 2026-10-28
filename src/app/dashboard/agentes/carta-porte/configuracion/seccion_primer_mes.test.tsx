import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionPrimerMes } from './seccion_primer_mes';

const accion = async () => null;
describe('SeccionPrimerMes (OLA1-A3)', () => {
  it('muestra la fecha y los revisores guardados', () => {
    const html = renderToStaticMarkup(<SeccionPrimerMes primerMes={{ hasta: '2026-12-01', revisores: [{ departamento: 'Captura', correo: 'a@x.test' }] }} ver={{}} accion={accion} />);
    expect(html).toContain('value="2026-12-01"');
    expect(html).toContain('Captura: a@x.test');
  });
  it('sin la migración lo dice en vez de ofrecer una forma que fallaría', () => {
    const html = renderToStaticMarkup(<SeccionPrimerMes primerMes="no_disponible" ver={{}} accion={accion} />);
    expect(html).toContain('migración 0938');
    expect(html).not.toContain('<form');
  });
});
