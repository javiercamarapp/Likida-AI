import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA BANDEJA PAGINA EN LA BASE, Y CUANDO NO ALCANZA LO DICE.
//
// Lo que estas pruebas protegen es lo que ya salió mal una vez en esta misma
// feature (hallazgo c7-27): traer un montón de filas, cortarlas en JavaScript
// y publicar la cifra como si fuera exacta. Aquí se verifica que:
//
//   · la consulta pide UN RANGO (`.range()`), no la tabla;
//   · lleva `.order()` con desempate por `id` — sin él, la página 2 repite o
//     se salta filas cuando dos comprobantes comparten fecha (c7-4);
//   · el total sale del `count: 'exact'` de la base, y `null` NO se aplasta
//     a 0;
//   · una lectura caída devuelve `error` y jamás se lee como bandeja limpia;
//   · `candidatos` se lee a la defensiva: basura se descarta, no se adivina.
// ═══════════════════════════════════════════════════════════════════════════

interface Llamada {
  tabla: string;
  ops: Array<{ op: string; args: unknown[] }>;
}

const llamadas: Llamada[] = [];
/** Lo que contesta cada `.from(tabla)`, por tabla. */
let respuestas: Record<string, { data: unknown; error: { message: string } | null; count?: number | null }> = {};

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: <T,>(q: T) => q }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const registro: Llamada = { tabla, ops: [] };
      llamadas.push(registro);
      const b: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'is', 'in', 'gte', 'lte', 'or', 'order', 'range', 'limit']) {
        b[op] = (...args: unknown[]) => { registro.ops.push({ op, args }); return b; };
      }
      b.then = (ok: (v: unknown) => unknown) => Promise.resolve(
        respuestas[tabla] ?? { data: [], error: null, count: 0 },
      ).then(ok);
      return b;
    },
  }),
}));

const {
  leerBandeja, buscarGastosParaLigar, candidatosAnotados, motivoAnotado,
  paginaPedida, POR_PAGINA, PAGINA_MAX, MAX_BUSQUEDA_GASTOS, esEstatusCfdi,
} = await import('./bandeja');

const TENANT = '11111111-1111-1111-1111-111111111111';

function fila(extra: Record<string, unknown> = {}) {
  return {
    id: 'cfdi-1', cfdi_uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001',
    rfc_emisor: 'EKU9003173C9', rfc_receptor: 'XAXX010101000',
    total: '300.00', fecha: '2026-08-20', tipo_comprobante: 'I',
    estatus: 'ambiguo', gasto_id: null, candidatos: null,
    resuelto_por_email: null, resuelto_en: null, created_at: '2026-08-21T10:00:00Z',
    ...extra,
  };
}

function ops(tabla: string): Array<{ op: string; args: unknown[] }> {
  return llamadas.filter((l) => l.tabla === tabla).flatMap((l) => l.ops);
}

beforeEach(() => { llamadas.length = 0; respuestas = {}; });

