// El ESTADO REAL del dunning de las mensualidades de Likida (`factura_saas`).
//
// Puro: recibe las facturas por cobrar, las propuestas que el agente
// `cobranza_saas` ya puso en la cola de aprobación y `hoy`, y dice qué toque de
// la cadencia −3/0/+3/+7/+15 le toca a cada factura y en qué estado está su
// propuesta. La cadencia y el título-llave son los del agente
// (`agentes/exito.ts`): una sola fuente, no una copia que se desalinee.
//
// El dunning PRODUCE PROPUESTAS, NO ENVÍOS: nada sale solo (no hay canal de
// correo al cliente aprobado). Esta vista no lo disfraza.

import { HITOS_COBRANZA, toquesDeHoy, tituloToque, diasEntreDias } from './agentes/exito';
import type { FacturaPorCobrar } from '@/lib/saas/transferencia';
import type { PiezaDunning } from './repo';

export type SelloToque = 'sin_propuesta' | 'pendiente' | 'aprobada' | 'rechazada' | 'enviada';

export interface ToqueVista { hito: number; sello: SelloToque }

export interface FacturaDunning {
  factura: FacturaPorCobrar;
  /** Días contra el vencimiento (periodo_inicio). Negativo = aún no vence. */
  dias: number;
  vencida: boolean;
  toques: ToqueVista[];
  /** El siguiente hito de la cadencia que todavía no se alcanza, o `null`. */
  proximoHito: number | null;
}

export interface EstadoDunning {
  facturas: FacturaDunning[];
  porCobrar: number;
  montoPorCobrar: number;
  vencidas: number;
  montoVencido: number;
  /** Toques alcanzados que NO tienen propuesta en la cola: el agente no ha
   *  corrido o falló — es la señal que más importa. */
  toquesSinPropuesta: number;
  propuestasPendientes: number;
  propuestasEnviadas: number;
}

function sello(pieza: PiezaDunning | undefined): SelloToque {
  if (!pieza) return 'sin_propuesta';
  if (pieza.enviadoEn) return 'enviada';
  if (pieza.estado === 'aprobado') return 'aprobada';
  if (pieza.estado === 'rechazado') return 'rechazada';
  return 'pendiente';
}

export function armarEstadoDunning(facturas: FacturaPorCobrar[], piezas: PiezaDunning[], hoy: string): EstadoDunning {
  const porTitulo = new Map<string, PiezaDunning>();
  // `piezas` llega de la más nueva a la más vieja: la primera por título gana.
  for (const p of piezas) if (!porTitulo.has(p.titulo)) porTitulo.set(p.titulo, p);
  const alcanzados = toquesDeHoy(facturas, hoy);

  const filas: FacturaDunning[] = facturas.map((factura) => {
    const dias = diasEntreDias(factura.periodoInicio, hoy);
    const toques = alcanzados
      .filter((t) => t.factura.id === factura.id)
      .map((t) => ({ hito: t.hito, sello: sello(porTitulo.get(tituloToque(t))) }));
    const proximoHito = HITOS_COBRANZA.find((h) => h > dias) ?? null;
    return { factura, dias, vencida: dias > 0, toques, proximoHito };
  });

  const vencidas = filas.filter((f) => f.vencida);
  const todos = filas.flatMap((f) => f.toques);
  return {
    facturas: filas,
    porCobrar: filas.length,
    montoPorCobrar: round(filas.reduce((s, f) => s + f.factura.monto, 0)),
    vencidas: vencidas.length,
    montoVencido: round(vencidas.reduce((s, f) => s + f.factura.monto, 0)),
    toquesSinPropuesta: todos.filter((t) => t.sello === 'sin_propuesta').length,
    propuestasPendientes: todos.filter((t) => t.sello === 'pendiente').length,
    propuestasEnviadas: todos.filter((t) => t.sello === 'enviada').length,
  };
}

function round(n: number): number { return Math.round(n * 100) / 100; }
