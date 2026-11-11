import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

// La traza de UNA corrida: id inválido = 404, lectura caída ≠ «no existe», NULL ≠ 0 en tareas y costo, sin ids ni claves internas.
const dobles = vi.hoisted(() => ({ requireSuperadmin: vi.fn(), trazaDeCorrida: vi.fn(), notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }) }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('next/navigation', () => ({ notFound: dobles.notFound, useRouter: () => ({ refresh: () => {} }), usePathname: () => '/admin/corridas/x', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/admin/corridas-cruzadas', async (importar) => ({ ...(await importar<typeof import('@/lib/admin/corridas-cruzadas')>()), trazaDeCorrida: dobles.trazaDeCorrida }));

import TrazaCorridaPage from './page';

const ID = '3f2b8c1e-5a47-4d0e-9b61-0c2f7a8d9e10';
const CORRIDA = { id: ID, agente: 'cobranza', tenantId: 't-1', tenantNombre: 'Transportes Uno', inicio: '2026-11-09T10:00:00Z', fin: '2026-11-09T10:00:05Z', estado: 'fallo', disparo: 'cron', tareasHechas: 2, tareasTotal: 5, resumen: { enviadas: 3, nota: { a: 1 } }, error: 'timeout al llamar al PAC', costoUsd: null, duracionMs: 5000 };
const pintar = async (id = ID) => renderToStaticMarkup(await TrazaCorridaPage({ params: Promise.resolve({ id }) }));

beforeEach(() => {
  vi.clearAllMocks();
  dobles.requireSuperadmin.mockResolvedValue({});
  dobles.trazaDeCorrida.mockResolvedValue({ corrida: CORRIDA, costo: null, costoNoDisponible: 'La corrida no tiene fin: no hay ventana.' });
});

it('un id que no es uuid es 404 y no consulta', async () => {
  await expect(pintar('no-es-uuid')).rejects.toThrow('NEXT_NOT_FOUND');
  expect(dobles.trazaDeCorrida).not.toHaveBeenCalled();
});

it('una corrida que no existe es 404; una lectura caída se dice y NO es un 404', async () => {
  dobles.trazaDeCorrida.mockResolvedValueOnce(null);
  await expect(pintar()).rejects.toThrow('NEXT_NOT_FOUND');
  dobles.trazaDeCorrida.mockRejectedValueOnce(new Error('caída'));
  const html = await pintar();
  expect(html).toContain('no es que no exista, es que no se pudo mirar');
});

it('muestra estado, error redactado, tareas y el porqué de un costo no correlacionable', async () => {
  const html = await pintar();
  expect(html).toContain('Fallo');
  expect(html).toContain('timeout al llamar al PAC');
  expect(html).toContain('2 de 5');
  expect(html).toContain('La corrida no tiene fin: no hay ventana.');
  expect(html).toContain('Agente de Cobranza');
});

it('NULL ≠ 0: sin tareas medidas no pinta «0 de 0», y sin costo no pinta US$0', async () => {
  dobles.trazaDeCorrida.mockResolvedValue({ corrida: { ...CORRIDA, tareasHechas: null, tareasTotal: null, fin: null, duracionMs: null }, costo: null, costoNoDisponible: null });
  const html = await pintar();
  expect(html).not.toContain('0 de 0');
  expect(html).toContain('Esta corrida no mide tareas.');
  expect(html).not.toMatch(/US\$\s?0/);
});

it('el resumen se pinta legible: sin «[object Object]» ni el uuid de la corrida', async () => {
  const html = await pintar();
  expect(html).not.toContain('[object Object]');
  expect(html).not.toContain(ID);
});

it('con costo correlacionable lo dice con su supuesto a la vista', async () => {
  dobles.trazaDeCorrida.mockResolvedValue({ corrida: CORRIDA, costo: { llamadas: 4, tokensIn: 1000, tokensOut: 200, costoUsd: 0.12 }, costoNoDisponible: null });
  const html = await pintar();
  expect(html).toContain('Llamadas al modelo');
  expect(html).toContain('correlación por tiempo');
});
