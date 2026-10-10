import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PLANTILLAS_ID, CATALOGO, validarParams, fraseDe, type PlantillaId, type ParamsCualquiera } from './catalogo';

// ═══════════════════════════════════════════════════════════════════════════
// LAS 10 PLANTILLAS DE REGLA, UNA POR UNA, HASTA EL MENSAJE QUE SALE A META.
//
// `lectores.test.ts` prueba cada lector y `catalogo.test.ts` el catálogo; lo que
// faltaba (auditoría 6-7-9-10-12-13, §6) era afirmar, plantilla por plantilla,
// que el AVISO sale por el selector `enviarConFallback` —texto con la ventana de
// 24 h abierta, plantilla `regla_aviso_v1` con ella cerrada— al destinatario de
// SU canal (dinero vs operación), citando la frase que la persona CONFIRMÓ. Aquí
// corre el selector REAL; solo Meta, el registro de ventana, la base (repo) y el
// lector están sustituidos.
// ═══════════════════════════════════════════════════════════════════════════

const meta = vi.hoisted(() => ({ enviarTexto: vi.fn(), enviarBotones: vi.fn(), sendTemplate: vi.fn() }));
const ventana = vi.hoisted(() => ({ estado: 'cerrada' as 'abierta' | 'cerrada' }));
const evaluar = vi.hoisted(() => vi.fn());
const reglasActivas = vi.hoisted(() => vi.fn());
const registrados = vi.hoisted(() => [] as unknown[]);

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.likida.ai' }));
vi.mock('@/lib/likida/wa_ventana', () => ({
  ventanaDeContacto: async () => ({ estado: ventana.estado }),
  registrarDecisionEnvio: async () => {},
}));
vi.mock('@/lib/meta/client', () => ({
  enviarTexto: (...a: unknown[]) => meta.enviarTexto(...a),
  enviarBotones: (...a: unknown[]) => meta.enviarBotones(...a),
  sendTemplate: (...a: unknown[]) => meta.sendTemplate(...a),
  esReintentableMeta: () => false,
  motivoDeFalloWhatsApp: (e: string) => e,
}));
vi.mock('../contactos', () => ({
  telefonoJefeDe: async () => '5219990000001',
  telefonoParaDineroDe: async () => '5219990000002',
}));
vi.mock('./lectores', () => ({ evaluar }));
vi.mock('./repo', () => ({
  reglasActivas,
  sellosDe: async () => new Set<string>(),
  sellarDisparos: async () => {},
  reclamarDisparos: async () => ({ modo: 'sin_rpc' as const }),
  confirmarDisparos: async () => 1,
  liberarDisparos: async () => {},
  anotarCorrida: async () => {},
  avisosEnviadosDesde: async () => [],
  registrarAviso: async (...a: unknown[]) => { registrados.push(a); },
  purgarAvisosViejos: async () => 0,
  llaveSello: (d: { objeto: string; objetoId: string; clave: string }) => `${d.objeto}|${d.objetoId}|${d.clave}`,
}));

const { vigilarReglas } = await import('./vigilante');

/** Parámetros válidos por plantilla (los que la pantalla produce al elegirla a mano). */
const PARAMS: Record<PlantillaId, unknown> = {
  unidad_sin_papel_vigente_al_despachar: { documento: 'poliza' },
  gasto_de_concepto_mayor_a: { concepto: 'caseta', monto: 3000 },
  gasto_sin_cfdi_mayor_a: { monto: 2500 },
  chofer_con_viajes_sin_liquidar: { n: 3 },
  documento_por_vencer: { documento: 'licencia', dias: 15 },
  factura_sin_cobrar_mas_de: { dias: 30 },
  estadia_mayor_a: { horas: 4 },
  incidencia_abierta_mas_de: { horas: 12 },
  viaje_abierto_sin_comprobantes_mas_de: { dias: 5 },
  costo_ia_dia_mayor_a: { usd: 20 },
};

const AHORA = new Date('2026-10-02T15:00:00Z');

