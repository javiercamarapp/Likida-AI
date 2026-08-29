import { describe, test, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ocrLeidoDeGastoPersistido, modeloOcrDeCorrida, prepararLecturaDeFoto, prepararMedicionCorrida,
  type EntradaMedicionFoto, type GastoEvidencia,
} from './qa-medicion';
import { ocrVacio } from './qa-verdad';
import type { CorridaQA, FotoBanco, VerdadTerreno } from './qa-tipos';

// ═══════════════════════════════════════════════════════════════════════════
// EL MEDIDOR DE UNA CORRIDA — lo que se fija:
//
//  1. La lectura de cada foto sale de la EVIDENCIA PERSISTIDA (gasto por
//     img_hash) y la suma de contadores es SIEMPRE 7 — el CHECK de la 0239.
//  2. Un fallo de infraestructura (bad/interrumpida/sin turno) son 7 campos
//     SIN MEDIR con su motivo — jamás 7 errores del modelo.
//  3. Una foto 'ok' sin gasto se juzga por la CLASE del papel: el negativo
//     rechazado es acierto, el voucher es diseño, el ticket es fallo.
//  4. El guard de la evidencia borrada: un tenant ya limpiado NO se mide —
//     medir sobre su ausencia contaría cada foto como rechazada.
// ═══════════════════════════════════════════════════════════════════════════

const VERDAD: VerdadTerreno = {
  comercioClave: null,
  emisor: 'OXXO GAS',
  rfcEmisor: 'OGA123456AB1',
  folio: '000777',
  monto: 850,
  fecha: '2026-08-20',
  sucursal: 'Estación Silao',
  dominioFacturacion: 'factura.oxxogas.com',
  ilegibles: [],
  noAplica: [],
  clase: 'ticket',
  notas: null,
};

const foto = (p: Partial<FotoBanco>): FotoBanco => ({
  id: 'f1', hash: 'hash-1', path: 'banco/f1.jpg', mime: 'image/jpeg',
  etiqueta: 'ticket.jpg', bytes: 10, subidoEn: '2026-08-25T12:00:00Z',
  ocrEsperado: VERDAD, confirmadoEn: '2026-08-25T12:00:00Z', ...p,
});

const entrada = (p: Partial<EntradaMedicionFoto>): EntradaMedicionFoto => ({
  foto: foto({}), estado: 'ok', detalle: null, costoUsd: 0.002, gasto: null, huerfanoLeido: null, ...p,
});

describe('ocrLeidoDeGastoPersistido — la fila de la base a las 7 claves', () => {
  test('traduce el casing de la base y respeta las reglas del puente de producción', () => {
    const g: GastoEvidencia = {
      img_hash: 'h',
      monto: '850.00',              // numeric llega como texto por PostgREST
      fecha: '2026-08-20',
      folio: '000777',
      rfc_emisor: 'OGA123456AB1',
      ocr_extra: { emisor: 'OXXO GAS', estacion: 'Estación Silao', urlFacturacion: 'factura.oxxogas.com' },
    };
    expect(ocrLeidoDeGastoPersistido(g)).toEqual({
      emisor: 'OXXO GAS', rfcEmisor: 'OGA123456AB1', folio: '000777',
      monto: 850, fecha: '2026-08-20', sucursal: 'Estación Silao',
      dominioFacturacion: 'factura.oxxogas.com',
    });
  });

  test('un monto 0 del camino fallo_tecnico es "no leyó nada", no "leyó cero pesos"', () => {
    expect(ocrLeidoDeGastoPersistido({ img_hash: 'h', monto: 0, fecha: null, folio: null, rfc_emisor: null, ocr_extra: null }).monto).toBeNull();
  });
});

describe('modeloOcrDeCorrida — jamás se inventa un nombre', () => {
  test('uno solo → ese; varios → todos dichos; ninguno → "no registrado"', () => {
    expect(modeloOcrDeCorrida(['google/gemini-3.1-flash-lite'])).toBe('google/gemini-3.1-flash-lite');
    expect(modeloOcrDeCorrida(['b', 'a', 'b'])).toBe('ocr:varios(a, b)');
    expect(modeloOcrDeCorrida([])).toBe('ocr:modelo-no-registrado');
    expect(modeloOcrDeCorrida(['', '  '])).toBe('ocr:modelo-no-registrado');
  });
});

