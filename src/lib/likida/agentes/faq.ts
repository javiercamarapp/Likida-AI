// ═══════════════════════════════════════════════════════════════════════════
// ATENCIÓN Y FAQ (0218) — el borrador de respuesta a UN ticket, citado.
//
// El único de los seis agentes de éxito del cliente que gasta modelo, y por
// eso el único con presupuesto real declarado ($1/día) y gasto MEDIDO que el
// runner compara contra ese techo antes de cada pasada.
//
// ── EL CORPUS: QUÉ PUEDE CITAR, Y POR QUÉ ES ESE Y NO OTRO ────────────────
//
// El diseño dice «solo los documentos del paquete comercial como fuente
// citada». Esos documentos viven fuera del repositorio (13-Agentes-de-AI, en
// el disco de Javier) y NO están ingeridos aquí. Sembrar su contenido de
// memoria sería exactamente lo que la casa prohíbe: inventar un hecho y
// presentarlo como fuente.
//
// Así que el corpus de este agente es el único cuerpo de fuentes CITABLE y
// VERIFICADO que el producto ya tiene: las fichas de `normas/` (índice de
// `normas/indice.ts`, temas de `normas/consulta.ts`), con su jerarquía y su
// estado de verificación. Es el corpus que responde de verdad la mayoría de
// los tickets de `facturacion` — CFDI, IVA acreditable, diésel, peajes,
// carta porte — y trae de fábrica lo que ningún documento comercial trae:
// `afirmable`, que dice si el producto PUEDE afirmar la ficha o tiene que
// callarse. Cuando los documentos comerciales se ingieran, se suman aquí.
//
// ── LAS TRES REGLAS DEL BORRADOR ──────────────────────────────────────────
//
//  1. SI EL TICKET NO MATCHEA EL CORPUS, NO HAY BORRADOR. La pieza sale
//     diciendo «esto lo contesta un humano» con el motivo. Un agente de FAQ
//     que improvisa cuando no sabe es peor que no tenerlo.
//  2. EL MODELO REDACTA, NO APORTA. Se le entrega el ticket y las fichas
//     recuperadas, y su salida pasa por DOS guardias deterministas:
//     `cifrasRespaldadas` (ninguna cifra que no venga de las fichas o del
//     propio ticket) y `guardiaFundamento` (ninguna cita legal que no sea de
//     las fichas recuperadas). Si cualquiera truena, el texto del modelo se
//     TIRA y la pieza sale con el borrador determinista de citas literales —
//     nunca con la versión que no pasó la guardia.
//  3. LA PIEZA NO ES UNA RESPUESTA: ES UN BORRADOR. Nadie le contesta al
//     cliente desde aquí. Entra a /admin/aprobaciones con el tenant del
//     ticket y un humano decide.
//
// IDEMPOTENCIA: un borrador por ticket, para siempre — título determinista
// `FAQ — ticket <id corto>` contra el índice único parcial de la 0218.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { hoyMx, numero } from '@/lib/formato';
import { generateResponse } from '@/lib/llm/openrouter';
import { normasPorTema, TEMAS_NORMATIVOS, type NormaConsultada, type TemaNormativo } from '../normas/consulta';
import { guardiaFundamento } from '../normas/fundamento';
import { cifrasRespaldadas, extraerNumeros } from '@/lib/agents/analista';
import { registrarCorrida, type DisparoCorrida } from './corridas';
import { encolarPiezaExito, piezaExistente, type ResultadoExito } from './exito';
import { logger } from '@/lib/logger';

/** Borradores que una corrida fabrica como máximo. El techo de dinero lo pone
 *  el runner (gasto medido contra `presupuesto_dia_usd`); este es el techo de
 *  TRABAJO: cinco borradores por pasada son los que un humano alcanza a
 *  revisar antes de la siguiente. */
export const TOPE_BORRADORES_FAQ = 5;

/** Palabras que llevan un ticket a un tema del corpus. Mapa EXPLÍCITO y
 *  cerrado a propósito: una búsqueda difusa por embeddings devolvería «lo más
 *  parecido» y no sabría distinguir una ley de un criterio no vinculativo —
 *  el mismo argumento que `normas/tipos.ts` ya dejó escrito para el chat.
 *
 *  Van SIN acentos y en minúsculas: `normalizar` quita los acentos del texto
 *  del ticket antes de comparar, así «diésel» y «diesel» matchean igual. */
