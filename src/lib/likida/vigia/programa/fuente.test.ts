import { describe, expect, it } from 'vitest';
import { DriveSinEjecutor, ErrorFuentePrograma, MENSAJE_DRIVE_SIN_EJECUTOR, SubidaManual, type FuenteProgramaDespacho, type LecturaFuente } from './fuente';
import { leerProgramaCsv } from './lector';
import { construirProgramaSintetico } from './fixtures';

describe('FuenteProgramaDespacho (contrato)', () => {
  it('una fuente falsa que devuelve el fixture alimenta al lector', async () => {
    const falsa: FuenteProgramaDespacho = {
      id: 'falsa',
      leer: async (): Promise<LecturaFuente> => ({ contenido: construirProgramaSintetico({ dias: 2, filasPorSeccion: 4 }), formato: 'csv', modificadoEn: '2026-01-05T08:00:00-06:00' }),
    };
    const l = await falsa.leer('GDL');
    expect(l.formato).toBe('csv');
    expect(typeof l.contenido).toBe('string');
    const r = leerProgramaCsv(l.contenido as string, { terminal: 'GDL' });
    expect(r.filas.length).toBeGreaterThan(0);
  });

  it('SubidaManual devuelve lo último subido, por terminal normalizada', async () => {
    const s = new SubidaManual(() => new Date('2026-01-05T14:00:00Z'));
    s.registrar('gdl', 'a;b', 'csv');
    s.registrar('BJX', new Uint8Array([1, 2]), 'xlsx');
    s.registrar(' GDL ', 'c;d', 'csv');
    expect(await s.leer('GDL')).toEqual({ contenido: 'c;d', formato: 'csv', modificadoEn: '2026-01-05T14:00:00.000Z' });
    expect((await s.leer('bjx')).formato).toBe('xlsx');
  });

  it('SubidaManual sin archivo falla con mensaje llano', async () => {
    const s = new SubidaManual();
    await expect(s.leer('MTY')).rejects.toMatchObject({ codigo: 'sin_archivo', message: expect.stringContaining('MTY') });
  });

  it('DriveSinEjecutor falla cerrado con mensaje llano y sin tocar la red', async () => {
    const original = globalThis.fetch;
    let llamadas = 0;
    globalThis.fetch = (async () => { llamadas++; throw new Error('red'); }) as typeof fetch;
    try {
      const d = new DriveSinEjecutor();
      const p = d.leer('GDL');
      await expect(p).rejects.toBeInstanceOf(ErrorFuentePrograma);
      await expect(p).rejects.toMatchObject({ codigo: 'no_configurada', message: MENSAJE_DRIVE_SIN_EJECUTOR });
      expect(MENSAJE_DRIVE_SIN_EJECUTOR).toMatch(/sube el archivo del día a mano/);
      expect(llamadas).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
