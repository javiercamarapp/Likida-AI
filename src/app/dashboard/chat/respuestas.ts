import type { DashboardKpis, Acreditables } from '@/lib/likida/analytics';
import { mxn, litros, numero } from '@/lib/formato';

// Lógica PURA del chat «Pregunta a tus datos» (L5: separada de la interfaz sin cambiar una coma de lo que responde). Aquí viven el
// respondedor local de reserva, el catálogo de Consulta, la traducción de los bloques del analista y los rótulos de la traza.

// ── Respuestas con forma (12-ago-2026: "que responda con gráficas, tablas
// y muy visual") — cada respuesta puede traer, además del texto, una pieza
// visual armada con los MISMOS datos ya calculados: una tabla chica, la
// dona de `admin/charts` o una cifra grande. Nada se grafica sin dato real:
// con la flota en cero, la respuesta es el texto honesto de siempre.

export type Visual =
  | { tipo: 'tabla'; filas: Array<[string, string]> }
  | { tipo: 'dona'; segmentos: Array<{ etiqueta: string; valor: number }> }
  | { tipo: 'cifra'; valor: string; nota?: string }
  | { tipo: 'serie'; puntos: Array<{ dia: string; valor: number }>; formato: 'mxn' | 'numero' };

/** Un paso REAL del agente (tool) con lo que midió este navegador: el tiempo entre su `inicio` y su `fin`. Nunca texto del modelo. */
export interface PasoTraza { tool: string; listo: boolean; ms?: number }

/** De dónde salió la respuesta: el analista (lee tu operación) o el respondedor de reserva (lo que ya estaba cargado en la página). */
export type OrigenRespuesta = 'analista' | 'reserva';

export interface Respuesta {
  texto: string; visual?: Visual; visuales?: Visual[]; pendiente?: boolean;
  /** Metadatos del turno (solo respuestas de esta sesión; una conversación reabierta no los trae). */
  origen?: OrigenRespuesta; hora?: string; pasos?: PasoTraza[]; ms?: number;
  /** El turno falló (red, tiempo, analista): la respuesta ofrece Reintentar. Solo se pone al fallar de verdad. */
  fallo?: boolean;
  /** El usuario detuvo la generación. */
  cancelada?: boolean;
}

/** Cómo se lee cada tool del analista en la secuencia de pensamiento
 *  (13-ago: pasos narrados en vivo). Pasos REALES
 *  del ciclo — el servidor los transmite cuando de verdad ocurren. */
export const ETIQUETA_TOOL: Record<string, string> = {
  kpis_flota: 'Leyendo los KPIs de la flota',
  acreditables_periodo: 'Sumando IVA y peaje del periodo',
  motor_fiscal: 'Consultando el motor fiscal',
  viajes_flota: 'Leyendo tus viajes',
  liquidaciones_flota: 'Leyendo tus liquidaciones',
  serie_gasto: 'Trazando el gasto por semana',
  serie_liquidado: 'Trazando lo liquidado por semana',
  top_rutas: 'Rankeando tus rutas por gasto',
  duplicados_detectados: 'Buscando tickets duplicados',
  proyectar_serie: 'Proyectando la serie',
  consultar_carta_porte: 'Revisando la Carta Porte',
  tablero_viajes: 'Leyendo el tablero de viajes en vivo',
  detalle_viaje: 'Revisando el viaje',
  estado_vigia: 'Consultando al Vigía',
  estado_buzon: 'Revisando el buzón de facturas',
  estado_cobranza: 'Revisando la cobranza',
  estado_autofactura: 'Revisando la autofactura',
  salud_agentes: 'Revisando la salud de los agentes',
  convenio_viaje: 'Revisando el convenio del viaje',
  estado_liquidacion_externa: 'Revisando la entrega de liquidaciones',
  reclamacion_peajes: 'Revisando los cobros de peajes',
  estado_jornada: 'Revisando el registro de jornada',
  escalar_a_persona: 'Dejando la tarea para la persona que decide',
  entregar_respuesta: 'Armando la respuesta',
};
export const rotuloTool = (t: string) => ETIQUETA_TOOL[t] ?? t.replaceAll('_', ' ');

/** Las fases del "pensando" (pedido del 12-ago: como Claude). Son honestas
 *  por construcción: solo se AVANZA de fase si de verdad sigue trabajando —
 *  un saludo se resuelve en la primera y nunca dice "leyendo tu operación". */
export const FASES_PENSANDO: Array<[number, string]> = [
  [0, 'Pensando…'],
  [3000, 'Leyendo tu operación…'],
  [9000, 'Cruzando cifras…'],
  [17000, 'Armando la respuesta…'],
  [30000, 'Esto está tardando más de lo normal…'],
];

/** Los bloques del agente analista (/api/dashboard/chat) → la Respuesta que
 *  esta interfaz ya sabe pintar. El agente manda números crudos; aquí se
 *  formatean con lib/formato — UNA sola fuente de formato, como siempre. */
