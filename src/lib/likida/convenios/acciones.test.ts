import { describe, it, expect, vi } from 'vitest';
import { archivarConvenioDelPanel, bytesParaLector, importarArchivoDelPanel, type DepsConvenios } from './acciones';
import { ConveniosNoDisponibles } from './repo';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));

const CSV = 'Cliente,Convenio,Categoría,Instrucción\nCliente Uno,Ruta norte,puerta,Puerta 3\n';
const CSV_DINERO = 'Cliente,Convenio,Tarifa modo,Tarifa precio\nCliente Uno,Ruta norte,por_viaje,5000\n';
const deps = (o: Partial<DepsConvenios> = {}): DepsConvenios => ({
  importar: vi.fn(async () => ({ ok: true as const, creados: 1, actualizados: 0, instrucciones: 1 })),
  estado: vi.fn(async () => true), ...o,
});
const bytes = (t: string): ArrayBuffer => new TextEncoder().encode(t).buffer as ArrayBuffer;

describe('importarArchivoDelPanel', () => {
  it('el jefe de tráfico importa instrucciones; el contador y un rol desconocido no', async () => {
    const d = deps();
    expect(await importarArchivoDelPanel({ tenantId: 't', rol: 'encargado' }, { bytes: bytes(CSV), texto: '' }, d)).toMatchObject({ ok: true, mensaje: expect.stringContaining('1 convenio nuevo') });
    for (const rol of ['contador', 'vendedor', 'raro']) {
      expect(await importarArchivoDelPanel({ tenantId: 't', rol }, { bytes: bytes(CSV), texto: '' }, d)).toEqual({ ok: false, error: expect.stringContaining('Solo el dueño') });
    }
    expect(d.importar).toHaveBeenCalledTimes(1);
  });

  it('el tenant sale de la sesión y el dinero solo se importa con permiso de finanzas', async () => {
    const d = deps();
    await importarArchivoDelPanel({ tenantId: 'flota-1', rol: 'flota_admin' }, { bytes: bytes(CSV_DINERO), texto: '' }, d);
    expect(d.importar).toHaveBeenCalledWith('flota-1', expect.any(Array), { conFinanzas: true });
    const sinDinero = deps();
    const r = await importarArchivoDelPanel({ tenantId: 'flota-1', rol: 'encargado' }, { bytes: bytes(CSV_DINERO), texto: '' }, sinDinero);
    expect(r).toMatchObject({ ok: false, detalles: [expect.stringContaining('solo quien ve finanzas')] });
    expect(sinDinero.importar).not.toHaveBeenCalled();
  });

  it('acepta el contenido pegado y dice qué corregir fila por fila (todo o nada)', async () => {
    const d = deps();
    const r = await importarArchivoDelPanel({ tenantId: 't', rol: 'flota_admin' }, { bytes: null, texto: 'Cliente,Convenio,Categoría,Instrucción\nA,x,inventada,y\n,x,puerta,z\n' }, d);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('2 problemas') });
    expect((r as { detalles: string[] }).detalles[0]).toMatch(/^Fila 2:/);
    expect(d.importar).not.toHaveBeenCalled();
  });

  it('sin archivo ni texto lo pide; un archivo enorme se rechaza', async () => {
    expect(await importarArchivoDelPanel({ tenantId: 't', rol: 'flota_admin' }, { bytes: null, texto: '  ' }, deps())).toMatchObject({ ok: false, error: expect.stringContaining('Sube un archivo') });
    expect(await importarArchivoDelPanel({ tenantId: 't', rol: 'flota_admin' }, { bytes: new ArrayBuffer(5 * 1024 * 1024), texto: '' }, deps())).toMatchObject({ ok: false, error: expect.stringContaining('4 MB') });
  });

  it('lo que la base rechaza (cliente inexistente) se dice con su fila, y la base sin migrar se explica', async () => {
    const r = await importarArchivoDelPanel({ tenantId: 't', rol: 'flota_admin' }, { bytes: bytes(CSV), texto: '' },
      deps({ importar: async () => ({ ok: false as const, errores: [{ fila: 2, motivo: 'El cliente «X» no existe en tu flota.' }] }) }));
    expect(r).toMatchObject({ ok: false, detalles: ['Fila 2: El cliente «X» no existe en tu flota.'] });
    const sin = await importarArchivoDelPanel({ tenantId: 't', rol: 'flota_admin' }, { bytes: bytes(CSV), texto: '' }, deps({ importar: async () => { throw new ConveniosNoDisponibles(); } }));
    expect(sin).toMatchObject({ ok: false, error: expect.stringContaining('0580') });
    const roto = await importarArchivoDelPanel({ tenantId: 't', rol: 'flota_admin' }, { bytes: bytes(CSV), texto: '' }, deps({ importar: async () => { throw new Error('boom'); } }));
    expect(roto).toMatchObject({ ok: false, error: expect.stringContaining('no duplica') });
  });
});

