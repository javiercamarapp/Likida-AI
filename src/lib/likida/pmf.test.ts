import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL LECTOR DE LAS 3 SEÑALES DE PMF (mig. 0114) — las tres reglas que no se
// pueden romper, cada una con la prueba que se rompe si alguien la rompe:
//
//   1. Sin datos se dice "sin datos" (`medida: false`), nunca un 0 con cara
//      de medición.
//   2. Un demo de Javier (`primera_descarga_rol = 'superadmin'`) NO cuenta
//      como señal de PMF — la señal real es un rol del cliente.
//   3. Fallar cerrado: un error de lectura LANZA; jamás se degrada a "cero".
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data: unknown; error: { message: string } | null };

/** Lo que devuelve `senales_pmf(p_tenant)`. Cada prueba lo programa. */
let responder: (p_tenant: string | null) => Resp;
/** Los argumentos con los que se llamó al RPC — para probar que va UNA vez. */
let llamadas: Array<{ fn: string; args: unknown }>;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc(fn: string, args: { p_tenant: string | null }) {
      llamadas.push({ fn, args });
      return {
        then: (res: (r: Resp) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve().then(() => responder(args.p_tenant)).then(res, rej),
      };
    },
  }),
}));

const { getSenalesPmf, getSenalesPmfTodas, agregarSenalesPmf } = await import('./pmf');

/** Una fila de la RPC: los siete conteos de una flota, con ceros por default. */
function fila(tenantId: string, v: {
  liquidaciones?: number; descargadas?: number; porCliente?: number;
  liquidados?: number; sinRecordatorio?: number;
  tickets?: number; delCliente?: number;
} = {}) {
  return {
    tenantId,
    liquidaciones: v.liquidaciones ?? 0,
    descargadas: v.descargadas ?? 0,
    porCliente: v.porCliente ?? 0,
    liquidados: v.liquidados ?? 0,
    sinRecordatorio: v.sinRecordatorio ?? 0,
    tickets: v.tickets ?? 0,
    delCliente: v.delCliente ?? 0,
  };
}

/** El respondedor de una sola flota `t-1` con esos conteos. */
function conteos(v: Parameters<typeof fila>[1]): (p: string | null) => Resp {
  return () => ({ data: [fila('t-1', v)], error: null });
}

beforeEach(() => {
  llamadas = [];
  responder = conteos({});
});

describe('ESC-9 · las siete lecturas son UNA sola consulta', () => {
  it('una flota: un solo rpc, con su p_tenant — no siete count exact', async () => {
    responder = conteos({ liquidaciones: 2 });
    await getSenalesPmf('t-1');
    expect(llamadas).toEqual([{ fn: 'senales_pmf', args: { p_tenant: 't-1' } }]);
  });

  it('todas las flotas: un solo rpc con p_tenant en null, no uno por flota', async () => {
    responder = () => ({
      data: [fila('t-1', { liquidaciones: 4, descargadas: 2, porCliente: 2 }), fila('t-2', { tickets: 1 })],
      error: null,
    });
    const m = await getSenalesPmfTodas();
    expect(llamadas).toEqual([{ fn: 'senales_pmf', args: { p_tenant: null } }]);
    expect(m.get('t-1')!.descargas).toEqual({ medida: true, liquidaciones: 4, descargadas: 2, porCliente: 2, soloDemo: 0 });
    expect(m.get('t-2')!.tickets).toEqual({ medida: true, delCliente: 0, deLikida: 1 });
    // La flota que la RPC no devuelve NO está en el mapa: el llamador la lee
    // como "sin datos", que es distinto de "no se pudo leer".
    expect(m.has('t-3')).toBe(false);
  });

  it('una flota que la RPC no devuelve (ni una fila en las tres tablas) sale SIN DATOS, no en ceros', async () => {
    responder = () => ({ data: [], error: null });
    const s = await getSenalesPmf('t-1');
    expect(s.descargas.medida).toBe(false);
    expect(s.comprobacionSola.medida).toBe(false);
    expect(s.tickets.medida).toBe(false);
  });
});

describe('sin datos se dice "sin datos", nunca un cero con cara de medición', () => {
  it('una flota sin liquidaciones, sin viajes cerrados y sin tickets: las TRES señales salen sin medir', async () => {
    const s = await getSenalesPmf('t-1');
    expect(s.descargas.medida).toBe(false);
    expect(s.comprobacionSola.medida).toBe(false);
    expect(s.tickets.medida).toBe(false);
    // Y no hay NINGÚN número que un llamador pueda pintar como 0%:
    expect('porCliente' in s.descargas).toBe(false);
    expect('sinRecordatorio' in s.comprobacionSola).toBe(false);
  });

  it('con liquidaciones pero cero descargas, la señal SÍ está medida (el cero es real, contado)', async () => {
    responder = conteos({ liquidaciones: 4 });
    const s = await getSenalesPmf('t-1');
    expect(s.descargas).toEqual({ medida: true, liquidaciones: 4, descargadas: 0, porCliente: 0, soloDemo: 0 });
  });
});

