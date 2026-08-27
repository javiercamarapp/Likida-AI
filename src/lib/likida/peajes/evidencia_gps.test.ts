import { describe, it, expect } from 'vitest';
import {
  evidenciaDeLinea, resumirEvidencia, llaveUnidadDia,
  type LineaParaEvidencia, type EvidenciaGpsLinea,
} from './evidencia_gps';

// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCIA GPS DE LOS CRUCES (post-plan-maestro #1, el "martirio" de
// Innovativos). Lo que estas pruebas fijan es la HONESTIDAD del clasificador:
//
//  · afirma evidencia SOLO con posiciones de ESA unidad ESE día;
//  · cada hueco dice su motivo exacto (fail-closed accionable);
//  · NO existe cubeta "inconsistente" en v1 — sin lat/lng de casetas
//    (ficha red-nacional-autopistas: no hay catálogo oficial) acusar
//    lejanía sería evidencia a medias. Si alguien la agrega sin el
//    escalón espacial, el tipo EvidenciaGpsLinea deja de compilar aquí.
// ═══════════════════════════════════════════════════════════════════════════

const linea = (over: Partial<LineaParaEvidencia> = {}): LineaParaEvidencia => ({
  id: 'l1', fecha: '2026-08-20', viajeId: 'v1', ...over,
});

const unidadPorViaje = new Map<string, string | null>([['v1', 'u1'], ['v2', null]]);
const posiciones = new Map<string, number>([
  [llaveUnidadDia('u1', '2026-08-20'), 87],
  [llaveUnidadDia('u1', '2026-08-21'), 3],
]);

describe('evidenciaDeLinea — cada rama dice la verdad exacta', () => {
  it('con posiciones de la unidad el día del cruce → con_evidencia, con el conteo', () => {
    expect(evidenciaDeLinea(linea(), unidadPorViaje, posiciones))
      .toEqual({ estatus: 'con_evidencia', posicionesDia: 87 });
  });

  it('el día es EL DEL CRUCE, sin ±1: posiciones de ayer no son evidencia de hoy', () => {
    // u1 tiene 87 posiciones el 20 y 3 el 21 — el cruce del 19 no tiene nada.
    expect(evidenciaDeLinea(linea({ fecha: '2026-08-19' }), unidadPorViaje, posiciones))
      .toEqual({ estatus: 'sin_evidencia', motivo: 'sin_posiciones_dia' });
  });

  it('sin fecha legible → sin_fecha (no se inventa un día contra qué mirar)', () => {
    expect(evidenciaDeLinea(linea({ fecha: null }), unidadPorViaje, posiciones))
      .toEqual({ estatus: 'sin_evidencia', motivo: 'sin_fecha' });
  });

  it('línea que no cuadró contra ningún viaje → sin_viaje (no se sabe la unidad)', () => {
    expect(evidenciaDeLinea(linea({ viajeId: null }), unidadPorViaje, posiciones))
      .toEqual({ estatus: 'sin_evidencia', motivo: 'sin_viaje' });
  });

  it('viaje sin unidad asignada → viaje_sin_unidad', () => {
    expect(evidenciaDeLinea(linea({ viajeId: 'v2' }), unidadPorViaje, posiciones))
      .toEqual({ estatus: 'sin_evidencia', motivo: 'viaje_sin_unidad' });
  });

  it('viaje que el mapa no conoce (carrera/borrado) → viaje_sin_unidad, no revienta', () => {
    expect(evidenciaDeLinea(linea({ viajeId: 'v-fantasma' }), unidadPorViaje, posiciones))
      .toEqual({ estatus: 'sin_evidencia', motivo: 'viaje_sin_unidad' });
  });

  it('unidad conocida con CERO posiciones ese día → sin_posiciones_dia (GPS sin conectar o hueco)', () => {
    expect(evidenciaDeLinea(linea(), unidadPorViaje, new Map()))
      .toEqual({ estatus: 'sin_evidencia', motivo: 'sin_posiciones_dia' });
  });

  it('las posiciones de OTRA unidad no prestan evidencia', () => {
    const soloOtra = new Map([[llaveUnidadDia('u-ajena', '2026-08-20'), 500]]);
    expect(evidenciaDeLinea(linea(), unidadPorViaje, soloOtra))
      .toEqual({ estatus: 'sin_evidencia', motivo: 'sin_posiciones_dia' });
  });
});

describe('resumirEvidencia — el agregado que ve el contralor', () => {
  it('cuenta cada cubeta y desglosa el hueco por motivo', () => {
    const clasificadas: EvidenciaGpsLinea[] = [
      { estatus: 'con_evidencia', posicionesDia: 87 },
      { estatus: 'con_evidencia', posicionesDia: 3 },
      { estatus: 'sin_evidencia', motivo: 'sin_viaje' },
      { estatus: 'sin_evidencia', motivo: 'sin_viaje' },
      { estatus: 'sin_evidencia', motivo: 'sin_posiciones_dia' },
      { estatus: 'sin_evidencia', motivo: 'sin_fecha' },
    ];
    expect(resumirEvidencia(clasificadas)).toEqual({
      total: 6,
      conEvidencia: 2,
      sinEvidencia: 4,
      porMotivo: { sin_fecha: 1, sin_viaje: 2, viaje_sin_unidad: 0, sin_posiciones_dia: 1 },
    });
  });

  it('vacío → todo en cero, nunca NaN', () => {
    expect(resumirEvidencia([])).toEqual({
      total: 0, conEvidencia: 0, sinEvidencia: 0,
      porMotivo: { sin_fecha: 0, sin_viaje: 0, viaje_sin_unidad: 0, sin_posiciones_dia: 0 },
    });
  });
});
