import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));

const { reubicacionesPorViaje, reubicacionesPorCliente, csvReubicaciones, COLUMNAS_CSV_REUBICACIONES } = await import('./reubicaciones');
const { hitoVacio } = await import('./memoria.fixture');
type ViajeTablero = import('./repo_validacion').ViajeTablero;
type EventoReporteFila = import('./repo').EventoReporteFila;
type HitoFila = import('./tipos').HitoFila;

// Reloj simulado: todo cuelga de un instante fijo (12:00 hora del Centro = 18:00 UTC), nada lee la hora real.
const T0 = new Date('2026-10-02T18:00:00.000Z').getTime();
const en = (min: number) => new Date(T0 + min * 60_000).toISOString();

const viaje = (id: string, p: Partial<ViajeTablero> = {}): ViajeTablero => ({
  id, folio: `F-${id}`, origen: 'Planta A', destino: 'CEDIS B', estatus: 'abierto', operadorId: 'o1', operadorNombre: 'Chofer Uno', terminalId: null,
  terminalNombre: null, clienteId: 'c1', clienteNombre: 'Cliente A', unidadId: null, aceptadoEn: null, citaOrigenEn: null, citaDestinoEn: null,
  etaOrigenEn: null, etaDestinoEn: null, origenSitioId: null, destinoSitioId: null, ...p,
} as ViajeTablero);

const hito = (viajeId: string, tipo: HitoFila['tipo'] = 'llegada_descarga', tenantId = 't1', ciclo = 1): HitoFila =>
  hitoVacio({ id: `h-${viajeId}-${tipo}-${ciclo}`, tipo, viajeId, tenantId, ciclo });

let seq = 0;
const rampa = (h: HitoFila, min: number, estado: string, numero: string | null = null): EventoReporteFila => ({
  id: ++seq, viajeId: h.viajeId, hitoId: h.id, creadoEn: en(min), detalle: { clase: 'reporte_llegada', tipo: 'rampa', estado, numero, ciclo: h.ciclo },
});

describe('reubicaciones por viaje (T-A5-63)', () => {
  it('sin ninguna respuesta: «sin dato», no cero', () => {
    const h = hito('v1');
    const [r] = reubicacionesPorViaje('t1', [viaje('v1')], [h], []);
    expect(r.estado).toBe('sin_dato');
    expect(r.reubicaciones).toBeNull();
    expect(r.minutos).toBeNull();
  });

  it('un solo registro: dato real con CERO reubicaciones y cero minutos', () => {
    const h = hito('v1');
    const [r] = reubicacionesPorViaje('t1', [viaje('v1')], [h], [rampa(h, 0, 'si', '3')]);
    expect(r.estado).toBe('sin_reubicacion');
    expect(r.reubicaciones).toBe(0);
    expect(r.minutos).toBe(0);
  });

  it('varias reubicaciones: cuenta los cambios después del primero y los minutos del primero al último', () => {
    const h = hito('v1');
    const ev = [rampa(h, 0, 'si', '3'), rampa(h, 25, 'si', '7'), rampa(h, 70, 'en_espera')];
    const [r] = reubicacionesPorViaje('t1', [viaje('v1')], [h], ev);
    expect(r.estado).toBe('reubicado');
    expect(r.reubicaciones).toBe(2);
    expect(r.minutos).toBe(70);
    expect(r.registros.map((x) => x.rampa)).toEqual(['3', '7', null]);
  });

  it('un registro repetido igual no cuenta como reubicación (la lista no se infla)', () => {
    const h = hito('v1');
    const [r] = reubicacionesPorViaje('t1', [viaje('v1')], [h], [rampa(h, 0, 'si', '3'), rampa(h, 10, 'si', '3')]);
    expect(r.reubicaciones).toBe(0);
  });

  it('el desorden de ids no cambia los minutos: cuenta de la hora menor a la mayor', () => {
    const h = hito('v1');
    const ev = [rampa(h, 40, 'si', '9'), rampa(h, 5, 'si', '2')];
    const [r] = reubicacionesPorViaje('t1', [viaje('v1')], [h], ev);
    expect(r.minutos).toBe(35);
  });

  it('suma las llegadas de un mismo viaje (carga y descarga) sin mezclar sus minutos', () => {
    const hc = hito('v1', 'llegada_carga');
    const hd = hito('v1', 'llegada_descarga');
    const ev = [rampa(hc, 0, 'si', '1'), rampa(hc, 10, 'si', '2'), rampa(hd, 100, 'si', '4'), rampa(hd, 130, 'no')];
    const [r] = reubicacionesPorViaje('t1', [viaje('v1')], [hc, hd], ev);
    expect(r.reubicaciones).toBe(2);
    expect(r.minutos).toBe(40);
  });

  it('otro tenant: 0 filas (ni viajes, ni hitos, ni eventos ajenos)', () => {
    const h = hito('v1', 'llegada_descarga', 't2');
    const ev = [rampa(h, 0, 'si', '3'), rampa(h, 20, 'si', '4')];
    expect(reubicacionesPorViaje('t1', [viaje('v1')], [h], ev)).toEqual([]);
    expect(reubicacionesPorCliente('t1', [viaje('v1')], [h], ev, new Map())).toEqual([]);
  });

  it('un hito de otro tenant no se cuela en un viaje propio con el mismo id', () => {
    const propio = hito('v1', 'llegada_descarga', 't1');
    const ajeno = { ...hito('v1', 'llegada_carga', 't2') };
    const ev = [rampa(propio, 0, 'si', '1'), rampa(ajeno, 0, 'si', '1'), rampa(ajeno, 500, 'si', '2')];
    const [r] = reubicacionesPorViaje('t1', [viaje('v1')], [propio, ajeno], ev);
    expect(r.reubicaciones).toBe(0);
    expect(r.minutos).toBe(0);
  });
});

