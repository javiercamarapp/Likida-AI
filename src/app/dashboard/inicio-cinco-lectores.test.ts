import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cifrasSinDato } from './cinco-agentes-cifras-modelo';

const d = vi.hoisted(() => ({ cifras: vi.fn(), corridas: vi.fn(), contar: vi.fn() }));
vi.mock('./cinco-agentes-cifras', () => ({ leerCifrasPesosCincoAgentes: (...a: unknown[]) => d.cifras(...a) }));
vi.mock('@/lib/likida/agentes/corridas', () => ({ ultimasCorridas: (...a: unknown[]) => d.corridas(...a) }));
vi.mock('@/lib/likida/analytics', () => ({ contarViajes: (...a: unknown[]) => d.contar(...a) }));

const { leerPesosInicio, leerUltimasCorridas, leerViajesEnCurso } = await import('./inicio-cinco-lectores');

const BUENAS = { importeDecena: { valor: 1 }, extemporaneos: { valor: 2 } };
beforeEach(() => { d.cifras.mockReset(); d.corridas.mockReset(); d.contar.mockReset(); });

describe('leerPesosInicio', () => {
  it('rol sin dinero: null y NO toca ningún dato', async () => {
    expect(await leerPesosInicio('t-1', 'encargado')).toBeNull();
    expect(await leerPesosInicio('t-1', 'nomina')).toBeNull();
    expect(d.cifras).not.toHaveBeenCalled();
  });
  it('dueño y finanzas leen con el lector de #777 y traen cuándo se leyó', async () => {
    d.cifras.mockResolvedValue(BUENAS);
    for (const rol of ['flota_admin', 'contador']) {
      const r = await leerPesosInicio('t-1', rol);
      expect(r?.cifras).toBe(BUENAS);
      expect(Date.parse(r!.leidoEn)).not.toBeNaN();
    }
    expect(d.cifras).toHaveBeenCalledWith('t-1', 'flota_admin');
  });
  it('si el lector dice null (perfil ajeno) devuelve null: ni «Sin dato»', async () => {
    d.cifras.mockResolvedValue(null);
    expect(await leerPesosInicio('t-1', 'flota_admin')).toBeNull();
  });
  it('un fallo de lectura es Sin dato con reintentar, nunca $0, y una lectura nueva vuelve a intentar (no se cachea el fallo)', async () => {
    d.cifras.mockResolvedValueOnce(cifrasSinDato('No se pudo leer el estado de cuenta.', true)).mockResolvedValueOnce(BUENAS);
    const a = await leerPesosInicio('t-1', 'flota_admin');
    expect(a?.cifras.importeDecena).toMatchObject({ valor: null, reintentar: true, sello: 'Sin dato' });
    const b = await leerPesosInicio('t-1', 'flota_admin');
    expect(b?.cifras).toBe(BUENAS);
  });
  it('un lector que lanza también cae a Sin dato con reintentar', async () => {
    d.cifras.mockRejectedValue(new Error('boom'));
    const r = await leerPesosInicio('t-1', 'flota_admin');
    expect(r?.cifras.extemporaneos).toMatchObject({ valor: null, n: null, reintentar: true });
  });
});

describe('otros lectores', () => {
  it('corridas: null por agente si falla, undefined si no registra o no hay', async () => {
    d.corridas.mockImplementation(async (_t: string, ag: string) => { if (ag === 'peajes') throw new Error('x'); return ag === 'liquidacion' ? [{ id: 'c' }] : []; });
    const r = await leerUltimasCorridas('t-1');
    expect(r.liquidacion).toEqual({ id: 'c' });
    expect(r.peajes).toBeNull();
    expect(r.carta_porte).toBeUndefined();
    expect(r.vigia).toBeUndefined();
  });
  it('viajes en curso: cuenta abiertos y null si falla (no 0)', async () => {
    d.contar.mockResolvedValue(4);
    expect(await leerViajesEnCurso('t-1')).toBe(4);
    expect(d.contar).toHaveBeenCalledWith('t-1', ['abierto']);
    d.contar.mockRejectedValue(new Error('x'));
    expect(await leerViajesEnCurso('t-1')).toBeNull();
  });
});
