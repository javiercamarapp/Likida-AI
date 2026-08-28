import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// A19 — LOS LECTORES DETERMINISTAS. Lo que estas pruebas fijan:
//
//   1. NULL ≠ 0, en los dos sentidos que importan: una unidad SIN póliza
//      capturada sale en el aviso (no está en regla, está sin verificar) y
//      un viaje sin hito de llegada NO tiene "cero horas de estadía" — no
//      dispara.
//   2. El umbral es ESTRICTO: "más de $3,000" no incluye $3,000. Un tope que
//      dispara en el número exacto convierte la política de la flota en ruido.
//   3. La CLAVE del sello es el ciclo, y cambia cuando el ciclo cambia: el
//      papel renovado, el chofer que pasa de 2 a 3 viajes, la estadía nueva.
//   4. FAIL-CLOSED: un error de lectura LANZA. Devolver [] diría "no hay nada
//      que avisar" con la base caída.
//   5. La evidencia CITA la fila (folio, monto, fecha). Nada redactado.
// ═══════════════════════════════════════════════════════════════════════════

interface Consulta { tabla: string; metodo: string; args: unknown[] }

const tablas = vi.hoisted(() => ({
  respuestas: new Map<string, unknown[]>(),
  errores: new Map<string, string>(),
  consultas: [] as Array<{ tabla: string; metodo: string; args: unknown[] }>,
}));

vi.mock('../presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      // Builder encadenable y thenable, como el de relojes_legales.test.ts:
      // cada método queda registrado para poder afirmar los FILTROS (que son
      // la mitad de la corrección de un lector) sin fingir un PostgREST.
      const api: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown) => Promise.resolve(
          tablas.errores.has(tabla)
            ? { data: null, error: { message: tablas.errores.get(tabla) } }
            : { data: tablas.respuestas.get(tabla) ?? [], error: null },
        ).then(res),
      };
      for (const m of ['select', 'eq', 'neq', 'in', 'gt', 'gte', 'lte', 'is', 'not', 'order', 'limit']) {
        api[m] = (...args: unknown[]) => { tablas.consultas.push({ tabla, metodo: m, args }); return api; };
      }
      return api;
    },
  }),
}));

const { evaluar, horasEntre, TOPE_CANDIDATOS, VENTANA_EVENTO_MS } = await import('./lectores');

const TENANT = 't-1';
/** 27-ago-2026, 18:00 UTC → hoyMx = 2026-08-27. */
const AHORA = new Date('2026-08-27T18:00:00Z');

function pon(tabla: string, filas: unknown[]) { tablas.respuestas.set(tabla, filas); }
function filtros(tabla: string, metodo: string): unknown[][] {
  return tablas.consultas.filter((c: Consulta) => c.tabla === tabla && c.metodo === metodo).map((c) => c.args);
}

beforeEach(() => {
  tablas.respuestas.clear();
  tablas.errores.clear();
  tablas.consultas.length = 0;
});

