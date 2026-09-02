import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// FE-26 (auditoría 24) · `liqId: liq?.id ?? null` no estaba gateado por
// `verDinero` — el encargado (área `operacion`, sin dinero) veía "Ver →" en
// cada viaje liquidado (`viajes/vista.tsx:235`, `v.liqId ?`) y el link lo
// mandaba a `/dashboard/[id]`, que lo rebota al Resumen
// (`puedeVerArea(rol,'dinero')`) — el único "detalle de viaje" que el
// producto ofrece hoy es la liquidación, y para él es un callejón sin salida.
//
// Escaneo de fuente: fija que `liqId` se calcule con `verDinero` en la
// expresión, para que no regrese silenciosamente a `liq?.id ?? null`.
// ═══════════════════════════════════════════════════════════════════════════

describe('Registro de Viajes: liqId no se ofrece a quien no ve dinero (FE-26)', () => {
  it('la page gatea liqId con verDinero antes de tomar el id de la liquidación', () => {
    const src = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
    expect(src).toMatch(/liqId:\s*verDinero\s*&&\s*liq\s*\?\s*liq\.id\s*:\s*null/);
  });
});
