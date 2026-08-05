import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// UN COSTO QUE NO SE REGISTRÓ NO PUEDE VERSE IGUAL QUE UN COSTO BAJO.
//
// Likida cobra POR LIQUIDACIÓN: el costo unitario es la cifra con la que se fija
// el precio del producto. Antes de la auditoría 5 había cuatro caminos por los
// que esa cifra bajaba sola y en silencio, y los cuatro producían la misma
// salida que "salió barato":
//
//   1. `registrarCosto` asumía que `await` sobre el query builder LANZA. No lo
//      hace: supabase-js resuelve con `{ data: null, error }`. Un fallo de RLS o
//      una columna que no existe tras una migración pasaban sin excepción y sin
//      log — el `catch` solo cubría que reventara el `fetch`.
//   2. `CUADRA_WHATSAPP_MSG_USD=` (puesta y vacía, que es lo que deja un copiado
//      de `.env.example` a medias) → `Number('')` es 0, y `??` no cae al default
//      porque la cadena vacía no es `undefined`. Cada mensaje saliente se
//      registraba a $0.00.
//   3. Un `costoUsd` NaN se serializa como `null` en el JSON del insert: la fila
//      entra con `costo_usd` nulo y al leerla `Number(null)` vale 0.
//   4. `getResumenCosto` descartaba el `error` y devolvía ceros. "La consulta
//      falló" y "el mes costó $0" eran el mismo objeto.
//
// Cada test de aquí abajo es uno de esos caminos.
// ═══════════════════════════════════════════════════════════════════════════

const insert = vi.fn();
const update = vi.fn();
const select = vi.fn();
const from = vi.fn();
const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (...a: unknown[]) => from(...(a as [])),
    rpc: (...a: unknown[]) => rpc(...a),
  }),
}));

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

/** Cadena `.eq().eq().is()` que devuelve siempre el mismo thenable. */
function cadena(resultado: unknown) {
  const nodo: Record<string, unknown> = {};
  for (const m of ['eq', 'is', 'select']) nodo[m] = () => nodo;
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(resultado).then(r);
  return nodo;
}

const { registrarCosto, registrarCostoWhatsApp, vincularCostosALiquidacion, getResumenCosto, precioMensajeWhatsAppUsd, faseDeModelo } =
  await import('./costos');

beforeEach(() => {
  for (const f of [insert, update, select, from, rpc]) f.mockReset();
  for (const f of Object.values(logger)) f.mockReset();
  insert.mockResolvedValue({ error: null });
  from.mockImplementation(() => ({ insert, update, select }));
  rpc.mockResolvedValue({ data: RESUMEN_VACIO, error: null });
  vi.unstubAllEnvs();
});

/** Lo que devuelve `resumen_costo_ia_tenant` para una flota sin ni una llamada. */
const RESUMEN_VACIO = {
  totales: { n: 0, viajes: 0, costoUsd: 0, tokensIn: 0, tokensOut: 0 },
  porFase: [],
};