describe('unidad_sin_papel_vigente_al_despachar — null ≠ en regla', () => {
  const viaje = (extra: Record<string, unknown>) => ({
    id: 'v-1', folio: 'VJ-100', fecha_inicio: '2026-08-25',
    unidad: { id: 'u-1', numero_economico: 'E-07', poliza_vence: null, permiso_sict_vence: null, verificacion_vence: null },
    ...extra,
  });

  it('la póliza VENCIDA antes de la salida dispara, y la evidencia cita las dos fechas', async () => {
    pon('viaje', [viaje({ unidad: { id: 'u-1', numero_economico: 'E-07', poliza_vence: '2026-08-01' } })]);
    const r = await evaluar('unidad_sin_papel_vigente_al_despachar', { documento: 'poliza' }, TENANT, AHORA);
    expect(r).toHaveLength(1);
    expect(r[0].objeto).toBe('viaje');
    expect(r[0].objetoId).toBe('v-1');
    // La fecha de vencimiento ES el ciclo: renovada, vuelve a poder avisar.
    expect(r[0].clave).toBe('2026-08-01');
    expect(r[0].evidencia).toContain('VJ-100');
    expect(r[0].evidencia).toContain('E-07');
    expect(r[0].evidencia).toContain('2026-08-25');
    expect(r[0].evidencia).toContain('2026-08-01');
  });

  it('la unidad SIN póliza capturada también avisa, y dice que no se sabe', async () => {
    pon('viaje', [viaje({})]);
    const r = await evaluar('unidad_sin_papel_vigente_al_despachar', { documento: 'poliza' }, TENANT, AHORA);
    expect(r).toHaveLength(1);
    expect(r[0].clave).toBe('sin_captura');
    expect(r[0].evidencia).toMatch(/NADIE le ha capturado/);
    expect(r[0].evidencia).toMatch(/no se sabe/);
  });

  it('la póliza vigente el día de la salida NO dispara', async () => {
    pon('viaje', [viaje({ unidad: { id: 'u-1', numero_economico: 'E-07', poliza_vence: '2026-12-31' } })]);
    expect(await evaluar('unidad_sin_papel_vigente_al_despachar', { documento: 'poliza' }, TENANT, AHORA)).toHaveLength(0);
  });

  it('la referencia es la SALIDA, no hoy: un papel que venció después no reprocha nada', async () => {
    // Salió el 25 con la póliza vigente hasta el 26. Hoy está vencida, pero
    // cuando la unidad salió NO lo estaba — reprochárselo sería falso.
    pon('viaje', [viaje({ fecha_inicio: '2026-08-25', unidad: { id: 'u-1', numero_economico: 'E-07', poliza_vence: '2026-08-26' } })]);
    expect(await evaluar('unidad_sin_papel_vigente_al_despachar', { documento: 'poliza' }, TENANT, AHORA)).toHaveLength(0);
  });

  it('mira SOLO el papel de la regla: la verificación vencida no dispara la regla de póliza', async () => {
    pon('viaje', [viaje({ unidad: { id: 'u-1', numero_economico: 'E-07', poliza_vence: '2026-12-31', verificacion_vence: '2026-01-01' } })]);
    expect(await evaluar('unidad_sin_papel_vigente_al_despachar', { documento: 'poliza' }, TENANT, AHORA)).toHaveLength(0);
    const r = await evaluar('unidad_sin_papel_vigente_al_despachar', { documento: 'verificacion' }, TENANT, AHORA);
    expect(r).toHaveLength(1);
    expect(r[0].evidencia).toContain('verificación');
  });

  it('acota por tenant, por viaje no liquidado y por ventana de despacho', async () => {
    pon('viaje', []);
    await evaluar('unidad_sin_papel_vigente_al_despachar', { documento: 'poliza' }, TENANT, AHORA);
    expect(filtros('viaje', 'eq')).toContainEqual(['tenant_id', TENANT]);
    expect(filtros('viaje', 'neq')).toContainEqual(['estatus', 'liquidado']);
    expect(filtros('viaje', 'gte')).toContainEqual(['fecha_inicio', '2026-08-20']);
    expect(filtros('viaje', 'limit')).toContainEqual([TOPE_CANDIDATOS]);
  });
});

describe('gasto_de_concepto_mayor_a / gasto_sin_cfdi_mayor_a', () => {
  it('el umbral es ESTRICTO: el filtro pide mayor que el tope, no mayor-o-igual', async () => {
    pon('gasto', []);
    await evaluar('gasto_de_concepto_mayor_a', { concepto: 'caseta', monto: 3000 }, TENANT, AHORA);
    expect(filtros('gasto', 'gt')).toContainEqual(['monto', 3000]);
    expect(filtros('gasto', 'gte').some((a) => a[0] === 'monto')).toBe(false);
    expect(filtros('gasto', 'eq')).toContainEqual(['concepto', 'caseta']);
  });

  it('la evidencia cita monto, concepto, fecha, folio y el tope que se rebasó', async () => {
    pon('gasto', [{ id: 'g-1', viaje_id: 'aaaaaaaa-bbbb', concepto: 'caseta', monto: '3500.50', fecha: '2026-08-27', folio: 'CA-9' }]);
    const r = await evaluar('gasto_de_concepto_mayor_a', { concepto: 'caseta', monto: 3000 }, TENANT, AHORA);
    expect(r[0].objeto).toBe('gasto');
    // El gasto mismo es el ciclo: entra una vez y ya.
    expect(r[0].clave).toBe('');
    expect(r[0].evidencia).toContain('$3,500.50');
    expect(r[0].evidencia).toContain('casetas');
    expect(r[0].evidencia).toContain('2026-08-27');
    expect(r[0].evidencia).toContain('CA-9');
    expect(r[0].evidencia).toContain('$3,000.00');
  });

  it('la ventana de arranque es de 48 h: una regla nueva no vomita el histórico', async () => {
    pon('gasto', []);
    await evaluar('gasto_sin_cfdi_mayor_a', { monto: 2000 }, TENANT, AHORA);
    const desde = new Date(AHORA.getTime() - VENTANA_EVENTO_MS).toISOString();
    expect(filtros('gasto', 'gte')).toContainEqual(['created_at', desde]);
  });

  it('la de "sin CFDI" filtra por cfdi_uuid nulo y lo DICE en el aviso', async () => {
    pon('gasto', [{ id: 'g-2', viaje_id: 'cccccccc-dddd', concepto: 'otro', monto: 2500, fecha: null, folio: null }]);
    const r = await evaluar('gasto_sin_cfdi_mayor_a', { monto: 2000 }, TENANT, AHORA);
    expect(filtros('gasto', 'is')).toContainEqual(['cfdi_uuid', null]);
    expect(r[0].evidencia).toContain('SIN CFDI');
    expect(r[0].evidencia).toContain('no se deduce');
  });
});

