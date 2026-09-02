import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// FE-8 (auditoría 24) · "litros elegibles para el estímulo" (LIF 20-A) se
// medía con ventanas distintas en cada pantalla que lo cita: el contador con
// `diasEjercicio` calculado a mano, Combustible & Casetas con
// `getAcreditables(tenantId)` a secas (histórico completo vía
// `corteVentana(undefined)`), y el chat sin ventana ninguna. Misma cita
// legal, hasta tres cálculos distintos.
//
// AUDITORÍA 24 (integración): en vez de que cada pantalla calcule su propia
// ventana (lo que este archivo originalmente exigía), las tres pasan por
// `ventanaLitrosElegibles()` de `fiscal.ts` — una sola función, una sola
// verdad. Este escaneo de fuente fija eso: las tres pantallas llaman
// `ventanaLitrosElegibles` e importan `vl.dias` a `getAcreditables`, para que
// un futuro "simplifiquemos y quitemos la ventana" en cualquiera de las tres
// vuelva a divergir EN ROJO.
// ═══════════════════════════════════════════════════════════════════════════

function leer(ruta: string): string {
  return readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');
}

describe('getAcreditables: misma ventana (ventanaLitrosElegibles) en las pantallas que citan LIF 20-A', () => {
  it('combustible-casetas/page.tsx pasa vl.dias vía ventanaLitrosElegibles (no getAcreditables(tenantId) a secas)', () => {
    const src = leer('./page.tsx');
    expect(src).toMatch(/ventanaLitrosElegibles\(/);
    expect(src).toMatch(/getAcreditables\(tenantId,\s*vl\.dias\)/);
    expect(src).not.toMatch(/getAcreditables\(tenantId\)\)/);
  });

  it('contador/inicio-contador.tsx deriva diasEjercicio de ventanaLitrosElegibles (mismo cálculo, no uno propio)', () => {
    const src = leer('../contador/inicio-contador.tsx');
    expect(src).toMatch(/ventanaLitrosElegibles\(/);
    expect(src).toMatch(/diasEjercicio\s*=\s*ventanaLitrosElegibles\(hoy\)\.dias/);
  });

  it('chat/page.tsx también pasa por ventanaLitrosElegibles (antes leía el histórico completo)', () => {
    const src = leer('../chat/page.tsx');
    expect(src).toMatch(/ventanaLitrosElegibles\(/);
    expect(src).toMatch(/getAcreditables\(tenantId,\s*vl\.dias\)/);
  });
});
