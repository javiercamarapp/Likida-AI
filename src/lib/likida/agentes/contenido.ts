// ═══════════════════════════════════════════════════════════════════════════
// CONTENIDO FISCAL (0230) — el borrador del siguiente artículo de /blog.
//
// El único de los diez agentes de crecimiento que gasta modelo, y por eso el
// único con presupuesto real declarado ($1/día) y con gasto MEDIDO que el
// runner compara contra ese techo antes de cada pasada. Vive en su propio
// archivo por lo mismo que `faq.ts` se separó de `exito.ts`: arrastra el
// cliente del modelo y el índice de normas, y las otras nueve pasadas del
// runner no tienen por qué pagar ese árbol.
//
// ── QUÉ ELIGE ESCRIBIR, Y POR QUÉ NO ES UNA CORAZONADA ────────────────────
//
// El catálogo de temas CITABLES de Likida es cerrado y ya existe: los diez
// temas de `normas/consulta.ts`, cada uno con sus fichas verificadas. Los
// artículos publicados declaran cuál cubren (`Articulo.tema`). Así que «de qué
// escribir» es una RESTA, no una idea: el primer tema del catálogo que nadie
// ha cubierto todavía y que tiene fichas afirmables suficientes.
//
// SI EL TEMA NO ESTÁ EN EL CORPUS, EL AGENTE NO ESCRIBE. La pieza sale
// diciendo «esto lo escribe un humano» con el motivo. Un blog fiscal que
// improvisa cuando no sabe le cuesta a Likida la única cosa que la distingue
// de un facturador genérico, que es que lo que afirma se puede cruzar.
//
// ── LAS TRES GUARDIAS SOBRE EL TEXTO DEL MODELO ───────────────────────────
//
//  1. `revisarReglasEditoriales` (marketing/articulos.ts) — LAS MISMAS reglas
//     que CI le exige a cada artículo publicado: nada de "clientes reales",
//     nada de "hasta un X%", sin guiones largos, sin prometer la recuperación.
//     Es la vara del blog, no una vara del agente.
//  2. `cifrasRespaldadas` — ninguna cifra que no venga de las fichas
//     recuperadas en ESTA corrida.
//  3. `guardiaFundamento` — ninguna cita normativa fuera de esas fichas.
//
// Si CUALQUIERA truena, el texto del modelo se TIRA entero y la pieza sale con
// el esqueleto determinista de citas literales. Media pieza con una cita
// borrada a la mitad es peor que un esqueleto completo, y en un blog fiscal
// firmado con la marca es mucho peor.
//
// UN BORRADOR POR CORRIDA, y no un lote: siete borradores de artículo de golpe
// en la bandeja no se revisan, se ignoran. El agente propone el SIGUIENTE tema
// sin cubrir y se detiene hasta que ese borrador se resuelva — el backpressure
// más simple que existe es no fabricar encima de lo que nadie ha leído.
//
// LA PIEZA NO SE PUBLICA. Entra a `cola_aprobacion`; cuando Javier la aprueba,
// el artículo entra a `marketing/articulos.ts` por un PR, que es donde las
// pruebas editoriales lo vuelven a revisar. Publicar sigue siendo un merge.
// ═══════════════════════════════════════════════════════════════════════════
import { numero } from '@/lib/formato';
import { generateResponse } from '@/lib/llm/openrouter';
import { normasPorTema, TEMAS_NORMATIVOS, type NormaConsultada, type TemaNormativo } from '../normas/consulta';
import { guardiaFundamento } from '../normas/fundamento';
import { cifrasRespaldadas, extraerNumeros } from '@/lib/agents/analista';
import { ARTICULOS, revisarReglasEditoriales } from '../marketing/articulos';
import { type DisparoCorrida } from './corridas';
import {
  anotarCorrida, encolarPiezaCrecimiento, piezaExistente, type ResultadoCrecimiento,
} from './crecimiento';
import { logger } from '@/lib/logger';

