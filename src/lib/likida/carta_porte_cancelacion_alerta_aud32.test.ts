import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 32 c16 · OPE-32C16-A1 — LA TERCERA INSTANCIA DEL MISMO PATRÓN.
//
// La c15 cerró dos CRÍTICOS con la misma forma: «el PAC ya hizo algo ante el
// SAT, la base no lo pudo guardar, y el único rastro es un `logger.error` que
// a las 3 a.m. no despierta a nadie» (`facturapi.ts:247`,
// `transferencia.ts:439`). Esta es la tercera, y es la peor de las tres,
// porque no solo calla:
//
//   `carta_porte_cancelacion.ts` · el update del resultado falla
//     → `logger.error('timbre.cancelar_ok_sin_guardar', …)` y NADA más
//     → la fila sigue `estado = 'vigente'`
//     → y la función devuelve `{ok: true, mensaje: 'El viaje queda libre
//        para timbrar la corrección.'}`
//
// Lo que hace ese «ok» caro: el SAT YA aceptó la cancelación. El contador lee
// que el viaje quedó libre, re-timbra, y ahora hay dos CFDI del mismo viaje
// con uno cancelado que la base cree vigente. `timbrarViaje` además lee esa
// fila por su puerta de idempotencia (`carta_porte_timbre.ts:273-276`) y
// devuelve `yaExistia: true` con el UUID que el SAT canceló.
//
// Y el folio tiene que viajar como LLAVE APARTE, no dentro del texto:
// `CLAVES_NO_PII` de `logger.ts:146` es `new Set(['digest'])`, así que por el
// log el UUID sale huellado (`id:<huella>`), y Sentry recibe `redactado` y no
// `meta`. El único camino del repo que conserva el folio íntegro es
// `LLAVES_SIN_REDACTAR` (`alerta.ts:268-270`), dentro de `alertarOperador`.
// Es el defecto que la auditoría 24 ancló como M17/PRU-A3.
//
// El PAC es un doble; aquí no sale una petición de red.
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data?: unknown; error?: { message: string; code?: string } | null };
type Llamada = { tabla: string; op: string; payload: Record<string, unknown> | null; filtros: string[] };
let respuestas: Record<string, Resp[]>;
let llamadas: Llamada[];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      let payload: Record<string, unknown> | null = null;
      let op = 'select';
      const filtros: string[] = [];
      const b: Record<string, unknown> = {};
      const enc = (n: string) => (...a: unknown[]) => { filtros.push(`${n}:${a.map((x) => JSON.stringify(x)).join(',')}`); return b; };
      Object.assign(b, {
        select: () => b,
        update: (f: Record<string, unknown>) => { op = 'update'; payload = f; return b; },
        eq: enc('eq'), is: enc('is'), in: enc('in'), or: enc('or'),
        maybeSingle: () => b, single: () => b,
        then: (res: (r: Resp) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(() => {
          llamadas.push({ tabla, op, payload, filtros });
          const cola = respuestas[`${tabla}:${op}`] ?? respuestas[tabla];
          if (!cola || cola.length === 0) return { data: null, error: null };
          return cola.length > 1 ? cola.shift()! : cola[0];
        }).then(res, rej),
      });
      return b;
    },
  }),
}));
vi.mock('@/lib/likida/presupuesto', async (o) => ({ ...(await o() as object), acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, redactarTexto: (s: string) => s }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: vi.fn(async () => undefined) }));
vi.mock('./pac', () => ({ estadoPac: () => ({ configurado: true, proveedor: 'sw', pareceSandbox: true }), resolverPac: () => null }));

const alertarOperador = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: (...a: unknown[]) => alertarOperador(...a) }));

import type { ProveedorPac, ResultadoCancelacion } from './pac/tipos';
const { solicitarCancelacionTimbre } = await import('./carta_porte_cancelacion');

const T = 'tenant-1';
const V = 'viaje-1';
const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const ACTOR = { id: 'u-1', email: 'conta@flota.mx' };

