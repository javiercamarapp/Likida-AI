import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  barridoSitioDerivado, derivarSitio, normalizarNombre, resolverSitio,
  type CandidatoSitio, type LadoViaje, type PuertosSitioDerivado, type SitioCatalogo, type SitioEquivalencia,
} from './sitio_derivado';

// Todo inventado: la FORMA de los textos reales (STOP … FINAL …, VACIO <cliente>, SALIR A RUTA …), ningún nombre real.
const CATALOGO: SitioCatalogo[] = [
  { id: 'p-demo', nombre: 'Planta Demo', codigo: null, clienteId: null },
  { id: 'p-otra', nombre: 'Patio Demo Oriente', codigo: 'PDO', clienteId: null },
];
const eq = (texto: string, sitioId: string | null, tipo: SitioEquivalencia['tipo'] = 'sitio', extra: Partial<SitioEquivalencia> = {}): SitioEquivalencia =>
  ({ texto: normalizarNombre(texto), lado: 'ambos', sitioId, tipo, clienteId: null, ...extra });

describe('derivarSitio con equivalencias (0803)', () => {
  it('«STOP Planta Demo FINAL ACERO» liga a «Planta Demo» por la equivalencia, aunque el texto no sea el nombre exacto', () => {
    const e = [eq('STOP Planta Demo FINAL ACERO', 'p-demo')];
    expect(derivarSitio('STOP Planta Demo FINAL ACERO', CATALOGO, null, 'destino', e)).toEqual({ sitioId: 'p-demo', criterio: 'equivalencia' });
    // el texto se compara NORMALIZADO: acentos, mayúsculas y puntuación no cuentan
    expect(derivarSitio('stop  planta demo, final acéro', CATALOGO, null, 'destino', e)).toEqual({ sitioId: 'p-demo', criterio: 'equivalencia' });
  });

  it('«VACIO Cliente Demo» con tipo ignorar → no hay sitio (null a propósito), y resolverSitio lo distingue de la duda', () => {
    const e = [eq('VACIO Cliente Demo', null, 'ignorar')];
    expect(derivarSitio('VACIO Cliente Demo', CATALOGO, null, 'origen', e)).toBeNull();
    expect(resolverSitio('VACIO Cliente Demo', CATALOGO, null, 'origen', e)).toEqual({ tipo: 'sin_sitio' });
    expect(resolverSitio('Texto que nadie conoce', CATALOGO, null, 'origen', e)).toBeNull(); // duda ≠ instrucción
  });

  it('«SALIR A RUTA ANTES DE LAS 7 PM» → ignorar; sin_sitio se trata igual', () => {
    const e = [eq('SALIR A RUTA ANTES DE LAS 7 PM', null, 'ignorar'), eq('REGRESA SIN CARGA', null, 'sin_sitio')];
    expect(resolverSitio('SALIR A RUTA ANTES DE LAS 7 PM', CATALOGO, null, 'destino', e)).toEqual({ tipo: 'sin_sitio' });
    expect(resolverSitio('Regresa sin carga', CATALOGO, null, 'destino', e)).toEqual({ tipo: 'sin_sitio' });
  });

  it('la instrucción gana al nombre: un texto que contiene un sitio pero la oficina dijo «ignorar» no se liga', () => {
    const e = [eq('VACIO a Planta Demo', null, 'ignorar')];
    expect(resolverSitio('VACIO a Planta Demo', CATALOGO, null, 'destino', e)).toEqual({ tipo: 'sin_sitio' });
  });

  it('sin equivalencia y con nombre exacto → el criterio de siempre', () => {
    const e = [eq('STOP Planta Demo FINAL ACERO', 'p-demo')];
    expect(derivarSitio('Planta Demo', CATALOGO, null, 'origen', e)).toEqual({ sitioId: 'p-demo', criterio: 'nombre_exacto' });
    expect(derivarSitio('Patio Demo Oriente', CATALOGO, null, 'origen', [])).toEqual({ sitioId: 'p-otra', criterio: 'nombre_exacto' });
  });

  it('el lado importa: una equivalencia de origen no aplica al destino', () => {
    const e = [eq('Muelle Uno', 'p-demo', 'sitio', { lado: 'origen' })];
    expect(derivarSitio('Muelle Uno', CATALOGO, null, 'origen', e)?.criterio).toBe('equivalencia');
    expect(derivarSitio('Muelle Uno', CATALOGO, null, 'destino', e)).toBeNull();
  });

  it('con cliente_id se desempatan dos sitios homónimos; sin cliente en el viaje NO se adivina', () => {
    const e = [eq('Bodega Central', 'p-demo', 'sitio', { clienteId: 'c1' }), eq('Bodega Central', 'p-otra', 'sitio', { clienteId: 'c2' })];
    expect(derivarSitio('Bodega Central', CATALOGO, 'c1', 'destino', e)).toEqual({ sitioId: 'p-demo', criterio: 'equivalencia' });
    expect(derivarSitio('Bodega Central', CATALOGO, 'c2', 'destino', e)).toEqual({ sitioId: 'p-otra', criterio: 'equivalencia' });
    expect(derivarSitio('Bodega Central', CATALOGO, null, 'destino', e)).toBeNull();
    expect(derivarSitio('Bodega Central', CATALOGO, 'c3', 'destino', e)).toBeNull(); // un cliente que no tiene la suya
  });

  it('la equivalencia del cliente gana a la general de la flota', () => {
    const e = [eq('Bodega Central', 'p-otra'), eq('Bodega Central', 'p-demo', 'sitio', { clienteId: 'c1' })];
    expect(derivarSitio('Bodega Central', CATALOGO, 'c1', 'destino', e)?.sitioId).toBe('p-demo');
    expect(derivarSitio('Bodega Central', CATALOGO, 'c2', 'destino', e)?.sitioId).toBe('p-otra');
  });

  it('dos equivalencias en conflicto del mismo nivel → duda: no se asigna ni cae a los nombres', () => {
    const e = [eq('Planta Demo', 'p-otra', 'sitio', { lado: 'origen' }), eq('Planta Demo', 'p-demo', 'ignorar', { lado: 'origen' })];
    expect(resolverSitio('Planta Demo', CATALOGO, null, 'origen', e)).toBeNull();
  });

  it('una equivalencia a un sitio que ya no está en el catálogo activo no aplica (cae al criterio de siempre)', () => {
    const e = [eq('Planta Demo', 'archivado')];
    expect(derivarSitio('Planta Demo', CATALOGO, null, 'origen', e)).toEqual({ sitioId: 'p-demo', criterio: 'nombre_exacto' });
  });

  it('un texto corto con equivalencia sí se resuelve (la longitud mínima es de la inferencia, no de la decisión humana)', () => {
    expect(derivarSitio('PDO', CATALOGO, null, 'origen', [eq('PDO', 'p-otra')])).toEqual({ sitioId: 'p-otra', criterio: 'equivalencia' });
  });

  it('sin equivalencias el comportamiento es idéntico al anterior', () => {
    expect(derivarSitio('Entrega en Planta Demo, NL', CATALOGO)).toEqual({ sitioId: 'p-demo', criterio: 'nombre_contenido' });
    expect(derivarSitio('STOP SD01 FINAL ACERO', CATALOGO)).toBeNull();
  });
});