describe('chofer_con_viajes_sin_liquidar — el conteo va en la clave', () => {
  const v = (id: string, operador: string, folio: string) =>
    ({ id, folio, operador_id: operador, operador: { nombre: 'Ramón Díaz' } });

  it('dispara al llegar a N, con los folios como evidencia', async () => {
    pon('viaje', [v('v1', 'op-1', 'A-1'), v('v2', 'op-1', 'A-2'), v('v3', 'op-2', 'B-1')]);
    const r = await evaluar('chofer_con_viajes_sin_liquidar', { n: 2 }, TENANT, AHORA);
    expect(r).toHaveLength(1);
    expect(r[0].objeto).toBe('operador');
    expect(r[0].objetoId).toBe('op-1');
    expect(r[0].evidencia).toContain('Ramón Díaz');
    expect(r[0].evidencia).toContain('A-1, A-2');
  });

  it('el conteo ES la clave: de 2 a 3 viajes vuelve a avisar en vez de callarse', async () => {
    pon('viaje', [v('v1', 'op-1', 'A-1'), v('v2', 'op-1', 'A-2')]);
    const dos = await evaluar('chofer_con_viajes_sin_liquidar', { n: 2 }, TENANT, AHORA);
    tablas.respuestas.clear();
    pon('viaje', [v('v1', 'op-1', 'A-1'), v('v2', 'op-1', 'A-2'), v('v3', 'op-1', 'A-3')]);
    const tres = await evaluar('chofer_con_viajes_sin_liquidar', { n: 2 }, TENANT, AHORA);
    expect(dos[0].clave).toBe('2');
    expect(tres[0].clave).toBe('3');
  });

  it('solo cuenta viajes abiertos o en cuadre — un liquidado no es deuda', async () => {
    pon('viaje', []);
    await evaluar('chofer_con_viajes_sin_liquidar', { n: 2 }, TENANT, AHORA);
    expect(filtros('viaje', 'in')).toContainEqual(['estatus', ['abierto', 'en_cuadre']]);
  });

  it('sin nombre capturado no inventa uno', async () => {
    pon('viaje', [
      { id: 'v1', folio: null, operador_id: 'op-9', operador: null },
      { id: 'v2', folio: null, operador_id: 'op-9', operador: null },
    ]);
    const r = await evaluar('chofer_con_viajes_sin_liquidar', { n: 2 }, TENANT, AHORA);
    expect(r[0].evidencia).toMatch(/^un chofer lleva 2 viajes/);
  });
});

describe('documento_por_vencer — la ventana que el dueño eligió', () => {
  it('mira UNIDADES para los papeles de unidad, con horizonte y piso', async () => {
    pon('unidad', [{ id: 'u-3', numero_economico: 'E-12', poliza_vence: '2026-09-20' }]);
    const r = await evaluar('documento_por_vencer', { documento: 'poliza', dias: 45 }, TENANT, AHORA);
    expect(r[0].objeto).toBe('unidad');
    expect(r[0].clave).toBe('2026-09-20');
    expect(r[0].evidencia).toContain('E-12');
    expect(filtros('unidad', 'lte')).toContainEqual(['poliza_vence', '2026-10-11']);
    expect(filtros('unidad', 'eq')).toContainEqual(['activo', true]);
  });

  it('mira OPERADORES para la licencia, y la vencida se dice en pasado', async () => {
    pon('operador', [{ id: 'o-1', nombre: 'Lupita Ruiz', licencia_vence: '2026-08-01' }]);
    const r = await evaluar('documento_por_vencer', { documento: 'licencia', dias: 45 }, TENANT, AHORA);
    expect(r[0].objeto).toBe('operador');
    expect(r[0].evidencia).toContain('VENCIÓ el 2026-08-01');
    expect(r[0].evidencia).toContain('Lupita Ruiz');
  });

  it('una fila con la fecha nula no entra: no hay ciclo que sellar', async () => {
    pon('unidad', [{ id: 'u-4', numero_economico: 'E-13', poliza_vence: null }]);
    expect(await evaluar('documento_por_vencer', { documento: 'poliza', dias: 30 }, TENANT, AHORA)).toHaveLength(0);
  });
});

