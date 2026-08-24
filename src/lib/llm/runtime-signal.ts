import { AsyncLocalStorage } from 'node:async_hooks';
export { combineAbortSignals, timeoutSignal } from './runtime-signal-shared';

const toolSignals = new AsyncLocalStorage<AbortSignal | undefined>();

/** Señal de la tool actualmente en ejecución, para clientes de red profundos. */
export function currentToolSignal(): AbortSignal | undefined {
  return toolSignals.getStore();
}

/** Ejecuta una tool dentro de su señal para que Supabase/Storage la hereden. */
export function runWithToolSignal<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  return toolSignals.run(signal, fn);
}

/** Combina señales sin asumir que el runtime expone AbortSignal.any. */
