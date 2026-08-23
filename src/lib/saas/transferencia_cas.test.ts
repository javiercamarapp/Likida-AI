// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · DAT-13 y DAT-25 — LAS DOS FORMAS DE COBRAR (O
// TIMBRAR) DOS VECES LO MISMO.
//
// DAT-13. `conciliar` y `timbrarFactura` LEÍAN, decidían en TypeScript y luego
// escribían. Entre la lectura y la escritura cabe el segundo clic —o la segunda
// pestaña, o el reintento de quien no vio la respuesta—, y los dos pasan la
// comprobación. En `conciliar` eso da igual para la fila (queda 'pagada' de
// todos modos) pero NO para lo que viene después: /admin timbra al conciliar,
// así que dos conciliaciones son DOS CFDI REALES de la misma mensualidad, y
// uno hay que cancelarlo ante el SAT — una cancelación fuera de plazo se le
// queda al cliente en su contabilidad.
//
// El arreglo no es "comprobar mejor": es que la condición viaje DENTRO del
// UPDATE (`neq('estado','pagada')`, `is('cfdi_uuid', null)` + la reserva
// `timbrando_en`) y la resuelva Postgres. Por eso este doble de Supabase SÍ
// modela filtros: sin eso, la prueba no distinguiría el código arreglado del
// roto.
//
// DAT-25. Emitir la mensualidad a mano a una flota que YA cobra por Stripe le
// cobra el mismo mes dos veces, cada cobro con su referencia, y ningún índice
// lo atrapa: las de Stripe llevan `metodo_cobro = 'stripe'` (0163) y quedan
// fuera del índice "una por periodo" a propósito.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
const TABLAS: Record<string, Fila[]> = {};

/** Un `or(...)` de PostgREST, acotado a lo que usa la reserva del timbrado:
 *  `timbrando_en.is.null,timbrando_en.lt.<iso>`. */
function predicadoOr(expr: string): (f: Fila) => boolean {
  const partes = expr.split(',').map((p) => {
    const [col, op, valor] = p.split('.');
    if (op === 'is') return (f: Fila) => (f[col] ?? null) === null;
    if (op === 'lt') return (f: Fila) => f[col] != null && String(f[col]) < valor;
    throw new Error(`or() no modelado: ${p}`);
  });
  return (f) => partes.some((p) => p(f));
}

function tabla(nombre: string) {
  const filtros: Array<(f: Fila) => boolean> = [];
  let cambios: Fila | null = null;

  const coinciden = () => (TABLAS[nombre] ?? []).filter((f) => filtros.every((p) => p(f)));
  const aplicar = () => {
    const tocadas = coinciden();
    if (cambios) for (const f of tocadas) Object.assign(f, cambios);
    return tocadas;
  };

  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { filtros.push((f) => f[c] === v); return api; },
    neq: (c: string, v: unknown) => { filtros.push((f) => f[c] !== v); return api; },
    is: (c: string, v: unknown) => { filtros.push((f) => (f[c] ?? null) === v); return api; },
    in: (c: string, v: unknown[]) => { filtros.push((f) => v.includes(f[c])); return api; },
    or: (e: string) => { filtros.push(predicadoOr(e)); return api; },
    limit: () => api,
    order: () => api,
    update: (v: Fila) => { cambios = v; return api; },
    insert: (v: Fila) => {
      TABLAS[nombre] = [...(TABLAS[nombre] ?? []), { id: `${nombre}-nuevo`, ...v }];
      return api;
    },
    maybeSingle: () => Promise.resolve({ data: (cambios ? aplicar() : coinciden())[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: cambios ? aplicar() : coinciden(), error: null }).then(res),
  };
  return api;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => tabla(t) }) }));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const timbrarMensualidad = vi.fn(async () => ({
  id: 'fac_pac_1', uuid: '11111111-2222-3333-4444-555555555555',
  urlPdf: null, urlXml: null, urlVerificacion: 'https://sat/verifica', total: 11600,
}));
const enviarPorCorreo = vi.fn(async () => true);
vi.mock('./facturapi', () => ({
  facturapiConfigurado: () => true,
  timbrarMensualidad,
  enviarPorCorreo,
}));
vi.mock('./fiscal', () => ({
  getDatosFiscales: async () => ({
    rfc: 'GMX0902279I1', razonSocial: 'Flota SA', regimenFiscal: '601',
    codigoPostal: '36100', usoCfdi: 'G03', email: 'pagos@flota.mx',
  }),
  estanCompletos: () => true,
}));

const { conciliar, timbrarFactura, emitirMensualidad } = await import('./transferencia');

const FACTURA = () => ({
  id: 'f-1', tenant_id: 't-1', estado: 'pagada', monto: 11600,
  subtotal: 10000, iva: 1600, moneda: 'MXN',
  periodo_inicio: '2026-08-01', periodo_fin: '2026-08-31', referencia: 'LKAAAA202608',
  cfdi_uuid: null, timbrando_en: null,
});

beforeEach(() => {
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  timbrarMensualidad.mockClear(); enviarPorCorreo.mockClear();
  logger.info.mockClear(); logger.warn.mockClear(); logger.error.mockClear();
});

