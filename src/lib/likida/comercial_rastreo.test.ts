import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// ESC-11 · getEstadoRastreo ya no se trae `posicion` entera.
//
// Eran dos escalares —cuántas unidades tienen posición y cuál fue la última—
// calculados sobre TODAS las filas de `posicion` de la flota, traídas con
// `traerTodo`. `posicion` recibe una fila por ping por unidad en cuanto el
// rastreo esté conectado, y `traerTodo` LANZA a las 100,000: esta pantalla
// habría sido la primera del panel en dejar de cargar.
//
// Lo que se fija aquí:
//   · la agregación va por `estado_rastreo_tenant()` (mig. 0162), con SU
//     tenant, y `posicion` NO se pagina;
//   · el catálogo de credenciales SÍ se sigue trayendo (es una lista, no un
//     número) y el token NUNCA sale — solo los últimos 4;
//   · fallar cerrado por partida doble: el error POR VALOR y la FORMA. Un
//     "0 unidades con posición" inventado diría que el rastreo no está
//     midiendo nada cuando lo que pasó es que no se pudo preguntar.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data: unknown; error: { message: string } | null };

let respRpc: Resp;
let respCredenciales: Resp;
const llamadas: Array<{ tipo: 'rpc' | 'from'; nombre: string; args?: unknown }> = [];
let paginasServidas = 0;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: unknown) => {
      llamadas.push({ tipo: 'rpc', nombre: fn, args });
      return { then: (res: (v: Resp) => unknown) => Promise.resolve(respRpc).then(res) };
    },
    from: (tabla: string) => {
      llamadas.push({ tipo: 'from', nombre: tabla });
      const api: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'not', 'in']) api[m] = () => api;
      // `traerTodo` pagina, y llama a `.from()` DE NUEVO en cada página: el
      // contador tiene que vivir fuera del builder o la primera página se
      // serviría para siempre. Página 0 = los datos; página 1 = vacía, y ahí
      // termina (sin `count`, una página vacía es la prueba del final).
      api.range = () => Promise.resolve(
        paginasServidas++ === 0 ? respCredenciales : { data: [], error: null },
      );
      return api;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { getEstadoRastreo } = await import('./comercial');

beforeEach(() => {
  llamadas.length = 0;
  paginasServidas = 0;
  respRpc = { data: { unidadesConPosicion: 0, ultimaPosicion: null }, error: null };
  respCredenciales = { data: [], error: null };
});

describe('getEstadoRastreo — los dos escalares salen de la base, no de las filas', () => {
  it('agrega por RPC con su tenant y NUNCA pagina `posicion`', async () => {
    respRpc = { data: { unidadesConPosicion: 12, ultimaPosicion: '2026-08-22T15:00:00+00:00' }, error: null };
    const r = await getEstadoRastreo('t-1');
    expect(r.unidadesConPosicion).toBe(12);
    expect(r.ultimaPosicion).toBe('2026-08-22T15:00:00+00:00');
    expect(llamadas).toContainEqual({ tipo: 'rpc', nombre: 'estado_rastreo_tenant', args: { p_tenant: 't-1' } });
    expect(llamadas.some((l) => l.tipo === 'from' && l.nombre === 'posicion')).toBe(false);
  });

  it('sin una sola posición, `ultimaPosicion` es null — no una fecha inventada', async () => {
    const r = await getEstadoRastreo('t-1');
    expect(r).toMatchObject({ unidadesConPosicion: 0, ultimaPosicion: null });
  });

  it('el token no sale: solo los últimos 4 del proveedor configurado', async () => {
    respCredenciales = {
      data: [{ proveedor: 'wialon', token_ultimos4: '9821', activo: true, probada_en: '2026-08-20T00:00:00Z', ultimo_error: null }],
      error: null,
    };
    const r = await getEstadoRastreo('t-1');
    expect(r.proveedores).toEqual([
      { proveedor: 'wialon', ultimos4: '9821', activo: true, probadaEn: '2026-08-20T00:00:00Z', ultimoError: null },
    ]);
    expect(JSON.stringify(r)).not.toContain('token');
  });

  it('error POR VALOR de la RPC: LANZA — "no pude preguntar" no es "cero unidades"', async () => {
    respRpc = { data: null, error: { message: 'fetch failed' } };
    await expect(getEstadoRastreo('t-1')).rejects.toThrow(/getEstadoRastreo\.posicion: fetch failed/);
  });

  it('la 0162 sin aplicar (otra forma) también LANZA, con la migración en el mensaje', async () => {
    respRpc = { data: { unidadesConPosicion: 'doce' }, error: null };
    await expect(getEstadoRastreo('t-1')).rejects.toThrow(/0162 sin aplicar/);
  });
});