describe('factura_sin_cobrar_mas_de', () => {
  it("solo 'emitida': ni un borrador ni una cancelada se pueden llamar sin cobrar", async () => {
    pon('factura_emitida', []);
    await evaluar('factura_sin_cobrar_mas_de', { dias: 30 }, TENANT, AHORA);
    expect(filtros('factura_emitida', 'eq')).toContainEqual(['estatus', 'emitida']);
    expect(filtros('factura_emitida', 'lte')).toContainEqual(['fecha', '2026-07-28']);
  });

  it('cita folio, cliente, total y los días MEDIDOS', async () => {
    pon('factura_emitida', [{
      id: 'f-1', folio: '104', serie: 'A', fecha: '2026-07-01', total: '58000',
      cliente: { nombre: 'Vidrios del Bajío' },
    }]);
    const r = await evaluar('factura_sin_cobrar_mas_de', { dias: 30 }, TENANT, AHORA);
    expect(r[0].objeto).toBe('factura');
    expect(r[0].evidencia).toContain('A-104');
    expect(r[0].evidencia).toContain('Vidrios del Bajío');
    expect(r[0].evidencia).toContain('$58,000.00');
    expect(r[0].evidencia).toContain('57 días sin cobrarse');
  });
});

describe('estadia_mayor_a — sin hito de llegada no hay reloj', () => {
  it('el episodio ABIERTO cuenta hasta ahora, y la llegada es la clave', async () => {
    pon('viaje', [{
      id: 'v-9', folio: 'VJ-9', llegada_en: '2026-08-27T12:00:00Z', descarga_en: null,
      unidad: { numero_economico: 'E-21' },
    }]);
    const r = await evaluar('estadia_mayor_a', { horas: 4 }, TENANT, AHORA);
    expect(r).toHaveLength(1);
    expect(r[0].clave).toBe('2026-08-27T12:00:00Z');
    expect(r[0].evidencia).toContain('6 h');
    expect(r[0].evidencia).toContain('E-21');
    expect(r[0].evidencia).toContain('sigue sin sellarse');
  });

  it('el episodio CERRADO cuenta hasta la descarga, no hasta ahora', async () => {
    pon('viaje', [{
      id: 'v-9', folio: 'VJ-9', llegada_en: '2026-08-27T00:00:00Z', descarga_en: '2026-08-27T05:00:00Z',
      unidad: null,
    }]);
    const r = await evaluar('estadia_mayor_a', { horas: 4 }, TENANT, AHORA);
    expect(r[0].evidencia).toContain('5 h');
    expect(r[0].evidencia).toContain('antes de que se sellara la descarga');
  });

  it('exactamente el umbral NO dispara: es "más de", no "al menos"', async () => {
    pon('viaje', [{
      id: 'v-9', folio: 'VJ-9', llegada_en: '2026-08-27T00:00:00Z', descarga_en: '2026-08-27T04:00:00Z', unidad: null,
    }]);
    expect(await evaluar('estadia_mayor_a', { horas: 4 }, TENANT, AHORA)).toHaveLength(0);
  });

  it('la consulta exige llegada_en no nula: un viaje sin hito no tiene cero horas, tiene ninguna', async () => {
    pon('viaje', []);
    await evaluar('estadia_mayor_a', { horas: 4 }, TENANT, AHORA);
    expect(filtros('viaje', 'not')).toContainEqual(['llegada_en', 'is', null]);
  });
});

describe('incidencia_abierta_mas_de', () => {
  it('excluye las resueltas y cita tipo, estado y horas medidas', async () => {
    pon('incidencia', [{
      id: 'i-1', tipo: 'averia', estado: 'en_proceso', descripcion: 'Se ponchó en la 57',
      abierta_en: '2026-08-27T00:00:00Z',
    }]);
    const r = await evaluar('incidencia_abierta_mas_de', { horas: 12 }, TENANT, AHORA);
    expect(filtros('incidencia', 'neq')).toContainEqual(['estado', 'resuelta']);
    expect(r[0].objeto).toBe('incidencia');
    expect(r[0].evidencia).toContain('averia');
    expect(r[0].evidencia).toContain('18 h');
    expect(r[0].evidencia).toContain('Se ponchó en la 57');
  });
});

