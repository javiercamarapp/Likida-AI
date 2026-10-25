import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria } from '@/lib/pruebas/tablas_en_memoria.fixture';

// A37-S15-02 — la bandeja leía las 100 facturas MÁS RECIENTES sin mirar el
// estado: con más de 100, las pendientes antiguas salían del corte y ninguna
// pantalla permitía aprobarlas o rechazarlas. Las pendientes se leen APARTE.

const estado = vi.hoisted(() => ({ db: null as unknown as BaseEnMemoria }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => estado.db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { listarBandejaProveedor } = await import('./proveedores');

const T = '11111111-1111-4111-8111-111111111111';
const fila = (n: number, est: string) => ({
  id: `f${String(n).padStart(4, '0')}`, tenant_id: T, cfdi_uuid: `u${n}`, total: 10, estado: est,
  created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(), conceptos: 1,
});

beforeEach(() => {
  // 3 pendientes MUY viejas (n=1..3) y 150 aprobadas más nuevas.
  estado.db = crearBaseEnMemoria({
    factura_proveedor: [
      ...[1, 2, 3].map((n) => fila(n, 'pendiente')),
      ...Array.from({ length: 150 }, (_, i) => fila(10 + i, 'aprobada')),
    ],
  });
});

describe('listarBandejaProveedor', () => {
  it('trae las 100 más recientes Y TODAS las pendientes aunque sean más viejas que el corte', async () => {
    const lista = await listarBandejaProveedor(T, 100, 500);
    expect(lista.filter((f) => f.estado === 'pendiente')).toHaveLength(3);
    expect(lista.filter((f) => f.estado === 'aprobada')).toHaveLength(100);
    expect(new Set(lista.map((f) => f.id)).size).toBe(lista.length); // sin duplicados
  });

  it('una pendiente reciente que ya está en las 100 no se duplica', async () => {
    estado.db = crearBaseEnMemoria({ factura_proveedor: [fila(1, 'aprobada'), fila(2, 'pendiente')] });
    const lista = await listarBandejaProveedor(T, 100, 500);
    expect(lista).toHaveLength(2);
  });
});
