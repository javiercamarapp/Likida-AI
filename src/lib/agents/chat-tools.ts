// ═══════════════════════════════════════════════════════════════════════════
// TOOLS del agente `analista_flota` (el chat "Pregunta a tus datos" del
// panel, 12-ago-2026). TODAS DE SOLO LECTURA y ancladas a `ctx.tenantId` —
// el modelo decide CUÁL llamar y con qué ventana, NUNCA de qué flota: el
// tenant lo fijó el servidor al autorizar. Ninguna tool acepta texto libre
// que llegue a una consulta: los únicos parámetros son enums cerrados.
// Es la alternativa deliberada a "lenguaje natural → SQL", que esta caja
// jamás debe tener (la usa un tenant real, y el panel corre con service
// role — ver el mismo criterio en chat.tsx desde su primera versión).
//
// Los resultados van RECORTADOS (topes de filas) a propósito: el costo del
// turno es proporcional a lo que el modelo lee, y 100 viajes completos por
// pregunta es pagar tokens por filas que la respuesta no usa.
// ═══════════════════════════════════════════════════════════════════════════

import { registerTool } from '@/lib/llm/tool-executor';
import {
  getKpis, getAcreditables, detectarAnomalias, getViajes, getLiquidaciones,
  getGastoPorSemanaSeries, getLiquidadoPorSemanaSeries, getTopRutasPorGastoSeries,
} from '@/lib/likida/analytics';
import { getConfig } from '@/lib/likida/config';
import { resolverPeriodo, getGastosFiscales, resumirPerdidas, opcionesDe } from '@/lib/likida/fiscal';
import { ahoraMs } from '@/lib/saludo';

const SIN_PARAMS = { type: 'object', properties: {}, additionalProperties: false } as const;

/** Único parámetro que existe en este set: la ventana, como enum cerrado. */
const PARAM_MODO = {
  type: 'object',
  properties: {
    modo: { type: 'string', enum: ['semanal', 'mensual', 'historico'], description: 'Ventana: últimos 7 días, últimos 30, o todo el histórico.' },
  },
  required: ['modo'],
  additionalProperties: false,
} as const;

type Modo = 'semanal' | 'mensual' | 'historico';
function modoDe(args: Record<string, unknown>): Modo {
  const m = args.modo;
  return m === 'mensual' || m === 'historico' ? m : 'semanal';
}
function hoyIso(): string {
  return new Date(ahoraMs()).toISOString().slice(0, 10);
}

registerTool('kpis_flota', {
  schema: {
    type: 'function',
    function: {
      name: 'kpis_flota',
      description: 'KPIs de cuadre de la flota (histórico completo): viajes liquidados, monto comprobado MXN, dinero observado, con diferencias, por revisar, tasa de cuadre %.',
      parameters: SIN_PARAMS,
    },
  },
  handler: async (_a, ctx) => ({ moneda: 'MXN', ...(await getKpis(ctx.tenantId)) }),
});

