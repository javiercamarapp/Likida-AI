import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

// ═══════════════════════════════════════════════════════════════════════════
// ARQUITECTURA 25 (BAJO) — `resumen-visual.tsx` exporta `PILL_ESTATUS` con el
// comentario de que se hace justo para que otra pantalla que pinte el mismo
// `viaje.estatus` no reconstruya su propio mapa ("dos mapas se separan al
// primer estatus nuevo"). `viajes/vista.tsx` lo reconstruyó de todas formas,
// privado, con los mismos tres valores — hoy idéntico, mañana un estatus
// nuevo entra a uno y no al otro.
//
// `facturacion/vista.tsx` también tiene un `PILL_ESTATUS` propio, y NO es el
// mismo hallazgo: es `factura_emitida.estatus` (borrador/cancelada), otro
// dominio, otra forma (`{ rotulo, fg, bg }` contra `{ estado, etiqueta }`) —
// coincide el nombre, no el dato. Se excluye a propósito, no por descuido.
// ═══════════════════════════════════════════════════════════════════════════

const EXCEPCIONES = new Set([
  'src/app/dashboard/resumen-visual.tsx',
  // Dominio distinto (factura_emitida.estatus, no viaje.estatus) y forma
  // distinta — ver la nota de arriba.
  'src/app/dashboard/facturacion/vista.tsx',
]);

describe('PILL_ESTATUS de viaje.estatus tiene UNA sola fuente', () => {
  it('ningún archivo fuera de resumen-visual.tsx (y la excepción declarada de facturacion) declara su propio PILL_ESTATUS', () => {
    let salida = '';
    try {
      salida = execSync("grep -rln --include='*.tsx' -E '(const|let) PILL_ESTATUS' src", { encoding: 'utf8' });
    } catch (e) {
      const err = e as { status?: number; stdout?: string };
      if (err.status !== 1) throw e;
      salida = err.stdout ?? '';
    }
    const archivos = salida.split('\n').map((l) => l.trim()).filter(Boolean)
      .filter((f) => !EXCEPCIONES.has(f));
    expect(archivos, `estos archivos declaran su propio PILL_ESTATUS en vez de importar el de resumen-visual.tsx: ${archivos.join(', ')}`).toEqual([]);
  });
});
