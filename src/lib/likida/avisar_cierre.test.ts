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

const { sendText, sendDocument, telefonoParaDineroDe } = vi.hoisted(() => ({
  sendText: vi.fn(),
  sendDocument: vi.fn(),
  telefonoParaDineroDe: vi.fn(),
}));

vi.mock('@/lib/meta/client', () => ({ sendText, sendDocument }));
vi.mock('./contactos', () => ({ telefonoParaDineroDe }));

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
  telefonoParaDineroDe.mockReset();
  telefonoParaDineroDe.mockResolvedValue(TEL);
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
    telefonoParaDineroDe.mockResolvedValue(null);
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

  // AUDITORÍA 21 (agéntico, ALTO): antes el fallo del texto hacía `return`
  // ANTES del bloque del PDF, y el jefe se quedaba sin texto Y sin el
  // documento que ya estaba firmado — contradiciendo el encabezado del
  // archivo ("el PDF siempre, el texto solo si hay que decidir"). Estas dos
  // pruebas fijan el contrato correcto: son escrituras independientes.
  it('EL HALLAZGO (aud. 21): WhatsApp rechaza el TEXTO → el PDF se manda de todos modos', async () => {
    liq = { data: { total_comprobado: 900, total_anticipo: 1000, diferencia: 100, diferencias: [] }, error: null };
    sendText.mockResolvedValue(null);
    const r = await avisarCierreAlJefe({ tenantId: 't-1', viajeId: 'v-1', urlPdf: URL_PDF });
    // El fallo del texto se sigue reportando, para que el llamador loguee...
    expect(r).toEqual({ enviado: false, motivo: 'WhatsApp no aceptó el mensaje al jefe.' });
    // ...pero el documento que YA estaba listo se intentó igual.
    expect(sendDocument).toHaveBeenCalledTimes(1);
  });

  it('texto rechazado y sin urlPdf: solo se reporta el fallo del texto, sin intentar documento', async () => {
    liq = { data: { total_comprobado: 900, total_anticipo: 1000, diferencia: 100, diferencias: [] }, error: null };
    sendText.mockResolvedValue(null);
    const r = await avisarCierreAlJefe({ tenantId: 't-1', viajeId: 'v-1' });
    expect(r).toEqual({ enviado: false, motivo: 'WhatsApp no aceptó el mensaje al jefe.' });
    expect(sendDocument).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18, ALTO (A28): el cierre salía al ENCARGADO, el rol que no ve
// dinero. `ORDEN_AVISO` (despacho) ponía al encargado primero y el cierre lo
// reusaba. El destinatario del cierre tiene que ver `dinero` en la matriz
// real de `visibilidad.ts` — se comprueba contra ella, no contra una copia.
// ═══════════════════════════════════════════════════════════════════════════
describe('avisarCierreAlJefe · a quién le llega el dinero', () => {
  it('todo rol de ORDEN_AVISO_DINERO ve dinero en visibilidad.ts, y el encargado NO está', async () => {
    const { ORDEN_AVISO_DINERO } = await vi.importActual<typeof import('./contactos')>('./contactos');
    const { puedeVerArea } = await import('@/lib/auth/visibilidad');
    expect(ORDEN_AVISO_DINERO.length).toBeGreaterThan(0);
    for (const rol of ORDEN_AVISO_DINERO) expect(puedeVerArea(rol, 'dinero'), `${rol} no ve dinero`).toBe(true);
    expect(ORDEN_AVISO_DINERO).not.toContain('encargado');
  });

  it('el cierre resuelve el teléfono por telefonoParaDineroDe, no por el orden de despacho', async () => {
    await avisarCierreAlJefe({ tenantId: 't-1', viajeId: 'v-1', urlPdf: URL_PDF });
    expect(telefonoParaDineroDe).toHaveBeenCalledWith('t-1');
  });
});
