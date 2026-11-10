import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// ARQUITECTURA 25 (BAJO) — `resumen-visual.tsx` exporta `PILL_ESTATUS` con el comentario de que se hace justo para que otra pantalla
// que pinte el mismo `viaje.estatus` no reconstruya su propio mapa ("dos mapas se separan al primer estatus nuevo").
//
// `facturacion/vista.tsx` también tiene un `PILL_ESTATUS` propio, y NO es el mismo hallazgo: es `factura_emitida.estatus`
// (borrador/cancelada), otro dominio. Se excluye a propósito, no por descuido.
//
// FASE 8 (P-DAS-OP-1): la regla cubre las TRES pastillas de la operación de viajes —estatus, aviso y semáforo—. Cada una se define en
// `viajes/pills.tsx` y las tres pantallas (Registro, Viajes en vivo, Despacho) la importan de ahí; ninguna la reconstruye.
// ═══════════════════════════════════════════════════════════════════════════

const EXCEPCIONES = new Set([
  'src/app/dashboard/resumen-visual.tsx',
  'src/app/dashboard/facturacion/vista.tsx',
]);

function grep(patron: string, carpeta: string): string[] {
  try {
    return execSync(`grep -rln --include='*.tsx' -E '${patron}' ${carpeta}`, { encoding: 'utf8' }).split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    if (err.status !== 1) throw e;
    return (err.stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  }
}

const leer = (rel: string) => readFileSync(join(process.cwd(), 'src/app/dashboard', rel), 'utf8');

describe('PILL_ESTATUS de viaje.estatus tiene UNA sola fuente', () => {
  it('ningún archivo fuera de resumen-visual.tsx (y la excepción declarada de facturacion) declara su propio PILL_ESTATUS', () => {
    const archivos = grep('(const|let) PILL_ESTATUS', 'src').filter((f) => !EXCEPCIONES.has(f));
    expect(archivos, `estos archivos declaran su propio PILL_ESTATUS en vez de importar el de resumen-visual.tsx: ${archivos.join(', ')}`).toEqual([]);
  });
});

describe('las tres pastillas de viajes / en vivo / despacho tienen UNA sola definición (viajes/pills.tsx)', () => {
  it('estatus, aviso y semáforo se declaran solo en pills.tsx', () => {
    const base = 'src/app/dashboard';
    for (const patron of ['function PillEstatusViaje', 'function PillAviso', 'function PillSemaforo']) {
      expect(grep(patron, base), patron).toEqual([`${base}/viajes/pills.tsx`]);
    }
    // El mapa del semáforo y el del aviso no se reconstruyen en otra pantalla de la operación.
    const operacion = ['viajes', 'viajes-en-vivo', 'despacho', 'mapa'].map((d) => `${base}/${d}`).join(' ');
    expect(grep('(const|let) (SEMAFORO|PILL_AVISO)\\b', operacion).filter((f) => !f.endsWith('/viajes/pills.tsx'))).toEqual([]);
  });

  it('cada pantalla pinta su pastilla con la pieza compartida, no con un <span> a mano', () => {
    expect(leer('viajes/vista.tsx')).toMatch(/PillEstatusViaje/);
    expect(leer('viajes/vista.tsx')).toMatch(/PillAviso/);
    expect(leer('despacho/vista.tsx')).toMatch(/PillAviso/);
    expect(leer('viajes-en-vivo/vista.tsx')).toMatch(/PillSemaforo/);
    for (const rel of ['viajes/vista.tsx', 'despacho/vista.tsx', 'viajes-en-vivo/vista.tsx']) {
      expect(leer(rel), rel).not.toMatch(/rounded-full[^>]*style=|StatusPill/);
    }
  });

  it('el aviso y el semáforo se pintan con StatusChip (punto + texto)', () => {
    const f = leer('viajes/pills.tsx');
    expect(f).toMatch(/StatusChip/);
    expect(f).not.toMatch(/style=/);
  });
});
