import { describe, expect, it } from 'vitest';
import type { ProspectoMapa, TextosProspecto } from '@/lib/admin/prospectos-mapa-client';
import {
  SIN_FILTROS, alternarEnSet, contarFiltrosActivos, csvDe, filtrarProspectos, haversineKm, ordenarProspectos, plazasDe, type Filtros,
} from './filtros';

// Contrato de las capacidades del Cerebro que viven en la cartera (Fase 6): filtros de orden, radio, similitud, necesidad y toque,
// la exportación y el centro del radio. Se fijan ANTES de cambiar la piel del mapa.
const AHORA = Date.parse('2026-11-10T12:00:00Z');
const dia = 86_400_000;
const hace = (d: number) => new Date(AHORA - d * dia).toISOString();

const p = (id: string, extra: Partial<ProspectoMapa> = {}): ProspectoMapa => ({
  id, empresa: `Empresa ${id}`, ciudad: null, entidad: null, lat: null, lng: null, telefono: null, correo: null, contacto: null,
  vacante: null, estado: 'nuevo', fuente: 'censo', giro: 'transportista', urgencia: 10, cierre: 10, tamano: null, completitud: 10,
  ultimoToque: null, mensajesGeneradosEn: null, numUnidades: null, similitudIcpPct: 0, necesidadPct: 0, ...extra,
});
const con = (f: Partial<Filtros>): Filtros => ({ ...SIN_FILTROS, ...f });
const ids = (l: ProspectoMapa[]) => l.map((x) => x.id);

describe('Cerebro: filtros', () => {
  const cartera = [
    p('a', { similitudIcpPct: 90, necesidadPct: 20, urgencia: 80, telefono: '81', contacto: 'Ana', vacante: 'Auxiliar', mensajesGeneradosEn: hace(1) }),
    p('b', { similitudIcpPct: 50, necesidadPct: 70, urgencia: 55, giro: 'logistica', estado: 'demo', fuente: 'denue', tamano: '31-50', completitud: 80 }),
    p('c', { similitudIcpPct: 10, necesidadPct: 10, ultimoToque: hace(3) }),
    p('d', { ultimoToque: hace(20) }),
  ];

  it('sin filtros pasa toda la cartera', () => {
    expect(ids(filtrarProspectos(cartera, SIN_FILTROS, AHORA))).toEqual(['a', 'b', 'c', 'd']);
    expect(contarFiltrosActivos(SIN_FILTROS)).toBe(0);
  });

  it('similitud y necesidad mínimas', () => {
    expect(ids(filtrarProspectos(cartera, con({ minSimilitud: 65 }), AHORA))).toEqual(['a']);
    expect(ids(filtrarProspectos(cartera, con({ minNecesidad: 65 }), AHORA))).toEqual(['b']);
  });

  it('urgencia mínima, teléfono, decisor, vacante y mensaje IA', () => {
    expect(ids(filtrarProspectos(cartera, con({ minUrgencia: 70 }), AHORA))).toEqual(['a']);
    expect(ids(filtrarProspectos(cartera, con({ minUrgencia: 50 }), AHORA))).toEqual(['a', 'b']);
    expect(ids(filtrarProspectos(cartera, con({ soloTel: true }), AHORA))).toEqual(['a']);
    expect(ids(filtrarProspectos(cartera, con({ soloDecisor: true }), AHORA))).toEqual(['a']);
    expect(ids(filtrarProspectos(cartera, con({ soloVacante: true }), AHORA))).toEqual(['a']);
    expect(ids(filtrarProspectos(cartera, con({ soloMensajeIA: true }), AHORA))).toEqual(['a']);
  });

  it('giro, etapa, fuente, tamaño (incluido «sin dato») y datos completos', () => {
    expect(ids(filtrarProspectos(cartera, con({ giros: new Set(['logistica']) }), AHORA))).toEqual(['b']);
    expect(ids(filtrarProspectos(cartera, con({ etapas: new Set(['demo']) }), AHORA))).toEqual(['b']);
    expect(ids(filtrarProspectos(cartera, con({ fuentes: new Set(['denue']) }), AHORA))).toEqual(['b']);
    expect(ids(filtrarProspectos(cartera, con({ tamanos: new Set(['31-50']) }), AHORA))).toEqual(['b']);
    expect(ids(filtrarProspectos(cartera, con({ tamanos: new Set(['n/d']) }), AHORA))).toEqual(['a', 'c', 'd']);
    expect(ids(filtrarProspectos(cartera, con({ minCompletitud: 75 }), AHORA))).toEqual(['b']);
  });

  it('sin toque en N días: incluye al nunca tocado y excluye al tocado dentro de la ventana', () => {
    // a y b nunca tocados; c hace 3 días (dentro de 7); d hace 20 días.
    expect(ids(filtrarProspectos(cartera, con({ sinToqueDias: 7 }), AHORA))).toEqual(['a', 'b', 'd']);
    expect(ids(filtrarProspectos(cartera, con({ sinToqueDias: 30 }), AHORA))).toEqual(['a', 'b']);
  });

  it('contador: cada criterio suma uno y el radio solo cuenta con centro', () => {
    expect(contarFiltrosActivos(con({ minSimilitud: 40, minNecesidad: 40, soloTel: true }))).toBe(3);
    expect(contarFiltrosActivos(con({ radioKm: 50 }))).toBe(0);
    expect(contarFiltrosActivos(con({ radioKm: 50, centro: { lat: 1, lng: 1, nombre: 'x' } }))).toBe(1);
  });
});

