import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

// /admin/bitacora — solo lectura. Se vigila: puerta propia, lectura caída ≠ «nadie tocó nada», sin correos ni detalle crudo en
// pantalla, el filtro viaja saneado a la lectura, y la vista de accesos del equipo solo existe si la tabla ya tiene filas.

const dobles = vi.hoisted(() => ({
  requireSuperadmin: vi.fn(),
  leerPaginaBitacora: vi.fn(),
  leerPaginaAccesos: vi.fn(),
  opcionesBitacora: vi.fn(),
}));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: dobles.requireSuperadmin }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => '/admin/bitacora', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/admin/bitacora', async (importar) => ({
  ...(await importar<typeof import('@/lib/admin/bitacora')>()),
  leerPaginaBitacora: dobles.leerPaginaBitacora,
  leerPaginaAccesos: dobles.leerPaginaAccesos,
  opcionesBitacora: dobles.opcionesBitacora,
}));

import BitacoraPage from './page';
import { quienDe } from './quien';
import { etiquetaAccion } from './etiquetas';

const ENTRADA = { id: 1, tenantId: 't1', tenantNombre: 'Flota Uno', actor: 'Ana', accion: 'usuario.rol_cambiado', entidad: 'app_user', entidadId: '3f2b8c1e-5a47-4d0e-9b61-0c2f7a8d9e10', detalle: { telefono: '5219991234567', motivo: 'x' }, ocurrioEn: '2026-11-09T18:00:00Z' };
const pagina = (filas: unknown[], total = filas.length) => ({ filas, total, pagina: 1, paginas: Math.max(1, Math.ceil(total / 50)) });
async function pintar(sp: Record<string, string> = {}) { return renderToStaticMarkup(await BitacoraPage({ searchParams: Promise.resolve(sp) })); }

beforeEach(() => {
  vi.clearAllMocks();
  dobles.requireSuperadmin.mockResolvedValue({ userId: 'u-1' });
  dobles.leerPaginaBitacora.mockResolvedValue(pagina([]));
  dobles.leerPaginaAccesos.mockResolvedValue({ existe: true, filas: [], total: 0, pagina: 1, paginas: 1 });
  dobles.opcionesBitacora.mockResolvedValue({ flotas: [{ id: 't1', nombre: 'Flota Uno' }], personas: [{ id: 'u-1', nombre: 'Ana' }] });
});

it('exige superadmin antes de leer', async () => {
  dobles.requireSuperadmin.mockRejectedValueOnce(new Error('REDIRECT'));
  await expect(pintar()).rejects.toThrow('REDIRECT');
  expect(dobles.leerPaginaBitacora).not.toHaveBeenCalled();
});

it('con base vacía y sin filtros dice que la bitácora está vacía; con filtro, que ninguna entrada coincide', async () => {
  expect(await pintar()).toContain('La bitácora está vacía');
  expect(await pintar({ accion: 'flota' })).toContain('Ninguna entrada con ese filtro');
});

it('una lectura caída se dice: no es «nadie tocó nada»', async () => {
  dobles.leerPaginaBitacora.mockRejectedValueOnce(new Error('timeout'));
  const html = await pintar();
  expect(html).toContain('No se pudo leer la bitácora');
  expect(html).toContain('NO quiere decir que nadie haya tocado nada');
  expect(html).not.toContain('La bitácora está vacía');
});

it('lista con sembrado: acción en palabras, quién, flota y entidad; sin detalle crudo ni identificadores', async () => {
  dobles.leerPaginaBitacora.mockResolvedValue(pagina([ENTRADA]));
  const html = await pintar();
  expect(html).toContain('Usuario · rol cambiado');
  expect(html).toContain('Ana');
  expect(html).toContain('Flota Uno');
  expect(html).toContain('Persona');
  expect(html).not.toContain('5219991234567');
  expect(html).not.toContain('3f2b8c1e');
  expect(html).not.toContain('usuario.rol_cambiado');
});

it('sin datos personales: un actor que llega como correo se muestra sin él', async () => {
  expect(quienDe('javier@likida.ai')).toBe('Persona sin nombre');
  expect(quienDe(null)).toBe('Sistema');
  dobles.leerPaginaBitacora.mockResolvedValue(pagina([{ ...ENTRADA, actor: 'javier@likida.ai' }]));
  const html = await pintar();
  expect(html).not.toContain('javier@likida.ai');
});

it('los filtros de la URL llegan saneados a la lectura, y la página pedida también', async () => {
  await pintar({ accion: 'Flota%', persona: '3f2b8c1e-5a47-4d0e-9b61-0c2f7a8d9e10', flota: 'plataforma', desde: '2026-11-01', hasta: '2026-11-09', p: '3' });
  expect(dobles.leerPaginaBitacora).toHaveBeenCalledWith(
    { accion: 'flota', actorId: '3f2b8c1e-5a47-4d0e-9b61-0c2f7a8d9e10', tenantId: 'plataforma', desde: '2026-11-01', hasta: '2026-11-09' }, 3);
});

it('un rango al revés se avisa y NO consulta', async () => {
  const html = await pintar({ desde: '2026-11-09', hasta: '2026-11-01' });
  expect(html).toContain('El rango está al revés');
  expect(dobles.leerPaginaBitacora).not.toHaveBeenCalled();
});

it('el pie dice el total real y ofrece Siguiente con los filtros conservados', async () => {
  dobles.leerPaginaBitacora.mockResolvedValue({ filas: [ENTRADA], total: 120, pagina: 1, paginas: 3 });
  const html = await pintar({ accion: 'usuario' });
  expect(html).toContain('de 120 entradas');
  expect(html).toContain('accion=usuario&amp;p=2');
});

it('los accesos del equipo: sin filas no hay vista; con filas, la vista se ofrece y se lee', async () => {
  expect(await pintar()).not.toContain('Accesos del equipo');
  dobles.leerPaginaAccesos.mockResolvedValue({ existe: true, filas: [{ id: 1, creadoEn: '2026-11-09T10:00:00Z', actor: 'Ana', tenantNombre: 'Flota Uno', tipo: 'descarga', ruta: '/admin/facturas' }], total: 1, pagina: 1, paginas: 1 });
  expect(await pintar()).toContain('Accesos del equipo');
  const html = await pintar({ vista: 'accesos' });
  expect(html).toContain('/admin/facturas');
  expect(html).toContain('Descarga');
});

it('una lista de filtros que no se pudo leer se avisa y la bitácora sigue en pie', async () => {
  dobles.opcionesBitacora.mockResolvedValue({ flotas: null, personas: [] });
  dobles.leerPaginaBitacora.mockResolvedValue(pagina([ENTRADA]));
  const html = await pintar();
  expect(html).toContain('la lista de flotas');
  expect(html).toContain('Usuario · rol cambiado');
});

it('una acción desconocida se muestra legible, nunca oculta', () => {
  expect(etiquetaAccion('algo_nuevo.paso_raro')).toBe('Algo nuevo · paso raro');
  expect(etiquetaAccion('login')).toBe('Login');
});
