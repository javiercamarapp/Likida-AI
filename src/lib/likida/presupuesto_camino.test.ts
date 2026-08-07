import { describe, it, expect } from 'vitest';
import { crearPresupuesto, MARGEN_CIERRE_MS, PRESUPUESTO_WEBHOOK_MS } from './presupuesto';

// ═══════════════════════════════════════════════════════════════════════════
// EL PEOR CASO TIENE QUE CABER EN SU PROPIO PRESUPUESTO.
//
// Antes no cabía: barrera 20s + mutex 12s + agente 40s = 72s contra los 60 de
// `maxDuration`. Y como el webhook responde 200 antes de trabajar, Meta no
// reintenta: al matar Vercel la función, el operador se queda sin nada.
//
// Esto simula el camino del "listo" con cada etapa agotando su tope, usando el
// mismo reloj compartido que usa el processor.
// ═══════════════════════════════════════════════════════════════════════════
const TOPE_BARRERA = 20_000, TOPE_MUTEX = 12_000, TOPE_AGENTE = 40_000, COSTO_AGENTE_MS = 15_000;

/**
 * Corre el camino con cada etapa tardando lo que se le indique.
 *
 * `previo` es lo que se va ANTES de la barrera: resolver operador, buscar viaje
 * abierto, mandar el aviso de privacidad. Son llamadas de red y también gastan
 * — por eso el reloj del processor arranca en la primera línea y no a media
 * función.
 */
function simular(tarda: { previo?: number; barrera: number; mutex: number; agente: number }) {
  let ahora = 0;
  const p = crearPresupuesto(PRESUPUESTO_WEBHOOK_MS, () => ahora);
  const gastar = (pedido: number, real: number) => { ahora += Math.min(real, p.acotar(pedido)); };

  ahora += tarda.previo ?? 0;
  gastar(TOPE_BARRERA, tarda.barrera);
  gastar(TOPE_MUTEX, tarda.mutex);
  const corrioAgente = p.alcanza(COSTO_AGENTE_MS);
  if (corrioAgente) gastar(TOPE_AGENTE, tarda.agente);
  return { totalMs: ahora, corrioAgente, sobraParaResponder: PRESUPUESTO_WEBHOOK_MS - ahora };
}

describe('camino del "listo" — peor caso', () => {
  it('con TODAS las etapas al máximo, cabe en maxDuration', () => {
    const r = simular({ barrera: 99_000, mutex: 99_000, agente: 99_000 });
    expect(r.totalMs).toBeLessThanOrEqual(PRESUPUESTO_WEBHOOK_MS);
    // Y queda el margen para mandar el mensaje y soltar el mutex.
    expect(r.sobraParaResponder).toBeGreaterThanOrEqual(MARGEN_CIERRE_MS);
  });

  // Este test decía «sin el reloj compartido NO cabría», comparando los topes
  // fijos (72s) contra el presupuesto. Era cierto con 60s. Al verificarse que el
  // plan es Pro y subir a 120s dejó de serlo: los topes fijos ahora CABEN.
  //
  // Bajarle el listón para que siguiera pasando habría sido mentir. Lo que queda
  // escrito es lo que hoy es verdad, incluido cuánta holgura hay — porque si
  // alguien vuelve a bajar el presupuesto, esto vuelve a apretar.
  it('los topes fijos ya caben en el presupuesto, y sobra margen', () => {
    const fijos = TOPE_BARRERA + TOPE_MUTEX + TOPE_AGENTE;   // 72s
    expect(fijos).toBeLessThanOrEqual(PRESUPUESTO_WEBHOOK_MS - MARGEN_CIERRE_MS);
    // Holgura real sobre el peor caso de topes fijos. Con 60s era negativa.
    expect(PRESUPUESTO_WEBHOOK_MS - MARGEN_CIERRE_MS - fijos).toBeGreaterThanOrEqual(30_000);
  });

  it('si lo previo y las esperas se comen el presupuesto, el agente NO se lanza', () => {
    // Lanzarlo garantizaría que Vercel corte a media ejecución: el operador se
    // queda sin nada y Meta no reintenta. Se responde con el motor, que no
    // necesita al LLM para cuadrar.
    //
    // La guarda ya no salta con barrera+mutex al máximo: con 120s sobra sitio de
    // sobra. Salta cuando ADEMÁS hubo lentitud antes —Supabase lento, el envío
    // del aviso de privacidad— y por eso `previo` se calcula contra el
    // presupuesto en vez de escribirse a mano: si el presupuesto cambia, este
    // caso sigue describiendo "llegó tarde", no un número que se quedó viejo.
    const previo = PRESUPUESTO_WEBHOOK_MS - MARGEN_CIERRE_MS - TOPE_BARRERA - TOPE_MUTEX - (COSTO_AGENTE_MS - 1_000);
    const r = simular({ previo, barrera: 99_000, mutex: 99_000, agente: 1_000 });
    expect(r.corrioAgente).toBe(false);
    expect(r.sobraParaResponder).toBeGreaterThanOrEqual(MARGEN_CIERRE_MS);
  });

  it('con SOLO las esperas al máximo, el agente todavía cabe', () => {
    // Que la guarda no se dispare en el caso corriente importa: si saltara de
    // más, el operador recibiría el resumen seco del motor en vez de la respuesta
    // del agente, y eso se nota en la demo.
    const r = simular({ barrera: 99_000, mutex: 99_000, agente: 20_000 });
    expect(r.corrioAgente).toBe(true);
  });

  it('en el camino normal el agente sí corre y sobra tiempo', () => {
    // Lo medido: fotos en paralelo ~3.5s, mutex libre, cuadre ~20s.
    const r = simular({ barrera: 3_500, mutex: 100, agente: 20_000 });
    expect(r.corrioAgente).toBe(true);
    expect(r.totalMs).toBeLessThan(30_000);
  });

  it('el agente recibe MENOS tiempo cuando llega tarde, no su tope completo', () => {
    let ahora = 0;
    const p = crearPresupuesto(PRESUPUESTO_WEBHOOK_MS, () => ahora);
    // "Tarde" es relativo al presupuesto, no un número fijo: con 60s bastaban
    // 30s de retraso para recortar al agente; con 120s hace falta más. Se coloca
    // el reloj justo donde queda MENOS que el tope del agente.
    const tarde = PRESUPUESTO_WEBHOOK_MS - MARGEN_CIERRE_MS - TOPE_AGENTE + 5_000;
    ahora = tarde;
    expect(p.acotar(TOPE_AGENTE)).toBe(PRESUPUESTO_WEBHOOK_MS - MARGEN_CIERRE_MS - tarde);
    expect(p.acotar(TOPE_AGENTE)).toBeLessThan(TOPE_AGENTE);
  });

  // Y el complemento: cuando NO llega tarde, recibe su tope entero y no menos.
  // Sin esto, un `acotar` que recortara siempre pasaría los dos test de arriba.
  it('en horario, el agente recibe su tope completo', () => {
    let ahora = 0;
    const p = crearPresupuesto(PRESUPUESTO_WEBHOOK_MS, () => ahora);
    ahora = 5_000;
    expect(p.acotar(TOPE_AGENTE)).toBe(TOPE_AGENTE);
  });
});
