import { beforeEach, describe, expect, it, vi } from 'vitest';

// La edición en línea de una fila del catálogo (T-A3-22): misma disciplina que la importación — vuelve a resolver la
// sesión, usa SIEMPRE el tenant de la sesión, valida con las reglas del CSV y deja bitácora sin datos de terceros.
const C1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const CAJENO = 'cccccccc-cccc-4ccc-8ccc-cccccccccc99';
const sesion = { actual: { tenantId: 't-sesion', userId: 'u-sesion', rol: 'flota_admin' } };
const { resolver, bitacora, puerto } = vi.hoisted(() => ({
  resolver: vi.fn(),
  bitacora: vi.fn(async () => true),
  puerto: {
    clientes: vi.fn(), existentes: vi.fn(), aplicarLote: vi.fn(),
  },
}));
vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: resolver }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: bitacora }));
vi.mock('@/lib/likida/carta_porte_docs/catalogo_puerto', () => ({ puertoSupabase: () => puerto }));

import { guardarFilaCatalogo } from './actions';

const fd = (c: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(c)) f.set(k, v); return f; };
const PRODUCTO = { tipo: 'producto', cliente_id: C1, modo: 'nuevo', c_sku: 'SKU-1', c_bienes_transp: '25172500', c_clave_unidad: 'H87', c_material_peligroso: 'no' };

beforeEach(() => {
  vi.clearAllMocks();
  sesion.actual = { tenantId: 't-sesion', userId: 'u-sesion', rol: 'flota_admin' };
  resolver.mockImplementation(async () => sesion.actual);
  puerto.clientes.mockImplementation(async () => [{ id: C1, nombre: 'Cliente Uno' }]);
  puerto.existentes.mockImplementation(async () => []);
  puerto.aplicarLote.mockImplementation(async () => {});
});

describe('guardarFilaCatalogo', () => {
  it('un rol sin acceso a la operación es rechazado sin tocar la base', async () => {
    sesion.actual.rol = 'contador';
    expect(await guardarFilaCatalogo(null, fd(PRODUCTO))).toEqual({ ok: false, error: 'Tu rol no puede administrar el catálogo de Carta Porte.' });
    expect(puerto.clientes).not.toHaveBeenCalled();
    expect(puerto.aplicarLote).not.toHaveBeenCalled();
  });

  it('gatea con la ruta del catálogo y escribe SIEMPRE con el tenant y el usuario de la sesión, nunca los del formulario', async () => {
    const r = await guardarFilaCatalogo(null, fd({ ...PRODUCTO, tenant_id: 'otra-flota', tenant: 'otra-flota', actor: 'otro' }));
    expect(r).toEqual({ ok: true, mensaje: 'Agregado al catálogo.' });
    expect(resolver).toHaveBeenCalledWith('/dashboard/agentes/carta-porte/catalogo', expect.objectContaining({ tenant: 'otra-flota' }));
    expect(puerto.clientes).toHaveBeenCalledWith('t-sesion');
    expect(puerto.aplicarLote).toHaveBeenCalledWith('t-sesion', 'producto', [expect.objectContaining({ cliente_id: C1, sku: 'SKU-1', bienes_transp: '25172500', clave_unidad: 'H87' })], 'u-sesion');
  });

  it('un cliente que no es de la flota, un tipo desconocido y una fila inválida se rechazan sin escribir', async () => {
    expect(await guardarFilaCatalogo(null, fd({ ...PRODUCTO, cliente_id: CAJENO }))).toEqual({ ok: false, error: 'Ese cliente no es de tu flota.' });
    expect(await guardarFilaCatalogo(null, fd({ ...PRODUCTO, tipo: 'otro' }))).toMatchObject({ ok: false });
    const rfc = await guardarFilaCatalogo(null, fd({ tipo: 'parte', cliente_id: C1, modo: 'nuevo', c_rol: 'remitente', c_alias: 'Planta', c_rfc: 'MALO' }));
    expect(rfc).toMatchObject({ ok: false, error: expect.stringMatching(/RFC «MALO» no tiene forma válida/) });
    const formula = await guardarFilaCatalogo(null, fd({ ...PRODUCTO, c_sku: '=cmd' }));
    expect(formula).toMatchObject({ ok: false, error: expect.stringMatching(/fórmula/) });
    expect(puerto.aplicarLote).not.toHaveBeenCalled();
  });

  it('editar solo cambia una fila que existe (no crea una a escondidas) y deja la clave natural como estaba', async () => {
    const sinFila = await guardarFilaCatalogo(null, fd({ ...PRODUCTO, modo: 'editar' }));
    expect(sinFila).toEqual({ ok: false, error: 'Esa fila ya no existe. Recarga la pantalla.' });
    puerto.existentes.mockImplementation(async () => [{ cliente_id: C1, sku: 'SKU-1' }]);
    const ok = await guardarFilaCatalogo(null, fd({ ...PRODUCTO, modo: 'editar', c_clave_unidad: 'KGM' }));
    expect(ok).toEqual({ ok: true, mensaje: 'Cambios guardados en el catálogo.' });
    expect(puerto.aplicarLote).toHaveBeenCalledTimes(1);
  });

  it('el número interno del cliente se guarda por cliente (sin clave natural extra)', async () => {
    puerto.existentes.mockImplementation(async () => [{ cliente_id: C1, numero_interno: '10001' }]);
    const r = await guardarFilaCatalogo(null, fd({ tipo: 'cliente_numero', cliente_id: C1, modo: 'editar', c_numero_interno: '20002', c_activo: 'si' }));
    expect(r).toMatchObject({ ok: true });
    expect(puerto.aplicarLote).toHaveBeenCalledWith('t-sesion', 'cliente_numero', [expect.objectContaining({ cliente_id: C1, numero_interno: '20002', activo: true })], 'u-sesion');
  });

  it('deja bitácora con solo el tipo y el modo: ni SKU, ni nombres, ni RFC', async () => {
    await guardarFilaCatalogo(null, fd({ tipo: 'parte', cliente_id: C1, modo: 'nuevo', c_rol: 'destinatario', c_alias: 'Planta Secreta Ejemplo', c_rfc: 'XAXX010101000' })); // grep-limpio:ok
    expect(bitacora).toHaveBeenCalledWith(expect.objectContaining({ accion: 'ccp.catalogo_editado', tenantId: 't-sesion', detalle: { tipo: 'parte', modo: 'nuevo' } }), expect.anything());
    expect(JSON.stringify(bitacora.mock.calls)).not.toMatch(/Secreta|XAXX/);
  });

  it('un error de la base se dice en claro, sin filtrar el detalle técnico', async () => {
    puerto.aplicarLote.mockImplementation(async () => { throw new Error('conexión rechazada 10.0.0.1'); });
    const r = await guardarFilaCatalogo(null, fd(PRODUCTO));
    expect(r?.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('10.0.0.1');
  });
});