describe('DAT-13 · conciliar es un compare-and-set', () => {
  it('dos conciliaciones SIMULTÁNEAS: una entra, la otra se para', async () => {
    TABLAS.factura_saas = [{ ...FACTURA(), estado: 'pendiente', pagada_en: null }];

    const r = await Promise.allSettled([
      conciliar('f-1', 'SPEI-0001', 'u-1'),
      conciliar('f-1', 'SPEI-0002', 'u-2'),
    ]);

    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const fallida = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(String(fallida.reason)).toMatch(/ya estaba marcada como pagada/i);

    // Y la referencia del banco es la de QUIEN GANÓ, no una mezcla de las dos.
    expect(TABLAS.factura_saas[0].referencia_banco).toBe('SPEI-0001');
    expect(TABLAS.factura_saas[0].conciliada_por).toBe('u-1');
  });

  it('sobre una factura que ya no existe, lo dice en vez de fingir que se pagó', async () => {
    TABLAS.factura_saas = [];
    await expect(conciliar('f-1', 'SPEI-1', 'u-1')).rejects.toThrow(/ya no existe/i);
  });

  it('sigue exigiendo la referencia del banco (la prueba de que el dinero existe)', async () => {
    TABLAS.factura_saas = [{ ...FACTURA(), estado: 'pendiente', pagada_en: null }];
    await expect(conciliar('f-1', ' ', 'u-1')).rejects.toThrow(/referencia del movimiento/i);
  });
});

describe('DAT-13 · el timbrado se RESERVA antes de llamar al PAC', () => {
  it('dos timbrados simultáneos: UNA sola llamada al PAC (no dos CFDI reales)', async () => {
    TABLAS.factura_saas = [FACTURA()];

    const r = await Promise.allSettled([timbrarFactura('f-1'), timbrarFactura('f-1')]);

    expect(timbrarMensualidad).toHaveBeenCalledTimes(1);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const fallida = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(String(fallida.reason)).toMatch(/se está timbrando/i);
  });

  it('guarda el UUID, el id del PAC y la liga de verificación, y suelta la reserva', async () => {
    TABLAS.factura_saas = [FACTURA()];
    const r = await timbrarFactura('f-1');
    expect(r).toEqual({ uuid: '11111111-2222-3333-4444-555555555555' });

    const f = TABLAS.factura_saas[0];
    expect(f.cfdi_uuid).toBe('11111111-2222-3333-4444-555555555555');
    // Sin el id del PAC no se puede CANCELAR el papel si el cobro se reembolsa
    // (DAT-33); sin la liga, el cliente no tiene con qué comprobarlo.
    expect(f.cfdi_proveedor_id).toBe('fac_pac_1');
    expect(f.cfdi_verificacion_url).toBe('https://sat/verifica');
    expect(f.timbrando_en).toBeNull();
  });

  it('el CFDI se manda AL CORREO DE LA FLOTA — antes iba sin destinatario', async () => {
    TABLAS.factura_saas = [FACTURA()];
    await timbrarFactura('f-1');
    expect(enviarPorCorreo).toHaveBeenCalledWith('fac_pac_1', 'pagos@flota.mx');
    expect(timbrarMensualidad).toHaveBeenCalledWith(expect.objectContaining({
      receptor: expect.objectContaining({ email: 'pagos@flota.mx' }),
    }));
  });

  it('si el PAC rechaza, SUELTA la reserva: el reintento con el dato corregido no espera 10 minutos', async () => {
    TABLAS.factura_saas = [FACTURA()];
    timbrarMensualidad.mockRejectedValueOnce(new Error('El SAT rechazó: régimen incorrecto'));

    await expect(timbrarFactura('f-1')).rejects.toThrow(/régimen incorrecto/);
    expect(TABLAS.factura_saas[0].timbrando_en).toBeNull();
    expect(TABLAS.factura_saas[0].cfdi_uuid).toBeNull();

    // Y el siguiente intento sí entra.
    await expect(timbrarFactura('f-1')).resolves.toMatchObject({ uuid: expect.any(String) });
  });

  it('una reserva CADUCADA (más de 10 min) no bloquea para siempre', async () => {
    const hace20min = new Date(Date.now() - 20 * 60_000).toISOString();
    TABLAS.factura_saas = [{ ...FACTURA(), timbrando_en: hace20min }];
    await expect(timbrarFactura('f-1')).resolves.toMatchObject({ uuid: expect.any(String) });
  });
});

describe('DAT-25 · no se cobra el mismo mes por dos caminos', () => {
  it('rechaza emitir la mensualidad a mano si la flota ya cobra por Stripe', async () => {
    TABLAS.suscripcion = [{
      id: 'sus-1', tenant_id: 't-1', estado: 'activa', plan_clave: 'flota',
      stripe_subscription_id: 'sub_123',
      plan: [{ precio_mensual: 10000, moneda: 'MXN', nombre: 'Flota', precio_iva_incluido: true }],
    }];

    await expect(emitirMensualidad('t-1', '2026-08-01', '2026-08-31')).rejects.toThrow(/cobra por Stripe/i);
    // Y nada quedó escrito: el índice de la 0057 no habría atrapado esto,
    // porque la de Stripe lleva metodo_cobro 'stripe' y queda fuera.
    expect(TABLAS.factura_saas ?? []).toHaveLength(0);
  });

  it('sí emite cuando la flota NO tiene suscripción de Stripe', async () => {
    TABLAS.suscripcion = [{
      id: 'sus-1', tenant_id: 't-1', estado: 'activa', plan_clave: 'flota',
      stripe_subscription_id: null,
      plan: [{ precio_mensual: 10000, moneda: 'MXN', nombre: 'Flota', precio_iva_incluido: true }],
    }];
    const r = await emitirMensualidad('t-1', '2026-08-01', '2026-08-31');
    expect(r.monto).toBe(10000);
    expect(TABLAS.factura_saas[0]).toMatchObject({ metodo_cobro: 'transferencia', estado: 'pendiente' });
  });
});