registerTool('acreditables_periodo', {
  schema: {
    type: 'function',
    function: {
      name: 'acreditables_periodo',
      description: 'Acreditables fiscales del ejercicio en curso: IVA MXN, peaje al 50% MXN y litros de diésel elegibles para el estímulo (LIF 2026 Art. 20-A). El estímulo en pesos NO se calcula aquí: es cuota DOF semanal × litros.',
      parameters: SIN_PARAMS,
    },
  },
  handler: async (_a, ctx) => {
    const hoy = hoyIso();
    const periodo = resolverPeriodo(undefined, hoy);
    const dias = periodo.desde
      ? Math.floor((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${periodo.desde}T00:00:00Z`)) / 86_400_000) + 1
      : undefined;
    const a = await getAcreditables(ctx.tenantId, dias);
    return { periodo: periodo.etiqueta, moneda: 'MXN', ivaAcreditable: a.iva, peajeAcreditable50pct: a.peaje, litrosDieselElegibles: a.litrosDiesel };
  },
});

registerTool('motor_fiscal', {
  schema: {
    type: 'function',
    function: {
      name: 'motor_fiscal',
      description: 'El motor fiscal del ejercicio: monto perdido, en riesgo y recuperable pidiendo factura (MXN), con el desglose por causa. Es la lectura de deducciones del ejercicio en curso.',
      parameters: SIN_PARAMS,
    },
  },
  handler: async (_a, ctx) => {
    const periodo = resolverPeriodo(undefined, hoyIso());
    const [cfg, gastos] = await Promise.all([
      getConfig(ctx.tenantId),
      getGastosFiscales(ctx.tenantId, periodo),
    ]);
    const r = resumirPerdidas(gastos, opcionesDe(cfg));
    return {
      periodo: periodo.etiqueta, moneda: 'MXN',
      montoPerdido: r.montoPerdido, montoEnRiesgo: r.montoEnRiesgo, montoRecuperable: r.montoRecuperable,
      porCausa: r.porCausa.slice(0, 6),
    };
  },
});

registerTool('viajes_flota', {
  schema: {
    type: 'function',
    function: {
      name: 'viajes_flota',
      description: 'Los viajes más recientes de la flota (máx. 25): folio, origen→destino, estatus (abierto|en_cuadre|liquidado), anticipo MXN, operador y fecha de inicio.',
      parameters: SIN_PARAMS,
    },
  },
  handler: async (_a, ctx) => {
    const vs = await getViajes(ctx.tenantId);
    return {
      total: vs.length, mostrando: Math.min(vs.length, 25), moneda: 'MXN',
      viajes: vs.slice(0, 25).map((v) => ({
        folio: v.folio, origen: v.origen, destino: v.destino, estatus: v.estatus,
        anticipo: v.anticipo, operador: v.operadorNombre, inicio: v.fechaInicio,
      })),
    };
  },
});

registerTool('liquidaciones_flota', {
  schema: {
    type: 'function',
    function: {
      name: 'liquidaciones_flota',
      description: 'Las liquidaciones más recientes (máx. 20): folio del viaje, monto comprobado MXN, diferencia MXN y estatus (cuadrada|con_diferencias|revisar).',
      parameters: SIN_PARAMS,
    },
  },
  handler: async (_a, ctx) => {
    const ls = await getLiquidaciones(ctx.tenantId);
    return {
      total: ls.length, mostrando: Math.min(ls.length, 20), moneda: 'MXN',
      liquidaciones: ls.slice(0, 20).map((l) => ({
        folio: l.folio, comprobado: l.comprobado, diferencia: l.diferencia, estatus: l.estatus, creadaEn: l.creadoEn,
      })),
    };
  },
});

registerTool('serie_gasto', {
  schema: {
    type: 'function',
    function: {
      name: 'serie_gasto',
      description: 'Serie de gasto por categoría (diésel, casetas, viáticos...) en la ventana pedida, en MXN — para tendencias y comparaciones de gasto.',
      parameters: PARAM_MODO,
    },
  },
  handler: async (args, ctx) => {
    const s = (await getGastoPorSemanaSeries(ctx.tenantId, hoyIso()))[modoDe(args)];
    return { modo: modoDe(args), moneda: 'MXN', categorias: s.categorias, series: s.series };
  },
});

registerTool('serie_liquidado', {
  schema: {
    type: 'function',
    function: {
      name: 'serie_liquidado',
      description: 'Serie de monto liquidado por bucket de tiempo en la ventana pedida, en MXN — para ver el ritmo de cierres.',
      parameters: PARAM_MODO,
    },
  },
  handler: async (args, ctx) => {
    const s = (await getLiquidadoPorSemanaSeries(ctx.tenantId, hoyIso()))[modoDe(args)];
    return { modo: modoDe(args), moneda: 'MXN', puntos: s.slice(0, 60) };
  },
});

registerTool('top_rutas', {
  schema: {
    type: 'function',
    function: {
      name: 'top_rutas',
      description: 'Las 5 rutas con más gasto en la ventana pedida, en MXN.',
      parameters: PARAM_MODO,
    },
  },
  handler: async (args, ctx) => {
    const s = (await getTopRutasPorGastoSeries(ctx.tenantId, 5, hoyIso()))[modoDe(args)];
    return { modo: modoDe(args), moneda: 'MXN', rutas: s };
  },
});

registerTool('duplicados_detectados', {
  schema: {
    type: 'function',
    function: {
      name: 'duplicados_detectados',
      description: 'Comprobantes repetidos entre viajes distintos (posible doble cobro) — detalle y monto MXN. Coincidencia detectada, no un veredicto.',
      parameters: SIN_PARAMS,
    },
  },
  handler: async (_a, ctx) => {
    const as = await detectarAnomalias(ctx.tenantId);
    return { total: as.length, moneda: 'MXN', anomalias: as.slice(0, 10) };
  },
});
