import type { DashboardKpis, Acreditables } from '@/lib/likida/analytics';
import { mxn, litros, numero } from '@/lib/formato';
import { ETIQUETA_TOOL_ADMIN, etiquetaToolAdmin } from './etiquetas-copiloto';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

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
export type OrigenRespuesta = 'analista' | 'reserva' | 'copiloto';

/** La previsualización de una acción gateada del copiloto de superadmin (solo `modo='superadmin'`). */
export interface AccionPropuesta {
  accion: string;
  gateo: 'confirma' | 'doble';
  implementada: boolean;
  objetivo: string;
  efecto: string;
  revertir: string;
  motivoSugerido: string | null;
  /** La llave de ejecución que el SERVIDOR creó al proponer. Sin ella no hay botón. */
  intentId?: string;
}
/** La pantalla fuente de una cifra: derivada de qué tools corrieron, nunca de lo que diga el modelo. */
export interface FuenteRespuesta { ruta: string; etiqueta: string }

export interface Respuesta {
  texto: string; visual?: Visual; visuales?: Visual[]; pendiente?: boolean;
  /** Metadatos del turno (solo respuestas de esta sesión; una conversación reabierta no los trae). */
  origen?: OrigenRespuesta; hora?: string; pasos?: PasoTraza[]; ms?: number;
  /** El turno falló (red, tiempo, analista): la respuesta ofrece Reintentar. Solo se pone al fallar de verdad. */
  fallo?: boolean;
  /** El usuario detuvo la generación. */
  cancelada?: boolean;
  /** Solo superadmin: la acción propuesta, las pantallas fuente, y si el turno viene archivado del historial (sin botón de ejecutar). */
  accion?: AccionPropuesta; fuentes?: FuenteRespuesta[]; archivada?: boolean;
}

/** Cómo se lee cada tool del analista en la secuencia de pensamiento
 *  (13-ago: pasos narrados en vivo). Pasos REALES
 *  del ciclo — el servidor los transmite cuando de verdad ocurren. */
export const etiquetaTool = (t: TResto = T_RESTO_ES): Record<string, string> => ({
  kpis_flota: t('ch.leyendo_los_kpis_de_la_flota'),
  acreditables_periodo: t('ch.sumando_iva_y_peaje_del_periodo'),
  motor_fiscal: t('ch.consultando_el_motor_fiscal'),
  viajes_flota: t('ch.leyendo_tus_viajes'),
  liquidaciones_flota: t('ch.leyendo_tus_liquidaciones'),
  serie_gasto: t('ch.trazando_el_gasto_por_semana'),
  serie_liquidado: t('ch.trazando_lo_liquidado_por_semana'),
  top_rutas: t('ch.rankeando_tus_rutas_por_gasto'),
  duplicados_detectados: t('ch.buscando_tickets_duplicados'),
  proyectar_serie: t('ch.proyectando_la_serie'),
  consultar_carta_porte: t('ch.revisando_la_carta_porte'),
  tablero_viajes: t('ch.leyendo_el_tablero_de_viajes_en'),
  detalle_viaje: t('ch.revisando_el_viaje'),
  estado_vigia: t('ch.consultando_al_vigia'),
  estado_buzon: t('ch.revisando_el_buzon_de_facturas'),
  estado_cobranza: t('ch.revisando_la_cobranza'),
  estado_autofactura: t('ch.revisando_la_autofactura'),
  salud_agentes: t('ch.revisando_la_salud_de_los_agentes'),
  convenio_viaje: t('ch.revisando_el_convenio_del_viaje'),
  estado_liquidacion_externa: t('ch.revisando_la_entrega_de_liquidaciones'),
  reclamacion_peajes: t('ch.revisando_los_cobros_de_peajes'),
  estado_jornada: t('ch.revisando_el_registro_de_jornada'),
  escalar_a_persona: t('ch.dejando_la_tarea_para_la_persona'),
  entregar_respuesta: t('op.armando_la_respuesta'),
});
export const ETIQUETA_TOOL = etiquetaTool();
/** Los nombres de tool de los dos agentes son disjuntos, así que un solo buscador sirve a ambos modos sin inventar rótulos. */
export const rotuloTool = (nombre: string, t: TResto = T_RESTO_ES) => etiquetaTool(t)[nombre] ?? etiquetaToolAdmin(t)[nombre] ?? nombre.replaceAll('_', ' ');

