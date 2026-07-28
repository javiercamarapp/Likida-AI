import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { crearPresupuesto, MARGEN_CIERRE_MS, PRESUPUESTO_WEBHOOK_MS } from './presupuesto';

// ═══════════════════════════════════════════════════════════════════════════
// EL PRESUPUESTO DE TIEMPO DE UNA INVOCACIÓN.
//
// El webhook responde 200 de inmediato y procesa en after(). Meta ya no
// reintenta nunca. Así que si Vercel mata la función al llegar a maxDuration,
// el trabajo se pierde EN SILENCIO: el operador no recibe nada y nadie se
// entera.
//
// Y las etapas se comían el presupuesto a ciegas: la barrera de intake espera
// hasta 20s y el mutex hasta 12s, cada una con su tope fijo, sin saber que
// comparten 60s con el agente —que es lo caro—. 32s consumidos antes de
// empezar a pensar.
//
// Aquí no se acorta ningún timeout: se les da a todos el mismo reloj.
// ═══════════════════════════════════════════════════════════════════════════
describe('crearPresupuesto', () => {
  it('al empezar, queda casi todo el presupuesto', () => {
    const ahora = 1000;
    const p = crearPresupuesto(60_000, () => ahora);
    expect(p.restante()).toBe(60_000 - MARGEN_CIERRE_MS);
  });

  it('descuenta lo que ya se gastó', () => {
    let ahora = 1000;
    const p = crearPresupuesto(60_000, () => ahora);
    ahora += 20_000;
    expect(p.restante()).toBe(40_000 - MARGEN_CIERRE_MS);
  });

  it('reserva un margen para poder RESPONDER antes de que maten la función', () => {
    // Sin margen, se gasta hasta el último milisegundo y no queda tiempo ni de
    // mandar el mensaje: el operador se queda sin nada, que es el fallo que
    // esto viene a evitar.
    expect(MARGEN_CIERRE_MS).toBeGreaterThanOrEqual(5_000);
    let ahora = 0;
    const p = crearPresupuesto(60_000, () => ahora);
    ahora = 60_000 - MARGEN_CIERRE_MS;
    expect(p.restante()).toBe(0);
    expect(p.agotado()).toBe(true);
  });

  it('nunca devuelve negativo', () => {
    let ahora = 0;
    const p = crearPresupuesto(60_000, () => ahora);
    ahora = 999_999;
    expect(p.restante()).toBe(0);
  });

  it('acota el tope que pide una etapa a lo que de verdad queda', () => {
    // La barrera pide 20s; si solo quedan 8, se le dan 8. Sin esto se pasa del
    // presupuesto y se lleva por delante al agente.
    let ahora = 0;
    const p = crearPresupuesto(60_000, () => ahora);
    ahora = 47_000;                       // quedan 13 - margen = 5s
    expect(p.acotar(20_000)).toBe(5_000);
    expect(p.acotar(2_000)).toBe(2_000);  // si pide menos de lo que hay, se respeta
  });

  it('alcanza() responde si cabe una etapa que se sabe cara', () => {
    let ahora = 0;
    const p = crearPresupuesto(60_000, () => ahora);
    expect(p.alcanza(30_000)).toBe(true);
    ahora = 40_000;                       // quedan 20 - margen = 12s
    expect(p.alcanza(30_000)).toBe(false);
    expect(p.alcanza(10_000)).toBe(true);
  });
});

describe('PRESUPUESTO_WEBHOOK_MS', () => {
  it('coincide con el maxDuration de la ruta del webhook', () => {
    // Next exige que `maxDuration` sea un literal estático en la ruta, así que no
    // se puede importar de aquí. Si los dos se desincronizan —alguien sube el de
    // la ruta y olvida este— el presupuesto miente y vuelve el fallo silencioso:
    // Vercel mata la función creyendo nosotros que aún quedaba tiempo.
    const ruta = readFileSync(new URL('../../app/api/webhook/whatsapp/route.ts', import.meta.url), 'utf8');
    const m = /export const maxDuration = (\d+)/.exec(ruta);
    expect(m, 'no se encontró maxDuration en la ruta del webhook').not.toBeNull();
    expect(Number(m![1]) * 1000).toBe(PRESUPUESTO_WEBHOOK_MS);
  });
});

describe('presupuesto.senal', () => {
  it('devuelve una señal YA abortada cuando no queda nada', () => {
    // `AbortSignal.timeout(0)` no aborta de inmediato: lo agenda. Si se usara
    // eso, la llamada saldría igual y se pagaría una respuesta que nadie va a
    // leer porque Vercel ya mató la función.
    let ahora = 0;
    const p = crearPresupuesto(60_000, () => ahora);
    ahora = 99_000;
    expect(p.senal().aborted).toBe(true);
  });

  it('con presupuesto de sobra, la señal empieza viva', () => {
    const p = crearPresupuesto(60_000, () => 0);
    expect(p.senal(25_000).aborted).toBe(false);
  });

  it('respeta el tope propio de la etapa cuando es menor que el restante', () => {
    // Una foto no debe poder comerse los 52s disponibles: tiene su propio techo.
    const p = crearPresupuesto(60_000, () => 0);
    expect(p.senal(25_000).aborted).toBe(false);
    expect(p.restante()).toBeGreaterThan(25_000);
  });
});
