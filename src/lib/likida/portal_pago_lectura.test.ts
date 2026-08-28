import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LOS TRES DESENLACES DEL PORTAL, CONTRA UN SUPABASE FALSO.
//
// El repo evita probar escrituras contra un mock —eso demuestra que el mock
// funciona— y esa regla se respeta: aquí NO se prueba que un insert inserte.
// Lo que se prueba es la DECISIÓN, que es lo único que este código tiene y lo
// que no se puede ver de otra forma:
//
//   · «no se pudo preguntar» NO se colapsa en «tu enlace murió». Supabase
//     reporta por VALOR: sin esta prueba, el día que alguien cambie un
//     `if (error)` por un `?? []`, un bache de red le diría a un cliente
//     legítimo que pida otro enlace, y saldría a pedirlo.
//   · el saldo `null` NO se vuelve 0. Un cero ahí se lee como «ya no debes».
//   · una liga caducada o revocada contesta EXACTAMENTE lo mismo que una que
//     no existe.
// ═══════════════════════════════════════════════════════════════════════════

const sbMock = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => sbMock() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  redactarTexto: (s: string) => s,
}));

import { hashDeToken, generarTokenPortal } from './portal_pago';
import { resolverLiga, vistaDelPortal, anotarAcceso, sellarUltimoAcceso } from './portal_pago_lectura';

type Resultado = { data: unknown; error: { message: string; code?: string } | null };

/**
 * Una cadena de PostgREST falsa: cualquier método devuelve la propia cadena, y
 * la cadena es `await`-able al resultado. Así funciona `.select().eq().eq()
 * .maybeSingle()` sin declarar cada verbo.
 */
function cadena(resultado: Resultado): unknown {
  const p = Promise.resolve(resultado);
  const proxy: unknown = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'then') return p.then.bind(p);
      if (prop === 'catch') return p.catch.bind(p);
      if (prop === 'finally') return p.finally.bind(p);
      return () => proxy;
    },
  });
  return proxy;
}

const OK = (data: unknown): Resultado => ({ data, error: null });
const FALLA = (message = 'la base no contestó'): Resultado => ({ data: null, error: { message } });

/** Respuestas POR TABLA, consumidas en orden; la última se repite. */
function conTablas(porTabla: Record<string, Resultado[]>) {
  const usados: Record<string, number> = {};
  sbMock.mockReturnValue({
    from(tabla: string) {
      const r = porTabla[tabla];
      if (!r) return cadena(OK(null));
      const i = usados[tabla] ?? 0;
      usados[tabla] = i + 1;
      return cadena(r[Math.min(i, r.length - 1)]);
    },
  });
}

const HOY = new Date();
const FUTURO = new Date(HOY.getTime() + 86_400_000).toISOString();
const PASADO = new Date(HOY.getTime() - 86_400_000).toISOString();

const TOKEN = generarTokenPortal();
const FILA_LIGA = {
  id: 'liga-1', tenant_id: 't-1', factura_id: 'f-1',
  token_hash: hashDeToken(TOKEN.enClaro),
  expira_en: FUTURO, revocada_en: null,
};

beforeEach(() => { sbMock.mockReset(); });

