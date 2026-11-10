import { describe, expect, it } from 'vitest';
import { apoyosLargos, barraPagina, h1Propio, marcosDePagina, medirEncabezados, problemasDeTrinquete } from './medir';
import { BASE_APOYO_LARGO, BASE_BARRA_PAGINA, BASE_H1_PROPIO, BASE_MARCOS_MULTIPLES, BASE_SIN_MARCO } from './base';

// Guarda `admin_encabezados_contrato` (Fase 0, K3), el contrato visual del encabezado de /admin: cada pantalla usa UN `MarcoPagina`,
// no pinta `BarraPagina`, no escribe un <h1> propio (el título lo pone el marco) y su `apoyo` no pasa de 140 caracteres.
// Bases = estado medido al abrir la Fase 0; solo bajan conforme cada fase migra sus pantallas.
describe('admin_encabezados_contrato: el detector', () => {
  it('ve cada infracción y no se confunde con comentarios', () => {
    expect(barraPagina('<BarraPagina titulo="x" />')).toBe(1);
    expect(h1Propio('<h1 className="a">x</h1>')).toBe(1);
    expect(marcosDePagina('<MarcoPagina area="a" titulo="t">')).toBe(1);
    expect(h1Propio('{/* <h1> viejo */}')).toBe(0);
    expect(barraPagina('// <BarraPagina /> viejo')).toBe(0);
    expect(apoyosLargos(`<MarcoPagina apoyo="${'a'.repeat(141)}" />`)).toBe(1);
    expect(apoyosLargos(`<MarcoPagina apoyo="${'a'.repeat(140)}" />`)).toBe(0);
    expect(apoyosLargos(`<MarcoPagina apoyo={'${'a'.repeat(141)}'} />`)).toBe(1);
  });
});

describe('admin_encabezados_contrato: el trinquete', () => {
  const m = medirEncabezados();
  it('ninguna pantalla suma BarraPagina', () => { expect(problemasDeTrinquete(m.barra, BASE_BARRA_PAGINA)).toEqual([]); });
  it('ninguna pantalla suma un h1 propio', () => { expect(problemasDeTrinquete(m.h1, BASE_H1_PROPIO)).toEqual([]); });
  it('ningún apoyo literal pasa de 140 caracteres', () => { expect(problemasDeTrinquete(m.apoyo, BASE_APOYO_LARGO)).toEqual([]); });
  it('ninguna pantalla monta más de un MarcoPagina', () => { expect(problemasDeTrinquete(m.marcosMultiples, BASE_MARCOS_MULTIPLES)).toEqual([]); });
  it('las pantallas sin MarcoPagina solo pueden disminuir', () => {
    const base = new Set(BASE_SIN_MARCO);
    expect(m.sinMarco.filter((d) => !base.has(d)), 'pantalla nueva sin MarcoPagina').toEqual([]);
    const ahora = new Set(m.sinMarco);
    expect(BASE_SIN_MARCO.filter((d) => !ahora.has(d)), 'ya usa MarcoPagina: bórrala de BASE_SIN_MARCO').toEqual([]);
  });
});
