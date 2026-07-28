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
 * Tiempo que se aparta para CERRAR, o sea para todo lo que va DESPUÉS del
 * agente. Sin este margen se gasta hasta el último milisegundo y no queda
 * tiempo ni de responder — que es el fallo que esto viene a evitar.
 *
 * Se subió de 8s a 12s tras contar los pasos de red que hay ahí, que son seis y
 * ninguno instantáneo:
 *
 *   1. `guardiaCifras`, que puede recalcular el cuadre desde la BD  ~0.3s
 *   2. el mensaje de respuesta al operador                          ~1.5s
 *   3. el aviso de barrera vencida, cuando toca                     ~1.5s
 *   4. la URL firmada del PDF en storage                            ~0.5s
 *   5. el envío del documento                                       ~2.5s
 *   6. guardar la conversación y soltar el mutex                    ~0.5s
 *
 * Suman ~7s en un día malo, y 8 no dejaba holgura para ninguno lento. El coste
 * es que el agente pasa de 52s a 48s de techo, y el turno típico usa ~20s.
 */
export const MARGEN_CIERRE_MS = 12_000;

/**
 * Presupuesto de la invocación del webhook, en ms.
 *
 * TIENE QUE COINCIDIR con el `maxDuration` de
 * `src/app/api/webhook/whatsapp/route.ts`. Next exige que aquel sea un literal
 * estático —no se puede importar—, así que hay un test que compara los dos y
 * falla si se desincronizan. Sin él, subir uno y olvidar el otro deja el
 * presupuesto mintiendo y vuelve el fallo silencioso.
 *
 * 120s desde el 28-jul-2026. El plan del equipo `likida` se verificó contra la
 * API de Vercel —es **pro**, tope 300s—, y el peor caso de la ruta son ~72s:
 * lock (≤12s) + espera de intake (20s) + cuadre (~40s). Con 60 se cortaba a
 * media liquidación, y como Meta ya recibió su 200 no reintenta.
 *
 * El comentario anterior decía "60s es el tope de Hobby, solo sube si se
 * confirma Pro": la condición se cumplió y quedó comprobada, no supuesta.
 */
export const PRESUPUESTO_WEBHOOK_MS = 120_000;

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
