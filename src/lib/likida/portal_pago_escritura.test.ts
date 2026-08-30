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
// `AbonoYaRegistrado` se importa del módulo REAL de errores y no del mock de
// `facturacion_escritura`: la clase vive en `errores.ts` justo para que quien
// necesita reconocerla no tenga que arrastrar la cadena de facturación. Si
// alguien la moviera de vuelta, este import se rompería y esa prueba —la de la
// idempotencia del abono— dejaría de compilar antes de dejar de proteger.
import { DatoInvalido, AbonoYaRegistrado } from './errores';

type Resultado = { data: unknown; error: { message: string; code?: string } | null };

// ── Auditoría 21 · ALTO — el `.eq('estado', 'pendiente')` del UPDATE de
// sellado (`conciliarPropuesta`/`descartarPropuesta`) NO TENÍA ANCLA en este
// mock: el Proxy de abajo devolvía la MISMA respuesta fija sin mirar nunca los
// argumentos de `.eq()`, así que borrar ese `.eq()` en producción no podía
// ponerse rojo aquí. `filasConGuarda` es la fila «real» simulada para una
// tabla; cuando una prueba la registra con `establecerFilaConGuarda`, un
// UPDATE cuyos `.eq()` acumulados no calcen contra esa fila devuelve 0 filas
// —tal como Postgres— SIN IMPORTAR la respuesta fija en la cola. Las tablas
// sin guarda siguen exactamente como antes: respuesta fija por índice de
// llamada, cero cambio de comportamiento para el resto de las pruebas.
const filasConGuarda = new Map<string, Record<string, unknown>>();
function establecerFilaConGuarda(tabla: string, fila: Record<string, unknown>) {
  filasConGuarda.set(tabla, fila);
}

function cadena(tabla: string, resultado: Resultado): unknown {
  const filtros: Array<[string, unknown]> = [];
  let esUpdate = false;
  const p = Promise.resolve().then(() => {
    const guarda = filasConGuarda.get(tabla);
    if (esUpdate && guarda && !filtros.every(([c, v]) => guarda[c] === v)) {
      return { data: [], error: null } as Resultado;
    }
    return resultado;
  });
  const proxy: unknown = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'then') return p.then.bind(p);
      if (prop === 'catch') return p.catch.bind(p);
      if (prop === 'finally') return p.finally.bind(p);
      if (prop === 'eq') return (c: string, v: unknown) => { filtros.push([c, v]); return proxy; };
      if (prop === 'update') return (..._a: unknown[]) => { esUpdate = true; return proxy; };
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
      if (!r) return cadena(tabla, OK(null));
      const i = usados[tabla] ?? 0;
      usados[tabla] = i + 1;
      return cadena(tabla, r[Math.min(i, r.length - 1)]);
    },
  });
}

const T = '11111111-1111-4111-8111-111111111111';
const FACTURA = '22222222-2222-4222-8222-222222222222';
const PROPUESTA = '33333333-3333-4333-8333-333333333333';
const PAGO = '44444444-4444-4444-8444-444444444444';
const LIGA = { ligaId: 'liga-1', tenantId: T, facturaId: FACTURA };

