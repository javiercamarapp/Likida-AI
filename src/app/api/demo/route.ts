import { NextResponse } from 'next/server';
import { cuadrarViaje, type PoliticaGasto } from '@/lib/cuadra/cuadre/engine';
import type { Gasto } from '@/types/cuadra';

export const runtime = 'nodejs';

// Demo determinístico (sin LLM ni DB) — corre el MOTOR DE CUADRE real sobre
// comprobantes de ejemplo. Robusto para una demo en vivo: nunca depende de red.

const POLITICA: PoliticaGasto[] = [
  { concepto: 'diesel', topeMonto: 3000 },
  { concepto: 'caseta', topeMonto: 1200 },
  { concepto: 'factura', requiereCfdi: true },
];

export async function POST(req: Request) {
  const body = (await req.json()) as { comprobantes: Partial<Gasto>[]; anticipo: number };
  const gastos: Gasto[] = (body.comprobantes ?? []).map((c, i) => ({
    id: `g${i}`,
    concepto: c.concepto ?? 'otro',
    monto: c.monto ?? 0,
    folio: c.folio,
    cfdiUuid: c.cfdiUuid,
    ocrConfianza: c.ocrConfianza ?? 0.96,
  }));
  const liq = cuadrarViaje({ viajeId: 'demo', anticipo: body.anticipo ?? 0, gastos, politica: POLITICA, ruta: 'Silao-Laredo' });
  return NextResponse.json({
    totalComprobado: liq.totalComprobado,
    totalAnticipo: liq.totalAnticipo,
    diferencia: liq.diferencia,
    estatus: liq.estatus,
    diferencias: liq.diferencias.map((d) => ({ tipo: d.tipo, nota: d.nota, monto: d.monto })),
  });
}
