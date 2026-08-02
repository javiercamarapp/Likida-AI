import { describe, it, expect, vi, beforeEach } from 'vitest';
import { consultarCFDI } from './sat';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 9 · ALTO (fiscal) — "Un emisor solo PRESUNTO en el 69-B se declara
// 'lista negra' y tira la deducción entera".
//
// `sat.ts` mapeaba el código `ValidacionEFOS = '100'` directo a `efos: true`,
// que en `engine.ts` produce `cfdi_efos` → `NO_DEDUCIBLE_ISR`, el veredicto
// más duro que emite el motor (tinta roja, "lista negra del SAT"). El propio
// comentario del código admitía "presunto/definitivo (documentado)" en la
// misma línea que lo trataba como un solo estado.
//
// `normas/cff-69-B.yaml` (verificado_fuente_primaria) es explícito: el efecto
// de "no producen ni produjeron efecto fiscal alguno" es SOLO del listado
// DEFINITIVO (cuarto párrafo). El primer párrafo, el PRESUNTO, dice
// literalmente "se PRESUMIRÁ la inexistencia" — con derecho a desvirtuar en
// los plazos del propio artículo. `ConsultaCFDIService` no distingue las dos
// etapas en el código que devuelve, así que declarar fraude confirmado sobre
// un presunto es exactamente el "falso positivo" que este archivo dice, en su
// propio comentario, que es peor que un falso negativo.
//
// El producto YA tiene el estado correcto para "no concluyente":
// `efosDesconocido` → `cfdi_efos_indeterminado` → bandeja de revisión, SIN
// declarar fraude. Cualquier código que no sea limpio (200/201) cae ahí ahora,
// en vez de asumir "definitivo" sobre un código que no lo garantiza.
// ═══════════════════════════════════════════════════════════════════════════

const soap = (estado: string, validacionEfos?: string) => `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <ConsultaResponse>
      <ConsultaResult>
        <CodigoEstatus>Comprobante obtenido satisfactoriamente.</CodigoEstatus>
        <Estado>${estado}</Estado>
        ${validacionEfos ? `<ValidacionEFOS>${validacionEfos}</ValidacionEFOS>` : ''}
      </ConsultaResult>
    </ConsultaResponse>
  </s:Body>
</s:Envelope>`;

const Q = { re: 'PEM850101AAA', rr: 'TRA850101AB1', tt: 5800, id: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d' };

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });

describe('consultarCFDI — un presunto en el 69-B no es un definitivo', () => {
  it('código 100 (el que el propio comentario admite "presunto/definitivo") ya NO declara fraude confirmado', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, text: async () => soap('Vigente', '100'),
    });
    const r = await consultarCFDI(Q);
    expect(r.efos, 'un código que no distingue presunto de definitivo no puede afirmar fraude confirmado').not.toBe(true);
    expect(r.efosDesconocido, 'sigue siendo señal de "revisar", no de "no pasa nada"').toBe(true);
  });

  it('código 200 (limpio) sigue sin marcar nada — control', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, text: async () => soap('Vigente', '200'),
    });
    const r = await consultarCFDI(Q);
    expect(r.efos).toBe(false);
    expect(r.efosDesconocido).toBeFalsy();
  });

  it('código 201 (limpio, la otra forma) también sigue limpio — control', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, text: async () => soap('Vigente', '201'),
    });
    const r = await consultarCFDI(Q);
    expect(r.efos).toBe(false);
    expect(r.efosDesconocido).toBeFalsy();
  });

  it('un código que no es ninguno de los conocidos sigue yendo a indeterminado, no a limpio ni a fraude', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, text: async () => soap('Vigente', '999'),
    });
    const r = await consultarCFDI(Q);
    expect(r.efos).toBeNull();
    expect(r.efosDesconocido).toBe(true);
  });

  it('sin ValidacionEFOS en la respuesta, no se afirma nada (ni limpio ni indeterminado)', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, text: async () => soap('Vigente'),
    });
    const r = await consultarCFDI(Q);
    expect(r.efos).toBeNull();
    expect(r.efosDesconocido).toBeFalsy();
  });
});
