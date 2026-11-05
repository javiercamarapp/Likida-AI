import { actorSeudonimo, deduplicar, MAX_EVENTOS_POR_LOTE, normalizarEvento, TOPE_EVENTOS_POR_MINUTO, type EventoNormalizado } from './eventos';
import { pistaGuiaDe } from './pista';
import type { ContextoEvento } from './repo';

// Procesa un lote de eventos del navegador: valida, deduplica, aplica el tope por usuario y minuto y arma el contexto con la identidad
// del SERVIDOR. Sin red ni base (recibe `guardar`), para probarlo entero aunque el interruptor de código esté apagado en producción.

export type VentanaEventos = Map<string, { desde: number; n: number }>;

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
  e.ventana.set(s.userId, actual);

  const guardados = await e.guardar({
    tenantId: s.tenantId, actor: actorSeudonimo(e.secreto, s.userId), pista: pistaGuiaDe(s.rol, e.perfil) ?? 'sin_pista', rol: s.rol, perfil: e.perfil,
  }, limpios);
  return { ok: guardados > 0, guardados };
}
