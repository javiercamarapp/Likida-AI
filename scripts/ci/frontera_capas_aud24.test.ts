import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · ARQ-6 — `src/lib` no importa de `src/app`. Una regla de
// negocio (el tope diario del chat) vivía en una ruta de Next y la consumía
// un módulo de dominio que corre desde el webhook de WhatsApp; reorganizar
// rutas dejaba de compilar el dominio. Esta prueba barre `src/lib/**` y falla
// con cualquier `from '@/app/…'` que no esté en la deuda nominal de abajo.
//
// LA DEUDA ES NOMINAL Y SE BAJA, NO SE SUBE: las dos entradas son las que la
// auditoría encontró; arreglarlas (mover `tope.ts` a `lib/likida/chat_tope.ts`
// y `areaDeLlaveAlcanza` a `lib/mcp/areas.ts`, con re-exports en las rutas)
// toca archivos de otros dueños y queda anotado en CIERRE.md. Cuando se
// muevan, quita la entrada: la prueba sigue en verde y ya no admite volver.
// ═══════════════════════════════════════════════════════════════════════════

const DEUDA = new Map<string, string>([
  ['src/lib/likida/oficina_wa.ts', "importa `@/app/api/dashboard/chat/tope` (topeDiaUsd / gastoChatHoyUsd); entró en 7b1f109a"],
  ['src/lib/mcp/credencial.ts', "importa `@/app/api/v1/_comun` (areaDeLlaveAlcanza)"],
]);

describe('ARQ-6: src/lib no importa de src/app', () => {
  const archivos = globSync('src/lib/**/*.{ts,tsx}').filter((f) => !/\.test\.tsx?$/.test(f)).sort();

  it('barre de verdad (hay archivos que revisar)', () => { expect(archivos.length).toBeGreaterThan(100); });

  it('ningún archivo NUEVO de src/lib importa de @/app; la deuda conocida no crece', () => {
    const violaciones = archivos.filter((f) => /from\s+['"]@\/app\//.test(readFileSync(f, 'utf8')));
    const nuevas = violaciones.filter((f) => !DEUDA.has(f));
    expect(nuevas, `lib → app en: ${nuevas.join(', ')} — la regla de negocio va en lib; la ruta la re-exporta`).toEqual([]);
  });

  it('cada entrada de la deuda trae su razón escrita', () => {
    for (const [, razon] of DEUDA) expect(razon.trim().length).toBeGreaterThan(10);
  });
});
