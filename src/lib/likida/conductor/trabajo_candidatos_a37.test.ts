import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria } from '@/lib/pruebas/tablas_en_memoria.fixture';

// A37-S37-08: `leerCandidatosValidacion` tomaba las `limite*2` llegadas más recientes de TODAS las flotas y DESPUÉS descartaba
// en JS las ya validadas: con muchas validadas, las más viejas aún «sin dato» / «sin coincidencia» nunca se reintentaban.
const estado: { db: BaseEnMemoria } = { db: undefined as unknown as BaseEnMemoria };
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => estado.db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { leerCandidatosValidacion } = await import('./trabajo');

const DESDE = new Date('2026-10-02T09:00:00.000Z');
const hito = (n: number) => ({
  id: `h${String(n).padStart(3, '0')}`, tenant_id: 'A', viaje_id: `v${n}`, tipo: 'llegada_descarga', estado: 'recibido', ciclo: 1,
  // n más grande = más reciente.
  recibido_en: new Date(Date.parse('2026-10-02T10:00:00.000Z') + n * 60_000).toISOString(),
});
const viaje = (n: number) => ({ id: `v${n}`, tenant_id: 'A', folio: `F-${n}`, estatus: 'abierto', operador_id: `op${n}` });

beforeEach(() => { estado.db = crearBaseEnMemoria({}); });

describe('A37-S37-08: leerCandidatosValidacion no deja sin reintentar las llegadas viejas cuando las recientes ya están resueltas', () => {
  it('con 10 llegadas recientes YA validadas y límite 2, aún llega la vieja «sin coincidencia» (antes: lista vacía)', async () => {
    const limite = 2;
    // 1 = la más vieja (sin coincidencia, hay que reintentarla); 2..11 = recientes ya validadas.
    estado.db.tabla('viaje_hito').push(...Array.from({ length: 11 }, (_, i) => hito(i + 1)));
    estado.db.tabla('viaje').push(...Array.from({ length: 11 }, (_, i) => viaje(i + 1)));
    estado.db.tabla('viaje_hito_validacion').push(
      { viaje_hito_id: 'h001', ciclo: 1, resultado: 'sin_coincidencia', motivo: null },
      ...Array.from({ length: 10 }, (_, i) => ({ viaje_hito_id: `h${String(i + 2).padStart(3, '0')}`, ciclo: 1, resultado: 'validado', motivo: null })),
    );
    const r = await leerCandidatosValidacion(DESDE, limite);
    expect(r.map((c) => c.hito.id)).toEqual(['h001']);
    expect(r[0].resultadoPrevio).toBe('sin_coincidencia');
  });

  it('sin resueltas, sigue entregando solo `limite` y las más recientes primero', async () => {
    estado.db.tabla('viaje_hito').push(...Array.from({ length: 6 }, (_, i) => hito(i + 1)));
    estado.db.tabla('viaje').push(...Array.from({ length: 6 }, (_, i) => viaje(i + 1)));
    const r = await leerCandidatosValidacion(DESDE, 2);
    expect(r.map((c) => c.hito.id)).toEqual(['h006', 'h005']);
  });
});
