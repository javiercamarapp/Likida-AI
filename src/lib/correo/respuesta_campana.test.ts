import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA RESPUESTA DE CAMPAÑA (c5-2): la promesa «responde BAJA» tiene que ser
// verdad — la BAJA suprime, la respuesta detiene al SDR (historial 0118) y
// el operador se entera. Antes NADA de esto existía: el webhook descartaba
// la respuesta como sin_buzon y el pie era mentira.
// ═══════════════════════════════════════════════════════════════════════════

const respuestas = new Map<string, Array<{ data: unknown; error: { message: string } | null }>>();
const inserts: Array<{ tabla: string; payload: Record<string, unknown> }> = [];

function builder(tabla: string) {
  const responder = () => {
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, ilike: () => b, is: () => b, limit: () => b,
    insert: (p: Record<string, unknown>) => { inserts.push({ tabla, payload: p }); return b; },
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(responder).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
const suprimir = vi.fn(async () => {});
vi.mock('@/lib/likida/agentes/enviador', () => ({ suprimirCorreo: (...a: unknown[]) => suprimir(...(a as [])) }));
const alertas: Array<{ evento: string }> = [];
vi.mock('@/lib/observability/alerta', () => ({ alertarOperador: async (evento: string) => { alertas.push({ evento }); } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { esBaja, extraerCorreo, esRespuestaACampana, procesarRespuestaCampana } = await import('./respuesta_campana');

beforeEach(() => { respuestas.clear(); inserts.length = 0; alertas.length = 0; suprimir.mockClear(); });

describe('los detectores puros', () => {
  it('BAJA es palabra completa, con o sin texto alrededor, sin importar mayúsculas', () => {
    expect(esBaja('BAJA', null)).toBe(true);
    expect(esBaja(null, 'necesito darme de baja por favor')).toBe(true);
    expect(esBaja('Re: propuesta', 'unsubscribe')).toBe(true);
    expect(esBaja('Re: propuesta', 'aquí se trabaja duro')).toBe(false);
    expect(esBaja('rebaja de precios', 'me interesa la rebaja')).toBe(false);
  });
  it('extraerCorreo lee "Nombre <a@b>" y direcciones pelonas', () => {
    expect(extraerCorreo('Juan Pérez <juan@x.mx>')).toBe('juan@x.mx');
    expect(extraerCorreo('MAYUS@X.MX')).toBe('mayus@x.mx');
    expect(extraerCorreo('sin correo')).toBeNull();
  });
  it('esRespuestaACampana matchea el buzón avisos@ del dominio', () => {
    expect(esRespuestaACampana(['Likida <avisos@mail.likida.ai>'], 'avisos@mail.likida.ai')).toBe(true);
    expect(esRespuestaACampana(['facturas+tok@mail.likida.ai'], 'avisos@mail.likida.ai')).toBe(false);
  });
});

describe('procesarRespuestaCampana', () => {
  it('la BAJA suprime SIEMPRE — incluso sin prospecto que la matchee', async () => {
    respuestas.set('prospecto', [{ data: [], error: null }]);
    respuestas.set('prospecto_correo', [{ data: [], error: null }]);
    const r = await procesarRespuestaCampana({ from: 'x@empresa.mx', subject: 'BAJA', text: '' });
    expect(r).toMatchObject({ ok: true, resultado: 'baja_sin_prospecto' });
    expect(suprimir).toHaveBeenCalledWith('x@empresa.mx', expect.stringMatching(/baja/i));
  });

  it('una respuesta registra direccion=respuesta en el historial (el freno del SDR) y alerta al operador', async () => {
    respuestas.set('prospecto', [{ data: [{ id: 'pr-1' }], error: null }]);
    respuestas.set('prospecto_contacto', [{ data: null, error: null }]);
    const r = await procesarRespuestaCampana({ from: 'Gerente <g@empresa.mx>', subject: 'Me interesa', text: 'cuéntame más' });
    expect(r).toMatchObject({ ok: true, resultado: 'respuesta_registrada' });
    expect(suprimir).not.toHaveBeenCalled();
    const contacto = inserts.find((i) => i.tabla === 'prospecto_contacto');
    expect(contacto?.payload).toMatchObject({ prospecto_id: 'pr-1', direccion: 'respuesta', canal: 'correo' });
    expect(alertas.some((a) => a.evento === 'campania.respuesta')).toBe(true);
  });

  it('el remitente que era una COPIA (prospecto_correo) también encuentra su prospecto', async () => {
    respuestas.set('prospecto', [{ data: [], error: null }]);
    respuestas.set('prospecto_correo', [{ data: [{ prospecto_id: 'pr-7' }], error: null }]);
    respuestas.set('prospecto_contacto', [{ data: null, error: null }]);
    const r = await procesarRespuestaCampana({ from: 'compras@empresa.mx', subject: 'BAJA ya', text: '' });
    expect(r).toMatchObject({ ok: true, resultado: 'baja_registrada' });
    expect(inserts[0]?.payload).toMatchObject({ prospecto_id: 'pr-7' });
  });

  it('el historial que no se puede escribir devuelve ok:false — el llamador contesta 503 y el proveedor reintenta', async () => {
    respuestas.set('prospecto', [{ data: [{ id: 'pr-1' }], error: null }]);
    respuestas.set('prospecto_contacto', [{ data: null, error: { message: 'base caída' } }]);
    const r = await procesarRespuestaCampana({ from: 'g@empresa.mx', subject: 'hola', text: '' });
    expect(r.ok).toBe(false);
  });
});