export const PALABRAS_POR_TEMA: Record<TemaNormativo, readonly string[]> = {
  diesel_y_combustible: ['diesel', 'combustible', 'gasolina', 'ieps', 'estimulo del diesel', 'carga de combustible'],
  peajes_y_casetas: ['peaje', 'caseta', 'casetas', 'autopista', 'iave', 'televia'],
  carta_porte: ['carta porte', 'cartaporte', 'ccp', 'complemento de carta'],
  viaticos_y_efectivo: ['viatico', 'viaticos', 'efectivo', 'alimentacion', 'hospedaje', 'comprobacion de gastos'],
  cfdi_y_facturacion: ['cfdi', 'factura', 'facturacion', 'timbrado', 'timbre', 'uuid', 'folio fiscal', 'cancelacion de factura', 'efos', '69-b'],
  iva_acreditable: ['iva', 'acreditable', 'acreditamiento', 'iva acreditable'],
  nomina_imss_y_descuentos: ['nomina', 'imss', 'sbc', 'descuento al operador', 'salario'],
  privacidad_de_datos: ['privacidad', 'datos personales', 'arco', 'aviso de privacidad', 'lfpdppp'],
  contabilidad_y_multas: ['contabilidad', 'multa', 'multas', 'conservacion de la contabilidad', 'plazo de conservacion'],
  regimen_de_autotransporte: ['regimen', 'autotransporte', 'facilidades', 'rfa', 'coordinado'],
};

/** Minúsculas y sin acentos — para que «diésel» y «diesel» sean la misma
 *  palabra. Sin dependencias: el mismo criterio de `formato.ts`. */
export function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export interface Coincidencia { tema: TemaNormativo; palabras: string[] }

/**
 * El tema del corpus que mejor responde este ticket, o `null` si ninguno.
 * Gana el que más palabras distintas matchea; los empates los rompe el orden
 * declarado de `TEMAS_NORMATIVOS` — determinista, para que el mismo ticket
 * produzca siempre el mismo borrador. PURA.
 */
export function temaDelTicket(asunto: string, descripcion: string | null): Coincidencia | null {
  const texto = normalizar(`${asunto} ${descripcion ?? ''}`);
  let mejor: Coincidencia | null = null;
  for (const tema of TEMAS_NORMATIVOS) {
    const palabras = PALABRAS_POR_TEMA[tema].filter((p) => texto.includes(p));
    if (palabras.length === 0) continue;
    if (mejor === null || palabras.length > mejor.palabras.length) mejor = { tema, palabras: [...palabras] };
  }
  return mejor;
}

export interface TicketParaFaq {
  id: string;
  tenantId: string;
  asunto: string;
  descripcion: string | null;
  categoria: string;
}

/** Tickets vivos SIN una sola respuesta en el hilo — los que de verdad
 *  esperan a alguien. LANZA ante error de lectura. */
export async function leerTicketsSinRespuesta(limite: number): Promise<TicketParaFaq[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('ticket_soporte')
    .select('id, tenant_id, asunto, descripcion, categoria')
    .in('estado', ['abierto', 'en_proceso'])
    .order('abierto_en', { ascending: true })
    // Sobre-lectura ×4: varios candidatos ya tienen borrador o ya tienen
    // respuesta, y eso NO es fallo — es la guarda operando.
    .limit(limite * 4), 'faq.tickets');
  if (error) throw new Error(`leerTicketsSinRespuesta: ${error.message}`);

  const salida: TicketParaFaq[] = [];
  for (const f of (data ?? []) as Array<Record<string, unknown>>) {
    const id = String(f.id);
    const { count, error: errMsj } = await acotada(supabaseAdmin()
      .from('ticket_mensaje').select('id', { count: 'exact', head: true })
      .eq('ticket_id', id), 'faq.mensajes');
    if (errMsj) throw new Error(`leerTicketsSinRespuesta(mensajes): ${errMsj.message}`);
    if (typeof count !== 'number') throw new Error('leerTicketsSinRespuesta(mensajes): PostgREST no devolvió el conteo.');
    if (count > 0) continue;
    salida.push({
      id,
      tenantId: String(f.tenant_id),
      asunto: String(f.asunto),
      descripcion: (f.descripcion as string | null) ?? null,
      categoria: String(f.categoria),
    });
  }
  return salida;
}

