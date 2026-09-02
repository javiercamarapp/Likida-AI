import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// FE-13 (auditoría 24) · el catch de "crear viaje" aplastaba TODO fallo con
// "Revisa los datos e inténtalo de nuevo" — incluido `DatoInvalido` (mensajes
// que `crearViaje` ya escribe para pantalla: "operador dado de baja",
// "unidad dada de baja") y el 23505 de `uq_viaje_abierto_por_operador`
// (0029), que a 500 viajes/día va a ser el error más común del panel.
// ═══════════════════════════════════════════════════════════════════════════

describe('Despacho "crear viaje": el catch distingue el error (FE-13)', () => {
  it('devuelve DatoInvalido.message en vez de aplastarlo', () => {
    const src = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
    expect(src).toMatch(/err instanceof DatoInvalido\)\s*return\s*\{\s*error:\s*err\.message\s*\}/);
  });

  it('traduce uq_viaje_abierto_por_operador a un mensaje con el folio del viaje abierto', () => {
    const src = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
    expect(src).toMatch(/uq_viaje_abierto_por_operador/);
    expect(src).toMatch(/ya trae (el viaje|un viaje) .*abierto/);
  });
});
