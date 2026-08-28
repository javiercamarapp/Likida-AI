import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LAS REGLAS DE LAS ESCRITURAS DEL PORTAL.
//
// No se prueba que un insert inserte —eso demostraría que el mock funciona—.
// Se prueba lo que este archivo DECIDE, que es lo que un mock no puede fingir
// por mí:
//
//   · no se emite enlace sobre un BORRADOR (le cobraría a alguien por un papel
//     que el SAT no conoce) ni sobre una cancelada;
//   · el choque 23505 se traduce a instrucción, no a un error de Postgres en
//     la cara del contralor;
//   · en la propuesta, ese mismo 23505 NO es un error: es el segundo clic;
//   · conciliar crea el abono ANTES de sellar, y si el sello no toca ninguna
//     fila COMPENSA dejando dicho que quedó un abono huérfano — nunca borra
//     en silencio;
//   · descartar EXIGE motivo escrito.
// ═══════════════════════════════════════════════════════════════════════════

const sbMock = vi.fn();
const registrarPago = vi.fn(async () => 'pago-1');
const anotarBitacora = vi.fn(async () => true);

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => sbMock() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  redactarTexto: (s: string) => s,
}));
vi.mock('./facturacion_escritura', () => ({
  registrarPago: (...a: unknown[]) => registrarPago(...(a as [])),
}));
vi.mock('./bitacora_escritura', () => ({
  anotarBitacora: (...a: unknown[]) => anotarBitacora(...(a as [])),
}));

import {
  crearLigaPago, revocarLigaPago,
  conciliarPropuesta, descartarPropuesta, registrarRepEmitido, sellarRepEntregado,
} from './portal_pago_escritura';
import { registrarPropuesta } from './portal_pago_propuesta';
import { DatoInvalido } from './errores';

type Resultado = { data: unknown; error: { message: string; code?: string } | null };

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
const FALLA = (message: string, code?: string): Resultado => ({ data: null, error: { message, code } });
const CHOQUE = (m = 'duplicate key value'): Resultado => FALLA(m, '23505');

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

const T = '11111111-1111-4111-8111-111111111111';
const FACTURA = '22222222-2222-4222-8222-222222222222';
const PROPUESTA = '33333333-3333-4333-8333-333333333333';
const PAGO = '44444444-4444-4444-8444-444444444444';
const LIGA = { ligaId: 'liga-1', tenantId: T, facturaId: FACTURA };

beforeEach(() => { vi.clearAllMocks(); registrarPago.mockResolvedValue(PAGO); });

describe('crearLigaPago — sobre qué factura SÍ y sobre cuál no', () => {
  it('un id que no es UUID ni consulta la base', async () => {
    conTablas({});
    await expect(crearLigaPago(T, 'no-es-uuid')).rejects.toThrow(DatoInvalido);
    expect(sbMock).not.toHaveBeenCalled();
  });

  it('una factura de otra flota se rechaza con instrucción', async () => {
    conTablas({ factura_emitida: [OK(null)] });
    await expect(crearLigaPago(T, FACTURA)).rejects.toThrow(/no es de tu flota/i);
  });

  it('un BORRADOR no puede tener enlace, y el mensaje dice por qué', async () => {
    // «no le cobra a nadie hasta que llegue su UUID del CFDI» — es el contrato
    // que la pantalla de facturación ya le dice al contralor.
    conTablas({ factura_emitida: [OK({ id: FACTURA, estatus: 'borrador' })] });
    await expect(crearLigaPago(T, FACTURA)).rejects.toThrow(/borrador/i);
  });

  it('una CANCELADA tampoco', async () => {
    conTablas({ factura_emitida: [OK({ id: FACTURA, estatus: 'cancelada' })] });
    await expect(crearLigaPago(T, FACTURA)).rejects.toThrow(/cancelada/i);
  });

  it('una emitida devuelve la URL con el token EN CLARO, una sola vez', async () => {
    conTablas({
      factura_emitida: [OK({ id: FACTURA, estatus: 'emitida' })],
      portal_pago_liga: [OK({ id: 'liga-1' })],
    });
    const l = await crearLigaPago(T, FACTURA);
    expect(l.url).toMatch(/\/pago\/pgo_[A-Za-z0-9_-]+$/);
    expect(l.prefijo.startsWith('pgo_')).toBe(true);
    expect(new Date(l.expiraEn).getTime()).toBeGreaterThan(Date.now());
  });

  it('la segunda liga viva de la misma factura se traduce a instrucción', async () => {
    // Sin este mensaje, «generar enlace» cinco veces dejaría cuatro tokens
    // vivos que ya nadie sabe que existen.
    conTablas({
      factura_emitida: [OK({ id: FACTURA, estatus: 'emitida' })],
      portal_pago_liga: [CHOQUE()],
    });
    await expect(crearLigaPago(T, FACTURA)).rejects.toThrow(/ya tiene un enlace vigente/i);
  });

  it('un error que NO es choque no se disfraza de dato inválido', async () => {
    conTablas({
      factura_emitida: [OK({ id: FACTURA, estatus: 'emitida' })],
      portal_pago_liga: [FALLA('conexión perdida')],
    });
    await expect(crearLigaPago(T, FACTURA)).rejects.not.toBeInstanceOf(DatoInvalido);
  });
});

