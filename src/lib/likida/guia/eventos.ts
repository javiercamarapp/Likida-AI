import { createHmac } from 'node:crypto';
import { TIPOS_EVENTO_GUIA, type EventoGuiaEntrante, type TipoEventoGuia } from './tipos';

// Eventos de aprendizaje SIN datos personales (SPEC 2.8). El navegador manda solo tipo, ids de paso y números; el servidor pone el
// seudónimo (HMAC con un secreto que ya existe), el rol y la pista. Sin correo, nombre, IP, user agent ni texto libre.

/** Interruptor de código (no variable de entorno): apagado hasta que el aviso de privacidad mencione esta medición (D-OB-8). */
export const GUIA_EVENTOS = false;
export const MAX_EVENTOS_POR_LOTE = 20;
export const TOPE_EVENTOS_POR_MINUTO = 60;

const ES_PASO = /^[A-Za-z0-9._-]{1,40}$/;
const ES_RECORRIDO = /^[a-z0-9._-]{1,80}$/;

/** Seudónimo de 16 hex: no reversible sin el secreto. El `user_id` jamás sale del servidor. */
export function actorSeudonimo(secreto: string, userId: string): string {
  return createHmac('sha256', secreto).update(`guia-actor:${userId}`).digest('hex').slice(0, 16);
}

export interface EventoNormalizado {
  tipo: TipoEventoGuia;
  recorrido: string | null;
  paso_id: string | null;
  valor_ms: number | null;
  valor_n: number | null;
  canal: 'movil' | 'escritorio';
  reducido: boolean;
}

const entero = (x: unknown, max: number): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(Math.round(x), max) : null);

/** Valida un evento entrante. Lo que no encaja se descarta (null): nunca se «arregla» ni se guarda texto libre. */
export function normalizarEvento(e: unknown): EventoNormalizado | null {
  if (typeof e !== 'object' || e === null) return null;
  const x = e as Partial<EventoGuiaEntrante>;
  if (!TIPOS_EVENTO_GUIA.includes(x.tipo as TipoEventoGuia)) return null;
  if (x.canal !== 'movil' && x.canal !== 'escritorio') return null;
  const paso = typeof x.pasoId === 'string' && ES_PASO.test(x.pasoId) ? x.pasoId : null;
  const rec = typeof x.recorrido === 'string' && ES_RECORRIDO.test(x.recorrido) ? x.recorrido : null;
  if (x.pasoId !== undefined && paso === null) return null;
  if (x.recorrido !== undefined && rec === null) return null;
  return {
    tipo: x.tipo as TipoEventoGuia, recorrido: rec, paso_id: paso, valor_ms: entero(x.valorMs, 86_400_000), valor_n: entero(x.valorN, 1_000_000),
    canal: x.canal, reducido: x.reducido === true,
  };
}

/** Quita los repetidos del lote por (paso, tipo): una persona que vuelve a un paso no infla el conteo. */
export function deduplicar(lote: readonly EventoNormalizado[], vistos: Set<string>): EventoNormalizado[] {
  const sal: EventoNormalizado[] = [];
  for (const e of lote) {
    const clave = `${e.paso_id ?? '-'}|${e.tipo}`;
    if (e.paso_id !== null && vistos.has(clave)) continue;
    vistos.add(clave);
    sal.push(e);
  }
  return sal;
}
