import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL PRIMER EMISOR DE `avisoHuerfanos` — el QUÉ se mide y A QUIÉN le toca.
//
// `avisar()` se mockea ENTERO (mismo criterio que `escalar_viaje.test.ts` para
// `avisoEscalados`): lo que este archivo prueba es QUÉ le pasa a `avisar` —a
// qué flota, con qué magnitud, con qué correo armado— sin arrastrar el motor
// de anti-ruido real (piso, marcas de insistencia), que tiene su propia suite
// exhaustiva en `agentes/notificaciones.test.ts` y su propia prueba de
// integración de punta a punta en `avisar_huerfanos_antirruido.test.ts`.
// ═══════════════════════════════════════════════════════════════════════════

const { avisar } = vi.hoisted(() => ({ avisar: vi.fn() }));
vi.mock('./agentes/notificaciones', () => ({ avisar }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

/** Lo que devuelve el SELECT de `comprobante_huerfano` pendientes. */
let pendientes: Array<{ tenant_id: string; creado_en: string }> = [];
/** Lo que devuelve el SELECT de `agente_notificacion_estado` con incidentes
 *  de `liquidacion:cola_atorada` todavía abiertos (magnitud > 0). */
let abiertos: { data: unknown; error: { message: string } | null } = { data: [], error: null };

function cadenaHuerfanos() {
  const nodo: Record<string, unknown> = {};
  for (const m of ['select', 'is', 'order', 'range']) {
    nodo[m] = () => nodo;
  }
  // `traerTodo` pide el total en la primera página (`conteo(0)`): basta con
  // devolver TODO de golpe y su propio length como `count` para que la
  // paginación se detenga ahí.
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: pendientes, error: null, count: pendientes.length }).then(r);
  return nodo;
}

function cadenaEstado() {
  const nodo: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gt']) {
    nodo[m] = () => nodo;
  }
  nodo.then = (r: (v: unknown) => unknown) => Promise.resolve(abiertos).then(r);
  return nodo;
}

const from = vi.fn((tabla: string) => (tabla === 'comprobante_huerfano' ? cadenaHuerfanos() : cadenaEstado()));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [string])) }),
}));

const { avisarHuerfanosPendientes } = await import('./avisar_huerfanos');

const AHORA = new Date('2026-10-19T12:00:00.000Z');
const diasAntes = (n: number) => new Date(AHORA.getTime() - n * 86_400_000).toISOString();

beforeEach(() => {
  pendientes = [];
  abiertos = { data: [], error: null };
  avisar.mockReset();
  avisar.mockResolvedValue({ avisado: true, porque: 'ok', destinatarios: 1, magnitud: 1 });
  from.mockClear();
  for (const f of Object.values(logger)) f.mockReset();
});

describe('se dispara cuando hay huérfanos pendientes', () => {
  it('una flota con huérfanos manda `hayProblema: true` con la magnitud MEDIDA', async () => {
    pendientes = [
      { tenant_id: 't-1', creado_en: diasAntes(1) },
      { tenant_id: 't-1', creado_en: diasAntes(3) },
    ];

    const r = await avisarHuerfanosPendientes(AHORA);

    expect(r.conPendientes).toBe(1);
    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar.mock.calls[0].slice(0, 4)).toEqual([
      't-1', 'liquidacion', 'cola_atorada', { hayProblema: true, magnitud: 2 },
    ]);
  });

  it('dos flotas con huérfanos reciben DOS avisos independientes, cada uno con su propia cuenta', async () => {
    pendientes = [
      { tenant_id: 't-1', creado_en: diasAntes(1) },
      { tenant_id: 't-2', creado_en: diasAntes(1) },
      { tenant_id: 't-2', creado_en: diasAntes(1) },
      { tenant_id: 't-2', creado_en: diasAntes(1) },
    ];

    await avisarHuerfanosPendientes(AHORA);

    expect(avisar).toHaveBeenCalledTimes(2);
    const deT1 = avisar.mock.calls.find((c) => c[0] === 't-1')!;
    const deT2 = avisar.mock.calls.find((c) => c[0] === 't-2')!;
    expect(deT1[3]).toEqual({ hayProblema: true, magnitud: 1 });
    expect(deT2[3]).toEqual({ hayProblema: true, magnitud: 3 });
  });
});

