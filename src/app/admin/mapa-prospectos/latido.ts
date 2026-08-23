// ═══════════════════════════════════════════════════════════════════════════
// EL LATIDO DEL CEREBRO — FE-16, tercera mitad del hallazgo.
//
// El refresco automático era un `setInterval` a secas. Un `setInterval` no
// sabe si alguien está mirando: la pestaña del Cerebro que Javier deja
// abierta en el segundo monitor seguía pidiendo la cartera cada cinco minutos
// toda la noche — 288 lecturas del universo al día por pestaña olvidada, para
// pintar un mapa que nadie ve. Y al volver a la pestaña el mapa podía ser de
// hasta cinco minutos atrás y no se enteraba.
//
// Las dos reglas, entonces:
//  · con la pestaña OCULTA no se late (se anota que quedó un latido a deber);
//  · al VOLVER, un solo latido inmediato — no la ráfaga de los que se
//    saltaron, que sería la misma factura pagada de golpe.
//
// Vive en su propio módulo, sin React y sin `document`, porque así se puede
// probar: el reloj lo pone vitest y la visibilidad la pone la prueba.
// ═══════════════════════════════════════════════════════════════════════════

export interface OpcionesLatido {
  /** Cada cuánto se intenta latir, en ms. */
  intervaloMs: number;
  /** ¿La pestaña está oculta AHORA? (en el navegador:
   *  `document.visibilityState === 'hidden'`). */
  oculto: () => boolean;
  /** Suscribe un aviso de cambio de visibilidad; devuelve el desuscriptor. */
  alCambiarVisibilidad: (cb: () => void) => () => void;
  /** El latido en sí. Si devuelve una promesa, no se encima otro hasta que
   *  termine — con la red lenta, dos lecturas del universo en vuelo a la vez
   *  son exactamente lo que este hallazgo vino a quitar. */
  latir: () => void | Promise<void>;
}

/** Arranca el latido. Devuelve el paro (para el cleanup del efecto). */
export function arrancarLatido(o: OpcionesLatido): () => void {
  // Un latido que no ocurrió por estar oculta la pestaña queda A DEBER: es
  // lo que hace que al volver haya UNA actualización y no ninguna.
  let debe = false;
  let enVuelo = false;
  let vivo = true;

  const intentar = () => {
    if (!vivo || enVuelo) return;
    if (o.oculto()) { debe = true; return; }
    debe = false;
    enVuelo = true;
    void Promise.resolve(o.latir()).finally(() => { enVuelo = false; });
  };

  const reloj = setInterval(intentar, o.intervaloMs);
  const desuscribir = o.alCambiarVisibilidad(() => {
    // Solo al VOLVER y solo si de verdad se saltó uno: entrar y salir de la
    // pestaña sin que pase el intervalo no debe disparar nada.
    if (o.oculto() || !debe) return;
    intentar();
  });

  return () => {
    vivo = false;
    clearInterval(reloj);
    desuscribir();
  };
}

/** El puente con el navegador — la única parte que toca `document`. */
export function visibilidadDelNavegador(): Pick<OpcionesLatido, 'oculto' | 'alCambiarVisibilidad'> {
  return {
    oculto: () => document.visibilityState === 'hidden',
    alCambiarVisibilidad: (cb) => {
      document.addEventListener('visibilitychange', cb);
      return () => document.removeEventListener('visibilitychange', cb);
    },
  };
}
