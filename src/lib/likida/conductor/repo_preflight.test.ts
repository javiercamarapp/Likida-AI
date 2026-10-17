import { beforeEach, describe, expect, it, vi } from 'vitest';

// T-A5-25: `leerDatosPreflight` solo LEE, acotado por flota, y cuenta las posiciones por unidad.
const llamadas: Array<{ op: string; args: unknown[] }> = [];
const datos: Record<string, unknown> = {};

function cadena(nombre: string): unknown {
  const p: Record<string, unknown> = {};
  for (const op of ['select', 'eq', 'neq', 'not', 'in', 'gte', 'order', 'limit', 'update', 'insert', 'delete', 'upsert', 'or']) {
    p[op] = (...args: unknown[]) => { llamadas.push({ op: `${nombre}.${op}`, args }); return p; };
  }
  p.maybeSingle = async () => ({ data: (datos[`${nombre}.uno`] ?? null) as unknown, error: null });
  p.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: datos[nombre] ?? [], error: null }).then(res);
  return p;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => cadena(t), rpc: async () => ({ data: null, error: null }) }) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('../repo', () => ({ getZonaHorariaTenant: async () => 'America/Mexico_City' }));

import { leerDatosPreflight } from './repo';

const ahora = new Date('2026-10-15T12:00:00Z');

describe('repo: leerDatosPreflight', () => {
  beforeEach(() => { llamadas.length = 0; for (const k of Object.keys(datos)) delete datos[k]; });

  it('sin voluntarios no toca viaje ni posicion', async () => {
    const r = await leerDatosPreflight('t1', ahora);
    expect(r.voluntarios).toEqual([]);
    expect(r.viajes).toEqual([]);
    expect(llamadas.some((l) => l.op.startsWith('viaje.') || l.op.startsWith('posicion.'))).toBe(false);
    expect(r.zonaDeclarada).toBe('America/Mexico_City');
  });

  it('lee solo viajes abiertos y aceptados de los voluntarios de ESA flota y cuenta posiciones por unidad (2 h y última hora)', async () => {
    datos.operador = [{ id: 'o1', nombre: 'X', telefono: '3312345678', activo: true, agente_voluntario: true, agente_voluntario_desde: null }]; // grep-limpio:ok
    datos.viaje = [
      { terminal_id: 'p1', unidad_id: 'u1', origen_geocerca_id: 'g1', destino_geocerca_id: 'g2' },
      { terminal_id: null, unidad_id: 'u2', origen_geocerca_id: 'g1', destino_geocerca_id: null },
    ];
    datos.posicion = [
      { unidad_id: 'u1', medida_en: '2026-10-15T11:50:00Z' }, { unidad_id: 'u1', medida_en: '2026-10-15T10:30:00Z' }, { unidad_id: 'u2', medida_en: '2026-10-15T10:10:00Z' },
    ];
    const r = await leerDatosPreflight('t1', ahora);
    expect(r.viajes).toEqual([
      { terminalId: 'p1', unidadId: 'u1', conSitio: true }, { terminalId: null, unidadId: 'u2', conSitio: false },
    ]);
    expect(r.posicionesPorUnidad).toEqual({ u1: { ultimas2h: 2, ultimaHora: 1 }, u2: { ultimas2h: 1, ultimaHora: 0 } });
    const eqViaje = llamadas.filter((l) => l.op === 'viaje.eq').map((l) => l.args);
    expect(eqViaje).toEqual([['tenant_id', 't1'], ['estatus', 'abierto']]);
    expect(llamadas.find((l) => l.op === 'viaje.in')!.args).toEqual(['operador_id', ['o1']]);
    expect(llamadas.find((l) => l.op === 'posicion.eq')!.args).toEqual(['tenant_id', 't1']);
    expect(llamadas.find((l) => l.op === 'posicion.gte')!.args[1]).toBe('2026-10-15T10:00:00.000Z');
    // Solo lee: ninguna escritura.
    expect(llamadas.some((l) => /\.(update|insert|delete|upsert)$/.test(l.op))).toBe(false);
  });
});