describe('revocarLigaPago — revocar dos veces pisaría el sello original', () => {
  it('sin filas tocadas, lo dice en vez de fingir éxito', async () => {
    // El `.is('revocada_en', null)` hace que la segunda revocación no toque
    // nada: pisarlo mentiría sobre «¿desde cuándo dejó de valer?».
    conTablas({ portal_pago_liga: [OK([])] });
    await expect(revocarLigaPago(T, '55555555-5555-4555-8555-555555555555'))
      .rejects.toThrow(/ya estuviera revocado/i);
  });

  it('un id que no es UUID ni consulta', async () => {
    conTablas({});
    await expect(revocarLigaPago(T, 'x')).rejects.toThrow(DatoInvalido);
    expect(sbMock).not.toHaveBeenCalled();
  });

  it('con una fila tocada, revoca y anota', async () => {
    conTablas({ portal_pago_liga: [OK([{ id: 'liga-1' }])] });
    await expect(revocarLigaPago(T, '55555555-5555-4555-8555-555555555555')).resolves.toBeUndefined();
    expect(anotarBitacora).toHaveBeenCalled();
  });
});

describe('registrarPropuesta — el único verbo del cliente, y nunca lanza', () => {
  it('el camino feliz devuelve el id y `repetida: false`', async () => {
    conTablas({ portal_pago_propuesta: [OK({ id: 'p-1' })] });
    const r = await registrarPropuesta(LIGA, {
      fecha: '2026-08-20', monto: 1160, referencia: 'REF-1', metodo: 'transferencia',
    });
    expect(r).toEqual({ ok: true, id: 'p-1', repetida: false });
  });

  it('EL CHOQUE 23505 NO ES UN ERROR: es el segundo clic', async () => {
    conTablas({ portal_pago_propuesta: [CHOQUE()] });
    const r = await registrarPropuesta(LIGA, {
      fecha: '2026-08-20', monto: 1160, referencia: 'REF-1', metodo: 'transferencia',
    });
    expect(r).toEqual({ ok: true, id: null, repetida: true });
    // Y no se anota como hecho nuevo.
    expect(anotarBitacora).not.toHaveBeenCalled();
  });

  it('cualquier otro error contesta `ok: false` — no lanza contra la página pública', async () => {
    conTablas({ portal_pago_propuesta: [FALLA('sin red')] });
    const r = await registrarPropuesta(LIGA, {
      fecha: '2026-08-20', monto: 1160, referencia: 'REF-1', metodo: 'transferencia',
    });
    expect(r.ok).toBe(false);
  });

  it('una excepción del cliente tampoco escapa', async () => {
    sbMock.mockImplementation(() => { throw new Error('boom'); });
    const r = await registrarPropuesta(LIGA, {
      fecha: '2026-08-20', monto: 1160, referencia: 'REF-1', metodo: 'transferencia',
    });
    expect(r.ok).toBe(false);
  });

  it('el actor de la bitácora es `sistema`: no hay cuenta detrás, hay un token', async () => {
    conTablas({ portal_pago_propuesta: [OK({ id: 'p-1' })] });
    await registrarPropuesta(LIGA, {
      fecha: '2026-08-20', monto: 1160, referencia: 'REF-1', metodo: 'transferencia',
    });
    expect(anotarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'sistema', entidad: 'portal_pago_propuesta' }),
      expect.anything(),
    );
  });
});

