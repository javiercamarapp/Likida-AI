import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Liquidacion, Viaje, Operador } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// LA LIQUIDACIÓN CONSUME LAS ESTADÍAS (ola 3): el cierre lee las estadías del viaje (Agente 5) y las imprime como ANEXO
// en el ejemplar del CONTRALOR — con el PDF de verdad, leído de los bytes que se suben a storage, como
// `tools_cableado.test.ts`. Reglas: el operador no lo ve, no cambia ni un total, y si la lectura falla el papel sale igual.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('./liquidacion/rutas_pdf', async (original) => ({
  ...await original<typeof import('./liquidacion/rutas_pdf')>(),
  rutasPdfVersionadas: (tenant: string, viaje: string) => ({
    contralor: `${tenant}/${viaje}-contralor.pdf`, operador: `${tenant}/${viaje}-operador.pdf`,
  }),
}));

const LIQ: Omit<Liquidacion, 'id' | 'creadaEn'> = {
  viajeId: 'v1', totalComprobado: 8000, totalAnticipo: 8000, diferencia: 0, estatus: 'cuadrada',
  totalDeducible: 8000, totalNoDeducible: 0, totalPorConfirmar: 0,
  iepsAcreditable: 0, litrosDieselAcreditables: 0, ivaAcreditable: 0, peajeAcreditable: 0,
  gastos: [{ id: 'g1', concepto: 'diesel', monto: 8000, folio: 'A1', fecha: '2026-05-01' }], diferencias: [],
};
const VIAJE: Viaje = { id: 'v1', folio: 'VJ-1', origen: 'Mérida', destino: 'Cancún', anticipo: 8000 };
const OPERADOR: Operador = { id: 'o1', nombre: 'Juan Pérez', telefono: '5219993700779', terminal: 'Mérida' };

const subidos = new Map<string, Uint8Array>();
const saveLiquidacion = vi.fn(async () => 'liq-1');
const estadiasParaLiquidacion = vi.hoisted(() => vi.fn());

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./interruptores', () => ({ estaApagado: vi.fn(async () => false) }));
vi.mock('./agentes/corridas', () => ({ registrarCorrida: vi.fn(async () => {}) }));
vi.mock('./cuadre/desde_db', () => ({ cuadrarDesdeDB: vi.fn(async () => LIQ) }));
vi.mock('./config', () => ({ getConfig: vi.fn(async () => ({ politica: [] })) }));
vi.mock('./conductor/servicios', () => ({ estadiasParaLiquidacion: (...a: unknown[]) => estadiasParaLiquidacion(...a) }));
vi.mock('./repo', () => ({
  getViaje: vi.fn(async () => VIAJE), getOperador: vi.fn(async () => OPERADOR), saveLiquidacion,
  leerSnapshotInsumosCierre: vi.fn(async () => ({ version: 2, hash: 'a'.repeat(64) })),
  insumosDeCierreCambiaron: vi.fn(() => false),
  getAcumuladoCombustible: vi.fn(async () => { throw new Error('sin base en pruebas'); }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ storage: { from: () => ({ upload: async (path: string, buf: Buffer) => { subidos.set(path, new Uint8Array(buf)); return { error: null }; } }) } }),
}));

await import('./tools');
const { executeTool } = await import('@/lib/llm/tool-executor');
const { armarFilasEstadias } = await import('./conductor/estadias_lectura');
const { hitoVacio } = await import('./conductor/memoria.fixture');

async function textoDelPdf(bytes: Uint8Array): Promise<string> {
  const { inflateSync } = await import('node:zlib');
  const buf = Buffer.from(bytes);
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x73 && buf.subarray(i, i + 6).toString('latin1') === 'stream') {
      let ini = i + 6;
      while (buf[ini] === 0x0d || buf[ini] === 0x0a) ini++;
      const fin = buf.indexOf(Buffer.from('endstream'), ini);
      if (fin < 0) continue;
      try { out += inflateSync(buf.subarray(ini, fin)).toString('latin1'); } catch { /* no comprimido */ }
      i = fin;
    }
  }
  return out.replace(/<([0-9A-Fa-f]+)>\s*Tj/g, (_m, hex: string) => Buffer.from(hex, 'hex').toString('latin1'));
}

const CTX = { tenantId: 't1', viajeId: 'v1', operadorId: 'o1', telefono: '5219993700779', cierrePedidoPorTexto: true };
const cerrar = () => executeTool('guardar_liquidacion', {}, { ...CTX, runId: randomUUID() });
const CONTRALOR = 't1/v1-contralor.pdf';
const OPERADOR_PDF = 't1/v1-operador.pdf';

