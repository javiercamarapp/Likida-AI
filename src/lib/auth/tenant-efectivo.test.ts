import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA PUERTA DE /dashboard VISTA DESDE FUERA — con el chofer tecleando la URL.
//
// `visibilidad.test.ts` prueba la decisión (`puedeVerRuta('operador', X)` es
// false para todo). Esto prueba que la decisión se APLIQUE: que la función por
// la que pasan todas las páginas con datos de /dashboard rebote de verdad, y
// que rebote a un sitio del que no vuelva a salir rebotado.
//
// Es la mitad que se olvida. La 0045 ya tuvo que cerrar exactamente este
// hueco en la base: la UI escondía la pantalla del chofer y la consulta no.
// ═══════════════════════════════════════════════════════════════════════════

const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect: (...a: unknown[]) => redirect(...(a as [])) }));

const requireSessionTenant = vi.fn();
vi.mock('./guard', () => ({ requireSessionTenant: (...a: unknown[]) => requireSessionTenant(...a) }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
  }),
}));

const { resolverTenantEfectivo } = await import('./tenant-efectivo');
const { inicioDe } = await import('./visibilidad');

const CHOFER = { userId: 'u-9', tenantId: 't-1', rol: 'operador', nombre: 'Juan', operadorId: 'o-9', avatarUrl: null };

beforeEach(() => { redirect.mockClear(); requireSessionTenant.mockReset(); });

// Toda ruta de /dashboard que hoy existe, sin depender de que alguien se
// acuerde de añadir la nueva a una lista escrita a mano.
const RUTAS = [
  '/dashboard',
  '/dashboard/despacho', '/dashboard/viajes', '/dashboard/pod', '/dashboard/incidencias',
  '/dashboard/unidades', '/dashboard/operadores', '/dashboard/mapa', '/dashboard/documentos',
  '/dashboard/analitica', '/dashboard/chat', '/dashboard/soporte',
  '/dashboard/contador', '/dashboard/contador/deducciones', '/dashboard/contador/cfdi',
  '/dashboard/contador/combustible', '/dashboard/contador/retenciones',
  '/dashboard/contador/liquidaciones',
  '/dashboard/valor-ahorro', '/dashboard/rentabilidad', '/dashboard/clientes',
  '/dashboard/combustible-casetas', '/dashboard/cotizador', '/dashboard/cuadre',
  '/dashboard/facturacion', '/dashboard/cobranza', '/dashboard/suscripcion',
  '/dashboard/usuarios', '/dashboard/politicas', '/dashboard/configuracion',
];

describe('un chofer no entra a NINGUNA pantalla de /dashboard, ni tecleando la URL', () => {
  it.each(RUTAS)('%s lo rebota', async (ruta) => {
    requireSessionTenant.mockResolvedValue(CHOFER);
    await expect(resolverTenantEfectivo(ruta, undefined)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect, `${ruta} sirvió el panel de oficina a un chofer`).toHaveBeenCalledWith('/chofer');
  });

  it('el rebote lo deja EN SU PANEL, no en /sin-acceso', async () => {
    // Antes `inicioDe('operador')` devolvía '/sin-acceso' —no tenía áreas y no
    // había panel suyo—, así que el chofer que llegaba aquí leía "no tienes
    // acceso" teniendo /chofer, y ese texto le dice que pida su alta.
    requireSessionTenant.mockResolvedValue(CHOFER);
    await expect(resolverTenantEfectivo('/dashboard', undefined)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).not.toHaveBeenCalledWith('/sin-acceso');
    expect(redirect).toHaveBeenCalledWith(inicioDe('operador'));
  });

  it('el destino del rebote no vuelve a pasar por esta puerta — no hay bucle', () => {
    // `/chofer` no es una ruta de /dashboard, así que no la gatea esta
    // función: el rebote termina ahí. Es la propiedad que hizo falta cambiar
    // el aterrizaje del contador para conseguir.
    expect(RUTAS).not.toContain(inicioDe('operador'));
  });

  it('`?rol=` no le sirve al chofer para colarse', async () => {
    // `rolEfectivo` solo honra el parámetro si la sesión REAL es superadmin.
    // Si no, `?rol=flota_admin` sería subir de privilegio con un teclazo.
    requireSessionTenant.mockResolvedValue(CHOFER);
    await expect(
      resolverTenantEfectivo('/dashboard/rentabilidad', { rol: 'flota_admin' }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/chofer');
  });

  it('`?tenant=` tampoco: se rebota ANTES de resolver flota alguna', async () => {
    requireSessionTenant.mockResolvedValue(CHOFER);
    await expect(
      resolverTenantEfectivo('/dashboard/cuadre', { tenant: 't-de-otra-flota' }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/chofer');
  });
});

describe('los roles de oficina siguen entrando a lo suyo', () => {
  it('el dueño pasa sin rebote', async () => {
    const duena = { userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana', operadorId: null, avatarUrl: null };
    requireSessionTenant.mockResolvedValue(duena);
    const r = await resolverTenantEfectivo('/dashboard/rentabilidad', undefined);
    expect(redirect).not.toHaveBeenCalled();
    expect(r.tenantId).toBe('t-1');
  });

  it('al encargado se le sigue negando el dinero, y va a /dashboard (no a /chofer)', async () => {
    const jefe = { userId: 'u-2', tenantId: 't-1', rol: 'encargado', nombre: 'Beto', operadorId: null, avatarUrl: null };
    requireSessionTenant.mockResolvedValue(jefe);
    await expect(resolverTenantEfectivo('/dashboard/rentabilidad', undefined)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });
});