describe('leerBandeja — paginación de verdad', () => {
  it('pide un RANGO de la base, no la tabla entera', async () => {
    respuestas.sat_cfdi_descargado = { data: [fila()], error: null, count: 137 };
    const p = await leerBandeja(TENANT, 'ambiguo', 3);

    const o = ops('sat_cfdi_descargado');
    const range = o.find((x) => x.op === 'range');
    expect(range).toBeDefined();
    // Página 3 con 25 por página = filas 50..74. Ni un `.slice()` en JS.
    expect(range!.args).toEqual([2 * POR_PAGINA, 3 * POR_PAGINA - 1]);
    expect(p.pagina).toBe(3);
  });

  it('el conteo es EXACTO y viene de la base, en la misma consulta', async () => {
    respuestas.sat_cfdi_descargado = { data: [fila()], error: null, count: 137 };
    const p = await leerBandeja(TENANT, 'ambiguo', 1);
    const select = ops('sat_cfdi_descargado').find((x) => x.op === 'select');
    expect(select!.args[1]).toEqual({ count: 'exact' });
    expect(p.total).toBe(137);
  });

  it('un `count` que la base no dio es null, JAMÁS cero', async () => {
    // Un 0 fabricado aquí diría «esta cola está vacía» sobre una cola que
    // nadie midió — la misma mentira que la 0236 tuvo que arreglar.
    respuestas.sat_cfdi_descargado = { data: [fila()], error: null, count: null };
    const p = await leerBandeja(TENANT, 'ambiguo', 1);
    expect(p.total).toBeNull();
    expect(p.filas).toHaveLength(1);
  });

  it('ordena con desempate por id — sin eso la paginación no es reproducible', async () => {
    respuestas.sat_cfdi_descargado = { data: [], error: null, count: 0 };
    await leerBandeja(TENANT, 'disponible', 1);
    const ordenes = ops('sat_cfdi_descargado').filter((x) => x.op === 'order');
    expect(ordenes.map((x) => x.args[0])).toEqual(['fecha', 'id']);
  });

  it('filtra por el tenant de la sesión y por el estatus pedido', async () => {
    respuestas.sat_cfdi_descargado = { data: [], error: null, count: 0 };
    await leerBandeja(TENANT, 'ignorado', 1);
    const eqs = ops('sat_cfdi_descargado').filter((x) => x.op === 'eq');
    expect(eqs).toContainEqual({ op: 'eq', args: ['tenant_id', TENANT] });
    expect(eqs).toContainEqual({ op: 'eq', args: ['estatus', 'ignorado'] });
  });

  it('una lectura caída deja `error` puesto — nunca una bandeja limpia', async () => {
    respuestas.sat_cfdi_descargado = { data: null, error: { message: 'fetch failed' }, count: null };
    const p = await leerBandeja(TENANT, 'ambiguo', 1);
    expect(p.error).toBe('fetch failed');
    expect(p.filas).toEqual([]);
    expect(p.total).toBeNull();
  });

  it('una cola vacía MEDIDA es total 0 y sin error — y eso sí es "no hay"', async () => {
    respuestas.sat_cfdi_descargado = { data: [], error: null, count: 0 };
    const p = await leerBandeja(TENANT, 'ambiguo', 1);
    expect(p.total).toBe(0);
    expect(p.error).toBeNull();
  });

  it('declara la lista TRUNCADA cuando hay más allá de la última página', async () => {
    respuestas.sat_cfdi_descargado = {
      data: [fila()], error: null, count: PAGINA_MAX * POR_PAGINA + 1,
    };
    const p = await leerBandeja(TENANT, 'disponible', 1);
    expect(p.truncada).toBe(true);
  });

  it('no se declara truncada cuando cabe entera', async () => {
    respuestas.sat_cfdi_descargado = { data: [fila()], error: null, count: PAGINA_MAX * POR_PAGINA };
    const p = await leerBandeja(TENANT, 'disponible', 1);
    expect(p.truncada).toBe(false);
  });

  it('`total` null nunca se lee como truncada: no se sabe cuántos hay', async () => {
    respuestas.sat_cfdi_descargado = { data: [fila()], error: null, count: null };
    const p = await leerBandeja(TENANT, 'disponible', 1);
    expect(p.truncada).toBe(false);
  });

  it('`total` null ≠ 0: un CFDI sin total legible no vale cero pesos', async () => {
    respuestas.sat_cfdi_descargado = { data: [fila({ total: null })], error: null, count: 1 };
    const p = await leerBandeja(TENANT, 'ambiguo', 1);
    expect(p.filas[0].total).toBeNull();
  });
});