describe('resolverLiga — el token que no vale y el que no se pudo comprobar', () => {
  it('un token sin forma NI SIQUIERA consulta la base', async () => {
    conTablas({});
    const r = await resolverLiga('hola');
    expect(r).toEqual({ ok: false, motivo: 'no_valida' });
    expect(sbMock).not.toHaveBeenCalled();
  });

  it('un error de lectura es `no_disponible`, JAMÁS `no_valida`', async () => {
    // Ésta es la que importa: colapsarlas mandaría a un cliente legítimo a
    // pedir un enlace nuevo por un bache de red.
    conTablas({ portal_pago_liga: [FALLA()] });
    expect(await resolverLiga(TOKEN.enClaro)).toEqual({ ok: false, motivo: 'no_disponible' });
  });

  it('sin candidatas, `no_valida`', async () => {
    conTablas({ portal_pago_liga: [OK([])] });
    expect(await resolverLiga(TOKEN.enClaro)).toEqual({ ok: false, motivo: 'no_valida' });
  });

  it('una candidata del mismo prefijo con otro hash NO abre nada', async () => {
    conTablas({ portal_pago_liga: [OK([{ ...FILA_LIGA, token_hash: 'f'.repeat(64) }])] });
    expect(await resolverLiga(TOKEN.enClaro)).toEqual({ ok: false, motivo: 'no_valida' });
  });

  it('el token correcto resuelve su liga, y trae el tenant de la fila', async () => {
    conTablas({ portal_pago_liga: [OK([FILA_LIGA])] });
    const r = await resolverLiga(TOKEN.enClaro);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.liga).toEqual({ ligaId: 'liga-1', tenantId: 't-1', facturaId: 'f-1', estado: 'vigente' });
    }
  });

  it('caducada y revocada contestan lo MISMO que un token inventado', async () => {
    conTablas({ portal_pago_liga: [OK([{ ...FILA_LIGA, expira_en: PASADO }])], portal_pago_acceso: [OK(null)] });
    expect(await resolverLiga(TOKEN.enClaro)).toEqual({ ok: false, motivo: 'no_valida' });

    conTablas({ portal_pago_liga: [OK([{ ...FILA_LIGA, revocada_en: PASADO }])], portal_pago_acceso: [OK(null)] });
    expect(await resolverLiga(TOKEN.enClaro)).toEqual({ ok: false, motivo: 'no_valida' });
  });
});

// ── La vista ───────────────────────────────────────────────────────────────

const LIGA = { ligaId: 'liga-1', tenantId: 't-1', facturaId: 'f-1', estado: 'vigente' as const };

const FACTURA = {
  id: 'f-1', cliente_id: 'c-1', serie: 'A', folio: '1042', cfdi_uuid: null,
  fecha: '2026-08-14', vence_en: '2026-09-13', estatus: 'emitida', total: 11600, moneda: 'MXN',
};

function escenario(over: Partial<Record<string, Resultado[]>> = {}) {
  conTablas({
    factura_emitida: [OK(FACTURA)],
    tenant: [OK({ nombre: 'Transportes del Bajío', razon_social: 'TRANSPORTES DEL BAJIO SA DE CV' })],
    portal_pago_propuesta: [OK([])],
    rep_emitido: [OK([])],
    factura_saldo: [OK({ saldo: 11600, pagado: 0 })],
    cliente: [OK({ nombre: 'Cemex', razon_social: 'CEMENTOS DEL NORTE SA' })],
    ...over,
  });
}