/** La ficha, escrita como cita para una persona. PURA. */
export function lineaDeFicha(n: NormaConsultada): string {
  const peso = n.vinculante ? 'obliga' : 'orienta, NO obliga';
  const desde = n.exigible_desde ? ` · exigible desde ${n.exigible_desde}` : '';
  return `${n.cita}${n.titulo ? ` — ${n.titulo}` : ''} (nivel ${n.jerarquia}, ${peso}${desde})`;
}

/** El borrador SIN modelo: las citas literales del corpus. Es el piso del
 *  agente — lo que sale cuando el modelo falla o no pasa la guardia, y lo que
 *  garantiza que la pieza nunca contenga una frase que nadie verificó. PURA. */
export function borradorCitado(t: TicketParaFaq, c: Coincidencia, fichas: NormaConsultada[]): string {
  return [
    `El ticket toca el tema «${c.tema}» del corpus verificado (palabras que lo llevaron ahí: ${c.palabras.join(', ')}).`,
    '',
    'Las fuentes que lo contestan, tal como están verificadas:',
    ...fichas.map((n) => `  · ${lineaDeFicha(n)}`),
    '',
    'No hay redacción del modelo en esta pieza: solo las citas. Escribir la respuesta con ellas enfrente es trabajo de una persona.',
  ].join('\n');
}

/** La pieza de «esto no lo contesta el corpus». No es una derrota: es el
 *  producto del agente cuando la respuesta honesta es «no sé». PURA. */
export function borradorHumano(t: TicketParaFaq, motivo: string): string {
  return [
    `FAQ — ticket ${t.id.slice(0, 8)}`,
    '',
    `Asunto: ${t.asunto.slice(0, 200)}`,
    `Categoría: ${t.categoria}`,
    '',
    'ESTO LO CONTESTA UN HUMANO.',
    `Motivo: ${motivo}`,
    '',
    'El agente NO redactó nada. El corpus citable de este agente son las fichas verificadas de normas/ (fiscal y de privacidad); lo que cae fuera —precios, plazos comerciales, alcance del producto— no tiene fuente citable dentro de Likida todavía, y contestarlo de memoria sería inventarlo.',
  ].join('\n');
}

const SYSTEM_FAQ = `Eres quien prepara el BORRADOR de respuesta a un ticket de soporte de Likida (liquidación de viajes de flotas de carga en México).

TU SALIDA NO SE ENVÍA. Va a una cola donde un humano la aprueba, la edita o la rechaza.

LA REGLA ÚNICA: solo puedes usar lo que viene en el bloque FUENTES. Si algo no está ahí, NO EXISTE para esta respuesta.
- PROHIBIDO citar cualquier ley, regla, artículo o fracción que no aparezca literalmente en FUENTES.
- PROHIBIDA cualquier cifra (montos, porcentajes, plazos, tasas) que no aparezca en FUENTES o en el TICKET.
- PROHIBIDO prometer plazos, precios, descuentos o cambios en el producto.
- Si las FUENTES no alcanzan para contestar, escribe exactamente: "No alcanza el corpus para contestar esto."

FORMA: español mexicano, directo, máximo 8 líneas. Sin emojis. Sin "solución integral" ni "revolucionario". Termina ofreciendo el siguiente paso concreto (una llamada, un dato que hace falta).

Cierra SIEMPRE citando las fuentes que usaste, tal como vienen escritas en FUENTES.`;

/** Lo que las guardias dejaron pasar, o por qué no. */
export interface Guardado {
  texto: string | null;
  motivo: string | null;
}

/**
 * Las DOS guardias sobre el texto del modelo, PURAS para que la prueba diga
 * la verdad sin LLM (el molde de `cifrasRespaldadas`). Cualquiera que truene
 * TIRA el texto entero: media respuesta con una cita borrada a la mitad es
 * peor que el borrador de citas literales, que al menos está completo.
 */