// ── La cobertura medida con un catálogo de 17 sitios y 40 textos libres inventados ─────────────────────────────────────────
// La cifra sale de ESTE fixture inventado; no es una promesa sobre ningún cliente real.
const SITIOS17: SitioCatalogo[] = Array.from({ length: 17 }, (_, i) => ({ id: `s${i + 1}`, nombre: `Sitio Demo ${String(i + 1).padStart(2, '0')}`, codigo: null, clienteId: null }));
const num = (n: number): string => String(n).padStart(2, '0');
const TEXTOS: Array<{ texto: string; destino: { sitioId: string } | 'instruccion' | 'sin_mapa' }> = [
  // 6 que el nombre ya resuelve
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ texto: n % 2 ? `SITIO DEMO ${num(n)}` : `Entrega en Sitio Demo ${num(n)}, NL`, destino: { sitioId: `s${n}` } })),
  // 17 «STOP SDnn FINAL ACERO» (el código corto del despacho; no es el nombre)
  ...Array.from({ length: 17 }, (_, i) => ({ texto: `STOP SD${num(i + 1)} FINAL ACERO`, destino: { sitioId: `s${i + 1}` } })),
  // 6 variantes más para otros sitios
  ...[3, 5, 7, 9, 11, 13].map((n) => ({ texto: `DESCARGA PATIO SD${num(n)} TURNO 2`, destino: { sitioId: `s${n}` } })),
  // 7 instrucciones, no lugares
  ...['A', 'B', 'C', 'D'].map((k) => ({ texto: `VACIO Cliente Demo ${k}`, destino: 'instruccion' as const })),
  ...[6, 7, 8].map((h) => ({ texto: `SALIR A RUTA ANTES DE LAS ${h} PM`, destino: 'instruccion' as const })),
  // 4 que nadie ha explicado todavía
  ...['TALLER X1', 'POR CONFIRMAR', 'CITA PENDIENTE 55', 'VER CON DESPACHO'].map((t) => ({ texto: t, destino: 'sin_mapa' as const })),
];