describe('leerBandeja — los candidatos, con su estado de HOY', () => {
  it('cruza la foto del cruce contra lo que el gasto dice ahora', async () => {
    respuestas.sat_cfdi_descargado = {
      data: [fila({
        candidatos: { candidatos: [
          { gastoId: 'g-vivo', monto: 300, fecha: '2026-08-20', concepto: 'caseta' },
          { gastoId: 'g-tomado', monto: 300, fecha: '2026-08-20', concepto: 'caseta' },
          { gastoId: 'g-muerto', monto: 300, fecha: '2026-08-20', concepto: 'caseta' },
        ] },
      })],
      error: null, count: 1,
    };
    respuestas.gasto = {
      data: [
        { id: 'g-vivo', monto: '300.00', fecha: '2026-08-20', concepto: 'caseta', cfdi_uuid: null },
        { id: 'g-tomado', monto: '305.00', fecha: '2026-08-21', concepto: 'caseta', cfdi_uuid: 'otro-folio' },
      ],
      error: null, count: null,
    };
    const p = await leerBandeja(TENANT, 'ambiguo', 1);
    const [vivo, tomado, muerto] = p.filas[0].candidatos;

    expect(vivo.vive).toBe(true);
    expect(vivo.yaTieneCfdi).toBe(false);
    // El gasto CAMBIÓ desde el cruce: se enseñan las dos cifras, no una.
    expect(tomado.montoOfrecido).toBe(300);
    expect(tomado.montoHoy).toBe(305);
    expect(tomado.yaTieneCfdi).toBe(true);
    // Comprobado que NO está: eso sí es un "no".
    expect(muerto.vive).toBe(false);
    expect(p.incompleta).toBe(false);
  });

  it('si no se pudo leer el gasto, `vive` queda en null (no en false) e incompleta', async () => {
    // La distinción cara: `false` haría que la pantalla dijera «ese gasto ya
    // no existe» sobre un gasto que nadie comprobó.
    respuestas.sat_cfdi_descargado = {
      data: [fila({ candidatos: { candidatos: [{ gastoId: 'g-1', monto: 300, fecha: null, concepto: 'caseta' }] } })],
      error: null, count: 1,
    };
    respuestas.gasto = { data: null, error: { message: 'timeout' }, count: null };
    const p = await leerBandeja(TENANT, 'ambiguo', 1);
    expect(p.filas[0].candidatos[0].vive).toBeNull();
    expect(p.incompleta).toBe(true);
    // …pero las filas SÍ están: una lectura secundaria caída no borra la lista.
    expect(p.filas).toHaveLength(1);
  });
});

describe('candidatosAnotados / motivoAnotado — se lee a la defensiva', () => {
  it('lee la forma que escribe el ciclo', () => {
    expect(candidatosAnotados({ candidatos: [{ gastoId: 'g-1', monto: 10, fecha: '2026-01-01', concepto: 'diesel' }] }))
      .toEqual([{ gastoId: 'g-1', monto: 10, fecha: '2026-01-01', concepto: 'diesel' }]);
  });

  it('descarta lo que no tiene gastoId en vez de adivinar', () => {
    // Un candidato sin id es un botón que no puede funcionar.
    expect(candidatosAnotados({ candidatos: [{ monto: 10 }, { gastoId: '' }, { gastoId: 'g-2' }] }))
      .toEqual([{ gastoId: 'g-2', monto: null, fecha: null, concepto: null }]);
  });

  it('un `candidatos` que es solo motivo no produce candidatos falsos', () => {
    const v = { motivo: 'Ningún gasto registrado corresponde a este comprobante.' };
    expect(candidatosAnotados(v)).toEqual([]);
    expect(motivoAnotado(v)).toContain('Ningún gasto');
  });

  it('null, arreglos y basura devuelven vacío sin lanzar', () => {
    for (const v of [null, undefined, 3, 'x', [], { candidatos: 'no-es-arreglo' }]) {
      expect(candidatosAnotados(v)).toEqual([]);
      expect(motivoAnotado(v)).toBeNull();
    }
  });
});

