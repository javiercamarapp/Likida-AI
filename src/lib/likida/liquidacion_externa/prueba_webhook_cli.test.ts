import { describe, it, expect, vi } from 'vitest';
import { prepararMuestraTms } from './desglose_muestra_recepcion';
import { TIPOS_OPERADOR } from './desglose_contrato';
import {
  ejecutarPrueba, formatearResumen, generarBitacoras, normalizarUrl, operadoresFicticios, parsearArgumentos, validarPadron, RUTA_DESGLOSES,
  type ArgsPrueba, type DepsPrueba,
} from './prueba_webhook_cli';

const TOKEN = 'llv_secreto_de_prueba_123';
const args = (extra: string[] = []) => {
  const r = parsearArgumentos(['--url', 'https://ejemplo.test', ...extra]);
  if (!r.ok) throw new Error(r.error);
  return r.args;
};

describe('argumentos', () => {
  it('simulación por omisión y URL completada', () => {
    const a = args();
    expect(a.simular).toBe(true);
    expect(a.url).toBe(`https://ejemplo.test${RUTA_DESGLOSES}`);
    expect(a.n).toBe(5);
  });
  it('escribir de verdad exige las dos banderas', () => {
    expect(parsearArgumentos(['--url', 'https://e.test', '--real']).ok).toBe(false);
    expect(parsearArgumentos(['--url', 'https://e.test', '--confirmo-escritura']).ok).toBe(false);
    expect(args(['--real', '--confirmo-escritura']).simular).toBe(false);
  });
  it('rechaza el token por argumento, http fuera de localhost, credenciales en la URL y rangos', () => {
    expect(parsearArgumentos(['--url', 'https://e.test', '--token', 'x']).ok).toBe(false);
    expect(normalizarUrl('http://e.test').ok).toBe(false);
    expect(normalizarUrl('http://localhost:3000').ok).toBe(true);
    expect(normalizarUrl('https://u:p@e.test').ok).toBe(false);
    expect(normalizarUrl('https://e.test/?x=1').ok).toBe(false);
    expect(parsearArgumentos(['--url', 'https://e.test', '--n', '0']).ok).toBe(false);
    expect(parsearArgumentos(['--url', 'https://e.test', '--lote', '101']).ok).toBe(false);
    expect(parsearArgumentos(['--n', '5']).ok).toBe(false);
  });
  it('no duplica la ruta si ya viene completa', () => {
    const u = normalizarUrl(`https://e.test${RUTA_DESGLOSES}/`);
    expect(u.ok && u.url).toBe(`https://e.test${RUTA_DESGLOSES}`);
  });
});

describe('generación sintética', () => {
  it('es determinista por semilla y distinta entre semillas', () => {
    expect(generarBitacoras({ n: 10, semilla: 3 })).toEqual(generarBitacoras({ n: 10, semilla: 3 }));
    expect(generarBitacoras({ n: 10, semilla: 3 })).not.toEqual(generarBitacoras({ n: 10, semilla: 4 }));
  });
  it('70 bitácoras: los seis tipos, ids únicos, ficticios y póliza ausente cada décima', () => {
    const b = generarBitacoras({ n: 70, semilla: 1 });
    expect(b).toHaveLength(70);
    expect(new Set(b.map((x) => x.BitacoraID)).size).toBe(70);
    expect(new Set(b.map((x) => x.TipoOperador))).toEqual(new Set(TIPOS_OPERADOR));
    expect(b.every((x) => String(x.BitacoraID).startsWith('PRB-'))).toBe(true);
    expect(b.filter((x) => x.Poliza === null)).toHaveLength(7);
  });
  it('pasan SIN revisión por la recepción real de muestra-tms (el generador no se desvía del contrato)', () => {
    const b = generarBitacoras({ n: 70, semilla: 1, padron: operadoresFicticios(40) });
    const r = prepararMuestraTms({ formato: 'muestra-tms', version: 1, bitacoras: b }, operadoresFicticios(40));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.revisiones).toEqual([]);
      expect(r.desgloses).toHaveLength(70);
    }
  });
  it('con un padrón que no los conoce salen en revisión (lo esperado en la etapa A)', () => {
    const r = prepararMuestraTms({ formato: 'muestra-tms', version: 1, bitacoras: generarBitacoras({ n: 3, semilla: 1 }) }, [{ numeroEmpleado: '1', nombre: 'Otro' }]);
    expect(r.ok && r.revisiones.length).toBe(3);
  });
  it('valida el padrón de entrada', () => {
    expect(validarPadron([]).ok).toBe(false);
    expect(validarPadron([{ numeroEmpleado: '1' }]).ok).toBe(false);
    expect(validarPadron([{ numeroEmpleado: '1', nombre: 'A' }]).ok).toBe(true);
  });
});

function deps(responder: (cuerpo: { bitacoras: Array<{ BitacoraID: string }> }, h: Record<string, string>) => { status: number; json: unknown }): { d: DepsPrueba; salida: string[]; f: ReturnType<typeof vi.fn> } {
  const salida: string[] = [];
  const f = vi.fn(async (_u: unknown, init: { headers: Record<string, string>; body: string }) => {
    const r = responder(JSON.parse(init.body), init.headers);
    return { ok: r.status < 300, status: r.status, json: async () => r.json } as unknown as Response;
  });
  const d: DepsPrueba = { leerToken: async () => TOKEN, fetch: f as unknown as typeof fetch, leerArchivo: async () => '[]', escribir: (l) => salida.push(l) };
  return { d, salida, f };
}
const todoRecibida = (c: { bitacoras: Array<{ BitacoraID: string }> }) => ({
  status: 200, json: { datos: { resultados: c.bitacoras.map((b, i) => ({ indice: i, bitacora: b.BitacoraID, estado: 'recibida' })) } },
});

