import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PLAZO_ACCION_MS } from './tarjeta-accion';
import { PRESUPUESTO_RUNNER_MS } from '../../../lib/agents/copiloto-acciones';

// ═══════════════════════════════════════════════════════════════════════════
// A46-AG-01 — El plazo del cliente tiene que DERIVAR del presupuesto del
// servidor, no ser un número suelto.
//
// La tarjeta de acción del copiloto cortaba el fetch a los 20 s mientras
// `correr_runner` se autoriza 45 s en el servidor. Una vuelta del runner que
// tardaba 23 s —lo esperable, porque despacha varios agentes con llamadas de
// modelo— ejecutaba de verdad y la pantalla decía «No se pudo ejecutar.
// Inténtalo de nuevo.»: el intent ya estaba gastado, así que el reintento
// devolvía 409 con la instrucción de pedir la acción de nuevo, y pedirla de
// nuevo corre el runner una SEGUNDA vez. Con `LIKIDA_ENVIADOR_ENCENDIDO`
// puesto, eso son dos campañas de correo frío irreversible que el humano cree
// que no mandó.
//
// Estas pruebas no fijan los números: fijan la RELACIÓN entre los tres plazos.
// ═══════════════════════════════════════════════════════════════════════════

const raiz = join(__dirname, '..', '..', '..', '..');
const fuenteRuta = readFileSync(join(raiz, 'src/app/api/admin/copiloto/route.ts'), 'utf8');

/** El `maxDuration` que declara la ruta que ejecuta la acción, en ms. */
function maxDurationRutaMs(): number {
  const m = fuenteRuta.match(/^export const maxDuration = (\d+);$/m);
  if (!m) throw new Error('no se pudo leer `maxDuration` de /api/admin/copiloto/route.ts');
  return Number(m[1]) * 1000;
}

describe('A46-AG-01 · el plazo de la tarjeta de acción contra el presupuesto del servidor', () => {
  it('el cliente espera MÁS de lo que el servidor se autoriza para correr el runner', () => {
    // Si esto falla, existe una ventana en la que la acción corre y la
    // pantalla afirma que no corrió.
    expect(PLAZO_ACCION_MS).toBeGreaterThan(PRESUPUESTO_RUNNER_MS);
  });

  it('y cabe dentro del maxDuration de la ruta que la ejecuta', () => {
    // Esperar más que la propia función es esperar a un servidor que ya murió.
    expect(PLAZO_ACCION_MS).toBeLessThanOrEqual(maxDurationRutaMs());
  });

  it('el presupuesto del runner también cabe en el maxDuration de la ruta', () => {
    expect(PRESUPUESTO_RUNNER_MS).toBeLessThan(maxDurationRutaMs());
  });

  it('la tarjeta usa la constante, no un literal suelto', () => {
    const fuenteTarjeta = readFileSync(join(raiz, 'src/app/dashboard/chat/tarjeta-accion.tsx'), 'utf8');
    expect(fuenteTarjeta).toContain('AbortSignal.timeout(PLAZO_ACCION_MS)');
    expect(fuenteTarjeta).not.toMatch(/AbortSignal\.timeout\(\s*\d/);
  });

  it('el runner usa la constante, no un literal suelto', () => {
    const fuenteAcciones = readFileSync(join(raiz, 'src/lib/agents/copiloto-acciones.ts'), 'utf8');
    expect(fuenteAcciones).toContain('venceEn: Date.now() + PRESUPUESTO_RUNNER_MS');
    expect(fuenteAcciones).not.toMatch(/venceEn: Date\.now\(\) \+ \d/);
  });
});
