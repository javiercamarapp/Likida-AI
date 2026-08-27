// ═══════════════════════════════════════════════════════════════════════════
// CAPA E1 DEL AGENTE DE AYUDA EN RUTA — la nota de voz del chofer, transcrita.
//
// El chofer asustado manda audio, no escribe (blueprint 19, capa E). Hasta hoy
// esa nota recibía «por ahora solo proceso texto y fotos» — inaceptable en una
// emergencia. Este módulo convierte el audio en TEXTO y nada más: el texto
// entra al MISMO camino que un mensaje escrito (reconocedor ROJO/ámbar,
// talacha, hitos, confirmaciones) — aquí no se decide nada, solo se escucha.
//
// El contrato fail-closed, en orden de importancia:
//   · JAMÁS se inventa contenido. El transcriptor escribe lo que se oye; si el
//     audio es ininteligible, está vacío o no es habla, devuelve `ilegible` y
//     el chofer recibe «¿me lo escribes?» — nunca silencio, nunca una
//     adivinanza que dispare (o calle) un protocolo de emergencia.
//   · El presupuesto LLM del tenant manda (mismo guardarraíl que el OCR):
//     agotado, se pide el texto sin cobrar de más.
//   · El costo real se asienta en `llm_costo` (fase 'transcripcion') como
//     cualquier otra llamada — el gasto por escuchar no es invisible.
//
// La idempotencia NO vive aquí: `wa_mensaje_procesado` ya garantiza que un
// mismo waMessageId no se procese (ni transcriba) dos veces — el claim del
// webhook corre antes de que este módulo exista en la conversación.
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { generateStructured } from '@/lib/llm/openrouter';
import { createLlmBudget, LlmBudgetExceededError } from '@/lib/llm/budget';
import { downloadMediaAsDataUrl } from '@/lib/meta/client';
import { registrarCosto } from './costos';
import { logger } from '@/lib/logger';

/** Lo que el chofer recibe cuando no se pudo escuchar. Una sola voz en todo
 *  el módulo para que la prueba estructural pueda fijarla. */
export const RESPUESTA_NO_ENTENDI = 'No te entendí bien 🙏 ¿me lo escribes?';
export const RESPUESTA_SIN_PRESUPUESTO =
  'No pude escuchar tu nota de voz ahora mismo 🙏 ¿me lo escribes?';

export type ResultadoTranscripcion =
  | { ok: true; texto: string }
  /**
   * `ilegible`: el audio se escuchó y no se entendió (o no era habla).
   * `presupuesto`: el tope LLM del día del tenant no alcanza — no se cobró.
   * `fallo`: fallo NUESTRO (descarga, proveedor, timeout) — no del chofer.
   */
  | { ok: false; motivo: 'ilegible' | 'presupuesto' | 'fallo' };

// El transcriptor NO redacta: schema de dos campos y temperatura 0 (models.ts).
// `inteligible=false` es un resultado VÁLIDO y esperado — el modelo tiene
// permiso explícito de no entender, que es lo que le quita el incentivo de
// rellenar con lo que "probablemente" dijo.
const TranscripcionSchema = z.object({
  inteligible: z.boolean(),
  texto: z.string().nullable(),
});

const SYSTEM = `Transcribes notas de voz de choferes de tráileres mexicanos, en español coloquial de México.

Reglas, en este orden:
1. Escribe EXACTAMENTE lo que se oye, palabra por palabra. No resumas, no corrijas la gramática, no completes frases cortadas.
2. Si el audio está vacío, cortado, es puro ruido, música, o no logras distinguir las palabras con claridad: inteligible=false y texto=null. Está PERMITIDO no entender — es mejor que adivinar.
3. Jamás agregues palabras que no se escuchan claramente. Una palabra dudosa a la mitad de una frase clara se marca como [inaudible], no se inventa.
4. No traduzcas ni normalices modismos: "se me ponchó", "traigo un jalón", "me quedé tirado" se escriben tal cual.`;

/** El formato que OpenRouter espera, derivado del mime que reportó Meta.
 *  WhatsApp manda las notas de voz como audio/ogg (codec opus); los audios
 *  reenviados pueden venir en mp3/mp4/amr. Ante un mime desconocido se cae a
 *  'ogg' — el formato de la nota de voz nativa, que es el caso que importa. */
export function formatoDesdeMime(mime: string | null): string {
  const m = (mime ?? '').toLowerCase();
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('mp4') || m.includes('aac') || m.includes('m4a')) return 'mp4';
  if (m.includes('wav')) return 'wav';
  if (m.includes('amr')) return 'amr';
  return 'ogg';
}

/**
 * Descarga la nota de voz de Meta, la transcribe y devuelve el texto — o el
 * motivo honesto de por qué no. No responde WhatsApp ni toca el router: el
 * llamador (processor) decide qué hacer con el resultado.
 */
export async function transcribirNotaDeVoz(args: {
  tenantId: string;
  mediaId: string;
  senal?: AbortSignal;
}): Promise<ResultadoTranscripcion> {
  // La descarga reutiliza el mecanismo del OCR (data-URL): mismo token de
  // Meta, mismos timeouts, mismos logs de fallo con el cuerpo que distingue
  // token vencido de media caducado.
  const dataUrl = await downloadMediaAsDataUrl(args.mediaId);
  if (!dataUrl) return { ok: false, motivo: 'fallo' };

  const coma = dataUrl.indexOf(',');
  const cabecera = dataUrl.slice(0, coma); // data:audio/ogg;base64
  const base64 = dataUrl.slice(coma + 1);
  if (!base64) return { ok: false, motivo: 'fallo' };
  const mime = cabecera.replace(/^data:/, '').replace(/;base64$/, '') || null;

  try {
    const res = await generateStructured({
      role: 'transcripcion',
      system: SYSTEM,
      messages: [{ role: 'user', content: 'Transcribe esta nota de voz.' }],
      audios: [{ data: base64, format: formatoDesdeMime(mime) }],
      schema: TranscripcionSchema,
      schemaName: 'transcripcion',
      signal: args.senal,
      budget: createLlmBudget(args.tenantId, randomUUID()),
      // Una nota de voz de WhatsApp dura segundos, no minutos: el tope corto
      // acota el costo del peor caso sin recortar ninguna nota real.
      maxTokens: 1000,
    });
    // El costo se asienta gane o pierda la inteligibilidad: se pagó por
    // escuchar, y esa es la cifra que el tope diario del tenant debe ver.
    await registrarCosto({
      tenantId: args.tenantId, viajeId: null, fase: 'transcripcion',
      modelo: res.model, tokensIn: res.tokensIn, tokensOut: res.tokensOut, costoUsd: res.cost,
    });
    const texto = res.data.texto?.trim() ?? '';
    if (!res.data.inteligible || !texto) return { ok: false, motivo: 'ilegible' };
    return { ok: true, texto };
  } catch (e) {
    if (e instanceof LlmBudgetExceededError) {
      // La reserva rechazada no cobró nada — ese es justo su trabajo.
      logger.warn('voz.sin_presupuesto', { tenant: args.tenantId });
      return { ok: false, motivo: 'presupuesto' };
    }
    logger.error('voz.transcripcion_fallo', {
      tenant: args.tenantId, mediaId: args.mediaId,
      err: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, motivo: 'fallo' };
  }
}
