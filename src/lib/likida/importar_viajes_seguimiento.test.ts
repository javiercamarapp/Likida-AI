import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FilaViajeImportada } from './importar_viajes';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-04 — «un viaje importado jamás se persigue» (hallazgo crítico 11/x5).
//
// `importarViajes` pasa a «aceptados por importación» los viajes recién creados cuyo operador es voluntario del
// piloto, con la función `aceptar_viajes_importados` de la 0800. Aquí la base es un doble en memoria que obedece
// las MISMAS reglas que esa función (solo abiertos, sin aceptar, de la flota y de un voluntario) y el unique
// `viaje_folio_unico`; las reglas que solo Postgres demuestra viven en supabase/tests/0800_conductor_voluntarios.sql.
// Datos 100 % sintéticos: OPERADOR A..E, folios SIN-0001...
// ═══════════════════════════════════════════════════════════════════════════

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const resolver = vi.fn((nombre: string): { operadorId: string } | null => ({ operadorId: `op-${nombre}` }));
vi.mock('./crear_viaje_wa', () => ({
  elegirOperadorPorNombre: (_filas: unknown, texto: string) => resolver(texto),
  OperadorNombreAmbiguo: class OperadorNombreAmbiguo extends Error {},
}));

interface ViajeBd {
  id: string; tenant_id: string; folio: string; operador_id: string; estatus: string;
  aceptado_en: string | null; avisado_en: string | null; aceptado_origen: string | null;
}

let viajes: ViajeBd[];
let voluntarios: Set<string>;
let modoRpc: 'ok' | 'sin_funcion' | 'fallo';
let llamadasRpc: Array<{ nombre: string; args: Record<string, unknown> }>;
let envios: string[];
let n: number;
/** A37-S46-04: con `choqueEnLote` el INSERT en bloque rebota por unidad (23505) y, fila por fila, `folioQueFalla` rebota por otra causa. */
let choqueEnLote = false;
let folioQueFalla: string | null = null;

const ORDEN_ESQUEMA = 'Could not find the function public.aceptar_viajes_importados(p_tenant, p_viaje_ids) in the schema cache';

function rpc(nombre: string, args: Record<string, unknown> = {}) {
  llamadasRpc.push({ nombre, args });
  if (nombre !== 'aceptar_viajes_importados') return Promise.resolve({ data: null, error: null });
  if (modoRpc === 'sin_funcion') return Promise.resolve({ data: null, error: { code: 'PGRST202', message: ORDEN_ESQUEMA } });
  if (modoRpc === 'fallo') return Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
  const ids = args.p_viaje_ids as string[];
  const ahora = (args.p_ahora as string | undefined) ?? '2026-10-14T18:00:00.000Z';
  const tocados = viajes.filter((v) =>
    ids.includes(v.id) && v.tenant_id === args.p_tenant && v.estatus === 'abierto' && v.aceptado_en === null && voluntarios.has(v.operador_id));
  for (const v of tocados) { v.avisado_en = v.avisado_en ?? ahora; v.aceptado_en = ahora; v.aceptado_origen = 'importacion'; }
  return Promise.resolve({ data: tocados.map((v) => ({ o_id: v.id })), error: null });
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (nombre: string, args?: Record<string, unknown>) => rpc(nombre, args),
    from: (tabla: string) => {
      if (tabla === 'operador' || tabla === 'unidad' || tabla === 'cliente') {
        const nodo: Record<string, unknown> = {};
        for (const m of ['eq', 'not', 'in', 'order', 'abortSignal', 'select']) nodo[m] = () => nodo;
        nodo.range = () => Promise.resolve({ data: [], error: null });
        return nodo;
      }
      return {
        select: () => {
          const nodo: Record<string, unknown> = {};
          let porFolio = false;
          let tenant = '';
          let folios: string[] = [];
          for (const m of ['not', 'order', 'abortSignal']) nodo[m] = () => nodo;
          nodo.eq = (col: string, val: string) => { if (col === 'tenant_id') tenant = val; return nodo; };
          nodo.in = (col: string, val: string[]) => { if (col === 'folio') { porFolio = true; folios = val; } return nodo; };
          nodo.then = (res: (v: unknown) => unknown) => {
            const data = porFolio
              ? viajes.filter((v) => v.tenant_id === tenant && folios.includes(v.folio)).map((v) => ({ folio: v.folio }))
              : viajes.filter((v) => v.tenant_id === tenant && ['abierto', 'en_cuadre'].includes(v.estatus)).map((v) => ({ operador_id: v.operador_id }));
            return Promise.resolve({ data, error: null }).then(res);
          };
          return nodo;
        },
        upsert: (lote: Array<{ tenant_id: string; folio: string; operador_id: string }>) => ({
          select: () => {
            if (choqueEnLote && lote.length > 1) {
              return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_viaje_abierto_por_unidad"' } });
            }
            if (folioQueFalla && lote.some((f) => f.folio === folioQueFalla)) {
              return Promise.resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
            }
            const nuevos: ViajeBd[] = [];
            for (const f of lote) {
              if (viajes.some((v) => v.tenant_id === f.tenant_id && v.folio === f.folio)) continue; // viaje_folio_unico
              const v: ViajeBd = {
                id: `viaje-${++n}`, tenant_id: f.tenant_id, folio: f.folio, operador_id: f.operador_id, estatus: 'abierto',
                aceptado_en: null, avisado_en: null, aceptado_origen: null,
              };
              viajes.push(v); nuevos.push(v);
            }
            return Promise.resolve({ data: nuevos.map((v) => ({ id: v.id, folio: v.folio })), error: null });
          },
        }),
      };
    },
  }),
}));

