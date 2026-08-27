import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// FASE 6 — LOS RELOJES LEGALES. Lo que estas pruebas fijan:
//
//   1. Los TEXTOS legales dicen el paso en el ORDEN correcto (la sustitución
//      de CFDI al revés deja a la flota sin comprobante) y NUNCA incluyen un
//      teléfono sin verificar — un número equivocado en una emergencia es
//      peor que ninguno.
//   2. El clasificador de umbrales (30/7/0) es determinista y el vencido no
//      spamea: umbral 0 una vez, no un aviso diario a perpetuidad.
//   3. Los barridos avisan UNA vez (el sello después de mandar, nunca antes)
//      y un envío fallido se reintenta en la siguiente corrida.
// ═══════════════════════════════════════════════════════════════════════════

const sendText = vi.hoisted(() => vi.fn(async () => 'wamid.OK'));
const telefonoJefeDe = vi.hoisted(() => vi.fn(async () => '5210000000001'));
const telefonoParaDineroDe = vi.hoisted(() => vi.fn(async () => '5210000000002'));
const anotarEventoIncidencia = vi.hoisted(() => vi.fn(async () => 'anotado' as const));
const tablas = vi.hoisted(() => ({ respuestas: new Map<string, unknown[]>(), upserts: [] as Array<{ tabla: string; filas: unknown }> }));

vi.mock('@/lib/meta/client', () => ({ sendText }));
vi.mock('./contactos', () => ({ telefonoJefeDe, telefonoParaDineroDe }));
vi.mock('./asistencia_wa', () => ({ anotarEventoIncidencia }));
vi.mock('./presupuesto', () => ({ acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      // Builder encadenable que resuelve con la respuesta preparada para esa
      // tabla. `thenable` para que el await funcione en cualquier punto de la
      // cadena — el módulo encadena select/eq/in/gte/neq/lte/or/limit/maybeSingle.
      const respuesta = () => ({ data: tablas.respuestas.get(tabla) ?? [], error: null });
      const api: Record<string, unknown> = {
        upsert: (filas: unknown) => { tablas.upserts.push({ tabla, filas }); return Promise.resolve({ error: null }); },
        maybeSingle: () => Promise.resolve({ data: (tablas.respuestas.get(tabla) ?? [])[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve(respuesta()).then(res),
      };
      for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'neq', 'or', 'not', 'limit']) {
        api[m] = () => api;
      }
      return api;
    },
  }),
}));

const mod = await import('./relojes_legales');
const {
  AVISO_VALOR_MERCANCIA, mensajeSustitucionCfdi, mensajeRelojesMatpel, mensajeMultasReten,
  umbralCruzado, diasEntreIso, avisarVencimientos, avisarRelojesLegales,
} = mod;

beforeEach(() => {
  tablas.respuestas.clear();
  tablas.upserts.length = 0;
  sendText.mockClear();
  sendText.mockResolvedValue('wamid.OK');
  telefonoJefeDe.mockClear();
  telefonoJefeDe.mockResolvedValue('5210000000001');
  telefonoParaDineroDe.mockClear();
  anotarEventoIncidencia.mockClear();
});

describe('los textos legales', () => {
  it('la sustitución de CFDI dice TipoRelacion 04 ANTES que la cancelación motivo 01', () => {
    const m = mensajeSustitucionCfdi('V-123', 'F-9');
    expect(m.indexOf('TipoRelacion 04')).toBeGreaterThan(-1);
    expect(m.indexOf('motivo 01')).toBeGreaterThan(-1);
    // El ORDEN es la regla: cancelar primero rompe la relación.
    expect(m.indexOf('TipoRelacion 04')).toBeLessThan(m.indexOf('motivo 01'));
    expect(m).toContain('Likida no timbra ni cancela');
  });

  it('matpel trae los tres relojes con su plazo y SOLO teléfonos verificados', () => {
    const m = mensajeRelojesMatpel('V-123');
    expect(m).toMatch(/3 días hábiles/);
    expect(m).toMatch(/6 h/);
    expect(m).toMatch(/10 días naturales/);
    expect(m).toContain('800 002 1400');   // SETIQ, triple fuente
    expect(m).toContain('55 5128 0000');   // CENACOM
  });

  it('NINGÚN texto incluye los teléfonos sin verificar (088, 078, 800 de PROFEPA)', () => {
    // Un teléfono equivocado en una emergencia es peor que ninguno. Los tres
    // del plan quedaron explícitamente FUERA hasta confirmarse por teléfono.
    const todos = [
      AVISO_VALOR_MERCANCIA.cuerpo,
      mensajeSustitucionCfdi('V', 'F'),
      mensajeRelojesMatpel('V'),
      mensajeMultasReten('V'),
    ].join(' ');
    expect(todos).not.toMatch(/\b088\b/);
    expect(todos).not.toMatch(/\b078\b/);
    expect(todos).not.toMatch(/PROFEPA[^.]*\b800\b/);
  });

  it('el aviso de ValorMercancia dice la cifra y confiesa que no hay ficha verificada', () => {
    expect(AVISO_VALOR_MERCANCIA.cuerpo).toContain('$1,759.65');
    expect(AVISO_VALOR_MERCANCIA.fundamento).toMatch(/sin ficha verificada/);
  });

  it('las multas dicen los dos descuentos y el art. 76', () => {
    const m = mensajeMultasReten(null);
    expect(m).toMatch(/−25%.*−25%/s);
    expect(m).toMatch(/15 días hábiles/);
    expect(m).toMatch(/art\. 76/i);
    expect(m).toMatch(/revocar el permiso/);
  });
});