let cancelar: ReturnType<typeof vi.fn<(...a: unknown[]) => Promise<unknown>>>;
const pac = (): ProveedorPac => ({
  nombre: 'sw', timbrar: vi.fn(),
  cancelar: (...a: unknown[]) => cancelar(...a) as Promise<ResultadoCancelacion>,
});

function sembrar() {
  respuestas['viaje'] = [{ data: { id: V, ingreso_flete: 1, cliente_id: null, cliente: null }, error: null }];
  respuestas['flota_fiscal'] = [{ data: { rfc: 'EKU9003173C9', razon_social: 'K', regimen_fiscal: '601', lugar_expedicion: '42501', serie: 'CCP', modo: 'sandbox' }, error: null }];
  respuestas['ccp_timbre:select'] = [{
    data: { uuid_fiscal: UUID, fecha_timbrado: '2026-08-27T12:00:00', modo: 'sandbox', proveedor: 'sw', sello_sat: 's', estado: 'vigente' },
    error: null,
  }];
}

beforeEach(() => {
  vi.clearAllMocks();
  respuestas = {}; llamadas = [];
  cancelar = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ ok: true, estado: 'en_proceso', codigoSat: '201', acuse: '<a/>', yaEstaba: false }));
});

describe('OPE-32C16-A1: el SAT aceptó la cancelación y la base no la pudo guardar', () => {
  /**
   * El claim (primer update) sí entra; el update del RESULTADO truena. Es el
   * estado exacto del hallazgo: el PAC ya contestó 201/202 y la fila se queda
   * como estaba.
   */
  function conElGuardadoRoto() {
    sembrar();
    respuestas['ccp_timbre:update'] = [
      { data: [{ id: 'k1' }], error: null },                                   // el claim
      { data: null, error: { message: 'could not serialize access', code: '40001' } }, // el resultado
    ];
  }

  it('alerta al operador — un `logger.error` a las 3 a.m. no despierta a nadie', async () => {
    conElGuardadoRoto();
    await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '02' }, { pac: pac() });
    expect(alertarOperador, 'el SAT canceló, la base no lo guardó, y nadie se enteró').toHaveBeenCalledTimes(1);
  });

  it('el folio fiscal va como LLAVE APARTE, íntegro — no dentro del texto', async () => {
    conElGuardadoRoto();
    await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '02' }, { pac: pac() });
    const [, detalle] = alertarOperador.mock.calls[0] as [string, Record<string, unknown>];
    // `LLAVES_SIN_REDACTAR` solo conserva 'uuid'|'uuidFiscal'|'uuidCfdi'|'folioFiscal'.
    // Si alguien lo mueve al texto, vuelve el defecto M17/PRU-A3 y esto se pone rojo.
    expect(detalle.uuid ?? detalle.uuidFiscal, 'el UUID tiene que ir en su propia llave').toBe(UUID);
    expect(String(detalle.error ?? ''), 'el UUID dentro del texto sale huellado').not.toContain(UUID);
  });

  it('el evento es `timbre.*`, que está en EVENTOS_DE_DINERO: suena el WhatsApp', async () => {
    conElGuardadoRoto();
    await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '02' }, { pac: pac() });
    const [evento] = alertarOperador.mock.calls[0] as [string, Record<string, unknown>];
    expect(evento).toMatch(/^timbre\./);
  });

  it('el aviso dice que la fila quedó «vigente» — es lo que hay que ir a corregir a mano', async () => {
    conElGuardadoRoto();
    await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '02' }, { pac: pac() });
    const [, detalle] = alertarOperador.mock.calls[0] as [string, Record<string, unknown>];
    expect(String(detalle.error ?? '').toLowerCase()).toContain('vigente');
  });

  it('cuando el guardado SÍ entra, no se alerta a nadie — el aviso no es ruido de fondo', async () => {
    sembrar();
    respuestas['ccp_timbre:update'] = [{ data: [{ id: 'k1' }], error: null }];
    const r = await solicitarCancelacionTimbre(T, V, ACTOR, { motivo: '02' }, { pac: pac() });
    expect(r).toMatchObject({ ok: true, estado: 'en_proceso' });
    expect(alertarOperador).not.toHaveBeenCalled();
  });
});
