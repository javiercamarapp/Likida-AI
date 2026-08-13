// ═══════════════════════════════════════════════════════════════════════════
// El agente ANALISTA del chat del panel (12-ago-2026) — orquesta el ciclo de
// tools y entrega BLOQUES tipados que la interfaz pinta con sus componentes
// reales (texto/cifra/tabla/dona/serie).
//
// Arquitectura elegida (y por qué):
//  - Fast-path determinístico en el CLIENTE (chat.tsx, gratis) para las
//    preguntas enlatadas; aquí solo llega lo que necesita pensar.
//  - UN analista con tools de lectura (chat-tools.ts) — no un enjambre de
//    agentes: la gráfica la pintan los componentes con datos de tools, así
//    que "un agente para gráficas" solo cobraría renta.
//  - La respuesta sale por la tool terminal `entregar_respuesta` (contrato
//    tipado) — más robusto que pedirle JSON al texto final.
//  - GUARDIA DE CIFRAS determinística al final: toda cifra de los bloques
//    tiene que existir en lo que devolvieron las tools (o en la pregunta
//    del usuario). Mismo principio que cuadre/guardia.ts: la confianza del
//    contralor vale más que una respuesta bonita.
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';
import type OpenAI from 'openai';
import { generateWithTools } from '@/lib/llm/openrouter';
import { toolSchemas, makeExecutor, registerTool, type ToolContext } from '@/lib/llm/tool-executor';
import { getSystemPrompt } from './prompts';
import { logger } from '@/lib/logger';
import { ahoraMs } from '@/lib/saludo';
import './chat-tools'; // registra las tools de lectura al importar

// ── El contrato de bloques ──────────────────────────────────────────────────

export type Bloque =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'cifra'; valor: number; formato?: 'mxn' | 'litros' | 'numero'; nota?: string }
  | { tipo: 'tabla'; filas: Array<[string, string | number]> }
  | { tipo: 'dona'; segmentos: Array<{ etiqueta: string; valor: number }> }
  | { tipo: 'serie'; puntos: Array<{ dia: string; valor: number }>; formato?: 'mxn' | 'numero' };

const TOOLS_LECTURA = [
  'kpis_flota', 'acreditables_periodo', 'motor_fiscal', 'viajes_flota',
  'liquidaciones_flota', 'serie_gasto', 'serie_liquidado', 'top_rutas',
  'duplicados_detectados', 'proyectar_serie',
];

/** Valida y recorta lo que el modelo entregó — nunca se confía en la forma. */
export function validarBloques(crudo: unknown): Bloque[] | null {
  if (!Array.isArray(crudo) || crudo.length === 0 || crudo.length > 6) return null;
  const limpios: Bloque[] = [];
  for (const b of crudo) {
    if (!b || typeof b !== 'object') return null;
    const t = (b as { tipo?: unknown }).tipo;
    if (t === 'texto') {
      const texto = (b as { texto?: unknown }).texto;
      if (typeof texto !== 'string' || !texto.trim() || texto.length > 900) return null;
      limpios.push({ tipo: 'texto', texto: texto.trim() });
    } else if (t === 'cifra') {
      const v = (b as { valor?: unknown }).valor;
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      const f = (b as { formato?: unknown }).formato;
      const nota = (b as { nota?: unknown }).nota;
      limpios.push({
        tipo: 'cifra', valor: v,
        formato: f === 'mxn' || f === 'litros' || f === 'numero' ? f : 'numero',
        nota: typeof nota === 'string' ? nota.slice(0, 200) : undefined,
      });
    } else if (t === 'tabla') {
      const filas = (b as { filas?: unknown }).filas;
      if (!Array.isArray(filas) || filas.length === 0 || filas.length > 10) return null;
      const normalizadas: Array<[string, string | number]> = [];
      for (const f of filas) {
        if (Array.isArray(f) && f.length === 2 && typeof f[0] === 'string'
          && (typeof f[1] === 'string' || typeof f[1] === 'number')) {
          normalizadas.push([f[0], f[1]]);
        } else if (f && typeof f === 'object'
          && typeof (f as { concepto?: unknown }).concepto === 'string'
          && (typeof (f as { valor?: unknown }).valor === 'string' || typeof (f as { valor?: unknown }).valor === 'number')) {
          // La forma que entrega el modelo (el schema de la tool pide
          // objetos porque Gemini rechaza tuplas sin `items`).
          normalizadas.push([(f as { concepto: string }).concepto, (f as { valor: string | number }).valor]);
        } else {
          return null;
        }
      }
      limpios.push({ tipo: 'tabla', filas: normalizadas });
    } else if (t === 'dona') {
      const seg = (b as { segmentos?: unknown }).segmentos;
      if (!Array.isArray(seg) || seg.length === 0 || seg.length > 6) return null;
      const ok = seg.every((s) => s && typeof (s as { etiqueta?: unknown }).etiqueta === 'string'
        && typeof (s as { valor?: unknown }).valor === 'number' && (s as { valor: number }).valor >= 0);
      if (!ok) return null;
      limpios.push({ tipo: 'dona', segmentos: seg as Array<{ etiqueta: string; valor: number }> });
    } else if (t === 'serie') {
      const p = (b as { puntos?: unknown }).puntos;
      if (!Array.isArray(p) || p.length === 0 || p.length > 60) return null;
      const ok = p.every((x) => x && typeof (x as { dia?: unknown }).dia === 'string'
        && typeof (x as { valor?: unknown }).valor === 'number');
      if (!ok) return null;
      const f = (b as { formato?: unknown }).formato;
      limpios.push({ tipo: 'serie', puntos: p as Array<{ dia: string; valor: number }>, formato: f === 'mxn' ? 'mxn' : 'numero' });
    } else {
      return null;
    }
  }
  return limpios;
}

