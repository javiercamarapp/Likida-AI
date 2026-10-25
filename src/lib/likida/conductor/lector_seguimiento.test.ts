import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  crearDobleSeguimiento, lectorSeguimientoApagado, leerAsignacionSeguimiento, normalizarAsignacion, VIGENCIA_ASIGNACION_MIN,
  type AsignacionSeguimiento, type LectorSeguimiento,
} from './lector_seguimiento';

// Todo sintético: referencias, textos y coordenadas inventados; ningún dato real ni nombre del cliente.
const AHORA = new Date('2026-10-02T14:30:00.000Z');
const T = 'T-SINT-A';
const hace = (min: number): Date => new Date(AHORA.getTime() - min * 60_000);
const asignacion = (extra: Partial<AsignacionSeguimiento> = {}): AsignacionSeguimiento => ({
  tenantId: 'T-SINT-A',
  viajeRef: 'VJ-SINT-001',
  instrucciones: ['Presentarse en rampa asignada', 'Reportar sello al salir'],
  ruta: [{ lat: 20.7, lng: -103.4 }, { lat: 20.8, lng: -103.3 }],
  detenciones: [
    { orden: 2, nombre: 'Patio sintético B', lat: 20.8, lng: -103.3 },
    { orden: 1, nombre: 'Patio sintético A', lat: 20.7, lng: -103.4 },
  ],
  destino: { lat: 20.8, lng: -103.3 },
  leidaEn: hace(1),
  ...extra,
});

afterEach(() => vi.restoreAllMocks());