describe('conciliarPropuesta — el abono primero, el sello después', () => {
  const FILA = {
    id: PROPUESTA, factura_id: FACTURA, fecha: '2026-08-20',
    monto: 1160, referencia: 'REF-1', metodo: 'transferencia', estado: 'pendiente',
  };

  it('una propuesta ya resuelta no se vuelve a conciliar', async () => {
    conTablas({ portal_pago_propuesta: [OK({ ...FILA, estado: 'conciliada' })] });
    await expect(conciliarPropuesta(T, PROPUESTA)).rejects.toThrow(/ya estaba resuelto/i);
    expect(registrarPago).not.toHaveBeenCalled();
  });

  it('una propuesta de otra flota se rechaza', async () => {
    conTablas({ portal_pago_propuesta: [OK(null)] });
    await expect(conciliarPropuesta(T, PROPUESTA)).rejects.toThrow(/no es de tu flota/i);
  });

  it('el camino feliz pasa por `registrarPago`, no por un insert propio', async () => {
    // Un segundo camino a `pago_recibido` sería una segunda regla de dinero.
    conTablas({ portal_pago_propuesta: [OK(FILA), OK([{ id: PROPUESTA }])] });
    const r = await conciliarPropuesta(T, PROPUESTA);
    expect(registrarPago).toHaveBeenCalledWith(T, expect.objectContaining({
      facturaId: FACTURA, monto: 1160, referencia: 'REF-1',
    }), undefined);
    expect(r).toEqual({ pagoId: PAGO, monto: 1160 });
  });

  it('si `registrarPago` rechaza el sobrepago, NADA se sella', async () => {
    registrarPago.mockRejectedValue(new DatoInvalido('El abono rebasa el saldo.'));
    conTablas({ portal_pago_propuesta: [OK(FILA)] });
    await expect(conciliarPropuesta(T, PROPUESTA)).rejects.toThrow(/rebasa/);
  });

  it('si otra sesión llegó primero, se DICE que quedó un abono huérfano — con su id', async () => {
    // No se borra en silencio: el contralor tiene que poder ir a cancelarlo.
    conTablas({ portal_pago_propuesta: [OK(FILA), OK([])] });
    await expect(conciliarPropuesta(T, PROPUESTA)).rejects.toThrow(new RegExp(PAGO));
    expect(anotarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'portal_pago.conciliacion_duplicada' }),
      expect.anything(),
    );
  });
});

describe('descartarPropuesta — «sin motivo» no es una respuesta', () => {
  it('el motivo es obligatorio, y corto no cuenta', async () => {
    conTablas({});
    await expect(descartarPropuesta(T, PROPUESTA, '')).rejects.toThrow(/por qué/i);
    await expect(descartarPropuesta(T, PROPUESTA, 'no')).rejects.toThrow(DatoInvalido);
  });

  it('un motivo enorme se rechaza en vez de truncarse', async () => {
    conTablas({});
    await expect(descartarPropuesta(T, PROPUESTA, 'x'.repeat(501))).rejects.toThrow(/500/);
  });

  it('con motivo, descarta y lo anota', async () => {
    conTablas({ portal_pago_propuesta: [OK([{ id: PROPUESTA }])] });
    await expect(
      descartarPropuesta(T, PROPUESTA, 'El depósito no aparece en el estado de cuenta.'),
    ).resolves.toBeUndefined();
    expect(anotarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'portal_pago.propuesta_descartada' }),
      expect.anything(),
    );
  });

  it('si ya estaba resuelta, lo dice', async () => {
    conTablas({ portal_pago_propuesta: [OK([])] });
    await expect(descartarPropuesta(T, PROPUESTA, 'un motivo suficiente')).rejects.toThrow(DatoInvalido);
  });
});