export function guardarBorrador(
  texto: string, fichas: NormaConsultada[], contexto: string,
): Guardado {
  const limpio = texto.trim();
  if (!limpio) return { texto: null, motivo: 'el modelo devolvió una respuesta vacía' };
  if (limpio.includes('No alcanza el corpus para contestar esto')) {
    return { texto: null, motivo: 'el propio modelo declaró que el corpus no alcanza — se respeta' };
  }

  // Respaldo de CIFRAS: lo que dicen las fichas y lo que dice el ticket. Nada
  // más. Una tasa o un plazo que el modelo traiga de su memoria no está aquí.
  const respaldo = new Set<number>();
  extraerNumeros(contexto, respaldo);
  for (const n of fichas) extraerNumeros([n.cita, n.titulo, n.exigible_desde, n.jerarquia], respaldo);
  if (!cifrasRespaldadas([{ tipo: 'texto', texto: limpio }], respaldo)) {
    return { texto: null, motivo: 'el borrador traía una cifra que ninguna fuente respalda' };
  }

  // Respaldo de CITAS: solo las fichas recuperadas en ESTA corrida.
  const f = guardiaFundamento(limpio, fichas.map((n) => n.norma_id));
  if (f.forzado) {
    return { texto: null, motivo: `el borrador citó normas fuera del corpus recuperado (${f.quitadas.join(', ').slice(0, 120)})` };
  }
  return { texto: f.reply, motivo: null };
}

/** El cuerpo final de la pieza. PURA. */
export function armarPiezaFaq(
  t: TicketParaFaq, c: Coincidencia, fichas: NormaConsultada[],
  redactado: string | null, motivoSinModelo: string | null,
): string {
  const lineas = [
    `FAQ — ticket ${t.id.slice(0, 8)}`,
    '',
    `Asunto: ${t.asunto.slice(0, 200)}`,
    `Categoría: ${t.categoria} · tema del corpus: ${c.tema}`,
    '',
  ];
  if (redactado !== null) {
    lineas.push('BORRADOR DE RESPUESTA (pasó las dos guardias: ninguna cifra sin fuente, ninguna cita fuera del corpus recuperado):');
    lineas.push('');
    lineas.push(redactado);
    lineas.push('');
    lineas.push('Las fuentes con las que se redactó:');
    lineas.push(...fichas.map((n) => `  · ${lineaDeFicha(n)}`));
  } else {
    lineas.push(`SIN REDACCIÓN DEL MODELO — ${motivoSinModelo ?? 'no se pudo redactar'}.`);
    lineas.push('');
    lineas.push(borradorCitado(t, c, fichas));
  }
  lineas.push('');
  lineas.push('Nadie contestó este ticket desde aquí: esto es un borrador y aprobarlo es humano.');
  return lineas.join('\n');
}

/**
 * UNA corrida de atencion_faq: hasta `TOPE_BORRADORES_FAQ` tickets sin
 * respuesta y sin borrador previo. Cada ticket falla POR SU LADO — uno roto
 * no tumba el lote — y el costo MEDIDO de todos se anota en la corrida, que
 * es lo que el runner compara contra el techo declarado.
 */
