import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
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

export function leerRespuesta(texto: string, t: TResto = T_RESTO_ES): RespuestaAsistente {
  let final: Record<string, unknown> | null = null;
  for (const linea of texto.split('\n')) {
    const l = linea.trim();
    if (!l) continue;
    try {
      const ev = JSON.parse(l) as Record<string, unknown>;
      if (ev && typeof ev === 'object' && (ev.t === 'fin' || ev.t === 'error' || Array.isArray(ev.bloques) || typeof ev.error === 'string')) final = ev;
    } catch { /* una línea rota no tumba las demás */ }
  }
  if (!final) return { ok: false, error: t('op.no_llego_una_respuesta_del_asistente') };
  if (final.t === 'error' || (typeof final.error === 'string' && !Array.isArray(final.bloques))) {
    return { ok: false, error: typeof final.error === 'string' ? final.error.slice(0, 200) : t('op.el_asistente_no_pudo_responder') };
  }
  const bloques = aBloques(final.bloques);
  return bloques.length > 0 ? { ok: true, bloques } : { ok: false, error: t('op.la_respuesta_del_asistente_venia_vacia') };
}

/** Una línea de texto que dice lo que una gráfica enseña (para el historial del asistente y para quien no puede verla). */
export function resumenDeBloque(b: BloqueVista, t: TResto = T_RESTO_ES): string | null {
  if (b.tipo === 'dona') {
    const total = b.segmentos.reduce((t, x) => t + x.valor, 0);
    return b.segmentos.map((x) => `${x.etiqueta}: ${x.valor}${total > 0 ? ` (${Math.round((x.valor / total) * 100)} %)` : ''}`).join(', ');
  }
  if (b.tipo === 'serie') {
    const v = b.puntos.map((p) => p.valor);
    const primero = b.puntos[0]; const ultimo = b.puntos[b.puntos.length - 1];
    return t('op.serie_de_puntos_del_al_minimo', { length: b.puntos.length, dia: primero.dia, valor: primero.valor, dia2: ultimo.dia, valor2: ultimo.valor, minimo: Math.min(...v), maximo: Math.max(...v) });
  }
  return null;
}

/** Lo que se le guarda de un turno al historial para la siguiente pregunta (texto y resumen de gráficas, acotado). */
export function textoDeBloques(bloques: readonly BloqueVista[]): string {
  const partes = bloques.map((b) => (b.tipo === 'texto' ? b.texto : resumenDeBloque(b))).filter((t): t is string => !!t);
  return partes.join(' ').slice(0, 1_800) || 'Listo.';
}

export const preguntasOperacion = (t: TResto = T_RESTO_ES) => ([
  t('op.que_viajes_tienen_excepciones_ahora'),
  t('op.hay_algun_chofer_sin_senal_de'),
  t('op.que_clientes_llevan_esperando_respuesta'),
  t('op.todo_esta_funcionando_algun_agente_fallo'),
] as const);
export const PREGUNTAS_OPERACION = preguntasOperacion();