describe('registrarRepEmitido — Likida no timbra, solo registra', () => {
  const BASE = {
    facturaId: FACTURA, pagoId: PAGO,
    cfdiUuid: 'AAAAAAAA-BBBB-4CCC-8DDD-000000000001',
    fechaPago: '2026-08-20', impPagado: '11,600.00', formaPago: '03', xml: '',
  };

  it('el UUID se normaliza a minúsculas, como exige el CHECK de la 0228', async () => {
    conTablas({ rep_emitido: [OK({ id: 'rep-1' })] });
    await registrarRepEmitido(T, BASE);
    expect(anotarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({
        detalle: expect.objectContaining({ cfdiUuid: BASE.cfdiUuid.toLowerCase(), conXml: false }),
      }),
      expect.anything(),
    );
  });

  it('un folio que no tiene forma de UUID manda a copiarlo del acuse', async () => {
    conTablas({});
    await expect(registrarRepEmitido(T, { ...BASE, cfdiUuid: 'REP-2026-001' })).rejects.toThrow(/acuse/i);
  });

  it('importe cero o ilegible se rechaza', async () => {
    conTablas({});
    await expect(registrarRepEmitido(T, { ...BASE, impPagado: '0' })).rejects.toThrow(DatoInvalido);
    await expect(registrarRepEmitido(T, { ...BASE, impPagado: 'mucho' })).rejects.toThrow(DatoInvalido);
  });

  it('la forma de pago del SAT son dos dígitos, o nada', async () => {
    conTablas({ rep_emitido: [OK({ id: 'rep-1' })] });
    await expect(registrarRepEmitido(T, { ...BASE, formaPago: 'transferencia' })).rejects.toThrow(/dos dígitos/i);
    await expect(registrarRepEmitido(T, { ...BASE, formaPago: '' })).resolves.toBe('rep-1');
  });

  it('una fecha ilegible se rechaza', async () => {
    conTablas({});
    await expect(registrarRepEmitido(T, { ...BASE, fechaPago: 'ayer' })).rejects.toThrow(DatoInvalido);
  });

  it('el mismo folio fiscal dos veces se traduce a instrucción', async () => {
    conTablas({ rep_emitido: [CHOQUE()] });
    await expect(registrarRepEmitido(T, BASE)).rejects.toThrow(/ya está registrado/i);
  });

  it('un XML enorme se rechaza con salida: registrarlo sin archivo', async () => {
    conTablas({});
    await expect(registrarRepEmitido(T, { ...BASE, xml: 'x'.repeat(500_001) })).rejects.toThrow(/sin archivo/i);
  });

  it('ids que no son UUID ni consultan', async () => {
    conTablas({});
    await expect(registrarRepEmitido(T, { ...BASE, facturaId: 'x' })).rejects.toThrow(DatoInvalido);
    await expect(registrarRepEmitido(T, { ...BASE, pagoId: 'x' })).rejects.toThrow(DatoInvalido);
    expect(sbMock).not.toHaveBeenCalled();
  });
});

describe('sellarRepEntregado — el sello no puede negar el documento', () => {
  it('traga el error de la base', async () => {
    conTablas({ rep_emitido: [FALLA('sin red')] });
    await expect(sellarRepEntregado(T, FACTURA)).resolves.toBeUndefined();
  });

  it('traga hasta una excepción del cliente', async () => {
    sbMock.mockImplementation(() => { throw new Error('boom'); });
    await expect(sellarRepEntregado(T, FACTURA)).resolves.toBeUndefined();
  });
});