describe('ejecución', () => {
  it('dry-run: no pide token ni toca la red', async () => {
    const { d, f, salida } = deps(todoRecibida);
    const leer = vi.fn(async () => TOKEN);
    const r = await ejecutarPrueba(args(['--dry-run']), { ...d, leerToken: leer });
    expect(r.codigo).toBe(0);
    expect(leer).not.toHaveBeenCalled(); expect(f).not.toHaveBeenCalled();
    expect(salida.join('\n')).toContain('PRB-1-0001');
  });
  it('70 bitácoras en lotes de 35: 2 peticiones, cabecera de simulación y token solo en Authorization', async () => {
    const { d, f, salida } = deps(todoRecibida);
    const r = await ejecutarPrueba(args(['--n', '70']), d);
    expect(f).toHaveBeenCalledTimes(2);
    const h = (f.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(h['likida-simular']).toBe('si');
    expect(h.authorization).toBe(`Bearer ${TOKEN}`);
    expect(r.resumen).toMatchObject({ enviadas: 70, aceptadas: 70, duplicadas: 0, rechazadas: 0, modo: 'simulacion' });
    expect(salida.join('\n')).not.toContain(TOKEN);
  });
  it('modo real no manda la cabecera de simulación', async () => {
    const { d, f } = deps(todoRecibida);
    await ejecutarPrueba(args(['--n', '2', '--real', '--confirmo-escritura']), d);
    expect((f.mock.calls[0][1] as { headers: Record<string, string> }).headers['likida-simular']).toBeUndefined();
  });
  it('clasifica aceptadas, duplicadas y rechazadas con su causa', async () => {
    const { d } = deps((c) => ({
      status: 200,
      json: { datos: { resultados: c.bitacoras.map((_, i) => (i === 0 ? { estado: 'recibida' } : i === 1 ? { estado: 'retenida', motivos: [{ codigo: 'sin_poliza' }] }
        : i === 2 ? { estado: 'idempotente' } : i === 3 ? { estado: 'en_revision', motivos: [{ codigo: 'operador_no_encontrado' }] } : { estado: 'no_guardada', motivos: [{ codigo: 'sin_poliza' }] })) } },
    }));
    const r = await ejecutarPrueba(args(['--n', '5']), d);
    expect(r.resumen).toMatchObject({ aceptadas: 2, duplicadas: 1, rechazadas: 2, causas: { operador_no_encontrado: 1, sin_poliza: 1 } });
  });
  it('un error HTTP se reporta con su código, sin el token, y el código de salida es 2', async () => {
    const { d, salida } = deps(() => ({ status: 401, json: { error: { codigo: 'no_autenticado', mensaje: `la llave ${TOKEN} no sirve` } } }));
    const r = await ejecutarPrueba(args(['--n', '3']), d);
    expect(r.codigo).toBe(2);
    expect(r.resumen?.fallos[0]).toMatchObject({ status: 401, codigo: 'no_autenticado' });
    expect(r.resumen?.causas).toEqual({ no_autenticado: 3 });
    expect(salida.join('\n')).not.toContain(TOKEN);
  });
  it('red caída: no revienta y lo dice', async () => {
    const { d } = deps(todoRecibida);
    const r = await ejecutarPrueba(args(), { ...d, fetch: (async () => { throw new TypeError('fallo'); }) as unknown as typeof fetch });
    expect(r.codigo).toBe(2);
    expect(r.resumen?.fallos[0].codigo).toBe('sin_conexion');
  });
  it('--reintento: en real exige idempotencia y no suma al conteo del lote', async () => {
    let llamada = 0;
    const { d } = deps((c) => {
      llamada += 1;
      return { status: 200, json: { datos: { resultados: c.bitacoras.map((b, i) => ({ indice: i, bitacora: b.BitacoraID, estado: llamada === 1 ? 'recibida' : 'idempotente' })) } } };
    });
    const r = await ejecutarPrueba(args(['--n', '4', '--real', '--confirmo-escritura', '--reintento']), d);
    expect(r.resumen?.reintentoIdempotente).toBe(true);
    expect(r.resumen).toMatchObject({ enviadas: 4, aceptadas: 4, duplicadas: 0 });
  });
  it('--reintento en real detecta una bitácora que se guardó dos veces', async () => {
    const { d } = deps((c) => ({ status: 200, json: { datos: { resultados: c.bitacoras.map(() => ({ estado: 'recibida' })) } } }));
    const r = await ejecutarPrueba(args(['--n', '2', '--real', '--confirmo-escritura', '--reintento']), d);
    expect(r.resumen?.reintentoIdempotente).toBe(false);
  });
  it('padrón ilegible: error claro sin tocar la red', async () => {
    const { d, f, salida } = deps(todoRecibida);
    const r = await ejecutarPrueba({ ...args(), padron: 'x.json' } as ArgsPrueba, { ...d, leerArchivo: async () => 'no es json' });
    expect(r.codigo).toBe(1); expect(f).not.toHaveBeenCalled(); expect(salida[0]).toMatch(/padrón/);
  });
  it('el resumen se imprime legible', () => {
    const l = formatearResumen({ modo: 'simulacion', peticiones: 1, enviadas: 1, aceptadas: 1, duplicadas: 0, rechazadas: 0, causas: {}, estados: { recibida: 1 }, fallos: [], reintentoIdempotente: null });
    expect(l[0]).toContain('SIMULACIÓN');
  });
});