export function respuestaDeBloques(bloques: Array<Record<string, unknown>>): Respuesta {
  const textos: string[] = [];
  const visuales: Visual[] = [];
  for (const b of bloques) {
    if (b.tipo === 'texto' && typeof b.texto === 'string') textos.push(b.texto);
    else if (b.tipo === 'cifra' && typeof b.valor === 'number') {
      const f = b.formato === 'mxn' ? mxn : b.formato === 'litros' ? litros : numero;
      visuales.push({ tipo: 'cifra', valor: f(b.valor), nota: typeof b.nota === 'string' ? b.nota : undefined });
    } else if (b.tipo === 'tabla' && Array.isArray(b.filas)) {
      visuales.push({ tipo: 'tabla', filas: (b.filas as Array<[string, string | number]>).map(([k, v]) => [k, typeof v === 'number' ? numero(v) : v]) });
    } else if (b.tipo === 'dona' && Array.isArray(b.segmentos)) {
      visuales.push({ tipo: 'dona', segmentos: b.segmentos as Array<{ etiqueta: string; valor: number }> });
    } else if (b.tipo === 'serie' && Array.isArray(b.puntos)) {
      visuales.push({ tipo: 'serie', puntos: b.puntos as Array<{ dia: string; valor: number }>, formato: b.formato === 'mxn' ? 'mxn' : 'numero' });
    }
  }
  return { texto: textos.join(' ') || 'Listo.', visuales: visuales.length > 0 ? visuales : undefined };
}

/** El catálogo de Consulta, por CATEGORÍA y formal (pedido del 12-ago:
 *  al ancho de la caja y con muchas más opciones). SIEMPRE completo: las
 *  respuestas ya degradan con honestidad cuando falta el dato ("todavía
 *  no hay..."), así que esconder categorías solo empobrecía el menú.
 *  Cada frase conserva una palabra clave que `responder` entiende —
 *  verificadas contra sus ramas una por una
 *  en `chat_respondedor_catalogo.test.ts` (A37-S16-09). */
export const CATALOGO_CONSULTA: Array<{ categoria: string; preguntas: string[] }> = [
  {
    categoria: 'Cuadre y liquidaciones',
    preguntas: [
      'Muéstrame el desglose de lo comprobado a la fecha',
      'Estado de las liquidaciones con diferencia o por revisar',
      '¿Cuántos viajes están por revisar?',
      'Monto observado por el motor en las liquidaciones',
    ],
  },
  {
    categoria: 'Salud del cuadre',
    preguntas: [
      'Tasa de cuadre del periodo',
      '¿Cuántas liquidaciones cerraron sin diferencias?',
      '¿Cuánto llevo comprobado?',
    ],
  },
  {
    categoria: 'Fiscal y acreditables',
    preguntas: [
      'Desglose de acreditables del periodo',
      'IVA acreditable del periodo',
      'Peaje acreditable del periodo',
      'Litros de diésel elegibles para el estímulo',
    ],
  },
];

