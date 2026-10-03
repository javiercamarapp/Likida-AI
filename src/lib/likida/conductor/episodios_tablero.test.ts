import { describe, it, expect, vi, beforeEach } from 'vitest';
import { episodiosVista } from './tablero';
import type { EpisodioTablero } from './repo';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../presupuesto', () => ({ acotada: (q: unknown) => q }));

// Los episodios de «sin señal de vida» en la pantalla del Conductor: la lectura (acotada a UNA flota, con el folio y el chofer del viaje) y la
// vista pura que cuenta la cadena de avisos y cómo terminó.
type Respuesta = { data?: unknown; error?: { message: string; code?: string } | null };
interface Registro { tabla: string; ops: Array<[string, ...unknown[]]> }
const registros: Registro[] = [];
let respuestas: Record<string, Respuesta> = {};
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const reg: Registro = { tabla, ops: [] };
      registros.push(reg);
      const proxy: unknown = new Proxy({}, {
        get: (_t, prop: string) => {
          if (prop === 'then') return (res: (r: Respuesta) => unknown) => res(respuestas[tabla] ?? { data: [], error: null });
          return (...args: unknown[]) => { reg.ops.push([prop, ...args]); return proxy; };
        },
      });
      return proxy;
    },
  }),
}));

const { leerEpisodiosParaTablero } = await import('./repo');
const DESDE = new Date('2026-09-25T00:00:00.000Z');
const UUID_C = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d0a1';
const fila = (o: Record<string, unknown>) => ({ id: 'e1', viaje_id: 'v1', motivo: 'gps_obsoleto', abierto_en: '2026-10-01T10:00:00Z', nivel_enviado: 0, aviso_1_en: null, aviso_2_en: null, escalado_en: null, cerrado_en: null, cierre_motivo: null, respuesta: null, ...o });

beforeEach(() => { registros.length = 0; respuestas = {}; });

describe('leerEpisodiosParaTablero', () => {
  it('lee de UNA flota, en el periodo, y pega el folio y el chofer de cada viaje', async () => {
    respuestas = {
      viaje_senal_vida: { data: [fila({ nivel_enviado: 3, aviso_1_en: '2026-10-01T10:01:00Z', aviso_2_en: '2026-10-01T10:21:00Z', escalado_en: '2026-10-01T10:41:00Z' })] },
      viaje: { data: [{ id: 'v1', folio: 'F-77', operador_id: 'o1' }] },
      operador: { data: [{ id: 'o1', nombre: 'Juan Pérez' }] },
    };
    const r = (await leerEpisodiosParaTablero('t1', DESDE))!;
    expect(r.hayMas).toBe(false);
    expect(r.episodios[0]).toMatchObject({ id: 'e1', folio: 'F-77', operador: 'Juan Pérez', nivelEnviado: 3, escaladoEn: '2026-10-01T10:41:00Z', cerradoEn: null });
    for (const reg of registros) expect(reg.ops).toContainEqual(['eq', 'tenant_id', 't1']);
    const q = registros.find((x) => x.tabla === 'viaje_senal_vida')!;
    expect(q.ops).toContainEqual(['gte', 'abierto_en', DESDE.toISOString()]);
  });

  it('un filtro del tablero (chofer) acota por los viajes de ESE chofer; sin viajes que cumplan no consulta episodios', async () => {
    respuestas = { viaje: { data: [] } };
    expect(await leerEpisodiosParaTablero('t1', DESDE, { operadorId: UUID_C })).toEqual({ episodios: [], hayMas: false });
    expect(registros.some((x) => x.tabla === 'viaje_senal_vida')).toBe(false);
    expect(registros[0].ops).toContainEqual(['eq', 'operador_id', UUID_C]);
    registros.length = 0;
    respuestas = { viaje: { data: [{ id: 'v1' }] }, viaje_senal_vida: { data: [] } };
    await leerEpisodiosParaTablero('t1', DESDE, { operadorId: UUID_C });
    expect(registros.find((x) => x.tabla === 'viaje_senal_vida')!.ops).toContainEqual(['in', 'viaje_id', ['v1']]);
  });

  it('dice si hay más de los que lista (pide uno extra)', async () => {
    respuestas = { viaje_senal_vida: { data: Array.from({ length: 3 }, (_, i) => fila({ id: `e${i}` })) }, viaje: { data: [] } };
    const r = (await leerEpisodiosParaTablero('t1', DESDE, {}, 2))!;
    expect(r.episodios).toHaveLength(2);
    expect(r.hayMas).toBe(true);
  });

  it('sin la 0636 (tabla ausente) da null; una base caída LANZA (no es «cero episodios»)', async () => {
    respuestas = { viaje_senal_vida: { error: { message: 'relation "public.viaje_senal_vida" does not exist', code: '42P01' } } };
    expect(await leerEpisodiosParaTablero('t1', DESDE)).toBeNull();
    respuestas = { viaje_senal_vida: { error: { message: 'connection reset' } } };
    await expect(leerEpisodiosParaTablero('t1', DESDE)).rejects.toThrow(/connection reset/);
  });
});