beforeEach(() => { vi.clearAllMocks(); registrarPago.mockResolvedValue(PAGO); filasConGuarda.clear(); });

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
      // La primera lectura de la tabla es la limpieza de caducadas; la segunda,
      // el insert.
      portal_pago_liga: [OK([]), OK({ id: 'liga-1' })],
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
      portal_pago_liga: [OK([]), CHOQUE()],
    });
    await expect(crearLigaPago(T, FACTURA)).rejects.toThrow(/ya tiene un enlace vigente/i);
  });

  it('un error que NO es choque no se disfraza de dato inválido', async () => {
    conTablas({
      factura_emitida: [OK({ id: FACTURA, estatus: 'emitida' })],
      portal_pago_liga: [OK([]), FALLA('conexión perdida')],
    });
    await expect(crearLigaPago(T, FACTURA)).rejects.not.toBeInstanceOf(DatoInvalido);
  });

  // ── `c7-26` · LA LIGA CADUCADA NO ES UNA LIGA VIGENTE ───────────────────
  it('la liga CADUCADA se revoca sola y deja sitio, en vez de mentir', async () => {
    // El índice `portal_pago_liga_viva_unica` no mira `expira_en`, así que una
    // liga muerta el 30-jul seguía ocupando el lugar en agosto y el contralor
    // recibía «Esa factura ya tiene un enlace vigente» sobre un cadáver que el
    // propio código clasifica como `expirada`.
    conTablas({
      factura_emitida: [OK({ id: FACTURA, estatus: 'emitida' })],
      portal_pago_liga: [OK([{ id: 'liga-vieja' }]), OK({ id: 'liga-2' })],
    });
    const l = await crearLigaPago(T, FACTURA);
    expect(l.prefijo.startsWith('pgo_')).toBe(true);
    expect(anotarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'portal_pago.liga_caducada_revocada', entidadId: 'liga-vieja',
      }),
      expect.anything(),
    );
  });

  it('si la limpieza de caducadas falla, NO se sigue con un mensaje que puede mentir', async () => {
    conTablas({
      factura_emitida: [OK({ id: FACTURA, estatus: 'emitida' })],
      portal_pago_liga: [FALLA('sin red')],
    });
    await expect(crearLigaPago(T, FACTURA)).rejects.toThrow(/enlaces caducados/i);
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
    }), undefined, PROPUESTA);
    expect(r).toEqual({ pagoId: PAGO, monto: 1160 });
  });

  it('LA PROPUESTA VIAJA COMO LLAVE DE IDEMPOTENCIA, siempre', async () => {
    // `c7-5`: sin este cuarto argumento, `pago_recibido.propuesta_id` queda
    // NULL, el índice único parcial de la 0237 no indexa la fila y la carrera
    // vuelve tal cual. El `if (estado !== 'pendiente')` de arriba NO es el
    // candado —es el mensaje amable—, así que esta es la línea que hay que
    // vigilar.
    conTablas({ portal_pago_propuesta: [OK(FILA), OK([{ id: PROPUESTA }])] });
    await conciliarPropuesta(T, PROPUESTA);
    expect((registrarPago.mock.calls[0] as unknown[])[3]).toBe(PROPUESTA);
  });

  it('si `registrarPago` rechaza el sobrepago, NADA se sella', async () => {
    registrarPago.mockRejectedValue(new DatoInvalido('El abono rebasa el saldo.'));
    conTablas({ portal_pago_propuesta: [OK(FILA)] });
    await expect(conciliarPropuesta(T, PROPUESTA)).rejects.toThrow(/rebasa/);
  });

  // ── `c7-5` · CONCILIAR DOS VECES ES CONCILIAR UNA VEZ ───────────────────
  it('si el abono de esta propuesta YA EXISTÍA, se cuelga de él y NO crea otro', async () => {
    // Es lo que pasa cuando dos pestañas concilian a la vez: la base rechaza el
    // segundo insert por el índice único, `registrarPago` lo cuenta como
    // `AbonoYaRegistrado`, y esta función termina el trabajo con el abono que
    // ya está. Antes se creaba un SEGUNDO abono real y se dejaba dicho en la
    // bitácora que había quedado huérfano — dinero duplicado en la cartera de
    // un cliente, para que alguien lo cancelara a mano.
    registrarPago.mockRejectedValue(new AbonoYaRegistrado(PROPUESTA));
    conTablas({
      portal_pago_propuesta: [OK(FILA), OK([{ id: PROPUESTA }])],
      pago_recibido: [OK([{ id: PAGO }])],
    });
    const r = await conciliarPropuesta(T, PROPUESTA);
    expect(r).toEqual({ pagoId: PAGO, monto: 1160 });
    expect(anotarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'portal_pago.propuesta_conciliada',
        detalle: expect.objectContaining({ abonoYaExistia: true }),
      }),
      expect.anything(),
    );
  });

  it('si la otra sesión ya selló con ESE MISMO abono, no hay nada que reportar', async () => {
    // Idempotencia completa: mismo resultado, un solo abono, sin excepción en
    // la cara del contralor por haber apretado dos veces.
    registrarPago.mockRejectedValue(new AbonoYaRegistrado(PROPUESTA));
    conTablas({
      portal_pago_propuesta: [OK(FILA), OK([]), OK({ estado: 'conciliada', pago_id: PAGO })],
      pago_recibido: [OK([{ id: PAGO }])],
    });
    const r = await conciliarPropuesta(T, PROPUESTA);
    expect(r).toEqual({ pagoId: PAGO, monto: 1160 });
    expect(anotarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'portal_pago.conciliacion_repetida' }),
      expect.anything(),
    );
  });

  it('si la propuesta cambió de estado antes del sello, se dice con su id — sin borrar nada', async () => {
    // El caso que queda vivo: alguien la DESCARTÓ entre el abono y el sello.
    // El abono existe y es real; se deja dicho para que un humano decida.
    conTablas({
      portal_pago_propuesta: [OK(FILA), OK([]), OK({ estado: 'descartada', pago_id: null })],
    });
    await expect(conciliarPropuesta(T, PROPUESTA)).rejects.toThrow(new RegExp(PAGO));
    expect(anotarBitacora).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'portal_pago.conciliacion_sin_sello' }),
      expect.anything(),
    );
  });

  it('si la base dice "duplicado" y el abono no aparece, NO se inventa un id', async () => {
    registrarPago.mockRejectedValue(new AbonoYaRegistrado(PROPUESTA));
    conTablas({
      portal_pago_propuesta: [OK(FILA)],
      pago_recibido: [OK([])],
    });
    await expect(conciliarPropuesta(T, PROPUESTA)).rejects.toThrow(/no encuentro el original/i);
  });

  // ── Auditoría 21 · ALTO — el sello `.eq('estado', 'pendiente')` ─────────
  // Es justo el ancla que el comentario del código (líneas 264-267) dice que
  // evita la carrera: «otra sesión ya selló, o alguien descartó la propuesta
  // entre medias». Aquí la fila simulada YA está `descartada` cuando llega el
  // UPDATE de sellado: con el ancla intacta ese UPDATE no calza y toca 0
  // filas (entra al camino de "cambió de estado"); si el `.eq('estado',…)`
  // desaparece de producción, el mock deja de tener nada que descartar y
  // reporta éxito sobre una propuesta que otra sesión ya resolvió.
  it('si la propuesta cambió de estado ANTES del sello, no la resella (ancla `.eq(estado,pendiente)`)', async () => {
    conTablas({
      portal_pago_propuesta: [OK(FILA), OK([{ id: PROPUESTA }]), OK({ estado: 'descartada', pago_id: null })],
    });
    establecerFilaConGuarda('portal_pago_propuesta', { id: PROPUESTA, tenant_id: T, estado: 'descartada' });
    await expect(conciliarPropuesta(T, PROPUESTA)).rejects.toThrow(/cambió de estado/i);
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

  // ── Auditoría 21 · ALTO — mismo ancla `.eq('estado', 'pendiente')`,
  // gemela de `conciliarPropuesta` (línea 368 del archivo de producción).
  // La fila simulada ya está `conciliada`: con el ancla intacta el UPDATE de
  // descarte no calza contra ella y toca 0 filas. Sin el ancla, el mock solo
  // vería `id`/`tenant_id` (que sí calzan) y reportaría éxito sobre una
  // propuesta que ya se resolvió por el otro lado.
  it('una propuesta que YA NO está pendiente no se descarta de nuevo (ancla estado)', async () => {
    conTablas({ portal_pago_propuesta: [OK([{ id: PROPUESTA }])] });
    establecerFilaConGuarda('portal_pago_propuesta', { id: PROPUESTA, tenant_id: T, estado: 'conciliada' });
    await expect(descartarPropuesta(T, PROPUESTA, 'un motivo suficiente')).rejects.toThrow(DatoInvalido);
  });
});

