// ═══════════════════════════════════════════════════════════════════════════
// ÚNICO LUGAR con las SUPUESTO-API del camino «TMS → desglose por correo» (hallazgo A35-A1-03).
//
// La API real del sistema de transporte AÚN NO EXISTE. Lo único confirmado en la grabación del cliente: dos tablas de
// nómina por bitácora ligadas por ID y póliza, una columna nueva `desglose` (los nombres que RH quiere ver), un campo
// para marcar lo ya consumido, operador (nombre en la tabla de operadores), unidad como empresa+número, percepciones
// (cargo>0) y deducciones (abono>0) en nodos separados, viáticos desglosados, fechas de inicio/fin que NO vienen en
// esas tablas, y usuario+contraseña que generan un token.
//
// TODA forma concreta (ruta, nombres de parámetro, nombres de campo, paginación, qué campo ordena el cursor) está
// aquí y marcada `SUPUESTO-API`. Cuando llegue la API real solo cambia este archivo; el lector, el pull, la recepción y
// el envío no se tocan. Los opcionales que falten (nº de liquidación/pago, tipo de operador, fechas) los resuelven las
// políticas que ya existen (retener y avisar); aquí nunca se inventa un valor.
// El login (ruta, cuerpo, campo del token) es otro SUPUESTO ya vigente en `conectores/tms/sincronizar.ts#loginDe`.
// ═══════════════════════════════════════════════════════════════════════════

import type { MapeoTms } from './desglose_mapeo_tms';

export interface ConfigApiDesglose {
  /** SUPUESTO-API: ruta GET de la lista de bitácoras con desglose. */
  ruta: string;
  /** SUPUESTO-API: nombres de los parámetros de consulta. */
  params: { desde: string; hasta: string; pagina: string; tam: string };
  /** SUPUESTO-API: filas por página pedidas. */
  tamano: number;
  /** SUPUESTO-API: dónde viene la lista de filas, el total de páginas en la respuesta. */
  rutaItems: string;
  rutaTotalPaginas: string;
  /** SUPUESTO-API: campo (instante ISO) por el que el origen filtra `desde/hasta` y que ordena el cursor. */
  campoCursor: string;
  /** Tope defensivo de páginas por lectura. */
  maxPaginas: number;
  /** Primer arranque sin cursor: cuántos días atrás se lee (no se reenvía historial). */
  ventanaInicialDias: number;
  /** SUPUESTO-API: cómo se lee una fila cruda. */
  mapeo: MapeoTms;
  /**
   * SUPUESTO-API / PUERTO SIN IMPLEMENTAR: el endpoint con que el TMS recibiría «ya consumido por el agente» NO existe
   * (se pidió un campo para marcarlo, sin forma conocida). `null` = el lector no ofrece `marcarEnviadas`; el pull
   * funciona igual y la verdad sigue siendo Likida. El puerto `marcarEnviadas` ya existe y se prueba con un doble.
   */
  marcar: null;
}

export const CONFIG_API_DESGLOSE: ConfigApiDesglose = {
  ruta: '/api/liquidaciones',
  params: { desde: 'desde', hasta: 'hasta', pagina: 'pagina', tam: 'tam' },
  tamano: 100,
  rutaItems: 'data.items',
  rutaTotalPaginas: 'data.total_paginas',
  campoCursor: 'de',
  maxPaginas: 50,
  ventanaInicialDias: 2,
  marcar: null,
  mapeo: {
    bitacora: 'bitacora',
    poliza: 'poliza',
    terminal: 'terminal',
    operadorNumero: 'operador_numero',
    operadorNombre: 'operador',
    unidad: 'unidad',
    tipoOperador: 'tipo_operador',
    desde: 'de',
    hasta: 'a',
    dias: 'dias',
    enviado: 'enviado',
    percepciones: 'percepciones',
    deducciones: 'deducciones',
    renglon: { desglose: 'desglose', descripcion: 'concepto', monto: 'valor', vale: 'vale', tipoConcepto: 'tipo', detalleViaticos: 'detalle' },
  },
};
