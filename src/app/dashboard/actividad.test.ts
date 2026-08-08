import { describe, it, expect } from 'vitest';
import { bucketsPorDia } from './actividad';

// ═══════════════════════════════════════════════════════════════════════════
// `bucketsPorDia` es la única lógica nueva y no probada de `actividad.tsx`
// (BarChartSimple/AreaChartSimple ya se prueban donde viven). Lo que hay que
// comprobar: cuenta por STRING, no por `Date` — `fechaInicio` es columna
// `date` (sin hora), y convertirla a `Date` y de vuelta a ISO corre el riesgo
// del mismo bug que ya se pagó con `created_at` en `getLiquidacionesPorDia`
// (un timestamptz que fechaba el día siguiente).
// ═══════════════════════════════════════════════════════════════════════════

const hoyIso = () => new Date().toISOString().slice(0, 10);
const haceNDiasIso = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

describe('bucketsPorDia', () => {
  it('devuelve exactamente `dias` buckets, terminando en hoy', () => {
    const buckets = bucketsPorDia([], 7);
    expect(buckets).toHaveLength(7);
    expect(buckets[6].dia).toBe(hoyIso());
    expect(buckets[0].dia).toBe(haceNDiasIso(6));
  });

  it('cuenta un viaje de hoy en el último bucket', () => {
    const buckets = bucketsPorDia([{ fechaInicio: hoyIso() }], 7);
    expect(buckets[6].valor).toBe(1);
    expect(buckets.slice(0, 6).every((b) => b.valor === 0)).toBe(true);
  });

  it('varios viajes el mismo día se suman en el mismo bucket', () => {
    const dia = haceNDiasIso(2);
    const buckets = bucketsPorDia(
      [{ fechaInicio: dia }, { fechaInicio: dia }, { fechaInicio: dia }],
      7,
    );
    const bucket = buckets.find((b) => b.dia === dia);
    expect(bucket?.valor).toBe(3);
  });

  it('un viaje fuera de la ventana no se cuenta', () => {
    const fueraDeRango = haceNDiasIso(30);
    const buckets = bucketsPorDia([{ fechaInicio: fueraDeRango }], 7);
    expect(buckets.every((b) => b.valor === 0)).toBe(true);
  });

  it('fechaInicio null se ignora, no revienta', () => {
    const buckets = bucketsPorDia([{ fechaInicio: null }, { fechaInicio: hoyIso() }], 7);
    expect(buckets[6].valor).toBe(1);
  });

  it('ventana de 30 días también cierra en hoy', () => {
    const buckets = bucketsPorDia([], 30);
    expect(buckets).toHaveLength(30);
    expect(buckets[29].dia).toBe(hoyIso());
    expect(buckets[0].dia).toBe(haceNDiasIso(29));
  });
});
