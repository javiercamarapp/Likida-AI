import { describe, it, expect } from 'vitest';
import { bucketsPorDia } from './actividad';
import { hoyMx } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// `bucketsPorDia` es la única lógica nueva y no probada de `actividad.tsx`
// (BarChartSimple/AreaChartSimple ya se prueban donde viven). Lo que hay que
// comprobar: cuenta por STRING, no por `Date` — `fechaInicio` es columna
// `date` (sin hora), y convertirla a `Date` y de vuelta a ISO corre el riesgo
// del mismo bug que ya se pagó con `created_at` en `getLiquidacionesPorDia`
// (un timestamptz que fechaba el día siguiente).
// ═══════════════════════════════════════════════════════════════════════════

// FE-20: `bucketsPorDia` ya NO lee el reloj — el día se lo pasa el servidor.
// Eso hace que estas pruebas dejen de depender de a qué hora se corran (antes
// fallaban de noche, y el comentario que estaba aquí lo explicaba con
// `setHours(0,0,0,0)`, el mismo parche que le costaba al componente un
// mismatch de hidratación). HOY es un día FIJO, escrito.
const HOY = '2026-08-22';
const hoyIso = () => HOY;
const haceNDiasIso = (n: number) => {
  const d = new Date(`${HOY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

describe('bucketsPorDia', () => {
  it('devuelve exactamente `dias` buckets, terminando en hoy', () => {
    const buckets = bucketsPorDia([], 7, HOY);
    expect(buckets).toHaveLength(7);
    expect(buckets[6].dia).toBe(hoyIso());
    expect(buckets[0].dia).toBe(haceNDiasIso(6));
  });

  it('cuenta un viaje de hoy en el último bucket', () => {
    const buckets = bucketsPorDia([{ fechaInicio: hoyIso() }], 7, HOY);
    expect(buckets[6].valor).toBe(1);
    expect(buckets.slice(0, 6).every((b) => b.valor === 0)).toBe(true);
  });

  it('varios viajes el mismo día se suman en el mismo bucket', () => {
    const dia = haceNDiasIso(2);
    const buckets = bucketsPorDia(
      [{ fechaInicio: dia }, { fechaInicio: dia }, { fechaInicio: dia }],
      7, HOY,
    );
    const bucket = buckets.find((b) => b.dia === dia);
    expect(bucket?.valor).toBe(3);
  });

  it('un viaje fuera de la ventana no se cuenta', () => {
    const fueraDeRango = haceNDiasIso(30);
    const buckets = bucketsPorDia([{ fechaInicio: fueraDeRango }], 7, HOY);
    expect(buckets.every((b) => b.valor === 0)).toBe(true);
  });

  it('fechaInicio null se ignora, no revienta', () => {
    const buckets = bucketsPorDia([{ fechaInicio: null }, { fechaInicio: hoyIso() }], 7, HOY);
    expect(buckets[6].valor).toBe(1);
  });

  it('ventana de 30 días también cierra en hoy', () => {
    const buckets = bucketsPorDia([], 30, HOY);
    expect(buckets).toHaveLength(30);
    expect(buckets[29].dia).toBe(hoyIso());
    expect(buckets[0].dia).toBe(haceNDiasIso(29));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FE-20 — EL DÍA LO PONE EL SERVIDOR, Y ES EL DE MÉXICO.
//
// `bucketsPorDia` corre DOS veces (servidor al pintar, navegador al hidratar).
// Mientras leía `new Date()` cada uno usaba su propio reloj y su propia zona:
// a las 19:00 del 31 de diciembre el servidor (UTC) decía 1-ene y el navegador
// del contralor (México) decía 31-dic. Distinto HTML = mismatch de hidratación
// y barras que parpadean. La prueba fija ese instante exacto y comprueba que
// `hoyMx` —lo que la página server le pasa— cierra la ventana el 31.
// ═══════════════════════════════════════════════════════════════════════════
describe('bucketsPorDia a las 19:00 del 31 de diciembre (hora de México)', () => {
  const NOCHEVIEJA_19_MX = new Date('2027-01-01T01:00:00Z');

  it('el servidor resuelve el día de México, no el UTC', () => {
    expect(hoyMx(NOCHEVIEJA_19_MX)).toBe('2026-12-31');
    // El día UTC de ese mismo instante — el que se usaba antes.
    expect(NOCHEVIEJA_19_MX.toISOString().slice(0, 10)).toBe('2027-01-01');
  });

  it('la ventana cierra el 31 de diciembre y cuenta el viaje de ese día', () => {
    const buckets = bucketsPorDia([{ fechaInicio: '2026-12-31' }], 7, hoyMx(NOCHEVIEJA_19_MX));
    expect(buckets[6].dia).toBe('2026-12-31');
    expect(buckets[6].valor).toBe(1);
    expect(buckets[0].dia).toBe('2026-12-25');
  });

  it('y NO abre una barra del 1 de enero, que todavía no existe', () => {
    const buckets = bucketsPorDia([], 7, hoyMx(NOCHEVIEJA_19_MX));
    expect(buckets.some((b) => b.dia === '2027-01-01')).toBe(false);
  });

  it('el mismo `hoy` da el mismo resultado las veces que se llame (servidor = cliente)', () => {
    const hoy = hoyMx(NOCHEVIEJA_19_MX);
    expect(bucketsPorDia([], 7, hoy)).toEqual(bucketsPorDia([], 7, hoy));
  });
});
