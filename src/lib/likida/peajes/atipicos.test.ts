import { describe, expect, it } from 'vitest';
import {
  CONFIG_ATIPICOS_DEFAULT, detectarAtipicos, instanteMx, validarConfigAtipicos, type CruceEntrada,
} from './atipicos';
import type { CasetaCatalogo } from './casetas';

const cruce = (unidad: string, caseta: string, fecha: string, hora: string, monto = 100): CruceEntrada =>
  ({ unidad_archivo: unidad, caseta, fecha, hora, monto });

const cat = (id: string, nombre: string, lat: number, lng: number, alias: string[] = []): CasetaCatalogo =>
  ({ id, nombre, nombreNorm: nombre.toLowerCase(), alias, lat, lng, radioM: 300 });

// Casetas sintéticas (no corresponden a casetas reales): ~400 km entre una y otra.
const NORTE = cat('c1', 'Caseta Norte', 25.0, -100.0);
const SUR = cat('c2', 'Caseta Sur', 21.4, -100.0);
const SIN_COORD = [{ id: 'c3', nombre: 'Caseta Ciega', nombreNorm: 'caseta ciega', alias: [], lat: Number.NaN, lng: Number.NaN, radioM: 300 }] as CasetaCatalogo[];

describe('detectarAtipicos — repeticion_caseta', () => {
  it('6 cruces a la misma caseta en 5 h dan 1 hallazgo con n=6', () => {
    const f = [0, 1, 2, 3, 4, 5].map((h) => cruce('TC9001', 'Caseta Norte', '2026-03-10', `${String(8 + h).padStart(2, '0')}:00`, 50));
    const r = detectarAtipicos(f);
    expect(r.hallazgos).toHaveLength(1);
    expect(r.hallazgos[0]).toMatchObject({ regla: 'repeticion_caseta', unidad: 'TC9001', nCruces: 6, monto: 300 });
    expect(r.hallazgos[0].quePaso).toContain('6 veces');
    expect(r.hallazgos[0].queSignifica).toContain('no necesariamente error');
    expect(r.hallazgos[0].queHacer).toContain('Pregunta al operador');
    expect(r.hallazgos[0].llave).toContain('repeticion_caseta|TC9001|');
  });

  it('3 cruces no alcanzan el umbral por defecto', () => {
    const f = ['08:00', '09:00', '10:00'].map((h) => cruce('TC9001', 'Caseta Norte', '2026-03-10', h));
    expect(detectarAtipicos(f).hallazgos).toEqual([]);
  });

  it('cruces fuera de la ventana no se juntan', () => {
    const f = ['01:00', '08:00', '15:00', '22:00'].map((h) => cruce('TC9001', 'Caseta Norte', '2026-03-10', h));
    expect(detectarAtipicos(f).hallazgos).toEqual([]);
  });

  it('ventana deslizante: cruces solapados forman UN hallazgo, no uno por ventana', () => {
    // 8 cruces cada 2 h: toda ventana de 6 h tiene 4 → una sola racha encadenada.
    const f = Array.from({ length: 8 }, (_, i) => cruce('TC9001', 'Caseta Norte', '2026-03-10', `${String(i * 2 + 1).padStart(2, '0')}:00`));
    const r = detectarAtipicos(f);
    expect(r.hallazgos).toHaveLength(1);
    expect(r.hallazgos[0].nCruces).toBe(8);
  });

  it('dos rachas separadas dan dos hallazgos con llaves distintas', () => {
    const dia = (d: string) => [0, 1, 2, 3].map((h) => cruce('TC9001', 'Caseta Norte', d, `${String(8 + h).padStart(2, '0')}:00`));
    const r = detectarAtipicos([...dia('2026-03-10'), ...dia('2026-03-12')]);
    expect(r.hallazgos).toHaveLength(2);
    expect(new Set(r.hallazgos.map((h) => h.llave)).size).toBe(2);
  });

  it('la regla se puede apagar y el umbral configurar', () => {
    const f = ['08:00', '09:00', '10:00'].map((h) => cruce('TC9001', 'Caseta Norte', '2026-03-10', h));
    expect(detectarAtipicos(f, { repeticion_caseta: { minCruces: 3 } }).hallazgos).toHaveLength(1);
    expect(detectarAtipicos(f, { repeticion_caseta: { minCruces: 3, activa: false } }).hallazgos).toEqual([]);
  });

  it('con catálogo, un alias de la misma caseta cuenta como la misma caseta física', () => {
    const catalogo = [cat('c1', 'Caseta Norte', 25, -100, ['Norte Cuerpo A'])];
    const f = [
      cruce('TC9001', 'Caseta Norte', '2026-03-10', '08:00'), cruce('TC9001', 'Norte Cuerpo A', '2026-03-10', '09:00'),
      cruce('TC9001', 'Caseta Norte', '2026-03-10', '10:00'), cruce('TC9001', 'Norte Cuerpo A', '2026-03-10', '11:00'),
    ];
    expect(detectarAtipicos(f, {}, catalogo).hallazgos.filter((h) => h.regla === 'repeticion_caseta')).toHaveLength(1);
    expect(detectarAtipicos(f).hallazgos).toEqual([]); // sin catálogo, nombres distintos
  });

  it('unidades distintas no se mezclan', () => {
    const f = [
      cruce('TC9001', 'Caseta Norte', '2026-03-10', '08:00'), cruce('TC9002', 'Caseta Norte', '2026-03-10', '08:30'),
      cruce('TC9001', 'Caseta Norte', '2026-03-10', '09:00'), cruce('TC9002', 'Caseta Norte', '2026-03-10', '09:30'),
      cruce('TC9001', 'Caseta Norte', '2026-03-10', '10:00'), cruce('TC9002', 'Caseta Norte', '2026-03-10', '10:30'),
    ];
    expect(detectarAtipicos(f).hallazgos).toEqual([]);
    const g = detectarAtipicos([...f, cruce('TC9001', 'Caseta Norte', '2026-03-10', '11:00')]);
    expect(g.hallazgos).toHaveLength(1);
    expect(g.hallazgos[0].unidad).toBe('TC9001');
  });
});