describe('viaje_abierto_sin_comprobantes_mas_de', () => {
  it('descuenta los viajes que SÍ tienen comprobante', async () => {
    pon('viaje', [
      { id: 'v-a', folio: 'A', fecha_inicio: '2026-08-15', anticipo: '5000', operador: { nombre: 'Beto' } },
      { id: 'v-b', folio: 'B', fecha_inicio: '2026-08-15', anticipo: '3000', operador: null },
    ]);
    pon('gasto', [{ viaje_id: 'v-b' }]);
    const r = await evaluar('viaje_abierto_sin_comprobantes_mas_de', { dias: 5 }, TENANT, AHORA);
    expect(r).toHaveLength(1);
    expect(r[0].objetoId).toBe('v-a');
    expect(r[0].evidencia).toContain('$5,000.00');
    expect(r[0].evidencia).toContain('12 días');
    expect(r[0].evidencia).toContain('Beto');
  });

  it('sin viajes candidatos no consulta gastos — una consulta que no hace falta no se hace', async () => {
    pon('viaje', []);
    const r = await evaluar('viaje_abierto_sin_comprobantes_mas_de', { dias: 5 }, TENANT, AHORA);
    expect(r).toHaveLength(0);
    expect(tablas.consultas.some((c: Consulta) => c.tabla === 'gasto')).toBe(false);
  });
});

describe('costo_ia_dia_mayor_a — el único de la plataforma', () => {
  it('suma el día de México, corta por el techo y desglosa por fase', async () => {
    pon('llm_costo', [
      { costo_usd: '3.5', fase: 'ocr' }, { costo_usd: '2.0', fase: 'cuadre' }, { costo_usd: null, fase: 'chat' },
    ]);
    const r = await evaluar('costo_ia_dia_mayor_a', { usd: 5 }, TENANT, AHORA);
    expect(r).toHaveLength(1);
    expect(r[0].objeto).toBe('tenant');
    expect(r[0].objetoId).toBe(TENANT);
    // El día en la clave: una vez al día, no una por hora.
    expect(r[0].clave).toBe('2026-08-27');
    expect(r[0].evidencia).toContain('US$5.50');
    expect(r[0].evidencia).toContain('ocr US$3.50');
    // La fase de costo NULO no entra al reparto: un "US$0.00" ahí se leería
    // como medición y es una llamada cuyo costo nadie registró.
    expect(r[0].evidencia).not.toContain('chat');
    expect(r[0].evidencia).toContain('3 llamadas');
  });

  it('debajo del techo no dispara, y un costo nulo cuenta como cero gastado (no como dato)', async () => {
    pon('llm_costo', [{ costo_usd: null, fase: 'ocr' }]);
    expect(await evaluar('costo_ia_dia_mayor_a', { usd: 5 }, TENANT, AHORA)).toHaveLength(0);
  });
});

describe('fail-closed: la base caída no se lee como calma', () => {
  it.each([
    ['viaje', 'unidad_sin_papel_vigente_al_despachar', { documento: 'poliza' }],
    ['gasto', 'gasto_sin_cfdi_mayor_a', { monto: 2000 }],
    ['unidad', 'documento_por_vencer', { documento: 'poliza', dias: 30 }],
    ['operador', 'documento_por_vencer', { documento: 'licencia', dias: 30 }],
    ['factura_emitida', 'factura_sin_cobrar_mas_de', { dias: 30 }],
    ['incidencia', 'incidencia_abierta_mas_de', { horas: 12 }],
    ['llm_costo', 'costo_ia_dia_mayor_a', { usd: 5 }],
  ] as const)('%s con error LANZA en vez de devolver vacío', async (tabla, plantilla, params) => {
    tablas.errores.set(tabla, 'connection reset');
    await expect(evaluar(plantilla, params, TENANT, AHORA)).rejects.toThrow(/connection reset/);
  });
});

describe('horasEntre', () => {
  it('mide con un decimal y no se corre por husos', () => {
    expect(horasEntre('2026-08-27T00:00:00Z', Date.parse('2026-08-27T06:30:00Z'))).toBe(6.5);
    expect(horasEntre('2026-08-27T00:00:00Z', Date.parse('2026-08-27T00:00:00Z'))).toBe(0);
  });
});
