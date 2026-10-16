import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./repo', () => ({ importarRutas: vi.fn() }));

const { importarRutasDelPanel } = await import('./acciones_rutas');

const OK = 'https://maps.app.goo.gl/EjemploSintetico1';
const CAB = 'corredor,sitio_origen,sitio_destino,url';
const resultado = (extra = {}) => ({ guardadas: 1, nuevas: 1, actualizadas: 0, sinCambios: 0, ...extra });
const importar = vi.fn();
const deps = { importar } as never;

beforeEach(() => { importar.mockReset(); });

describe('importarRutasDelPanel', () => {
  it('sin permiso (rol desconocido, contador) no escribe nada', async () => {
    for (const rol of ['contador', 'operador', '']) {
      const r = await importarRutasDelPanel({ tenantId: 't1', rol }, { texto: `${CAB}\nA,,,${OK}` }, deps);
      expect(r.ok).toBe(false);
    }
    expect(importar).not.toHaveBeenCalled();
  });

  it('el tenant sale del contexto y solo se mandan las filas válidas; las rechazadas se reportan con su línea', async () => {
    importar.mockResolvedValue(resultado());
    const r = await importarRutasDelPanel({ tenantId: 't1', rol: 'flota_admin' }, { texto: `${CAB}\nA,,,${OK}\nB,,,http://maps.app.goo.gl/x\n` }, deps);
    expect(importar).toHaveBeenCalledTimes(1);
    expect(importar.mock.calls[0][0]).toBe('t1');
    expect(importar.mock.calls[0][1].map((f: { corredor: string }) => f.corredor)).toEqual(['a']);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.mensaje).toMatch(/1 guardada.*1 rechazada/);
      expect(r.detalles?.[0]).toMatch(/Línea 3.*https/);
    }
  });

  it('reimportar el mismo archivo: 0 guardadas, N sin cambios', async () => {
    importar.mockResolvedValue(resultado({ guardadas: 0, nuevas: 0, sinCambios: 1 }));
    const r = await importarRutasDelPanel({ tenantId: 't1', rol: 'flota_admin' }, { texto: `${CAB}\nA,,,${OK}\n` }, deps);
    expect(r).toMatchObject({ ok: true, mensaje: expect.stringMatching(/0 guardadas \(0 nuevas, 0 actualizadas\), 1 sin cambios, 0 rechazadas/) });
  });

  it('si todas las filas son inválidas no toca la base y dice por qué', async () => {
    const r = await importarRutasDelPanel({ tenantId: 't1', rol: 'flota_admin' }, { texto: `${CAB}\nA,,,https://example.com/maps\n` }, deps);
    expect(importar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.detalles?.[0]).toMatch(/Google Maps/);
  });

  it('un fallo de la base se dice en palabras, sin filtrar el error', async () => {
    importar.mockRejectedValue(new Error('conductor.rutas_insertar: boom interno'));
    const r = await importarRutasDelPanel({ tenantId: 't1', rol: 'flota_admin' }, { texto: `${CAB}\nA,,,${OK}\n` }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toMatch(/boom/);
  });
});
