import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const dobles = vi.hoisted(() => ({ getResumenProspectos: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: vi.fn(async () => ({ userId: 'u1' })) }));
vi.mock('@/lib/admin/prospectos-mapa', () => ({ getResumenProspectos: dobles.getResumenProspectos }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('./cerebro', () => ({ Cerebro: ({ resumen }: { resumen: { total: number } | null }) => <div data-cerebro data-total={resumen?.total ?? 'sin-lectura'} /> }));

import PaginaMapaProspectos from './page';

beforeEach(() => { dobles.getResumenProspectos.mockReset(); });

it('lectura fallida: el aviso dice que está vacío POR la avería (no «sin prospectos»)', async () => {
  dobles.getResumenProspectos.mockImplementation(async () => { throw new Error('base caída'); });
  const h = renderToStaticMarkup(await PaginaMapaProspectos());
  expect(h).toContain('La cartera no se pudo leer');
  expect(h).toContain('no porque no haya prospectos');
  expect(h).toContain('role="alert"');
});

it('lectura sana: sin aviso', async () => {
  dobles.getResumenProspectos.mockResolvedValue({ generadoEn: 'x', total: 0, porEtapa: {}, conTelefono: 0, conDecisor: 0, sinPlaza: 0, porEntidad: {} });
  expect(renderToStaticMarkup(await PaginaMapaProspectos())).not.toContain('La cartera no se pudo leer');
});

it('(punto 4) el HTML lleva el RESUMEN, no la cartera: ninguna fila viaja en la página', async () => {
  dobles.getResumenProspectos.mockResolvedValue({ generadoEn: 'x', total: 33_148, porEtapa: { nuevo: 33_148 }, conTelefono: 1, conDecisor: 1, sinPlaza: 0, porEntidad: {} });
  const h = renderToStaticMarkup(await PaginaMapaProspectos());
  expect(h).toContain('data-total="33148"');
  expect(h.length).toBeLessThan(20_000);
});
