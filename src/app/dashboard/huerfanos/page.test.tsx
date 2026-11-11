import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// HUÉRFANOS = FUNCIÓN DE DINERO. Estas pruebas fijan, ANTES de migrar la pantalla, lo que hacen las dos salidas de un comprobante
// suelto: ADJUNTAR (mete un gasto a la liquidación de un viaje) y DESCARTAR (lo saca de la vista de todos). Se ejercitan las server
// actions reales de `page.tsx` con la base y el repo simulados.
// ═══════════════════════════════════════════════════════════════════════════

type Elemento = ReactElement<Record<string, unknown>>;
type Accion = (prev: { error?: string } | null, fd: FormData) => Promise<{ error?: string } | null>;

let sesion = { tenantId: 't-1', rol: 'flota_admin' };
const orden: string[] = [];
const addGasto = vi.fn();
const resolver = vi.fn();
const traer = vi.fn();
let estatusViaje: { data: { estatus: string } | null; error: { message: string } | null } = { data: { estatus: 'abierto' }, error: null };

vi.mock('@/lib/auth/tenant-efectivo', () => ({ resolverTenantEfectivo: async () => ({ tenantId: 't-1', rol: sesion.rol }) }));
vi.mock('@/lib/auth/tenant-atado', () => ({ resolverTenantAtadoOLanza: async () => sesion }));
vi.mock('next/navigation', () => ({ redirect: (r: string) => { throw new Error(`REDIRECT:${r}`); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: async (q: unknown) => q }));
vi.mock('@/lib/likida/repo_paginado', () => ({ buscarViajesVivos: vi.fn(async () => [{ id: 'v1', etiqueta: 'F-1' }]) }));
vi.mock('@/lib/likida/repo', () => ({
  getHuerfanosDeFlota: async () => [],
  contarHuerfanosPendientes: async () => 0,
  traerHuerfanoPendiente: (...a: unknown[]) => traer(...a),
  addGasto: (...a: unknown[]) => { orden.push('addGasto'); return addGasto(...a); },
  resolverHuerfanoDesdeOficina: (...a: unknown[]) => { orden.push('resolver'); return resolver(...a); },
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => estatusViaje }),
          in: async () => ({ count: 1, error: null }),
        }),
      }),
    }),
  }),
}));

const { default: Pagina } = await import('./page');
const { VistaHuerfanos } = await import('./vista');

function buscar(nodo: ReactNode, componente: unknown, salida: Elemento[] = []): Elemento[] {
  if (Array.isArray(nodo)) { for (const h of nodo) buscar(h, componente, salida); return salida; }
  if (!isValidElement<Record<string, unknown>>(nodo)) return salida;
  if (nodo.type === componente) salida.push(nodo);
  buscar(nodo.props.children as ReactNode, componente, salida);
  return salida;
}

async function acciones() {
  const pagina = await Pagina({ searchParams: Promise.resolve({}) });
  const vista = buscar(pagina, VistaHuerfanos)[0];
  return {
    ...(vista.props.acciones as { adjuntar: Accion; descartar: Accion }),
    buscarViaje: vista.props.buscarViaje as (q: string) => Promise<unknown[]>,
  };
}

function datos(c: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(c)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  sesion = { tenantId: 't-1', rol: 'flota_admin' };
  orden.length = 0;
  addGasto.mockReset().mockResolvedValue(undefined);
  resolver.mockReset().mockResolvedValue({ error: null });
  traer.mockReset().mockResolvedValue({ gasto: { monto: 350, concepto: 'diesel' } });
  estatusViaje = { data: { estatus: 'abierto' }, error: null };
});

