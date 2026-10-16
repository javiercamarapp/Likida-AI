import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./repo', () => ({ importarRutas: vi.fn(), marcarRutaRevisada: vi.fn() }));

const { importarRutasDelPanel, marcarRutaRevisadaDelPanel } = await import('./acciones_rutas');

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

describe('marcarRutaRevisadaDelPanel (T-A5-50)', () => {
  const marcar = vi.fn();
  const depsM = { importar, marcar } as never;
  const ahora = new Date('2026-10-16T05:30:00Z'); // 23:30 del 15-oct en America/Mexico_City
  beforeEach(() => { marcar.mockReset(); });

  it('sin permiso no escribe', async () => {
    for (const rol of ['contador', 'operador', '']) {
      const r = await marcarRutaRevisadaDelPanel({ tenantId: 't1', rol }, { id: 'r1' }, depsM, ahora);
      expect(r.ok).toBe(false);
    }
    expect(marcar).not.toHaveBeenCalled();
  });

  it('marca con el tenant de la sesión y el día de la flota (no el UTC del servidor)', async () => {
    marcar.mockResolvedValue(true);
    const r = await marcarRutaRevisadaDelPanel({ tenantId: 't1', rol: 'flota_admin' }, { id: 'r1' }, depsM, ahora);
    expect(marcar).toHaveBeenCalledWith('t1', 'r1', '2026-10-15');
    expect(r.ok).toBe(true);
  });

  it('id vacío o ruta inexistente/ajena: error en palabras, sin excepción', async () => {
    expect((await marcarRutaRevisadaDelPanel({ tenantId: 't1', rol: 'flota_admin' }, { id: '  ' }, depsM, ahora)).ok).toBe(false);
    expect(marcar).not.toHaveBeenCalled();
    marcar.mockResolvedValue(false);
    const r = await marcarRutaRevisadaDelPanel({ tenantId: 't1', rol: 'flota_admin' }, { id: 'r-ajena' }, depsM, ahora);
    expect(r).toMatchObject({ ok: false });
  });

  it('un fallo de la base se reporta sin romper', async () => {
    marcar.mockRejectedValue(new Error('boom'));
    const r = await marcarRutaRevisadaDelPanel({ tenantId: 't1', rol: 'flota_admin' }, { id: 'r1' }, depsM, ahora);
    expect(r.ok).toBe(false);
  });
});