describe('doble de pruebas del lector de seguimiento', () => {
  it('devuelve instrucciones, ruta y detenciones sintéticas por viaje; viaje desconocido → null', async () => {
    const lector = crearDobleSeguimiento({ 'T-SINT-A': { 'VJ-SINT-001': asignacion() } });
    const a = await leerAsignacionSeguimiento(lector, T, 'VJ-SINT-001', AHORA);
    expect(a?.instrucciones).toEqual(['Presentarse en rampa asignada', 'Reportar sello al salir']);
    expect(a?.ruta).toHaveLength(2);
    expect(a?.detenciones.map((d) => d.nombre)).toEqual(['Patio sintético A', 'Patio sintético B']); // ordenadas por `orden`
    expect(a?.destino).toEqual({ lat: 20.8, lng: -103.3 });
    expect(await leerAsignacionSeguimiento(lector, T, 'VJ-NO-EXISTE', AHORA)).toBeNull();
  });

  it('no hace ninguna llamada de red', async () => {
    const fetchEspia = vi.fn();
    vi.stubGlobal('fetch', fetchEspia);
    try {
      await leerAsignacionSeguimiento(crearDobleSeguimiento({ 'T-SINT-A': { 'VJ-SINT-001': asignacion() } }), T, 'VJ-SINT-001', AHORA);
      await leerAsignacionSeguimiento(lectorSeguimientoApagado, T, 'VJ-SINT-001', AHORA);
      expect(fetchEspia).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('es idempotente y de solo lectura: leer dos veces da lo mismo y no muta la fuente ni lo devuelto la primera vez', async () => {
    const fuente = Object.freeze(asignacion());
    const lector = crearDobleSeguimiento({ 'T-SINT-A': { 'VJ-SINT-001': fuente } });
    const a1 = await leerAsignacionSeguimiento(lector, T, 'VJ-SINT-001', AHORA);
    a1?.instrucciones.push('basura');
    a1?.detenciones.pop();
    const a2 = await leerAsignacionSeguimiento(lector, T, 'VJ-SINT-001', AHORA);
    expect(a2).toEqual(await leerAsignacionSeguimiento(lector, T, 'VJ-SINT-001', AHORA));
    expect(a2?.instrucciones).toHaveLength(2);
    expect(a2?.detenciones).toHaveLength(2);
    expect(fuente.instrucciones).toHaveLength(2);
  });
});

describe('A37-S35-08: el contrato lleva la flota', () => {
  it('dos flotas con el mismo viajeRef reciben cada una SU asignación; una lectura de otra flota se descarta', async () => {
    const lector = crearDobleSeguimiento({
      'T-SINT-A': { '1001': asignacion({ viajeRef: '1001', instrucciones: ['de A'] }) },
      'T-SINT-B': { '1001': asignacion({ tenantId: 'T-SINT-B', viajeRef: '1001', instrucciones: ['de B'] }) },
    });
    expect((await leerAsignacionSeguimiento(lector, 'T-SINT-A', '1001', AHORA))?.instrucciones).toEqual(['de A']);
    expect((await leerAsignacionSeguimiento(lector, 'T-SINT-B', '1001', AHORA))?.instrucciones).toEqual(['de B']);
    // Un adaptador que devuelve la asignación de OTRA flota no la filtra a quien la pidió.
    const mezclado: LectorSeguimiento = { leer: async () => asignacion({ tenantId: 'T-SINT-B' }) };
    expect(await leerAsignacionSeguimiento(mezclado, 'T-SINT-A', 'VJ-SINT-001', AHORA)).toBeNull();
    expect(await leerAsignacionSeguimiento(lector, '  ', '1001', AHORA)).toBeNull();
  });
});

describe('nace apagado y nunca lanza', () => {
  it('el lector por omisión no entrega nada', async () => {
    expect(await leerAsignacionSeguimiento(lectorSeguimientoApagado, T, 'VJ-SINT-001', AHORA)).toBeNull();
  });

  it('puerto ausente, fallo del sistema del cliente o viaje vacío → null, sin lanzar', async () => {
    const roto: LectorSeguimiento = { leer: async () => { throw new Error('timeout'); } };
    expect(await leerAsignacionSeguimiento(null, T, 'VJ-SINT-001', AHORA)).toBeNull();
    expect(await leerAsignacionSeguimiento(undefined, T, 'VJ-SINT-001', AHORA)).toBeNull();
    expect(await leerAsignacionSeguimiento(roto, T, 'VJ-SINT-001', AHORA)).toBeNull();
    expect(await leerAsignacionSeguimiento(crearDobleSeguimiento({ 'T-SINT-A': { '': asignacion() } }), T, '  ', AHORA)).toBeNull();
  });
});

describe('normalización: lo dudoso se descarta, no se inventa', () => {
  it('lectura vieja, futura o sin hora → null (no se actúa con una asignación rancia)', () => {
    expect(normalizarAsignacion(asignacion({ leidaEn: hace(VIGENCIA_ASIGNACION_MIN + 1) }), AHORA, T)).toBeNull();
    expect(normalizarAsignacion(asignacion({ leidaEn: new Date(AHORA.getTime() + 60 * 60_000) }), AHORA, T)).toBeNull();
    expect(normalizarAsignacion(asignacion({ leidaEn: null }), AHORA, T)).toBeNull();
    expect(normalizarAsignacion(asignacion({ leidaEn: new Date('x') }), AHORA, T)).toBeNull();
    expect(normalizarAsignacion(asignacion({ leidaEn: hace(VIGENCIA_ASIGNACION_MIN - 1) }), AHORA, T)).not.toBeNull();
  });

  it('descarta coordenadas fuera de rango o no finitas, detenciones sin nombre e instrucciones vacías', () => {
    const a = normalizarAsignacion(asignacion({
      instrucciones: ['  ', 'Válida'],
      ruta: [{ lat: 200, lng: 0 }, { lat: Number.NaN, lng: 0 }, { lat: 20.7, lng: -103.4 }],
      detenciones: [{ orden: 1, nombre: '', lat: 20.7, lng: -103.4 }, { orden: 2, nombre: 'Buena', lat: 20.7, lng: -103.4 }, { orden: 3, nombre: 'Mala', lat: 91, lng: 0 }],
      destino: { lat: 0, lng: 181 },
    }), AHORA, T);
    expect(a?.instrucciones).toEqual(['Válida']);
    expect(a?.ruta).toEqual([{ lat: 20.7, lng: -103.4 }]);
    expect(a?.detenciones.map((d) => d.nombre)).toEqual(['Buena']);
    expect(a?.destino).toBeNull();
  });

  it('campos que el sistema no trae quedan vacíos o null, nunca inventados', () => {
    const a = normalizarAsignacion({ tenantId: T, viajeRef: 'VJ-SINT-002', leidaEn: hace(1) } as AsignacionSeguimiento, AHORA, T);
    expect(a).toEqual({ tenantId: T, viajeRef: 'VJ-SINT-002', instrucciones: [], ruta: [], detenciones: [], destino: null, leidaEn: hace(1) });
  });
});
