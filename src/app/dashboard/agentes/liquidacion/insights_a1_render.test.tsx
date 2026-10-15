import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionDesgloses, type FichasDesgloses, type LecturaDesgloses } from './desgloses';

// El bloque «qué pasó · qué significa · qué hacer» dentro de la pantalla de desgloses (T-A1-31), con datos sintéticos.

const FICHAS: FichasDesgloses = { recibidosHoy: 4, enviados: 2, entregados: 9, rebotados: 1, retenidos: 1, sinPoliza: 3 };

const pintar = async (lectura: LecturaDesgloses) =>
  renderToStaticMarkup(await SeccionDesgloses({ lectura: Promise.resolve(lectura), filtro: null, desde: null, hasta: null, contexto: [['tenant', 'flota-1']] }));

const ok = (o: Partial<Extract<LecturaDesgloses, { ok: true }>> = {}): LecturaDesgloses =>
  ({ ok: true, fichas: FICHAS, filas: [], sinPoliza: [], siguiente: null, ...o });

describe('bloque de insights en la pantalla de A1', () => {
  it('se pinta con las fichas, con la fuente de cada cifra y sin el otro canal', async () => {
    const html = await pintar(ok());
    expect(html).toContain('Qué pasó · qué significa · qué hacer');
    expect(html).toContain('1 correo rebotó');
    expect(html).toContain('Corrige el correo en la pantalla y reenvía');
    expect(html).toContain('3 bitácoras no se enviarán hasta tener póliza');
    expect(html).toContain('Revisa en el TMS');
    expect(html).toContain('Fuente: Likida: entregas por correo, últimos 30 días');
    expect(html).toContain('Ahorro de tiempo: sin línea base');
    expect(html).not.toMatch(/whatsapp/i);
  });

  it('sin nada que decir muestra «Aún sin desgloses este periodo»', async () => {
    const html = await pintar(ok({ fichas: { recibidosHoy: 0, enviados: 0, entregados: 0, rebotados: 0, retenidos: 0, sinPoliza: 0 } }));
    expect(html).toContain('Aún sin desgloses este periodo');
  });

  it('usa los insights ya calculados cuando la lectura los trae', async () => {
    const html = await pintar(ok({ insights: [{ id: 'x', quePaso: 'Frase sintética', queSignifica: 'Significa algo', queHacer: 'Haz algo', fuente: 'Likida: prueba', tono: 'ok' }] }));
    expect(html).toContain('Frase sintética');
    expect(html).not.toContain('Ahorro de tiempo');
  });

  it('una lista que no se pudo leer no pinta insights', async () => {
    expect(await pintar({ ok: false })).not.toContain('Qué pasó · qué significa');
  });
});
