// Transporte común de los dos agentes (analista del cliente y copiloto de superadmin): el endpoint transmite NDJSON con eventos
// `{t:'paso', tool, fase:'inicio'|'fin'}` y un evento final `{t:'fin'|'error', ...}`; los caminos de tope contestan JSON plano.
// Se entienden ambos y un evento ilegible se ignora sin tumbar el turno. Una sola lectura para los dos modos.

export async function leerRespuestaAgente(
  resp: Response,
  onPaso: (tool: string, fase: 'inicio' | 'fin') => void,
): Promise<Record<string, unknown> | null> {
  if (!(resp.ok && resp.body && (resp.headers.get('content-type') ?? '').includes('ndjson'))) {
    return resp.json().catch(() => null);
  }
  let d: Record<string, unknown> | null = null;
  const lector = resp.body.getReader();
  const dec = new TextDecoder();
  let resto = '';
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    resto += dec.decode(value, { stream: true });
    let salto;
    while ((salto = resto.indexOf('\n')) >= 0) {
      const linea = resto.slice(0, salto).trim();
      resto = resto.slice(salto + 1);
      if (!linea) continue;
      let ev: Record<string, unknown> | null = null;
      try { ev = JSON.parse(linea) as Record<string, unknown>; } catch { continue; }
      if (ev.t === 'paso' && typeof ev.tool === 'string') onPaso(ev.tool, ev.fase === 'inicio' ? 'inicio' : 'fin');
      else if (ev.t === 'fin' || ev.t === 'error') d = ev;
    }
  }
  return d;
}

/** Marca un paso como terminado: el último renglón sin palomear de esa tool; si no había, lo agrega ya terminado. */
export function cerrarPaso<T extends { tool: string; listo: boolean }>(p: T[], tool: string, extra: Partial<T>): T[] {
  let idx = -1;
  for (let i = p.length - 1; i >= 0; i--) {
    if (p[i].tool === tool && !p[i].listo) { idx = i; break; }
  }
  if (idx >= 0) return p.map((x, i) => (i === idx ? { ...x, listo: true, ...extra } : x));
  return [...p, { tool, listo: true, ...extra } as T];
}