describe('Cerebro: radio desde una plaza', () => {
  const laredo = { lat: 27.5, lng: -99.5, nombre: 'Nuevo Laredo, Tamaulipas' };
  const cartera = [
    p('cerca', { lat: 27.6, lng: -99.5 }),     // ≈ 11 km
    p('lejos', { lat: 25.7, lng: -100.3 }),    // ≈ 215 km
    p('sin-coords'),
  ];

  it('haversine da kilómetros razonables', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    const d = haversineKm(laredo, { lat: 25.7, lng: -100.3 });
    expect(d).toBeGreaterThan(190);
    expect(d).toBeLessThan(240);
  });

  it('con radio solo pasan los que tienen coordenadas dentro; al resto no se le adivina distancia', () => {
    expect(ids(filtrarProspectos(cartera, con({ centro: laredo, radioKm: 50 }), AHORA))).toEqual(['cerca']);
    expect(ids(filtrarProspectos(cartera, con({ centro: laredo, radioKm: 200 }), AHORA))).toEqual(['cerca']);
    expect(ids(filtrarProspectos(cartera, con({ centro: laredo, radioKm: 250 }), AHORA))).toEqual(['cerca', 'lejos']);
  });

  it('radio 0 o sin centro: el criterio está apagado y pasan todos, con o sin coordenadas', () => {
    expect(filtrarProspectos(cartera, con({ centro: laredo, radioKm: 0 }), AHORA)).toHaveLength(3);
    expect(filtrarProspectos(cartera, con({ radioKm: 50 }), AHORA)).toHaveLength(3);
  });

  it('las plazas promedian por ciudad y ordenan por tamaño', () => {
    const plazas = plazasDe([
      p('1', { ciudad: 'Monterrey', entidad: 'Nuevo León', lat: 25, lng: -100 }),
      p('2', { ciudad: 'Monterrey', entidad: 'Nuevo León', lat: 26, lng: -101 }),
      p('3', { ciudad: 'Saltillo', entidad: 'Coahuila', lat: 25.4, lng: -101 }),
      p('4', { ciudad: 'Sin coords' }),
    ]);
    expect(plazas.map((x) => x.nombre)).toEqual(['Monterrey, Nuevo León', 'Saltillo, Coahuila']);
    expect(plazas[0].lat).toBeCloseTo(25.5);
    expect(plazas[0].n).toBe(2);
  });
});

describe('Cerebro: orden', () => {
  const cartera = [
    p('a', { cierre: 30, urgencia: 90, completitud: 40, similitudIcpPct: 20, necesidadPct: 90 }),
    p('b', { cierre: 80, urgencia: 10, completitud: 90, similitudIcpPct: 95, necesidadPct: 10 }),
    p('c', { cierre: 50, urgencia: 50, completitud: 60, similitudIcpPct: 60, necesidadPct: 50 }),
  ];
  it.each([
    ['cierre', ['b', 'c', 'a']],
    ['urgencia', ['a', 'c', 'b']],
    ['completos', ['b', 'c', 'a']],
    ['similitud', ['b', 'c', 'a']],
    ['necesidad', ['a', 'c', 'b']],
    ['recientes', ['a', 'b', 'c']],
  ] as const)('orden %s', (orden, esperado) => {
    expect(ids(ordenarProspectos(cartera, orden))).toEqual(esperado);
  });
  it('no muta la lista de entrada', () => {
    const antes = ids(cartera);
    ordenarProspectos(cartera, 'cierre');
    expect(ids(cartera)).toEqual(antes);
  });
});

describe('Cerebro: chips aditivos', () => {
  it('agrega, quita y vuelve a null cuando queda vacío', () => {
    const uno = alternarEnSet<string>(null, 'x');
    expect([...uno!]).toEqual(['x']);
    const dos = alternarEnSet(uno, 'y');
    expect([...dos!]).toEqual(['x', 'y']);
    expect(alternarEnSet(alternarEnSet(dos, 'x'), 'y')).toBeNull();
  });
});

describe('Cerebro: exportación CSV', () => {
  it('trae BOM, las 18 columnas, comillas escapadas y las notas pedidas por id', () => {
    const textos = new Map<string, TextosProspecto>([['a', { id: 'a', notas: 'dijo "hola"', mensajeWaIa: null, correoAsuntoIa: null, correoCuerpoIa: null }]]);
    const csv = csvDe([p('a', { empresa: 'Fletes, SA', telefono: '81', estado: 'demo' })], textos);
    expect(csv.startsWith('﻿')).toBe(true);
    const [cab, fila] = csv.slice(1).split('\n');
    expect(cab.split(',')).toHaveLength(18);
    expect(fila).toContain('"Fletes, SA"');
    expect(fila).toContain('"Demo dado"');
    expect(fila).toContain('"dijo ""hola"""');
  });
  it('sin textos la columna notas va vacía, no inventada', () => {
    const csv = csvDe([p('b')], new Map());
    expect(csv.trim().endsWith('""')).toBe(true);
  });
});
