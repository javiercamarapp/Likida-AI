import { describe, it, expect } from 'vitest';
import { corridaDeCobranza } from './cobranza_pura';

// ═══════════════════════════════════════════════════════════════════════════
// FE-31C2-A1 (auditoría 31, continuación 2, ALTO) — LA BITÁCORA DECÍA «OK»
// SOBRE 360 CHOFERES A LOS QUE NADIE ESCRIBIÓ.
//
// Es el mismo defecto que `065f699` arregló en Peajes, en el sitio hermano que
// el arreglo no tocó. `estado` y `tareasTotal` se derivaban SOLO de `fallos`
// —un eje de tres reducido a uno—: `cortadosPorReloj` y `omitido` ya venían en
// el resultado y nadie los cableó.
//
// Lo que lo hace ALTO y no cosmético: el acuse que sí dice la verdad vive en
// `useActionState` y se evapora con el primer `router.refresh()`. Lo único
// durable —lo que ve el contralor que entra mañana a preguntar por qué no le
// llegaron comprobantes— es el renglón de la ficha de corridas. Y la regla que
// CLAUDE.md pone primero es que un rótulo tiene que ser verdad.
// ═══════════════════════════════════════════════════════════════════════════

describe('corridaDeCobranza — lo que la bitácora durable afirma', () => {
  it('EL CASO REAL: 400 en cola, el reloj cortó a los 40 — no es una corrida sana y el total es lo que HABÍA', () => {
    const c = corridaDeCobranza({
      revisados: 400, contactados: 40, sinTelefono: 0,
      fallos: [], cortadosPorReloj: 360,
    });
    expect(c.estado, 'archivar «OK» sobre 360 choferes sin contactar es el rótulo que no es verdad').toBe('parcial');
    expect(c.tareasHechas).toBe(40);
    expect(c.tareasTotal, 'el renglón decía 40/40 sobre una cola de 400').toBe(400);
    expect(c.resumen.cortadosPorReloj, 'sin esto, el detalle de la corrida tampoco lo dice').toBe(360);
  });

  it('el agente pausado: una corrida que NO CORRIÓ no se archiva como OK', () => {
    const c = corridaDeCobranza({
      revisados: 0, contactados: 0, sinTelefono: 0,
      omitido: 'el agente está pausado', fallos: [], cortadosPorReloj: 0,
    });
    expect(c.estado).toBe('parcial');
    expect(c.resumen.omitido, 'el registro permanente tiene que decir POR QUÉ no corrió')
      .toBe('el agente está pausado');
  });

  it('los sin teléfono cuentan en el total: la pantalla y el renglón dicen la misma cifra', () => {
    // El acuse en pantalla dice «Contactó a 30 de 40 · 10 sin teléfono».
    const c = corridaDeCobranza({
      revisados: 40, contactados: 30, sinTelefono: 10,
      fallos: [], cortadosPorReloj: 0,
    });
    expect(c.tareasTotal, 'el renglón decía 30/30 del mismo hecho que la tarjeta cuenta como 40').toBe(40);
    expect(c.resumen.sinTelefono).toBe(10);
  });

  it('una corrida completa y sin fallos sí es OK — la guarda nueva no pinta todo de amarillo', () => {
    const c = corridaDeCobranza({
      revisados: 12, contactados: 12, sinTelefono: 0,
      fallos: [], cortadosPorReloj: 0,
    });
    expect(c.estado).toBe('ok');
    expect(c.tareasHechas).toBe(12);
    expect(c.tareasTotal).toBe(12);
  });

  it('con fallos sigue siendo parcial, como antes', () => {
    const c = corridaDeCobranza({
      revisados: 5, contactados: 4, sinTelefono: 0,
      fallos: ['52811… rechazado'], cortadosPorReloj: 0,
    });
    expect(c.estado).toBe('parcial');
    expect(c.resumen.fallos).toBe(1);
  });
});
