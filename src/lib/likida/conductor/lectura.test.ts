import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
const { aHitoApi, leerFiltrosHitos, validarCitas } = await import('./lectura');
const { hitoVacio } = await import('./memoria.fixture');

const url = (q: string) => `https://app.likida.ai/api/v1/hitos?${q}`;
const AHORA = new Date('2026-10-02T12:00:00Z');

describe('los filtros de GET /v1/hitos', () => {
  it('sin filtros → vacío', () => {
    expect(leerFiltrosHitos(url(''))).toEqual({ ok: {} });
  });

  it('acepta los válidos', () => {
    const r = leerFiltrosHitos(url('viajeId=4F1F6E2E-95C1-4C52-9F9E-3F6F6BD8D001&estado=escalado&tipo=regreso&folio=F-1&desde=2026-10-02T08:00:00-06:00'));
    expect(r).toEqual({ ok: { viajeId: '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001', estado: 'escalado', tipo: 'regreso', folio: 'F-1', desde: '2026-10-02T14:00:00.000Z' } });
  });

  it.each([
    'viajeId=no-es-uuid', 'estado=visto', 'tipo=inventado', 'folio=', `folio=${'x'.repeat(65)}`, 'desde=ayer', 'desde=2026-10-02',
    "estado=esperado' or 1=1", 'tipo=llegada_carga%27--',
  ])('rechaza «%s» con un error en palabras', (q) => {
    const r = leerFiltrosHitos(url(q));
    expect('error' in r && r.error.length > 10).toBe(true);
  });
});

describe('la forma pública del hito', () => {
  it('NO expone el texto que escribió el chofer ni la ruta de evidencia; sí contacto y coordenadas', () => {
    const h = hitoVacio({
      id: 'h1', tipo: 'llegada_carga', viajeId: 'v1', estado: 'recibido', fuente: 'texto', interpretacion: 'regla',
      mensajeEn: '2026-10-02T14:32:00Z', recibidoEn: '2026-10-02T14:32:05Z', contactoNombre: 'Juan', contactoArea: 'recibo',
      lat: 20.6, lng: -103.3, evidenciaRuta: 'pod/secreto.jpg',
    });
    const api = aHitoApi(h, 'F-1');
    expect(api).toMatchObject({
      folio: 'F-1', horaMensaje: '2026-10-02T14:32:00Z', recibidoEn: '2026-10-02T14:32:05Z',
      contacto: { nombre: 'Juan', area: 'recibo' }, coordenadas: { lat: 20.6, lng: -103.3 },
    });
    expect(JSON.stringify(api)).not.toContain('secreto');
    expect(Object.keys(api)).not.toContain('textoChofer');
    expect(Object.keys(api)).not.toContain('tenantId');
  });

  it('sin contacto ni coordenadas → null, no ceros', () => {
    const api = aHitoApi(hitoVacio({ id: 'h', tipo: 'regreso', viajeId: 'v' }), null);
    expect(api.contacto).toBeNull();
    expect(api.coordenadas).toBeNull();
    expect(api.folio).toBeNull();
  });
});

describe('PUT /v1/viajes/{id}/citas — validación', () => {
  it('acepta fechas ISO con zona y las normaliza a UTC; null borra', () => {
    expect(validarCitas({ citaOrigen: '2026-10-02T08:00:00-06:00', etaDestino: null }, AHORA)).toEqual({
      ok: { cita_origen_en: '2026-10-02T14:00:00.000Z', eta_destino_en: null },
    });
  });

  it('acepta las cuatro', () => {
    const v = validarCitas({
      citaOrigen: '2026-10-02T08:00:00Z', citaDestino: '2026-10-03T08:00:00Z', etaOrigen: '2026-10-02T09:00:00Z', etaDestino: '2026-10-03T09:00:00Z',
    }, AHORA);
    expect('ok' in v && Object.keys(v.ok)).toEqual(['cita_origen_en', 'cita_destino_en', 'eta_origen_en', 'eta_destino_en']);
  });

  it.each<[string, unknown]>([
    ['cuerpo vacío', {}],
    ['no es objeto', []],
    ['null', null],
    ['texto', 'x'],
    ['sin zona horaria', { citaOrigen: '2026-10-02T08:00:00' }],
    ['solo fecha', { citaOrigen: '2026-10-02' }],
    ['número', { citaOrigen: 1790000000 }],
    ['fecha imposible', { citaOrigen: '2026-13-45T08:00:00Z' }],
    ['demasiado vieja', { citaOrigen: '2025-01-01T08:00:00Z' }],
    ['demasiado lejana', { citaOrigen: '2030-01-01T08:00:00Z' }],
    ['llave desconocida solamente', { cita: '2026-10-02T08:00:00Z' }],
    ['inyección', { citaOrigen: "2026-10-02T08:00:00Z'; drop table viaje; --" }],
  ])('rechaza: %s', (_n, cuerpo) => {
    expect('error' in validarCitas(cuerpo, AHORA)).toBe(true);
  });

  it('ignora llaves ajenas junto a las válidas (no cambian de flota ni de columna)', () => {
    const v = validarCitas({ citaOrigen: '2026-10-02T08:00:00Z', tenant_id: 'otra', estatus: 'liquidado' }, AHORA);
    expect(v).toEqual({ ok: { cita_origen_en: '2026-10-02T08:00:00.000Z' } });
  });
});
