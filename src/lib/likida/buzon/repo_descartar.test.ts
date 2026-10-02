import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria } from '@/lib/pruebas/tablas_en_memoria.fixture';

// ═══════════════════════════════════════════════════════════════════════════
// ADVERSARIAL RONDA 03 · descartar un archivo en revisión no puede borrar el PDF de una FACTURA.
//
// La ruta del PDF depende del CONTENIDO (`<tenant>/<sha256>.pdf`, upsert): el mismo PDF que reentra por otro correo se
// cuelga de una factura con la MISMA ruta. Quien descarta la recepción vieja (o la purga de 365 días, ver
// supabase/tests/0601_buzon_purga_respeta_facturas.sql) no puede llevarse el archivo de la factura, que es evidencia
// fiscal (CFF 30).
// ═══════════════════════════════════════════════════════════════════════════

const estado = vi.hoisted(() => ({ db: null as unknown as BaseEnMemoria, borrados: [] as string[] }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => Object.assign(Object.create(estado.db.cliente), {
    storage: { from: () => ({ remove: async (rutas: string[]) => { estado.borrados.push(...rutas); return { data: rutas.map((name) => ({ name })), error: null }; } }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { descartarRecepcion } = await import('./repo');

const T = '11111111-1111-4111-8111-111111111111';
const OTRA = '22222222-2222-4222-8222-222222222222';
const RUTA = `${T}/${'a'.repeat(64)}.pdf`;
const recepcion = (p: Record<string, unknown> = {}) => ({
  id: 'r1', tenant_id: T, email_id: 'm1', nombre: 'x.pdf', tipo: 'pdf', bytes: 10, sha256: 'a'.repeat(64), estado: 'revision',
  factura_id: null, storage_ruta: RUTA, recibido_en: '2026-01-01T00:00:00Z', ...p,
});

beforeEach(() => { estado.borrados = []; });

describe('descartarRecepcion', () => {
  it('un PDF sin factura se borra del bucket y la recepción deja de apuntarle', async () => {
    estado.db = crearBaseEnMemoria({ buzon_recepcion: [recepcion()], factura_proveedor: [] });
    expect(await descartarRecepcion(T, 'r1', 'ana@x.mx')).toEqual({});
    expect(estado.borrados).toEqual([RUTA]);
    expect(estado.db.tabla('buzon_recepcion')[0]).toMatchObject({ estado: 'descartada', storage_ruta: null });
  });

  it('si una FACTURA ya cuelga de esa misma ruta (el mismo PDF reentró por otro correo), NO se borra el objeto', async () => {
    estado.db = crearBaseEnMemoria({
      buzon_recepcion: [recepcion()],
      factura_proveedor: [{ id: 'f1', tenant_id: T, cfdi_uuid: 'u', pdf_ruta: RUTA }],
    });
    expect(await descartarRecepcion(T, 'r1', 'ana@x.mx')).toEqual({});
    expect(estado.borrados).toEqual([]);
    // La recepción descartada ya no apunta al archivo de la factura: ninguna purga posterior puede confundirlos.
    expect(estado.db.tabla('buzon_recepcion')[0]).toMatchObject({ estado: 'descartada', storage_ruta: null });
  });

  it('tampoco se borra si OTRA recepción ligada a una factura usa la misma ruta', async () => {
    estado.db = crearBaseEnMemoria({
      buzon_recepcion: [recepcion(), recepcion({ id: 'r2', email_id: 'm2', estado: 'procesada', factura_id: 'f1' })],
      factura_proveedor: [],
    });
    await descartarRecepcion(T, 'r1', 'ana@x.mx');
    expect(estado.borrados).toEqual([]);
  });

  it('una factura de OTRA flota con la misma ruta no cuenta (la ruta lleva su tenant, pero se comprueba por tenant igual)', async () => {
    estado.db = crearBaseEnMemoria({
      buzon_recepcion: [recepcion()],
      factura_proveedor: [{ id: 'f9', tenant_id: OTRA, cfdi_uuid: 'u', pdf_ruta: RUTA }],
    });
    await descartarRecepcion(T, 'r1', 'ana@x.mx');
    expect(estado.borrados).toEqual([RUTA]);
  });

  it('si no se puede leer si la ruta está en uso, ni se borra ni se suelta la ruta (se decide después, con datos)', async () => {
    estado.db = crearBaseEnMemoria({ buzon_recepcion: [recepcion()], factura_proveedor: [] });
    estado.db.fallarProxima('factura_proveedor', 'select', { message: 'base caída' } as never);
    expect(await descartarRecepcion(T, 'r1', 'ana@x.mx')).toEqual({});
    expect(estado.borrados).toEqual([]);
    expect(estado.db.tabla('buzon_recepcion')[0]).toMatchObject({ estado: 'descartada', storage_ruta: RUTA });
  });

  it('un archivo que ya no está en revisión no se descarta', async () => {
    estado.db = crearBaseEnMemoria({ buzon_recepcion: [recepcion({ estado: 'procesada' })], factura_proveedor: [] });
    expect(await descartarRecepcion(T, 'r1', 'ana@x.mx')).toEqual({ error: 'Ese archivo ya no está esperando revisión.' });
    expect(estado.borrados).toEqual([]);
  });
});
