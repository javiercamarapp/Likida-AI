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

// ═══════════════════════════════════════════════════════════════════════════
// LA PREVISUALIZACIÓN NO PUEDE VOLVERSE UNA ESCALADA DE PRIVILEGIO.
//
// `?rol=` y `?vista=` los teclea cualquiera en la barra de direcciones. Que
// solo los honre un superadmin es la única línea entre "modo de comparación" y
// "un flota_admin se pone `?rol=superadmin` y entra a la consola de Likida".
// Se prueba desde fuera, sobre la función por la que pasan las 20 páginas.
// ═══════════════════════════════════════════════════════════════════════════
describe('previsualizar solo quita visibilidad, y solo a un superadmin', () => {
  const SUPER = { userId: 'u-0', tenantId: 'demo', rol: 'superadmin', nombre: 'Javier', operadorId: null, avatarUrl: null };
  const DUENA = { userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana', operadorId: null, avatarUrl: null };
  const CONTADOR = { userId: 'u-3', tenantId: 't-1', rol: 'contador', nombre: 'Caro', operadorId: null, avatarUrl: null };

  it('`?rol=superadmin` desde un flota_admin NO lo vuelve superadmin', async () => {
    requireSessionTenant.mockResolvedValue(DUENA);
    const r = await resolverTenantEfectivo('/dashboard', { rol: 'superadmin' });
    expect(r.rol).toBe('flota_admin');
    // Y sin rol de superadmin, `?tenant=` de otra flota tampoco se resuelve:
    // el `if` que lo lee exige la sesión REAL, no la previsualizada.
    expect(r.tenantId).toBe('t-1');
  });

  it('`?rol=` de un flota_admin tampoco le QUITA nada — se ignora entero', async () => {
    requireSessionTenant.mockResolvedValue(DUENA);
    const r = await resolverTenantEfectivo('/dashboard', { rol: 'encargado' });
    expect(r.rol).toBe('flota_admin');
  });

  it('un superadmin sí baja a contador, y solo a los tres roles de oficina', async () => {
    requireSessionTenant.mockResolvedValue(SUPER);
    const r = await resolverTenantEfectivo('/dashboard/contador', { vista: 'demo', rol: 'contador' });
    expect(r.rol).toBe('contador');

    // `operador` no está en PREVISUALIZABLES: su panel es /chofer y darle ese
    // rol aquí solo serviría para que `inicioDe` lo mande fuera de /dashboard.
    redirect.mockClear();
    requireSessionTenant.mockResolvedValue(SUPER);
    const r2 = await resolverTenantEfectivo('/dashboard', { vista: 'demo', rol: 'operador' });
    expect(r2.rol).toBe('superadmin');
  });

  it('el rebote CONSERVA la previsualización — no se apaga sola a media navegación', async () => {
    // /dashboard es de `operacion`: el contador no la ve y se le rebota a su
    // panel. Sin el sufijo, ese salto lo dejaba en /dashboard/contador con sus
    // propios ojos de superadmin: menú completo, sin cinta, y creyendo que eso
    // era lo que ve un contador.
    requireSessionTenant.mockResolvedValue(SUPER);
    await expect(
      resolverTenantEfectivo('/dashboard', { vista: 'demo', rol: 'contador' }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard/contador?vista=demo&rol=contador');
  });

  it('`?tenant=` gana a `?vista=` en el sufijo del rebote, igual que en sufijoTenant', async () => {
    requireSessionTenant.mockResolvedValue(SUPER);
    await expect(
      resolverTenantEfectivo('/dashboard', { tenant: 't-7', vista: 'demo', rol: 'contador' }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard/contador?tenant=t-7&rol=contador');
  });

  it('a un rol real NO se le arrastra `?rol=` en el rebote', async () => {
    // Sería pasear un parámetro que `rolEfectivo` ignora, y dejarlo en la URL
    // invita a leerlo como si hiciera algo.
    requireSessionTenant.mockResolvedValue(CONTADOR);
    await expect(
      resolverTenantEfectivo('/dashboard/despacho', { rol: 'flota_admin' }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard/contador');
  });

  it('el destino del rebote sí lo puede ver el rol previsualizado — no hay bucle', async () => {
    const { puedeVerRuta } = await import('./visibilidad');
    for (const rol of ['flota_admin', 'encargado', 'contador']) {
      expect(puedeVerRuta(rol, inicioDe(rol)), `${rol} rebota a una ruta que tampoco ve`).toBe(true);
    }
  });
});

describe('una flota que no existe se declara, no se pinta en ceros', () => {
  it('superadmin apuntando a un DEMO_TENANT_ID sin fila: tenantExiste=false', async () => {
    // El mock de supabaseAdmin de este archivo devuelve `{ data: null }`: es
    // exactamente el caso de hoy en producción — cero tenants.
    requireSessionTenant.mockResolvedValue({ userId: 'u-0', tenantId: 'demo', rol: 'superadmin', nombre: 'Javier', operadorId: null, avatarUrl: null });
    const r = await resolverTenantEfectivo('/dashboard', { vista: 'demo' });
    expect(r.tenantExiste).toBe(false);
  });

  it('a un rol real no se le pregunta: su tenant existe por llave foránea', async () => {
    requireSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana', operadorId: null, avatarUrl: null });
    const r = await resolverTenantEfectivo('/dashboard', undefined);
    expect(r.tenantExiste).toBe(true);
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