// ── Guardia de cifras ───────────────────────────────────────────────────────

/** Saca TODOS los números de un valor (recursivo) — de números crudos y de
 *  los dígitos incrustados en strings (fechas, folios, "Sem 32"). */
export function extraerNumeros(v: unknown, destino: Set<number>): void {
  if (typeof v === 'number' && Number.isFinite(v)) {
    destino.add(Math.round(v * 100) / 100);
    destino.add(Math.abs(Math.round(v * 100) / 100));
    return;
  }
  if (typeof v === 'string') {
    // Primero el patrón CON separador de miles ("8,340.50") y luego el
    // simple — al revés, "8,340.50" se partía en 8340 y 50 y un monto real
    // narrado con formato es-MX se leía como inventado.
    for (const m of v.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g)) {
      const n = Number(m[0].replace(/,/g, ''));
      if (Number.isFinite(n)) destino.add(Math.round(n * 100) / 100);
    }
    return;
  }
  if (Array.isArray(v)) { for (const x of v) extraerNumeros(x, destino); return; }
  if (v && typeof v === 'object') { for (const x of Object.values(v)) extraerNumeros(x, destino); }
}

/** Enteros chicos (conteos que el modelo hace sobre listas), 50 (el peaje se
 *  describe "al 50%") y 100 (porcentajes) no delatan invención — bloquearlos
 *  convertía "te muestro 3 rutas" en una respuesta muerta. El trade-off está
 *  a la vista: un monto inventado de $7.00 pasaría; uno de $7,000 no. */
const BLANCOS = new Set<number>([...Array.from({ length: 13 }, (_, i) => i), 50, 100]);

/** Una cifra también cuenta como respaldada si es DERIVADA simple de dos
 *  respaldadas: suma, resta o porcentaje (a/b). Comparar dos números reales
 *  ("gastaste 500 más", "eso es el 38%") es interpretar, no inventar — y la
 *  verificación sigue siendo determinística. UN nivel de derivación, a
 *  propósito: derivadas de derivadas ya no se distinguen de invención. */
export function esDerivada(n: number, respaldo: Set<number>): boolean {
  const arr = [...respaldo];
  // Tope de trabajo: con cientos de números el n² sigue siendo barato, pero
  // un respaldo patológicamente grande no debe colgar el turno.
  if (arr.length > 600) return false;
  for (let i = 0; i < arr.length; i++) {
    for (let j = i; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      if (Math.abs(a + b - n) < 0.011) return true;
      if (Math.abs(Math.abs(a - b) - n) < 0.011) return true;
      if (b !== 0 && Math.abs((a / b) * 100 - n) < 0.6) return true;
      if (a !== 0 && Math.abs((b / a) * 100 - n) < 0.6) return true;
    }
  }
  return false;
}

