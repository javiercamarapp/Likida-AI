// ═══════════════════════════════════════════════════════════════════════════
// MOTOR DE CUADRE (determinístico, sin LLM) — el diferenciador de Cuadra.
//
// Compara los gastos comprobados contra el anticipo entregado y la política de
// la flota, y detecta: sobre-política, faltante de CFDI, duplicados y baja
// confianza de OCR. Es una función pura → testeable, auditable, sin sorpresas.
// El LLM del agente ORQUESTA (pide fotos, explica), pero la DECISIÓN de dinero
// la toma este motor. Eso es lo que da "sin fallas".
// ═══════════════════════════════════════════════════════════════════════════

import { strip_accents } from './util';
import type { Gasto, Diferencia, Liquidacion, EstatusLiquidacion } from '@/types/cuadra';

export interface PoliticaGasto {
  concepto: string;       // diesel | caseta | viaticos | factura | otro
  ruta?: string;          // aplica a ruta específica (opcional)
  topeMonto?: number;     // tope permitido por comprobante
  requiereCfdi?: boolean; // el concepto exige CFDI válido
}

export interface CuadreInput {
  viajeId: string;
  anticipo: number;
  gastos: Gasto[];
  politica: PoliticaGasto[];
  ruta?: string;
  /** Umbral de confianza de OCR bajo el cual se marca "revisar". Default 0.85. */
  umbralConfianza?: number;
}

function politicaPara(concepto: string, ruta: string | undefined, pol: PoliticaGasto[]): PoliticaGasto | undefined {
  const c = strip_accents(concepto.toLowerCase());
  // Preferir una política específica de la ruta; si no, la general del concepto.
  const dela = pol.filter((p) => strip_accents(p.concepto.toLowerCase()) === c);
  return dela.find((p) => p.ruta && ruta && p.ruta === ruta) ?? dela.find((p) => !p.ruta);
}

export function cuadrarViaje(input: CuadreInput): Omit<Liquidacion, 'id' | 'creadaEn'> {
  const umbral = input.umbralConfianza ?? 0.85;
  const diferencias: Diferencia[] = [];

  const totalComprobado = input.gastos.reduce((s, g) => s + (g.monto || 0), 0);

  // 1) Sobre política + faltante de CFDI
  for (const g of input.gastos) {
    const pol = politicaPara(g.concepto, input.ruta, input.politica);
    if (pol?.topeMonto != null && g.monto > pol.topeMonto) {
      diferencias.push({
        tipo: 'sobre_politica',
        concepto: g.concepto,
        esperado: pol.topeMonto,
        real: g.monto,
        monto: g.monto - pol.topeMonto,
        nota: `${label(g.concepto)} de ${mxn(g.monto)} excede el tope de política (${mxn(pol.topeMonto)}) por ${mxn(g.monto - pol.topeMonto)}.`,
        gastoId: g.id,
      });
    }
    if (pol?.requiereCfdi && !g.cfdiUuid) {
      diferencias.push({
        tipo: 'sin_cfdi',
        concepto: g.concepto,
        monto: 0,
        nota: `${label(g.concepto)} de ${mxn(g.monto)} requiere factura CFDI y no trae UUID válido.`,
        gastoId: g.id,
      });
    }
    if (g.ocrConfianza != null && g.ocrConfianza < umbral) {
      diferencias.push({
        tipo: 'ocr_baja_confianza',
        concepto: g.concepto,
        monto: 0,
        nota: `El comprobante de ${label(g.concepto)} se leyó con baja confianza — conviene revisarlo a mano.`,
        gastoId: g.id,
      });
    }
  }

  // 2) Duplicados (mismo concepto + folio + monto)
  const vistos = new Map<string, string>();
  for (const g of input.gastos) {
    const key = `${strip_accents(g.concepto.toLowerCase())}|${g.folio ?? ''}|${g.monto}`;
    if (g.folio && vistos.has(key)) {
      diferencias.push({
        tipo: 'duplicado',
        concepto: g.concepto,
        monto: g.monto,
        nota: `Comprobante duplicado: ${label(g.concepto)} folio ${g.folio} por ${mxn(g.monto)} aparece dos veces.`,
        gastoId: g.id,
      });
    } else if (g.folio) {
      vistos.set(key, g.id);
    }
  }

  // 3) Diferencia global contra el anticipo
  // diferencia > 0  → sobró anticipo (a favor de la empresa: el operador regresa)
  // diferencia < 0  → el operador gastó de más (a favor del operador)
  const diferencia = round2(input.anticipo - totalComprobado);
  if (Math.abs(diferencia) >= 0.5) {
    diferencias.push({
      tipo: 'anticipo',
      esperado: input.anticipo,
      real: totalComprobado,
      monto: diferencia,
      nota:
        diferencia > 0
          ? `Sobró ${mxn(diferencia)} del anticipo — a favor de la empresa.`
          : `El operador puso ${mxn(-diferencia)} de su bolsa — a favor del operador.`,
    });
  }

  const hayRevisar = diferencias.some((d) => d.tipo === 'ocr_baja_confianza' || d.tipo === 'sin_cfdi');
  const hayDif = diferencias.some((d) => d.tipo === 'sobre_politica' || d.tipo === 'duplicado') || Math.abs(diferencia) >= 0.5;
  const estatus: EstatusLiquidacion = hayRevisar ? 'revisar' : hayDif ? 'con_diferencias' : 'cuadrada';

  return {
    viajeId: input.viajeId,
    totalComprobado: round2(totalComprobado),
    totalAnticipo: round2(input.anticipo),
    diferencia,
    estatus,
    diferencias,
    gastos: input.gastos,
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function mxn(n: number): string {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}
function label(c: string): string {
  const m: Record<string, string> = { diesel: 'Diésel', caseta: 'Caseta', factura: 'Factura', viaticos: 'Viáticos', otro: 'Gasto' };
  return m[strip_accents(c.toLowerCase())] ?? c;
}
