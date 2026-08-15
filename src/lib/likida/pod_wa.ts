import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from './presupuesto';
import { strip_accents } from './cuadre/util';

// ═══════════════════════════════════════════════════════════════════════════
// EL POD POR FOTO (F4 del plan): la carta porte sellada que el chofer
// fotografía en el andén, en vez de digitalizarla al regreso.
//
// ── CÓMO SE DISTINGUE DE UN COMPROBANTE ────────────────────────────────────
// Por el CAPTION de la foto — el rótulo que el chofer escribe al mandarla.
// Es la única señal determinística que existe: una carta porte y un ticket
// son, para el pipeline, dos fotos. Sin caption que lo diga, la foto sigue
// su camino de comprobante como siempre (no se adivina qué papel es: un
// ticket de diésel tratado como POD desaparecería de la liquidación).
//
// ── POR QUÉ NO ES UN GASTO ─────────────────────────────────────────────────
// La carta porte no vale dinero en la liquidación: es EVIDENCIA de entrega.
// Por eso este camino no toca `gasto`, no paga visión y no participa en la
// barrera del "listo" (cerrar la liquidación no depende de ella).
//
// ── DÓNDE ATERRIZA ─────────────────────────────────────────────────────────
// En la tabla `pod` (0047), que `getPods` ya lee y el tablero de operación
// ya cuenta (`podPendientes`). Subirla aquí es lo que la saca de la lista
// de "viajes sin evidencia" que el encargado persigue.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_LARGO_CAPTION = 80;

/** minúsculas, sin acentos, sin puntuación, espacios colapsados. */
function limpiar(texto: string): string {
  return strip_accents(texto.toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Formas EXACTAS (lista cerrada, como los hitos). "entrega"/"entregado"
 *  pelones sí están: en el caption de una foto no son ambiguos — nadie rotula
 *  así un ticket de diésel. */
const FORMAS_POD = new Set([
  'pod', 'entregado', 'entrega', 'ya entregue', 'ya entregamos',
  'acuse', 'acuse de entrega', 'evidencia de entrega', 'comprobante de entrega',
  'papel de entrega', 'sellada', 'ya sellada',
]);

/**
 * ¿El caption dice que la foto es la carta porte / evidencia de entrega?
 *
 * "carta porte" se busca como SUBCADENA a propósito: el caption real trae
 * contexto ("aquí la carta porte ya sellada") y exigir la frase exacta lo
 * dejaría fuera. El resto son formas exactas.
 */
export function esCaptionPod(texto: string | undefined): boolean {
  if (typeof texto !== 'string' || !texto.trim()) return false;
  if (texto.length > MAX_LARGO_CAPTION) return false;
  const t = limpiar(texto);
  if (t.includes('carta porte')) return true;
  return FORMAS_POD.has(t);
}

export type ResultadoPod = 'subido' | 'fallo';

/**
 * Sella el POD del viaje con su foto. Un POD por viaje (`pod_viaje_unico`):
 * si ya había registro —pedido por la oficina, o un intento rechazado— esta
 * subida lo actualiza a 'subido'. La foto nueva REEMPLAZA a la rechazada y la
 * nota del rechazo se limpia: describía un papel que ya no es el que está.
 *
 * `storagePath` es obligatorio y no negociable: el constraint
 * `pod_subido_tiene_archivo` (0047) rechaza un "subido" sin archivo, porque
 * ese estado haría ver comprobada una entrega que no lo está.
 */
export async function guardarPodDelChofer(
  tenantId: string,
  viajeId: string,
  operadorId: string,
  storagePath: string,
  ahora: Date = new Date(),
): Promise<ResultadoPod> {
  const { error } = await acotada(supabaseAdmin()
    .from('pod')
    .upsert({
      tenant_id: tenantId,
      viaje_id: viajeId,
      operador_id: operadorId,
      estado: 'subido',
      storage_path: storagePath,
      capturado_en: ahora.toISOString(),
      nota: null,
    }, { onConflict: 'viaje_id' }), 'guardarPodDelChofer');
  if (error) {
    logger.error('pod.subida_fallo', { viaje: viajeId, err: error.message });
    return 'fallo';
  }
  logger.info('pod.subido', { viaje: viajeId, operador: operadorId });
  return 'subido';
}

/** El acuse al chofer, con la verdad de cada desenlace. */
export function mensajePod(resultado: ResultadoPod): string {
  if (resultado === 'fallo') {
    return 'No pude guardar tu carta porte ahorita 😕 — consérvala y reenvíamela en un momento, por favor.';
  }
  return 'Recibí tu carta porte sellada ✅ — quedó guardada como evidencia de entrega de este viaje. Ya no hace falta digitalizarla al regreso. 📄';
}
