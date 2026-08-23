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

// El builder por tabla (mismo patrón que buzon_escritura.test.ts): las
// pruebas viejas no ponen nada en `colas` y reciben `{ data: null }` — el
// comportamiento exacto del mock anterior. Las de impersonación sí sirven
// respuestas por tabla para poder MIRAR qué se escribió.
type Registro = { tabla: string; op: string | null; payload: unknown; eq: Array<[string, unknown]> };
type Respuesta = { data: unknown; error: { message: string } | null };
const llamadas: Registro[] = [];
const colas = new Map<string, Respuesta[]>();

function contestar(tabla: string): Respuesta {
  const cola = colas.get(tabla) ?? [];
  const r = cola.length > 1 ? cola.shift() : cola[0];
  return r ?? { data: null, error: null };
}

function builder(tabla: string) {
  const r: Registro = { tabla, op: null, payload: null, eq: [] };
  llamadas.push(r);
  const b: Record<string, unknown> = {};
  b.insert = (p: unknown) => { r.op = 'insert'; r.payload = p; return b; };
  b.upsert = (p: unknown) => { r.op = 'upsert'; r.payload = p; return b; };
  b.select = () => { if (!r.op) r.op = 'select'; return b; };
  b.eq = (c: string, v: unknown) => { r.eq.push([c, v]); return b; };
  b.maybeSingle = async () => contestar(tabla);
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(contestar(tabla)).then(res, rej);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (t: string) => builder(t) }),
}));

const logs = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger: logs }));

const { resolverTenantEfectivo } = await import('./tenant-efectivo');
const { inicioDe } = await import('./visibilidad');

const CHOFER = { userId: 'u-9', tenantId: 't-1', rol: 'operador', nombre: 'Juan', operadorId: 'o-9', avatarUrl: null };

beforeEach(() => {
  redirect.mockClear();
  requireSessionTenant.mockReset();
  llamadas.length = 0;
  colas.clear();
  logs.warn.mockClear();
});

// Toda ruta de /dashboard que hoy existe, sin depender de que alguien se
// acuerde de añadir la nueva a una lista escrita a mano.
//
// Las 17 páginas de "dueño de flota" (despacho, viajes, pod, incidencias,
// unidades, operadores, mapa, documentos, analitica, chat, valor-ahorro,
// rentabilidad, clientes, cotizador, cuadre, facturacion, cobranza) y las 6
// del panel del contador (contador, contador/deducciones, contador/cfdi,
// contador/combustible, contador/retenciones, contador/liquidaciones) se
// borraron el 10-ago-2026 para rehacerse desde cero — salieron de esta
// lista junto con la página. La RAÍZ del panel del contador volvió el
// 14-ago-2026 y con ella su renglón aquí.
const RUTAS = [
  '/dashboard', '/dashboard/contador',
  '/dashboard/soporte',
  '/dashboard/combustible-casetas', '/dashboard/suscripcion',
  '/dashboard/usuarios', '/dashboard/politicas', '/dashboard/configuracion',
  '/dashboard/onboarding',
];