describe('reubicaciones por cliente (T-A5-63)', () => {
  const v1 = viaje('v1'); const v2 = viaje('v2'); const v3 = viaje('v3', { clienteId: 'c2', clienteNombre: 'Cliente B' });
  const v4 = viaje('v4', { clienteId: null, clienteNombre: null });
  const h1 = hito('v1'); const h2 = hito('v2'); const h3 = hito('v3'); const h4 = hito('v4');
  const ev = [
    rampa(h1, 0, 'si', '1'), rampa(h1, 30, 'si', '2'), rampa(h1, 50, 'si', '3'),
    rampa(h2, 0, 'si', '5'),
    rampa(h3, 0, 'no'), rampa(h3, 90, 'si', '8'),
    rampa(h4, 0, 'si', '1'), rampa(h4, 5, 'si', '2'),
  ];

  it('agrupa por cliente, suma y ordena por minutos (el que más demora, primero)', () => {
    const filas = reubicacionesPorCliente('t1', [v1, v2, v3, v4], [h1, h2, h3, h4], ev, new Map([['c1', 'Cliente A'], ['c2', 'Cliente B']]));
    expect(filas.map((f) => f.clienteId)).toEqual(['c2', 'c1', null]);
    const a = filas.find((f) => f.clienteId === 'c1')!;
    expect(a).toMatchObject({ clienteNombre: 'Cliente A', viajes: 2, viajesConDato: 2, viajesReubicados: 1, reubicaciones: 2, minutos: 50 });
    const b = filas.find((f) => f.clienteId === 'c2')!;
    expect(b).toMatchObject({ viajesReubicados: 1, reubicaciones: 1, minutos: 90 });
    expect(filas.find((f) => f.clienteId === null)).toMatchObject({ clienteNombre: 'Sin cliente', reubicaciones: 1, minutos: 5 });
  });

  it('un cliente cuyos viajes no tienen ningún dato dice «sin dato», no cero', () => {
    const [f] = reubicacionesPorCliente('t1', [v1], [h1], [], new Map([['c1', 'Cliente A']]));
    expect(f).toMatchObject({ viajes: 1, viajesConDato: 0, reubicaciones: null, minutos: null, viajesReubicados: null });
  });

  it('mezcla: los viajes sin dato no suman cero falso, solo se cuentan aparte', () => {
    const [f] = reubicacionesPorCliente('t1', [v1, v2], [h1, h2], [rampa(h1, 0, 'si', '1'), rampa(h1, 15, 'si', '2')], new Map());
    expect(f).toMatchObject({ viajes: 2, viajesConDato: 1, reubicaciones: 1, minutos: 15 });
  });

  it('sin nombre en el catálogo cae al nombre del viaje y, si no, a «Cliente sin nombre»', () => {
    const f = reubicacionesPorCliente('t1', [viaje('v1', { clienteNombre: null })], [h1], [], new Map());
    expect(f[0].clienteNombre).toBe('Cliente sin nombre');
    const g = reubicacionesPorCliente('t1', [v1], [h1], [], new Map());
    expect(g[0].clienteNombre).toBe('Cliente A');
  });
});

describe('CSV para disputar «no se presentó» (T-A5-63)', () => {
  it('una fila por registro con folio, cliente, hora del Centro de México y totales del viaje; sin nombres de personas', () => {
    const h = hito('v1');
    const ev = [rampa(h, 0, 'si', '3'), rampa(h, 25, 'si', '7')];
    const filas = reubicacionesPorViaje('t1', [viaje('v1')], [h], ev);
    const csv = csvReubicaciones(filas);
    const lineas = csv.replace(/^﻿/, '').trim().split('\n');
    expect(lineas[0]).toBe(COLUMNAS_CSV_REUBICACIONES.join(','));
    expect(lineas).toHaveLength(3);
    expect(lineas[1]).toContain('F-v1');
    expect(lineas[1]).toContain('Cliente A');
    expect(lineas[1]).toContain('2026-10-02 12:00:00');
    expect(lineas[2]).toContain('2026-10-02 12:25:00');
    expect(lineas[2]).toMatch(/,1,25$/);
    expect(csv).not.toContain('Chofer Uno');
  });

  it('neutraliza fórmulas en el texto libre del chofer', () => {
    const h = hito('v1');
    const ev: EventoReporteFila[] = [
      rampa(h, 0, 'no_aplica'),
      { id: ++seq, viajeId: 'v1', hitoId: h.id, creadoEn: en(5), detalle: { clase: 'reporte_llegada', tipo: 'como', texto: '=HYPERLINK("x")', omitido: false, ciclo: 1 } },
    ];
    const csv = csvReubicaciones(reubicacionesPorViaje('t1', [viaje('v1')], [h], ev));
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('un viaje «sin dato» no genera fila (no se exporta lo que no hay)', () => {
    expect(csvReubicaciones(reubicacionesPorViaje('t1', [viaje('v1')], [hito('v1')], [])).replace(/^﻿/, '').trim().split('\n')).toHaveLength(1);
  });
});
