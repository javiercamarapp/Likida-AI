// ═══════════════════════════════════════════════════════════════════════════
// EL REINTENTO DECLARADO — el segundo cinturón del incidente del 28-ago-2026
// (corrida 46ad99ca: 10 de 90 fotos 'bad', todas con «Too many connections
// issued to the database»). Lo que estas pruebas fijan:
//
//   · SOLO la firma de saturación se reintenta — un 404 fallaría igual.
//   · La espera es EXPONENCIAL (400, 1 200 ms): darle aire al pool es el
//     punto; martillarlo lo satura más.
//   · Se CUENTA y se DECLARA: el resultado dice cuántos reintentos costó y
//     `alReintentar` avisa antes de cada espera. Cero reintentos mudos.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  conReintentoDeSaturacion, esSaturacionStorage,
  REINTENTOS_SATURACION_MAX, ESPERA_BASE_SATURACION_MS,
} from './reintento';

type R = { error: { message: string } | null; valor?: string };

const saturado: R = { error: { message: 'Too many connections issued to the database' } };
const noEncontrado: R = { error: { message: 'Object not found' } };
const bien: R = { error: null, valor: 'ok' };

const transitorio = (r: R) => r.error !== null && esSaturacionStorage(r.error.message);
const sinDormir = async () => {};

describe('esSaturacionStorage — la firma medida del incidente, ni más ni menos', () => {
  it('reconoce el mensaje LITERAL de storage-api (y sin importar mayúsculas)', () => {
    expect(esSaturacionStorage('Too many connections issued to the database')).toBe(true);
    expect(esSaturacionStorage('too many connections')).toBe(true);
  });
  it('un 404, un permiso o el vacío NO son saturación', () => {
    expect(esSaturacionStorage('Object not found')).toBe(false);
    expect(esSaturacionStorage('new row violates row-level security policy')).toBe(false);
    expect(esSaturacionStorage('')).toBe(false);
    expect(esSaturacionStorage(null)).toBe(false);
    expect(esSaturacionStorage(undefined)).toBe(false);
  });
});

describe('conReintentoDeSaturacion', () => {
  it('éxito a la primera: cero reintentos, cero esperas', async () => {
    let llamadas = 0;
    const { resultado, reintentos } = await conReintentoDeSaturacion(
      async () => { llamadas += 1; return bien; }, transitorio, { dormir: sinDormir },
    );
    expect(resultado.valor).toBe('ok');
    expect(reintentos).toBe(0);
    expect(llamadas).toBe(1);
  });

  it('la saturación cede al segundo intento: 1 reintento CONTADO, espera base', async () => {
    const respuestas = [saturado, bien];
    const esperas: number[] = [];
    const avisos: Array<[number, number]> = [];
    const { resultado, reintentos } = await conReintentoDeSaturacion(
      async () => respuestas.shift() as R, transitorio,
      { dormir: async (ms) => { esperas.push(ms); }, alReintentar: (i, ms) => avisos.push([i, ms]) },
    );
    expect(resultado.valor).toBe('ok');
    expect(reintentos).toBe(1);
    expect(esperas).toEqual([ESPERA_BASE_SATURACION_MS]);
    expect(avisos).toEqual([[1, ESPERA_BASE_SATURACION_MS]]);   // declarado ANTES de dormir
  });

  it('la espera crece ×3 por intento (400 → 1 200): exponencial, no martilleo', async () => {
    const esperas: number[] = [];
    const { resultado, reintentos } = await conReintentoDeSaturacion(
      async () => saturado, transitorio, { dormir: async (ms) => { esperas.push(ms); } },
    );
    expect(reintentos).toBe(REINTENTOS_SATURACION_MAX);
    expect(esperas).toEqual([400, 1200]);
    // El fallo FINAL se devuelve tal cual: quien llama decide qué decir.
    expect(resultado.error?.message).toMatch(/Too many connections/);
  });

  it('un fallo NO transitorio (404) no se reintenta ni una vez', async () => {
    let llamadas = 0;
    const { resultado, reintentos } = await conReintentoDeSaturacion(
      async () => { llamadas += 1; return noEncontrado; }, transitorio, { dormir: sinDormir },
    );
    expect(llamadas).toBe(1);
    expect(reintentos).toBe(0);
    expect(resultado.error?.message).toBe('Object not found');
  });

  it('lo que `fn` LANZA se propaga sin reintentar: un throw no es saturación', async () => {
    let llamadas = 0;
    await expect(conReintentoDeSaturacion(
      async () => { llamadas += 1; throw new Error('bug de programación'); },
      transitorio, { dormir: sinDormir },
    )).rejects.toThrow('bug de programación');
    expect(llamadas).toBe(1);
  });

  it('reintentosMax y esperaBaseMs son configurables (y 0 reintentos = un solo intento)', async () => {
    let llamadas = 0;
    const { reintentos } = await conReintentoDeSaturacion(
      async () => { llamadas += 1; return saturado; }, transitorio,
      { reintentosMax: 0, dormir: sinDormir },
    );
    expect(llamadas).toBe(1);
    expect(reintentos).toBe(0);

    const esperas: number[] = [];
    await conReintentoDeSaturacion(
      async () => saturado, transitorio,
      { reintentosMax: 3, esperaBaseMs: 10, dormir: async (ms) => { esperas.push(ms); } },
    );
    expect(esperas).toEqual([10, 30, 90]);
  });
});