describe('episodiosVista', () => {
  const base: EpisodioTablero = { id: 'e1', viajeId: 'v1', folio: 'F-1', operador: 'Ana', motivo: 'gps_obsoleto', abiertoEn: '2026-10-01T10:00:00Z', nivelEnviado: 0, aviso1En: null, aviso2En: null, escaladoEn: null, cerradoEn: null, cierreMotivo: null, respuesta: null };

  it('cuenta la cadena paso por paso: primer aviso, segundo aviso, jefe; el escalado abierto es urgente', () => {
    const [e] = episodiosVista([{ ...base, nivelEnviado: 3, aviso1En: '2026-10-01T10:01:00Z', aviso2En: '2026-10-01T10:21:00Z', escaladoEn: '2026-10-01T10:41:00Z' }]);
    expect(e.pasos.map((p) => p.texto)).toEqual(['Primer aviso al chofer', 'Segundo aviso al chofer', 'Aviso al jefe de tráfico']);
    expect(e).toMatchObject({ abierto: true, urgente: true, folio: 'F-1', chofer: 'Ana', motivo: 'GPS sin reportar' });
    expect(e.estado).toContain('Escalado al jefe de tráfico');
  });

  it('dice dónde va cada nivel abierto y cómo terminó cada cerrado, con la respuesta del chofer en sus botones', () => {
    const v = (o: Partial<EpisodioTablero>) => episodiosVista([{ ...base, ...o }])[0];
    expect(v({ nivelEnviado: 0 }).estado).toContain('falta mandar el primer aviso');
    expect(v({ nivelEnviado: 1, aviso1En: 'x' }).estado).toBe('Primer aviso mandado, sin respuesta del chofer');
    expect(v({ nivelEnviado: 2 }).urgente).toBe(false);
    expect(v({ cerradoEn: 'x', cierreMotivo: 'respondio', respuesta: 'voy_a_cargar' }).estado).toBe('El chofer respondió: «Voy a cargar»');
    expect(v({ cerradoEn: 'x', cierreMotivo: 'senal_recuperada' }).estado).toBe('El GPS volvió a reportar');
    expect(v({ cerradoEn: 'x', cierreMotivo: 'atendido_por_jefe', nivelEnviado: 3 })).toMatchObject({ estado: 'Lo atendió el jefe de tráfico', urgente: false, abierto: false });
    expect(v({ cerradoEn: 'x', cierreMotivo: 'viaje_cerrado' }).estado).toBe('El viaje se cerró');
    expect(v({ motivo: 'gps_detenido', folio: null, operador: null })).toMatchObject({ motivo: 'Detenido fuera de un sitio', folio: 'sin folio', chofer: 'sin chofer' });
  });
});