export function responder(pregunta: string, kpis: DashboardKpis | null, acred: Acreditables | null): Respuesta {
  const q = pregunta.toLowerCase();
  const sinLiq = { texto: 'Todavía no hay liquidaciones para calcular esto.' };
  // A37-S16-09: «observado» es el monto que el motor detectó fuera de regla o duplicado, NO lo comprobado (antes caía en la rama «monto»).
  if (q.includes('observad')) {
    if (!kpis) return sinLiq;
    return {
      texto: `El motor observa ${mxn(kpis.diferenciaDetectada)} fuera de regla o duplicados en ${kpis.viajesLiquidados} viaje${kpis.viajesLiquidados === 1 ? '' : 's'} liquidado${kpis.viajesLiquidados === 1 ? '' : 's'}.`,
      visual: {
        tipo: 'tabla',
        filas: [
          ['Fuera de regla o duplicado', mxn(kpis.diferenciaDetectada)],
          ['Con diferencias', numero(kpis.conDiferencias)],
          ['Por revisar', numero(kpis.porRevisar)],
        ],
      },
    };
  }
  // «cerraron sin diferencias» pregunta por las LIMPIAS, no por las que sí tienen diferencia.
  if (q.includes('sin diferencia')) {
    if (!kpis) return sinLiq;
    const limpias = Math.max(0, kpis.viajesLiquidados - kpis.conDiferencias - kpis.porRevisar);
    return { texto: `${limpias} de ${kpis.viajesLiquidados} liquidaciones cerraron sin diferencias.` };
  }
  if (q.includes('comprobad') || /\bmonto/.test(q)) {
    if (!kpis) return sinLiq;
    return {
      texto: `Llevas ${mxn(kpis.montoComprobado)} comprobados en ${kpis.viajesLiquidados} viaje${kpis.viajesLiquidados === 1 ? '' : 's'}.`,
      visual: {
        tipo: 'tabla',
        filas: [
          ['Monto comprobado', mxn(kpis.montoComprobado)],
          ['Viajes liquidados', numero(kpis.viajesLiquidados)],
          ['Con diferencias', numero(kpis.conDiferencias)],
          ['Por revisar', numero(kpis.porRevisar)],
          ['Fuera de regla o duplicado', mxn(kpis.diferenciaDetectada)],
        ],
      },
    };
  }
  if (q.includes('diferencia') || q.includes('revisar')) {
    if (!kpis) return sinLiq;
    const limpias = Math.max(0, kpis.viajesLiquidados - kpis.conDiferencias - kpis.porRevisar);
    return {
      texto: `${kpis.conDiferencias + kpis.porRevisar} liquidaciones tienen diferencia o están por revisar, de ${kpis.viajesLiquidados} en total.`,
      visual: kpis.viajesLiquidados > 0
        ? { tipo: 'dona', segmentos: [
            { etiqueta: 'Sin diferencias', valor: limpias },
            { etiqueta: 'Con diferencias', valor: kpis.conDiferencias },
            { etiqueta: 'Por revisar', valor: kpis.porRevisar },
          ] }
        : undefined,
    };
  }
  if (q.includes('diesel') || q.includes('diésel') || q.includes('litro')) {
    if (!acred) return { texto: 'Todavía no hay datos de diésel este periodo.' };
    return {
      texto: `${litros(acred.litrosDiesel)} elegibles para el estímulo este periodo.`,
      visual: { tipo: 'cifra', valor: litros(acred.litrosDiesel), nota: 'LIF 2026, Art. 20-A — el estímulo en pesos lo fija la cuota DOF de cada semana.' },
    };
  }
  if (q.includes('tasa') || q.includes('cuadre') || q.includes('cuadra')) {
    if (!kpis) return sinLiq;
    const limpias = Math.max(0, kpis.viajesLiquidados - kpis.conDiferencias - kpis.porRevisar);
    return {
      texto: `Tu tasa de cuadre es ${kpis.tasaCuadre}% — liquidaciones sin diferencias sobre el total.`,
      visual: kpis.viajesLiquidados > 0
        ? { tipo: 'dona', segmentos: [
            { etiqueta: 'Sin diferencias', valor: limpias },
            { etiqueta: 'Con diferencias o por revisar', valor: kpis.conDiferencias + kpis.porRevisar },
          ] }
        : undefined,
    };
  }
  if (/\biva\b/.test(q) || q.includes('peaje') || q.includes('caseta') || q.includes('acreditable')) {
    if (!acred) return { texto: 'Todavía no hay datos de acreditables este periodo.' };
    return {
      texto: /\biva\b/.test(q)
        ? `${mxn(acred.iva)} de IVA acreditable este periodo (LIVA, Art. 5).`
        : q.includes('peaje') || q.includes('caseta')
          ? `${mxn(acred.peaje)} de peaje acreditable (50%) este periodo — sujeto a elegibilidad.`
          : 'Esto es lo que llevas de acreditables este periodo:',
      visual: {
        tipo: 'tabla',
        filas: [
          ['IVA acreditable', mxn(acred.iva)],
          ['Peaje acreditable (50%)', mxn(acred.peaje)],
          ['Diésel elegible', litros(acred.litrosDiesel)],
        ],
      },
    };
  }
  return { texto: 'Todavía no sé responder eso — pregúntame sobre lo comprobado, diferencias, diésel, IVA, peaje o tu tasa de cuadre.' };
}

/**
 * H4 (auditoría 24): el respondedor local de palabras clave es el
 * "paracaídas" de `responder()` — corre con lo que YA está en la página
 * (`kpis`/`acred`), no con una lectura fresca de la operación. Cuando el
 * analista de verdad falló (el servidor lo dice con `{t:'error'}`, o el
 * `fetch` reventó), esa diferencia importa: el contralor tiene que saber que
 * está viendo una respuesta de reserva, no la del agente que acaba de leer su
 * flota. `motivo` es `null` cuando no hubo fallo (el paracaídas de un `q` que
 * el respondedor local tampoco entiende no necesita este aviso).
 */
export function respuestaLocal(
  pregunta: string, kpis: DashboardKpis | null, acred: Acreditables | null, motivo: string | null,
): Respuesta {
  const base = responder(pregunta, kpis, acred);
  if (!motivo) return base;
  const aviso = motivo.charAt(0).toUpperCase() + motivo.slice(1);
  return {
    ...base,
    texto: `${aviso.endsWith('.') ? aviso : `${aviso}.`} Esto es lo que puedo contestarte con lo último que ya tenía cargado, no una lectura nueva de tu operación:\n\n${base.texto}`,
  };
}
