import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// /admin/corridas — CERO cobertura de la PÁGINA (corridasFiltradas ya tiene
// prueba propia). Tiene su PROPIA llamada a requireSuperadmin() —redundante
// con el layout, a propósito, mismo patrón que otras páginas de /admin—, sin
// server actions (filtros por GET). Se vigila: fallo de lectura ≠ "no
// existen"; vacío-por-filtro ≠ vacío-real; costoUsd null (no midió) ≠ $0.00
// (gastó cero); "tareas" ambos-o-ninguno; el error de una corrida se pinta
// en la lista, no sólo en su traza.
// ═══════════════════════════════════════════════════════════════════════════

const dobles = vi.hoisted(() => ({
  requireSuperadmin: vi.fn(),
  corridasFiltradas: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => '/admin/corridas', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/admin/agentes-parados', async (importar) => ({ ...(await importar<typeof import('@/lib/admin/agentes-parados')>()), getAgentesParados: vi.fn(async () => ({ parados: [], habilitados: 3, umbralHoras: 72, latidoDelRunner: null })) }));
vi.mock('@/lib/admin/cola-aprobacion', async (importar) => ({ ...(await importar<typeof import('@/lib/admin/cola-aprobacion')>()), leerResumenBandeja: vi.fn(async () => null) }));
vi.mock('@/lib/admin/bitacora', async (importar) => ({ ...(await importar<typeof import('@/lib/admin/bitacora')>()), opcionesBitacora: vi.fn(async () => ({ flotas: [{ id: 't-1', nombre: 'Transportes Uno' }], personas: [] })) }));
vi.mock('@/lib/admin/corridas-cruzadas', async (importar) => ({
  ...(await importar<typeof import('@/lib/admin/corridas-cruzadas')>()),
  corridasFiltradas: dobles.corridasFiltradas,
}));

import IndiceCorridas from './page';

async function renderizar(sp: Record<string, string> = {}) {
  return renderToStaticMarkup(await IndiceCorridas({ searchParams: Promise.resolve(sp) }));
}
const CORRIDA_OK = {
  id: 'c-1', agente: 'cobranza', tenantNombre: 'Transportes Uno', estado: 'ok',
  inicio: '2026-01-01T00:00:00Z', duracionMs: 5000, tareasHechas: 3, tareasTotal: 3,
  costoUsd: 0.0042, error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  dobles.requireSuperadmin.mockResolvedValue({ nombre: 'Javier', avatarUrl: null });
  dobles.corridasFiltradas.mockResolvedValue({ corridas: [], pagina: 1, paginas: 1, total: 0 });
});

it('exige superadmin ANTES de leer corridas — puerta propia, redundante con el layout', async () => {
  await renderizar();
  expect(dobles.requireSuperadmin).toHaveBeenCalled();
});

it('sin filtro, cero corridas dice "aún no hay corridas" — vacío REAL', async () => {
  const html = await renderizar();
  expect(html).toContain('Aún no hay corridas');
});

it('con filtro, cero corridas dice "ninguna coincide" — distinto del vacío real', async () => {
  const html = await renderizar({ agente: 'cobranza' });
  expect(dobles.corridasFiltradas).toHaveBeenCalledWith({ agente: 'cobranza', estado: undefined, tenantId: undefined, pagina: 1 });
  expect(html).toContain('Ninguna corrida coincide con el filtro');
});

it('una lectura caída dice "la consulta falló", nunca "no existen"', async () => {
  dobles.corridasFiltradas.mockRejectedValueOnce(new Error('la base no contestó'));
  const html = await renderizar();
  expect(html).toContain('No se pudieron leer las corridas');
  expect(html).toContain('no es que no existan');
});

it('costoUsd NULL se pinta "—" con su porqué, nunca como $0.00 (no midió ≠ gastó cero)', async () => {
  dobles.corridasFiltradas.mockResolvedValue({ corridas: [{ ...CORRIDA_OK, costoUsd: null }], pagina: 1, paginas: 1, total: 1 });
  const html = await renderizar();
  expect(html).toContain('no midió su gasto');
  expect(html).not.toContain('$0.00');
});

it('tareasHechas/tareasTotal es ambos-o-ninguno: si uno falta, se pinta "—" completo', async () => {
  dobles.corridasFiltradas.mockResolvedValue({ corridas: [{ ...CORRIDA_OK, tareasHechas: 3, tareasTotal: null }], pagina: 1, paginas: 1, total: 1 });
  const html = await renderizar();
  expect(html).not.toContain('3 de');
});

it('el error de una corrida se pinta en la LISTA, no sólo en su traza', async () => {
  dobles.corridasFiltradas.mockResolvedValue({ corridas: [{ ...CORRIDA_OK, estado: 'fallo', error: 'timeout al llamar al PAC' }], pagina: 1, paginas: 1, total: 1 });
  const html = await renderizar();
  expect(html).toContain('timeout al llamar al PAC');
});

it('la página pedida (?p=) viaja al filtro; una página inválida cae a 1', async () => {
  await renderizar({ p: '4' });
  expect(dobles.corridasFiltradas).toHaveBeenCalledWith(expect.objectContaining({ pagina: 4 }));

  await renderizar({ p: 'nan' });
  expect(dobles.corridasFiltradas).toHaveBeenLastCalledWith(expect.objectContaining({ pagina: 1 }));
});

it('F7: el bloque «Agentes que no corrieron y por qué» también vive aquí', async () => {
  const html = await renderizar();
  expect(html).toContain('Agentes que no corrieron y por qué');
});

it('F7: el total real y la siguiente página conservan los filtros', async () => {
  dobles.corridasFiltradas.mockResolvedValue({ corridas: [CORRIDA_OK], pagina: 1, paginas: 3, total: 120 });
  const html = await renderizar({ estado: 'fallo' });
  expect(html).toContain('de 120 corridas');
  expect(html).toContain('estado=fallo&amp;p=2');
});

it('F7: no imprime ids de corrida ni nombres internos de columnas', async () => {
  dobles.corridasFiltradas.mockResolvedValue({ corridas: [CORRIDA_OK], pagina: 1, paginas: 1, total: 1 });
  const html = await renderizar();
  expect(html).not.toMatch(/costo_usd|agente_corrida|\bNULL\b/);
});

it('con corridas pinta el mapa de calor por día y bloque de 3 horas, y dice que cuenta solo la página', async () => {
  dobles.corridasFiltradas.mockResolvedValue({ corridas: [CORRIDA_OK, { ...CORRIDA_OK, id: 'c-2', inicio: '2026-01-01T01:00:00Z' }], pagina: 1, paginas: 1, total: 2 });
  const html = await renderizar();
  expect(html).toContain('Cuándo corren los agentes');
  expect(html).toContain('rv-calor');
  expect(html).toContain('Cuenta las 2 corridas de la página');
  // 00:00 y 01:00 UTC del 1-ene-2026 (jueves) son 18:00 y 19:00 del miércoles 31-dic en México: bloque 18.
  expect(html).toContain('Mié · 18: 2');
});

it('sin corridas (o lectura caída) no hay mapa de calor', async () => {
  expect(await renderizar()).not.toContain('rv-calor');
  dobles.corridasFiltradas.mockRejectedValue(new Error('x'));
  expect(await renderizar()).not.toContain('rv-calor');
});
