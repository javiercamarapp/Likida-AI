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
  const PDF = readFileSync('src/lib/likida/liquidacion/pdf.ts', 'utf8');

  it('usa la fecha compartida', () => {
    // Se comprueba la FUNCIÓN, no el módulo del que viene. La primera versión
    // exigía `from '@/lib/utils'` y se rompió al mover el formato a
    // `formato.ts` —un archivo sin dependencias, para que el motor y el PDF no
    // arrastren clsx ni tailwind-merge—. Fijar la ruta del import convierte un
    // refactor correcto en una prueba roja, que es ruido, no protección.
    expect(PDF).toMatch(/import \{[^}]*fechaMx[^}]*\} from '@\/lib\/(utils|formato)'/);
  });

  it('y no formatea fechas por su cuenta', () => {
    // `toLocaleDateString` sin `timeZone` es exactamente el bug: toma la del
    // servidor, que en Vercel es UTC.
    expect(PDF).not.toMatch(/toLocaleDateString/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1-ago-2026 · Y AL ARREGLAR EL TIMESTAMPTZ SE ROMPIÓ EL `date` PURO.
//
// Se vio en el PRIMER PDF real: las once fechas de comprobantes salían un día
// antes. Y el documento se contradecía solo — la tabla decía «18 jun 2026» y la
// línea de diferencias, tres párrafos abajo, «(2026-06-19)».
//
// `gasto.fecha` es `date` en Postgres y llega como '2026-07-15'. `new Date()` lo
// lee como medianoche UTC y formatearlo en CST (UTC−6) lo devuelve al día
// anterior. Un valor de solo fecha es un día del calendario, no un instante.
//
// El caso caro: el ticket del Costco es del 1 de julio y salía «30 jun». Otro
// mes, otro periodo fiscal, en el papel que se archiva.
// ═══════════════════════════════════════════════════════════════════════════
describe('una fecha sin hora se imprime tal cual está escrita', () => {
  it('no se corre un día', () => {
    expect(fechaMx('2026-07-15')).toContain('15');
    expect(fechaMx('2026-07-15')).toContain('jul');
  });

  it('y menos si eso la cambia de MES', () => {
    // El caso que se vio: 1-jul salía 30-jun.
    expect(fechaMx('2026-07-01')).toContain('01');
    expect(fechaMx('2026-07-01')).toContain('jul');
    expect(fechaMx('2026-07-01')).not.toContain('jun');
  });

  it('ni de AÑO', () => {
    expect(fechaMx('2026-01-01')).toContain('2026');
    expect(fechaMx('2026-01-01')).not.toContain('2025');
  });

  it('el `timestamptz` SIGUE usando la zona de México, que era el bug original', () => {
    // 31-jul 19:30 en México = 01:30 UTC del 1-ago. Tiene que decir 31 jul.
    expect(fechaMx('2026-08-01T01:30:00.000Z')).toContain('31');
    expect(fechaMx('2026-08-01T01:30:00.000Z')).toContain('jul');
  });

  it('y lo ilegible sigue siendo una raya', () => {
    expect(fechaMx('2026-13-45')).toBe('—');
    expect(fechaMx('no es fecha')).toBe('—');
  });
});
