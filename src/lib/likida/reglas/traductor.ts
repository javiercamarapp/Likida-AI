// ═══════════════════════════════════════════════════════════════════════════
// EL TRADUCTOR — la ÚNICA vez que un modelo toca una regla.
//
// El dueño escribe "avísame si un gasto de caseta pasa de $3,000" y aquí el
// modelo hace UN trabajo, una sola vez en la vida de esa regla: elegir una
// plantilla del catálogo cerrado y sacar sus parámetros. Después de esto el
// modelo no vuelve a aparecer — lo que queda guardado es la ESTRUCTURA
// (plantilla + params), y quien vigila es SQL.
//
// LO QUE ESTE ARCHIVO NO PUEDE HACER, y está construido para no poder:
//
//  · Inventar una vigilancia. `plantilla` es un `z.enum` del catálogo más el
//    literal 'ninguna'. Un modelo que quiera prometer algo fuera de la lista
//    no tiene dónde escribirlo: el JSON schema lo rechaza antes de llegar a
//    este código.
//  · Redactar una cifra. Los parámetros pasan por `validarParams` (dominios
//    y rangos del catálogo) y la frase que verá la persona la arma
//    `fraseDe()` — código, no prosa del modelo. El modelo EXTRAE el 3,000
//    que la persona escribió; no lo elige.
//  · Activar nada. Devuelve una interpretación; la regla nace 'pendiente' y
//    solo la confirmación humana la activa (`regla_activa_confirmada`, 0229).
//  · Gastar sin techo ni dueño. Presupuesto declarado y cobrado al tenant,
//    patrón `createLlmBudget` del OCR. Sin tenant no hay llamada.
//
// ERRORES POR VALOR: nada de aquí lanza. El proveedor caído, el modelo
// confundido y la frase que no calza son tres resultados distintos, y los
// tres se le pueden decir a una persona.
// ═══════════════════════════════════════════════════════════════════════════
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { generateStructured } from '@/lib/llm/openrouter';
import { createLlmBudget, LlmBudgetExceededError } from '@/lib/llm/budget';
import { logger } from '@/lib/logger';
import {
  CATALOGO, PLANTILLAS_ID, DOCUMENTOS_VIGILABLES, CONCEPTOS_VIGILABLES,
  plantillasPara, loQueSiSeVigila, validarParams, fraseDe, esPlantilla,
  type PlantillaId, type ParamsCualquiera,
} from './catalogo';
import type { ConceptoGasto } from '@/types/likida';

/** Cuánto texto se le acepta a una regla. Una frase, no un ensayo: más de
 *  esto no es una regla, es una conversación — y el traductor no conversa. */
export const MAX_TEXTO = 400;

/** Techo de la traducción. Es una llamada de decenas de tokens de salida; el
 *  techo existe para que un prompt inyectado no pueda pedir un libro. */
export const MAX_TOKENS_TRADUCCION = 300;

export type Interpretacion =
  | {
    ok: true;
    plantilla: PlantillaId;
    params: ParamsCualquiera;
    /** La frase en español que la persona tiene que confirmar. La arma el
     *  catálogo, no el modelo. */
    frase: string;
    /** Qué modelo tradujo. `null` = nadie: la persona la eligió a mano. */
    modelo: string | null;
    costoUsd: number;
  }
  | {
    ok: false;
    /** Qué decirle a la persona, ya en su idioma. */
    motivo: string;
    /** Lo que SÍ se sabe vigilar — la mitad honesta de la negativa. */
    puedoVigilar: string[];
    modelo: string | null;
    costoUsd: number;
  };

/**
 * La salida del modelo. Plana y con dominios cerrados a propósito: un
 * `record` libre de parámetros le habría dado al modelo un lugar donde
 * inventar llaves, y `additionalProperties:false` (que OpenRouter exige) no
 * lo hubiera atrapado porque el objeto sería legítimamente abierto.
 *
 * Todos los parámetros son opcionales-nulos porque cada plantilla usa dos o
 * tres: el que no aplica se manda en null, y el ensamblado de abajo solo lee
 * los campos que la plantilla elegida declara.
 */
const Salida = z.object({
  plantilla: z.enum([...PLANTILLAS_ID, 'ninguna'] as [string, ...string[]]),
  documento: z.enum([...DOCUMENTOS_VIGILABLES] as [string, ...string[]]).nullable(),
  concepto: z.enum([...CONCEPTOS_VIGILABLES] as [string, ...string[]]).nullable(),
  monto: z.number().nullable(),
  dias: z.number().nullable(),
  horas: z.number().nullable(),
  n: z.number().nullable(),
  usd: z.number().nullable(),
});

