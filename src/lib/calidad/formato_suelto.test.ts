import { describe, expect, it } from 'vitest';
import { archivosFuente, leer, rel } from './escanear-fuentes';

// CT-CAL-07 (F8): el formato de fecha, hora y cifras vive en `src/lib/formato.ts`. formato.test.ts ya prohíbe
// `toLocaleString('es-MX'`; esta guarda cubre el resto de la familia (`toLocaleDateString`, `toLocaleTimeString`, `toLocaleString`
// con cualquier locale). Lo que quedó fuera es una lista cerrada y con motivo: solo puede bajar.
const PERMITIDOS: Record<string, string> = {
  'src/lib/formato.ts': 'es EL módulo de formato',
  'src/lib/saludo.ts': 'saludo con día de la semana en palabras; documentado en la auditoría 10',
  'src/lib/likida/peajes/tarifario_archivo.ts': 'mensaje de error con un importe en en-US (no se muestra como cifra de pantalla)',
  'src/lib/likida/peajes/vinculos_archivos.ts': 'cifra de un renglón de texto del vínculo, en-US a propósito',
  'src/app/dashboard/viajes-en-vivo/actualizar_solo.tsx': 'hora con segundos del último refresco (horaMx no tiene segundos); reloj del navegador',
};

const PATRON = /\.toLocale(Date|Time)?String\(/;

function sinComentarios(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('formato de fechas y cifras centralizado (CT-CAL-07)', () => {
  const infractores = [...archivosFuente()]
    .filter((p) => PATRON.test(sinComentarios(leer(p))))
    .map(rel)
    .filter((r) => !(r in PERMITIDOS));

  it('ningún archivo nuevo llama toLocale(Date|Time)?String fuera de formato.ts', () => {
    expect(infractores, 'usa fechaMx/fechaHoraMx/horaMx/numero/mxn de @/lib/formato').toEqual([]);
  });

  it('la lista de permitidos no guarda archivos que ya se limpiaron', () => {
    const vigentes = [...archivosFuente()].filter((p) => PATRON.test(sinComentarios(leer(p)))).map(rel);
    const obsoletos = Object.keys(PERMITIDOS).filter((f) => !vigentes.includes(f));
    expect(obsoletos).toEqual([]);
  });

  it('detecta la forma prohibida (mutación)', () => {
    expect(PATRON.test(sinComentarios("const h = d.toLocaleTimeString('es-MX');"))).toBe(true);
    expect(PATRON.test(sinComentarios("// d.toLocaleTimeString('es-MX')"))).toBe(false);
    expect(PATRON.test(sinComentarios("x.toLocaleLowerCase('es')"))).toBe(false);
  });
});