describe('detectarAtipicos — ida_y_vuelta_madrugada', () => {
  const noche = ['00:30', '02:00', '03:15', '04:40'].map((h) => cruce('TC9002', 'Caseta Norte', '2026-03-10', h));
  it('viene apagada por defecto', () => {
    expect(CONFIG_ATIPICOS_DEFAULT.ida_y_vuelta_madrugada.activa).toBe(false);
    expect(detectarAtipicos(noche.slice(0, 3), { repeticion_caseta: { activa: false } }).hallazgos).toEqual([]);
  });
  it('encendida, 4 cruces de madrugada dan 1 hallazgo; 2 no', () => {
    const cfg = { repeticion_caseta: { activa: false }, ida_y_vuelta_madrugada: { activa: true } };
    const r = detectarAtipicos(noche, cfg);
    expect(r.hallazgos).toHaveLength(1);
    expect(r.hallazgos[0]).toMatchObject({ regla: 'ida_y_vuelta_madrugada', nCruces: 4 });
    expect(detectarAtipicos(noche.slice(0, 2), cfg).hallazgos).toEqual([]);
  });
  it('cruces a las 05:00 o después no cuentan como madrugada', () => {
    const f = ['05:00', '05:30', '06:00'].map((h) => cruce('TC9002', 'Caseta Norte', '2026-03-10', h));
    expect(detectarAtipicos(f, { repeticion_caseta: { activa: false }, ida_y_vuelta_madrugada: { activa: true } }).hallazgos).toEqual([]);
  });
});

