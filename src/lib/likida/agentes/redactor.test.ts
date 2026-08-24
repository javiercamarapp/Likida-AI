import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL REDACTOR (C5) — los contratos que el código debe sostener:
//  · Su ÚNICA salida es encolarPieza — jamás toca el canal de envío.
//  · Apagado (kill switch) o con historial ilegible: NO gasta en el modelo.
//  · La cadencia se lee ANTES de redactar (censo finito) y una pieza
//    pendiente del mismo prospecto frena la duplicada.
//  · La variante A va LISTA PARA SALIR en el cuerpo; B/C y los datos usados
//    viajan en `fuentes`. Sin correo capturado, el AVISO viaja con la pieza.
// ═══════════════════════════════════════════════════════════════════════════

const respuestas = new Map<string, Array<{ data: unknown; error: { message: string } | null }>>();
function builder(tabla: string) {
  const responder = () => {
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, is: () => b, gte: () => b, limit: () => b,
    maybeSingle: () => b, order: () => b, range: () => b, insert: () => b,
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(responder).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let apagado = false;
vi.mock('../interruptores', () => ({ estaApagado: async () => apagado }));

const SALIDA_MODELO = `## Variante A — por el costo
**Asunto:** El cierre del viaje, sin liquidador

Buen día. Le escribo de Likida: trabajamos el cierre administrativo del viaje.
¿Le vienen bien 15 minutos el jueves?

## Variante B — por el dinero fiscal
**Asunto:** El IEPS del diésel y el peaje

Buen día. ¿Hoy están recuperando el IEPS del diésel y el 50% del peaje?
¿Le vienen bien 15 minutos el jueves?

## Variante C — confirmación de demo
No aplica: la variante C solo se usa después de un sí.

**Datos usados:** ninguno específico de esta empresa.`;

const generateResponse = vi.fn(async (..._a: unknown[]) => ({
  text: SALIDA_MODELO, model: 'prueba', tokensIn: 100, tokensOut: 200, cost: 0.001,
}));
vi.mock('@/lib/llm/openrouter', () => ({ generateResponse: (...a: unknown[]) => generateResponse(...a) }));

const encolarPieza = vi.fn(async (..._a: unknown[]) => 'pieza-1');
vi.mock('./cola', () => ({ encolarPieza: (...a: unknown[]) => encolarPieza(...a) }));
const registrarCorrida = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('./corridas', () => ({ registrarCorrida: (...a: unknown[]) => registrarCorrida(...a) }));

const { redactarCorreoFrio, parsearVariantes } = await import('./redactor');
const { DatoInvalido } = await import('../errores');

const PROSPECTO = {
  id: 'pr-1', empresa: 'Transportes X', contacto_nombre: null, correo: 'c@x.mx',
  ciudad: 'Apodaca', estado: 'nuevo', fuente: 'censo', notas: null,
};

beforeEach(() => {
  respuestas.clear();
  apagado = false;
  generateResponse.mockClear();
  encolarPieza.mockClear();
  registrarCorrida.mockClear();
});

describe('parsearVariantes — la frontera entre el modelo y la cola', () => {
  it('extrae A/B/C y los datos usados', () => {
    const v = parsearVariantes(SALIDA_MODELO);
    expect(v.a.asunto).toBe('El cierre del viaje, sin liquidador');
    expect(v.a.cuerpo).toContain('cierre administrativo');
    expect(v.b?.asunto).toContain('IEPS');
    expect(v.c).toContain('No aplica');
    expect(v.datosUsados).toContain('ninguno específico');
  });

  it('sin variante A legible, LANZA — una pieza malformada no entra a la cola', () => {
    expect(() => parsearVariantes('bla bla sin formato')).toThrow(DatoInvalido);
  });
});

describe('redactarCorreoFrio', () => {
  it('apagado (kill switch): no gasta en el modelo ni encola', async () => {
    apagado = true;
    await expect(redactarCorreoFrio('pr-1', 'Javier')).rejects.toThrow(/apagado/);
    expect(generateResponse).not.toHaveBeenCalled();
    expect(encolarPieza).not.toHaveBeenCalled();
  });

  it('contactado hace <48h: la cadencia frena ANTES del modelo (censo finito)', async () => {
    respuestas.set('prospecto', [{ data: PROSPECTO, error: null }]);
    respuestas.set('prospecto_contacto', [{ data: [{ ocurrio_en: 'ayer' }], error: null }]);
    await expect(redactarCorreoFrio('pr-1', 'Javier')).rejects.toThrow(/48 horas/);
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it('con el historial ILEGIBLE no se redacta — fail closed, como el envío', async () => {
    respuestas.set('prospecto', [{ data: PROSPECTO, error: null }]);
    respuestas.set('prospecto_contacto', [{ data: null, error: { message: 'db down' } }]);
    await expect(redactarCorreoFrio('pr-1', 'Javier')).rejects.toThrow(/historial/);
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it('una pieza PENDIENTE del mismo prospecto frena la duplicada', async () => {
    respuestas.set('prospecto', [{ data: PROSPECTO, error: null }]);
    respuestas.set('prospecto_contacto', [{ data: [], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [{ id: 'pieza-vieja' }], error: null }]);
    await expect(redactarCorreoFrio('pr-1', 'Javier')).rejects.toThrow(/esperando aprobación/);
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it('a un cerrado/perdido no se le redacta correo frío', async () => {
    respuestas.set('prospecto', [{ data: { ...PROSPECTO, estado: 'perdido' }, error: null }]);
    await expect(redactarCorreoFrio('pr-1', 'Javier')).rejects.toThrow(/perdido/);
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it('el camino feliz: encola la variante A como cuerpo, B/C en fuentes, agente redactor — y corrida ok', async () => {
    respuestas.set('prospecto', [{ data: PROSPECTO, error: null }]);
    respuestas.set('prospecto_contacto', [{ data: [], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [], error: null }]);
    const r = await redactarCorreoFrio('pr-1', 'Javier');
    expect(r).toMatchObject({ piezaId: 'pieza-1', asunto: 'El cierre del viaje, sin liquidador', aviso: null });

    expect(encolarPieza).toHaveBeenCalledTimes(1);
    const pieza = encolarPieza.mock.calls[0][0] as {
      tipo: string; prioridad: string; agente: string; prospectoId: string;
      titulo: string; cuerpo: string; fuentes: Record<string, unknown>;
    };
    expect(pieza).toMatchObject({ tipo: 'correo_frio', prioridad: 'normal', agente: 'redactor', prospectoId: 'pr-1' });
    expect(pieza.cuerpo).toContain('cierre administrativo');
    expect(pieza.cuerpo).not.toContain('Variante B');
    expect(pieza.fuentes.variante_b).toBeTruthy();
    expect(registrarCorrida).toHaveBeenCalledWith(null, 'redactor', expect.objectContaining({ estado: 'ok' }));
  });

  it('sin correo capturado: la pieza entra IGUAL pero el aviso viaja con ella', async () => {
    respuestas.set('prospecto', [{ data: { ...PROSPECTO, correo: null }, error: null }]);
    respuestas.set('prospecto_contacto', [{ data: [], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [], error: null }]);
    const r = await redactarCorreoFrio('pr-1', 'Javier');
    expect(r.aviso).toMatch(/no tiene correo capturado/);
    const pieza = encolarPieza.mock.calls[0][0] as { fuentes: Record<string, unknown> };
    expect(String(pieza.fuentes.aviso)).toMatch(/correo/);
  });

  it('el modelo caído: corrida en fallo, error de pantalla, nada encolado', async () => {
    respuestas.set('prospecto', [{ data: PROSPECTO, error: null }]);
    respuestas.set('prospecto_contacto', [{ data: [], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [], error: null }]);
    generateResponse.mockRejectedValueOnce(new Error('timeout'));
    await expect(redactarCorreoFrio('pr-1', 'Javier')).rejects.toThrow(/no pudo escribir/);
    expect(encolarPieza).not.toHaveBeenCalled();
    expect(registrarCorrida).toHaveBeenCalledWith(null, 'redactor', expect.objectContaining({ estado: 'fallo' }));
  });
});
