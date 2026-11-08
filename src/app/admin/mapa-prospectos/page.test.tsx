import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({ getDatosMapa: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: vi.fn(async () => ({ userId: 'u1' })) }));
vi.mock('@/lib/admin/prospectos-mapa', () => ({ getDatosMapa: dobles.getDatosMapa }));
vi.mock('./cerebro', () => ({ Cerebro: () => <div data-cerebro /> }));

import PaginaMapaProspectos from './page';

beforeEach(() => dobles.getDatosMapa.mockReset());

it('lectura fallida: el aviso dice que está vacío POR la avería (no «sin prospectos»)', async () => {
  dobles.getDatosMapa.mockResolvedValue({ filas: [], generadoEn: 'x', fallo: true, marca: null, delta: false, total: null });
  const h = renderToStaticMarkup(await PaginaMapaProspectos());
  expect(h).toContain('La cartera no se pudo leer');
  expect(h).toContain('no porque no haya prospectos');
  expect(h).toContain('role="alert"');
});

it('lectura sana: sin aviso', async () => {
  dobles.getDatosMapa.mockResolvedValue({ filas: [], generadoEn: 'x', fallo: false, marca: null, delta: false, total: 0 });
  expect(renderToStaticMarkup(await PaginaMapaProspectos())).not.toContain('La cartera no se pudo leer');
});
