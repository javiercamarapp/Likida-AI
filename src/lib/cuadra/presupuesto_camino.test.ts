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

  it('sin el reloj compartido NO cabría — esta es la regresión', () => {
    // Los topes fijos sumados, que es lo que había antes.
    expect(TOPE_BARRERA + TOPE_MUTEX + TOPE_AGENTE).toBeGreaterThan(PRESUPUESTO_WEBHOOK_MS);
  });

  it('si lo previo y las esperas se comen el presupuesto, el agente NO se lanza', () => {
    // Lanzarlo garantizaría que Vercel corte a media ejecución: el operador se
    // queda sin nada y Meta no reintenta. Se responde con el motor, que no
    // necesita al LLM para cuadrar.
    //
    // Con SOLO barrera+mutex al máximo (32s) siempre sobrarían 20s y el agente
    // cabría: la guarda existe para cuando ADEMÁS hubo lentitud antes —Supabase
    // lento, el envío del aviso de privacidad— que es cuando de verdad se pierde
    // el mensaje.
    const r = simular({ previo: 12_000, barrera: 99_000, mutex: 99_000, agente: 1_000 });
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
    ahora = 30_000;                        // barrera + mutex tardaron 30s
    expect(p.acotar(TOPE_AGENTE)).toBe(PRESUPUESTO_WEBHOOK_MS - MARGEN_CIERRE_MS - 30_000);
    expect(p.acotar(TOPE_AGENTE)).toBeLessThan(TOPE_AGENTE);
  });
});