/** Las fases del "pensando" (pedido del 12-ago: como Claude). Son honestas
 *  por construcción: solo se AVANZA de fase si de verdad sigue trabajando —
 *  un saludo se resuelve en la primera y nunca dice "leyendo tu operación". */
export const fasesPensando = (t: TResto = T_RESTO_ES): Array<[number, string]> => ([
  [0, 'Pensando…'],
  [3000, t('ch.leyendo_tu_operacion')],
  [9000, 'Cruzando cifras…'],
  [17000, 'Armando la respuesta…'],
  [30000, t('op.esto_esta_tardando_mas_de_lo')],
]);
export const FASES_PENSANDO = fasesPensando();

/** Los bloques del agente analista (/api/dashboard/chat) → la Respuesta que
 *  esta interfaz ya sabe pintar. El agente manda números crudos; aquí se
 *  formatean con lib/formato — UNA sola fuente de formato, como siempre. */
export function respuestaDeBloques(bloques: Array<Record<string, unknown>>): Respuesta {
  const textos: string[] = [];
  const visuales: Visual[] = [];
  let accion: AccionPropuesta | undefined;
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
    } else if (b.tipo === 'accion' && typeof b.accion === 'string') {
      // Solo el copiloto de superadmin emite este bloque; el modo cliente nunca lo pinta (`acciones` apagado).
      accion = b as unknown as AccionPropuesta;
    }
  }
  return { texto: textos.join(' ') || 'Listo.', visuales: visuales.length > 0 ? visuales : undefined, ...(accion ? { accion } : {}) };
}

/** El catálogo de Consulta, por CATEGORÍA y formal (pedido del 12-ago:
 *  al ancho de la caja y con muchas más opciones). SIEMPRE completo: las
 *  respuestas ya degradan con honestidad cuando falta el dato ("todavía
 *  no hay..."), así que esconder categorías solo empobrecía el menú.
 *  Cada frase conserva una palabra clave que `responder` entiende —
 *  verificadas contra sus ramas una por una
 *  en `chat_respondedor_catalogo.test.ts` (A37-S16-09). */
export const catalogoConsulta = (t: TResto = T_RESTO_ES): Array<{ categoria: string; preguntas: string[] }> => ([
  {
    categoria: t('ch.cuadre_y_liquidaciones'),
    preguntas: [
      t('ch.muestrame_el_desglose_de_lo_comprobado'),
      t('ch.estado_de_las_liquidaciones_con_diferencia'),
      t('ch.cuantos_viajes_estan_por_revisar'),
      t('ch.monto_observado_por_el_motor_en'),
    ],
  },
  {
    categoria: t('ch.salud_del_cuadre'),
    preguntas: [
      t('ch.tasa_de_cuadre_del_periodo'),
      t('ch.cuantas_liquidaciones_cerraron_sin_diferencias'),
      t('ch.cuanto_llevo_comprobado'),
    ],
  },
  {
    categoria: t('ch.fiscal_y_acreditables'),
    preguntas: [
      t('ch.desglose_de_acreditables_del_periodo'),
      'IVA acreditable del periodo',
      'Peaje acreditable del periodo',
      t('ch.litros_de_diesel_elegibles_para_el'),
    ],
  },
]);
export const CATALOGO_CONSULTA = catalogoConsulta();

