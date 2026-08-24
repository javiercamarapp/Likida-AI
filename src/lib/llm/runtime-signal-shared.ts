/** Helpers AbortSignal sin Node ni AsyncLocalStorage; aptos para cliente. */
export function combineAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const presentes = signals.filter((s): s is AbortSignal => Boolean(s));
  if (presentes.length === 0) return undefined;
  if (presentes.length === 1) return presentes[0];
  const any = (AbortSignal as typeof AbortSignal & {
    any?: (signals: AbortSignal[]) => AbortSignal;
  }).any;
  if (any) return any(presentes);
  const controller = new AbortController();
  const abortar = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  for (const signal of presentes) {
    if (signal.aborted) abortar(signal);
    else signal.addEventListener('abort', () => abortar(signal), { once: true });
  }
  return controller.signal;
}

export function timeoutSignal(ms: number): AbortSignal {
  if (ms <= 0) {
    const controller = new AbortController();
    controller.abort(new DOMException('Timeout', 'TimeoutError'));
    return controller.signal;
  }
  return AbortSignal.timeout(ms);
}