const { importarViajes } = await import('./importar_viajes');
const { frasesSeguimiento } = await import('./importacion/resultado_ui');
const { crearMundo } = await import('./conductor/mundo.fixture');
const { viajeBase } = await import('./conductor/memoria.fixture');

const LETRAS = ['A', 'B', 'C', 'D', 'E'];
const fila = (folio: string, operador: string): FilaViajeImportada => ({
  folio, origen: 'ORIGEN SINTETICO', destino: 'DESTINO SINTETICO', fechaInicio: '2026-10-14', anticipo: null,
  operadorNombre: operador, unidadEco: null, clienteNombre: null, ingresoFlete: null, kmRecorridos: null,
});
const archivoDeCinco = () => LETRAS.map((l, i) => fila(`SIN-000${i + 1}`, `OPERADOR ${l}`));

beforeEach(() => {
  viajes = [];
  voluntarios = new Set(['op-OPERADOR A', 'op-OPERADOR C']); // 2 voluntarios
  modoRpc = 'ok';
  llamadasRpc = [];
  envios = [];
  n = 0;
  choqueEnLote = false;
  folioQueFalla = null;
  resolver.mockImplementation((nombre: string) => ({ operadorId: `op-${nombre}` }));
  logger.warn.mockClear();
});

describe('importarViajes — seguimiento del agente para los voluntarios del piloto', () => {
  it('5 filas, 2 voluntarios: creados 5, seguimientoActivado 2 y la frase llana lo dice', async () => {
    const r = await importarViajes('t1', archivoDeCinco());
    expect(r.error).toBeUndefined();
    expect(r.creados).toBe(5);
    expect(r.seguimientoActivado).toBe(2);
    expect(r.seguimientoOmitidoSinVoluntario).toBe(3);
    expect(r.seguimientoNoDisponible).toBeUndefined();

    const aceptados = viajes.filter((v) => v.aceptado_en !== null).map((v) => v.folio).sort();
    expect(aceptados).toEqual(['SIN-0001', 'SIN-0003']);
    expect(viajes.filter((v) => v.aceptado_en !== null).every((v) => v.aceptado_origen === 'importacion')).toBe(true);

    expect(frasesSeguimiento(r)).toEqual([
      'Se importaron 5 viajes.',
      '2 quedaron en seguimiento del agente (operadores del piloto).',
      'Los otros 3 no se siguen porque su operador no está en el piloto.',
    ]);
  });

  it('los NO voluntarios quedan intactos: sin aceptado_en y sin avisado_en', async () => {
    await importarViajes('t1', archivoDeCinco());
    for (const v of viajes.filter((x) => !voluntarios.has(x.operador_id))) {
      expect(v.aceptado_en).toBeNull();
      expect(v.avisado_en).toBeNull();
      expect(v.aceptado_origen).toBeNull();
    }
  });

  it('la RPC recibe SOLO el tenant y los ids recién creados, y no se llama a nada más (cero WhatsApp)', async () => {
    await importarViajes('t1', archivoDeCinco());
    const aceptar = llamadasRpc.filter((c) => c.nombre === 'aceptar_viajes_importados');
    expect(aceptar).toHaveLength(1);
    expect(aceptar[0].args.p_tenant).toBe('t1');
    expect([...(aceptar[0].args.p_viaje_ids as string[])].sort()).toEqual(viajes.map((v) => v.id).sort());
    expect(llamadasRpc.every((c) => c.nombre === 'aceptar_viajes_importados')).toBe(true);
    expect(envios).toEqual([]);
  });

  it('dos filas del mismo operador: la segunda cae en operadorOcupado (0029) y no se sigue', async () => {
    const r = await importarViajes('t1', [fila('SIN-0001', 'OPERADOR A'), fila('SIN-0002', 'OPERADOR A'), fila('SIN-0003', 'OPERADOR B')]);
    expect(r.creados).toBe(2);
    expect(r.operadorOcupado).toEqual(['SIN-0002']);
    expect(r.seguimientoActivado).toBe(1);
    expect(r.seguimientoOmitidoSinVoluntario).toBe(1);
    expect(viajes.map((v) => v.folio).sort()).toEqual(['SIN-0001', 'SIN-0003']);
  });

  it('sin la función (migración 0800 sin aplicar): se importa igual, sin seguimiento, y el resultado avisa', async () => {
    modoRpc = 'sin_funcion';
    const r = await importarViajes('t1', archivoDeCinco());
    expect(r.error).toBeUndefined();
    expect(r.creados).toBe(5);
    expect(r.seguimientoActivado).toBe(0);
    expect(r.seguimientoNoDisponible).toBe(true);
    expect(viajes).toHaveLength(5);
    expect(viajes.every((v) => v.aceptado_en === null)).toBe(true); // cerrado para el seguimiento
    expect(frasesSeguimiento(r)).toEqual(['El seguimiento del agente no está disponible todavía: los viajes se importaron igual, sin seguimiento.']);
  });

  it('un fallo cualquiera de la RPC tampoco tumba la importación (falla abierto para el import)', async () => {
    modoRpc = 'fallo';
    const r = await importarViajes('t1', archivoDeCinco());
    expect(r.error).toBeUndefined();
    expect(r.creados).toBe(5);
    expect(r.seguimientoNoDisponible).toBe(true);
    expect(viajes.every((v) => v.aceptado_en === null)).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('reimportar el mismo archivo: creados 0, no se llama a la RPC y aceptado_en no cambia', async () => {
    await importarViajes('t1', archivoDeCinco());
    const antes = JSON.stringify(viajes);
    llamadasRpc = [];
    const r = await importarViajes('t1', archivoDeCinco());
    expect(r.creados).toBe(0);
    expect(r.saltados.sort()).toEqual(['SIN-0001', 'SIN-0002', 'SIN-0003', 'SIN-0004', 'SIN-0005']);
    expect(r.seguimientoActivado).toBeUndefined();
    expect(llamadasRpc).toEqual([]);
    expect(JSON.stringify(viajes)).toBe(antes);
    expect(frasesSeguimiento(r)).toEqual([]);
  });

  it('un viaje que el chofer ya aceptó no se reescribe aunque el id llegue a la RPC', async () => {
    await importarViajes('t1', [fila('SIN-0001', 'OPERADOR A')]);
    const v = viajes[0];
    v.aceptado_en = '2026-10-14T10:00:00.000Z'; v.aceptado_origen = 'chofer';
    const r = await rpc('aceptar_viajes_importados', { p_tenant: 't1', p_viaje_ids: [v.id] });
    expect(r.data).toEqual([]);
    expect(v.aceptado_en).toBe('2026-10-14T10:00:00.000Z');
    expect(v.aceptado_origen).toBe('chofer');
  });
});

describe('el mundo en memoria del Conductor: el viaje importado de un voluntario entra a viajesActivos', () => {
  it('el de un voluntario se persigue; el de un no voluntario no', async () => {
    await importarViajes('t1', archivoDeCinco());
    const ctx = viajes.map((v) => viajeBase({
      id: v.id, tenantId: v.tenant_id, folio: v.folio, estatus: v.estatus, operadorId: v.operador_id,
      operadorNombre: v.operador_id, aceptadoEn: v.aceptado_en,
    }));
    const mundo = crearMundo({ viajes: ctx, enviar: async () => { envios.push('whatsapp'); return { ok: true } as never; } });
    const activos = await mundo.puertos.viajesActivos(100);
    expect(activos.map((v) => v.folio).sort()).toEqual(['SIN-0001', 'SIN-0003']);
    expect(activos.map((v) => v.folio)).not.toContain('SIN-0002');
    expect(envios).toEqual([]);
  });

  it('con el seguimiento no disponible ningún importado entra (cerrado)', async () => {
    modoRpc = 'sin_funcion';
    await importarViajes('t1', archivoDeCinco());
    const ctx = viajes.map((v) => viajeBase({ id: v.id, folio: v.folio, operadorId: v.operador_id, aceptadoEn: v.aceptado_en }));
    const mundo = crearMundo({ viajes: ctx, enviar: async () => ({ ok: true }) as never });
    expect(await mundo.puertos.viajesActivos(100)).toEqual([]);
  });
});

describe('frasesSeguimiento — lenguaje llano', () => {
  it('singular y ninguno activado', () => {
    expect(frasesSeguimiento({ creados: 1, seguimientoActivado: 1, seguimientoOmitidoSinVoluntario: 0 }))
      .toEqual(['Se importaron 1 viaje.', '1 quedó en seguimiento del agente (operadores del piloto).']);
    expect(frasesSeguimiento({ creados: 4, seguimientoActivado: 0, seguimientoOmitidoSinVoluntario: 4 }))
      .toEqual(['Se importaron 4 viajes.', 'Ninguno quedó en seguimiento del agente.', 'Los 4 no se siguen porque su operador no está en el piloto.']);
  });
  it('sin intento de seguimiento no hay frase', () => {
    expect(frasesSeguimiento({ creados: 0 })).toEqual([]);
  });
});

describe('A37-S46-04 — filas que entraron fila por fila cuentan aunque otra falle', () => {
  it('fila 1-2 entran, la 3 falla por otra causa: se cuentan y la voluntaria queda en seguimiento', async () => {
    choqueEnLote = true;
    folioQueFalla = 'SIN-0003';
    const r = await importarViajes('t1', [fila('SIN-0001', 'OPERADOR A'), fila('SIN-0002', 'OPERADOR B'), fila('SIN-0003', 'OPERADOR C')]);
    expect(viajes.map((v) => v.folio)).toEqual(['SIN-0001', 'SIN-0002']);
    expect(r.error).toBeDefined();
    expect(r.creados).toBe(2);
    expect(r.seguimientoActivado).toBe(1);
    expect(viajes.find((v) => v.folio === 'SIN-0001')?.aceptado_en).not.toBeNull();
  });
});
