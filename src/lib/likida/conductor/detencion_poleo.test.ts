import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));

const { detencionElegible, puedeEscribirAlChofer, requisitoDeMuestras, poleoEfectivoMin, POLEO_CONSERVADOR_MIN, clavesPoleoDe, lapsoMaxCompuertaMin } = await import('./compuerta_movimiento');
const { validarCambioConfig } = await import('./lectura');
const { guardarConfigConductor } = await import('./repo');
const { evaluarSenal } = await import('./senal_vida');
const { evaluarCompuertaDeViajes } = await import('./ejecutor');
const { CONFIG_CONDUCTOR_DEFAULT, validarConfigConductor } = await import('./config');
type Muestra = import('./ciclo_gps').MuestraGps;

// T-A5-37 — todo sintético: coordenadas inventadas. Dos cadencias en la MISMA tabla de pruebas.
const LAT = 20.7;
const LNG = -103.4;
const grados = (m: number): number => m / 111_195;
const AHORA = new Date('2026-10-02T14:30:00.000Z');
const haceMin = (min: number): Date => new Date(AHORA.getTime() - min * 60_000);
const M = (min: number, desplazaM = 0): Muestra => ({ lat: LAT + grados(desplazaM), lng: LNG, medidaEn: haceMin(min) });
/** Muestras cada `paso` min, de hace `hasta` min hasta ahora, con el desplazamiento de cada una. */
const cadencia = (paso: number, hasta: number, desplazaM: (i: number) => number = () => 0): Muestra[] => {
  const salida: Muestra[] = [];
  for (let i = 0, t = hasta; t >= 0; i += 1, t -= paso) salida.push(M(t, desplazaM(i)));
  return salida;
};

const CADENCIAS = [
  { nombre: 'plataforma rápida (~2 min)', paso: 2, claves: { poleoPorClaveMin: { rapida: 2 } }, clave: 'rapida' },
  { nombre: 'plataforma lenta (~15 min)', paso: 15, claves: { poleoPorClaveMin: { lenta: 15 } }, clave: 'lenta' },
] as const;

describe('detencionElegible — ambas cadencias en la misma tabla', () => {
  for (const c of CADENCIAS) {
    describe(c.nombre, () => {
      const base = { sitioDelViaje: null, ahora: AHORA, clavesPoleo: [c.clave] };
      const config = { ...c.claves, detenidoAvisoMin: 15 };

      it('estacionaria durante detenidoAvisoMin → alerta elegible', () => {
        const r = detencionElegible({ ...base, config, posiciones: cadencia(c.paso, 30) });
        expect(r).toEqual({ elegible: true, razon: 'detenida' });
      });
      it('posiciones dispersas → 0 alertas (movimiento, no detención)', () => {
        const r = detencionElegible({ ...base, config, posiciones: cadencia(c.paso, 30, (i) => i * 400) });
        expect(r).toEqual({ elegible: false, razon: 'en_movimiento' });
      });
      it('antes de cumplir detenidoAvisoMin NO es elegible (el lapso corto no se confunde con detención)', () => {
        const r = detencionElegible({ ...base, config: { ...config, detenidoAvisoMin: 60 }, posiciones: cadencia(c.paso, 20) });
        expect(r.elegible).toBe(false);
      });
      it('sin muestras o con la última demasiado vieja → no (falla cerrado)', () => {
        expect(detencionElegible({ ...base, config, posiciones: [] }).razon).toBe('sin_gps');
        expect(detencionElegible({ ...base, config, posiciones: [M(300), M(299)] }).razon).toBe('sin_gps');
      });
    });
  }

  it('con poleo lento, tres posiciones dispersas cada 15 min → 0 alertas de detención', () => {
    const r = detencionElegible({ posiciones: [M(30, 0), M(15, 500), M(0, 1200)], sitioDelViaje: null, config: { poleoMin: 15 }, ahora: AHORA });
    expect(r.elegible).toBe(false);
  });
  it('poleo lento: dos muestras quietas separadas 15 min alcanzan; una sola no', () => {
    expect(detencionElegible({ posiciones: [M(15), M(0)], sitioDelViaje: null, config: { poleoMin: 15 }, ahora: AHORA }).elegible).toBe(true);
    expect(detencionElegible({ posiciones: [M(0)], sitioDelViaje: null, config: { poleoMin: 15 }, ahora: AHORA })).toEqual({ elegible: false, razon: 'pocas_muestras' });
  });
  it('poleo rápido: dos muestras no bastan (se piden tres)', () => {
    expect(detencionElegible({ posiciones: [M(16), M(0)], sitioDelViaje: null, config: { poleoMin: 2 }, ahora: AHORA })).toEqual({ elegible: false, razon: 'pocas_muestras' });
  });
  it('sin poleo configurado rige la cadencia conservadora (la lenta)', () => {
    expect(POLEO_CONSERVADOR_MIN).toBe(15);
    expect(detencionElegible({ posiciones: [M(15), M(0)], sitioDelViaje: null, config: {}, ahora: AHORA }).elegible).toBe(true);
  });
  it('dentro de un sitio del viaje no es una detención por avisar', () => {
    const sitio = { id: 's', nombre: 's', lat: LAT, lng: LNG, radioM: 500 };
    const r = detencionElegible({ posiciones: cadencia(2, 30), sitioDelViaje: { origen: sitio, destino: null }, config: { poleoMin: 2 }, ahora: AHORA });
    expect(r).toEqual({ elegible: false, razon: 'dentro_del_sitio' });
  });
  it('velocidad de marcha reportada por el proveedor → no', () => {
    const r = detencionElegible({ posiciones: cadencia(2, 30), sitioDelViaje: null, config: { poleoMin: 2 }, ahora: AHORA, senalExtra: { velocidadKmh: 40 } });
    expect(r).toEqual({ elegible: false, razon: 'conduciendo' });
  });
  it('reloj inválido o fuera de rango en la config: usa el valor de partida, no truena', () => {
    const r = detencionElegible({ posiciones: cadencia(2, 30), sitioDelViaje: null, config: { poleoMin: 2, detenidoAvisoMin: 3 }, ahora: AHORA });
    expect(r.elegible).toBe(true); // 3 está fuera de 5–720: se usa el de partida (15)
    expect(detencionElegible({ posiciones: cadencia(2, 30), sitioDelViaje: null, config: {}, ahora: new Date('x') }).razon).toBe('sin_gps');
  });
});

