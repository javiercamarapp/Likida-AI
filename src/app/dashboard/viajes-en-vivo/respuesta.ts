// ═══════════════════════════════════════════════════════════════════════════
// LEER LA RESPUESTA DEL ASISTENTE — puro. `/api/dashboard/chat` contesta NDJSON (pasos y un evento final `fin` o
// `error`) o, en los caminos de tope diario, JSON plano con `bloques`. El cliente no es frontera de confianza al
// revés: lo que llega se valida por forma y se recorta antes de pintarse.
// ═══════════════════════════════════════════════════════════════════════════

export type BloqueVista =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'cifra'; valor: number; nota?: string }
  | { tipo: 'tabla'; filas: Array<[string, string]> }
  // Las gráficas del asistente (P6): antes se descartaban y la caja decía «la respuesta venía vacía» aunque sí hubiera respuesta.
  | { tipo: 'dona'; segmentos: Array<{ etiqueta: string; valor: number }> }
  | { tipo: 'serie'; puntos: Array<{ dia: string; valor: number }> };

export type RespuestaAsistente = { ok: true; bloques: BloqueVista[] } | { ok: false; error: string };

const MAX_BLOQUES = 6;

function aBloques(crudo: unknown): BloqueVista[] {
  if (!Array.isArray(crudo)) return [];
  const salida: BloqueVista[] = [];
  for (const b of crudo.slice(0, MAX_BLOQUES)) {
    if (!b || typeof b !== 'object') continue;
    const o = b as Record<string, unknown>;
    if (o.tipo === 'texto' && typeof o.texto === 'string' && o.texto.trim()) salida.push({ tipo: 'texto', texto: o.texto.slice(0, 1_200) });
    else if (o.tipo === 'cifra' && typeof o.valor === 'number' && Number.isFinite(o.valor)) salida.push({ tipo: 'cifra', valor: o.valor, nota: typeof o.nota === 'string' ? o.nota.slice(0, 200) : undefined });
    else if (o.tipo === 'tabla' && Array.isArray(o.filas)) {
      const filas = o.filas.slice(0, 12).filter((f): f is [unknown, unknown] => Array.isArray(f) && f.length >= 2)
        .map(([k, v]): [string, string] => [String(k).slice(0, 80), String(v).slice(0, 160)]);
      if (filas.length > 0) salida.push({ tipo: 'tabla', filas });
    } else if (o.tipo === 'dona' && Array.isArray(o.segmentos)) {
      const segmentos = o.segmentos.slice(0, 6).flatMap((x): Array<{ etiqueta: string; valor: number }> => {
        const q = x as { etiqueta?: unknown; valor?: unknown } | null;
        return q && typeof q.etiqueta === 'string' && typeof q.valor === 'number' && Number.isFinite(q.valor) && q.valor >= 0
          ? [{ etiqueta: q.etiqueta.slice(0, 60), valor: q.valor }] : [];
      });
      if (segmentos.length > 0) salida.push({ tipo: 'dona', segmentos });
    } else if (o.tipo === 'serie' && Array.isArray(o.puntos)) {
      const puntos = o.puntos.slice(0, 60).flatMap((x): Array<{ dia: string; valor: number }> => {
        const q = x as { dia?: unknown; valor?: unknown } | null;
        return q && typeof q.dia === 'string' && typeof q.valor === 'number' && Number.isFinite(q.valor) ? [{ dia: q.dia.slice(0, 20), valor: q.valor }] : [];
      });
      if (puntos.length > 0) salida.push({ tipo: 'serie', puntos });
    }
  }
  return salida;
}

export function leerRespuesta(texto: string): RespuestaAsistente {
  let final: Record<string, unknown> | null = null;
  for (const linea of texto.split('\n')) {
    const l = linea.trim();
    if (!l) continue;
    try {
      const ev = JSON.parse(l) as Record<string, unknown>;
      if (ev && typeof ev === 'object' && (ev.t === 'fin' || ev.t === 'error' || Array.isArray(ev.bloques) || typeof ev.error === 'string')) final = ev;
    } catch { /* una línea rota no tumba las demás */ }
  }
  if (!final) return { ok: false, error: 'No llegó una respuesta del asistente.' };
  if (final.t === 'error' || (typeof final.error === 'string' && !Array.isArray(final.bloques))) {
    return { ok: false, error: typeof final.error === 'string' ? final.error.slice(0, 200) : 'El asistente no pudo responder.' };
  }
  const bloques = aBloques(final.bloques);
  return bloques.length > 0 ? { ok: true, bloques } : { ok: false, error: 'La respuesta del asistente venía vacía.' };
}

/** Una línea de texto que dice lo que una gráfica enseña (para el historial del asistente y para quien no puede verla). */
export function resumenDeBloque(b: BloqueVista): string | null {
  if (b.tipo === 'dona') {
    const total = b.segmentos.reduce((t, x) => t + x.valor, 0);
    return b.segmentos.map((x) => `${x.etiqueta}: ${x.valor}${total > 0 ? ` (${Math.round((x.valor / total) * 100)} %)` : ''}`).join(', ');
  }
  if (b.tipo === 'serie') {
    const v = b.puntos.map((p) => p.valor);
    const primero = b.puntos[0]; const ultimo = b.puntos[b.puntos.length - 1];
    return `Serie de ${b.puntos.length} puntos, del ${primero.dia} (${primero.valor}) al ${ultimo.dia} (${ultimo.valor}); mínimo ${Math.min(...v)}, máximo ${Math.max(...v)}.`;
  }
  return null;
}

/** Lo que se le guarda de un turno al historial para la siguiente pregunta (texto y resumen de gráficas, acotado). */
export function textoDeBloques(bloques: readonly BloqueVista[]): string {
  const partes = bloques.map((b) => (b.tipo === 'texto' ? b.texto : resumenDeBloque(b))).filter((t): t is string => !!t);
  return partes.join(' ').slice(0, 1_800) || 'Listo.';
}

export const PREGUNTAS_OPERACION = [
  '¿Qué viajes tienen excepciones ahora?',
  '¿Hay algún chofer sin señal de vida?',
  '¿Qué clientes llevan esperando respuesta?',
  '¿Todo está funcionando? ¿Algún agente falló?',
] as const;
