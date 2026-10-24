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

// ═══════════════════════════════════════════════════════════════════════════
// A37-S18-04 / A37-S18-05 · Asignar, Asignar unidad y Reavisar. El comportamiento de las guardas se
// prueba en `lib/likida/despacho_asignacion.test.ts`; aquí se fija que LAS TRES ACCIONES las usan.
// ═══════════════════════════════════════════════════════════════════════════
describe('Despacho "asignar / reavisar": las acciones usan las guardas (A37-S18-04, S18-05)', () => {
  const src = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
  const cuerpo = (nombre: string) => {
    const ini = src.indexOf(`async function ${nombre}(`);
    expect(ini, nombre).toBeGreaterThan(-1);
    const sig = src.indexOf('\n  async function ', ini + 10);
    return src.slice(ini, sig === -1 ? undefined : sig);
  };

  it('Reavisar vuelve a comprobar viaje abierto, aceptación, baja y cooldown, y no dice «avisado» si el WhatsApp no salió', () => {
    const c = cuerpo('reenviarAviso');
    expect(c).toMatch(/guardaReaviso\(tenantId, viajeId\)/);
    expect(c).toMatch(/avisarAlChofer\(tenantId, guarda\.operadorId, viajeId\)\) !== false/);
    expect(c).toMatch(/anotarAvisoAlChofer\(/);
  });

  it('Asignar comprueba el viaje antes de reasignar y traduce el error (no aplasta en «Inténtalo de nuevo»)', () => {
    const c = cuerpo('asignarYAvisar');
    expect(c).toMatch(/guardaAsignacion\(tenantId, viajeId, operadorId\)/);
    expect(c.indexOf('guardaAsignacion(')).toBeLessThan(c.indexOf('reasignarOperador('));
    expect(c).toMatch(/mensajeDeAsignacion\(err/);
  });

  it('Asignar unidad también traduce el error (unidad de baja / en otro viaje abierto)', () => {
    expect(cuerpo('asignarUnidadViaje')).toMatch(/mensajeDeAsignacion\(err/);
  });
});