describe('un chofer no entra a NINGUNA pantalla de /dashboard, ni tecleando la URL', () => {
  // Retirado el 7-ago-2026 (/chofer, /mis-viajes y su login): `operador` ya
  // no tiene panel propio, así que `inicioDe('operador')` es '/sin-acceso' —
  // y esta vez es la verdad, no un texto que le miente a alguien con panel.
  it.each(RUTAS)('%s lo rebota', async (ruta) => {
    requireSessionTenant.mockResolvedValue(CHOFER);
    await expect(resolverTenantEfectivo(ruta, undefined)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect, `${ruta} sirvió el panel de oficina a un chofer`).toHaveBeenCalledWith('/sin-acceso');
  });

  it('el rebote coincide con lo que dice `inicioDe`', async () => {
    requireSessionTenant.mockResolvedValue(CHOFER);
    await expect(resolverTenantEfectivo('/dashboard', undefined)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(inicioDe('operador'));
    expect(inicioDe('operador')).toBe('/sin-acceso');
  });

  it('el destino del rebote no vuelve a pasar por esta puerta — no hay bucle', () => {
    // `/sin-acceso` no es una ruta de /dashboard, así que no la gatea esta
    // función: el rebote termina ahí.
    expect(RUTAS).not.toContain(inicioDe('operador'));
  });

  it('`?rol=` no le sirve al chofer para colarse', async () => {
    // `rolEfectivo` solo honra el parámetro si la sesión REAL es superadmin.
    // Si no, `?rol=flota_admin` sería subir de privilegio con un teclazo.
    requireSessionTenant.mockResolvedValue(CHOFER);
    await expect(
      resolverTenantEfectivo('/dashboard/suscripcion', { rol: 'flota_admin' }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/sin-acceso');
  });

  it('`?tenant=` tampoco: se rebota ANTES de resolver flota alguna', async () => {
    requireSessionTenant.mockResolvedValue(CHOFER);
    await expect(
      resolverTenantEfectivo('/dashboard/suscripcion', { tenant: 't-de-otra-flota' }),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/sin-acceso');
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
    const r = await resolverTenantEfectivo('/dashboard/suscripcion', { vista: 'demo', rol: 'contador' });
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
    // aterrizaje (su panel, reconstruido el 14-ago-2026 — mientras estuvo
    // borrado, del 10 al 14, el aterrizaje fue Suscripción). Sin el sufijo,
    // ese salto lo dejaba ahí con sus propios ojos de superadmin: menú
    // completo, sin cinta, y creyendo que eso era lo que ve un contador.
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
      resolverTenantEfectivo('/dashboard', { rol: 'flota_admin' }),
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
    const r = await resolverTenantEfectivo('/dashboard/suscripcion', undefined);
    expect(redirect).not.toHaveBeenCalled();
    expect(r.tenantId).toBe('t-1');
  });

  it('al encargado se le sigue negando el dinero, y va a /dashboard (no a /chofer)', async () => {
    const jefe = { userId: 'u-2', tenantId: 't-1', rol: 'encargado', nombre: 'Beto', operadorId: null, avatarUrl: null };
    requireSessionTenant.mockResolvedValue(jefe);
    await expect(resolverTenantEfectivo('/dashboard/suscripcion', undefined)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA IMPERSONACIÓN SE FIRMA (0110, pieza 3): el "ver como" de una flota REAL
// era el acceso más privilegiado del sistema y el único sin rastro. Lo que se
// fija aquí: se firma UNA vez por (actor, flota, día MX) vía el PK de
// `impersonacion_dia`; la demo no cuenta; y NINGÚN fallo del registro puede
// dejar al superadmin fuera del panel — la firma es auditoría, no candado.
// ═══════════════════════════════════════════════════════════════════════════
describe('la impersonación con ?tenant= real queda firmada', () => {
  const SUPER = { userId: 'u-0', tenantId: 'demo', rol: 'superadmin', nombre: 'Javier', operadorId: null, avatarUrl: null };
  const FLOTA = { id: 't-7', nombre: 'Transportes del Norte' };

  const de = (tabla: string) => llamadas.filter((l) => l.tabla === tabla);

  it('la primera vez del día: dedup ganado → bitácora escrita, con actor, flota y día MX', async () => {
    colas.set('tenant', [{ data: FLOTA, error: null }]);
    colas.set('impersonacion_dia', [{ data: [{ dia: '2026-08-15' }], error: null }]);

    requireSessionTenant.mockResolvedValue(SUPER);
    const r = await resolverTenantEfectivo('/dashboard', { tenant: 't-7' });

    // La resolución salió normal: la firma no cambia lo que la página ve.
    expect(r.tenantId).toBe('t-7');
    expect(r.tenantNombre).toBe('Transportes del Norte');

    const [dedup] = de('impersonacion_dia');
    expect(dedup.op).toBe('upsert');
    expect(dedup.payload).toMatchObject({ actor_id: 'u-0', tenant_id: 't-7' });
    expect(String((dedup.payload as Record<string, unknown>).dia)).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const [firma] = de('bitacora_auditoria');
    expect(firma.op).toBe('insert');
    expect(firma.payload).toMatchObject({
      tenant_id: 't-7',
      actor_id: 'u-0',
      accion: 'impersonacion.dashboard',
      entidad: 'tenant',
      entidad_id: 't-7',
    });
  });

  it('la segunda vez del mismo día NO re-firma: el upsert no devolvió fila y la bitácora ni se toca', async () => {
    colas.set('tenant', [{ data: FLOTA, error: null }]);
    // `ignoreDuplicates` con el PK ya ocupado devuelve lista vacía.
    colas.set('impersonacion_dia', [{ data: [], error: null }]);

    requireSessionTenant.mockResolvedValue(SUPER);
    await resolverTenantEfectivo('/dashboard', { tenant: 't-7' });

    expect(de('impersonacion_dia')).toHaveLength(1);
    expect(de('bitacora_auditoria')).toHaveLength(0);
  });

  it('un fallo del registro JAMÁS rompe la resolución — se loguea y la página sigue', async () => {
    colas.set('tenant', [{ data: FLOTA, error: null }]);
    colas.set('impersonacion_dia', [{ data: null, error: { message: 'fetch failed' } }]);

    requireSessionTenant.mockResolvedValue(SUPER);
    const r = await resolverTenantEfectivo('/dashboard', { tenant: 't-7' });

    expect(r.tenantId).toBe('t-7');
    expect(logs.warn).toHaveBeenCalledWith('impersonacion.no_firmada',
      expect.objectContaining({ tenant: 't-7', err: 'fetch failed' }));
    expect(de('bitacora_auditoria')).toHaveLength(0);
  });

  it('una bitácora caída tampoco la rompe: el dedup quedó, el fallo quedó en el log', async () => {
    colas.set('tenant', [{ data: FLOTA, error: null }]);
    colas.set('impersonacion_dia', [{ data: [{ dia: '2026-08-15' }], error: null }]);
    colas.set('bitacora_auditoria', [{ data: null, error: { message: 'timeout' } }]);

    requireSessionTenant.mockResolvedValue(SUPER);
    const r = await resolverTenantEfectivo('/dashboard', { tenant: 't-7' });

    expect(r.tenantNombre).toBe('Transportes del Norte');
    expect(logs.warn).toHaveBeenCalledWith('impersonacion.bitacora_no_escribio', expect.anything());
  });

  it('`?vista=demo` NO se firma: mirar la demo no es mirar a un cliente', async () => {
    requireSessionTenant.mockResolvedValue(SUPER);
    await resolverTenantEfectivo('/dashboard', { vista: 'demo' });
    expect(de('impersonacion_dia')).toHaveLength(0);
    expect(de('bitacora_auditoria')).toHaveLength(0);
  });

  it('un `?tenant=` que NO resuelve (flota inexistente) no firma nada', async () => {
    // El mock default contesta `{ data: null }`: la flota no existe.
    requireSessionTenant.mockResolvedValue(SUPER);
    await resolverTenantEfectivo('/dashboard', { tenant: 't-fantasma' });
    expect(de('impersonacion_dia')).toHaveLength(0);
  });

  it('un rol real con `?tenant=` no firma: el parámetro se ignora entero para él', async () => {
    requireSessionTenant.mockResolvedValue({ userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana', operadorId: null, avatarUrl: null });
    const r = await resolverTenantEfectivo('/dashboard', { tenant: 't-7' });
    expect(r.tenantId).toBe('t-1');
    expect(de('impersonacion_dia')).toHaveLength(0);
    expect(de('bitacora_auditoria')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA FLOTA ELEGIDA EN EL SELECTOR (16-ago-2026, muerte del tenant implícito).
// Sin params de preview, el tenantId del superadmin YA es su selección
// explícita (la cookie firmada que `requireSessionTenant` resolvió — aquí
// mockeado). Lo que se fija: una flota real elegida trae su nombre (la cinta
// dice la verdad) y se FIRMA igual que el `?tenant=`; la demo elegida no es
// un cliente y no se firma; y una selección hacia una flota borrada se
// declara (`tenantExiste=false`), no se pinta en ceros.
// ═══════════════════════════════════════════════════════════════════════════
describe('la flota elegida por cookie (sin params) — nombre y firma', () => {
  const de = (tabla: string) => llamadas.filter((l) => l.tabla === tabla);
  const SUPER_CON_SELECCION = { userId: 'u-0', tenantId: 't-9', rol: 'superadmin', nombre: 'Javier', operadorId: null, avatarUrl: null };

  it('flota real elegida: nombre resuelto e impersonación firmada con el mismo dedup', async () => {
    colas.set('tenant', [{ data: { id: 't-9', nombre: 'Fletes del Golfo' }, error: null }]);
    colas.set('impersonacion_dia', [{ data: [{ dia: '2026-08-16' }], error: null }]);

    requireSessionTenant.mockResolvedValue(SUPER_CON_SELECCION);
    const r = await resolverTenantEfectivo('/dashboard', undefined);

    expect(r.tenantId).toBe('t-9');
    expect(r.tenantNombre).toBe('Fletes del Golfo');
    expect(r.tenantExiste).toBe(true);

    const [dedup] = de('impersonacion_dia');
    expect(dedup.op).toBe('upsert');
    expect(dedup.payload).toMatchObject({ actor_id: 'u-0', tenant_id: 't-9' });
    const [firma] = de('bitacora_auditoria');
    expect(firma.payload).toMatchObject({ accion: 'impersonacion.dashboard', tenant_id: 't-9' });
  });

  it('la DEMO elegida no se firma: mirar la demo no es mirar a un cliente', async () => {
    vi.stubEnv('DEMO_TENANT_ID', 'demo-fija');
    colas.set('tenant', [{ data: { id: 'demo-fija' }, error: null }]);
    requireSessionTenant.mockResolvedValue({ ...SUPER_CON_SELECCION, tenantId: 'demo-fija' });
    const r = await resolverTenantEfectivo('/dashboard', undefined);
    expect(r.tenantNombre).toBeNull();
    expect(de('impersonacion_dia')).toHaveLength(0);
    expect(de('bitacora_auditoria')).toHaveLength(0);
    vi.unstubAllEnvs();
  });

  it('la selección apunta a una flota BORRADA: tenantExiste=false y sin firma', async () => {
    // El mock default contesta `{ data: null }`: la fila no está.
    requireSessionTenant.mockResolvedValue(SUPER_CON_SELECCION);
    const r = await resolverTenantEfectivo('/dashboard', undefined);
    expect(r.tenantExiste).toBe(false);
    expect(de('impersonacion_dia')).toHaveLength(0);
  });

  it('un ERROR de la consulta no marca la flota inexistente: no saber no es un "no"', async () => {
    colas.set('tenant', [{ data: null, error: { message: 'fetch failed' } }]);
    requireSessionTenant.mockResolvedValue(SUPER_CON_SELECCION);
    const r = await resolverTenantEfectivo('/dashboard', undefined);
    expect(r.tenantExiste).toBe(true);
    expect(de('impersonacion_dia')).toHaveLength(0);
  });
});
