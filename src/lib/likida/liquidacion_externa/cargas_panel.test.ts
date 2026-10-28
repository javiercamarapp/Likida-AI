import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('la base no debe tocarse en estas pruebas'); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { cargarDesglosesDePanel, cargarContactosDePanel, leerArchivoCarga, MAX_ARCHIVO_CARGA_BYTES } = await import('./cargas_panel');
const { importarContactosDeArchivo } = await import('./contactos_archivo');
type ResultadoDesgloses = import('./desglose_csv').ResultadoImportacionDesgloses;

// Ola 1 · A1 — de un archivo subido en el panel al mensaje que ve la oficina. Todo sintético.
const T = '00000000-0000-4000-8000-000000000001';
const bytes = (t: string) => new TextEncoder().encode(t);
const archivo = (t: string, nombre = 'a.csv') => ({ nombre, bytes: bytes(t) });

describe('leerArchivoCarga', () => {
  it('sin archivo, vacío o demasiado grande: motivo llano y no se lee nada', async () => {
    const fd = new FormData();
    expect(await leerArchivoCarga(fd)).toEqual({ ok: false, error: 'Elige el archivo (CSV o Excel).' });
    fd.set('archivo', new File([''], 'vacio.csv'));
    expect((await leerArchivoCarga(fd)).ok).toBe(false);
    fd.set('archivo', new File([new Uint8Array(MAX_ARCHIVO_CARGA_BYTES + 1)], 'grande.csv'));
    expect(await leerArchivoCarga(fd)).toMatchObject({ ok: false, error: expect.stringContaining('4 MB') });
  });

  it('un archivo válido devuelve nombre y bytes', async () => {
    const fd = new FormData();
    fd.set('archivo', new File(['a;b'], 'x.csv'));
    const r = await leerArchivoCarga(fd);
    expect(r.ok && r.archivo.nombre).toBe('x.csv');
    expect(r.ok && new TextDecoder().decode(r.archivo.bytes)).toBe('a;b');
  });
});

describe('cargarDesglosesDePanel', () => {
  const resultado = (extra: Partial<ResultadoDesgloses> = {}): ResultadoDesgloses =>
    ({ recibidas: 0, idempotentes: 0, retenidas: 0, correcciones: 0, excepciones: [], problemas: [], renglonesEnCero: 0, ...extra });

  it('resume en lenguaje llano lo recibido, lo repetido, lo retenido y los problemas, con detalle por clave (sin importes)', async () => {
    const importar = vi.fn(async () => resultado({
      recibidas: 3, idempotentes: 2, retenidas: 1, excepciones: [{ clave: 'BIT-T1-B-9', motivo: 'operador_no_encontrado' }],
      problemas: [{ clave: 'BIT-T1-B-8', fila: 4, motivo: 'periodo ilegible' }],
    }));
    const f = await cargarDesglosesDePanel(T, archivo('x'), importar as never);
    expect(importar).toHaveBeenCalledWith(T, 'a.csv', expect.any(Uint8Array));
    expect(f.aviso).toBe('Carga terminada: 3 recibidos / 2 ya estaban / 1 retenidos / 1 con excepción / 1 con problema.');
    expect(f.detalle).toBe('BIT-T1-B-9: operador_no_encontrado\nBIT-T1-B-8: periodo ilegible');
    expect(f.error).toBeUndefined();
  });

  it('un archivo que no se pudo leer es error (no aviso)', async () => {
    const f = await cargarDesglosesDePanel(T, archivo('x'), (async () => resultado({ error: 'El archivo no parece un export de bitácoras.' })) as never);
    expect(f).toEqual({ error: 'El archivo no parece un export de bitácoras.' });
  });

  it('se acabó el tiempo: dice cuántos faltan y que repetir el archivo es seguro (error, no aviso)', async () => {
    const f = await cargarDesglosesDePanel(T, archivo('x'), (async () => resultado({ recibidas: 10, sinProcesar: 4 })) as never);
    expect(f.error).toContain('faltan 4 por procesar');
    expect(f.error).toContain('no se envía dos veces');
    expect(f.aviso).toBeUndefined();
  });

  it('una excepción inesperada no se enseña: mensaje genérico', async () => {
    const f = await cargarDesglosesDePanel(T, archivo('x'), (async () => { throw new Error('select * from secreto'); }) as never);
    expect(f.error).toContain('repetirlo es seguro');
    expect(JSON.stringify(f)).not.toContain('secreto');
  });

  it('de punta a punta con el importador real: un export sin la columna de monto se rechaza sin tocar la base', async () => {
    const f = await cargarDesglosesDePanel(T, archivo('nombre;edad\nAna;3'));
    expect(f.error).toMatch(/no parece un export de bitácoras/);
  });
});

describe('cargarContactosDePanel + importarContactosDeArchivo', () => {
  it('lee el CSV con ; y aplica por el puerto: nunca crea operadores, no repite correos en el resumen', async () => {
    const guardados: Array<{ id: string; cambios: Record<string, unknown> }> = [];
    const puerto = {
      buscarOperadores: async (n: readonly string[]) => new Map(n.filter((x) => x === 'E-1').map((x) => [x, [{ id: 'o-1', correo: null, coordinadorId: null }]])),
      asegurarCoordinador: async () => ({ id: 'c-1', creado: true }),
      guardarContacto: async (id: string, cambios: Record<string, unknown>) => { guardados.push({ id, cambios }); },
    };
    const csv = 'numero_empleado;correo;coordinador_nombre;coordinador_correo\nE-1;ana@ejemplo.test;Coord Uno;coord@ejemplo.test\nE-9;luis@ejemplo.test;;\nE-3;malo;;';
    const r = await importarContactosDeArchivo(T, 'contactos.csv', bytes(csv), puerto as never);
    expect(r.error).toBeUndefined();
    expect(guardados).toEqual([{ id: 'o-1', cambios: { correo: 'ana@ejemplo.test', coordinadorId: 'c-1' } }]);
    expect(r.resumen).toBe('1 actualizados / 1 sin operador / 1 inválidos / 1 coordinadores nuevos');
    expect(r.detalle.join(' ')).not.toContain('ejemplo.test');
  });

  it('el panel lo convierte en aviso; un archivo sin la columna de número de empleado es error', async () => {
    const puerto = { buscarOperadores: async () => new Map(), asegurarCoordinador: async () => ({ id: 'c', creado: false }), guardarContacto: async () => {} };
    const ok = await cargarContactosDePanel(T, archivo('numero_empleado;correo\nE-1;ana@ejemplo.test'), ((t: string, n: string, b: Uint8Array) => importarContactosDeArchivo(t, n, b, puerto as never)) as never);
    expect(ok.aviso).toBe('Correos cargados: 0 actualizados / 1 sin operador / 0 inválidos.');
    expect(JSON.stringify(ok)).not.toContain('ana@');
    const mal = await cargarContactosDePanel(T, archivo('nombre;telefono\nAna;1'), ((t: string, n: string, b: Uint8Array) => importarContactosDeArchivo(t, n, b, puerto as never)) as never);
    expect(mal.error).toMatch(/número de empleado/);
  });

  it('un formato que no es CSV ni Excel se rechaza con motivo', async () => {
    const r = await importarContactosDeArchivo(T, 'contactos.pdf', bytes('x'), { buscarOperadores: async () => new Map() } as never);
    expect(r.error).toMatch(/No sé leer/);
    expect(r.informe).toBeNull();
  });
});