/** true si toda cifra de los bloques está respaldada por las tools o por la
 *  propia pregunta del usuario. */
export function cifrasRespaldadas(bloques: Bloque[], respaldo: Set<number>): boolean {
  const usadas = new Set<number>();
  for (const b of bloques) {
    if (b.tipo === 'texto') extraerNumeros(b.texto, usadas);
    else if (b.tipo === 'cifra') { usadas.add(Math.round(b.valor * 100) / 100); if (b.nota) extraerNumeros(b.nota, usadas); }
    else if (b.tipo === 'tabla') extraerNumeros(b.filas, usadas);
    else if (b.tipo === 'dona') for (const s of b.segmentos) usadas.add(Math.round(s.valor * 100) / 100);
    else for (const p of b.puntos) usadas.add(Math.round(p.valor * 100) / 100);
  }
  for (const n of usadas) {
    if (BLANCOS.has(n)) continue;
    if (respaldo.has(n)) continue;
    if (esDerivada(n, respaldo)) continue;
    // Un monto "1234.5" narrado como "1,234.50" ya se normalizó al extraer;
    // si aun así no está, es una cifra que ninguna tool devolvió.
    logger.warn('chat.guardia_cifra', { cifra: n });
    return false;
  }
  return true;
}

// ── entregar_respuesta (tool terminal) ──────────────────────────────────────

// La captura por corrida vive en un mapa por conversationId (uuid del run):
// el handler no puede devolverle los bloques al llamador de otra forma sin
// romper el contrato genérico del executor.
const CAPTURAS = new Map<string, Bloque[]>();

registerTool('entregar_respuesta', {
  schema: {
    type: 'function',
    function: {
      name: 'entregar_respuesta',
      description: 'OBLIGATORIA para terminar: entrega tu respuesta final como bloques. Al menos un bloque "texto"; máximo una gráfica (dona o serie).',
      parameters: {
        type: 'object',
        properties: {
          bloques: {
            type: 'array',
            description: 'La respuesta, en orden de lectura.',
            items: {
              type: 'object',
              properties: {
                tipo: { type: 'string', enum: ['texto', 'cifra', 'tabla', 'dona', 'serie'] },
                texto: { type: 'string' },
                valor: { type: 'number' },
                formato: { type: 'string', enum: ['mxn', 'litros', 'numero'] },
                nota: { type: 'string' },
                filas: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { concepto: { type: 'string' }, valor: { type: 'string' } },
                    required: ['concepto', 'valor'],
                  },
                },
                segmentos: { type: 'array', items: { type: 'object', properties: { etiqueta: { type: 'string' }, valor: { type: 'number' } } } },
                puntos: { type: 'array', items: { type: 'object', properties: { dia: { type: 'string' }, valor: { type: 'number' } } } },
              },
              required: ['tipo'],
            },
          },
        },
        required: ['bloques'],
        additionalProperties: false,
      },
    },
  },
  handler: async (args, ctx) => {
    const bloques = validarBloques((args as { bloques?: unknown }).bloques);
    if (!bloques) return { ok: false, error: 'bloques inválidos: revisa tipos y tamaños, y vuelve a llamar entregar_respuesta' };
    if (ctx.conversationId) CAPTURAS.set(ctx.conversationId, bloques);
    // La instrucción viaja en el RESULTADO porque el modelo chico la
    // necesita ahí: sin ella volvía a llamar tools y reventaba el tope de
    // rondas (medido con gpt-5-nano el 12-ago).
    return { ok: true, instruccion: 'Tu respuesta ya quedó entregada. Termina tu turno con la palabra "listo" y NADA más — sin llamar otra tool.' };
  },
});

// ── pasar_al_analista (la palanca de escalación del conserje) ──────────────

const ESCALAS = new Map<string, string>();

