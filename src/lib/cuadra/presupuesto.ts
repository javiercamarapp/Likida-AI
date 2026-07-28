// ═══════════════════════════════════════════════════════════════════════════
// EL PRESUPUESTO DE TIEMPO DE UNA INVOCACIÓN.
//
// El webhook responde 200 de inmediato y hace el trabajo en `after()`. Meta ya
// recibió su acuse, así que NO reintenta nunca. Si Vercel mata la función al
// llegar a `maxDuration`, el trabajo se pierde EN SILENCIO: el operador no
// recibe nada, no hay reintento, y el único rastro es que el mensaje nunca llegó.
//
// Encima las etapas se comían el presupuesto a ciegas. La barrera de intake
// espera hasta 20s y el mutex hasta 12s, cada una con su tope fijo, sin saber
// que comparten los 60s con el agente —que es la parte cara—. En el peor caso
// son 32s consumidos antes de empezar a pensar.
//
// Esto no acorta ningún timeout: le da a todas las etapas el mismo reloj, para
// que la que llega tarde pida menos en vez de pedir lo mismo.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tiempo que se aparta para CERRAR: mandar el mensaje al operador, soltar el
 * mutex, escribir el log.
 *
 * Sin este margen se gasta hasta el último milisegundo y no queda tiempo ni de
 * responder — que es exactamente el fallo que esto viene a evitar. 8s cubre un
 * envío de WhatsApp lento más el unlock.
 */
export const MARGEN_CIERRE_MS = 8_000;

/**
 * Presupuesto de la invocación del webhook, en ms.
 *
 * TIENE QUE COINCIDIR con el `maxDuration` de
 * `src/app/api/webhook/whatsapp/route.ts`. Next exige que aquel sea un literal
 * estático —no se puede importar—, así que hay un test que compara los dos y
 * falla si se desincronizan. Sin él, subir uno y olvidar el otro deja el
 * presupuesto mintiendo y vuelve el fallo silencioso.
 *
 * 60s es el tope duro del plan Hobby; Vercel IGNORA valores mayores. Solo sube a
 * 120 si se confirma Pro CON Fluid Compute.
 */
export const PRESUPUESTO_WEBHOOK_MS = 60_000;

export interface Presupuesto {
  /** Milisegundos utilizables que quedan, ya descontado el margen de cierre. */
  restante(): number;
  /** `true` si ya no queda tiempo para trabajo nuevo. */
  agotado(): boolean;
  /** El tope que pide una etapa, recortado a lo que de verdad queda. */
  acotar(topeDeseado: number): number;
  /** ¿Cabe una etapa que se estima en `costoMs`? */
  alcanza(costoMs: number): boolean;
  /** Milisegundos transcurridos desde el inicio. Para el log. */
  gastado(): number;
  /**
   * Señal que se aborta cuando se acaba lo que queda (o antes, si `topeMs` es
   * menor). Para pasarla a los SDK que aceptan `AbortSignal` y que si no caen a
   * sus defaults —el de OpenAI son 10 minutos contra un webhook de 60s.
   */
  senal(topeMs?: number): AbortSignal;
}

/**
 * @param totalMs  presupuesto de la invocación (el `maxDuration` de la ruta).
 * @param reloj    inyectable para poder probarlo sin esperar de verdad.
 */
export function crearPresupuesto(totalMs: number, reloj: () => number = Date.now): Presupuesto {
  const inicio = reloj();
  const restante = () => Math.max(0, totalMs - MARGEN_CIERRE_MS - (reloj() - inicio));
  return {
    restante,
    agotado: () => restante() <= 0,
    acotar: (topeDeseado: number) => Math.min(topeDeseado, restante()),
    alcanza: (costoMs: number) => restante() >= costoMs,
    gastado: () => reloj() - inicio,
    senal: (topeMs?: number) => {
      const ms = Math.min(topeMs ?? Number.POSITIVE_INFINITY, restante());
      // `AbortSignal.timeout(0)` no aborta de inmediato: se agenda. Cuando ya no
      // queda nada se devuelve una señal YA abortada, para que la llamada ni
      // salga.
      if (!(ms > 0)) { const ac = new AbortController(); ac.abort(); return ac.signal; }
      return AbortSignal.timeout(ms);
    },
  };
}
