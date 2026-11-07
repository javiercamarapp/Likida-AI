import { describe, expect, it } from 'vitest';
import { leerRespuestaMensaje } from './respuesta_mensaje';

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status });
const bueno = { mensajeWaIa: 'wa', correoAsuntoIa: 'as', correoCuerpoIa: 'cu', mensajesGeneradosEn: '2026-11-04T00:00:00Z' };

describe('leerRespuestaMensaje (MX-004)', () => {
  it('un 503 del superadmin sin tenant devuelve el error REAL del servidor', async () => {
    const r = await leerRespuestaMensaje(json({ error: 'El redactor requiere un tenant explicito.', codigo: 'redactor_presupuesto_sin_tenant' }, 503));
    expect(r).toEqual({ ok: false, error: 'El redactor requiere un tenant explicito.' });
  });
  it('un fallo sin cuerpo JSON dice el codigo HTTP', async () => {
    const r = await leerRespuestaMensaje(new Response('', { status: 502 }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('HTTP 502');
  });
  it('guardado:false con aviso conserva el aviso y entrega los textos', async () => {
    const r = await leerRespuestaMensaje(json({ ...bueno, guardado: false, aviso: 'NO se pudieron guardar' }));
    expect(r).toMatchObject({ ok: true, aviso: 'NO se pudieron guardar', datos: { mensajeWaIa: 'wa' } });
  });
  it('guardado:false sin aviso igual avisa', async () => {
    const r = await leerRespuestaMensaje(json({ ...bueno, guardado: false }));
    expect(r.ok && r.aviso).toMatch(/NO se guardaron/);
  });
  it('el camino bueno no lleva aviso', async () => {
    const r = await leerRespuestaMensaje(json({ ...bueno, guardado: true }));
    expect(r).toMatchObject({ ok: true, aviso: null });
  });
});
