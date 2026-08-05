// TEMPORAL — fase 5: el mensaje real que el chofer recibiría. Se borra.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const OUT = process.env.E2E_OUT!;

describe('fase 5', () => {
  it('corre', async () => {
    const { fechaDudosa, ventanaDelViaje } = await import('@/lib/cuadra/cuadre/fecha_dudosa');
    const { mensajePideFechaOtraVez } = await import('@/lib/cuadra/intake/pedir_fecha');
    const { etiquetaConcepto } = await import('@/lib/cuadra/cuadre/engine');
    const { lineaDeSaldo } = await import('@/lib/cuadra/acuse_ticket');

    const ocr = JSON.parse(readFileSync(`${OUT}/ocr.json`, 'utf8')) as Array<Record<string, unknown>>;
    const ventana = ventanaDelViaje('2026-08-02', 33, new Date('2026-08-05T04:30:00Z'));
    console.log('ventana:', JSON.stringify(ventana));
    for (const r of ocr) {
      const g = r.gasto as Record<string, unknown>;
      const d = fechaDudosa(g.fecha as string, ventana);
      if (!d) continue;
      const extra = (g.ocrExtra ?? {}) as Record<string, unknown>;
      console.log(`\n═══ ${r.foto} → fechaDudosa = ${d} ═══`);
      console.log(mensajePideFechaOtraVez({
        etiqueta: etiquetaConcepto(g.concepto as never, extra),
        monto: g.monto as number,
        folio: g.folio as string,
        emisor: extra.emisor as string,
        fecha: g.fecha as string,
        fechaImpresa: extra.fechaImpresa as string,
        ejercicioHoy: 2026,
      }, d));
    }

    // La línea de saldo que acompaña CADA confirmación, con el duplicado dentro.
    console.log('\n═══ lineaDeSaldo con los 7 gastos en base (incluye el duplicado) ═══');
    console.log(lineaDeSaldo({ anticipo: 2500, comprobado: 2616.45, comprobantes: 7, ultimoConcepto: 'otro', ultimoMonto: 664, enRevision: 0 }));
    console.log('vs. lo que dice la liquidación al cerrar: comprobado $1,952.45');
    expect(true).toBe(true);
  }, 120_000);
});
