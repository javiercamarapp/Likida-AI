import { generateResponse } from '@/lib/llm/openrouter';
import { createLlmBudget } from '@/lib/llm/budget';
import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';
import { CATALOGO, estadoEntrevista, mensajeBienvenida } from './entrevista';
import { aplicarTurnoEntrevista, type ResultadoTurno, type PasoEntrevista } from './entrevista-aplicar';

function parecePregunta(t: string): boolean {
  const s = t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return /[¿?]/.test(t) || /^(que|por que|como| expli|explicame|sustento|norma|ley|articulo)\b/.test(s)
    || /\b(que significa|por que (me |lo )?(pregunt|import)|a que articulo)\b/.test(s);
}

function systemExplicar(perfilListo: boolean): string {
  const catalogo = CATALOGO.map((p) =>
    `- ${p.id}: ${p.pregunta} | cita ${p.sustento.cita}${p.sustento.normaId ? ` (ficha ${p.sustento.normaId})` : ' (sin ficha en normas/)'} | ${p.sustento.texto}`,
  ).join('\n');
  return `Eres el configurador fiscal de Likida (liquidación de viajes de flotas de carga en México). Hablas con el DUEÑO de la flota en su primera sesión.

REGLAS QUE NO SE ROMPEN:
- NUNCA declares un hecho fiscal por el usuario. No rellenes un sí, un no, un RFC, un monto, un régimen.
- NUNCA cites un artículo que no esté en el catálogo de abajo. Si no está, di "no tengo esa ficha transcrita" — no la recuerdes de memoria.
- Si el usuario no sabe, el campo queda pendiente. Un default de Likida no es un hecho del cliente.
- No prometas estímulos. El motor los aplica cuando el perfil está declarado, no porque tú lo digas.
- Responde en español, breve (máximo 180 palabras), y termina invitándolo a contestar la pregunta de turno con sí/no o una de las opciones.

Perfil fiscal listo (umbral de peaje declarado): ${perfilListo ? 'sí' : 'no'}.

CATÁLOGO (única fuente de citas):
${catalogo}`;
}

export async function responderEntrevista(opts: {
  tenantId: string;
  userId: string | null;
  perfilCrudo: unknown;
  texto: string;
  historial?: Array<{ rol: 'usuario' | 'asistente'; texto: string }>;
  onPaso?: (p: PasoEntrevista) => void;
}): Promise<ResultadoTurno> {
  const estado = estadoEntrevista(opts.perfilCrudo);

  if (parecePregunta(opts.texto) && process.env.OPENROUTER_API_KEY) {
    opts.onPaso?.({ fase: 'inicio', tool: 'explicar_norma' });
    try {
      const r = await generateResponse({
        role: 'chat',
        system: systemExplicar(estado.perfilListo) + (estado.siguiente
          ? `\n\nPregunta de turno: ${estado.siguiente.pregunta}`
          : '\n\nNo hay pregunta de turno: el catálogo está cubierto.'),
        messages: [
          ...(opts.historial ?? []).slice(-6).map((m) => ({ role: m.rol === 'usuario' ? 'user' as const : 'assistant' as const, content: m.texto })),
          { role: 'user', content: opts.texto },
        ],
        maxTokens: 400,
        temperature: 0.2,
        budget: createLlmBudget(opts.tenantId, randomUUID()),
      });
      opts.onPaso?.({ fase: 'fin', tool: 'explicar_norma' });
      return {
        texto: r.text,
        chips: estado.siguiente?.chips ?? [],
        perfilListo: estado.perfilListo,
        elegiblePeaje: estado.elegiblePeaje,
        guardado: false,
      };
    } catch (e) {
      opts.onPaso?.({ fase: 'fin', tool: 'explicar_norma' });
      logger.warn('entrevista.llm_explicar', { err: e instanceof Error ? e.message : String(e) });
      const bien = mensajeBienvenida(estado);
      return {
        texto: `No pude explicar con el modelo en este momento, y no voy a inventar la norma.\n\n${bien.texto}`,
        chips: bien.chips,
        perfilListo: estado.perfilListo,
        elegiblePeaje: estado.elegiblePeaje,
        guardado: false,
      };
    }
  }

  return aplicarTurnoEntrevista({
    tenantId: opts.tenantId,
    userId: opts.userId,
    perfilCrudo: opts.perfilCrudo,
    texto: opts.texto,
    onPaso: opts.onPaso,
  });
}
