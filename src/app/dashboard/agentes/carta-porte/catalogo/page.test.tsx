import { beforeEach, describe, expect, it, vi } from 'vitest';

// La página: gatea con SU ruta (la del catálogo), lee solo lo de la flota de la sesión y no se deja llevar por un
// ?cliente= ajeno o inventado.
let sesion: { tenantId: string; rol: string; userId: string } = { tenantId: 't-1', rol: 'flota_admin', userId: 'u-1' };
const puerta = vi.hoisted(() => ({ rutas: [] as string[] }));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async (ruta: string) => { puerta.rutas.push(ruta); return sesion; } }));
vi.mock('next/navigation', () => ({ redirect: (r: string) => { throw new Error(`REDIRECT:${r}`); }, notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./actions', () => ({ guardarFilaCatalogo: vi.fn(), importarCatalogoCsv: vi.fn() }));
vi.mock('@/lib/likida/carta_porte_docs/repo', async () => (await import('@/lib/likida/carta_porte_docs/repo_falso.fixture')).api);

import { estado, reset } from '@/lib/likida/carta_porte_docs/repo_falso.fixture';
import PaginaCatalogoCliente from './page';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const C2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
const AJENO = 'cccccccc-cccc-4ccc-8ccc-cccccccccc99';

const montar = async (sp: Record<string, string> = {}) =>
  (await PaginaCatalogoCliente({ searchParams: Promise.resolve(sp) })) as unknown as { props: { clientes: Array<{ id: string }>; clienteId: string | null; catalogo: { productos: Array<{ sku: string }>; partes: unknown[]; numero: unknown } | null; lecturaFallida: boolean } };

beforeEach(() => {
  reset(); puerta.rutas.length = 0;
  sesion = { tenantId: A, rol: 'flota_admin', userId: 'u-1' };
  estado.clientes.push({ tenantId: A, id: C1, nombre: 'Cliente Uno' }, { tenantId: A, id: C2, nombre: 'Cliente Dos' }, { tenantId: B, id: AJENO, nombre: 'Cliente Ajeno' });
  const base = { descripcionPatron: null, bienesTransp: '25172500', claveUnidad: 'H87', embalaje: null, fraccion: null, tipoMateria: null, materialPeligroso: false, claveMaterialPeligroso: null };
  estado.catalogoProductos.push({ tenantId: A, clienteId: C1, sku: 'SKU-UNO', ...base }, { tenantId: A, clienteId: C2, sku: 'SKU-DOS', ...base }, { tenantId: B, clienteId: AJENO, sku: 'SKU-AJENO', ...base });
});

describe('página del catálogo del cliente', () => {
  it('gatea con su propia ruta; un rol sin el área (vendedor) rebota al panel', async () => {
    await montar();
    expect(puerta.rutas).toEqual(['/dashboard/agentes/carta-porte/catalogo']);
    sesion = { ...sesion, rol: 'vendedor' };
    await expect(montar()).rejects.toThrow('REDIRECT:/dashboard');
  });

  it('solo lista los clientes de la flota de la sesión y, sin ?cliente=, no elige ninguno (hay dos)', async () => {
    const { props } = await montar();
    expect(props.clientes.map((c) => c.id)).toEqual([C1, C2]);
    expect(props.clienteId).toBeNull();
    expect(props.catalogo).toBeNull();
  });

  it('con ?cliente= lee SOLO el catálogo de ese cliente de esta flota', async () => {
    const { props } = await montar({ cliente: C2 });
    expect(props.clienteId).toBe(C2);
    expect(props.catalogo?.productos.map((p) => p.sku)).toEqual(['SKU-DOS']);
  });

  it('un cliente de otra flota, o un valor que no es uuid, no abre nada (no hay fuga entre flotas)', async () => {
    for (const cliente of [AJENO, 'no-es-uuid', "' or 1=1 --"]) {
      const { props } = await montar({ cliente });
      expect(props.clienteId).toBeNull();
      expect(props.catalogo).toBeNull();
    }
  });

  it('con un solo cliente lo elige solo; si la lectura del catálogo falla lo dice (lecturaFallida), no finge vacío', async () => {
    estado.clientes.splice(0, estado.clientes.length, { tenantId: A, id: C1, nombre: 'Cliente Uno' });
    const ok = await montar();
    expect(ok.props.clienteId).toBe(C1);
    estado.fallar.set('cargarCatalogoCliente', new Error('base caída'));
    const caida = await montar();
    expect(caida.props.lecturaFallida).toBe(true);
    expect(caida.props.catalogo).toBeNull();
  });
});