describe('detectarAtipicos — secuencia_imposible', () => {
  it('dos casetas a ~400 km en 20 min es imposible', () => {
    const f = [cruce('TC9001', 'Caseta Norte', '2026-03-10', '10:00'), cruce('TC9001', 'Caseta Sur', '2026-03-10', '10:20')];
    const r = detectarAtipicos(f, {}, [NORTE, SUR]);
    expect(r.hallazgos).toHaveLength(1);
    expect(r.hallazgos[0]).toMatchObject({ regla: 'secuencia_imposible', nCruces: 2, unidad: 'TC9001' });
    expect(r.hallazgos[0].casetas).toEqual(['Caseta Norte', 'Caseta Sur']);
    expect(r.reglasNoAplicadas).toEqual([]);
  });
  it('con tiempo suficiente (5 h) no lo es', () => {
    const f = [cruce('TC9001', 'Caseta Norte', '2026-03-10', '10:00'), cruce('TC9001', 'Caseta Sur', '2026-03-10', '15:00')];
    expect(detectarAtipicos(f, {}, [NORTE, SUR]).hallazgos).toEqual([]);
  });
  it('sin catálogo: regla no aplicada con motivo', () => {
    const f = [cruce('TC9001', 'Caseta Norte', '2026-03-10', '10:00'), cruce('TC9001', 'Caseta Sur', '2026-03-10', '10:20')];
    const r = detectarAtipicos(f);
    expect(r.hallazgos).toEqual([]);
    expect(r.reglasNoAplicadas).toEqual([{ regla: 'secuencia_imposible', motivo: expect.stringContaining('catálogo sin coordenadas') }]);
  });
  it('una caseta sin coordenadas deja ese par sin evaluar y lo dice', () => {
    const f = [cruce('TC9001', 'Caseta Norte', '2026-03-10', '10:00'), cruce('TC9001', 'Caseta Ciega', '2026-03-10', '10:20')];
    const r = detectarAtipicos(f, {}, [NORTE, ...SIN_COORD]);
    expect(r.hallazgos).toEqual([]);
    expect(r.reglasNoAplicadas[0].regla).toBe('secuencia_imposible');
    expect(r.reglasNoAplicadas[0].motivo).toContain('1 par');
  });
  it('apagada no avisa nada de no aplicada', () => {
    const f = [cruce('TC9001', 'Caseta Norte', '2026-03-10', '10:00'), cruce('TC9001', 'Caseta Sur', '2026-03-10', '10:20')];
    expect(detectarAtipicos(f, { secuencia_imposible: { activa: false } }).reglasNoAplicadas).toEqual([]);
  });
  it('cruces de unidades distintas no forman una secuencia', () => {
    const f = [cruce('TC9001', 'Caseta Norte', '2026-03-10', '10:00'), cruce('TC9002', 'Caseta Sur', '2026-03-10', '10:20')];
    expect(detectarAtipicos(f, {}, [NORTE, SUR]).hallazgos).toEqual([]);
  });
  it('el cambio de horario cuenta tiempo real: 01:30→03:30 del 3-abr-2022 son 60 min, no 120', () => {
    // 2022-04-03 en México el reloj saltó de 02:00 a 03:00.
    expect(((instanteMx('2022-04-03', '03:30') as number) - (instanteMx('2022-04-03', '01:30') as number)) / 60_000).toBe(60);
    // 01:00→04:00 de reloj son 2 h reales: ~400 km / 2 h = ~200 km/h > 150.
    // Con reloj de pared (3 h) serían ~133 km/h y NO se marcaría: esta prueba distingue ambos.
    const f = [cruce('TC9001', 'Caseta Norte', '2022-04-03', '01:00'), cruce('TC9001', 'Caseta Sur', '2022-04-03', '04:00')];
    expect(detectarAtipicos(f, { secuencia_imposible: { velocidadMaxKmh: 150 } }, [NORTE, SUR]).hallazgos).toHaveLength(1);
    // El mismo recorrido en un día sin cambio de horario (3 h reales, ~133 km/h) no se marca con 150.
    const g = [cruce('TC9001', 'Caseta Norte', '2022-05-03', '01:00'), cruce('TC9001', 'Caseta Sur', '2022-05-03', '04:00')];
    expect(detectarAtipicos(g, { secuencia_imposible: { velocidadMaxKmh: 150 } }, [NORTE, SUR]).hallazgos).toEqual([]);
  });
});