registerTool('pasar_al_analista', {
  schema: {
    type: 'function',
    function: {
      name: 'pasar_al_analista',
      description: 'Escala la pregunta al analista de datos (tiene las herramientas de la operación). Úsala SIEMPRE que la respuesta requiera cifras, gráficas, tablas, comparaciones o proyecciones.',
      parameters: {
        type: 'object',
        properties: { razon: { type: 'string', description: 'Por qué se escala, en una frase.' } },
        required: ['razon'],
        additionalProperties: false,
      },
    },
  },
  handler: async (args, ctx) => {
    if (ctx.conversationId) ESCALAS.set(ctx.conversationId, String((args as { razon?: unknown }).razon ?? ''));
    return { ok: true, nota: 'escalado al analista' };
  },
});

// ── El orquestador ──────────────────────────────────────────────────────────

export interface RespuestaAnalista {
  bloques: Bloque[];
  /** Qué tools llamó el modelo — para el conjunto dorado y el diagnóstico. */
  toolsUsadas: string[];
  costoUsd: number;
  costoPorModelo: Record<string, { tokensIn: number; tokensOut: number; cost: number }>;
  tokensIn: number;
  tokensOut: number;
  modelo: string;
}

const AVISO_SIN_RESPALDO = 'No pude armar esa respuesta con cifras respaldadas por el sistema, y prefiero no darte números que no pueda sostener. Reformúlala o pregúntame por una de las lecturas del catálogo de Consulta.';