export function responder(pregunta: string, kpis: DashboardKpis | null, acred: Acreditables | null, t: TResto = T_RESTO_ES): Respuesta {
  const q = pregunta.toLowerCase();
  const sinLiq = { texto: t('ch.todavia_no_hay_liquidaciones_para_calcular') };
  // A37-S16-09: «observado» es el monto que el motor detectó fuera de regla o duplicado, NO lo comprobado (antes caía en la rama «monto»).
  if (q.includes('observad')) {
    if (!kpis) return sinLiq;
    return {
      texto: t(kpis.viajesLiquidados === 1 ? 'ch.el_motor_observa_uno' : 'ch.el_motor_observa_otros', { monto: mxn(kpis.diferenciaDetectada), n: kpis.viajesLiquidados }),
      visual: {
        tipo: 'tabla',
        filas: [
          [t('ch.fuera_de_regla_o_duplicado'), mxn(kpis.diferenciaDetectada)],
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
    return { texto: t('ch.de_liquidaciones_cerraron_sin_diferencias', { limpias, viajesLiquidados: kpis.viajesLiquidados }) };
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
          [t('ch.fuera_de_regla_o_duplicado'), mxn(kpis.diferenciaDetectada)],
        ],
      },
    };
  }
  if (q.includes('diferencia') || q.includes('revisar')) {
    if (!kpis) return sinLiq;
    const limpias = Math.max(0, kpis.viajesLiquidados - kpis.conDiferencias - kpis.porRevisar);
    return {
      texto: t('ch.liquidaciones_tienen_diferencia_o_estan_por', { v: kpis.conDiferencias + kpis.porRevisar, viajesLiquidados: kpis.viajesLiquidados }),
      visual: kpis.viajesLiquidados > 0
        ? { tipo: 'dona', segmentos: [
            { etiqueta: t('ch.sin_diferencias'), valor: limpias },
            { etiqueta: t('op.con_diferencias'), valor: kpis.conDiferencias },
            { etiqueta: t('op.por_revisar_2'), valor: kpis.porRevisar },
          ] }
        : undefined,
    };
  }
  if (q.includes('diesel') || q.includes('diésel') || q.includes('litro')) {
    if (!acred) return { texto: t('ch.todavia_no_hay_datos_de_diesel') };
    return {
      texto: t('ch.elegibles_para_el_estimulo_este_periodo', { litros: litros(acred.litrosDiesel) }),
      visual: { tipo: 'cifra', valor: litros(acred.litrosDiesel), nota: t('ch.lif_2026_art_20_a_el') },
    };
  }
  if (q.includes('tasa') || q.includes('cuadre') || q.includes('cuadra')) {
    if (!kpis) return sinLiq;
    const limpias = Math.max(0, kpis.viajesLiquidados - kpis.conDiferencias - kpis.porRevisar);
    return {
      texto: t('ch.tu_tasa_de_cuadre_es_liquidaciones', { tasaCuadre: kpis.tasaCuadre }),
      visual: kpis.viajesLiquidados > 0
        ? { tipo: 'dona', segmentos: [
            { etiqueta: t('ch.sin_diferencias'), valor: limpias },
            { etiqueta: t('ch.con_diferencias_o_por_revisar'), valor: kpis.conDiferencias + kpis.porRevisar },
          ] }
        : undefined,
    };
  }
  if (/\biva\b/.test(q) || q.includes('peaje') || q.includes('caseta') || q.includes('acreditable')) {
    if (!acred) return { texto: t('ch.todavia_no_hay_datos_de_acreditables') };
    return {
      texto: /\biva\b/.test(q)
        ? t('ch.de_iva_acreditable_este_periodo_liva', { mxn: mxn(acred.iva) })
        : q.includes('peaje') || q.includes('caseta')
          ? t('ch.de_peaje_acreditable_50_este_periodo', { mxn: mxn(acred.peaje) })
          : t('ch.esto_es_lo_que_llevas_de'),
      visual: {
        tipo: 'tabla',
        filas: [
          ['IVA acreditable', mxn(acred.iva)],
          ['Peaje acreditable (50%)', mxn(acred.peaje)],
          [t('ch.diesel_elegible'), litros(acred.litrosDiesel)],
        ],
      },
    };
  }
  return { texto: t('ch.todavia_no_se_responder_eso_preguntame') };
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
  pregunta: string, kpis: DashboardKpis | null, acred: Acreditables | null, motivo: string | null, t: TResto = T_RESTO_ES,
): Respuesta {
  const base = responder(pregunta, kpis, acred, t);
  if (!motivo) return base;
  const aviso = motivo.charAt(0).toUpperCase() + motivo.slice(1);
  return {
    ...base,
    texto: t('ch.esto_es_lo_que_puedo_contestarte', { v: aviso.endsWith('.') ? aviso : `${aviso}.`, texto: base.texto }),
  };
}
