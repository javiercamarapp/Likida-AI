import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeclararPeriodo } from './declarar-periodo';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

// A37-A2-12: el periodo oficial de un desglose ya importado se puede declarar/corregir desde el detalle.
const accion = async () => null;

describe('DeclararPeriodo', () => {
  it('sin periodo dice «sin declarar» y pide las dos fechas', () => {
    const html = renderToStaticMarkup(<DeclararPeriodo declarar={accion} desgloseId="d1" desde={null} hasta={null} />);
    expect(html).toContain('sin declarar');
    expect(html).toContain('name="periodo_desde"');
    expect(html).toContain('name="periodo_hasta"');
    expect(html).toContain('value="d1"');
  });
  it('con periodo lo muestra y lo precarga para corregirlo', () => {
    const html = renderToStaticMarkup(<DeclararPeriodo declarar={accion} desgloseId="d1" desde="2026-08-01" hasta="2026-08-10" />);
    expect(html).toContain('2026-08-01 a 2026-08-10');
    expect(html).toContain('value="2026-08-01"');
  });
});