export async function ejecutarAnalista(opts: {
  tenantId: string;
  nombreFlota: string;
  /** Quién está del otro lado — el agente ajusta a quién le habla (un
   *  contador pregunta distinto que el dueño). Viene de la SESIÓN, jamás
   *  del cuerpo de la petición. */
  usuario?: { nombre: string | null; rol: string };
  mensajes: Array<{ rol: 'usuario' | 'asistente'; texto: string }>;
  timeoutMs?: number;
}): Promise<RespuestaAnalista> {
  const runId = randomUUID();
  const ctx: ToolContext = { tenantId: opts.tenantId, conversationId: runId };
  const ROL_LEGIBLE: Record<string, string> = {
    flota_admin: 'dueño/administrador de la flota',
    contador: 'contador de la flota (enfócate en lo fiscal y financiero)',
    superadmin: 'integrante del equipo Likida revisando esta flota',
  };
  const audiencia = opts.usuario
    ? `\n\nCON QUIÉN HABLAS: ${opts.usuario.nombre ?? 'usuario'} — ${ROL_LEGIBLE[opts.usuario.rol] ?? opts.usuario.rol}. Salúdalo por su nombre cuando salude.`
    : '';
  const system = getSystemPrompt('analista_flota', {
    tenantId: opts.tenantId, nombreFlota: opts.nombreFlota, agentName: 'Likida', timezone: 'America/Mexico_City',
  }) + audiencia;

  const history: OpenAI.Chat.ChatCompletionMessageParam[] = opts.mensajes.map((m) => ({
    role: m.rol === 'usuario' ? 'user' : 'assistant', content: m.texto,
  }));

  // PRESUPUESTOS DE TIEMPO SEPARADOS: uno global compartido dejaba al
  // reintento sin aire (nano razona lento + analista + reintento > 45s →
  // aborto a medias, medido en vivo). El conserje tiene 15s; el analista
  // (con su reintento) 40s propios — la ruta cabe en el maxDuration de 60.
  const conserjeCtl = new AbortController();
  const conserjeTimer = setTimeout(() => conserjeCtl.abort(), 15_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 40_000);
  try {
    // ── NIVEL 1: el CONSERJE (modelo barato) recibe TODO mensaje y decide —
    // conversa él, o jala pasar_al_analista. Es el orquestador que pedía
    // Javier ("según lo que el usuario quiere sabe qué modelo usar"), y es
    // un MODELO decidiendo, no un regex de respuestas prehechas.
    let conserje: Awaited<ReturnType<typeof generateWithTools>>;
    try {
      conserje = await generateWithTools({
        role: 'chat_ligero',
        system: getSystemPrompt('conserje_chat', {
          tenantId: opts.tenantId, nombreFlota: opts.nombreFlota, agentName: 'Likida', timezone: 'America/Mexico_City',
        }) + audiencia,
        messages: history,
        tools: toolSchemas(['entregar_respuesta', 'pasar_al_analista']),
        toolExecutor: makeExecutor(ctx),
        maxToolRounds: 3,
        // gpt-5-nano RAZONA antes de hablar y esos tokens también cuentan:
        // con 350 se quedaba pensando y el guardián de truncado tronaba
        // (medido en vivo el 12-ago: 320/350 sin emitir nada). 900 de techo a
        // precio nano son $0.00036 en el peor caso — y reasoning en 'low'
        // porque un saludo no amerita cadena de pensamiento larga.
        maxTokens: 900,
        reasoning: 'low',
        signal: conserjeCtl.signal,
      });
    } catch (e) {
      // El conserje que truena o se tarda NO tumba el turno: se escala al
      // analista, que es el que sabe. Fail-hacia-el-capaz.
      logger.warn('chat.conserje_fallo', { err: e instanceof Error ? e.message : String(e) });
      ESCALAS.set(runId, 'conserje falló');
      conserje = { finalText: '', toolCalls: [], model: 'openai/gpt-5-nano', tokensIn: 0, tokensOut: 0, cost: 0, costoPorModelo: {} };
    } finally {
      clearTimeout(conserjeTimer);
    }

    const escalado = ESCALAS.has(runId);
    // Si escaló, lo que el conserje haya "entregado" ("ya te paso al
    // analista...") NO es la respuesta: se descarta para que los bloques
    // finales sean los del analista — medido en vivo: la transición tapaba
    // el análisis.
    if (escalado) CAPTURAS.delete(runId);
    const res = !escalado ? conserje : await generateWithTools({
      role: 'chat',
      system,
      messages: history,
      tools: toolSchemas([...TOOLS_LECTURA, 'entregar_respuesta']),
      toolExecutor: makeExecutor(ctx),
      // Anti-quemadura por turno: 5 rondas y 900 tokens de salida bastan
      // para un análisis con 3-4 tools; lo que no cabe ahí es señal de que
      // la pregunta necesita partirse, no de que hay que pagar más.
      maxToolRounds: 5,
      maxTokens: 900,
      temperature: 0.2,
      signal: controller.signal,
    });

    // El respaldo de la guardia: todo lo que las tools devolvieron en este
    // turno + los números que el usuario mismo escribió.
    const respaldo = new Set<number>();
    for (const t of res.toolCalls) extraerNumeros(t.result, respaldo);
    extraerNumeros(opts.mensajes.map((m) => m.texto).join(' '), respaldo);
    // La fecha de HOY también respalda: "el ejercicio 2026" en un saludo no
    // es invención, es calendario — sin esto, la guardia tumbaba un "hola"
    // (medido en vivo el 12-ago: el saludo mencionaba el año y no había
    // tool que lo respaldara).
    extraerNumeros(new Date(ahoraMs()).toISOString().slice(0, 10), respaldo);

    let bloques = CAPTURAS.get(runId)
      ?? (res.finalText.trim() ? [{ tipo: 'texto', texto: res.finalText.trim().slice(0, 900) } as Bloque] : null);

    // UN reintento correctivo, solo en el camino del analista: flash-lite a
    // veces contesta en texto plano sin la tool terminal, o con una cifra
    // que la guardia tumba. Repreguntar con la instrucción exacta rescata
    // el turno por centavos; a la segunda falla, honestidad y ya.
    let reintento = false;
    const necesitaReintento = () => !bloques || !cifrasRespaldadas(bloques, respaldo);
    if (escalado && necesitaReintento()) {
      reintento = true;
      logger.warn('chat.reintento_correctivo', { tenantId: opts.tenantId });
      const res2 = await generateWithTools({
        role: 'chat',
        system,
        messages: [...history, {
          role: 'assistant', content: res.finalText || '(sin respuesta)',
        }, {
          role: 'user',
          content: 'SISTEMA: entrega tu respuesta AHORA llamando la tool entregar_respuesta, usando EXCLUSIVAMENTE cifras que hayan devuelto tus tools en esta conversación (vuelve a llamarlas si te hace falta). Sin cifras de otra fuente.',
        }],
        tools: toolSchemas([...TOOLS_LECTURA, 'entregar_respuesta']),
        toolExecutor: makeExecutor(ctx),
        maxToolRounds: 4,
        maxTokens: 900,
        temperature: 0,
        signal: controller.signal,
      });
      for (const t of res2.toolCalls) extraerNumeros(t.result, respaldo);
      res.toolCalls.push(...res2.toolCalls);
      bloques = CAPTURAS.get(runId)
        ?? (res2.finalText.trim() ? [{ tipo: 'texto', texto: res2.finalText.trim().slice(0, 900) } as Bloque] : null);
      // El costo del reintento también se reporta.
      for (const [m, c] of Object.entries(res2.costoPorModelo)) {
        const prev = res.costoPorModelo[m] ?? { tokensIn: 0, tokensOut: 0, cost: 0 };
        res.costoPorModelo[m] = { tokensIn: prev.tokensIn + c.tokensIn, tokensOut: prev.tokensOut + c.tokensOut, cost: prev.cost + c.cost };
      }
      res.cost += res2.cost; res.tokensIn += res2.tokensIn; res.tokensOut += res2.tokensOut;
    }

    // ÚLTIMA RED, determinística: si el modelo enmudeció o la guardia lo
    // tumbó pero las tools SÍ leyeron datos, se arma una tabla con lo
    // leído — datos reales sin narración le sirven más al contralor que
    // una disculpa. Solo si ni eso hay, sale el aviso honesto.
    const todasLasTools = [...res.toolCalls];
    if (!bloques || !cifrasRespaldadas(bloques, respaldo)) {
      if (bloques) logger.warn('chat.guardia_bloqueo', { tenantId: opts.tenantId, reintento });
      const kpisCall = todasLasTools.find((t) => t.toolName === 'kpis_flota' && t.result && !t.error);
      const primera = kpisCall ?? todasLasTools.find((t) => t.result && !t.error && t.toolName !== 'entregar_respuesta' && t.toolName !== 'pasar_al_analista');
      if (primera && primera.result && typeof primera.result === 'object') {
        const filas = Object.entries(primera.result as Record<string, unknown>)
          .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
          .slice(0, 10)
          .map(([k, v]) => [k, v] as [string, string | number]);
        bloques = filas.length > 0
          ? [
            { tipo: 'texto', texto: 'No alcancé a redactar el análisis completo, pero esto es exactamente lo que el sistema leyó — pregúntame sobre cualquier renglón:' },
            { tipo: 'tabla', filas },
          ]
          : [{ tipo: 'texto', texto: AVISO_SIN_RESPALDO }];
      } else {
        bloques = [{ tipo: 'texto', texto: AVISO_SIN_RESPALDO }];
      }
    }

    // Si hubo escalación, el turno costó conserje + analista: se reporta
    // COMPLETO (mismo criterio de costo atribuible que processor.ts).
    const costoPorModelo: Record<string, { tokensIn: number; tokensOut: number; cost: number }> = { ...conserje.costoPorModelo };
    if (escalado) {
      for (const [m, c] of Object.entries(res.costoPorModelo)) {
        const prev = costoPorModelo[m] ?? { tokensIn: 0, tokensOut: 0, cost: 0 };
        costoPorModelo[m] = { tokensIn: prev.tokensIn + c.tokensIn, tokensOut: prev.tokensOut + c.tokensOut, cost: prev.cost + c.cost };
      }
    }
    return {
      bloques,
      toolsUsadas: [...conserje.toolCalls.map((t) => t.toolName), ...(escalado ? res.toolCalls.map((t) => t.toolName) : [])],
      costoUsd: conserje.cost + (escalado ? res.cost : 0),
      costoPorModelo,
      tokensIn: conserje.tokensIn + (escalado ? res.tokensIn : 0),
      tokensOut: conserje.tokensOut + (escalado ? res.tokensOut : 0),
      modelo: escalado ? res.model : conserje.model,
    };
  } finally {
    clearTimeout(timer);
    CAPTURAS.delete(runId);
    ESCALAS.delete(runId);
  }
}
