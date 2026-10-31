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
    ({ recibidas: 0, idempotentes: 0, retenidas: 0, omitidas: 0, correos: 0, correcciones: 0, excepciones: [], problemas: [], renglonesEnCero: 0, ...extra });
  const cfgConCorte = { leerConfig: async () => ({ activa: true, canal: 'correo', noEnviarAntes: '2026-11-02' }) };
  const CONFIRMAR = (correos: number | null) => ({ tipo: 'confirmar' as const, correos });

  /** Importador falso con dos modos: la vista previa (simular) y la carga real, para saber qué se escribió. */
  function importadorDoble(previa: ResultadoDesgloses, real: ResultadoDesgloses = previa) {
    const llamadas: Array<{ simular: boolean }> = [];
    const importar = vi.fn(async (_t: string, _n: string, _b: Uint8Array, _d: unknown, o?: { simular?: boolean }) => {
      llamadas.push({ simular: o?.simular === true });
      return o?.simular ? previa : real;
    });
    return { importar: importar as never, llamadas };
  }

  it('A1-01: la vista previa muestra «N desgloses / M correos», NO escribe nada (solo simula) y dice cómo confirmar', async () => {
    const { importar, llamadas } = importadorDoble(resultado({ recibidas: 50, omitidas: 20, correos: 120, idempotentes: 3 }));
    const f = await cargarDesglosesDePanel(T, archivo('x'), { tipo: 'previa' }, importar, cfgConCorte);
    expect(llamadas).toEqual([{ simular: true }]);
    expect(f.aviso).toContain('50 desgloses / 120 correos');
    expect(f.aviso).toContain('20 se guardan sin enviar');
    expect(f.aviso).toContain('3 ya estaban');
    expect(f.aviso).toContain('Nada se guardó ni se envió');
    expect(f.aviso).toContain('escribe 120');
    expect(f.error).toBeUndefined();
  });

  it('A1-01: subir SIN el número de correos (o con uno equivocado) no sube nada y dice el número correcto', async () => {
    for (const escrito of [null, 7]) {
      const { importar, llamadas } = importadorDoble(resultado({ recibidas: 10, correos: 40 }));
      const f = await cargarDesglosesDePanel(T, archivo('x'), CONFIRMAR(escrito), importar, cfgConCorte);
      expect(f.error).toContain('No se subió nada');
      expect(f.error).toContain('40 correos');
      expect(llamadas).toEqual([{ simular: true }]); // la carga real NUNCA corrió
    }
  });

  it('A1-01: con el número exacto sí sube (vista previa + carga real) y reporta correos programados y omitidos', async () => {
    const { importar, llamadas } = importadorDoble(resultado({ recibidas: 10, correos: 40 }), resultado({ recibidas: 10, correos: 40, omitidas: 2 }));
    const f = await cargarDesglosesDePanel(T, archivo('x'), CONFIRMAR(40), importar, cfgConCorte);
    expect(llamadas).toEqual([{ simular: true }, { simular: false }]);
    expect(f.aviso).toBe('Carga terminada: 10 recibidos / 0 ya estaban / 40 correos programados / 2 sin enviar (anteriores al corte o ya enviados por el origen).');
  });

  it('A1-01: si no saldría ningún correo (todo omitido) no hace falta escribir el número', async () => {
    const { importar, llamadas } = importadorDoble(resultado({ recibidas: 50, omitidas: 50, correos: 0 }));
    const f = await cargarDesglosesDePanel(T, archivo('x'), CONFIRMAR(null), importar, cfgConCorte);
    expect(llamadas).toEqual([{ simular: true }, { simular: false }]);
    expect(f.aviso).toContain('50 recibidos');
    expect(f.error).toBeUndefined();
  });

  it('A1-01: envío activo y SIN fecha de corte => advertencia explícita en la vista previa y al fallar la confirmación', async () => {
    const sinCorte = { leerConfig: async () => ({ activa: true, canal: 'correo', noEnviarAntes: null }) };
    const { importar } = importadorDoble(resultado({ recibidas: 5, correos: 20 }));
    const previa = await cargarDesglosesDePanel(T, archivo('x'), { tipo: 'previa' }, importar, sinCorte);
    expect(previa.detalle).toContain('no hay fecha de corte');
    const falla = await cargarDesglosesDePanel(T, archivo('x'), CONFIRMAR(null), importar, sinCorte);
    expect(falla.detalle).toContain('no hay fecha de corte');
    // con corte no hay advertencia
    expect((await cargarDesglosesDePanel(T, archivo('x'), { tipo: 'previa' }, importar, cfgConCorte)).detalle).toBeUndefined();
    // H759-3: con el envío APAGADO y sin corte también se advierte (lo que se suba queda esperando y saldría al activar); con corte, no
    const apagado = { leerConfig: async () => ({ activa: false, canal: 'correo', noEnviarAntes: null }) };
    const p2 = await cargarDesglosesDePanel(T, archivo('x'), { tipo: 'previa' }, importar, apagado);
    expect(p2.detalle).toContain('no hay fecha de corte');
    expect(p2.detalle).toContain('si activas el envío');
    const apagadoConCorte = { leerConfig: async () => ({ activa: false, canal: 'correo', noEnviarAntes: '2026-11-02' }) };
    expect((await cargarDesglosesDePanel(T, archivo('x'), { tipo: 'previa' }, importar, apagadoConCorte)).detalle).toBeUndefined();
    const soloWhatsapp = { leerConfig: async () => ({ activa: false, canal: 'whatsapp', noEnviarAntes: null }) };
    expect((await cargarDesglosesDePanel(T, archivo('x'), { tipo: 'previa' }, importar, soloWhatsapp)).detalle).toBeUndefined();
  });

  it('A1-01: si no se pudo leer la configuración se advierte (fail-cerrado en el texto, no se asume que hay corte)', async () => {
    const { importar } = importadorDoble(resultado({ recibidas: 5, correos: 20 }));
    const f = await cargarDesglosesDePanel(T, archivo('x'), { tipo: 'previa' }, importar, { leerConfig: async () => null });
    expect(f.detalle).toContain('No pude leer la configuración');
  });

  it('A1-01: un archivo demasiado grande para contarlo de una vez no se sube', async () => {
    const { importar, llamadas } = importadorDoble(resultado({ recibidas: 100, correos: 50, sinProcesar: 30 }));
    const f = await cargarDesglosesDePanel(T, archivo('x'), CONFIRMAR(50), importar, cfgConCorte);
    expect(f.error).toContain('Pártelo');
    expect(llamadas).toEqual([{ simular: true }]);
  });

  it('resume en lenguaje llano lo recibido, lo repetido, lo retenido y los problemas, con detalle por clave (sin importes)', async () => {
    const real = resultado({
      recibidas: 3, idempotentes: 2, retenidas: 1, excepciones: [{ clave: 'BIT-T1-B-9', motivo: 'operador_no_encontrado' }],
      problemas: [{ clave: 'BIT-T1-B-8', fila: 4, motivo: 'periodo ilegible' }],
    });
    const { importar } = importadorDoble(real);
    const f = await cargarDesglosesDePanel(T, archivo('x'), CONFIRMAR(null), importar, cfgConCorte);
    expect(f.aviso).toBe('Carga terminada: 3 recibidos / 2 ya estaban / 0 correos programados / 1 retenidos / 1 con excepción / 1 con problema.');
    expect(f.detalle).toBe('BIT-T1-B-9: operador_no_encontrado\nBIT-T1-B-8: periodo ilegible');
    expect(f.error).toBeUndefined();
  });

  it('un archivo que no se pudo leer es error (no aviso)', async () => {
    const { importar } = importadorDoble(resultado({ error: 'El archivo no parece un export de bitácoras.' }));
    expect(await cargarDesglosesDePanel(T, archivo('x'), { tipo: 'previa' }, importar, cfgConCorte)).toEqual({ error: 'El archivo no parece un export de bitácoras.' });
  });

  it('se acabó el tiempo en la carga real: dice cuántos faltan y que repetir el archivo es seguro (error, no aviso)', async () => {
    const { importar } = importadorDoble(resultado({ recibidas: 10, correos: 0 }), resultado({ recibidas: 10, sinProcesar: 4 }));
    const f = await cargarDesglosesDePanel(T, archivo('x'), CONFIRMAR(null), importar, cfgConCorte);
    expect(f.error).toContain('faltan 4 por procesar');
    expect(f.error).toContain('no se envía dos veces');
    expect(f.aviso).toBeUndefined();
  });

  it('una excepción inesperada no se enseña: mensaje genérico', async () => {
    const f = await cargarDesglosesDePanel(T, archivo('x'), { tipo: 'previa' }, (async () => { throw new Error('select * from secreto'); }) as never, cfgConCorte);
    expect(f.error).toContain('repetirlo es seguro');
    expect(JSON.stringify(f)).not.toContain('secreto');
  });

  it('de punta a punta con el importador real: un export sin la columna de monto se rechaza sin tocar la base', async () => {
    const f = await cargarDesglosesDePanel(T, archivo('nombre;edad\nAna;3'), { tipo: 'previa' }, undefined, cfgConCorte);
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
