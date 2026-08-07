import { describe, it, expect } from 'vitest';
import { detectarDuplicadosEntreViajes, type FilaGasto } from './duplicados';

// El fraude número uno del sector: el mismo comprobante liquidado en DOS viajes.
// El motor de cuadre ya detecta duplicados DENTRO de un viaje; esto los detecta
// ENTRE viajes, que es donde no hay nada que los frene — cada liquidación se ve
// impecable por separado.
const f = (viaje: string, p: Partial<FilaGasto> = {}): FilaGasto => ({
  viajeId: viaje, concepto: 'diesel', monto: 1000, ...p,
});

describe('detectarDuplicadosEntreViajes', () => {
  it('el mismo CFDI en dos viajes es una anomalía', () => {
    const r = detectarDuplicadosEntreViajes([
      f('v1', { cfdiUuid: 'uuid-a' }),
      f('v2', { cfdiUuid: 'uuid-a' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].tipo).toBe('cfdi_duplicado');
    expect(r[0].viajes.sort()).toEqual(['v1', 'v2']);
  });

  it('el mismo CFDI dos veces en EL MISMO viaje no es cosa de aquí', () => {
    // Eso ya lo atrapa el motor de cuadre y lo excluye del total. Reportarlo
    // aquí otra vez sería ruido en la bandeja del contralor.
    const r = detectarDuplicadosEntreViajes([
      f('v1', { cfdiUuid: 'uuid-a' }),
      f('v1', { cfdiUuid: 'uuid-a' }),
    ]);
    expect(r).toHaveLength(0);
  });

  it('detecta el ticket SIN CFDI repetido entre viajes', () => {
    // La mitad que faltaba. En una flota la mayoría de los gastos son tickets sin
    // timbrar todavía: si solo se vigila el UUID, el fraude más fácil de cometer
    // es el que no se mira.
    const r = detectarDuplicadosEntreViajes([
      f('v1', { folio: 'A-991', monto: 2500 }),
      f('v2', { folio: 'A-991', monto: 2500 }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].tipo).toBe('folio_duplicado');
    expect(r[0].monto).toBe(2500);
  });

  it('mismo folio con OTRO monto o concepto no se acusa', () => {
    // Los folios se repiten entre estaciones distintas: "A-991" de una gasolinera
    // y "A-991" de otra son comprobantes legítimos. Acusar a un operador de
    // fraude por una coincidencia de numeración es peor que no detectarlo.
    const r = detectarDuplicadosEntreViajes([
      f('v1', { folio: 'A-991', monto: 2500 }),
      f('v2', { folio: 'A-991', monto: 1800 }),
    ]);
    expect(r).toHaveLength(0);
  });

  it('reporta el monto REAL del comprobante duplicado', () => {
    const r = detectarDuplicadosEntreViajes([
      f('v1', { cfdiUuid: 'u', monto: 3200 }),
      f('v2', { cfdiUuid: 'u', monto: 3200 }),
    ]);
    expect(r[0].monto).toBe(3200);
  });

  it('el mismo comprobante en TRES viajes se reporta una vez, con los tres', () => {
    const r = detectarDuplicadosEntreViajes([
      f('v1', { cfdiUuid: 'u' }), f('v2', { cfdiUuid: 'u' }), f('v3', { cfdiUuid: 'u' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].viajes).toHaveLength(3);
  });

  it('sin datos no inventa anomalías', () => {
    expect(detectarDuplicadosEntreViajes([])).toEqual([]);
    expect(detectarDuplicadosEntreViajes([f('v1'), f('v2')])).toEqual([]); // sin folio ni uuid
  });

  it('el ticket cuyo FOLIO IMPRESO contiene un UUID ya reportado no se acusa dos veces', () => {
    // Esta es la regla que la línea de `conUuid` protege, y no estaba probada: si
    // el folio del ticket trae dentro el UUID del CFDI que ya salió arriba como
    // `cfdi_duplicado`, reportarlo otra vez como `folio_duplicado` le pone al
    // contralor dos acusaciones por el mismo comprobante.
    const u = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const r = detectarDuplicadosEntreViajes([
      f('v1', { cfdiUuid: u }),
      f('v2', { cfdiUuid: u }),
      f('v3', { folio: `FOL-${u}-X`, monto: 4000 }),
      f('v4', { folio: `FOL-${u}-X`, monto: 4000 }),
    ]);
    expect(r.map((a) => a.tipo)).toEqual(['cfdi_duplicado']);
  });

  it('un folio repetido SIN UUID adentro sí se acusa aunque el tenant tenga CFDI', () => {
    // El contrapeso de la prueba anterior: la exclusión tiene que ser por
    // contención real, no "hay UUIDs, entonces me callo".
    const r = detectarDuplicadosEntreViajes([
      f('v1', { cfdiUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
      f('v3', { folio: 'A-991', monto: 4000 }),
      f('v4', { folio: 'A-991', monto: 4000 }),
    ]);
    expect(r.map((a) => a.tipo)).toEqual(['folio_duplicado']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL COSTO NO PUEDE CRECER CON EL TAMAÑO DEL TENANT.
//
// El panel llama a esto con la tabla `gasto` COMPLETA del tenant en cada F5
// (`analytics.ts:detectarAnomalias`, sin filtro de fecha ni caché): una flota de
// 50 operadores × 20 viajes/mes × 8 comprobantes son ~96 000 filas al año.
//
// La versión anterior hacía `[...conUuid].some((u) => k.includes(u))` DENTRO del
// bucle de folios repetidos: materializaba los ~20 000 UUID del tenant en un
// arreglo nuevo por cada grupo. O(G × U). Medido antes del arreglo, con 96 000
// filas: 233 ms con 1 000 folios repetidos y 1 292 ms con 3 000. Después: 28 y
// 31 ms, con salida byte a byte idéntica.
//
// La prueba NO mide milisegundos absolutos —eso flaquea entre máquinas—, mide lo
// que de verdad estaba mal: que el tiempo dependiera de CUÁNTOS COMPROBANTES
// TIMBRADOS tenga el tenant. Con la misma cantidad de folios repetidos, pasar de
// 500 a 40 000 CFDI no debe cambiar el trabajo del bucle.
// ═══════════════════════════════════════════════════════════════════════════
describe('detectarDuplicadosEntreViajes a escala de un año de flota', () => {
  const uuid = (n: number) => `aaaaaaaa-bbbb-cccc-dddd-${n.toString(16).padStart(12, '0')}`;

  function generar(nTimbrados: number, gruposDup: number): FilaGasto[] {
    const filas: FilaGasto[] = [];
    for (let i = 0; i < nTimbrados; i++) {
      filas.push({ viajeId: `v${i % 5000}`, concepto: 'diesel', monto: 1000 + (i % 900), cfdiUuid: uuid(i) });
    }
    for (let i = 0; i < 20_000; i++) {
      filas.push({ viajeId: `v${i % 5000}`, concepto: 'casetas', monto: 100 + (i % 900), folio: `A-${i}` });
    }
    for (let g = 0; g < gruposDup; g++) {
      filas.push({ viajeId: `dupA${g}`, concepto: 'diesel', monto: 2500, folio: `DUP-${g}` });
      filas.push({ viajeId: `dupB${g}`, concepto: 'diesel', monto: 2500, folio: `DUP-${g}` });
    }
    return filas;
  }

  function medir(filas: FilaGasto[]) {
    const t0 = performance.now();
    const r = detectarDuplicadosEntreViajes(filas);
    return { ms: performance.now() - t0, r };
  }

  // SE SALTA BAJO `--coverage`. La instrumentación de v8 cobra por llamada, y
  // el caso de 40 000 CFDI hace muchísimas más que el de 500: el cociente pasa
  // de ~4 a ~9 midiendo la instrumentación, no el algoritmo. En `npm test`
  // —donde el umbral sí significa algo— corre igual que siempre.
  it.skipIf(process.env.CUADRA_COBERTURA === '1')('el tiempo no explota al crecer el número de CFDI del tenant', () => {
    const GRUPOS = 2_000;
    const pocos = generar(500, GRUPOS);
    const muchos = generar(40_000, GRUPOS);

    // Calentamiento: sin él la primera corrida paga la compilación del JIT y el
    // cociente mide eso en vez del algoritmo.
    medir(pocos); medir(muchos);

    // MEJOR DE CINCO, no una sola corrida. Un cociente de tiempos de pared es
    // sensible a lo que más haya en la máquina, y esta prueba se cayó de verdad
    // una vez el 28-jul-2026 con siete agentes y dos servidores de desarrollo
    // encima: dio 10.8 contra un umbral de 8 y pasó 4 de 4 al repetirla. Una
    // prueba intermitente en el camino del dinero es peor que no tenerla: se
    // aprende a reintentar el CI en vez de leer lo que dice.
    //
    // El mínimo es la estimación limpia de un microbenchmark: el ruido solo
    // puede hacer una corrida MÁS lenta, nunca más rápida, así que el mejor de
    // cinco se acerca al costo real del algoritmo. Y no debilita el umbral —lo
    // que caza es O(G × U), que con la versión anterior daba ~80—: si el
    // algoritmo se degrada, se degrada también en su mejor corrida.
    const mejorDe = (f: () => { ms: number; r: unknown[] }) => {
      let mejor = f();
      for (let i = 0; i < 8; i++) {
        const otra = f();
        if (otra.ms < mejor.ms) mejor = otra;
      }
      return mejor;
    };

    const a = mejorDe(() => medir(pocos));
    const b = mejorDe(() => medir(muchos));

    expect(a.r).toHaveLength(GRUPOS);
    expect(b.r).toHaveLength(GRUPOS);
    // Con la versión anterior este cociente era ~80 (40 000/500 UUID por grupo).
    // El umbral es 20, no 8: lo que esta prueba caza es el O(G × U), y 20 lo
    // sigue cazando con un factor de 4 de margen. Los 8 se eligieron midiendo en
    // una máquina en reposo y se cayeron dos veces el 28-jul —10.8 y 8.2— con
    // siete agentes y dos servidores encima. El denominador es el caso PEQUEÑO,
    // que es tan rápido que el ruido lo domina: apretar el umbral no mide mejor
    // el algoritmo, solo hace que la prueba falle más seguido por razones ajenas.
    expect(b.ms / a.ms).toBeLessThan(20);
  });
});
