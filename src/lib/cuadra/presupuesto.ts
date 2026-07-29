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
 * LOS PASOS DE RED DEL CIERRE, UNO POR UNO.
 *
 * Esto era un comentario, y el comentario mentía: enumeraba SEIS pasos y sumaba
 * "~7s en un día malo". Contados contra `processor.ts` después de que `runAgent`
 * devuelve, son TRECE viajes de red secuenciales y suman 8.9s. La cuenta seguía
 * cabiendo en los 12s reservados, pero con 3.1s de holgura y no con los ~5s que
 * sugería. Nadie se enteró porque una lista en prosa no se puede verificar.
 *
 * Ahora es una tabla, y `presupuesto.test.ts` compara su suma contra
 * `MARGEN_CIERRE_MS`. Meter un paso más al cierre sin ampliar el margen deja de
 * ser un descuido silencioso y pasa a ser una prueba en rojo — el mismo
 * mecanismo que ya protege la sincronía con `maxDuration`.
 *
 * Los costos unitarios son los que este archivo ya usaba: 0.3s una consulta,
 * 1.5s un `sendText`, 2.5s un `sendDocument`, 0.5s una URL firmada.
 */
export const PASOS_CIERRE: ReadonlyArray<{ paso: string; donde: string; ms: number }> = [
  { paso: 'registrarCosto del turno',              donde: 'processor.ts:591',  ms: 300 },
  { paso: 'vincularCostosALiquidacion',            donde: 'processor.ts:595',  ms: 300 },
  { paso: 'guardiaCifras → cuadrarDesdeDB',        donde: 'processor.ts:658',  ms: 300 },
  { paso: 'sendText de la respuesta',              donde: 'processor.ts:715',  ms: 1_500 },
  { paso: 'registrarCostoWhatsApp de la respuesta', donde: 'costos.ts',        ms: 300 },
  { paso: 'getGastos para el aviso de barrera',    donde: 'processor.ts:734',  ms: 300 },
  { paso: 'sendText del aviso de barrera',         donde: 'processor.ts:735',  ms: 1_500 },
  { paso: 'registrarCostoWhatsApp de ese aviso',   donde: 'costos.ts',         ms: 300 },
  { paso: 'createSignedUrl del PDF',               donde: 'processor.ts:755',  ms: 500 },
  { paso: 'sendDocument del PDF',                  donde: 'processor.ts:757',  ms: 2_500 },
  { paso: 'registrarCostoWhatsApp del PDF',        donde: 'processor.ts:758',  ms: 300 },
  { paso: 'saveConversation',                      donde: 'processor.ts:774',  ms: 500 },
  { paso: 'releaseViajeLock',                      donde: 'processor.ts:814',  ms: 300 },
];

/** Suma de la tabla de arriba. 8.9s con los costos unitarios de este archivo. */
export const COSTO_CIERRE_MS = PASOS_CIERRE.reduce((s, p) => s + p.ms, 0);

/**
 * Tiempo que se aparta para CERRAR, o sea para todo lo que va DESPUÉS del
 * agente. Sin este margen se gasta hasta el último milisegundo y no queda
 * tiempo ni de responder — que es el fallo que esto viene a evitar.
 *
 * 12s contra los 8.9s de `COSTO_CIERRE_MS`: 3.1s de holgura. El coste es que el
 * agente pasa de 52s a 48s de techo, y el turno típico usa ~20s.
 *
 * OJO CON LO QUE ESTE NÚMERO **NO** ES: no es un tope. Es una RESERVA, y una
 * reserva solo vale lo que valga el techo de cada paso que la consume. De los
 * trece, los que van a Supabase pasan por `repo.ts` y ahí sí llevan
 * `TOPE_CONSULTA_MS` impuesto; los `sendText`/`sendDocument` de `meta/client.ts`
 * siguen usando `fetch` pelado, y ahí el techo es el default de undici: 300s
 * contra un `maxDuration` de 120. Un solo envío colgado se lleva la invocación
 * entera sin dejar rastro, tenga esta reserva el valor que tenga.
 */
export const MARGEN_CIERRE_MS = 12_000;

/**
 * TECHO DURO DE UNA CONSULTA A SUPABASE. Lo impone `repo.ts` en cada llamada.
 *
 * `supabaseAdmin()` construye el cliente sin `fetch` propio, así que hasta aquí
 * NINGUNA consulta ni RPC del sistema llevaba señal de aborto. El default del
 * `fetch` global de Node (undici) es `headersTimeout`/`bodyTimeout` de 300 000
 * ms: un socket aceptado que no contesta bloquea 300s. Medido en esta máquina
 * contra un servidor que acepta y calla, `fetch` seguía bloqueado a los 20s sin
 * el menor síntoma.
 *
 * Vercel mata la función a los 120s (`route.ts:27`), o sea 180s ANTES de que ese
 * fetch se rinda. Y morir así es el peor final posible: la liquidación ya quedó
 * escrita en la base, el operador no recibe ni resumen ni PDF, el
 * `logger.error('pdf.no_entregado')` tampoco se escribe porque el proceso muere
 * antes del `catch`, y Meta —que recibió su 200 en `route.ts:78`— no reintenta.
 *
 * ¿Por qué 8s y no menos? Una consulta de este sistema cuesta ~0.3s en la
 * contabilidad de arriba, así que 8s son 26× lo típico: ninguna consulta sana lo
 * toca ni con un p99 diez veces peor. Y ¿por qué no más? Porque el peor caso
 * sumado de la ruta son ~90.8s contra 120: cada consulta colgada gasta
 * `TOPE − 0.3`s de esa holgura, y con 8s la invocación sobrevive a TRES colgadas
 * antes de tocar el límite. Con el default de undici no sobrevive a una.
 *
 * Se puede subir por entorno sin desplegar (`CUADRA_TOPE_CONSULTA_MS`): la
 * latencia real Vercel ↔ Supabase no está medida, y si resulta peor que la
 * documentada hay que poder aflojarlo desde el panel y no desde un commit.
 */
export const TOPE_CONSULTA_MS = Number(process.env.CUADRA_TOPE_CONSULTA_MS) || 8_000;

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
