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

type Resp = { count: number | null; error: { message: string } | null };

/** Responde por (tabla + filtros aplicados). Cada prueba lo programa. */
let responder: (tabla: string, filtros: string[]) => Resp;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from(tabla: string) {
      const filtros: string[] = [];
      const cadena = {
        select: () => cadena,
        eq: (c: string, v: unknown) => { filtros.push(`eq:${c}=${String(v)}`); return cadena; },
        neq: (c: string, v: unknown) => { filtros.push(`neq:${c}=${String(v)}`); return cadena; },
        not: (c: string, op: string, v: unknown) => { filtros.push(`not:${c}:${op}:${String(v)}`); return cadena; },
        is: (c: string, v: unknown) => { filtros.push(`is:${c}=${String(v)}`); return cadena; },
        then: (res: (r: Resp) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve().then(() => responder(tabla, filtros)).then(res, rej),
      };
      return cadena;
    },
  }),
}));

const { getSenalesPmf, agregarSenalesPmf } = await import('./pmf');

/** Un respondedor con los conteos de una flota "normal", para partir de ahí. */
function conteos(v: {
  liquidaciones?: number; descargadas?: number; porCliente?: number;
  liquidados?: number; sinRecordatorio?: number;
  tickets?: number; delCliente?: number;
}): (tabla: string, filtros: string[]) => Resp {
  return (tabla, filtros) => {
    const f = filtros.join('|');
    if (tabla === 'liquidacion') {
      if (f.includes('neq:primera_descarga_rol')) return { count: v.porCliente ?? 0, error: null };
      if (f.includes('not:primera_descarga_en')) return { count: v.descargadas ?? 0, error: null };
      return { count: v.liquidaciones ?? 0, error: null };
    }
    if (tabla === 'viaje') {
      if (f.includes('is:recordatorio_comprobacion_en')) return { count: v.sinRecordatorio ?? 0, error: null };
      return { count: v.liquidados ?? 0, error: null };
    }
    if (tabla === 'ticket_soporte') {
      if (f.includes('not:abierto_por')) return { count: v.delCliente ?? 0, error: null };
      return { count: v.tickets ?? 0, error: null };
    }
    throw new Error(`tabla inesperada: ${tabla}`);
  };
}

beforeEach(() => {
  responder = conteos({});
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
    responder = (tabla) => tabla === 'viaje'
      ? { count: null, error: { message: 'fetch failed' } }
      : { count: 0, error: null };
    await expect(getSenalesPmf('t-1')).rejects.toThrow(/senalesPmf\..*fetch failed/);
  });

  it('un count nulo SIN error tampoco se lee como cero: PostgREST solo manda el conteo si pudo contar', async () => {
    responder = (tabla, filtros) => tabla === 'liquidacion' && filtros.length === 1
      ? { count: null, error: null }
      : { count: 0, error: null };
    await expect(getSenalesPmf('t-1')).rejects.toThrow(/no se inventa un 0/);
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