/** Fichas afirmables mínimas para que un tema se pueda escribir. Con una sola
 *  ficha el artículo sería la paráfrasis de una norma, no una pieza: la gracia
 *  de este blog es cruzar la norma con su condición operativa. */
export const MIN_FICHAS_PARA_ESCRIBIR = 2;

export interface TemaCandidato {
  tema: TemaNormativo;
  fichas: NormaConsultada[];
  /** `false` cuando el tema existe pero el corpus no alcanza para afirmarlo. */
  escribible: boolean;
  motivo: string | null;
}

/**
 * El siguiente tema a escribir, PURO. Recorre el catálogo en su orden
 * declarado —determinista, para que dos pasadas propongan lo mismo— y devuelve
 * el primero que nadie ha cubierto. `null` cuando el blog ya cubrió los diez:
 * eso es una noticia buena, no un hueco que rellenar con un tema inventado.
 */
export function siguienteTema(
  temasCubiertos: readonly TemaNormativo[],
  fichasDe: (tema: TemaNormativo) => NormaConsultada[],
): TemaCandidato | null {
  const cubiertos = new Set(temasCubiertos);
  for (const tema of TEMAS_NORMATIVOS) {
    if (cubiertos.has(tema)) continue;
    const fichas = fichasDe(tema).filter((n) => n.afirmable);
    if (fichas.length < MIN_FICHAS_PARA_ESCRIBIR) {
      return {
        tema, fichas, escribible: false,
        motivo: fichas.length === 0
          ? `el tema «${tema}» no tiene NI UNA ficha verificada en el corpus: todo lo que hay está sin verificar, y el producto no afirma sobre eso`
          : `el tema «${tema}» solo tiene ${numero(fichas.length)} ficha(s) verificada(s), por debajo del piso declarado de ${numero(MIN_FICHAS_PARA_ESCRIBIR)}`,
      };
    }
    return { tema, fichas, escribible: true, motivo: null };
  }
  return null;
}

/** La ficha escrita como cita para una persona. PURA. Misma forma que la del
 *  FAQ (0218): el lector tiene que ver el peso de la norma, no solo su nombre. */
export function lineaDeFicha(n: NormaConsultada): string {
  const peso = n.vinculante ? 'obliga' : 'orienta, NO obliga';
  const desde = n.exigible_desde ? ` · exigible desde ${n.exigible_desde}` : '';
  return `${n.cita}${n.titulo ? ` — ${n.titulo}` : ''} (nivel ${n.jerarquia}, ${peso}${desde})`;
}

const SYSTEM_CONTENIDO = `Eres quien escribe el BORRADOR de un artículo para el blog de Likida (liquidación de viajes de flotas de carga en México). Tu lector es un contralor, un contador o el dueño de una flota, y va a cruzar lo que lee contra su propio PDF.

TU SALIDA NO SE PUBLICA. Va a una cola donde Javier la aprueba, la edita o la rechaza, y después entra al sitio por un pull request.

LA REGLA ÚNICA: solo puedes usar lo que viene en el bloque FUENTES. Si algo no está ahí, NO EXISTE para este artículo.
- PROHIBIDO citar cualquier ley, regla, artículo o fracción que no aparezca literalmente en FUENTES.
- PROHIBIDA cualquier cifra (montos, porcentajes, plazos, tasas, fechas) que no aparezca en FUENTES.
- Si las FUENTES no alcanzan para escribir la pieza, escribe exactamente: "No alcanza el corpus para escribir esto."

LAS REGLAS DE LA MARCA, QUE SON CANDADOS Y NO SUGERENCIAS:
- PROHIBIDO escribir "clientes reales" o dar a entender que alguna empresa ya firmó. Likida NO tiene clientes. La única frase permitida sobre tracción es: "en pláticas con transportistas como Grupo GAL y Transportes Innovativos".
- PROHIBIDO "hasta un X%" y cualquier techo sin fuente.
- PROHIBIDO el guion largo (—). Usa punto, coma o dos puntos.
- PROHIBIDO prometer que Likida recupera dinero o garantizar un resultado. Quien acredita es el contador; Likida entrega el dato y la bitácora.
- PROHIBIDO "solución integral", "revolucionario" y el vocabulario de startup.

FORMA: español mexicano directo, vocabulario del gremio (liquidación, cuadre, casetas, operador, contralor), frases cortas, sin emojis, sin anglicismos. Entre 400 y 700 palabras.

ESTRUCTURA EXACTA, en este orden y con estos rótulos en línea propia:
TITULO: (una línea, máximo 50 caracteres, una afirmación concreta)
RESUMEN: (una línea de 110 a 160 caracteres)
CUERPO:
(el artículo, con subtítulos en línea propia que empiecen con "## ")

Cierra el cuerpo con el puente a la calculadora pública de Likida y con la línea de que quien acredita es el contador.`;