/** Las estadías de un viaje con la carga cerrada (2 h 30 min) y pacto de 2 h libres a $600/h. */
function estadiasDeEjemplo() {
  const t0 = new Date('2026-10-02T14:00:00.000Z').toISOString();
  const t1 = new Date('2026-10-02T16:30:00.000Z').toISOString();
  const hs = (['llegada_carga', 'salida_carga', 'llegada_descarga', 'salida_descarga', 'regreso'] as const).map((tipo) =>
    hitoVacio({ id: `h-${tipo}`, tipo, viajeId: 'v1', tenantId: 't1', ...(tipo === 'llegada_carga' ? { estado: 'recibido', fuente: 'texto', mensajeEn: t0, recibidoEn: t0 } : tipo === 'salida_carga' ? { estado: 'recibido', fuente: 'texto', mensajeEn: t1, recibidoEn: t1 } : {}) }));
  return armarFilasEstadias({
    viajes: [{
      id: 'v1', folio: 'VJ-1', origen: 'Mérida', destino: 'Cancún', estatus: 'en_cuadre', operadorId: 'o1', operadorNombre: 'Juan Pérez', terminalId: null, terminalNombre: null,
      clienteId: 'c1', clienteNombre: 'Cliente A', unidadId: null, aceptadoEn: t0, citaOrigenEn: null, citaDestinoEn: null, etaOrigenEn: null, etaDestinoEn: null,
      origenSitioId: null, destinoSitioId: null,
    }], hitos: hs, veredictos: [], evidencias: [], sitios: new Map(), truncada: false,
  }, new Date('2026-10-02T20:00:00.000Z'), { flota: { horasLibres: 2, tarifaHora: 600, moneda: 'MXN' }, porCliente: new Map() });
}

beforeEach(() => { subidos.clear(); saveLiquidacion.mockClear(); estadiasParaLiquidacion.mockReset(); });

describe('el cierre de la liquidación consume las estadías del viaje', () => {
  it('el ejemplar del CONTRALOR trae el anexo con hora exacta, duración y cobro propuesto; el del OPERADOR no', async () => {
    estadiasParaLiquidacion.mockResolvedValue(estadiasDeEjemplo());
    const r = await cerrar();
    expect(r.success, r.error).toBe(true);
    const contralor = await textoDelPdf(subidos.get(CONTRALOR)!);
    expect(contralor).toContain('ESTADIAS EN ANDEN');
    expect(contralor).toContain('Duracion 2 h 30 min');
    expect(contralor).toContain('Propuesta: 1 h cobrables = $600.00');
    expect(contralor).toContain('Anexo informativo: NO suma a ning');   // la nota lo dice (la línea se parte donde acaba el ancho)
    const operador = await textoDelPdf(subidos.get(OPERADOR_PDF)!);
    expect(operador).not.toContain('ESTADIAS EN ANDEN');
    expect(operador).not.toContain('cobrables');
    expect(operador).toContain('Total comprobado');
  });

  it('se lee del viaje de la FLOTA del cierre (tenant y viaje del contexto)', async () => {
    estadiasParaLiquidacion.mockResolvedValue(estadiasDeEjemplo());
    await cerrar();
    expect(estadiasParaLiquidacion).toHaveBeenCalledTimes(1);
    expect(estadiasParaLiquidacion.mock.calls[0].slice(0, 2)).toEqual(['t1', 'v1']);
  });

  it('el anexo NO mueve ni un total ni lo que se archiva: la fila se guarda con las mismas cifras', async () => {
    estadiasParaLiquidacion.mockResolvedValue(estadiasDeEjemplo());
    await cerrar();
    const sin = saveLiquidacion.mock.calls[0];
    saveLiquidacion.mockClear(); subidos.clear();
    estadiasParaLiquidacion.mockResolvedValue(null);
    await cerrar();
    expect(saveLiquidacion.mock.calls[0]).toEqual(sin);                     // misma liquidación, mismo conteo, mismo hash de insumos
    const t = await textoDelPdf(subidos.get(CONTRALOR)!);
    expect(t).not.toContain('ESTADIAS EN ANDEN');
  });

  it('sin estadías (sin hitos, o lectura caída) el papel SALE igual, sin anexo', async () => {
    estadiasParaLiquidacion.mockResolvedValue(null);
    const r = await cerrar();
    expect((r.result as { pdf_contralor_generado: boolean }).pdf_contralor_generado).toBe(true);
    expect([...subidos.keys()].sort()).toEqual([CONTRALOR, OPERADOR_PDF]);
  });
});