describe('no se dispara si no hay nada que avisar', () => {
  it('sin huérfanos pendientes y sin un incidente previo, `avisar` nunca se llama', async () => {
    pendientes = [];
    abiertos = { data: [], error: null };

    const r = await avisarHuerfanosPendientes(AHORA);

    expect(r.conPendientes).toBe(0);
    expect(avisar).not.toHaveBeenCalled();
  });
});

describe('el filo se RE-ARMA cuando una flota resuelve TODOS sus huérfanos', () => {
  it('una flota con el incidente abierto y cero pendientes AHORA manda `hayProblema: false` para cerrarlo', async () => {
    // Sin esto, `debeAvisar` comparará el PRÓXIMO huérfano de esta flota contra
    // la marca vieja (AG-A5, el mismo bug que `cola_atorada`/`escalado`
    // tuvieron en los otros agentes) y el correo no saldría.
    pendientes = [];
    abiertos = { data: [{ tenant_id: 't-3' }], error: null };

    await avisarHuerfanosPendientes(AHORA);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar.mock.calls[0].slice(0, 4)).toEqual([
      't-3', 'liquidacion', 'cola_atorada', { hayProblema: false, magnitud: 0 },
    ]);
  });

  it('una flota con el incidente abierto Y huérfanos de nuevo manda `hayProblema: true` una sola vez (no se duplica)', async () => {
    pendientes = [{ tenant_id: 't-3', creado_en: diasAntes(0) }];
    abiertos = { data: [{ tenant_id: 't-3' }], error: null };

    await avisarHuerfanosPendientes(AHORA);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar.mock.calls[0].slice(0, 4)).toEqual([
      't-3', 'liquidacion', 'cola_atorada', { hayProblema: true, magnitud: 1 },
    ]);
  });
});

describe('aislamiento por tenant', () => {
  it('la antigüedad del más viejo de una flota no se contamina con la de otra', async () => {
    pendientes = [
      { tenant_id: 't-vieja', creado_en: diasAntes(20) },
      { tenant_id: 't-nueva', creado_en: diasAntes(1) },
    ];

    await avisarHuerfanosPendientes(AHORA);

    type Armador = (d: { flota: null; agente: string; ruta: string; magnitud: number; cuando: string }) =>
      { tono: string };
    const datos = { flota: null, agente: 'Agente de Liquidación', ruta: '/dashboard/agentes/liquidacion', magnitud: 1, cuando: 'hoy' };

    const deVieja = avisar.mock.calls.find((c) => c[0] === 't-vieja')!;
    const deNueva = avisar.mock.calls.find((c) => c[0] === 't-nueva')!;
    // `avisoHuerfanos` sube a "atención" solo cuando el más viejo lleva ≥7
    // días (avisos.test.ts). Si las antigüedades se mezclaran entre flotas,
    // la flota nueva (1 día) heredaría el tono urgente de la vieja (20 días).
    expect((deVieja[4] as Armador)(datos).tono).toBe('atencion');
    expect((deNueva[4] as Armador)(datos).tono).toBe('neutral');
  });

  it('un incidente abierto de OTRA flota no dispara un cierre falso para la flota con huérfanos reales', async () => {
    pendientes = [{ tenant_id: 't-con-huerfanos', creado_en: diasAntes(0) }];
    abiertos = { data: [{ tenant_id: 't-otra-flota' }], error: null };

    await avisarHuerfanosPendientes(AHORA);

    expect(avisar).toHaveBeenCalledTimes(2);
    const deEsta = avisar.mock.calls.find((c) => c[0] === 't-con-huerfanos')!;
    const deOtra = avisar.mock.calls.find((c) => c[0] === 't-otra-flota')!;
    expect(deEsta[3]).toEqual({ hayProblema: true, magnitud: 1 });
    expect(deOtra[3]).toEqual({ hayProblema: false, magnitud: 0 });
  });
});