describe('cobertura medida (fixture inventado: 17 sitios, 40 textos)', () => {
  const equivalencias: SitioEquivalencia[] = TEXTOS.flatMap((t) => t.destino === 'sin_mapa' ? [] : [t.destino === 'instruccion'
    ? eq(t.texto, null, 'ignorar') : eq(t.texto, t.destino.sitioId)]);

  const cobertura = (e: readonly SitioEquivalencia[]): number => {
    const resueltos = TEXTOS.filter((t) => resolverSitio(t.texto, SITIOS17, null, 'destino', e) !== null).length;
    return resueltos / TEXTOS.length;
  };

  it('el fixture tiene lo que dice: 40 textos y 17 sitios', () => {
    expect(TEXTOS).toHaveLength(40);
    expect(SITIOS17).toHaveLength(17);
  });

  it('solo por nombre cubre poco; con equivalencias pasa de 90 %', () => {
    const solo = cobertura([]);
    const con = cobertura(equivalencias);
    expect(solo).toBeLessThan(0.2); // 6 de 40 = 15 %
    expect(con).toBeGreaterThanOrEqual(0.9); // 36 de 40 = 90 %
  });

  it('y nunca se equivoca de sitio: lo que resuelve coincide con lo sembrado', () => {
    for (const t of TEXTOS) {
      const r = resolverSitio(t.texto, SITIOS17, null, 'destino', equivalencias);
      if (t.destino === 'sin_mapa') expect(r).toBeNull();
      else if (t.destino === 'instruccion') expect(r).toEqual({ tipo: 'sin_sitio' });
      else expect(r).toMatchObject({ tipo: 'sitio', sitioId: t.destino.sitioId });
    }
  });
});

// ── El barrido ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('barridoSitioDerivado con equivalencias', () => {
  const cand = (viajeId: string, origen: string | null, destino: string | null, extra: Partial<CandidatoSitio> = {}): CandidatoSitio => ({
    tenantId: 't1', viajeId, origen, destino, clienteId: null, conSitio: new Set<LadoViaje>(), yaDerivados: new Set<LadoViaje>(), ...extra,
  });
  const montar = (candidatos: CandidatoSitio[], equivalencias: SitioEquivalencia[], conMarcar = true) => {
    const asignados: Array<[string, LadoViaje, string, string]> = [];
    const marcados: Array<[string, LadoViaje]> = [];
    const puertos: PuertosSitioDerivado = {
      candidatos: async () => candidatos,
      catalogo: async () => new Map([['t1', CATALOGO]]),
      equivalencias: async () => new Map([['t1', equivalencias]]),
      asignar: async (_t, v, lado, sitio, criterio) => { asignados.push([v, lado, sitio, criterio]); return 'ok'; },
      ...(conMarcar ? { marcarSinSitio: async (_t: string, v: string, lado: LadoViaje) => { marcados.push([v, lado]); return 'ok' as const; } } : {}),
    };
    return { puertos, asignados, marcados };
  };

  it('asigna por equivalencia con criterio «equivalencia» y deja constancia de la instrucción sin contarla como falta', async () => {
    const w = montar([cand('v1', 'STOP Planta Demo FINAL ACERO', 'VACIO Cliente Demo')], [eq('STOP Planta Demo FINAL ACERO', 'p-demo'), eq('VACIO Cliente Demo', null, 'ignorar')]);
    const r = await barridoSitioDerivado(w.puertos, new Date());
    expect(w.asignados).toEqual([['v1', 'origen', 'p-demo', 'equivalencia']]);
    expect(w.marcados).toEqual([['v1', 'destino']]);
    expect(r).toMatchObject({ candidatos: 1, derivados: 1, sinSitioPorDecision: 1, sinCoincidencia: 0, fallos: 0 });
  });

  it('un lado ya derivado (incluida una decisión «sin sitio» previa) no se vuelve a evaluar', async () => {
    const w = montar([cand('v2', 'VACIO Cliente Demo', null, { yaDerivados: new Set<LadoViaje>(['origen']) })], [eq('VACIO Cliente Demo', null, 'ignorar')]);
    const r = await barridoSitioDerivado(w.puertos, new Date());
    expect(w.marcados).toEqual([]);
    expect(r.sinSitioPorDecision).toBe(0);
  });

  it('una falla al dejar constancia cuenta como fallo y no inventa nada', async () => {
    const w = montar([cand('v3', 'VACIO Cliente Demo', null)], [eq('VACIO Cliente Demo', null, 'ignorar')]);
    w.puertos.marcarSinSitio = async () => 'fallo';
    const r = await barridoSitioDerivado(w.puertos, new Date());
    expect(r).toMatchObject({ fallos: 1, sinSitioPorDecision: 0 });
  });

  it('sin el puerto de equivalencias se comporta como antes', async () => {
    const w = montar([cand('v4', 'Planta Demo', 'STOP Planta Demo FINAL ACERO')], []);
    delete w.puertos.equivalencias;
    const r = await barridoSitioDerivado(w.puertos, new Date());
    expect(w.asignados).toEqual([['v4', 'origen', 'p-demo', 'nombre_exacto'], ['v4', 'destino', 'p-demo', 'nombre_contenido']]);
    expect(r.sinSitioPorDecision).toBe(0);
  });
});
