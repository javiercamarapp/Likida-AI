import { describe, it, expect, vi } from 'vitest';
import { archivarConvenioDelPanel, bytesParaLector, corregirConvenioDelViajeDelPanel, importarArchivoDelPanel, type DepsConvenios } from './acciones';
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

describe('corregirConvenioDelViajeDelPanel', () => {
  const VIAJE = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d0aa';
  const CONV = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
  const deps = (o: Partial<import('./acciones').DepsCorregirConvenio> = {}) => ({
    corregir: vi.fn(async () => ({ estado: 'ok' as const, convenioNombre: 'Ruta norte', instrucciones: 2 })),
    enviar: vi.fn(async () => ({ estado: 'enviado' as const, canal: 'texto' as const })),
    ...o,
  });
  const dueno = { tenantId: 't1', rol: 'flota_admin' };

  it('solo el dueño y el jefe de tráfico corrigen: el contador y los demás no tocan nada', async () => {
    for (const rol of ['contador', 'vendedor', 'inventado', '']) {
      const d = deps();
      const r = await corregirConvenioDelViajeDelPanel({ tenantId: 't1', rol }, { viajeId: VIAJE, convenioId: CONV, reenviar: true }, d);
      expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/dueño de la flota o el jefe de tráfico/) });
      expect(d.corregir).not.toHaveBeenCalled();
      expect(d.enviar).not.toHaveBeenCalled();
    }
  });

  it('corrige con el tenant de la SESIÓN, en minúsculas, y manda de nuevo las instrucciones si se pidió', async () => {
    const d = deps();
    const r = await corregirConvenioDelViajeDelPanel(dueno, { viajeId: VIAJE.toUpperCase(), convenioId: CONV, reenviar: true }, d);
    expect(d.corregir).toHaveBeenCalledWith('t1', VIAJE, CONV, { reenviar: true });
    expect(d.enviar).toHaveBeenCalledWith('t1', VIAJE);
    expect(r).toMatchObject({ ok: true, mensaje: expect.stringMatching(/«Ruta norte» \(2 instrucciones\).*Ya se le mandaron al operador.*corrección manual/s) });
  });

  it('sin «reenviar» solo corrige: no manda nada', async () => {
    const d = deps();
    const r = await corregirConvenioDelViajeDelPanel(dueno, { viajeId: VIAJE, convenioId: CONV, reenviar: false }, d);
    expect(d.enviar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true });
  });

  it('«sin convenio» (vacío) guarda null y nunca manda instrucciones, aunque se pida reenviar', async () => {
    const d = deps({ corregir: vi.fn(async () => ({ estado: 'ok' as const, convenioNombre: null, instrucciones: 0 })) });
    const r = await corregirConvenioDelViajeDelPanel(dueno, { viajeId: VIAJE, convenioId: '', reenviar: true }, d);
    expect(d.corregir).toHaveBeenCalledWith('t1', VIAJE, null, { reenviar: true });
    expect(d.enviar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, mensaje: expect.stringContaining('sin convenio') });
  });

  it('un id que no es UUID se rechaza sin tocar la base', async () => {
    const d = deps();
    expect(await corregirConvenioDelViajeDelPanel(dueno, { viajeId: 'x', convenioId: CONV, reenviar: false }, d)).toMatchObject({ ok: false, error: 'No reconozco el viaje.' });
    expect(await corregirConvenioDelViajeDelPanel(dueno, { viajeId: VIAJE, convenioId: "1'; drop", reenviar: false }, d)).toMatchObject({ ok: false, error: 'No reconozco el convenio.' });
    expect(d.corregir).not.toHaveBeenCalled();
  });

  it('dice en palabras cada rechazo del repositorio', async () => {
    for (const [estado, texto] of [['viaje_no_encontrado', /ya no existe/], ['viaje_cerrado', /liquidado/], ['sin_cliente', /sin cliente/], ['convenio_no_valido', /no es de este cliente o está archivado/]] as const) {
      const d = deps({ corregir: vi.fn(async () => ({ estado })) });
      expect(await corregirConvenioDelViajeDelPanel(dueno, { viajeId: VIAJE, convenioId: CONV, reenviar: true }, d)).toMatchObject({ ok: false, error: expect.stringMatching(texto) });
      expect(d.enviar).not.toHaveBeenCalled();
    }
  });

  it('un envío rechazado o sin operador se cuenta honesto: la corrección SÍ quedó, el mensaje no se promete', async () => {
    for (const [estado, texto] of [['sin_destinatario', /no tiene operador con teléfono/], ['rechazado', /no aceptó el mensaje/]] as const) {
      const d = deps({ enviar: vi.fn(async () => (estado === 'rechazado' ? { estado, motivo: 'x', reintentable: false } : { estado })) });
      const r = await corregirConvenioDelViajeDelPanel(dueno, { viajeId: VIAJE, convenioId: CONV, reenviar: true }, d);
      expect(r).toMatchObject({ ok: true, mensaje: expect.stringMatching(texto) });
      expect((r as { mensaje: string }).mensaje).not.toContain('Ya se le mandaron');
    }
  });

  it('la base sin la 0580 se dice; un fallo inesperado no filtra el error crudo', async () => {
    const sin = deps({ corregir: vi.fn(async () => { throw new ConveniosNoDisponibles(); }) });
    expect(await corregirConvenioDelViajeDelPanel(dueno, { viajeId: VIAJE, convenioId: CONV, reenviar: false }, sin)).toMatchObject({ ok: false, error: expect.stringContaining('0580') });
    const roto = deps({ corregir: vi.fn(async () => { throw new Error('connection reset 10.0.0.5'); }) });
    const r = await corregirConvenioDelViajeDelPanel(dueno, { viajeId: VIAJE, convenioId: CONV, reenviar: false }, roto);
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).not.toContain('10.0.0.5');
  });
});
