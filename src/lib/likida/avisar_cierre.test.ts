import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO DE CIERRE AL JEFE — sin una sola prueba hasta hoy.
//
// AUDITORÍA 10 · BACKEND. `sendDocument` dejó de LANZAR (`meta/client.ts`,
// misma ronda): desde hoy devuelve `{ok:false, error, codigo}` en vez de la
// excepción que el `try/catch` de `avisarCierreAlJefe` esperaba atrapar. El
// propio comentario de ese cambio lo dice: "los dos call sites viven en
// archivos de otros agentes... queda pendiente que esos dos la usen" — este
// era uno de los dos (el otro es `processor.ts:2003`, fuera de este archivo).
//
// Sin este archivo de pruebas, un PDF rechazado por Meta pasaba SIN un solo
// log: el `catch` nunca se disparaba, y `avisarCierreAlJefe` seguía
// devolviendo `enviado: true` sobre el documento que el jefe archiva para su
// contador y que nunca llegó. El primer test de este archivo reproduce
// exactamente ese caso.
// ═══════════════════════════════════════════════════════════════════════════

const { sendText, sendDocument, telefonoJefeDe } = vi.hoisted(() => ({
  sendText: vi.fn(),
  sendDocument: vi.fn(),
  telefonoJefeDe: vi.fn(),
}));

vi.mock('@/lib/meta/client', () => ({ sendText, sendDocument }));
vi.mock('./contactos', () => ({ telefonoJefeDe }));

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

// ── La base: `resumenDeCierre` lee `liquidacion` y `viaje` en paralelo ──────
let liq: { data: Record<string, unknown> | null; error: { message: string } | null };
let viaje: { data: Record<string, unknown> | null; error: { message: string } | null };

function cadena(resultado: () => { data: unknown; error: unknown }) {
  const nodo: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit']) {
    nodo[m] = () => nodo;
  }
  nodo.maybeSingle = () => Promise.resolve(resultado());
  return nodo;
}

const from = vi.fn((tabla: string) => ({
  select: () => cadena(() => (tabla === 'liquidacion' ? liq : viaje)),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [string])) }),
}));

const { avisarCierreAlJefe } = await import('./avisar_cierre');

const TEL = '5215500001111';
const URL_PDF = 'https://x.supabase.co/storage/liq-firmada.pdf';

beforeEach(() => {
  // Cuadrado exacto: `armarAvisoJefe` decide `requiereDecision: false` con
  // esto, así que por default SOLO se manda el PDF — el camino que aísla el
  // bug del texto que también se manda.
  liq = { data: { total_comprobado: 1000, total_anticipo: 1000, diferencia: 0, diferencias: [] }, error: null };
  viaje = { data: { folio: 'F-1', operador: { nombre: 'Juan' } }, error: null };
  telefonoJefeDe.mockReset();
  telefonoJefeDe.mockResolvedValue(TEL);
  sendText.mockReset();
  sendText.mockResolvedValue('wamid.texto');
  sendDocument.mockReset();
  sendDocument.mockResolvedValue({ ok: true, id: 'wamid.pdf' });
  for (const f of Object.values(logger)) f.mockReset();
});

describe('avisarCierreAlJefe · el PDF, tras el cambio de contrato de `sendDocument`', () => {
  it('EL HALLAZGO: Meta rechaza el PDF (`{ok:false}`) → se loguea, antes pasaba en silencio', async () => {
    sendDocument.mockResolvedValue({ ok: false, error: 'Rate limit alcanzado', codigo: 131056 });

    const r = await avisarCierreAlJefe({ tenantId: 't-1', viajeId: 'v-1', urlPdf: URL_PDF });

    expect(sendDocument).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('cierre.pdf_al_jefe_falló', {
      viaje: 'v-1', err: 'Rate limit alcanzado',
    });
    // Se conserva A PROPÓSITO: perder el adjunto no debe borrar el aviso de
    // texto que ya haya salido (ver el comentario del archivo). El arreglo es
    // que el fallo se DETECTE y se DIGA, no que tumbe el resultado.
    expect(r.enviado).toBe(true);
  });

  it('con el PDF aceptado no hay ningún warning', async () => {
    await avisarCierreAlJefe({ tenantId: 't-1', viajeId: 'v-1', urlPdf: URL_PDF });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('una excepción de verdad (no un `{ok:false}`) la sigue atrapando el try/catch', async () => {
    sendDocument.mockRejectedValue(new Error('boom de red'));
    const r = await avisarCierreAlJefe({ tenantId: 't-1', viajeId: 'v-1', urlPdf: URL_PDF });
    expect(logger.warn).toHaveBeenCalledWith('cierre.pdf_al_jefe_falló', { viaje: 'v-1', err: 'boom de red' });
    expect(r.enviado).toBe(true);
  });

  it('sin `urlPdf` no se intenta ningún envío de documento', async () => {
    await avisarCierreAlJefe({ tenantId: 't-1', viajeId: 'v-1' });
    expect(sendDocument).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('avisarCierreAlJefe · lo básico', () => {
  it('sin teléfono de jefe no manda nada y lo dice', async () => {
    telefonoJefeDe.mockResolvedValue(null);
    const r = await avisarCierreAlJefe({ tenantId: 't-1', viajeId: 'v-1', urlPdf: URL_PDF });
    expect(r).toEqual({ enviado: false, motivo: 'Esa flota no tiene un teléfono de oficina registrado.' });
    expect(sendText).not.toHaveBeenCalled();
    expect(sendDocument).not.toHaveBeenCalled();
  });

  it('sin liquidación encontrada no manda nada', async () => {
    liq = { data: null, error: null };
    const r = await avisarCierreAlJefe({ tenantId: 't-1', viajeId: 'v-1', urlPdf: URL_PDF });
    expect(r).toEqual({ enviado: false, motivo: 'No se encontró la liquidación cerrada.' });
  });

  it('un error de la base al leer la liquidación NO se traga: lanza', async () => {
    liq = { data: null, error: { message: 'timeout' } };
    await expect(avisarCierreAlJefe({ tenantId: 't-1', viajeId: 'v-1' })).rejects.toThrow(/timeout/);
  });

  it('con diferencia real manda el TEXTO y el PDF, los dos', async () => {
    liq = { data: { total_comprobado: 900, total_anticipo: 1000, diferencia: 100, diferencias: [] }, error: null };
    const r = await avisarCierreAlJefe({ tenantId: 't-1', viajeId: 'v-1', urlPdf: URL_PDF });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendDocument).toHaveBeenCalledTimes(1);
    expect(r.enviado).toBe(true);
  });

  it('si WhatsApp rechaza el TEXTO, no se intenta el PDF y se dice por qué', async () => {
    liq = { data: { total_comprobado: 900, total_anticipo: 1000, diferencia: 100, diferencias: [] }, error: null };
    sendText.mockResolvedValue(null);
    const r = await avisarCierreAlJefe({ tenantId: 't-1', viajeId: 'v-1', urlPdf: URL_PDF });
    expect(r).toEqual({ enviado: false, motivo: 'WhatsApp no aceptó el mensaje al jefe.' });
    expect(sendDocument).not.toHaveBeenCalled();
  });
});