/** Lo que las guardias dejaron pasar, o por qué no. */
export interface Guardado {
  texto: string | null;
  motivo: string | null;
}

/**
 * Las TRES guardias sobre el texto del modelo, PURAS para que la prueba diga
 * la verdad sin LLM. Cualquiera que truene tira el texto entero.
 */
export function guardarBorrador(texto: string, fichas: NormaConsultada[], contexto: string): Guardado {
  const limpio = texto.trim();
  if (!limpio) return { texto: null, motivo: 'el modelo devolvió una respuesta vacía' };
  if (limpio.includes('No alcanza el corpus para escribir esto')) {
    return { texto: null, motivo: 'el propio modelo declaró que el corpus no alcanza — se respeta' };
  }

  // 1. LAS REGLAS EDITORIALES DEL BLOG. Van primero porque son las que
  //    protegen la marca hacia afuera, y porque son las que un modelo rompe
  //    sin darse cuenta: "clientes reales" es la frase que la industria usa.
  const faltas = revisarReglasEditoriales(limpio);
  if (faltas.length > 0) {
    return { texto: null, motivo: `el borrador rompió ${numero(faltas.length)} regla(s) editorial(es): ${faltas.join(' · ')}` };
  }

  // 2. Respaldo de CIFRAS: lo que dicen las fichas y el contexto entregado.
  //    Nada más. Una tasa o un plazo que el modelo traiga de su memoria no
  //    está aquí, y en un artículo fiscal esa es la cifra que hunde la pieza.
  const respaldo = new Set<number>();
  extraerNumeros(contexto, respaldo);
  for (const n of fichas) extraerNumeros([n.cita, n.titulo, n.exigible_desde, n.jerarquia], respaldo);
  if (!cifrasRespaldadas([{ tipo: 'texto', texto: limpio }], respaldo)) {
    return { texto: null, motivo: 'el borrador traía una cifra que ninguna ficha del corpus respalda' };
  }

  // 3. Respaldo de CITAS: solo las fichas recuperadas en ESTA corrida.
  const f = guardiaFundamento(limpio, fichas.map((n) => n.norma_id));
  if (f.forzado) {
    return { texto: null, motivo: `el borrador citó normas fuera del corpus recuperado (${f.quitadas.join(', ').slice(0, 120)})` };
  }
  return { texto: f.reply, motivo: null };
}

/** El esqueleto SIN modelo: el tema, sus citas literales y qué falta escribir.
 *  Es el piso del agente, y lo que sale cuando el modelo falla o no pasa una
 *  guardia. PURO. */
export function esqueletoCitado(tema: TemaNormativo, fichas: NormaConsultada[]): string {
  return [
    `El tema «${tema}» del corpus verificado está sin cubrir en /blog y SÍ tiene fuentes citables.`,
    '',
    'Las fichas que lo sostienen, tal como están verificadas:',
    ...fichas.map((n) => `  · ${lineaDeFicha(n)}`),
    '',
    'No hay redacción del modelo en esta pieza: solo las citas. Escribir el artículo con ellas enfrente es trabajo de una persona, y el resultado entra por un PR que las pruebas editoriales vuelven a revisar.',
  ].join('\n');
}