function reglaDe(id: PlantillaId) {
  const v = validarParams(id, PARAMS[id]);
  if (!v.ok) throw new Error(`${id}: ${v.error}`);
  return {
    id: `r-${id}`, tenantId: 't-1', plantilla: id, params: v.params as ParamsCualquiera,
    textoOriginal: 'x', frase: fraseDe(id, v.params as ParamsCualquiera), estado: 'activa' as const,
    creadaEn: '2026-09-01T00:00:00Z', confirmadaEn: '2026-09-01T00:01:00Z',
    ultimaCorridaEn: null, ultimoDisparoEn: null, modelo: null, maxAvisosDia: 4, minHorasEntreAvisos: 1,
  };
}

beforeEach(() => {
  ventana.estado = 'cerrada';
  registrados.length = 0;
  for (const m of Object.values(meta)) m.mockReset().mockResolvedValue({ ok: true, id: 'wamid.OK' });
  evaluar.mockReset().mockResolvedValue([{ objeto: 'viaje', objetoId: 'x-1', clave: '', evidencia: 'caso de prueba medido' }]);
});

describe('las 10 plantillas de regla, hasta el aviso', () => {
  it('el catálogo tiene exactamente diez y cada una trae parámetros de prueba válidos', () => {
    expect(PLANTILLAS_ID).toHaveLength(10);
    for (const id of PLANTILLAS_ID) expect(validarParams(id, PARAMS[id]).ok, id).toBe(true);
  });

  it.each([...PLANTILLAS_ID])('%s — ventana CERRADA: sale la plantilla regla_aviso_v1 con frase confirmada, al destinatario de su canal', async (id) => {
    reglasActivas.mockResolvedValue([reglaDe(id)]);
    const r = await vigilarReglas(AHORA);
    expect(r).toMatchObject({ reglas: 1, disparadas: 1, avisos: 1, fallos: 0 });
    expect(meta.enviarTexto).not.toHaveBeenCalled();
    expect(meta.sendTemplate).toHaveBeenCalledTimes(1);
    const [telefono, nombre, opciones] = meta.sendTemplate.mock.calls[0] as [string, string, { parametros: string[] }];
    expect(nombre).toBe('regla_aviso_v1');
    expect(telefono).toBe(CATALOGO[id].canal === 'dinero' ? '5219990000002' : '5219990000001');
    expect(opciones.parametros).toHaveLength(3);
    expect(opciones.parametros[0]).toBe('1');
    // La frase de la plantilla es la que armó el catálogo (recortada a 120), no prosa de un modelo.
    expect(fraseDe(id, reglaDe(id).params).startsWith(opciones.parametros[1].replace(/…$/, ''))).toBe(true);
    expect(opciones.parametros[2]).toBe('https://app.likida.ai/dashboard/reglas');
    expect(registrados[0]).toEqual(['t-1', `r-${id}`, expect.objectContaining({ resultado: 'enviado', via: 'plantilla' })]);
  });

  it.each([...PLANTILLAS_ID])('%s — ventana ABIERTA: sale el texto completo con la frase y la evidencia, sin plantilla', async (id) => {
    ventana.estado = 'abierta';
    reglasActivas.mockResolvedValue([reglaDe(id)]);
    await vigilarReglas(AHORA);
    expect(meta.sendTemplate).not.toHaveBeenCalled();
    const texto = meta.enviarTexto.mock.calls[0][1] as string;
    expect(texto).toContain(`Tu regla: ${fraseDe(id, reglaDe(id).params)}`);
    expect(texto).toContain('· caso de prueba medido');
    expect(texto).toContain('pausa la regla en «Mis reglas»');
    expect(registrados[0]).toEqual(['t-1', `r-${id}`, expect.objectContaining({ resultado: 'enviado', via: 'texto' })]);
  });

  it('cada plantilla corre por SU lector: evaluar recibe la plantilla, los params validados y el tenant', async () => {
    for (const id of PLANTILLAS_ID) {
      evaluar.mockClear();
      reglasActivas.mockResolvedValue([reglaDe(id)]);
      await vigilarReglas(AHORA);
      expect(evaluar).toHaveBeenCalledWith(id, reglaDe(id).params, 't-1', AHORA);
    }
  });

  it('la frase de CADA plantilla cabe en 400 caracteres (la restricción de la base) y no queda vacía', () => {
    for (const id of PLANTILLAS_ID) {
      const frase = fraseDe(id, reglaDe(id).params);
      expect(frase.length, id).toBeGreaterThan(20);
      expect(frase.length, id).toBeLessThanOrEqual(400);
    }
  });
});