export async function correrAtencionFaq(
  disparo: DisparoCorrida = 'cron',
  hoy: string = hoyMx(),
): Promise<ResultadoExito> {
  const inicio = new Date();
  const agente = 'atencion_faq';
  let costoUsd = 0;
  let piezas = 0;
  let escalados = 0;
  let saltados = 0;

  try {
    const tickets = await leerTicketsSinRespuesta(TOPE_BORRADORES_FAQ);
    if (tickets.length === 0) {
      await registrarCorrida(null, agente, {
        inicio, fin: new Date(), estado: 'ok', disparo, costoUsd: 0, resumen: { tickets: 0 },
      });
      return { resultado: 'corrio', piezas: 0, motivo: 'ningún ticket vivo sin respuesta — no hay nada que redactar', costoUsd: 0 };
    }

    for (const t of tickets) {
      if (piezas + escalados >= TOPE_BORRADORES_FAQ) break;
      const titulo = `FAQ — ticket ${t.id.slice(0, 8)}`;
      try {
        if (await piezaExistente(agente, titulo)) { saltados += 1; continue; }

        const c = temaDelTicket(t.asunto, t.descripcion);
        const fichas = c === null ? [] : normasPorTema(c.tema).filter((n) => n.afirmable);
        if (c === null || fichas.length === 0) {
          const motivo = c === null
            ? 'el ticket no matchea ningún tema del corpus citable'
            : `el tema «${c.tema}» solo tiene fichas SIN verificar — el producto no afirma sobre ellas`;
          const res = await encolarPiezaExito(agente, 'faq_escalado', titulo, borradorHumano(t, motivo), {
            ticket: t.id, tema: c?.tema ?? null, motivo,
            consultas: ['ticket_soporte', 'normas/consulta (corpus verificado)'],
          }, t.tenantId);
          if (res === 'encolada') escalados += 1; else saltados += 1;
          continue;
        }

        const contexto = [
          `TICKET\nAsunto: ${t.asunto}\nCategoría: ${t.categoria}\nDescripción: ${t.descripcion ?? '(el cliente no escribió descripción)'}`,
          '',
          `FUENTES (lo ÚNICO que puedes usar)\n${fichas.map((n) => `- ${lineaDeFicha(n)}`).join('\n')}`,
        ].join('\n');

        let redactado: string | null = null;
        let motivoSinModelo: string | null = null;
        try {
          // Modo PLATAFORMA (el gasto es de LIKIDA, tenant null): sin ledger
          // por-tenant. El techo lo vigila el runner contra el gasto MEDIDO
          // del día — el mismo contrato que investigador/SDR/enviador (0217).
          const r = await generateResponse({
            role: 'back_office', system: SYSTEM_FAQ,
            messages: [{ role: 'user', content: contexto }],
            maxTokens: 600, temperature: 0.3,
          });
          costoUsd += r.cost;
          if (r.noMedido) logger.warn('faq.costo_no_medido', { ticket: t.id });
          const g = guardarBorrador(r.text, fichas, contexto);
          redactado = g.texto;
          motivoSinModelo = g.motivo;
        } catch (e) {
          motivoSinModelo = 'el modelo no respondió';
          logger.info('faq.modelo_fallo', { ticket: t.id, err: e instanceof Error ? e.message.slice(0, 160) : String(e) });
        }

        const res = await encolarPiezaExito(agente, 'faq_borrador', titulo,
          armarPiezaFaq(t, c, fichas, redactado, motivoSinModelo), {
            ticket: t.id, tema: c.tema, fichas: fichas.map((n) => n.norma_id),
            con_modelo: redactado !== null,
            ...(motivoSinModelo ? { sin_modelo: motivoSinModelo } : {}),
            consultas: ['ticket_soporte', 'normas/consulta (corpus verificado)'],
          }, t.tenantId);
        if (res === 'encolada') piezas += 1; else saltados += 1;
      } catch (e) {
        // Un ticket atorado no puede parar el lote entero.
        saltados += 1;
        logger.info('faq.ticket_saltado', { ticket: t.id, motivo: e instanceof Error ? e.message.slice(0, 160) : String(e) });
      }
    }

    await registrarCorrida(null, agente, {
      inicio, fin: new Date(), estado: 'ok', disparo, costoUsd,
      tareasHechas: piezas + escalados, tareasTotal: tickets.length,
      resumen: { borradores: piezas, escalados, saltados, dia: hoy },
    });
    return {
      resultado: 'corrio',
      piezas: piezas + escalados,
      motivo: piezas + escalados === 0 ? `${numero(saltados)} tickets ya tenían borrador` : undefined,
      costoUsd,
    };
  } catch (e) {
    // El modelo pudo haber gastado antes del fallo: el costo se anota aunque
    // no entrara ninguna pieza — tirarlo dejaría al techo diario ciego al
    // modo de falla que más gasta.
    await registrarCorrida(null, agente, {
      inicio, fin: new Date(), estado: 'fallo', disparo, costoUsd,
      error: `No se pudo correr Atención y FAQ: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500),
    });
    throw e;
  }
}
