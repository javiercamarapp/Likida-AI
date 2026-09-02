import { describe, it, expect } from 'vitest';
import { componerJornada, type Asiento, type TipoAsiento } from './modelo';
import { evaluarSemanas, lunesDe, type EntradaDiaSemana } from './semanas';

// ═══════════════════════════════════════════════════════════════════════════
// TABLEROS AL DÍA (28-ago-2026) — el eje semanal LFT gana su primer llamador.
//
// `evaluarRiesgoSemana`, el tope del Transitorio Segundo, el art. 69 y
// `horas_min_entre_jornadas` estaban escritos, probados y sin un solo
// consumidor. Este módulo es el pegamento puro pantalla→lib, y lo que estas
// pruebas fijan son sus DOS reglas: solo semanas enteras (media semana daría
// un falso «va bien» construido con el recorte) y un día sin expediente NO
// son cero horas (entra como jornada vacía y la semana se niega a concluir).
// ═══════════════════════════════════════════════════════════════════════════

let n = 0;
function asiento(tipo: TipoAsiento, momento: string): Asiento {
  n += 1;
  return {
    id: `a-${n}`, tipo, momento, procedencia: 'declarado_operador',
    origenRef: null, waMessageId: null, viajeId: null, registradoPorEmail: null,
    nota: null, corrigeA: null, anuladoEn: null, anuladoPorEmail: null, anuladoMotivo: null,
  };
}

/** Un día trabajado de `horas` horas (jornada compuesta REAL, no utilería). */
function diaTrabajado(operadorId: string, dia: string, horas: number): EntradaDiaSemana {
  return {
    operadorId, operadorNombre: `Operador ${operadorId}`, dia,
    jornada: componerJornada([
      asiento('inicio_jornada', `${dia}T08:00:00-06:00`),
      asiento('fin_jornada', `${dia}T${String(8 + horas).padStart(2, '0')}:00:00-06:00`),
    ]),
  };
}

// La semana lunes 2026-08-17 … domingo 2026-08-23, entera.
const LUNES = '2026-08-17';
const SEMANA = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'];

describe('lunesDe', () => {
  it('encuentra el lunes desde cualquier día de la semana', () => {
    expect(lunesDe('2026-08-17')).toBe('2026-08-17'); // lunes
    expect(lunesDe('2026-08-20')).toBe('2026-08-17'); // jueves
    expect(lunesDe('2026-08-23')).toBe('2026-08-17'); // domingo
  });
});

describe('evaluarSemanas — solo semanas enteras, y los huecos no son cero', () => {
  it('una semana completa que rebasa las 48 h de 2026 sale en exceso, con el transitorio citado', () => {
    // 6 días de 9 h = 54 h contra las 48 ordinarias de 2026 (+9 de extra):
    // 6 h por encima, dentro del margen de extra → señal sin exceso duro.
    // 7 días de 9 h = 63 h → 15 h por encima, rebasa también las 9 de extra.
    const entradas = SEMANA.map((d) => diaTrabajado('o-1', d, 9));
    const [s] = evaluarSemanas(entradas, null, LUNES, '2026-08-23');
    expect(s.riesgo.horasMedidas).toBe(63);
    expect(s.riesgo.topeOrdinariaHoras).toBe(48);
    expect(s.riesgo.veredicto).toBe('exceso');
    expect(s.riesgo.senales.some((x) => x.clase === 'exceso_semanal')).toBe(true);
    // Y con 7 días trabajados, el art. 69 también levanta la mano.
    expect(s.riesgo.senales.some((x) => x.clase === 'sin_dia_de_descanso_lft_69')).toBe(true);
  });

  it('un día sin expediente NO son cero horas: la semana se niega a concluir y dice cuál falta', () => {
    const entradas = SEMANA.filter((d) => d !== '2026-08-20').map((d) => diaTrabajado('o-1', d, 9));
    const [s] = evaluarSemanas(entradas, null, LUNES, '2026-08-23');
    expect(s.riesgo.veredicto).toBe('dato_insuficiente');
    expect(s.riesgo.horasMedidas).toBeNull();
    expect(s.diasSinExpediente).toEqual(['2026-08-20']);
    expect(s.riesgo.diasSinDato).toContain('2026-08-20');
  });

  it('media semana visible NO se evalúa: sumar el recorte daría un falso «va bien»', () => {
    const entradas = SEMANA.map((d) => diaTrabajado('o-1', d, 9));
    // La ventana corta el domingo: la semana ya no está entera adentro.
    expect(evaluarSemanas(entradas, null, LUNES, '2026-08-22')).toEqual([]);
  });

  it('un operador sin un solo expediente en la semana no genera renglón de ruido', () => {
    const entradas = [diaTrabajado('o-1', '2026-08-17', 8)];
    const semanas = evaluarSemanas(entradas, null, LUNES, '2026-08-23');
    expect(semanas).toHaveLength(1);
    expect(semanas[0].operadorId).toBe('o-1');
  });

  it('horas_min_entre_jornadas por fin produce señal: el campo capturable deja de estar muerto', () => {
    // Dos días seguidos: fin 23:00 → inicio 07:00 = 8 h entre jornadas,
    // contra las 11 h declaradas por la flota. El resto de la semana normal.
    const entradas: EntradaDiaSemana[] = [
      {
        operadorId: 'o-1', operadorNombre: 'Operador o-1', dia: '2026-08-17',
        jornada: componerJornada([
          asiento('inicio_jornada', '2026-08-17T14:00:00-06:00'),
          asiento('fin_jornada', '2026-08-17T23:00:00-06:00'),
        ]),
      },
      {
        operadorId: 'o-1', operadorNombre: 'Operador o-1', dia: '2026-08-18',
        jornada: componerJornada([
          asiento('inicio_jornada', '2026-08-18T07:00:00-06:00'),
          asiento('fin_jornada', '2026-08-18T15:00:00-06:00'),
        ]),
      },
      ...SEMANA.slice(2).map((d) => diaTrabajado('o-1', d, 4)),
    ];
    const politica = { horasMaxJornada: null, minutosMinDescanso: null, horasMinEntreJornadas: 11, fundamento: null };
    const [s] = evaluarSemanas(entradas, politica, LUNES, '2026-08-23');
    expect(s.riesgo.senales.some((x) => x.clase === 'exceso_tope_flota')).toBe(true);
  });

  it('el orden es estable: por nombre y luego por semana — la lista no baila', () => {
    const entradas = [
      diaTrabajado('o-2', '2026-08-18', 8),
      diaTrabajado('o-1', '2026-08-19', 8),
    ];
    const semanas = evaluarSemanas(entradas, null, LUNES, '2026-08-23');
    expect(semanas.map((s) => s.operadorId)).toEqual(['o-1', 'o-2']);
  });
});