describe('detectarAtipicos — propiedades', () => {
  const base = [
    ...[0, 1, 2, 3, 4].map((h) => cruce('TC9001', 'Caseta Norte', '2026-03-10', `${String(8 + h).padStart(2, '0')}:10`, 40 + h)),
    cruce('TC9002', 'Caseta Sur', '2026-03-10', '09:00'), cruce('TC9002', 'Caseta Norte', '2026-03-10', '09:15'),
    ...[0, 1, 2, 3].map((h) => cruce('TC9002', 'Caseta Norte', '2026-03-11', `0${h}:20`)),
  ];
  const cfg = { ida_y_vuelta_madrugada: { activa: true } };
  it('barajar las filas no cambia la salida', () => {
    const ref = detectarAtipicos(base, cfg, [NORTE, SUR]);
    expect(ref.hallazgos.length).toBeGreaterThanOrEqual(3);
    let semilla = 7;
    for (let k = 0; k < 5; k++) {
      const m = [...base];
      for (let i = m.length - 1; i > 0; i--) { semilla = (semilla * 1103515245 + 12345) % 2147483648; const j = semilla % (i + 1); [m[i], m[j]] = [m[j], m[i]]; }
      expect(detectarAtipicos(m, cfg, [NORTE, SUR])).toEqual(ref);
    }
  });
  it('misma entrada, mismas llaves (idempotencia)', () => {
    expect(detectarAtipicos(base, cfg, [NORTE, SUR]).hallazgos.map((h) => h.llave))
      .toEqual(detectarAtipicos(base, cfg, [NORTE, SUR]).hallazgos.map((h) => h.llave));
  });
  it('filas sin unidad, caseta u hora válida se cuentan como omitidas', () => {
    const r = detectarAtipicos([
      cruce('', 'Caseta Norte', '2026-03-10', '08:00'), cruce('TC9001', '', '2026-03-10', '08:00'),
      cruce('TC9001', 'Caseta Norte', '2026-13-45', '08:00'), cruce('TC9001', 'Caseta Norte', '2026-03-10', 'x'),
    ]);
    expect(r.filasOmitidas).toBe(4);
    expect(r.hallazgos).toEqual([]);
  });
  it('configuración absurda: se usa la de partida y se avisa', () => {
    const r = detectarAtipicos([], { repeticion_caseta: { minCruces: 1 } });
    expect(r.reglasNoAplicadas[0].motivo).toContain('Configuración inválida');
    expect(validarConfigAtipicos(CONFIG_ATIPICOS_DEFAULT)).toBeNull();
  });
  it('60 000 filas sintéticas se procesan en menos de 5 s', () => {
    const filas: CruceEntrada[] = [];
    for (let u = 0; u < 250; u++) {
      for (let i = 0; i < 240; i++) {
        const dia = 1 + (i % 28);
        filas.push(cruce(`TC${9000 + u}`, `Caseta ${i % 40}`, `2026-03-${String(dia).padStart(2, '0')}`, `${String((i * 7) % 24).padStart(2, '0')}:${String((i * 13) % 60).padStart(2, '0')}`));
      }
    }
    expect(filas).toHaveLength(60_000);
    const t0 = Date.now();
    const r = detectarAtipicos(filas, { ida_y_vuelta_madrugada: { activa: true } }, [NORTE, SUR]);
    const ms = Date.now() - t0;
    expect(r.filasOmitidas).toBe(0);
    expect(ms).toBeLessThan(5000);
  });
});
