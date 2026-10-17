/* eslint-disable security/detect-non-literal-fs-filename -- prueba que lee/escribe rutas del propio repo o de un directorio temporal; ninguna ruta ni patrón viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// El desglose por CORREO no habla de WhatsApp (T-A1-32). El cliente pidió el correo como canal; WhatsApp queda en
// stand-by, oculto, no borrado. Esta prueba recorre los textos del canal correo (pantalla, detalle y servicios
// `desglose_*`) y falla si reaparece el vocabulario del otro canal. El flujo WhatsApp (`entrega.ts`, `pdf.ts`, etc.)
// NO se escanea: sigue intacto.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = process.cwd();
const DIR_LIB = join(RAIZ, 'src/lib/likida/liquidacion_externa');
const DIR_UI = join(RAIZ, 'src/app/dashboard/agentes/liquidacion');
const PROHIBIDO = /whatsapp|\bwa_|plantilla meta|botón/i;

const archivos = [
  join(DIR_UI, 'desgloses.tsx'),
  join(DIR_UI, 'detalle_desglose.ts'),
  ...readdirSync(DIR_LIB)
    .filter((f) => /^desglose_.*\.ts$/.test(f) && !/\.test\.ts$/.test(f) && !/\.fixture\.ts$/.test(f))
    .map((f) => join(DIR_LIB, f)),
];

function hallazgos(texto: string): string[] {
  return texto.split('\n').flatMap((l, i) => (PROHIBIDO.test(l) ? [`${i + 1}: ${l.trim()}`] : []));
}

describe('textos del desglose por correo', () => {
  it('hay archivos que recorrer', () => {
    expect(archivos.length).toBeGreaterThan(5);
  });

  it.each(archivos)('%s no menciona WhatsApp, wa_, plantilla Meta ni botón', (ruta) => {
    expect(hallazgos(readFileSync(ruta, 'utf8'))).toEqual([]);
  });

  it('el detector sí atrapa el vocabulario del otro canal', () => {
    expect(hallazgos('usa el botón de WhatsApp\nwa_outbox\nplantilla Meta\nlimpio')).toHaveLength(3);
  });

  it('el encabezado de la doc de operación presenta el desglose por correo y manda WhatsApp a stand-by', () => {
    const doc = readFileSync(join(RAIZ, 'docs/operacion/liquidacion-externa.md'), 'utf8');
    const corte = doc.indexOf('## Canal alterno (stand-by): WhatsApp');
    expect(corte).toBeGreaterThan(0);
    const encabezado = doc.slice(0, corte);
    expect(encabezado).toMatch(/desglose por correo/);
    expect(hallazgos(encabezado)).toEqual([]);
  });
});