describe('registrarCosto — un insert que rebota no puede pasar callado', () => {
  const costo = {
    tenantId: '11111111-1111-1111-1111-111111111111',
    viajeId: '22222222-2222-2222-2222-222222222222',
    fase: 'cuadre' as const,
    modelo: 'anthropic/claude-sonnet-5',
    tokensIn: 1200,
    tokensOut: 300,
    costoUsd: 0.0451,
  };

  it('escribe en `llm_costo` cuando todo va bien', async () => {
    await registrarCosto(costo);
    expect(from).toHaveBeenCalledWith('llm_costo');
    expect(insert.mock.calls[0][0]).toMatchObject({
      tenant_id: costo.tenantId, viaje_id: costo.viajeId, fase: 'cuadre', costo_usd: 0.0451,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('un error de la base deja línea CON los identificadores, no solo `err`', async () => {
    // ANTES: supabase-js resuelve con `{ error }` en vez de lanzar, así que el
    // `catch` no se disparaba nunca y no había ni una línea. El costo del viaje
    // se perdía y el panel lo leía como barato.
    insert.mockResolvedValue({ error: { message: 'new row violates row-level security policy', code: '42501' } });
    await registrarCosto(costo);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [msg, meta] = logger.error.mock.calls[0];
    expect(msg).toBe('costo.no_registrado');
    expect(meta).toMatchObject({
      tenant: costo.tenantId, viaje: costo.viajeId, fase: 'cuadre',
      modelo: 'anthropic/claude-sonnet-5', costoUsd: 0.0451, code: '42501',
    });
  });

  it('no lanza aunque la base falle: registrar el costo NO puede tumbar la liquidación', async () => {
    insert.mockResolvedValue({ error: { message: 'boom' } });
    await expect(registrarCosto(costo)).resolves.toBeUndefined();
    insert.mockRejectedValue(new Error('fetch failed'));
    await expect(registrarCosto(costo)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('un costo NaN NO se escribe: entraría como NULL y se leería como $0', async () => {
    // `NaN.toFixed(6)` es "NaN", `Number('NaN')` es NaN, y `JSON.stringify` lo
    // manda como `null`. La fila queda con costo_usd nulo y el resumen la suma
    // como cero: el caso exacto de "gratis" indistinguible de "barato".
    await registrarCosto({ ...costo, costoUsd: Number.NaN });
    expect(insert).not.toHaveBeenCalled();
    expect(logger.error.mock.calls[0][0]).toBe('costo.monto_invalido');
  });

  it('un costo negativo tampoco se escribe', async () => {
    await registrarCosto({ ...costo, costoUsd: -1 });
    expect(insert).not.toHaveBeenCalled();
  });

  it('un costo de 0 SÍ se escribe: hay llamadas que de verdad son gratis', async () => {
    await registrarCosto({ ...costo, costoUsd: 0 });
    expect(insert.mock.calls[0][0].costo_usd).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('precioMensajeWhatsAppUsd — la env vacía valía $0', () => {
  it('sin la variable usa el default documentado', () => {
    expect(precioMensajeWhatsAppUsd()).toBe(0.008);
  });

  it('una variable PUESTA Y VACÍA no vale 0: cae al default y grita', () => {
    // `process.env.X ?? '0.008'` no cae al default con `''` —solo con undefined—
    // y `Number('')` es 0. Resultado: todos los mensajes salientes del despliegue
    // registrados a cero, y el costo por liquidación bajando sin motivo.
    vi.stubEnv('CUADRA_WHATSAPP_MSG_USD', '');
    expect(precioMensajeWhatsAppUsd()).toBe(0.008);
    expect(logger.error.mock.calls[0][0]).toBe('costo.precio_wa_invalido');
  });

  it('un valor no numérico cae al default y grita', () => {
    vi.stubEnv('CUADRA_WHATSAPP_MSG_USD', 'gratis');
    expect(precioMensajeWhatsAppUsd()).toBe(0.008);
    expect(logger.error).toHaveBeenCalled();
  });

  it('un 0 EXPLÍCITO se respeta: dentro de la ventana de 24h Meta no cobra', () => {
    // La regla no es "cero es sospechoso", es "cero por accidente es sospechoso".
    // `'0'` es una decisión; `''` es un descuido.
    vi.stubEnv('CUADRA_WHATSAPP_MSG_USD', '0');
    expect(precioMensajeWhatsAppUsd()).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('el precio se lee en cada envío, no en el import', async () => {
    vi.stubEnv('CUADRA_WHATSAPP_MSG_USD', '0.05');
    await registrarCostoWhatsApp('t1', 'v1');
    expect(insert.mock.calls[0][0].costo_usd).toBe(0.05);
  });
});

describe('vincularCostosALiquidacion — el momento en que se sabe si el costo existe', () => {
  const t = '11111111-1111-1111-1111-111111111111';
  const v = '22222222-2222-2222-2222-222222222222';
  const liq = '33333333-3333-3333-3333-333333333333';

  it('vincula y deja constancia de cuántas filas', async () => {
    update.mockReturnValue(cadena({ data: [{ id: 'c1' }, { id: 'c2' }], error: null }));
    await vincularCostosALiquidacion(t, v, liq);
    expect(logger.info).toHaveBeenCalledWith('costo.vinculado', expect.objectContaining({ liquidacion: liq, filas: 2 }));
  });

  it('cero filas y cero costos del viaje = la liquidación se cerró SIN costo medido', async () => {
    // Es la señal que faltaba: en el instante en que se cierra una liquidación se
    // puede afirmar si su costo unitario está medido o no. Sin esto, "costó
    // $0.00" y "nunca se registró nada" llegan iguales al panel.
    update.mockReturnValue(cadena({ data: [], error: null }));
    select.mockReturnValue(cadena({ count: 0, error: null }));
    await vincularCostosALiquidacion(t, v, liq);
    expect(logger.error).toHaveBeenCalledWith('costo.liquidacion_sin_costo', expect.objectContaining({ liquidacion: liq, viaje: v }));
  });

  it('cero filas pero el viaje SÍ tiene costos = recierre, no alarma', async () => {
    // Sin esta segunda consulta, un cierre parcial recuperado —que revincula lo
    // ya vinculado— dispararía la alarma cada vez y la alarma dejaría de leerse.
    update.mockReturnValue(cadena({ data: [], error: null }));
    select.mockReturnValue(cadena({ count: 4, error: null }));
    await vincularCostosALiquidacion(t, v, liq);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('un error del update se registra en vez de caer en un `catch {}` vacío', async () => {
    update.mockReturnValue(cadena({ data: null, error: { message: 'permission denied', code: '42501' } }));
    await vincularCostosALiquidacion(t, v, liq);
    expect(logger.error.mock.calls[0][0]).toBe('costo.no_vinculado');
  });

  it('nunca lanza', async () => {
    update.mockImplementation(() => { throw new Error('fetch failed'); });
    await expect(vincularCostosALiquidacion(t, v, liq)).resolves.toBeUndefined();
  });
});

describe('getResumenCosto — cero, sin datos y no medido son tres cosas distintas', () => {
  const t = '11111111-1111-1111-1111-111111111111';

  it('con filas devuelve las cifras y el promedio por liquidación', async () => {
    // Lo que antes eran tres filas de `llm_costo` llega ya agregado por la 0064,
    // SIN redondear: el redondeo a seis decimales sigue siendo de `round6()`.
    rpc.mockResolvedValue({
      data: {
        totales: { n: 3, viajes: 2, costoUsd: 0.08, tokensIn: 500, tokensOut: 50 },
        porFase: [{ fase: 'cuadre', n: 2, costoUsd: 0.07 }, { fase: 'ocr', n: 1, costoUsd: 0.01 }],
      },
      error: null,
    });
    const r = await getResumenCosto(t);
    expect(r.estado).toBe('medido');
    if (r.estado !== 'medido') throw new Error('inalcanzable');
    expect(r.totalUsd).toBe(0.08);
    expect(r.liquidaciones).toBe(2);
    expect(r.costoPromedioPorLiquidacion).toBe(0.04);
    expect(r.porFase).toEqual({ ocr: 0.01, cuadre: 0.07 });
    expect(r.registros).toBe(3);
  });

  it('la consulta FALLA → `no_medido`, y no hay ninguna cifra que pintar', async () => {
    // ANTES: `const { data } = await ...` descartaba el error, `data` era null y
    // el panel pintaba totalUsd 0, liquidaciones 0, promedio 0. El tipo ahora lo
    // impide: `totalUsd` no existe fuera de `estado: 'medido'`.
    rpc.mockResolvedValue({ data: null, error: { message: 'relation "llm_costo" does not exist' } });
    const r = await getResumenCosto(t);
    expect(r.estado).toBe('no_medido');
    expect(r).not.toHaveProperty('totalUsd');
    expect(logger.error.mock.calls[0][0]).toBe('costo.resumen_ilegible');
  });

  it('la consulta funciona y no hay una sola fila → `sin_registros`, no $0.00', async () => {
    rpc.mockResolvedValue({ data: RESUMEN_VACIO, error: null });
    const r = await getResumenCosto(t);
    expect(r.estado).toBe('sin_registros');
  });

  it('hay costo pero ninguna fila trae viaje → el promedio es null, no 0', async () => {
    // Dividir entre cero viajes daría 0 y eso se lee como "cada liquidación sale
    // gratis". No hay a qué atribuirlo: la respuesta honesta es "no se puede".
    // (`count(distinct viaje_id)` en SQL ignora los NULL, igual que el
    // `new Set(...).filter(Boolean)` que sustituye.)
    rpc.mockResolvedValue({
      data: {
        totales: { n: 1, viajes: 0, costoUsd: 0.002, tokensIn: 10, tokensOut: 1 },
        porFase: [{ fase: 'router', n: 1, costoUsd: 0.002 }],
      },
      error: null,
    });
    const r = await getResumenCosto(t);
    if (r.estado !== 'medido') throw new Error('debería haber cifras');
    expect(r.totalUsd).toBe(0.002);
    expect(r.costoPromedioPorLiquidacion).toBeNull();
  });

  it('una excepción de red tampoco se convierte en ceros', async () => {
    rpc.mockImplementation(() => { throw new Error('fetch failed'); });
    expect((await getResumenCosto(t)).estado).toBe('no_medido');
  });

  // ── EL QUINTO CAMINO (5-ago-2026) ─────────────────────────────────────────
  //
  // Esta consulta NO paginaba: `.select(...).eq('tenant_id', …)` a secas.
  // PostgREST recorta a `max_rows` (1,000) en silencio, así que a partir de la
  // llamada 1,001 de una flota el total se quedaba corto y se entregaba con
  // `estado: 'medido'` — una cifra INCOMPLETA con la etiqueta de medida, que es
  // el modo de fallo que todo este archivo dice venir a evitar.
  it('790 mil llamadas al modelo dan el total COMPLETO, no las primeras mil', async () => {
    rpc.mockResolvedValue({
      data: {
        totales: { n: 790_000, viajes: 10_950, costoUsd: 7_900.123456, tokensIn: 3_950_000, tokensOut: 790_000 },
        porFase: [{ fase: 'ocr', n: 790_000, costoUsd: 7_900.123456 }],
      },
      error: null,
    });
    const r = await getResumenCosto(t);
    if (r.estado !== 'medido') throw new Error('debería haber cifras');
    expect(r.registros).toBe(790_000);
    expect(r.totalUsd).toBe(7_900.123456);
    expect(r.liquidaciones).toBe(10_950);
  });

  it('no lee NI UNA fila de `llm_costo`: la agrega en SQL, acotada al tenant', async () => {
    await getResumenCosto(t);
    // Ninguna lectura por filas de la tabla.
    expect(from).not.toHaveBeenCalledWith('llm_costo');
    // Y el tenant viaja como argumento: sin él, la 0064 no resuelve la firma y
    // PostgREST responde 404 — el olvido falla ruidoso, no devuelve la base
    // entera de todas las flotas.
    expect(rpc).toHaveBeenCalledWith('resumen_costo_ia_tenant', { p_tenant: t, p_desde: null, p_hasta: null });
  });

  // Una rama sin la 0064 aplicada devuelve algo que no es este objeto. Leerlo
  // con `?? 0` pintaría "$0.00 de costo de IA" con etiqueta de medido, que es
  // justo el bug de arriba con otra cara.
  it.each([
    ['null', null],
    ['un objeto vacío', {}],
    ['totales sin viajes', { totales: { n: 3, costoUsd: 1 }, porFase: [] }],
    ['sin porFase', { totales: { n: 3, viajes: 1, costoUsd: 1, tokensIn: 0, tokensOut: 0 } }],
  ])('una respuesta con otra forma (%s) → `no_medido`, no ceros con etiqueta de medidos', async (_caso, data) => {
    rpc.mockResolvedValue({ data, error: null });
    const r = await getResumenCosto(t);
    expect(r.estado).toBe('no_medido');
    expect(r).not.toHaveProperty('totalUsd');
  });
});

describe('faseDeModelo', () => {
  it('opus es escalación', () => {
    expect(faseDeModelo('anthropic/claude-opus-5', 'cuadre')).toBe('escalacion');
    expect(faseDeModelo('anthropic/claude-sonnet-5', 'cuadre')).toBe('cuadre');
  });
});
