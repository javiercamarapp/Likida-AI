import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BandaOrigen } from './banda-origen';
import { origenDe, TENANT_SINTETICO_KIT, TEXTO_BANDA } from '@/lib/likida/insights/origen_datos';

const REAL = '22222222-2222-4222-8222-222222222222';
const pintar = (o: Parameters<typeof BandaOrigen>[0]['origen']) => renderToStaticMarkup(<BandaOrigen origen={o} />);

describe('BandaOrigen', () => {
  it('tenant real → sin banda', () => {
    expect(pintar(origenDe(REAL))).toBe('');
  });
  it('tenant demo → banda con el texto de ejemplo/simulado', () => {
    const html = pintar(origenDe(TENANT_SINTETICO_KIT));
    expect(html).toContain('data-banda-origen="simulado"');
    expect(html).toContain(TEXTO_BANDA.simulado);
    expect(html).toContain('no son de tu operación');
  });
  it('origen ejemplo → texto de ejemplo', () => {
    expect(pintar('ejemplo')).toContain('datos de ejemplo');
  });
  it('fila mezclada en tenant real → banda', () => {
    const html = pintar(origenDe(REAL, [{ folio: 'F-1' }, { folio: 'DEMO-9' }]));
    expect(html).toContain('data-banda-origen');
  });
  it('la banda es role=status y se dice con palabras', () => {
    const html = pintar('simulado');
    expect(html).toContain('role="status"');
    expect(html).toMatch(/simulados/);
  });
});
