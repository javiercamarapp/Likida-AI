import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fechaMx, litros, TZ_MX } from './utils';
import { fechaMx as fechaDelPanel, litros as litrosDelPanel } from '@/app/dashboard/formato';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 6 · CRÍTICO de arquitectura — EL PAPEL Y LA PANTALLA FECHABAN
// DISTINTO EL MISMO HECHO.
//
// La ronda 5 encontró que `.slice(0,10)` sobre un `timestamptz` se queda con la
// fecha UTC, y CST es UTC−6: todo lo cerrado después de las 18:00 hora local
// sale fechado al día siguiente. Las liquidaciones se cierran al terminar el
// viaje, de noche; en el corte mensual, una del 31 de julio aparecía en agosto.
//
// Ayer se arregló EL PANEL y no el PDF —"el papel que se archiva"—, que siguió
// con `toLocaleDateString` sin `timeZone`, o sea con la del servidor: UTC en
// Vercel. El comentario del archivo nuevo lo admitía por escrito.
//
// Aquí se fija que hay UNA implementación y que el PDF la usa.
// ═══════════════════════════════════════════════════════════════════════════

// 31-jul-2026, 19:30 en México (CST, UTC−6) = 01:30 UTC del 1-ago.
const CIERRE_NOCTURNO = '2026-08-01T01:30:00.000Z';

describe('la fecha del cierre nocturno, que es el caso normal', () => {
  it('es 31 de julio, no 1 de agosto', () => {
    expect(fechaMx(CIERRE_NOCTURNO)).toContain('31');
    expect(fechaMx(CIERRE_NOCTURNO)).toContain('jul');
  });

  it('el panel y el papel dicen exactamente lo mismo', () => {
    expect(fechaDelPanel(CIERRE_NOCTURNO)).toBe(fechaMx(CIERRE_NOCTURNO));
    expect(litrosDelPanel(1234.56)).toBe(litros(1234.56));
  });

  it('una fecha ausente o ilegible es una raya, no "Invalid Date"', () => {
    expect(fechaMx(undefined)).toBe('—');
    expect(fechaMx(null)).toBe('—');
    expect(fechaMx('no es una fecha')).toBe('—');
  });

  it('la zona es la del cliente, no la del servidor', () => {
    expect(TZ_MX).toBe('America/Mexico_City');
  });
});

describe('el PDF no puede volver a tener su propia copia', () => {
  // LA RED QUE FALTABA, y es la que mide el rubro: el bug no fue una fecha mal
  // formateada, fue DOS implementaciones de la misma verdad separándose. Una
  // prueba sobre valores no lo habría visto —cada copia pasaba su propia
  // prueba—; hay que mirar que no haya segunda copia.
  const PDF = readFileSync('src/lib/cuadra/liquidacion/pdf.ts', 'utf8');

  it('usa la fecha compartida', () => {
    expect(PDF).toContain("from '@/lib/utils'");
    expect(PDF).toMatch(/fechaMx/);
  });

  it('y no formatea fechas por su cuenta', () => {
    // `toLocaleDateString` sin `timeZone` es exactamente el bug: toma la del
    // servidor, que en Vercel es UTC.
    expect(PDF).not.toMatch(/toLocaleDateString/);
  });
});
