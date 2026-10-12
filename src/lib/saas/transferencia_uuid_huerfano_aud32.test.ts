// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 32 · c15 — OPE-32C15-C2 (CRÍTICO).
//
// EL CFDI QUE EXISTE ANTE EL SAT Y LIKIDA NO PUEDE NOMBRAR. `timbrarFactura`
// llama al PAC, obtiene el UUID, y si el `update` que lo guarda falla, la
// reacción era un `logger.error` y nada más. Es textualmente el escenario que
// `observability/alerta.ts` documenta como OP-A2 — y el canal que lo cubre
// (`alertarOperador`) no se llamaba ni una vez en todo `src/lib/saas/`.
//
// Lo que lo vuelve CRÍTICO y no ALTO es que el log NO SIRVE para reconstruirlo:
// `redactMeta` pasa todo el meta por `redact` y `CLAVES_NO_PII` contiene SOLO
// `'digest'` (`logger.ts:146`), así que el folio sale como `id:<huella>`. Y
// Sentry tampoco lo salva: `emit` le entrega `redactado`, no `meta`
// (`logger.ts:205`), de modo que la lista blanca de `sentry.ts` —añadida con el
// comentario «es la ÚNICA llave para reconstruir un comprobante que ya existe
// ante el SAT»— recibe el valor ya huellado y no tiene nada que conservar.
//
// El ÚNICO camino del repo donde el folio sobrevive es `LLAVES_SIN_REDACTAR`
// dentro de `alertarOperador`, y exige que `uuid` viaje como llave de primer
// nivel. Por eso la prueba no se contenta con «se llamó»: exige el folio
// ÍNTEGRO en esa llave. Si alguien lo mueve dentro del texto, vuelve el defecto
// que la auditoría 24 ancló como M17/PRU-A3 y esta prueba se pone roja.
//
// El molde de los dobles es el de `transferencia_mensualidad.test.ts`, con una
// sola diferencia: el `update` que escribe `cfdi_uuid` devuelve error.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Fila = Record<string, unknown>;
const TABLAS: Record<string, Fila[]> = {};
const escrituras: Array<{ tabla: string; valores: Record<string, unknown> }> = [];

/** Si es true, el update que guarda el UUID falla (el resto sigue bien). */
let fallaElGuardadoDelUuid = false;

function constructor(tabla: string) {
  let huboUpdate = false;
  let esElDelUuid = false;
  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    in: () => api,
    is: () => api,
    or: () => api,
    neq: () => api,
    maybeSingle: () => Promise.resolve({ data: (TABLAS[tabla] ?? [])[0] ?? null, error: null }),
    update: (v: Record<string, unknown>) => {
      escrituras.push({ tabla, valores: v });
      huboUpdate = true;
      if ('cfdi_uuid' in v) esElDelUuid = true;
      return api;
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(
      esElDelUuid && fallaElGuardadoDelUuid
        ? { data: null, error: { message: 'duplicate key value violates unique constraint "factura_saas_cfdi_uuid_key"' } }
        : { data: huboUpdate ? (TABLAS[tabla] ?? []).map((f) => ({ id: f.id })) : null, error: null },
    ).then(res, rej),
  };
  return api;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => constructor(t) }) }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger, redactarTexto: (s: string) => s }));

const alertarOperador = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/observability/alerta', () => ({
  alertarOperador: (...a: unknown[]) => alertarOperador(...a),
}));

const UUID_CFDI = '33ab7e19-c0d1-4f2a-9b77-0e5c1a2b3c4d';

const timbrarMensualidad = vi.fn(async () => ({
  id: 'inv_pac_1', uuid: UUID_CFDI, urlXml: 'https://pac/x.xml', urlVerificacion: 'https://sat/verifica',
}));
vi.mock('./facturapi', () => ({
  facturapiConfigurado: vi.fn(() => true),
  timbrarMensualidad,
  enviarPorCorreo: vi.fn(async () => true),
}));
vi.mock('./fiscal', () => ({
  getDatosFiscales: vi.fn(async () => ({
    rfc: 'GMX0902279I1', razonSocial: 'Flota de Prueba SA de CV',
    regimenFiscal: '601', codigoPostal: '36100', usoCfdi: 'G03', email: 'pagos@flota.mx',
  })),
  estanCompletos: vi.fn(() => true),
}));

const { timbrarFactura } = await import('./transferencia');

const FACTURA_PAGADA = {
  id: 'fact-1', tenant_id: 't-1', estado: 'pagada', monto: 10000,
  subtotal: 8620.69, iva: 1379.31, moneda: 'MXN',
  periodo_inicio: '2026-10-01', periodo_fin: '2026-10-31', referencia: 'REF-123', cfdi_uuid: null,
};

beforeEach(() => {
  for (const k of Object.keys(TABLAS)) delete TABLAS[k];
  escrituras.length = 0;
  fallaElGuardadoDelUuid = false;
  alertarOperador.mockClear();
  logger.error.mockClear();
  timbrarMensualidad.mockClear();
});

describe('OPE-32C15-C2 · el UUID que el PAC dio y la base no guardó', () => {
  it('si el update del UUID falla, GRITA por el canal del operador con el folio íntegro', async () => {
    TABLAS.factura_saas = [{ ...FACTURA_PAGADA }];
    fallaElGuardadoDelUuid = true;

    // No se tira la operación: el CFDI ya existe, así que se devuelve el UUID.
    const r = await timbrarFactura('fact-1');
    expect(r).toEqual({ uuid: UUID_CFDI });

    // El log sigue, no se toca.
    expect(logger.error).toHaveBeenCalledWith('facturapi.uuid_sin_guardar', expect.anything());

    const llamada = alertarOperador.mock.calls.find(
      (c) => String(c[0]).includes('uuid_sin_guardar'),
    ) as [string, Record<string, unknown>] | undefined;
    expect(llamada, 'alertarOperador no se llamó para el UUID huérfano').toBeDefined();
    const [evento, detalle] = llamada!;

    // `finanzas.` está en EVENTOS_DE_DINERO: correo Y WhatsApp.
    expect(evento).toMatch(/^finanzas\./);
    // EL PUNTO DE LA PRUEBA: el folio, como llave de primer nivel, sin huellar.
    // Dentro del texto lo redactaría `redactarTexto` (el carve-out por texto
    // solo cubre `^timbre\.`) y la alerta serviría de nada.
    expect(detalle.uuid).toBe(UUID_CFDI);
  });

  it('cuando el UUID SÍ se guarda, no despierta a nadie', async () => {
    TABLAS.factura_saas = [{ ...FACTURA_PAGADA }];
    fallaElGuardadoDelUuid = false;

    const r = await timbrarFactura('fact-1');
    expect(r).toEqual({ uuid: UUID_CFDI });
    expect(alertarOperador).not.toHaveBeenCalled();
  });
});