describe('AUDITORÍA 28 (hallazgos #2/#3): el reloj compartido corta el ENVÍO, no solo la lectura', () => {
  it('BE-7: si el reloj vence DESPUÉS de leer pero ANTES de la segunda flota, se corta ahí — igual que `vigilarReglas`', async () => {
    // Antes de este fix, `opts.venceEn` solo llegaba a `traerTodo` (la
    // LECTURA de arriba): una vez pasada esa lectura, el `for` de abajo —el
    // que manda el correo de verdad— corría completo sin volver a mirar el
    // reloj. Aquí la lectura pasa con el reloj todavía vivo, y es `avisar()`
    // —el envío de la PRIMERA flota— el que lo agota, para probar que el
    // bucle lo nota ANTES de la segunda.
    pendientes = [
      { tenant_id: 't-1', creado_en: diasAntes(1) },
      { tenant_id: 't-2', creado_en: diasAntes(1) },
    ];
    vi.useFakeTimers();
    try {
      const inicio = new Date('2026-10-19T12:00:00.000Z');
      vi.setSystemTime(inicio);
      const venceEn = inicio.getTime() + 1_000;
      avisar.mockImplementationOnce(async () => {
        vi.setSystemTime(new Date(venceEn + 1)); // el envío a t-1 "tardó" más que el reloj
        return { avisado: true, porque: 'ok', destinatarios: 1, magnitud: 1 };
      });

      const r = await avisarHuerfanosPendientes(AHORA, { venceEn });

      expect(avisar).toHaveBeenCalledTimes(1);
      expect(avisar.mock.calls[0][0]).toBe('t-1');
      expect(r.avisados).toBe(1);
      expect(r.cortadasPorReloj).toBe(1); // t-2 se queda sin evaluar
    } finally {
      vi.useRealTimers();
    }
  });

  it('con el reloj lejos de vencer, nada se corta (el camino de siempre no se rompe)', async () => {
    pendientes = [
      { tenant_id: 't-1', creado_en: diasAntes(1) },
      { tenant_id: 't-2', creado_en: diasAntes(1) },
    ];

    const r = await avisarHuerfanosPendientes(AHORA, { venceEn: Date.now() + 60_000 });

    expect(avisar).toHaveBeenCalledTimes(2);
    expect(r.cortadasPorReloj).toBe(0);
  });
});

describe('un fallo al evaluar una flota no tumba a las demás ni la corrida', () => {
  it('se cuenta en `fallos`, se grita en el log, y las otras flotas SÍ reciben su aviso', async () => {
    pendientes = [
      { tenant_id: 't-rota', creado_en: diasAntes(1) },
      { tenant_id: 't-sana', creado_en: diasAntes(1) },
    ];
    avisar.mockImplementation(async (tenantId: string) => {
      if (tenantId === 't-rota') throw new Error('canal de correo caído');
      return { avisado: true, porque: 'ok', destinatarios: 1, magnitud: 1 };
    });

    const r = await avisarHuerfanosPendientes(AHORA);

    expect(r.fallos).toBe(1);
    expect(r.avisados).toBe(1);
    expect(logger.error).toHaveBeenCalledWith('huerfanos.aviso_roto', expect.objectContaining({ tenantId: 't-rota' }));
  });

  it('un error al leer los incidentes abiertos no detiene el aviso a las flotas con huérfanos AHORA', async () => {
    pendientes = [{ tenant_id: 't-1', creado_en: diasAntes(1) }];
    abiertos = { data: null, error: { message: 'timeout' } };

    const r = await avisarHuerfanosPendientes(AHORA);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(r.avisados).toBe(1);
    expect(logger.error).toHaveBeenCalledWith('huerfanos.abiertos_ilegible', expect.objectContaining({ err: 'timeout' }));
  });
});