describe('vistaDelPortal — el saldo `null` no es cero', () => {
  it('con todo bien, arma la vista con la razón social de ambos lados', async () => {
    escenario();
    const r = await vistaDelPortal(LIGA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.vista.flota).toBe('TRANSPORTES DEL BAJIO SA DE CV');
    expect(r.vista.cliente).toBe('CEMENTOS DEL NORTE SA');
    expect(r.vista.factura.saldo).toBe(11600);
    expect(r.vista.factura.total).toBe(11600);
  });

  it('si `factura_saldo` falla, el saldo queda en NULL y la vista sigue viva', async () => {
    // Degradar a `null` y no a 0: la pantalla dirá «sin dato», y el formulario
    // se apaga. Un cero invitaría a registrar un pago contra una cifra falsa.
    escenario({ factura_saldo: [FALLA()] });
    const r = await vistaDelPortal(LIGA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.vista.factura.saldo).toBeNull();
      expect(r.vista.factura.pagado).toBeNull();
    }
  });

  it('un saldo ausente en la vista tampoco se vuelve 0', async () => {
    escenario({ factura_saldo: [OK({ saldo: null, pagado: null })] });
    const r = await vistaDelPortal(LIGA);
    if (r.ok) expect(r.vista.factura.saldo).toBeNull();
  });

  it('si la FACTURA no se pudo leer, la respuesta es `no_disponible`', async () => {
    escenario({ factura_emitida: [FALLA()] });
    expect(await vistaDelPortal(LIGA)).toEqual({ ok: false, motivo: 'no_disponible' });
  });

  it('si la factura NO EXISTE, es `no_valida` — sin decir que se borró', async () => {
    escenario({ factura_emitida: [OK(null)] });
    expect(await vistaDelPortal(LIGA)).toEqual({ ok: false, motivo: 'no_valida' });
  });

  it('si falla el tenant, `no_disponible`: sin emisor no hay factura que enseñar', async () => {
    escenario({ tenant: [FALLA()] });
    expect(await vistaDelPortal(LIGA)).toEqual({ ok: false, motivo: 'no_disponible' });
  });

  it('sin razón social, cae al nombre comercial — nunca a un vacío', async () => {
    escenario({
      tenant: [OK({ nombre: 'Transportes del Bajío', razon_social: null })],
      cliente: [OK({ nombre: 'Cemex', razon_social: null })],
    });
    const r = await vistaDelPortal(LIGA);
    if (r.ok) {
      expect(r.vista.flota).toBe('Transportes del Bajío');
      expect(r.vista.cliente).toBe('Cemex');
    }
  });

  it('si el CLIENTE no se pudo leer, la página no se cae', async () => {
    escenario({ cliente: [FALLA()] });
    const r = await vistaDelPortal(LIGA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.vista.cliente).toBe('Cliente');
  });

  it('el REP viaja SIN su XML: solo si lo tiene', async () => {
    // El documento fiscal no se carga en cada render.
    escenario({
      rep_emitido: [OK([{ cfdi_uuid: 'aaa', fecha_pago: '2026-08-20', imp_pagado: 11600, xml: '<x/>' }])],
    });
    const r = await vistaDelPortal(LIGA);
    if (r.ok) {
      expect(r.vista.rep).toEqual({
        cfdiUuid: 'aaa', fechaPago: '2026-08-20', impPagado: 11600, tieneXml: true,
      });
      expect(JSON.stringify(r.vista.rep)).not.toContain('<x/>');
    }
  });

  it('un REP sin XML lo declara, en vez de ofrecer una descarga vacía', async () => {
    escenario({
      rep_emitido: [OK([{ cfdi_uuid: 'aaa', fecha_pago: '2026-08-20', imp_pagado: 11600, xml: null }])],
    });
    const r = await vistaDelPortal(LIGA);
    if (r.ok) expect(r.vista.rep?.tieneXml).toBe(false);
  });

  it('las propuestas del cliente llegan con su estado', async () => {
    escenario({
      portal_pago_propuesta: [OK([
        { fecha: '2026-08-20', monto: 5000, referencia: 'R1', estado: 'pendiente', registrada_en: '2026-08-20T10:00:00Z' },
      ])],
    });
    const r = await vistaDelPortal(LIGA);
    if (r.ok) {
      expect(r.vista.propuestas).toHaveLength(1);
      expect(r.vista.propuestas[0].estado).toBe('pendiente');
    }
  });
});

describe('los sellos y la bitácora nunca tumban la página', () => {
  it('`anotarAcceso` traga un error de la base', async () => {
    conTablas({ portal_pago_acceso: [FALLA()] });
    await expect(anotarAcceso(LIGA, 'vista')).resolves.toBeUndefined();
  });

  it('`anotarAcceso` traga hasta una excepción del cliente', async () => {
    sbMock.mockImplementation(() => { throw new Error('sin red'); });
    await expect(anotarAcceso(LIGA, 'vista')).resolves.toBeUndefined();
  });

  it('`sellarUltimoAcceso` tampoco puede negar la factura por no anotar la fecha', async () => {
    conTablas({ portal_pago_liga: [FALLA()] });
    await expect(sellarUltimoAcceso(LIGA)).resolves.toBeUndefined();
    sbMock.mockImplementation(() => { throw new Error('sin red'); });
    await expect(sellarUltimoAcceso(LIGA)).resolves.toBeUndefined();
  });
});
