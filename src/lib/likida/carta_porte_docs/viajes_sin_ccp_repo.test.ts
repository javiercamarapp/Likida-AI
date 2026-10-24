import { describe, it, expect, vi, beforeEach } from 'vitest';

// Base falsa: cada tabla devuelve sus filas; el constructor es encadenable y «thenable». Se anotan los filtros para probar la consulta.
const tablas: Record<string, { filas: unknown[]; error?: { message: string } }> = {};
const filtros: Array<{ tabla: string; op: string; args: unknown[] }> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const q: Record<string, unknown> = {};
      let rango: [number, number] | null = null;
      let contar = false;
      for (const op of ['select', 'eq', 'in', 'gte', 'order', 'limit']) q[op] = (...args: unknown[]) => { filtros.push({ tabla, op, args }); if (op === 'select') contar = (args[1] as { count?: string } | undefined)?.count === 'exact'; return q; };
      q.range = (d: number, h: number) => { filtros.push({ tabla, op: 'range', args: [d, h] }); rango = [d, h]; return q; };
      q.then = (res: (v: unknown) => unknown) => {
        const todas = tablas[tabla]?.error ? null : (tablas[tabla]?.filas ?? []);
        // Como PostgREST: respeta el rango pedido y nunca entrega más de 1,000 por respuesta.
        const data = todas && rango ? todas.slice(rango[0], Math.min(rango[1] + 1, rango[0] + 1000)) : todas;
        return res({ data, error: tablas[tabla]?.error ?? null, count: contar && todas ? todas.length : null });
      };
      return q;
    },
  }),
}));

import { leerSalidasParaSinCcp, TOPE_SALIDAS_SIN_CCP } from './repo';
import { listarViajesSinCcp } from './viajes_sin_ccp';

const AHORA = new Date('2026-03-10T18:00:00Z');
beforeEach(() => { for (const k of Object.keys(tablas)) delete tablas[k]; filtros.length = 0; });

describe('lectura de salidas para «viajes sin Carta Porte» (T-A3-66)', () => {
  it('une hitos de salida, viaje/cliente y complementos aprobados; solo lee y acota por tenant', async () => {
    tablas.viaje_hito = { filas: [
      { viaje_id: 'v1', mensaje_en: '2026-03-08T10:00:00Z', recibido_en: '2026-03-08T10:05:00Z' },
      { viaje_id: 'v2', mensaje_en: null, recibido_en: '2026-03-10T10:00:00Z' },
    ] };
    tablas.viaje = { filas: [
      { id: 'v1', folio: 'F-1', cliente_id: 'c1', cliente: { nombre: 'Cliente Ejemplo' } },
      { id: 'v2', folio: 'F-2', cliente_id: null, cliente: null },
    ] };
    tablas.cp_documento = { filas: [{ viaje_id: 'v2' }] };
    const { viajes, conCcp } = await leerSalidasParaSinCcp('t1', AHORA);
    expect(viajes).toEqual([
      { viajeId: 'v1', folio: 'F-1', clienteId: 'c1', clienteNombre: 'Cliente Ejemplo', salidaEn: '2026-03-08T10:00:00Z' },
      { viajeId: 'v2', folio: 'F-2', clienteId: null, clienteNombre: null, salidaEn: '2026-03-10T10:00:00Z' },
    ]);
    expect([...conCcp]).toEqual(['v2']);
    for (const t of ['viaje_hito', 'viaje', 'cp_documento']) expect(filtros).toContainEqual({ tabla: t, op: 'eq', args: ['tenant_id', 't1'] });
    expect(filtros).toContainEqual({ tabla: 'viaje_hito', op: 'eq', args: ['tipo', 'salida_carga'] });
    expect(filtros).toContainEqual({ tabla: 'cp_documento', op: 'eq', args: ['estado', 'aprobado'] });
    expect(filtros.some((f) => f.op === 'in' && f.args[0] === 'estado' && (f.args[1] as string[]).join() === 'recibido,validado')).toBe(true);
    // Solo lectura: ninguna escritura.
    expect(filtros.every((f) => ['select', 'eq', 'in', 'gte', 'order', 'limit', 'range'].includes(f.op))).toBe(true);
    // De punta a punta con el puro: v2 ya tiene complemento, queda v1 con 3 días.
    const l = listarViajesSinCcp(viajes, conCcp, AHORA);
    expect(l.grupos[0]!.viajes.map((x) => [x.viajeId, x.dias])).toEqual([['v1', 2]]);
  });

  it('A37-S32-06: con 2,500 salidas lee TODAS (antes .limit(2000) y PostgREST a 1,000 se comían las más viejas) y no marca truncado', async () => {
    tablas.viaje_hito = { filas: Array.from({ length: 2500 }, (_, i) => ({ viaje_id: `v${i}`, mensaje_en: '2026-03-08T10:00:00Z', recibido_en: '2026-03-08T10:05:00Z' })) };
    tablas.viaje = { filas: [] };
    tablas.cp_documento = { filas: [] };
    const r = await leerSalidasParaSinCcp('t1', AHORA);
    expect(filtros.filter((f) => f.tabla === 'viaje_hito' && f.op === 'range').length).toBeGreaterThanOrEqual(3);
    expect(r.truncado).toBe(false);
  });

  it('A37-S32-06: si hay más salidas que el tope lo DICE (truncado: true) en vez de callar', async () => {
    tablas.viaje_hito = { filas: Array.from({ length: TOPE_SALIDAS_SIN_CCP + 5 }, (_, i) => ({ viaje_id: `v${i}`, mensaje_en: '2026-03-08T10:00:00Z', recibido_en: '2026-03-08T10:05:00Z' })) };
    tablas.viaje = { filas: [] };
    tablas.cp_documento = { filas: [] };
    expect((await leerSalidasParaSinCcp('t1', AHORA)).truncado).toBe(true);
  });

  it('sin salidas devuelve vacío sin consultar viajes', async () => {
    tablas.viaje_hito = { filas: [] };
    expect(await leerSalidasParaSinCcp('t1', AHORA)).toEqual({ viajes: [], conCcp: expect.any(Set), truncado: false });
    expect(filtros.some((f) => f.tabla === 'viaje')).toBe(false);
  });

  it('si la base falla LANZA (la pantalla dice «no se pudo leer», no «sin pendientes»)', async () => {
    tablas.viaje_hito = { filas: [], error: { message: 'caída' } };
    await expect(leerSalidasParaSinCcp('t1', AHORA)).rejects.toThrow();
  });
});
