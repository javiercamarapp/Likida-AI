import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 32 · c15 — OPE-32C15-C1 y OPE-32C15-C2 (los dos CRÍTICOS).
//
// LA RUTA SaaS NUNCA SE CABLEÓ AL CANAL DEL OPERADOR. El trabajo de OP-A2/OP-P5
// cableó `carta_porte_timbre.ts` (6 llamadas a `alertarOperador`) y dejó fuera
// todo `src/lib/saas/`, que es por donde Likida se factura a sí misma a la
// flota. Los dos sitios tenían un `logger.error` y nada más:
//
//  1. `facturapi.ts` — el PAC devolvió un total distinto al que se cobró. El
//     comentario del propio archivo declara el requisito TEMPORAL («alguien
//     tiene que enterarse hoy —hay 24h de plazo cómodo para cancelar»), y el
//     log no lo cumple: a las 3 a.m. el único camino era Sentry, cuyo
//     `fingerprint` para este meta es `['facturapi.total_no_cuadra','error']`
//     —`discriminadores` solo lee `tenant`/`tenantId` y `codigo`/`status`—, así
//     que el SEGUNDO incidente, y el de la flota siguiente, caen en el issue
//     viejo y nadie los ve.
//
//  2. `transferencia.ts` — el PAC timbró y el UUID no se pudo guardar. Es
//     textualmente el escenario que `alerta.ts` documenta como OP-A2: un CFDI
//     vivo ante el SAT que Likida no puede nombrar desde sus propios registros.
//
// POR QUÉ EL `uuid` VA COMO LLAVE APARTE Y NO DENTRO DEL TEXTO. Ese es el
// defecto que la auditoría 24 ancló (M17/PRU-A3): `redactarTexto` huella
// cualquier UUID del cuerpo, y el carve-out por texto
// (`EVENTOS_CON_FOLIO_FISCAL`) solo cubre `^timbre\.`. Una llave de primer
// nivel llamada `uuid` está en `LLAVES_SIN_REDACTAR` y sobrevive sea cual sea
// el evento — es el único camino que conserva el folio en la ruta SaaS.
//
// Y POR QUÉ EL EVENTO EMPIEZA CON `finanzas.`: `EVENTOS_DE_DINERO` lo incluye,
// así que además del correo suena el WhatsApp del operador. Con el prefijo
// `facturapi.` el evento no es "de dinero" y se queda sin ese canal.
//
// Las dos pruebas fallan sin el arreglo: hoy `alertarOperador` no se llama ni
// una vez en ninguno de los dos archivos (`grep -c` → 0 en ambos).
// ═══════════════════════════════════════════════════════════════════════════

const alertarOperador = vi.fn(async (..._a: unknown[]) => true);
vi.mock('@/lib/observability/alerta', () => ({
  alertarOperador: (...a: unknown[]) => alertarOperador(...a),
}));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger, redactarTexto: (s: string) => s }));

const UUID_CFDI = '33ab7e19-c0d1-4f2a-9b77-0e5c1a2b3c4d';

const RECEPTOR = {
  rfc: 'GMX0902279I1',
  razonSocial: 'FLOTA DEMO SA DE CV',
  regimenFiscal: '601',
  codigoPostal: '45615',
  usoCfdi: 'G03',
};

beforeEach(() => { alertarOperador.mockClear(); logger.error.mockClear(); });
afterEach(() => { delete process.env.FACTURAPI_SECRET_KEY; vi.restoreAllMocks(); });

describe('OPE-32C15-C1 · el total del PAC que no cuadra tiene que SALIR, no solo loguearse', () => {
  it('timbra $4,640 habiendo cobrado $4,176 → alerta al operador con el folio ÍNTEGRO', async () => {
    process.env.FACTURAPI_SECRET_KEY = 'sk_live_abc';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ id: 'inv_1', uuid: UUID_CFDI, total: 4640 }), { status: 200 },
    )));

    const { timbrarMensualidad } = await import('./facturapi');
    await timbrarMensualidad({
      receptor: RECEPTOR, subtotal: 3600, totalEsperado: 4176,
      periodoInicio: '2026-10-01', periodoFin: '2026-10-31', referencia: 'LK33AB202610',
    });

    // El log sigue, no se toca: lo que faltaba era que ADEMÁS llegue.
    expect(logger.error).toHaveBeenCalledWith('facturapi.total_no_cuadra', expect.anything());

    expect(alertarOperador).toHaveBeenCalledTimes(1);
    const [evento, detalle] = alertarOperador.mock.calls[0] as [string, Record<string, unknown>];

    // `finanzas.` está en EVENTOS_DE_DINERO: correo Y WhatsApp.
    expect(evento).toMatch(/^finanzas\./);
    // El folio, como llave aparte — la única forma de que sobreviva al redactor.
    expect(detalle.uuid).toBe(UUID_CFDI);
    // Y las dos cifras que hacen accionable la alerta dentro de las 24 h.
    expect(String(detalle.error)).toContain('4640');
    expect(String(detalle.error)).toContain('4176');
  });

  it('cuando el total CUADRA no despierta a nadie', async () => {
    process.env.FACTURAPI_SECRET_KEY = 'sk_live_abc';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ id: 'inv_2', uuid: UUID_CFDI, total: 4176 }), { status: 200 },
    )));

    const { timbrarMensualidad } = await import('./facturapi');
    await timbrarMensualidad({
      receptor: RECEPTOR, subtotal: 3600, totalEsperado: 4176,
      periodoInicio: '2026-10-01', periodoFin: '2026-10-31',
    });

    expect(alertarOperador).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