type SalidaModelo = z.infer<typeof Salida>;

/** El catálogo, dicho como se lo damos al modelo. Se genera de `CATALOGO`
 *  para que una plantilla nueva entre al prompt sola: un prompt copiado a
 *  mano se desactualiza y el modelo empieza a ofrecer lo que ya no existe (o
 *  a no ofrecer lo que sí). */
export function catalogoParaPrompt(rol: string): string {
  return plantillasPara(rol).map((p) => {
    const params = p.campos.map((c) => {
      const dominio = c.opciones ? ` (uno de: ${c.opciones.map((o) => o.valor).join(', ')})` : ` (número${c.sufijo ? ` en ${c.sufijo}` : ''})`;
      return `${c.nombre}${dominio}`;
    }).join('; ');
    return [
      `· ${p.id}`,
      `  qué vigila: ${p.queVigila}`,
      `  parámetros: ${params || 'ninguno'}`,
      `  ejemplos: ${p.ejemplos.map((e) => `"${e}"`).join(' | ')}`,
    ].join('\n');
  }).join('\n');
}

function system(rol: string): string {
  return `Eres el traductor de reglas de Likida.ai (liquidación de viajes de flotas de carga en México). Tu ÚNICO trabajo es mapear una frase en español mexicano a UNA vigilancia del catálogo cerrado de abajo, y extraer sus parámetros.

REGLAS QUE NO SE ROMPEN:
- El catálogo es CERRADO. Si la frase no calza con ninguna de las vigilancias listadas, contestas plantilla="ninguna". Jamás elijas la más parecida "por ayudar": prometer una vigilancia que el sistema no sabe correr es peor que decir que no se puede.
- No inventes cifras. Los números salen de la frase de la persona: si dice "3,000" el parámetro es 3000; si dice "dos meses" son 60 días; si no dice ningún número y la vigilancia lo necesita, contestas plantilla="ninguna".
- Los pesos mexicanos van en pesos enteros o con decimales, sin separadores de miles y sin símbolo. "15 mil" es 15000. "$3,000" es 3000.
- Los parámetros que la vigilancia elegida NO usa van en null.
- No redactas mensajes, no opinas, no saludas. Solo eliges y extraes.

CATÁLOGO (lo único que el sistema sabe vigilar hoy):
${catalogoParaPrompt(rol)}`;
}

/** Ensambla los parámetros de la plantilla elegida leyendo SOLO los campos
 *  que esa plantilla declara. Un campo que el modelo llenó de más se ignora
 *  —no se guarda basura— y uno que falta se rechaza. */
function armarParams(plantilla: PlantillaId, s: SalidaModelo): Record<string, unknown> | null {
  const fuente: Record<string, unknown> = {
    documento: s.documento, concepto: s.concepto, monto: s.monto,
    dias: s.dias, horas: s.horas, n: s.n, usd: s.usd,
  };
  const out: Record<string, unknown> = {};
  for (const campo of CATALOGO[plantilla].campos) {
    const v = fuente[campo.nombre];
    if (v === null || v === undefined) return null;
    out[campo.nombre] = v;
  }
  return out;
}

export interface OpcionesTraduccion {
  /** El tenant que PAGA la traducción. Sin él no hay llamada. */
  tenantId: string;
  /** Rol de quien declara: filtra las plantillas de plataforma. */
  rol: string;
  /** Techo del día para este tenant, si el llamador quiere uno más apretado. */
  maxTenantDailyUsd?: number;
  signal?: AbortSignal;
}

/**
 * Traduce UNA frase. Se llama exactamente una vez por regla creada.
 */
