import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL ESTADO DEL VÍNCULO Y EL CICLO DE UNA CORRIDA. Lo que se fija aquí:
//
//   · una lectura CAÍDA devuelve `null`, no un mapa vacío — la diferencia
//     entre «no lo sé» y «ninguno vinculado» es mandar o no a un contralor a
//     re-vincular trece portales que están bien;
//   · un estado que la base traiga y este código no conozca se descarta con
//     grito, no se pinta como «vinculado»;
//   · `anotarVinculo` NUNCA lanza: se llama después de que el lote ya decidió,
//     y tumbar un lote bueno por no poder anotar una píldora es cambiar un
//     problema de pantalla por uno de dinero;
//   · la sesión de un portal se guarda RECORTADA a sus cookies, no con la
//     bolsa entera del contexto;
//   · `portal_cambio` NO apaga la sesión: está viva y el roto es el mapeo.
// ═══════════════════════════════════════════════════════════════════════════

const from = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [])) }),
}));
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('../presupuesto', () => ({ acotada: (p: unknown) => p }));

const guardarSesionPortal = vi.fn(async () => {});
const invalidarSesionPortal = vi.fn(async () => {});
const sesionesDePortales = vi.fn();
vi.mock('./sesion_portal', async (real) => {
  const m = await real<typeof import('./sesion_portal')>();
  return {
    ...m,
    guardarSesionPortal: (...a: unknown[]) => guardarSesionPortal(...(a as [])),
    invalidarSesionPortal: (...a: unknown[]) => invalidarSesionPortal(...(a as [])),
    sesionesDePortales: (...a: unknown[]) => sesionesDePortales(...(a as [])),
  };
});

const {
  vinculosDePortales, anotarVinculo, sesionesVigentes, refrescarSesiones, invalidarVinculo,
} = await import('./vinculo_portal');

const TENANT = '22222222-2222-2222-2222-222222222222';
const AHORA = '2026-08-27T18:00:00.000Z';

beforeEach(() => {
  from.mockReset();
  guardarSesionPortal.mockClear();
  invalidarSesionPortal.mockClear();
  sesionesDePortales.mockReset();
  for (const f of Object.values(logger)) f.mockReset();
});

/** Un `select().eq()` de PostgREST que resuelve a lo que se le diga. */
function seleccion(resultado: unknown) {
  return () => ({ select: () => ({ eq: () => Promise.resolve(resultado) }) });
}

