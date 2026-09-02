// ═══════════════════════════════════════════════════════════════════════════
// EL TECHO ESTRUCTURAL DE UNA CORRIDA DE CRON (auditoría 24, BE-7).
//
// Es el MISMO mecanismo que `conRelojDuro` en `lib/likida/agentes/runner.ts`
// (auditoría ciclo 7, c7-1), copiado aquí con su firma y su semántica porque
// importar `runner.ts` desde otro cron arrastra el stack entero de agentes
// (redactor, SDR, enviador, finanzas, presupuesto de LLM) a una ruta que solo
// necesita quince líneas. Cuando `salud.ts` lo adopte como helper común, los
// dos se vuelven uno; hasta entonces, cualquier cambio de contrato se hace en
// los dos.
//
// Lo que hace: la ruta deja de esperar a la VUELTA y espera a la CARRERA entre
// la vuelta y el reloj. Un motor que ignore su `venceEn`, que se cuelgue en un
// `fetch` sin tope o que simplemente no reciba reloj (los que corren `new
// Date()` a secas) ya no puede quitarle a la ruta su margen para latir y
// responder: la invocación termina por la puerta de la ruta y no por el
// hachazo del `maxDuration`.
//
// Lo que NO hace: no CANCELA la vuelta. La promesa perdedora sigue corriendo
// hasta que Vercel apaga la invocación — no hay forma de matar un `await` a la
// mitad en JS. Por eso cada motor sigue mirando su propio `venceEn` ANTES de
// cada envío: este techo es la red, no el freno.
// ═══════════════════════════════════════════════════════════════════════════

/** El testigo del corte. Un `Symbol` y no `null`/`undefined` para que una
 *  vuelta que legítimamente resolviera a nulo no se confunda con un corte. */
const CORTE_DURO = Symbol('cron.corte_duro');

export async function conRelojDuro<T>(
  trabajo: PromiseLike<T>,
  /** Instante (ms) en que el reloj gana. Tiene que dejar margen para latir y
   *  responder ANTES del `maxDuration` de la ruta. */
  venceEn: number,
  /** Qué devolver cuando el reloj gana. Función y no valor porque el parte de
   *  lo que alcanzó a pasar solo se puede leer DESPUÉS. */
  alVencer: () => T,
): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race<T | typeof CORTE_DURO>([
      trabajo,
      new Promise<typeof CORTE_DURO>((resolver) => {
        temporizador = setTimeout(() => resolver(CORTE_DURO), Math.max(0, venceEn - Date.now()));
      }),
    ]);
    return r === CORTE_DURO ? alVencer() : r;
  } finally {
    clearTimeout(temporizador);
  }
}
