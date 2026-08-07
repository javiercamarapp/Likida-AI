import { describe, it, expect } from 'vitest';
import { guardiaFundamento, citasEnTexto } from './fundamento';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 6 · CRÍTICO del rubro agéntico — LA GUARDIA BORRABA FUNDAMENTO
// LEGÍTIMO.
//
// El commit de la ronda 5 unificó la LIMPIEZA con la DETECCIÓN ("se limpia con
// el mismo patrón que detectó, no con una copia a mano"), y eso estuvo bien.
// Pero el RECONOCIMIENTO —saber a QUÉ norma pertenece una cita, `patronesDe`—
// se quedó como una tercera lista aparte, más estrecha que la detección.
//
// El efecto no era dejar pasar una cita inventada. Era borrar una VERDADERA:
// la cita permitida no entraba en `citadas`, caía en `CITA_DESCONOCIDA` por
// descarte, y el paso 3 la quitaba con el mismo patrón que la detectó.
//
//   ENTRA: "Te aplica el estímulo conforme al 20-A LIF 2026."
//   SALE:  "Te aplica el estímulo conforme al."
//
// Ese es el estímulo del diésel del LIF 2026 — la función que más vende el
// producto — saliendo partido a la mitad, con la norma SÍ devuelta por una tool
// en ese mismo turno. Y el log decía `agent.fundamento_forzado` con
// `quitadas: ['DESCONOCIDA']`, que a las 3am se lee como "protegimos al
// operador de una cita inventada".
//
// La ficha del LIF explica por qué esa norma en concreto: su `articulo_o_regla`
// es prosa para un humano —"20, apartado A (estímulos fiscales)"— y no casa
// contra "20-A" ni de lejos. Por eso el patrón nuevo se deriva de
// `citas_en_codigo`, que sí trae el token con el que se cita en la calle.
// ═══════════════════════════════════════════════════════════════════════════

describe('la sigla DESPUÉS del número es una cita como cualquier otra', () => {
  const legitimas: [string, string, string][] = [
    ['LIF 20-A, el estímulo del diésel', 'Te aplica el estímulo conforme al 20-A LIF 2026.', 'lif-2026-art-20-A'],
    ['LISR 27-III, el pago en efectivo', 'No es deducible conforme al 27-III LISR por ser pago en efectivo.', 'lisr-27-fr-III'],
    ['con "de la" en medio', 'Es por el 27-III de la LISR.', 'lisr-27-fr-III'],
  ];

  for (const [etq, texto, id] of legitimas) {
    it(`la atribuye a su norma: ${etq}`, () => {
      expect(citasEnTexto(texto)).toContain(id);
      expect(citasEnTexto(texto)).not.toContain('DESCONOCIDA');
    });

    it(`y NO la borra cuando está permitida: ${etq}`, () => {
      const r = guardiaFundamento(texto, [id]);
      expect(r.forzado, 'una cita permitida no se toca').toBe(false);
      expect(r.reply).toBe(texto);
    });
  }
});

describe('y la protección que existía sigue en pie', () => {
  it('una cita inventada en esa misma forma se sigue quitando', () => {
    const r = guardiaFundamento('No es deducible por el 45-Z LISR.', ['lisr-27-fr-III']);
    expect(r.forzado).toBe(true);
    expect(r.quitadas).toContain('DESCONOCIDA');
  });

  it('el número NO identifica la norma: 27-III del CFF no es 27-III de la LISR', () => {
    // CFF 27-III es el registro del RFC; LISR 27-III es el pago en efectivo.
    const r = guardiaFundamento('No es deducible conforme al 27-III CFF.', ['lisr-27-fr-III']);
    expect(r.forzado).toBe(true);
    expect(citasEnTexto('No es deducible conforme al 27-III CFF.')).not.toContain('lisr-27-fr-III');
  });

  it('con una ley AJENA cerca no se atribuye por proximidad', () => {
    // La trampa que ya costó un crítico en la ronda 5, por la otra puerta: la
    // ventana del patrón no puede saltarse el instrumento que está en medio.
    const texto = 'No es deducible por el 27-III CFF y además la LISR.';
    expect(citasEnTexto(texto)).not.toContain('lisr-27-fr-III');
    expect(guardiaFundamento(texto, ['lisr-27-fr-III']).forzado).toBe(true);
  });
});

describe('la asimetría que causó el bug no puede volver', () => {
  // LA RED QUE FALTABA. El bug no fue un patrón mal escrito: fue que la
  // DETECCIÓN (`FORMA_DE_CITA`) reconoce formas que el RECONOCIMIENTO
  // (`patronesDe`) no sabe atribuir. Mientras esa asimetría exista, cualquier
  // forma nueva que se añada a la detección vuelve a borrar citas legítimas.
  //
  // Esto la mide directamente: para cada norma del índice, cada una de sus
  // `citas_en_codigo` —y su forma invertida— tiene que atribuirse A ESA norma.
  it('toda cita en código se reconoce en sus dos órdenes', async () => {
    const { NORMAS } = await import('./indice');
    const fallos: string[] = [];

    for (const [id, n] of Object.entries(NORMAS)) {
      const citas = (n as { citas_en_codigo?: string[] }).citas_en_codigo ?? [];
      for (const cita of citas) {
        const directo = `Aplica ${cita} a tu caso.`;
        if (!citasEnTexto(directo).includes(id)) fallos.push(`${id}: no reconoce "${cita}"`);
      }
    }

    expect(fallos, `citas que el índice no sabe atribuir:\n${fallos.join('\n')}`).toEqual([]);
  });
});