describe('poleo en la compuerta (T-A5-36 no cambia sin poleoMin)', () => {
  const ON = { compuertaMovimientoActiva: true } as const;
  it('sin poleoMin: la regla de siempre (3 muestras en 5 min)', () => {
    expect(requisitoDeMuestras(undefined, 5)).toEqual({ muestras: 3, lapsoMin: 5 });
    expect(puedeEscribirAlChofer({ posiciones: [M(4), M(2), M(0)], sitioDelViaje: null, config: ON, ahora: AHORA }).razon).toBe('detenida');
    expect(puedeEscribirAlChofer({ posiciones: [M(15), M(0)], sitioDelViaje: null, config: ON, ahora: AHORA }).razon).toBe('pocas_muestras');
  });
  it('con poleoMin=15: dos muestras separadas por el lapso mayor ya prueban quietud', () => {
    expect(requisitoDeMuestras(15, 5)).toEqual({ muestras: 2, lapsoMin: 30 });
    expect(puedeEscribirAlChofer({ posiciones: [M(15), M(0)], sitioDelViaje: null, config: { ...ON, poleoMin: 15 }, ahora: AHORA }).razon).toBe('detenida');
    // …y dos muestras NO son quietud si una cayó lejos de la otra (movimiento entre dos sondeos lentos)
    expect(puedeEscribirAlChofer({ posiciones: [M(15, 900), M(0)], sitioDelViaje: null, config: { ...ON, poleoMin: 15 }, ahora: AHORA }).razon).toBe('en_movimiento');
  });
  it('con poleoMin=2: tres muestras y un lapso que nunca baja de lo que tardan en llegar', () => {
    expect(requisitoDeMuestras(2, 5)).toEqual({ muestras: 3, lapsoMin: 6 });
  });
  it('la cadencia de una clave manda sobre la de la flota', () => {
    const cfg = { poleoMin: 15, poleoPorClaveMin: { rapida: 2 } };
    expect(poleoEfectivoMin(cfg, 'rapida')).toBe(2);
    expect(poleoEfectivoMin(cfg, 'otra')).toBe(15);
    expect(poleoEfectivoMin({}, 'otra')).toBeUndefined();
  });
});