describe('registrarRepEmitido — Likida no timbra, solo registra', () => {
  const BASE = {
    facturaId: FACTURA, pagoId: PAGO,
    cfdiUuid: 'AAAAAAAA-BBBB-4CCC-8DDD-000000000001',
    fechaPago: '2026-08-20', impPagado: '11,600.00', formaPago: '03', xml: '',
  };
  /** El abono que ampara: de ESTA factura y por ESTE importe. */
  const ABONO = OK({ id: PAGO, factura_id: FACTURA, monto: 11600 });

  it('el UUID se normaliza a minúsculas, como exige el CHECK de la 0228', async () => {
    conTablas({ pago_recibido: [ABONO], rep_emitido: [OK({ id: 'rep-1' })] });
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
    conTablas({ pago_recibido: [ABONO], rep_emitido: [OK({ id: 'rep-1' })] });
    await expect(registrarRepEmitido(T, { ...BASE, formaPago: 'transferencia' })).rejects.toThrow(/dos dígitos/i);
    await expect(registrarRepEmitido(T, { ...BASE, formaPago: '' })).resolves.toBe('rep-1');
  });

  it('una fecha ilegible se rechaza', async () => {
    conTablas({});
    await expect(registrarRepEmitido(T, { ...BASE, fechaPago: 'ayer' })).rejects.toThrow(DatoInvalido);
  });

  it('el mismo folio fiscal dos veces se traduce a instrucción', async () => {
    conTablas({ pago_recibido: [ABONO], rep_emitido: [CHOQUE()] });
    await expect(registrarRepEmitido(T, BASE)).rejects.toThrow(/ya está registrado/i);
  });

  // ── `c7-25` · EL COMPLEMENTO AMPARA EL ABONO DE SU FACTURA ──────────────
  it('un abono de OTRA factura se rechaza, y se dice cuál es el problema', async () => {
    // El formulario manda `facturaId` y `pagoId` como dos cadenas sueltas: un
    // contralor con dos facturas del mismo cliente en pestañas pega el id
    // equivocado y el portal del cliente enseña un importe que fue a otro papel.
    conTablas({ pago_recibido: [OK({ id: PAGO, factura_id: 'otra-factura', monto: 11600 })] });
    await expect(registrarRepEmitido(T, BASE)).rejects.toThrow(/es de OTRA factura/i);
  });

  it('un importe que no cuadra con el abono se rechaza con las dos cifras', async () => {
    conTablas({ pago_recibido: [OK({ id: PAGO, factura_id: FACTURA, monto: 5000 })] });
    await expect(registrarRepEmitido(T, BASE)).rejects.toThrow(/\$11,600\.00/);
    await expect(registrarRepEmitido(T, BASE)).rejects.toThrow(/\$5,000\.00/);
  });

  it('UN CENTAVO de diferencia ya no cuadra: es lo que rebota el PAC', async () => {
    // La holgura es la misma media-centavo de la casa (`TOLERANCIA_ABONO_MXN`),
    // no «más o menos»: un complemento que declara un peso distinto al abono
    // que ampara es justo lo que el SAT no acepta.
    conTablas({ pago_recibido: [OK({ id: PAGO, factura_id: FACTURA, monto: 11600.01 })] });
    await expect(registrarRepEmitido(T, BASE)).rejects.toThrow(/no cuadra/i);
  });

  it('la cola binaria de un `numeric` no se cuenta como descuadre', async () => {
    conTablas({
      pago_recibido: [OK({ id: PAGO, factura_id: FACTURA, monto: 11600.000000001 })],
      rep_emitido: [OK({ id: 'rep-1' })],
    });
    await expect(registrarRepEmitido(T, BASE)).resolves.toBe('rep-1');
  });

  it('un abono que no existe en la flota se dice con instrucción', async () => {
    conTablas({ pago_recibido: [OK(null)] });
    await expect(registrarRepEmitido(T, BASE)).rejects.toThrow(/no existe en tu flota/i);
  });

  // ── `c7-14` · EL IMPORTE PEGADO DEL ACUSE NO SE ADIVINA ─────────────────
  it('«1.234,50» pegado del acuse del PAC se RECHAZA, no se guarda como $1.23', async () => {
    conTablas({});
    await expect(registrarRepEmitido(T, { ...BASE, impPagado: '1.234,50' })).rejects.toThrow(DatoInvalido);
    // Y ni siquiera se llegó a leer el abono: el monto se valida antes.
    expect(sbMock).not.toHaveBeenCalled();
  });

  it('un XML enorme se rechaza con salida: registrarlo sin archivo', async () => {
    conTablas({ pago_recibido: [ABONO] });
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
  const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';

  it('traga el error de la base', async () => {
    conTablas({ rep_emitido: [FALLA('sin red')] });
    await expect(sellarRepEntregado(T, FACTURA, [UUID])).resolves.toBeUndefined();
  });

  it('traga hasta una excepción del cliente', async () => {
    sbMock.mockImplementation(() => { throw new Error('boom'); });
    await expect(sellarRepEntregado(T, FACTURA, [UUID])).resolves.toBeUndefined();
  });

  // ── `c7-16` · UNA CONSTANCIA DE ENTREGA FALSA ES PEOR QUE NINGUNA ───────
  it('sin folios que sellar NO TOCA la tabla', async () => {
    // Antes esto sellaba TODOS los REP de la factura sin mirar cuál se había
    // enseñado; con tres parcialidades, abrir el enlace dejaba «entregado»
    // escrito sobre dos documentos que nadie vio y que ninguna ruta podía
    // entregar. La 0228 dice que esa columna es «la constancia de entrega, no
    // una intención de entregar».
    conTablas({ rep_emitido: [OK(null)] });
    await sellarRepEntregado(T, FACTURA, []);
    expect(sbMock).not.toHaveBeenCalled();
  });

  it('con folios, sella y no lanza', async () => {
    conTablas({ rep_emitido: [OK(null)] });
    await expect(sellarRepEntregado(T, FACTURA, [UUID.toUpperCase(), ' ', UUID]))
      .resolves.toBeUndefined();
    expect(sbMock).toHaveBeenCalled();
  });
});