describe('prepararLecturaDeFoto — cómo se cuenta cada caso', () => {
  test('con gasto persistido se mide campo por campo — y la suma es 7', () => {
    const l = prepararLecturaDeFoto(entrada({
      gasto: {
        img_hash: 'hash-1', monto: 850, fecha: '2026-08-20', folio: '000777',
        rfc_emisor: 'OGA123456AB1',
        ocr_extra: { emisor: 'OXXO GAS', estacion: 'Estación Silao', urlFacturacion: 'factura.oxxogas.com' },
      },
    }), 'modelo-x');
    expect(l.medicion.camposOk).toBe(7);
    expect(l.medicion.camposOk + l.medicion.camposMal + l.medicion.camposNoMedidos).toBe(7);
    expect(l.modelo).toBe('modelo-x');
  });

  test('estado bad (la foto ni se descargó) = 7 SIN MEDIR con el motivo — no 7 errores', () => {
    const l = prepararLecturaDeFoto(entrada({
      estado: 'bad', detalle: 'Too many connections issued to the database', costoUsd: null,
    }), 'm');
    expect(l.medicion.camposNoMedidos).toBe(7);
    expect(l.medicion.camposMal).toBe(0);
    expect(l.motivo).toMatch(/Too many connections/);
    // costo null → 0 en la fila (CHECK NOT NULL) pero el motivo lo DICE.
    expect(l.costoUsd).toBe(0);
    expect(l.motivo).toMatch(/no significa gratis/);
  });

  test('sin turno (estado null) = 7 sin medir: la corrida nunca la mandó', () => {
    const l = prepararLecturaDeFoto(entrada({ estado: null }), 'm');
    expect(l.medicion.camposNoMedidos).toBe(7);
    expect(l.motivo).toMatch(/sin darle turno/);
  });

  test('interrumpida PERO con gasto = se mide: la evidencia manda sobre la sospecha', () => {
    const l = prepararLecturaDeFoto(entrada({
      estado: 'interrumpida',
      gasto: { img_hash: 'hash-1', monto: 850, fecha: null, folio: null, rfc_emisor: null, ocr_extra: null },
    }), 'm');
    expect(l.medicion.camposNoMedidos).toBe(0);
    expect(l.medicion.camposOk + l.medicion.camposMal).toBe(7);
  });

  test('ok sin gasto: el negativo rechazado sale 7 ok; el ticket rechazado sale con errores', () => {
    const negativo = foto({
      ocrEsperado: {
        ...VERDAD, clase: 'no_comprobante',
        emisor: null, rfcEmisor: null, folio: null, monto: null,
        fecha: null, sucursal: null, dominioFacturacion: null,
        noAplica: ['emisor', 'rfcEmisor', 'folio', 'monto', 'fecha', 'sucursal', 'dominioFacturacion'],
      },
    });
    const ln = prepararLecturaDeFoto(entrada({ foto: negativo }), 'm');
    expect(ln.medicion.camposOk).toBe(7);
    expect(ln.motivo).toMatch(/veredicto correcto/);

    const lt = prepararLecturaDeFoto(entrada({}), 'm');   // ticket, ok, sin gasto
    expect(lt.medicion.camposMal).toBe(7);
    expect(lt.motivo).toMatch(/estricto a propósito/);
  });

  test('sin verdad-de-terreno = 7 sin medir, y el motivo manda a etiquetar', () => {
    const l = prepararLecturaDeFoto(entrada({ foto: foto({ ocrEsperado: null }) }), 'm');
    expect(l.medicion.camposNoMedidos).toBe(7);
    expect(l.motivo).toMatch(/verdad-de-terreno/);
    expect(l.ocrLeido).toEqual(ocrVacio());
  });

  test('el huérfano del ticket tardío también es evidencia medible', () => {
    const l = prepararLecturaDeFoto(entrada({
      huerfanoLeido: {
        emisor: 'OXXO GAS', rfcEmisor: 'OGA123456AB1', folio: '000777', monto: 850,
        fecha: '2026-08-20', sucursal: 'Estación Silao', dominioFacturacion: 'factura.oxxogas.com',
      },
    }), 'm');
    expect(l.medicion.camposOk).toBe(7);
    expect(l.motivo).toMatch(/comprobante_huerfano/);
  });
});

// ── El guard de la evidencia borrada ────────────────────────────────────────

/** Doble mínimo: solo las consultas que `prepararMedicionCorrida` hace. */
function dbConTenant(vivo: boolean): SupabaseClient {
  const cadena = (datos: unknown) => {
    const b: Record<string, unknown> = {};
    const yo = () => b;
    b.select = yo; b.eq = yo; b.order = yo; b.limit = yo;
    b.maybeSingle = async () => ({ data: vivo ? { id: 't1' } : null, error: null });
    b.then = (res: (r: { data: unknown; error: null }) => void) => res({ data: datos, error: null });
    return b;
  };
  return {
    from: (tabla: string) => cadena(tabla === 'qa_foto' ? [] : []),
  } as unknown as SupabaseClient;
}

const corrida = (p: Partial<CorridaQA>): CorridaQA => ({
  id: 'c1', escenario: 'demo_guion', carril: 'completo',
  parametros: { anticipo: 1000, rfcEmpresa: null, ruta: { origen: 'A', destino: 'B' }, politica: [], fotoIds: [], retencion: 'conservar' },
  estado: 'parcial', motivo: null, tenantId: 't1', tenantNombre: 'ZZZ QA',
  creadaEn: '2026-08-28T20:00:00Z', inicio: null, fin: null, latidoEn: '2026-08-28T20:00:00Z',
  pasos: [], costoUsdTotal: 0, veredicto: null, turnos: [], pdfs: [], limpieza: null,
  fase: 'terminada', corte: null, pasadas: 1, pasadaEnVuelo: null, memoria: null, avance: null, ...p,
});

describe('prepararMedicionCorrida — falla cerrado', () => {
  test('sin tenant sembrado no hay nada que medir, y se dice', async () => {
    const r = await prepararMedicionCorrida(dbConTenant(true), corrida({ tenantId: null }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no llegó a sembrar/);
  });

  test('tenant ya limpiado: NO se mide — contar su ausencia como rechazos sería mentir con la suma cuadrada', async () => {
    const r = await prepararMedicionCorrida(dbConTenant(false), corrida({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ya se limpió/);
  });
});