describe('un demo de Javier no es señal de PMF', () => {
  it("descargas solo de 'superadmin': porCliente queda en 0 y soloDemo las cuenta", async () => {
    responder = conteos({ liquidaciones: 5, descargadas: 3, porCliente: 0 });
    const s = await getSenalesPmf('t-1');
    expect(s.descargas).toEqual({ medida: true, liquidaciones: 5, descargadas: 3, porCliente: 0, soloDemo: 3 });
  });

  it('una descarga de un rol del cliente SÍ es la señal, y el demo se separa', async () => {
    responder = conteos({ liquidaciones: 5, descargadas: 3, porCliente: 1 });
    const s = await getSenalesPmf('t-1');
    expect(s.descargas).toEqual({ medida: true, liquidaciones: 5, descargadas: 3, porCliente: 1, soloDemo: 2 });
  });
});

describe('las otras dos señales leen columnas que ya existían', () => {
  it('viajes liquidados sin recordatorio: el chofer comprobó solo', async () => {
    responder = conteos({ liquidados: 8, sinRecordatorio: 6 });
    const s = await getSenalesPmf('t-1');
    expect(s.comprobacionSola).toEqual({ medida: true, liquidados: 8, sinRecordatorio: 6 });
  });

  it('tickets: abierto_por no nulo es del cliente; NULL es de Likida (0051)', async () => {
    responder = conteos({ tickets: 3, delCliente: 1 });
    const s = await getSenalesPmf('t-1');
    expect(s.tickets).toEqual({ medida: true, delCliente: 1, deLikida: 2 });
  });
});

describe('fallar cerrado: un error de lectura LANZA, no pinta ceros', () => {
  it('con la base reportando error POR VALOR, la función revienta con la consulta en el mensaje', async () => {
    responder = () => ({ data: null, error: { message: 'fetch failed' } });
    await expect(getSenalesPmf('t-1')).rejects.toThrow(/senales_pmf: fetch failed/);
    await expect(getSenalesPmfTodas()).rejects.toThrow(/senales_pmf: fetch failed/);
  });

  it('una respuesta que no es un arreglo (la 0162 sin aplicar) LANZA: un cero aquí diría "no lo usan"', async () => {
    responder = () => ({ data: null, error: null });
    await expect(getSenalesPmf('t-1')).rejects.toThrow(/0162 sin aplicar/);
  });

  it('una fila sin los siete conteos también LANZA — media señal no se pinta', async () => {
    responder = () => ({ data: [{ tenantId: 't-1', liquidaciones: 3 }], error: null });
    await expect(getSenalesPmf('t-1')).rejects.toThrow(/no trae los siete conteos/);
  });
});

describe('agregarSenalesPmf — el agregado es puro y no fabrica ceros', () => {
  it('suma solo las flotas medidas; las sin datos no aportan', () => {
    const a = agregarSenalesPmf([
      {
        descargas: { medida: true, liquidaciones: 4, descargadas: 2, porCliente: 1, soloDemo: 1 },
        comprobacionSola: { medida: false },
        tickets: { medida: true, delCliente: 1, deLikida: 0 },
      },
      {
        descargas: { medida: true, liquidaciones: 6, descargadas: 1, porCliente: 0, soloDemo: 1 },
        comprobacionSola: { medida: true, liquidados: 3, sinRecordatorio: 3 },
        tickets: { medida: false },
      },
    ]);
    expect(a.descargas).toEqual({ medida: true, liquidaciones: 10, descargadas: 3, porCliente: 1, soloDemo: 2 });
    expect(a.comprobacionSola).toEqual({ medida: true, liquidados: 3, sinRecordatorio: 3 });
    expect(a.tickets).toEqual({ medida: true, delCliente: 1, deLikida: 0 });
  });

  it('con todas las flotas sin datos, el agregado dice sin datos — no un cero', () => {
    const vacia = { descargas: { medida: false as const }, comprobacionSola: { medida: false as const }, tickets: { medida: false as const } };
    const a = agregarSenalesPmf([vacia, vacia]);
    expect(a.descargas.medida).toBe(false);
    expect(a.comprobacionSola.medida).toBe(false);
    expect(a.tickets.medida).toBe(false);
  });

  it('con cero flotas, el agregado es sin datos', () => {
    const a = agregarSenalesPmf([]);
    expect(a.descargas.medida).toBe(false);
  });
});