describe('poleo en la señal de vida (gps_detenido)', () => {
  const sitios = { origen: null, destino: null };
  const evaluar = (muestras: Muestra[], config: Parameters<typeof evaluarSenal>[0]['config']) =>
    evaluarSenal({ muestras, ultimaMuestraEn: null, sitios, toleranciaM: 150, ahora: AHORA, config });
  it('sin poleo: igual que antes (tres muestras quietas que cubren la hora)', () => {
    expect(evaluar([M(60), M(30), M(0)], undefined).estado).toBe('gps_detenido');
    expect(evaluar([M(60), M(0)], undefined).estado).toBe('ok');
  });
  it('con poleo lento y una ventana mayor que el poleo siguen pidiéndose tres muestras; con poleo ≥ ventana bastan dos', () => {
    expect(evaluar([M(60), M(0)], { detenidoMin: 60, poleoMin: 15 }).estado).toBe('ok');
    expect(evaluar([M(60), M(30), M(0)], { detenidoMin: 60, poleoMin: 15 }).estado).toBe('gps_detenido');
    expect(evaluar([M(10), M(0)], { detenidoMin: 10, poleoMin: 15 }).estado).toBe('gps_detenido');
  });
  it('con poleo lento y posiciones dispersas: nunca gps_detenido', () => {
    expect(evaluar([M(60, 0), M(45, 600), M(30, 1500), M(0, 2500)], { detenidoMin: 60, poleoMin: 15 }).estado).toBe('ok');
  });
  it('con poleo rápido la cobertura exigida se acorta a ese poleo', () => {
    // la primera muestra llega 10 min después de abrirse la ventana: con poleo 2 la ventana no está cubierta; con 15 (legado) sí
    const m = [M(50), M(25), M(0)];
    expect(evaluar(m, { detenidoMin: 60, poleoMin: 2 }).estado).toBe('ok');
    expect(evaluar(m, { detenidoMin: 60, poleoMin: 15 }).estado).toBe('gps_detenido');
  });
});

describe('configuración: detenidoAvisoMin y poleo', () => {
  it('el valor de partida es 15 y poleoMin no se inventa', () => {
    expect(CONFIG_CONDUCTOR_DEFAULT.detenidoAvisoMin).toBe(15);
    expect(CONFIG_CONDUCTOR_DEFAULT.poleoMin).toBeUndefined();
  });
  it('detenidoAvisoMin acepta 5 y 720; 4, 721, 1.5 y texto se rechazan', () => {
    for (const ok of [5, 15, 720]) expect('ok' in validarConfigConductor({ detenidoAvisoMin: ok }), String(ok)).toBe(true);
    for (const mal of [4, 721, 1.5, 'abc', 0, -1]) expect('error' in validarConfigConductor({ detenidoAvisoMin: mal as never }), String(mal)).toBe(true);
  });
  it('poleoMin acepta 1–60 y la cadencia por clave también; fuera de rango se rechaza', () => {
    const v = validarConfigConductor({ poleoMin: 15, poleoPorClaveMin: { rapida: 2, lenta: 15 } });
    if (!('ok' in v)) throw new Error(v.error);
    expect(v.ok.poleoMin).toBe(15);
    expect(v.ok.poleoPorClaveMin).toEqual({ rapida: 2, lenta: 15 });
    for (const mal of [0, 61, 2.5, 'x']) expect('error' in validarConfigConductor({ poleoMin: mal as never }), String(mal)).toBe(true);
    expect('error' in validarConfigConductor({ poleoPorClaveMin: { x: 0 } })).toBe(true);
    expect('error' in validarConfigConductor({ poleoPorClaveMin: { '': 5 } })).toBe(true);
    expect('error' in validarConfigConductor({ poleoPorClaveMin: [5] as never })).toBe(true);
  });
  it('una config sin poleo se valida igual que antes (sin llaves nuevas de poleo)', () => {
    const v = validarConfigConductor({});
    if (!('ok' in v)) throw new Error(v.error);
    expect('poleoMin' in v.ok).toBe(false);
    expect(v.ok.detenidoAvisoMin).toBe(15);
  });
});

