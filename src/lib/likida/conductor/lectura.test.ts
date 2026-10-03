import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
const { aHitoApi, leerFiltrosHitos, validarCambioConfig, validarCitas, MAX_CONTACTOS_TRAFICO } = await import('./lectura');
const { CONFIG_CONDUCTOR_DEFAULT } = await import('./config');
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

describe('PUT /v1/conductor/config — validación contra la config actual', () => {
  const actual = { ...CONFIG_CONDUCTOR_DEFAULT, solicitudesMin: [0, 15, 30, 45], diasSemana: [1, 2, 3, 4, 5, 6, 7] };
  const T = '38000000-0000-4000-8000-0000000000a5';

  it('se manda SOLO lo que cambia; lo demás queda como estaba', () => {
    const v = validarCambioConfig({ solicitudesMin: [0, 10, 20], horaInicio: 7 }, actual);
    expect('ok' in v && v.ok.config).toMatchObject({ solicitudesMin: [0, 10, 20], horaInicio: 7, horaFin: 22, escalarTrasMin: 90 });
    expect('ok' in v && v.ok.contactos).toBeUndefined();
  });

  it('valida la config ENTERA: cambiar solo la escalera no puede dejar la escalación antes del último recordatorio', () => {
    const v = validarCambioConfig({ solicitudesMin: [0, 60, 120] }, actual);
    expect('error' in v && v.error).toMatch(/DESPUÉS del último/);
  });

  it('una llave desconocida es 400 (un typo no deja a la flota con la escalera que creía haber cambiado)', () => {
    for (const cuerpo of [{ solicitudMin: [0] }, { tenant_id: 'otra' }, { activo: true, escalar: 5 }]) {
      const v = validarCambioConfig(cuerpo, actual);
      expect('error' in v && v.error).toMatch(/Llaves desconocidas/);
    }
  });

  it.each<[string, unknown]>([['vacío', {}], ['lista', []], ['null', null], ['texto', 'x']])('cuerpo inválido: %s', (_n, cuerpo) => {
    expect('error' in validarCambioConfig(cuerpo, actual)).toBe(true);
  });

  it('los valores fuera de rango se rechazan en palabras', () => {
    expect('error' in validarCambioConfig({ topeDiarioChofer: 0 }, actual)).toBe(true);
    expect('error' in validarCambioConfig({ horaInicio: 25 }, actual)).toBe(true);
    expect('error' in validarCambioConfig({ diasSemana: [] }, actual)).toBe(true);
  });

  it('contactos: normaliza el teléfono a 52+10, el nombre y la terminal', () => {
    const v = validarCambioConfig({ contactos: [
      { nivel: 1, nombre: '  Patio   Tlaquepaque ', telefono: '33 1234 5678', terminalId: T.toUpperCase() },
      { nivel: 2, nombre: 'Jefe general', telefono: '5215512345678' },
    ] }, actual);
    expect('ok' in v && v.ok.contactos).toEqual([
      { nivel: 1, nombre: 'Patio Tlaquepaque', telefono: '523312345678', terminalId: T },
      { nivel: 2, nombre: 'Jefe general', telefono: '525512345678', terminalId: null },
    ]);
  });

  it('una lista vacía de contactos es válida (los borra todos)', () => {
    const v = validarCambioConfig({ contactos: [] }, actual);
    expect('ok' in v && v.ok.contactos).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['nivel 3', [{ nivel: 3, nombre: 'X', telefono: '3312345678' }]],
    ['nivel como texto', [{ nivel: '1', nombre: 'X', telefono: '3312345678' }]],
    ['sin nombre', [{ nivel: 1, nombre: '  ', telefono: '3312345678' }]],
    ['nombre de 81', [{ nivel: 1, nombre: 'x'.repeat(81), telefono: '3312345678' }]],
    ['teléfono corto', [{ nivel: 1, nombre: 'X', telefono: '12345' }]],
    ['teléfono extranjero', [{ nivel: 1, nombre: 'X', telefono: '14155550100' }]],
    ['teléfono con letras', [{ nivel: 1, nombre: 'X', telefono: 'llámame' }]],
    ['terminal que no es uuid', [{ nivel: 1, nombre: 'X', telefono: '3312345678', terminalId: 'tlaquepaque' }]],
    ['repetido', [{ nivel: 1, nombre: 'A', telefono: '3312345678' }, { nivel: 1, nombre: 'B', telefono: '523312345678' }]],
    ['no es lista', { nivel: 1 }],
    ['elemento no es objeto', ['x']],
    ['demasiados', Array.from({ length: MAX_CONTACTOS_TRAFICO + 1 }, (_, i) => ({ nivel: 1, nombre: 'X', telefono: `331234${String(1000 + i)}` }))],
  ])('contactos inválidos: %s', (_n, contactos) => {
    expect('error' in validarCambioConfig({ contactos }, actual)).toBe(true);
  });

  it('el mismo teléfono en niveles o terminales distintos SÍ es válido', () => {
    const v = validarCambioConfig({ contactos: [
      { nivel: 1, nombre: 'A', telefono: '3312345678' }, { nivel: 2, nombre: 'A', telefono: '3312345678' },
      { nivel: 1, nombre: 'A', telefono: '3312345678', terminalId: T },
    ] }, actual);
    expect('ok' in v).toBe(true);
  });
});
