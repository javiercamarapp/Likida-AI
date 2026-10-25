import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria } from '@/lib/pruebas/tablas_en_memoria.fixture';

// A37-S18-06 — los selectores de cliente/geocerca no se truncan en silencio a 500 ni a 1,000.

const estado = vi.hoisted(() => ({ db: null as unknown as BaseEnMemoria }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => estado.db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { clientesActivosCompletos, geocercasActivasCompletas } = await import('./catalogo_selectores');

const T = 't-1';
const cliente = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `c${String(n).padStart(5, '0')}`, tenant_id: T, nombre: `Cliente ${String(n).padStart(5, '0')}`, activo: true, dias_credito: 30, geocerca_id: null, ...extra,
});

beforeEach(() => {
  estado.db = crearBaseEnMemoria({
    cliente: [
      ...Array.from({ length: 1_250 }, (_, i) => cliente(i + 1)),
      cliente(9_001, { activo: false }),               // dado de baja: no se ofrece
      { ...cliente(9_002), tenant_id: 'otra-flota' },  // de otra flota: nunca
    ],
    geocerca: [
      // Sitios del CLIENTE (`catalogo = 'conductor'`): lo que este selector debe ofrecer.
      ...Array.from({ length: 620 }, (_, i) => ({ id: `g${i}`, tenant_id: T, nombre: `Sitio ${String(i).padStart(4, '0')}`, activa: true, catalogo: 'conductor' })),
      // Casetas y puntos de ruta (`catalogo = 'peajes'`): NUNCA son el sitio de un cliente.
      // En la base `catalogo` es `not null default 'peajes'` (0480), así que una fila sin
      // declararlo es de peajes: el fixture lo omitía y por eso esto era invisible.
      { id: 'gp-1', tenant_id: T, nombre: 'Caseta Palmillas', activa: true, catalogo: 'peajes' },
      { id: 'gp-2', tenant_id: T, nombre: 'Caseta Tepotzotlán', activa: true, catalogo: 'peajes' },
      { id: 'gp-3', tenant_id: T, nombre: 'Punto de ruta km 40', activa: true, catalogo: 'peajes' },
      { id: 'gi-1', tenant_id: T, nombre: 'Sitio inactivo', activa: false, catalogo: 'conductor' },
      { id: 'go-1', tenant_id: 'otra-flota', nombre: 'Sitio de otra flota', activa: true, catalogo: 'conductor' },
    ],
  });
});

describe('clientesActivosCompletos', () => {
  it('trae los 1,250 clientes activos de la flota — el cliente 1,001 en adelante SÍ aparece (antes: tope silencioso de 1,000 / 500)', async () => {
    const r = await clientesActivosCompletos(T);
    expect(r).toHaveLength(1_250);
    expect(r.at(-1)?.nombre).toBe('Cliente 01250');
    expect(r.some((c) => c.id === 'c09001' || c.id === 'c09002')).toBe(false);
  });

  it('conserva los días de crédito y el vínculo con la geocerca', async () => {
    estado.db = crearBaseEnMemoria({ cliente: [cliente(1, { dias_credito: 15, geocerca_id: 'g1' }), cliente(2, { dias_credito: null })] });
    const r = await clientesActivosCompletos(T);
    expect(r[0]).toMatchObject({ diasCredito: 15, geocercaId: 'g1' });
    expect(r[1]).toMatchObject({ diasCredito: null, geocercaId: null });
  });

  it('una lectura caída LANZA: no se ofrece una lista corta como si fuera la completa', async () => {
    estado.db.fallarProxima('cliente', 'select', { message: 'base caída' } as never);
    await expect(clientesActivosCompletos(T)).rejects.toThrow(/base caída/);
  });
});

describe('geocercasActivasCompletas', () => {
  it('trae las 620 geocercas activas (antes: .limit(500))', async () => {
    expect(await geocercasActivasCompletas(T)).toHaveLength(620);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // A39-ARQ-03 (ALTO) — este selector centralizó la lectura de `geocerca` SIN
  // el predicado `catalogo` que cargan sus dos lectores previos.
  //
  // La 0480 separó los dos catálogos y los declaró INMUTABLES:
  //   `catalogo = 'conductor'` → cliente, planta, anden, patio, punto_interes
  //   `catalogo = 'peajes'`    → origen, destino, patio, punto_interes, restringida
  // El único consumidor de esta función es el pacto de detención de
  // `/dashboard/facturacion` (`estadias.tsx:137`), que empareja un CLIENTE con
  // SU sitio. Sin el predicado, el desplegable «Sitio del cliente» ofrecía
  // casetas de peaje: al elegir «Caseta Palmillas» la flota queda midiendo
  // estadías por GPS en una caseta a 40 km del patio del cliente, el episodio
  // nunca se abre, y la pantalla factura $0.00 AFIRMANDO que midió.
  //
  // La separación ya se respeta en la otra dirección: `peajes/repo.ts:754` se
  // NIEGA a tocar una geocerca cuyo catálogo es `'conductor'`
  // (`MOTIVO_SITIO_DEL_CONDUCTOR`). Esta era la única puerta sin la reja.
  // ═══════════════════════════════════════════════════════════════════════
  it('A39-ARQ-03: NO ofrece casetas de peaje como sitio de un cliente', async () => {
    const r = await geocercasActivasCompletas(T);
    const nombres = r.map((g) => g.nombre);
    expect(nombres).not.toContain('Caseta Palmillas');
    expect(nombres).not.toContain('Caseta Tepotzotlán');
    expect(nombres).not.toContain('Punto de ruta km 40');
    expect(r.map((g) => g.id).filter((id) => id.startsWith('gp-'))).toEqual([]);
  });

  it('A39-ARQ-03: sigue excluyendo lo inactivo y lo de otra flota', async () => {
    const ids = (await geocercasActivasCompletas(T)).map((g) => g.id);
    expect(ids).not.toContain('gi-1');
    expect(ids).not.toContain('go-1');
  });
});