export async function interpretar(texto: string, opciones: OpcionesTraduccion): Promise<Interpretacion> {
  const rol = opciones.rol;
  const puedoVigilar = loQueSiSeVigila(rol);
  const limpio = texto.trim();

  if (limpio.length < 8) {
    return { ok: false, motivo: 'Escribe la regla completa: qué quieres que vigile y a partir de qué número.', puedoVigilar, modelo: null, costoUsd: 0 };
  }
  if (limpio.length > MAX_TEXTO) {
    return { ok: false, motivo: `Una regla cabe en ${MAX_TEXTO} caracteres. Si son dos cosas distintas, decláralas como dos reglas.`, puedoVigilar, modelo: null, costoUsd: 0 };
  }

  let budget;
  try {
    budget = createLlmBudget(opciones.tenantId, randomUUID(),
      opciones.maxTenantDailyUsd ? { maxTenantDailyUsd: opciones.maxTenantDailyUsd } : {});
  } catch (e) {
    // Sin tenant de presupuesto no se llama al proveedor. Fail-closed: el
    // gasto de IA SIEMPRE tiene dueño en este producto.
    logger.warn('reglas.traductor.sin_presupuesto', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, motivo: 'No se pudo cargar el costo de la interpretación a tu flota, así que no se llamó al modelo.', puedoVigilar, modelo: null, costoUsd: 0 };
  }

  let r;
  try {
    r = await generateStructured({
      // Rol `extraccion` (models.ts): parseo determinista, temperatura 0. Era
      // uno de los roles RESERVADOS —decidido y sin llamador— y esta es
      // exactamente la clase de trabajo para la que se declaró.
      role: 'extraccion',
      system: system(rol),
      messages: [{ role: 'user', content: `Regla que escribió el dueño de la flota:\n"""${limpio}"""` }],
      schema: Salida,
      schemaName: 'regla_vigilancia',
      maxTokens: MAX_TOKENS_TRADUCCION,
      temperature: 0,
      signal: opciones.signal ?? AbortSignal.timeout(25_000),
      budget,
    });
  } catch (e) {
    if (e instanceof LlmBudgetExceededError) {
      return { ok: false, motivo: 'Tu flota alcanzó el techo de gasto de IA del día. Vuelve a intentarlo mañana o declara la regla eligiendo la vigilancia a mano.', puedoVigilar, modelo: null, costoUsd: 0 };
    }
    logger.warn('reglas.traductor.fallo', { err: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    return { ok: false, motivo: 'El intérprete no contestó. Puedes elegir la vigilancia a mano de la lista de abajo.', puedoVigilar, modelo: null, costoUsd: 0 };
  }

  const costoUsd = r.cost;
  const salida = r.data;

  if (salida.plantilla === 'ninguna' || !esPlantilla(salida.plantilla)) {
    return {
      ok: false,
      motivo: 'No puedo vigilar eso todavía — no con los datos que Likida tiene hoy.',
      puedoVigilar, modelo: r.model, costoUsd,
    };
  }
  // El rol vuelve a filtrar DESPUÉS del modelo: el prompt ya no ofrecía las
  // plantillas de plataforma, pero un modelo que las recuerde de otro lado no
  // puede colar una vigilancia que a esta persona no le toca.
  if (!plantillasPara(rol).some((p) => p.id === salida.plantilla)) {
    logger.warn('reglas.traductor.plantilla_fuera_de_rol', { plantilla: salida.plantilla, rol });
    return {
      ok: false,
      motivo: 'No puedo vigilar eso todavía — no con los datos que Likida tiene hoy.',
      puedoVigilar, modelo: r.model, costoUsd,
    };
  }

  const crudo = armarParams(salida.plantilla, salida);
  if (!crudo) {
    return {
      ok: false,
      motivo: 'Entendí qué quieres vigilar, pero no de cuánto: dime el número (el monto, los días o las horas) y lo declaro.',
      puedoVigilar, modelo: r.model, costoUsd,
    };
  }

  const validacion = validarParams(salida.plantilla, crudo);
  if (!validacion.ok) {
    return { ok: false, motivo: validacion.error, puedoVigilar, modelo: r.model, costoUsd };
  }

  return {
    ok: true,
    plantilla: salida.plantilla,
    params: validacion.params,
    // La frase la arma el catálogo. Si la escribiera el modelo, la persona
    // estaría confirmando prosa y no la regla que se va a guardar.
    frase: fraseDe(salida.plantilla, validacion.params),
    modelo: r.model,
    costoUsd,
  };
}

/**
 * El camino SIN modelo: la persona eligió la vigilancia de la lista y tecleó
 * sus parámetros. Existe para que el producto no dependa del proveedor —y
 * para que una flota que agotó su techo de IA siga pudiendo declarar reglas.
 */
export function interpretarAMano(
  plantilla: string, crudo: unknown, rol: string,
): Interpretacion {
  const puedoVigilar = loQueSiSeVigila(rol);
  if (!esPlantilla(plantilla) || !plantillasPara(rol).some((p) => p.id === plantilla)) {
    return { ok: false, motivo: 'Esa vigilancia no existe en el catálogo.', puedoVigilar, modelo: null, costoUsd: 0 };
  }
  const validacion = validarParams(plantilla, crudo);
  if (!validacion.ok) return { ok: false, motivo: validacion.error, puedoVigilar, modelo: null, costoUsd: 0 };
  return {
    ok: true, plantilla, params: validacion.params,
    frase: fraseDe(plantilla, validacion.params), modelo: null, costoUsd: 0,
  };
}

/** Reexport de conveniencia para las pantallas: el tipo del concepto vive en
 *  el dominio, no en el catálogo. */
export type { ConceptoGasto };