describe('ningún valor de minutos de poleo/detención queda codificado en la lógica', () => {
  const dir = __dirname;
  for (const archivo of ['compuerta_movimiento.ts', 'senal_vida.ts']) {
    it(`${archivo}: sin «15 * 60_000» ni «2 * 60_000» literales`, () => {
      const fuente = readFileSync(join(dir, archivo), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/**')).join('\n');
      expect(fuente).not.toMatch(/\b(2|15)\s*\*\s*60_?000/);
      expect(fuente).not.toMatch(/(poleo\w*|detenidoAviso\w*)\s*(=|===|>=|<=)\s*(2|15)\b(?!\s*\*)/);
    });
  }
});

describe('cableado: el ejecutor lee del GPS el lapso que exige la cadencia (T-A5-37)', () => {
  const viaje = { id: 'v1', tenantId: 't1', unidadId: 'u1' } as never;
  async function ventanaLeida(config: Record<string, unknown>): Promise<number> {
    let desde = new Date(0);
    await evaluarCompuertaDeViajes(
      { muestrasUnidad: async (_u, d) => { desde = d; return new Map(); }, sitiosDe: async () => new Map() },
      [viaje], new Map([['t1', { ...CONFIG_CONDUCTOR_DEFAULT, compuertaMovimientoActiva: true, ...config } as never]]), AHORA,
    );
    return Math.round((AHORA.getTime() - desde.getTime()) / 60_000);
  }
  it('sin poleo: la ventana de siempre + 5 min (T-A5-36 intacta)', async () => {
    expect(await ventanaLeida({})).toBe((CONFIG_CONDUCTOR_DEFAULT.detenidaVentanaMin ?? 5) + 5);
  });
  it('con poleoMin=15 la lectura cubre poleo × muestras + 5 min, no solo la ventana corta', async () => {
    const { lapsoMin } = requisitoDeMuestras(15, CONFIG_CONDUCTOR_DEFAULT.detenidaVentanaMin ?? 5);
    expect(lapsoMin).toBeGreaterThan((CONFIG_CONDUCTOR_DEFAULT.detenidaVentanaMin ?? 5) + 5);
    expect(await ventanaLeida({ poleoMin: 15 })).toBe(lapsoMin + 5);
  });
});

describe('cableado: la cadencia POR PROVEEDOR llega a la compuerta (T-A5-37, ajuste 16-oct)', () => {
  const viaje = { id: 'v1', tenantId: 't1', unidadId: 'u1' } as never;
  const conProveedor = (m: Muestra[], proveedor: string): Muestra[] => m.map((x) => ({ ...x, proveedor }));
  const evaluar = async (muestras: Muestra[], config: Record<string, unknown>) => {
    const r = await evaluarCompuertaDeViajes(
      { muestrasUnidad: async () => new Map([['t1|u1', muestras]]), sitiosDe: async () => new Map() },
      [viaje], new Map([['t1', { ...CONFIG_CONDUCTOR_DEFAULT, compuertaMovimientoActiva: true, ...config } as never]]), AHORA,
    );
    return r.get('v1');
  };
  // Dos muestras quietas separadas 15 min: con cadencia lenta alcanzan (2 muestras); con la regla de T-A5-36 no (3).
  const dosLentas = [M(15), M(0)];

  it('clavesPoleoDe: unidad primero y luego el proveedor de la muestra más reciente', () => {
    expect(clavesPoleoDe('u1', [{ medidaEn: haceMin(9), proveedor: 'a' }, { medidaEn: haceMin(1), proveedor: 'b' }, { medidaEn: haceMin(5) }])).toEqual(['u1', 'b']);
    expect(clavesPoleoDe(null, [])).toEqual([]);
  });
  it('el proveedor lento configurado por clave habilita 2 muestras; sin esa clave rige T-A5-36 (pocas_muestras)', async () => {
    const config = { detenidaVentanaMin: 5, poleoPorClaveMin: { lenta: 15 } };
    expect((await evaluar(conProveedor(dosLentas, 'lenta'), config))?.permitido).toBe(true);
    expect((await evaluar(conProveedor(dosLentas, 'otro'), config))).toEqual({ permitido: false, razon: 'pocas_muestras' });
  });
  it('puedeEscribirAlChofer acepta clavesPoleo directo (misma regla)', () => {
    const e = { posiciones: dosLentas, sitioDelViaje: null, ahora: AHORA, config: { compuertaMovimientoActiva: true, poleoPorClaveMin: { u1: 15 } } };
    expect(puedeEscribirAlChofer({ ...e, clavesPoleo: ['u1'] }).permitido).toBe(true);
    expect(puedeEscribirAlChofer(e).permitido).toBe(false);
  });
  it('la lectura del GPS cubre la cadencia MÁS lenta configurada por clave', async () => {
    expect(lapsoMaxCompuertaMin({ detenidaVentanaMin: 5, poleoPorClaveMin: { rapida: 2, lenta: 15 } })).toBe(requisitoDeMuestras(15, 5).lapsoMin);
    let desde = new Date(0);
    await evaluarCompuertaDeViajes(
      { muestrasUnidad: async (_u, d) => { desde = d; return new Map(); }, sitiosDe: async () => new Map() },
      [viaje], new Map([['t1', { ...CONFIG_CONDUCTOR_DEFAULT, compuertaMovimientoActiva: true, poleoPorClaveMin: { lenta: 15 } } as never]]), AHORA,
    );
    expect(Math.round((AHORA.getTime() - desde.getTime()) / 60_000)).toBe(requisitoDeMuestras(15, 5).lapsoMin + 5);
  });
  it('la señal de vida usa la cadencia del proveedor (clavesPoleo en evaluarSenal)', () => {
    const base = { muestras: [M(8), M(0)], ultimaMuestraEn: null, sitios: { origen: null, destino: null }, toleranciaM: 150, ahora: AHORA };
    const lenta = evaluarSenal({ ...base, config: { detenidoMin: 10, poleoPorClaveMin: { lenta: 15 } }, clavesPoleo: ['lenta'] });
    const sin = evaluarSenal({ ...base, config: { detenidoMin: 10, poleoPorClaveMin: { lenta: 15 } }, clavesPoleo: ['otro'] });
    expect(lenta.estado).toBe('gps_detenido');
    expect(sin.estado).not.toBe('gps_detenido');
  });
});

describe('configurable por el PUT de la flota (LLAVES_CONFIG, T-A5-37 y lección de T-A5-36)', () => {
  const ok = (c: Record<string, unknown>) => validarCambioConfig(c, { ...CONFIG_CONDUCTOR_DEFAULT });
  it('acepta detenidoAvisoMin, poleoMin, poleoPorClaveMin, detenidaVentanaMin y detenidaMetros', () => {
    const v = ok({ detenidoAvisoMin: 20, poleoMin: 15, poleoPorClaveMin: { lenta: 15, rapida: 2 }, detenidaVentanaMin: 10, detenidaMetros: 200 });
    if (!('ok' in v)) throw new Error(v.error);
    expect(v.ok.config).toMatchObject({ detenidoAvisoMin: 20, poleoMin: 15, poleoPorClaveMin: { lenta: 15, rapida: 2 }, detenidaVentanaMin: 10, detenidaMetros: 200 });
  });
  it('rechaza fuera de rango (4 y 721 en detenidoAvisoMin, 0 y 61 en poleoMin)', () => {
    for (const c of [{ detenidoAvisoMin: 4 }, { detenidoAvisoMin: 721 }, { poleoMin: 0 }, { poleoMin: 61 }, { detenidaVentanaMin: 0 }]) {
      expect('error' in ok(c), JSON.stringify(c)).toBe(true);
    }
  });
});

describe('persistencia honesta: sin columna no se pierde en silencio', () => {
  it('guardar una cadencia o un umbral distinto del default dice que falta la migración (no toca la base)', async () => {
    for (const c of [{ poleoMin: 15 }, { poleoPorClaveMin: { lenta: 15 } }, { detenidoAvisoMin: 20 }]) {  // detenidaVentanaMin/detenidaMetros ya tienen columna desde la 0870 (A37-P-08)
      await expect(guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT, ...c } as never, undefined), JSON.stringify(c)).rejects.toThrow(/migración pendiente/);
    }
  });
  it('con los defaults NO lanza por esto (llega a la base, que esta prueba no tiene)', async () => {
    await expect(guardarConfigConductor('t1', { ...CONFIG_CONDUCTOR_DEFAULT } as never, undefined)).rejects.toThrow(/esta prueba no toca la base/);
  });
});