describe('vinculosDePortales', () => {
  it('devuelve el estado por comercio, con sus fechas', async () => {
    from.mockImplementation(seleccion({
      data: [{
        comercio: 'la_gas', estado: 'caducada', vinculada_en: '2026-08-20T10:00:00Z',
        caducada_en: '2026-08-27T09:00:00Z', motivo: 'campo de contraseña', actualizado_en: AHORA,
      }],
      error: null,
    }));

    const m = await vinculosDePortales(TENANT);
    expect(m?.get('la_gas')).toEqual({
      comercio: 'la_gas', estado: 'caducada',
      vinculadaEn: '2026-08-20T10:00:00Z', caducadaEn: '2026-08-27T09:00:00Z',
      motivo: 'campo de contraseña', actualizadoEn: AHORA,
    });
  });

  it('LA BASE CAÍDA DEVUELVE null, no un mapa vacío', async () => {
    from.mockImplementation(seleccion({ data: null, error: { message: 'timeout' } }));
    expect(await vinculosDePortales(TENANT)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('portal_estado.sin_leer', expect.anything());
  });

  it('un estado desconocido se DESCARTA con grito, no se pinta como vinculado', async () => {
    from.mockImplementation(seleccion({
      data: [{ comercio: 'g500', estado: 'medio_vinculado', vinculada_en: null, caducada_en: null, motivo: null, actualizado_en: AHORA }],
      error: null,
    }));
    const m = await vinculosDePortales(TENANT);
    expect(m?.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith('portal_estado.fila_ilegible', expect.anything());
  });
});

describe('anotarVinculo', () => {
  it('escribe la fecha que corresponde al estado, y solo esa', async () => {
    let fila: Record<string, unknown> | undefined;
    from.mockImplementation(() => ({ upsert: (f: Record<string, unknown>) => { fila = f; return Promise.resolve({ error: null }); } }));

    await anotarVinculo({ tenantId: TENANT, comercio: 'la_gas', estado: 'vinculado', ahora: AHORA });
    expect(fila).toMatchObject({ tenant_id: TENANT, comercio: 'la_gas', estado: 'vinculado', vinculada_en: AHORA });
    expect(fila).not.toHaveProperty('caducada_en');

    await anotarVinculo({ tenantId: TENANT, comercio: 'la_gas', estado: 'caducada', motivo: 'se cayó', ahora: AHORA });
    expect(fila).toMatchObject({ estado: 'caducada', caducada_en: AHORA, motivo: 'se cayó' });
    expect(fila).not.toHaveProperty('vinculada_en');
  });

  it('el motivo se acota: acaba en una pantalla, no en un volcado', async () => {
    let fila: Record<string, unknown> | undefined;
    from.mockImplementation(() => ({ upsert: (f: Record<string, unknown>) => { fila = f; return Promise.resolve({ error: null }); } }));
    await anotarVinculo({ tenantId: TENANT, comercio: 'g500', estado: 'sin_vincular', motivo: 'x'.repeat(900), ahora: AHORA });
    expect(String(fila!.motivo)).toHaveLength(400);
  });

  it('NO LANZA si la base falla: el lote ya decidió y no se tumba por una píldora', async () => {
    from.mockImplementation(() => ({ upsert: () => Promise.resolve({ error: { message: 'no se pudo' } }) }));
    await expect(anotarVinculo({ tenantId: TENANT, comercio: 'g500', estado: 'sin_vincular', ahora: AHORA })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('portal_estado.sin_anotar', expect.anything());
  });
});

describe('sesionesVigentes', () => {
  const sesion = (capturadaEn: string, dominio: string) => ({
    storageState: JSON.stringify({ cookies: [{ name: 's', value: 'x', domain: dominio, path: '/' }], origins: [] }),
    capturadaEn,
  });

  it('las frescas entran y arman UN storageState; las viejas salen por su lado', async () => {
    const ahoraMs = Date.parse(AHORA);
    sesionesDePortales.mockResolvedValue(new Map([
      ['portal_facturacion:la_gas', sesion(new Date(ahoraMs - 60_000).toISOString(), 'lagas.com.mx')],
      ['portal_facturacion:g500', sesion(new Date(ahoraMs - 4 * 3600_000).toISOString(), 'g500.mx')],
    ]));

    const r = await sesionesVigentes(TENANT, ahoraMs);
    expect([...r.porComercio.keys()]).toEqual(['la_gas']);
    expect(r.vencidasPorEdad).toEqual(['g500']);
    expect(JSON.parse(r.storageState!).cookies).toHaveLength(1);
  });

  it('LA BASE CAÍDA no invalida nada: se entra sin sesión y se pide vincular, que es la molestia barata', async () => {
    sesionesDePortales.mockResolvedValue(null);
    const r = await sesionesVigentes(TENANT, Date.parse(AHORA));
    expect(r.porComercio.size).toBe(0);
    expect(r.vencidasPorEdad, 'invalidar sesiones buenas por un timeout sería el error caro').toEqual([]);
    expect(r.storageState).toBeNull();
  });

  it('una fila `#sesion` que no es de un portal de facturación se ignora', async () => {
    sesionesDePortales.mockResolvedValue(new Map([['wialon', sesion(AHORA, 'wialon.com')]]));
    const r = await sesionesVigentes(TENANT, Date.parse(AHORA));
    expect(r.porComercio.size).toBe(0);
    expect(r.vencidasPorEdad).toEqual([]);
  });
});

describe('refrescarSesiones', () => {
  const completo = JSON.stringify({
    cookies: [
      { name: 'lg', value: '1', domain: 'facturacion.lagas.com.mx', path: '/' },
      { name: 'otro', value: '1', domain: 'megasur.com.mx', path: '/' },
    ],
    origins: [],
  });

  it('guarda RECORTADO a las cookies de ese portal, no la bolsa entera', async () => {
    from.mockImplementation(() => ({ upsert: () => Promise.resolve({ error: null }) }));
    const r = await refrescarSesiones({
      tenantId: TENANT,
      navegador: { estadoDeSesion: async () => completo },
      portales: new Map([['la_gas', 'https://facturacion.lagas.com.mx/']]),
      ahora: AHORA,
    });

    expect(r).toEqual(['la_gas']);
    const [, conector, guardada] = guardarSesionPortal.mock.calls[0] as unknown as [string, string, { storageState: string; capturadaEn: string }];
    expect(conector).toBe('portal_facturacion:la_gas');
    expect(guardada.capturadaEn).toBe(AHORA);
    const bolsa = JSON.parse(guardada.storageState) as { cookies: Array<{ name: string }> };
    expect(bolsa.cookies.map((c) => c.name), 'la cookie de Megasur no puede acabar en la fila de La Gas').toEqual(['lg']);
  });

  it('un portal que no dejó cookies NO se sobrescribe con una bolsa vacía', async () => {
    const r = await refrescarSesiones({
      tenantId: TENANT,
      navegador: { estadoDeSesion: async () => completo },
      portales: new Map([['g500', 'https://g500.mx/']]),
      ahora: AHORA,
    });
    expect(r).toEqual([]);
    expect(guardarSesionPortal).not.toHaveBeenCalled();
  });

  it('sin portales, ni se le pide el estado al navegador', async () => {
    const estadoDeSesion = vi.fn(async () => completo);
    await refrescarSesiones({ tenantId: TENANT, navegador: { estadoDeSesion }, portales: new Map(), ahora: AHORA });
    expect(estadoDeSesion).not.toHaveBeenCalled();
  });

  it('un guardado que revienta no se lleva a los demás portales', async () => {
    from.mockImplementation(() => ({ upsert: () => Promise.resolve({ error: null }) }));
    guardarSesionPortal.mockRejectedValueOnce(new Error('cofre sin llave'));
    const r = await refrescarSesiones({
      tenantId: TENANT,
      navegador: { estadoDeSesion: async () => completo },
      portales: new Map([['la_gas', 'https://facturacion.lagas.com.mx/'], ['megasur', 'http://megasur.com.mx:8029/']]),
      ahora: AHORA,
    });
    expect(r).toEqual(['megasur']);
    expect(logger.warn).toHaveBeenCalledWith('vinculo_portal.refresco_fallo', expect.anything());
  });
});

describe('invalidarVinculo', () => {
  it('la sesión caducada se apaga Y se anota', async () => {
    let fila: Record<string, unknown> | undefined;
    from.mockImplementation(() => ({ upsert: (f: Record<string, unknown>) => { fila = f; return Promise.resolve({ error: null }); } }));

    await invalidarVinculo({ tenantId: TENANT, comercio: 'la_gas', clase: 'sesion_caducada', motivo: 'nos sacó', ahora: AHORA });
    expect(invalidarSesionPortal).toHaveBeenCalledWith(TENANT, 'portal_facturacion:la_gas');
    expect(fila).toMatchObject({ estado: 'caducada', caducada_en: AHORA });
  });

  it('«el portal cambió» NO toca la sesión: está viva y el roto es NUESTRO mapeo', async () => {
    await invalidarVinculo({ tenantId: TENANT, comercio: 'capufe', clase: 'portal_cambio', motivo: 'falta #rfc', ahora: AHORA });
    expect(invalidarSesionPortal, 'borrarla le costaría al cliente un login por un bug de Likida').not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});
