import { actorSeudonimo, deduplicar, MAX_EVENTOS_POR_LOTE, normalizarEvento, TOPE_EVENTOS_POR_MINUTO, type EventoNormalizado } from './eventos';
import { pistaGuiaDe } from './pista';
import type { ContextoEvento } from './repo';

// Procesa un lote de eventos del navegador: valida, deduplica, aplica el tope por usuario y minuto y arma el contexto con la identidad
// del SERVIDOR. Sin red ni base (recibe `guardar`), para probarlo entero aunque el interruptor de código esté apagado en producción.

export type VentanaEventos = Map<string, { desde: number; n: number }>;

export const MAX_CLAVES_VENTANA = 2000;

/** Acota el Map en memoria: quita las ventanas ya vencidas y, si aun así pasa de `max`, las más antiguas (orden de inserción). */
export function podarVentana(v: VentanaEventos, ahora: number, max = MAX_CLAVES_VENTANA): void {
  if (v.size <= max) return;
  for (const [k, w] of v) if (ahora - w.desde > 60_000) v.delete(k);
  for (const k of v.keys()) { if (v.size <= max) break; v.delete(k); }
}

/** Tope por clave y minuto (ventana fija). Devuelve false cuando la clave ya gastó su cupo; poda el Map. */
export function consumirCupoPorMinuto(v: VentanaEventos, clave: string, ahora: number, tope: number): boolean {
  const w = v.get(clave);
  const actual = !w || ahora - w.desde > 60_000 ? { desde: ahora, n: 0 } : w;
  if (actual.n >= tope) return false;
  actual.n += 1;
  v.delete(clave); // reinserta al final: el orden del Map sigue siendo «más reciente al último»
  v.set(clave, actual);
  podarVentana(v, ahora);
  return true;
}

export interface EntradaLote {
  activo: boolean;
  lote: unknown;
  sesion: { userId: string; tenantId: string | null; rol: string } | null;
  secreto: string | undefined;
  perfil: string | null;
  ahora: number;
  ventana: VentanaEventos;
  guardar: (ctx: ContextoEvento, lote: readonly EventoNormalizado[]) => Promise<number>;
}

export async function procesarLoteEventos(e: EntradaLote): Promise<{ ok: boolean; guardados: number }> {
  const NADA = { ok: false, guardados: 0 };
  if (!e.activo || !Array.isArray(e.lote)) return NADA;
  const s = e.sesion;
  // «Ver como» (superadmin) nunca escribe; sin secreto no hay seudónimo posible y no se guarda nada.
  if (!s || !s.tenantId || !e.secreto || s.rol === 'superadmin') return NADA;

  const w = e.ventana.get(s.userId);
  const actual = !w || e.ahora - w.desde > 60_000 ? { desde: e.ahora, n: 0 } : w;
  const cupo = TOPE_EVENTOS_POR_MINUTO - actual.n;
  if (cupo <= 0) return NADA;

  const limpios = deduplicar(
    e.lote.slice(0, Math.min(MAX_EVENTOS_POR_LOTE, cupo)).map(normalizarEvento).filter((x): x is EventoNormalizado => x !== null),
    new Set(),
  );
  actual.n += limpios.length;
  e.ventana.delete(s.userId);
  e.ventana.set(s.userId, actual);
  podarVentana(e.ventana, e.ahora);

  const guardados = await e.guardar({
    tenantId: s.tenantId, actor: actorSeudonimo(e.secreto, s.userId), pista: pistaGuiaDe(s.rol, e.perfil) ?? 'sin_pista', rol: s.rol, perfil: e.perfil,
  }, limpios);
  return { ok: guardados > 0, guardados };
}
