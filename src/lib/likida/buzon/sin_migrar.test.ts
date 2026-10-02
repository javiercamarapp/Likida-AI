import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria } from '@/lib/pruebas/tablas_en_memoria.fixture';
import { procesarCorreoBuzon, type DepsBuzon } from './ingesta';

// ═══════════════════════════════════════════════════════════════════════════
// LA BASE SIN MIGRAR (0530/0531 aún sin aplicar en producción): el buzón debe seguir recibiendo facturas XML como
// antes, no devolver 503 a cada correo. Lo que NO puede hacer sin la migración (guardar un PDF, la entrega al
// contador) se dice honestamente, sin fallar el correo y sin inventar un vacío.
// ═══════════════════════════════════════════════════════════════════════════

const estado = vi.hoisted(() => ({ db: null as unknown as BaseEnMemoria, bucketExiste: false }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => Object.assign(Object.create(estado.db.cliente), {
    storage: { from: () => ({ upload: async () => ({ error: estado.bucketExiste ? null : { message: 'Bucket not found' } }) }) },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const repo = await import('./repo');
const { guardarFacturaProveedor, listarFacturasProveedor } = await import('../proveedores');
const entregaRepo = await import('./entrega_repo');

const T = '11111111-1111-4111-8111-111111111111';
const NO_COLUMNA = { code: '42703', message: 'column "fuente_datos" of relation "factura_proveedor" does not exist' } as never;
const NO_TABLA = { code: '42P01', message: 'relation "buzon_recepcion" does not exist' } as never;

beforeEach(() => {
  estado.db = crearBaseEnMemoria({ factura_proveedor: [], buzon_recepcion: [] }, [
    { tabla: 'factura_proveedor', nombre: 'factura_proveedor_tenant_uuid_key', columnas: ['tenant_id', 'cfdi_uuid'] },
  ]);
});

describe('proveedores sin la 0530', () => {
  const xml = { uuid: 'u-1', total: 1160, subTotal: 1000, ivaTraslado: 160, rfcEmisor: 'AAA010101AAA', rfcReceptor: 'BBB010101BBB', fecha: '2026-09-30T10:00:00', conceptos: [{}] } as never;

  it('guardar un CFDI sin la columna fuente_datos reintenta SIN el rótulo y la factura entra (no se pierde el correo)', async () => {
    estado.db.fallarProxima('factura_proveedor', 'insert', NO_COLUMNA);
    const r = await guardarFacturaProveedor(T, xml, '<x/>', 'BBB010101BBB', 'correo', 'vigente');
    expect(r.ok).toBe(true);
    const fila = estado.db.tabla('factura_proveedor')[0];
    expect(fila.cfdi_uuid).toBe('u-1');
    expect('fuente_datos' in fila).toBe(false);
  });

  it('con la columna disponible, el XML se rotula como dato duro', async () => {
    await guardarFacturaProveedor(T, xml, '<x/>', null, 'correo', null);
    expect(estado.db.tabla('factura_proveedor')[0].fuente_datos).toBe('xml');
  });

  it('listar la bandeja sin las columnas nuevas lee con la lista de antes y las marcas nuevas salen neutras', async () => {
    estado.db = crearBaseEnMemoria({ factura_proveedor: [{ id: 'f1', tenant_id: T, cfdi_uuid: 'u', total: 10, estado: 'pendiente', created_at: '2026-10-01T00:00:00Z', conceptos: 1 }] });
    estado.db.fallarProxima('factura_proveedor', 'select', NO_COLUMNA);
    const lista = await listarFacturasProveedor(T, 10);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ requiereRevision: false, fuenteDatos: null, tienePdf: false, entregaId: null, entregadaEn: null });
  });
});

describe('repo del buzón sin la 0530', () => {
  it('registrar el rastro sin la tabla NO lanza (el XML sigue entrando; el rastro se pierde y se dice en el log)', async () => {
    estado.db.fallarProxima('buzon_recepcion', 'insert', NO_TABLA);
    await expect(repo.registrarRecepcion(T, { emailId: 'e', nombre: 'a.xml', tipo: 'xml', bytes: 1, sha256: 'a'.repeat(64), estado: 'procesada' })).resolves.toBeUndefined();
  });

  it('el archivo previo sin la tabla es «no hay previo», no un error', async () => {
    estado.db.fallarProxima('buzon_recepcion', 'select', NO_TABLA);
    expect(await repo.recepcionPrevia(T, 'a'.repeat(64))).toBeNull();
  });

  it('guardar un PDF sin las columnas lanza BuzonSinMigrar (permanente para el archivo), y sin bucket también', async () => {
    estado.db.fallarProxima('factura_proveedor', 'insert', NO_COLUMNA);
    await expect(repo.guardarFacturaDePdf(T, { uuid: 'u', total: 1, subTotal: null, rfcEmisor: null, rfcReceptor: null, fecha: null, confianza: 0.9, fuente: 'pdf_texto', notas: [] } as never, null, { requiereRevision: false }))
      .rejects.toBeInstanceOf(repo.BuzonSinMigrar);
    await expect(repo.subirPdf(T, 'a'.repeat(64), new Uint8Array([1]))).rejects.toBeInstanceOf(repo.BuzonSinMigrar);
  });

  it('un XML duplicado sobre una base sin migrar: la factura existente se lee sin pdf_ruta y no hay nada que completar', async () => {
    estado.db = crearBaseEnMemoria({ factura_proveedor: [{ id: 'f1', tenant_id: T, cfdi_uuid: 'u', estado: 'pendiente', xml_crudo: '<x/>' }] });
    estado.db.fallarProxima('factura_proveedor', 'select', NO_COLUMNA);
    expect(await repo.facturaPorUuid(T, 'u')).toEqual({ id: 'f1', estado: 'pendiente', tieneXml: true, tienePdf: false });
    estado.db.fallarProxima('factura_proveedor', 'update', NO_COLUMNA);
    expect(await repo.completarFacturaConXml(T, 'u', { rfcEmisor: null, rfcReceptor: null, fecha: null, total: 1, conceptos: [] } as never, '<x/>', null, null)).toBe(false);
  });
});

describe('ingesta sin la 0530', () => {
  const PDF = new Uint8Array(Buffer.from('%PDF-1.4\nx'));
  function deps(sobre: Partial<DepsBuzon['repo']> = {}): DepsBuzon {
    return {
      repo: {
        registrarRecepcion: async () => {}, recepcionPrevia: async () => null,
        subirPdf: async () => { throw new repo.BuzonSinMigrar('falta el bucket'); },
        facturaPorUuid: async () => null, adjuntarPdfAFactura: async () => true, completarFacturaConXml: async () => false,
        guardarFacturaDePdf: async () => ({ ok: true, facturaId: 'f', receptorEsFlota: null }), ...sobre,
      },
      pdf: {
        leerTexto: async () => ({ ok: true, texto: 'Folio fiscal: aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee01\nTotal $10.00' }),
        imagenes: async () => [], vision: async () => { throw new Error('no debía'); },
      },
      estadoSat: async () => null, guardarFactura: async () => ({ ok: true, facturaId: 'f', receptorEsFlota: null }) as never,
      parseRep: () => null, ingerirRep: async () => ({ pendientes: 0 }) as never, ahoraMs: () => 0,
    };
  }
  const ctx = { tenantId: T, emailId: 'e', rfcFlota: null, finPresupuesto: 10_000_000 };

  it('un PDF que no se puede guardar es «ignorado» con su motivo: el correo NO se reintenta (0 caídas)', async () => {
    const r = await procesarCorreoBuzon(ctx, [{ nombre: 'f.pdf', bytes: PDF }], deps());
    expect(r.caidas).toBe(0);
    expect(r.ignoradas).toBe(1);
    expect(r.documentos[0].motivo).toMatch(/0530/);
  });

  it('un fallo REAL de la base (no de migración) sigue siendo transitorio: el correo se reintenta', async () => {
    const r = await procesarCorreoBuzon(ctx, [{ nombre: 'f.pdf', bytes: PDF }], deps({ subirPdf: async () => { throw new Error('conexión perdida'); } }));
    expect(r.caidas).toBe(1);
  });
});

describe('entrega al contador sin la 0531', () => {
  it('la configuración sin la tabla es «no disponible» (no «apagada con defaults» a secas) y el cron no tiene qué hacer', async () => {
    estado.db.fallarProxima('buzon_entrega_config', 'select', NO_TABLA);
    expect((await entregaRepo.leerConfigEntrega(T)).disponible).toBe(false);
    estado.db.fallarProxima('buzon_entrega_config', 'select', NO_TABLA);
    expect(await entregaRepo.flotasConEntregaAutomatica()).toEqual([]);
    estado.db.fallarProxima('buzon_entrega', 'select', NO_TABLA);
    expect(await entregaRepo.lotesParaEnviar(new Date())).toEqual([]);
    estado.db.fallarProxima('buzon_entrega', 'select', NO_TABLA);
    expect(await entregaRepo.listarLotes(T)).toEqual([]);
  });
});
