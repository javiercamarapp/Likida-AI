import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// FAIL-CLOSED DE VERDAD para el cron de escalar — Fase 1 del blueprint.
//
// `route.test.ts` mockea `estaApagado` directo, así que prueba el contrato de
// la RUTA (apagado=true ⇒ saltado) pero no la cadena completa: de los 5
// interruptores de la fase, `conductores` era el único sin una prueba donde
// el módulo `interruptores` REAL convierte un error de lectura en APAGADO
// (las de liquidacion/peajes/proveedores/ventas ya la tienen, con esa misma
// leyenda: "se prueba la cadena completa, no un mock del mock").
//
// Aquí el error entra POR VALOR desde el builder de Supabase, cruza
// `estaApagado` sin mock, y el motor de conductores NO corre. Si alguien
// "normaliza" el fail-closed (error = encendido), esto cae.
// ═══════════════════════════════════════════════════════════════════════════

type RespuestaInterruptor = { data: { apagado: boolean } | null; error: { message: string } | null };

/** Respuesta del builder POR NOMBRE de interruptor; sin entrada = sin fila
 *  (el default del catálogo: ENCENDIDO). */
let interruptores: Record<string, RespuestaInterruptor>;

const logs = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger: logs }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      if (tabla !== 'interruptor') throw new Error(`tabla inesperada: ${tabla}`);
      return {
        select: () => ({
          eq: (_col: string, nombre: string) => ({
            maybeSingle: async () => interruptores[nombre] ?? { data: null, error: null },
          }),
        }),
      };
    },
  }),
}));

const escalarViajesSinAceptar = vi.fn();
const ejecutarCobranzaGlobal = vi.fn();
vi.mock('@/lib/likida/escalar_viaje', () => ({
  escalarViajesSinAceptar: (...a: unknown[]) => escalarViajesSinAceptar(...a),
}));
vi.mock('@/lib/likida/agentes/cobranza', () => ({
  ejecutarCobranzaGlobal: (...a: unknown[]) => ejecutarCobranzaGlobal(...a),
}));
const alertarOperador = vi.fn(async () => {});
vi.mock('@/lib/observability/alerta', () => ({
  alertarOperador: (...a: unknown[]) => alertarOperador(...(a as [])),
}));

process.env.CRON_SECRET = 'secreto-de-prueba';
const { GET } = await import('./route');

const peticion = () => new Request('http://likida.test/api/cron/escalar', {
  headers: { authorization: 'Bearer secreto-de-prueba' },
}) as never;

beforeEach(() => {
  interruptores = {};
  escalarViajesSinAceptar.mockReset().mockResolvedValue({ escalados: 0 });
  ejecutarCobranzaGlobal.mockReset().mockResolvedValue({ tenants: 0, contactados: 0, fallos: [] });
  logs.warn.mockClear();
  logs.error.mockClear();
});

describe('fail-closed con el módulo interruptores REAL (cron escalar)', () => {
  it("la lectura de 'agente:conductores' que FALLA detiene SU motor — la cobranza corre igual", async () => {
    interruptores['agente:conductores'] = { data: null, error: { message: 'fetch failed' } };

    const res = await GET(peticion());
    const cuerpo = await res.json();

    // 200 y no 500: para la ruta es indistinguible de un apagado a propósito
    // (así lo decide `estaApagado`), y un cron rojo mandaría a investigar
    // exactamente lo que el fail-closed acaba de proteger.
    expect(res.status).toBe(200);
    expect(cuerpo.aceptacion).toEqual({ saltado: 'interruptor agente:conductores' });
    expect(escalarViajesSinAceptar).not.toHaveBeenCalled();
    expect(ejecutarCobranzaGlobal).toHaveBeenCalledTimes(1);
    // El salto por fail-closed se GRITA (interruptores.ts): un cron saltándose
    // corridas por una base con hipo se parece demasiado a un cron sano.
    expect(logs.error).toHaveBeenCalledWith('interruptores.lectura_fallo',
      expect.objectContaining({ interruptor: 'agente:conductores' }));
  });

  it("la lectura de 'global' que FALLA detiene los DOS motores", async () => {
    interruptores.global = { data: null, error: { message: 'fetch failed' } };

    const res = await GET(peticion());
    const cuerpo = await res.json();

    expect(res.status).toBe(200);
    expect(cuerpo).toEqual({ corrio: false, saltado: 'interruptor global' });
    expect(escalarViajesSinAceptar).not.toHaveBeenCalled();
    expect(ejecutarCobranzaGlobal).not.toHaveBeenCalled();
    expect(logs.error).toHaveBeenCalledWith('interruptores.lectura_fallo',
      expect.objectContaining({ interruptor: 'global' }));
  });

  it('sin fila de NINGÚN interruptor (el default del catálogo), los dos motores corren', async () => {
    const res = await GET(peticion());
    expect(res.status).toBe(200);
    expect(escalarViajesSinAceptar).toHaveBeenCalledTimes(1);
    expect(ejecutarCobranzaGlobal).toHaveBeenCalledTimes(1);
    expect(logs.error).not.toHaveBeenCalled();
  });
});