describe('umbralCruzado — el clasificador de 30/7/0', () => {
  it('clasifica cada franja y el lejano no avisa', () => {
    expect(umbralCruzado(45)).toBeNull();
    expect(umbralCruzado(30)).toBe(30);
    expect(umbralCruzado(15)).toBe(30);
    expect(umbralCruzado(7)).toBe(7);
    expect(umbralCruzado(3)).toBe(7);
    expect(umbralCruzado(0)).toBe(0);
  });

  it('vencido hace días sigue siendo umbral 0 — un aviso, no spam diario', () => {
    expect(umbralCruzado(-1)).toBe(0);
    expect(umbralCruzado(-90)).toBe(0);
  });

  it('diasEntreIso no se corre por husos', () => {
    expect(diasEntreIso('2026-08-26', '2026-09-02')).toBe(7);
    expect(diasEntreIso('2026-08-26', '2026-08-26')).toBe(0);
    expect(diasEntreIso('2026-08-26', '2026-08-20')).toBe(-6);
  });
});

describe('avisarVencimientos — un aviso por umbral, sellado después de mandar', () => {
  const AHORA = new Date('2026-08-26T18:00:00Z'); // hoyMx = 2026-08-26

  it('agrupa los vencimientos de una flota en UN mensaje y sella tras mandar', async () => {
    tablas.respuestas.set('unidad', [
      { id: 'u1', tenant_id: 't1', numero_economico: 'C2-08', poliza_vence: '2026-09-01', permiso_sict_vence: null, verificacion_vence: '2026-08-20' },
    ]);
    tablas.respuestas.set('operador', [
      { id: 'o1', tenant_id: 't1', nombre: 'Juan', licencia_vence: '2026-08-30' },
    ]);
    tablas.respuestas.set('flota_poliza', []);
    tablas.respuestas.set('aviso_vigencia', []);

    const r = await avisarVencimientos(AHORA);
    expect(r.candidatos).toBe(3);
    expect(r.avisados).toBe(3);
    expect(sendText).toHaveBeenCalledTimes(1); // UNA lista, no tres WhatsApps
    const texto = (sendText.mock.calls[0] as unknown as [string, string])[1];
    expect(texto).toContain('C2-08');
    expect(texto).toContain('VENCIÓ');       // la verificación del 20-ago ya venció
    expect(texto).toContain('Juan');
    // El sello, con umbral y fecha en la llave.
    expect(tablas.upserts.filter((u) => u.tabla === 'aviso_vigencia')).toHaveLength(1);
  });

  it('lo ya sellado NO se re-avisa', async () => {
    tablas.respuestas.set('unidad', [
      { id: 'u1', tenant_id: 't1', numero_economico: 'C2-08', poliza_vence: '2026-09-01', permiso_sict_vence: null, verificacion_vence: null },
    ]);
    tablas.respuestas.set('operador', []);
    tablas.respuestas.set('flota_poliza', []);
    tablas.respuestas.set('aviso_vigencia', [
      { tenant_id: 't1', objeto: 'unidad', objeto_id: 'u1', documento: 'poliza', umbral: 7, vence: '2026-09-01' },
    ]);

    const r = await avisarVencimientos(AHORA);
    expect(r.avisados).toBe(0);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('si el WhatsApp NO sale, no se sella — la siguiente corrida reintenta', async () => {
    sendText.mockResolvedValueOnce(null as never);
    tablas.respuestas.set('unidad', [
      { id: 'u1', tenant_id: 't1', numero_economico: 'C2-08', poliza_vence: '2026-09-01', permiso_sict_vence: null, verificacion_vence: null },
    ]);
    tablas.respuestas.set('operador', []);
    tablas.respuestas.set('flota_poliza', []);
    tablas.respuestas.set('aviso_vigencia', []);

    const r = await avisarVencimientos(AHORA);
    expect(r.avisados).toBe(0);
    expect(r.fallos).toBe(1);
    expect(tablas.upserts.filter((u) => u.tabla === 'aviso_vigencia')).toHaveLength(0);
  });

  it('sin teléfono de jefe no se manda a nadie — y cuenta como fallo visible', async () => {
    telefonoJefeDe.mockResolvedValueOnce(null as never);
    tablas.respuestas.set('unidad', [
      { id: 'u1', tenant_id: 't1', numero_economico: 'C2-08', poliza_vence: '2026-09-01', permiso_sict_vence: null, verificacion_vence: null },
    ]);
    tablas.respuestas.set('operador', []);
    tablas.respuestas.set('flota_poliza', []);
    tablas.respuestas.set('aviso_vigencia', []);

    const r = await avisarVencimientos(AHORA);
    expect(r.fallos).toBe(1);
    expect(sendText).not.toHaveBeenCalled();
  });
});

describe('avisarRelojesLegales — los relojes colgados de una incidencia', () => {
  const inc = (tipo: string, sobre: Partial<Record<string, unknown>> = {}) => ({
    id: 'i1', tenant_id: 't1', tipo, viaje_id: 'v1', ...sobre,
  });

  it('siniestro con factura timbrada → sustitución al canal de DINERO, y sella', async () => {
    tablas.respuestas.set('incidencia', [inc('siniestro')]);
    tablas.respuestas.set('incidencia_evento', []);
    tablas.respuestas.set('viaje', [{ folio: 'V-9' }]);
    tablas.respuestas.set('factura_emitida', [{ folio: 'F-1', cfdi_uuid: 'uuid-1' }]);
    tablas.respuestas.set('tenant', [{ perfil: {} }]); // sin hazmat declarado

    const r = await avisarRelojesLegales(new Date('2026-08-26T18:00:00Z'));
    expect(r.avisadas).toBe(1);
    expect(telefonoParaDineroDe).toHaveBeenCalledWith('t1');
    const texto = (sendText.mock.calls[0] as unknown as [string, string])[1];
    expect(texto).toContain('TipoRelacion 04');
    expect(anotarEventoIncidencia).toHaveBeenCalledWith('t1', 'i1', 'reloj_legal_avisado', expect.anything());
  });

  it('siniestro SIN factura y SIN hazmat: nada que avisar — sella con la razón, sin WhatsApp', async () => {
    tablas.respuestas.set('incidencia', [inc('siniestro')]);
    tablas.respuestas.set('incidencia_evento', []);
    tablas.respuestas.set('viaje', [{ folio: 'V-9' }]);
    tablas.respuestas.set('factura_emitida', []);
    tablas.respuestas.set('factura_viaje', []);
    tablas.respuestas.set('tenant', [{ perfil: {} }]);

    const r = await avisarRelojesLegales(new Date('2026-08-26T18:00:00Z'));
    expect(r.avisadas).toBe(0);
    expect(sendText).not.toHaveBeenCalled();
    expect(anotarEventoIncidencia).toHaveBeenCalledWith('t1', 'i1', 'reloj_legal_avisado', { aviso: 'sin_relojes_aplicables' });
  });

  it('la flota que declaró hazmat recibe los relojes matpel por el canal del JEFE', async () => {
    tablas.respuestas.set('incidencia', [inc('siniestro')]);
    tablas.respuestas.set('incidencia_evento', []);
    tablas.respuestas.set('viaje', [{ folio: 'V-9' }]);
    tablas.respuestas.set('factura_emitida', []);
    tablas.respuestas.set('factura_viaje', []);
    // El perfil con procedencia declarada — la forma real de un CampoPerfil.
    tablas.respuestas.set('tenant', [{ perfil: { hazmat: { valor: true, procedencia: 'declarado' } } }]);

    const r = await avisarRelojesLegales(new Date('2026-08-26T18:00:00Z'));
    expect(r.avisadas).toBe(1);
    expect(telefonoJefeDe).toHaveBeenCalledWith('t1');
    const texto = (sendText.mock.calls[0] as unknown as [string, string])[1];
    expect(texto).toContain('800 002 1400');
  });

  it('bloqueo/retén → la información de multas al jefe', async () => {
    tablas.respuestas.set('incidencia', [inc('bloqueo')]);
    tablas.respuestas.set('incidencia_evento', []);
    tablas.respuestas.set('viaje', [{ folio: 'V-9' }]);

    const r = await avisarRelojesLegales(new Date('2026-08-26T18:00:00Z'));
    expect(r.avisadas).toBe(1);
    const texto = (sendText.mock.calls[0] as unknown as [string, string])[1];
    expect(texto).toMatch(/art\. 76/i);
  });

  it('una incidencia ya sellada no vuelve a avisar', async () => {
    tablas.respuestas.set('incidencia', [inc('bloqueo')]);
    tablas.respuestas.set('incidencia_evento', [{ id: 'e1' }]); // el sello existe

    const r = await avisarRelojesLegales(new Date('2026-08-26T18:00:00Z'));
    expect(r.avisadas).toBe(0);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('si el aviso no llega a nadie, NO se sella — reintento en la siguiente corrida', async () => {
    sendText.mockResolvedValue(null as never);
    tablas.respuestas.set('incidencia', [inc('bloqueo')]);
    tablas.respuestas.set('incidencia_evento', []);
    tablas.respuestas.set('viaje', [{ folio: 'V-9' }]);

    const r = await avisarRelojesLegales(new Date('2026-08-26T18:00:00Z'));
    expect(r.avisadas).toBe(0);
    expect(anotarEventoIncidencia).not.toHaveBeenCalled();
  });
});