/** La pieza de «esto lo escribe un humano». No es una derrota: es el producto
 *  del agente cuando la respuesta honesta es que no hay con qué. PURA. */
export function piezaParaHumano(tema: TemaNormativo, motivo: string): string {
  return [
    `PROPUESTA DE ARTÍCULO — tema «${tema}»`,
    '',
    'ESTO LO ESCRIBE UN HUMANO.',
    `Motivo: ${motivo}.`,
    '',
    'El agente NO redactó nada. Lo único que este blog puede afirmar sobre el SAT son las fichas VERIFICADAS del corpus de Likida; escribir sobre un tema que el corpus no sostiene sería inventarlo, y el lector de este blog cruza lo que lee contra su propio PDF.',
    'El camino para desbloquearlo no es escribir de todos modos: es que el agente `experto_fiscal` verifique las fichas del tema contra fuente primaria, o que un humano escriba la pieza citando lo que sí verificó.',
    '',
    'Nadie publicó nada desde aquí: esto es una propuesta y publicarla es el tap de Javier.',
  ].join('\n');
}

/** El cuerpo final del borrador. PURO. */
export function armarPiezaContenido(
  tema: TemaNormativo, fichas: NormaConsultada[],
  redactado: string | null, motivoSinModelo: string | null,
): string {
  const l = [
    `BORRADOR DE ARTÍCULO — tema «${tema}»`,
    '',
    `Por qué este tema: es el primero del catálogo de temas citables (normas/consulta.ts) que /blog no cubre todavía, y tiene ${numero(fichas.length)} ficha(s) verificada(s) que lo sostienen.`,
    '',
  ];
  if (redactado !== null) {
    l.push('BORRADOR (pasó las tres guardias: reglas editoriales de la casa, ninguna cifra sin ficha, ninguna cita fuera del corpus recuperado):');
    l.push('');
    l.push(redactado);
    l.push('');
    l.push('El `fundamento` que va al pie del artículo publicado:');
    l.push(...fichas.map((n) => `  · ${lineaDeFicha(n)}`));
  } else {
    l.push(`SIN REDACCIÓN DEL MODELO — ${motivoSinModelo ?? 'no se pudo redactar'}.`);
    l.push('');
    l.push(esqueletoCitado(tema, fichas));
  }
  l.push('');
  l.push('CÓMO SE PUBLICA: aprobar esta pieza NO la publica. El artículo entra a `src/lib/likida/marketing/articulos.ts` por un pull request, con su `tema`, su `fundamento` y sus bloques tipados, y ahí las pruebas editoriales de CI lo vuelven a revisar. Publicar es un merge, nunca un INSERT a producción.');
  l.push('Nadie publicó nada desde aquí: esto es una propuesta y publicarla es el tap de Javier.');
  return l.join('\n');
}

/**
 * UNA corrida de `contenido_fiscal`. Propone y redacta UN borrador. El costo
 * MEDIDO se anota en la corrida incluso si la pieza no entra — es lo que el
 * runner compara contra el techo declarado, y tirarlo dejaría al techo ciego
 * justo ante el modo de falla que más gasta.
 */