describe('archivarConvenioDelPanel', () => {
  const ID = '11111111-2222-3333-4444-555555555555';
  it('archiva y reactiva con el tenant de la sesión; valida el id y el permiso', async () => {
    const d = deps();
    expect(await archivarConvenioDelPanel({ tenantId: 'flota-1', rol: 'encargado' }, ID, false, d)).toMatchObject({ ok: true, mensaje: expect.stringContaining('archivado') });
    expect(d.estado).toHaveBeenCalledWith('flota-1', ID, false);
    expect(await archivarConvenioDelPanel({ tenantId: 't', rol: 'encargado' }, 'no-es-uuid', false, d)).toMatchObject({ ok: false });
    expect(await archivarConvenioDelPanel({ tenantId: 't', rol: 'contador' }, ID, false, d)).toMatchObject({ ok: false, error: expect.stringContaining('Solo el dueño') });
    expect(await archivarConvenioDelPanel({ tenantId: 't', rol: 'encargado' }, ID, true, deps({ estado: async () => false }))).toMatchObject({ ok: false, error: 'Ese convenio ya no existe.' });
  });
});

describe('la codificación del archivo', () => {
  it('un CSV UTF-8 SIN BOM (acentos y eñes) se lee bien: la columna «Categoría» se reconoce y el texto no sale en mojibake', async () => {
    const d = deps();
    const csv = 'Cliente,Convenio,Categoría,Instrucción\nCliente Uno,Ruta norte,puerta,Entrada por la señal azul\n';
    expect(await importarArchivoDelPanel({ tenantId: 't', rol: 'flota_admin' }, { bytes: bytes(csv), texto: '' }, d)).toMatchObject({ ok: true });
    const enviados = (d.importar as ReturnType<typeof vi.fn>).mock.calls[0][1] as Array<{ instrucciones: Array<{ texto: string }> }>;
    expect(enviados[0].instrucciones[0].texto).toBe('Entrada por la señal azul');
  });

  it('un CSV legado en Windows-1252 también se lee bien', async () => {
    const d = deps();
    const latin1 = Uint8Array.from([...'Cliente,Convenio,Categor\xEDa,Instrucci\xF3n\nCliente Uno,Ruta norte,puerta,Se\xF1al azul\n'].map((c) => c.charCodeAt(0)));
    expect(await importarArchivoDelPanel({ tenantId: 't', rol: 'flota_admin' }, { bytes: latin1.buffer as ArrayBuffer, texto: '' }, d)).toMatchObject({ ok: true });
    const enviados = (d.importar as ReturnType<typeof vi.fn>).mock.calls[0][1] as Array<{ instrucciones: Array<{ texto: string }> }>;
    expect(enviados[0].instrucciones[0].texto).toBe('Señal azul');
  });

  it('no toca un .xlsx (zip) ni un archivo que ya trae BOM', () => {
    const zip = Uint8Array.from([0x50, 0x4b, 3, 4, 1, 2]).buffer as ArrayBuffer;
    expect(bytesParaLector(zip)).toBe(zip);
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, 0x41]).buffer as ArrayBuffer;
    expect(bytesParaLector(bom)).toBe(bom);
  });
});

describe('un Excel real (.xlsx)', () => {
  it('se importa igual que el CSV: fechas de Excel, acentos y varias hojas (solo la primera)', async () => {
    const { utils, write } = await import('xlsx');
    const libro = utils.book_new();
    utils.book_append_sheet(libro, utils.aoa_to_sheet([
      ['Cliente', 'Convenio', 'Vigente desde', 'Categoría', 'Instrucción', 'Lugar'],
      ['Cliente Uno', 'Ruta norte', 46_082, 'reportarse', 'Con el Sr. Muñoz, caseta 1', 'carga'],
    ]), 'Convenios');
    utils.book_append_sheet(libro, utils.aoa_to_sheet([['otra', 'hoja']]), 'Notas');
    const xlsx = write(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const d = deps();
    expect(await importarArchivoDelPanel({ tenantId: 't', rol: 'encargado' }, { bytes: xlsx, texto: '' }, d)).toMatchObject({ ok: true });
    const [c] = (d.importar as ReturnType<typeof vi.fn>).mock.calls[0][1] as Array<{ vigenteDesde: string; instrucciones: Array<{ texto: string; lugar: string }> }>;
    expect(c.vigenteDesde).toBe('2026-03-01');
    expect(c.instrucciones).toEqual([expect.objectContaining({ texto: 'Con el Sr. Muñoz, caseta 1', lugar: 'origen' })]);
  });
});
