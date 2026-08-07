import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  crearPresupuesto, MARGEN_CIERRE_MS, PRESUPUESTO_WEBHOOK_MS,
  PASOS_CIERRE, COSTO_CIERRE_MS, TOPE_CONSULTA_MS,
} from './presupuesto';

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
    ahora = 47_000;
    const quedan = 60_000 - MARGEN_CIERRE_MS - 47_000;
    expect(p.acotar(20_000)).toBe(quedan);       // pide 20s, se le dan los que hay
    expect(p.acotar(quedan - 1_000)).toBe(quedan - 1_000);  // si pide menos, se respeta
  });

  it('alcanza() responde si cabe una etapa que se sabe cara', () => {
    let ahora = 0;
    const p = crearPresupuesto(60_000, () => ahora);
    expect(p.alcanza(30_000)).toBe(true);
    ahora = 40_000;
    const quedan = 60_000 - MARGEN_CIERRE_MS - 40_000;
    expect(p.alcanza(30_000)).toBe(false);
    expect(p.alcanza(quedan)).toBe(true);
    expect(p.alcanza(quedan + 1)).toBe(false);
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

// ═══════════════════════════════════════════════════════════════════════════
// EL MARGEN DE CIERRE ERA UNA CUENTA EN PROSA, Y LA PROSA MENTÍA.
//
// El comentario enumeraba SEIS pasos de red y los sumaba en "~7s en un día
// malo". Contados contra `processor.ts` después de que `runAgent` devuelve son
// TRECE y suman 8.9s. Seguía cabiendo en 12s, pero con 3.1s de holgura en vez de
// los ~5s que sugería — y nadie podía notarlo porque una lista en un comentario
// no la verifica nada.
//
// Es el mismo mecanismo que produjo el bug original de `maxDuration`: el número
// escrito al lado del código dejó de coincidir con el código. Aquí se cierra
// igual que allá, con una prueba.
// ═══════════════════════════════════════════════════════════════════════════
describe('la contabilidad del cierre', () => {
  it('el margen reservado alcanza para los pasos que de verdad hay', () => {
    expect(COSTO_CIERRE_MS).toBe(PASOS_CIERRE.reduce((s, p) => s + p.ms, 0));
    expect(MARGEN_CIERRE_MS).toBeGreaterThanOrEqual(COSTO_CIERRE_MS);
  });

  it('la tabla trae los trece pasos, con dónde vive cada uno', () => {
    // El `donde` no es adorno: sin él, revisar si la lista sigue completa exige
    // releer `processor.ts` entero, que es exactamente lo que nadie hizo en tres
    // rondas. Si añades un paso de red al cierre, añádelo aquí o sube el margen.
    expect(PASOS_CIERRE).toHaveLength(13);
    for (const p of PASOS_CIERRE) {
      expect(p.ms, `${p.paso} sin costo`).toBeGreaterThan(0);
      expect(p.donde, `${p.paso} sin ubicación`).toMatch(/\.ts/);
    }
  });

  it('queda holgura para que un solo paso salga lento', () => {
    // `sendDocument` es el más caro (2.5s presupuestados). Si se va al doble, el
    // cierre todavía tiene que caber; si no, el operador se queda sin PDF y sin
    // log, porque Vercel mata la función antes del `catch`.
    const masCaro = Math.max(...PASOS_CIERRE.map((p) => p.ms));
    expect(MARGEN_CIERRE_MS).toBeGreaterThanOrEqual(COSTO_CIERRE_MS + masCaro * 0.5);
  });
});

describe('TOPE_CONSULTA_MS', () => {
  it('es muchísimo menor que el presupuesto de la invocación', () => {
    // La razón de existir del tope: el default de undici son 300 000 ms contra un
    // `maxDuration` de 120 000. Un techo que no quepa varias veces en el
    // presupuesto no es un techo, es el mismo problema con otro número.
    expect(TOPE_CONSULTA_MS).toBeLessThan(PRESUPUESTO_WEBHOOK_MS / 10);
  });

  it('deja pasar una consulta sana con holgura de sobra', () => {
    // Una consulta de este sistema cuesta ~0.3s en la contabilidad de arriba.
    // Un tope por debajo de 3s empezaría a cortar consultas buenas en un mal
    // día, y cortar una buena es peor que esperar una mala.
    expect(TOPE_CONSULTA_MS).toBeGreaterThanOrEqual(3_000);
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