export async function correrContenidoFiscal(
  disparo: DisparoCorrida = 'cron',
  hoy: string,
): Promise<ResultadoCrecimiento> {
  const inicio = new Date();
  const agente = 'contenido_fiscal';
  let costoUsd = 0;

  try {
    const candidato = siguienteTema(ARTICULOS.map((a) => a.tema), normasPorTema);
    if (candidato === null) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ninguna', temas_cubiertos: ARTICULOS.length });
      return {
        resultado: 'corrio', piezas: 0, costoUsd: 0,
        motivo: `los ${numero(TEMAS_NORMATIVOS.length)} temas citables del corpus ya están cubiertos en /blog — el siguiente artículo necesita una ficha nueva del corpus, no otra pasada de este agente`,
      };
    }

    const titulo = `Borrador de artículo — ${candidato.tema}`;
    if (await piezaExistente(agente, titulo)) {
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: 'ya_existia', titulo });
      return {
        resultado: 'corrio', piezas: 0, costoUsd: 0,
        motivo: `el borrador del tema «${candidato.tema}» ya está en la bandeja — se resuelve ese antes de proponer el siguiente`,
      };
    }

    // El tema toca, pero el corpus no lo sostiene: la pieza honesta.
    if (!candidato.escribible) {
      const res = await encolarPiezaCrecimiento(agente, 'articulo_para_humano', titulo,
        piezaParaHumano(candidato.tema, candidato.motivo ?? 'el corpus no alcanza'), {
          tema: candidato.tema, escribible: false, motivo: candidato.motivo,
          fichas: candidato.fichas.map((n) => n.norma_id),
          consultas: ['normas/consulta (corpus verificado)', 'marketing/articulos.ts (temas cubiertos)'],
        });
      await anotarCorrida(agente, inicio, 'ok', disparo, { pieza: res, tema: candidato.tema, con_modelo: false });
      return { resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, costoUsd: 0, motivo: res === 'ya_existia' ? 'otra corrida ganó el tema' : undefined };
    }

    const contexto = [
      `TEMA: ${candidato.tema}`,
      '',
      `FUENTES (lo ÚNICO que puedes usar)\n${candidato.fichas.map((n) => `- ${lineaDeFicha(n)}`).join('\n')}`,
    ].join('\n');

    let redactado: string | null = null;
    let motivoSinModelo: string | null = null;
    try {
      // Modo PLATAFORMA (el gasto es de LIKIDA, tenant null): sin ledger
      // por-tenant. El techo lo vigila el runner contra el gasto MEDIDO del
      // día — el mismo contrato que el FAQ (0218) y la prospección (0217).
      // Rol `marketing`: prosa con voz, cifras del guion (models.ts).
      const r = await generateResponse({
        role: 'marketing', system: SYSTEM_CONTENIDO,
        messages: [{ role: 'user', content: contexto }],
        maxTokens: 1_400, temperature: 0.5,
      });
      costoUsd += r.cost;
      if (r.noMedido) logger.warn('contenido.costo_no_medido', { tema: candidato.tema });
      const g = guardarBorrador(r.text, candidato.fichas, contexto);
      redactado = g.texto;
      motivoSinModelo = g.motivo;
    } catch (e) {
      motivoSinModelo = 'el modelo no respondió';
      logger.info('contenido.modelo_fallo', { tema: candidato.tema, err: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }

    const res = await encolarPiezaCrecimiento(agente, 'borrador_articulo', titulo,
      armarPiezaContenido(candidato.tema, candidato.fichas, redactado, motivoSinModelo), {
        tema: candidato.tema, escribible: true,
        fichas: candidato.fichas.map((n) => n.norma_id),
        con_modelo: redactado !== null,
        ...(motivoSinModelo ? { sin_modelo: motivoSinModelo } : {}),
        consultas: ['normas/consulta (corpus verificado)', 'marketing/articulos.ts (temas cubiertos)'],
      });
    await anotarCorrida(agente, inicio, 'ok', disparo,
      { pieza: res, tema: candidato.tema, con_modelo: redactado !== null, dia: hoy }, { costoUsd });
    return {
      resultado: 'corrio', piezas: res === 'encolada' ? 1 : 0, costoUsd,
      motivo: res === 'ya_existia' ? 'otra corrida ganó el tema' : undefined,
    };
  } catch (e) {
    await anotarCorrida(agente, inicio, 'fallo', disparo, { dia: hoy }, {
      costoUsd,
      error: `No se pudo proponer el artículo: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}
