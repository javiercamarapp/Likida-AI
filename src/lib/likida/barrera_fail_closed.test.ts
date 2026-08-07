import { describe, it, expect } from 'vitest';
import { esperarIntake } from './conv';

// ALTO de la auditoría 5 (agéntico y backend, el mismo hallazgo por dos caminos):
// "La barrera de ráfaga se apaga sola y en silencio si el contador falla".
//
// `intakeDelta` devolvía 0 ante CUALQUIER error, y 0 significa además "no hay
// nada en vuelo". `esperarIntake` sondea con `intakeDelta(id, 0)`, veía ese 0 y
// devolvía `true` de inmediato.
//
// Escenario medido: el operador manda 5 fotos; la #5 sigue en OCR (contador real
// = 1) cuando llega "listo"; el sondeo cae por un 503 transitorio. La barrera se
// abre, el agente cuadra con 4 comprobantes, y si el #5 era el diésel de $8,000
// la liquidación cierra con $8,000 menos comprobados —PDF ya emitido, viaje ya
// `liquidado`—. El operador termina debiendo de su bolsa un gasto que sí hizo.
//
// Y lo peor: `intakeOk` salía `true`, así que tampoco se le avisaba. Es el único
// camino en el que la liquidación sale corta SIN decírselo a nadie.

describe('la barrera no se abre por un error de consulta', () => {
  it('un sondeo que falla NO cuenta como "no hay nada en vuelo"', async () => {
    // `null` es lo que ahora devuelve `intakeDelta` cuando la RPC falla.
    const ok = await esperarIntake('v1', 120, async () => null);
    // Vence el tope y devuelve false → el operador RECIBE el aviso de que se
    // cuadró con lo que se alcanzó. Antes devolvía true y nadie se enteraba.
    expect(ok).toBe(false);
  });

  it('un contador de verdad en cero SÍ abre la barrera', async () => {
    expect(await esperarIntake('v1', 2000, async () => 0)).toBe(true);
  });

  it('con fotos en vuelo espera, y si no se vacían avisa', async () => {
    expect(await esperarIntake('v1', 120, async () => 2)).toBe(false);
  });

  it('se abre en cuanto el contador llega a cero de verdad', async () => {
    let n = 2;
    const ok = await esperarIntake('v1', 5000, async () => { n -= 1; return n; });
    expect(ok).toBe(true);
  });

  // El límite: un error INTERMITENTE no debe bloquear para siempre si el
  // contador después responde y está en cero.
  it('un fallo transitorio no condena el turno: si luego responde 0, abre', async () => {
    let i = 0;
    const ok = await esperarIntake('v1', 5000, async () => (i++ === 0 ? null : 0));
    expect(ok).toBe(true);
  });
});
