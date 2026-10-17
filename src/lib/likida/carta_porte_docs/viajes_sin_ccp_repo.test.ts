import { describe, it, expect, vi, beforeEach } from 'vitest';

// Base falsa: cada tabla devuelve sus filas; el constructor es encadenable y «thenable». Se anotan los filtros para probar la consulta.
const tablas: Record<string, { filas: unknown[]; error?: { message: string } }> = {};
const filtros: Array<{ tabla: string; op: string; args: unknown[] }> = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const q: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'in', 'gte', 'order', 'limit']) q[op] = (...args: unknown[]) => { filtros.push({ tabla, op, args }); return q; };
      q.then = (res: (v: unknown) => unknown) => res({ data: tablas[tabla]?.error ? null : (tablas[tabla]?.filas ?? []), error: tablas[tabla]?.error ?? null });
      return q;
    },
  }),
}));

import { leerSalidasParaSinCcp } from './repo';
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
    expect(filtros.every((f) => ['select', 'eq', 'in', 'gte', 'order', 'limit'].includes(f.op))).toBe(true);
    // De punta a punta con el puro: v2 ya tiene complemento, queda v1 con 3 días.
    const l = listarViajesSinCcp(viajes, conCcp, AHORA);
    expect(l.grupos[0]!.viajes.map((x) => [x.viajeId, x.dias])).toEqual([['v1', 2]]);
  });

  it('sin salidas devuelve vacío sin consultar viajes', async () => {
    tablas.viaje_hito = { filas: [] };
    expect(await leerSalidasParaSinCcp('t1', AHORA)).toEqual({ viajes: [], conCcp: expect.any(Set) });
    expect(filtros.some((f) => f.tabla === 'viaje')).toBe(false);
  });

  it('si la base falla LANZA (la pantalla dice «no se pudo leer», no «sin pendientes»)', async () => {
    tablas.viaje_hito = { filas: [], error: { message: 'caída' } };
    await expect(leerSalidasParaSinCcp('t1', AHORA)).rejects.toThrow();
  });
});