describe('Huérfanos — adjuntar', () => {
  it('adjunta: primero el gasto al viaje, DESPUÉS resuelve la fila como adjuntada, y vuelve a la bandeja', async () => {
    const { adjuntar } = await acciones();
    await expect(adjuntar(null, datos({ huerfanoId: 'h1', viajeId: 'v1' }))).rejects.toThrow('REDIRECT:/dashboard/huerfanos');
    expect(orden).toEqual(['addGasto', 'resolver']);
    expect(addGasto).toHaveBeenCalledWith('t-1', 'v1', { monto: 350, concepto: 'diesel' });
    expect(resolver).toHaveBeenCalledWith('t-1', 'h1', 'adjuntado', 'v1');
  });

  it('un rol sin dinero no adjunta nada', async () => {
    const { adjuntar } = await acciones();
    sesion = { tenantId: 't-1', rol: 'encargado' };
    expect(await adjuntar(null, datos({ huerfanoId: 'h1', viajeId: 'v1' }))).toEqual({ error: 'Tu rol no puede resolver comprobantes.' });
    expect(addGasto).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it('una sesión de otra flota (POST directo) se rechaza', async () => {
    const { adjuntar } = await acciones();
    sesion = { tenantId: 't-otra', rol: 'flota_admin' };
    expect(await adjuntar(null, datos({ huerfanoId: 'h1', viajeId: 'v1' }))).toEqual({ error: 'Esta bandeja no es de tu flota.' });
    expect(addGasto).not.toHaveBeenCalled();
  });

  it('sin comprobante o sin viaje elegido no toca la base', async () => {
    const { adjuntar } = await acciones();
    expect(await adjuntar(null, datos({ viajeId: 'v1' }))).toEqual({ error: 'Falta el comprobante.' });
    expect(await adjuntar(null, datos({ huerfanoId: 'h1' }))).toEqual({ error: 'Elige el viaje al que va.' });
    expect(addGasto).not.toHaveBeenCalled();
  });

  it('un comprobante que alguien más ya resolvió no se adjunta', async () => {
    traer.mockResolvedValue(null);
    const { adjuntar } = await acciones();
    const r = await adjuntar(null, datos({ huerfanoId: 'h1', viajeId: 'v1' }));
    expect(r?.error).toMatch(/ya no está pendiente/);
    expect(addGasto).not.toHaveBeenCalled();
  });

  it.each([0, '0', null, 'abc'])('monto %s: no mete una línea de $0.00 a la liquidación', async (monto) => {
    traer.mockResolvedValue({ gasto: { monto, concepto: 'diesel' } });
    const { adjuntar } = await acciones();
    const r = await adjuntar(null, datos({ huerfanoId: 'h1', viajeId: 'v1' }));
    expect(r?.error).toMatch(/no trae monto legible/);
    expect(addGasto).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each(['liquidado', 'cancelado'])('viaje destino %s: no adjunta', async (estatus) => {
    estatusViaje = { data: { estatus }, error: null };
    const { adjuntar } = await acciones();
    expect((await adjuntar(null, datos({ huerfanoId: 'h1', viajeId: 'v1' })))?.error).toBe('Ese viaje ya no está abierto. Recarga la página.');
    expect(addGasto).not.toHaveBeenCalled();
  });

  it('viaje que no es de la flota (no existe para este tenant): no adjunta', async () => {
    estatusViaje = { data: null, error: null };
    const { adjuntar } = await acciones();
    expect((await adjuntar(null, datos({ huerfanoId: 'h1', viajeId: 'ajeno' })))?.error).toMatch(/ya no está abierto/);
    expect(addGasto).not.toHaveBeenCalled();
  });

  it('un viaje en cuadre sí recibe el comprobante', async () => {
    estatusViaje = { data: { estatus: 'en_cuadre' }, error: null };
    const { adjuntar } = await acciones();
    await expect(adjuntar(null, datos({ huerfanoId: 'h1', viajeId: 'v1' }))).rejects.toThrow('REDIRECT');
    expect(addGasto).toHaveBeenCalledTimes(1);
  });

  it('si no se pudo leer el viaje destino no acusa al viaje: dice que no se pudo comprobar y no adjunta', async () => {
    estatusViaje = { data: null, error: { message: 'timeout' } };
    const { adjuntar } = await acciones();
    const r = await adjuntar(null, datos({ huerfanoId: 'h1', viajeId: 'v1' }));
    expect(r?.error).toMatch(/No se pudo comprobar el viaje destino/);
    expect(addGasto).not.toHaveBeenCalled();
  });

  it('gasto duplicado (23505): no resuelve la fila como adjuntada a este viaje', async () => {
    addGasto.mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }));
    const { adjuntar } = await acciones();
    const r = await adjuntar(null, datos({ huerfanoId: 'h1', viajeId: 'v1' }));
    expect(r?.error).toMatch(/ya vive en un viaje/);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('si el insert falla a medias queda pendiente: nunca se marca como puesto', async () => {
    addGasto.mockRejectedValue(new Error('boom'));
    const { adjuntar } = await acciones();
    const r = await adjuntar(null, datos({ huerfanoId: 'h1', viajeId: 'v1' }));
    expect(r).toEqual({ error: 'No se pudo adjuntar. Inténtalo de nuevo.' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('si resolver la fila falla, devuelve el error en vez de redirigir', async () => {
    resolver.mockResolvedValue({ error: 'No se pudo marcar' });
    const { adjuntar } = await acciones();
    expect(await adjuntar(null, datos({ huerfanoId: 'h1', viajeId: 'v1' }))).toEqual({ error: 'No se pudo marcar' });
  });
});

describe('Huérfanos — descartar', () => {
  it('descarta: resuelve como descartado, sin viaje, y vuelve a la bandeja', async () => {
    const { descartar } = await acciones();
    await expect(descartar(null, datos({ huerfanoId: 'h1' }))).rejects.toThrow('REDIRECT:/dashboard/huerfanos');
    expect(resolver).toHaveBeenCalledWith('t-1', 'h1', 'descartado', null);
    expect(addGasto).not.toHaveBeenCalled();
  });

  it('un rol sin dinero no descarta', async () => {
    const { descartar } = await acciones();
    sesion = { tenantId: 't-1', rol: 'encargado' };
    expect(await descartar(null, datos({ huerfanoId: 'h1' }))).toEqual({ error: 'Tu rol no puede resolver comprobantes.' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('una sesión de otra flota no descarta', async () => {
    const { descartar } = await acciones();
    sesion = { tenantId: 't-otra', rol: 'flota_admin' };
    expect(await descartar(null, datos({ huerfanoId: 'h1' }))).toEqual({ error: 'Esta bandeja no es de tu flota.' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('sin comprobante no toca la base', async () => {
    const { descartar } = await acciones();
    expect(await descartar(null, datos({}))).toEqual({ error: 'Falta el comprobante.' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('si la base falla, devuelve el error y no redirige', async () => {
    resolver.mockResolvedValue({ error: 'ya resuelto' });
    const { descartar } = await acciones();
    expect(await descartar(null, datos({ huerfanoId: 'h1' }))).toEqual({ error: 'ya resuelto' });
  });
});

describe('Huérfanos — buscador de viajes', () => {
  it('con permiso devuelve opciones; sin permiso LANZA (una lista vacía afirmaría que no hay viajes)', async () => {
    const { buscarViaje } = await acciones();
    expect(await buscarViaje('F')).toHaveLength(1);
    sesion = { tenantId: 't-1', rol: 'encargado' };
    await expect(buscarViaje('F')).rejects.toThrow('Tu rol no puede resolver comprobantes.');
  });
});
