import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';

const d = vi.hoisted(() => ({ sup: vi.fn(), personas: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => '/admin/equipo', useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: d.sup }));
vi.mock('@/lib/admin/personas', async (i) => ({ ...(await i<typeof import('@/lib/admin/personas')>()), getPersonas: d.personas }));
vi.mock('../usuarios/acciones', () => ({
  accionCambiarRolUsuario: vi.fn(), accionDarDeBajaUsuario: vi.fn(), accionReactivarUsuario: vi.fn(), accionReenviarAccesoUsuario: vi.fn(),
  accionCerrarSesionesUsuario: vi.fn(), accionDarDeBajaPersonalLikida: vi.fn(), accionReactivarPersonalLikida: vi.fn(),
}));

import PaginaEquipo from './page';
import { armarPersonas, type FilaAppUser } from '@/lib/admin/personas';

const fila = (id: string, o: Partial<FilaAppUser> = {}): FilaAppUser => ({
  id, email: `${id}@x.mx`, nombre: id, rol: 'contador', tenant_id: 't-1', activo: true, desactivado_en: null, tenant: { nombre: 'Flota X' }, ...o,
});
const AUTH = (ids: string[], sin: string[] = []) => new Map(ids.map((i) => [i, { lastSignInAt: sin.includes(i) ? null : '2026-11-01T12:00:00Z' }]));
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await PaginaEquipo({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  vi.clearAllMocks();
  d.sup.mockResolvedValue({ userId: 'yo', rol: 'superadmin', tenantId: null });
  d.personas.mockResolvedValue({ personas: [], accesoLegible: true });
});

it('lee a todas las personas y no se queda con el rótulo falso de "audit log no se registra hoy"', async () => {
  const html = await render();
  expect(html).not.toContain('no se registra hoy');
  expect(html).toContain('Sin personas con cuenta');
  expect(html).toContain('bitácora de auditoría');
});

it('ordena por jerarquía operativa, no alfabético', async () => {
  d.personas.mockResolvedValue({
    personas: armarPersonas([
      fila('Zeta', { rol: 'contador' }), fila('Ana', { rol: 'superadmin', tenant_id: null, tenant: null }), fila('Beto', { rol: 'flota_admin' }),
    ], AUTH(['Zeta', 'Ana', 'Beto'])),
    accesoLegible: true,
  });
  const html = await render();
  const pos = ['Ana', 'Beto', 'Zeta'].map((n) => html.indexOf(`>${n}<`));
  expect(pos.every((p) => p !== -1)).toBe(true);
  expect(pos).toEqual([...pos].sort((a, b) => a - b));
});

it('dice "Nunca entró" y "De baja" y "Sin cuenta de acceso", cada uno con su estado', async () => {
  d.personas.mockResolvedValue({
    personas: armarPersonas([fila('a'), fila('b', { activo: false }), fila('c')], AUTH(['a', 'b'], ['a'])),
    accesoLegible: true,
  });
  const html = await render();
  expect(html).toContain('Nunca entró');
  expect(html).toContain('De baja');
  expect(html).toContain('Sin cuenta de acceso');
});

it('si no se pudo leer el acceso, NO afirma que nadie ha entrado', async () => {
  d.personas.mockResolvedValue({ personas: armarPersonas([fila('a')], null), accesoLegible: false });
  const html = await render();
  expect(html).toContain('Sin dato');
  expect(html).not.toContain('Nunca entró');
});

it('la búsqueda filtra también por nombre de flota', async () => {
  d.personas.mockResolvedValue({
    personas: armarPersonas([fila('Ana', { tenant: { nombre: 'Transportes Norte' } }), fila('Beto', { tenant: { nombre: 'Fletes Sur' } })], AUTH(['Ana', 'Beto'])),
    accesoLegible: true,
  });
  const html = await render({ q: 'Norte' });
  expect(html).toContain('>Ana<');
  expect(html).not.toContain('>Beto<');
});

it('?abrir= muestra las acciones de esa persona; para un superadmin propio no ofrece la baja', async () => {
  d.personas.mockResolvedValue({
    personas: armarPersonas([fila('yo', { rol: 'superadmin', tenant_id: null, tenant: null }), fila('b')], AUTH(['yo', 'b'])),
    accesoLegible: true,
  });
  const ajena = await render({ abrir: 'b' });
  expect(ajena).toContain('Dar de baja');
  expect(ajena).toContain('Reenviar acceso');
  const propia = await render({ abrir: 'yo' });
  expect(propia).toContain('no puedes darte de baja a ti mismo');
});

it('la baja del personal de Likida nace apagada y lo dice', async () => {
  delete process.env.LIKIDA_BAJA_PERSONAL_LIKIDA;
  d.personas.mockResolvedValue({
    personas: armarPersonas([fila('v', { rol: 'vendedor', tenant_id: null, tenant: null })], AUTH(['v'])), accesoLegible: true,
  });
  const html = await render({ abrir: 'v' });
  expect(html).toContain('pendiente de la revisión del dueño');
  expect(html).not.toContain('Sí, dar de baja');
});

it('una lectura caída es error con reintento, no "sin personas"', async () => {
  d.personas.mockRejectedValue(new Error('caída'));
  const html = await render();
  expect(html).toContain('No se pudo leer el equipo');
  expect(html).not.toContain('Sin personas con cuenta');
});