describe('paginaPedida', () => {
  it('un valor basura cae a la página 1, no revienta', () => {
    for (const v of [undefined, '', 'abc', '-4', '0']) expect(paginaPedida(v)).toBe(1);
  });
  it('se acota al tope declarado: no se promete una página que no se sirve', () => {
    expect(paginaPedida(String(PAGINA_MAX + 500))).toBe(PAGINA_MAX);
    expect(paginaPedida('7')).toBe(7);
  });
});

describe('esEstatusCfdi', () => {
  it('acepta exactamente el dominio del CHECK de la 0231', () => {
    for (const e of ['casado', 'disponible', 'ambiguo', 'ignorado']) expect(esEstatusCfdi(e)).toBe(true);
    for (const e of ['CASADO', 'pendiente', '', null, 7]) expect(esEstatusCfdi(e)).toBe(false);
  });
});

describe('buscarGastosParaLigar — un buscador, no una lista de todo', () => {
  it('solo ofrece gastos SIN comprobante, de la flota de la sesión', async () => {
    respuestas.gasto = { data: [], error: null, count: null };
    await buscarGastosParaLigar(TENANT, {});
    const o = ops('gasto');
    expect(o).toContainEqual({ op: 'eq', args: ['tenant_id', TENANT] });
    expect(o).toContainEqual({ op: 'is', args: ['cfdi_uuid', null] });
  });

  it('el `.limit()` va SIEMPRE con `.order()` — si no, la lista es una muestra al azar', async () => {
    respuestas.gasto = { data: [], error: null, count: null };
    await buscarGastosParaLigar(TENANT, {});
    const o = ops('gasto');
    const iLimit = o.findIndex((x) => x.op === 'limit');
    const ordenes = o.filter((x) => x.op === 'order');
    expect(iLimit).toBeGreaterThan(-1);
    expect(ordenes.map((x) => x.args[0])).toEqual(['fecha', 'id']);
  });

  it('acota el importe con tolerancia de centavos, no con igualdad exacta', async () => {
    respuestas.gasto = { data: [], error: null, count: null };
    await buscarGastosParaLigar(TENANT, { importe: 300 });
    const o = ops('gasto');
    expect(o).toContainEqual({ op: 'gte', args: ['monto', 299] });
    expect(o).toContainEqual({ op: 'lte', args: ['monto', 301] });
  });

  it('declara la lista recortada cuando había más de los que caben', async () => {
    respuestas.gasto = {
      data: Array.from({ length: MAX_BUSQUEDA_GASTOS + 1 }, (_, i) => ({
        id: `g-${i}`, monto: '100.00', fecha: '2026-08-01', concepto: 'caseta', rfc_emisor: null, folio: null,
      })),
      error: null, count: null,
    };
    const r = await buscarGastosParaLigar(TENANT, {});
    expect(r.truncada).toBe(true);
    expect(r.gastos).toHaveLength(MAX_BUSQUEDA_GASTOS);
  });

  it('una búsqueda caída devuelve error — no "no hay ningún gasto que corresponda"', async () => {
    respuestas.gasto = { data: null, error: { message: 'timeout' }, count: null };
    const r = await buscarGastosParaLigar(TENANT, {});
    expect(r.error).toBe('timeout');
    expect(r.gastos).toEqual([]);
  });

  it('el texto libre no se cuela crudo al filtro `or`', async () => {
    // La sintaxis de `or` de PostgREST usa `,` como separador y `%` como
    // comodín: un texto que los traiga partiría el filtro en condiciones que
    // nadie escribió. Se limpian ANTES de interpolarlos, así que en la cadena
    // final solo pueden quedar los que arma el propio filtro: una coma (la que
    // separa las dos condiciones) y cuatro `%` (dos comodines por condición).
    respuestas.gasto = { data: [], error: null, count: null };
    await buscarGastosParaLigar(TENANT, { texto: 'A-1,2)(%3' });
    const or = String(ops('gasto').find((x) => x.op === 'or')!.args[0]);
    expect(or.split(',')).toHaveLength(2);
    expect(or.split('%')).toHaveLength(5);
    expect(or).not.toMatch(/[()]/);
  });
});
