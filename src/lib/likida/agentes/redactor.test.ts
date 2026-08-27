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
vi.mock('./cola', async () => {
  const { DatoInvalido: DI } = await import('../errores');
  return {
    encolarPieza: (...a: unknown[]) => encolarPieza(...(a as [])),
    // La réplica del verificador (el real vive en cola.ts desde c5-14 y
    // tiene sus pruebas allá): mismos guardarraíles, mismo tipo de error.
    verificarFormatoCampana: (texto: string) => {
      if (/clientes?\s+reales/i.test(texto)) throw new DI('El correo dice "clientes reales" — Pieza descartada.');
      if (texto.includes('—')) throw new DI('El correo trae guion largo (—) — Pieza descartada.');
    },
  };
});
const registrarCorrida = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('./corridas', () => ({ registrarCorrida: (...a: unknown[]) => registrarCorrida(...a) }));

const { redactarCorreoFrio, parsearVariantes, primerNombreDelContacto, sustituirMarcador } = await import('./redactor');
const CONTEXTO = { tenantId: 'tenant-redactor-a', runId: '00000000-0000-4000-8000-000000000001' };
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
  it('sin tenant explícito falla cerrado antes de leer prospectos o llamar al modelo', async () => {
    await expect(redactarCorreoFrio('pr-1', 'Javier')).rejects.toThrow(/tenant requerido/);
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it('apagado (kill switch): no gasta en el modelo ni encola', async () => {
    apagado = true;
    await expect(redactarCorreoFrio('pr-1', 'Javier', 'manual', CONTEXTO)).rejects.toThrow(/apagado/);
    expect(generateResponse).not.toHaveBeenCalled();
    expect(encolarPieza).not.toHaveBeenCalled();
  });

  it('contactado hace <48h: la cadencia frena ANTES del modelo (censo finito)', async () => {
    respuestas.set('prospecto', [{ data: PROSPECTO, error: null }]);
    respuestas.set('prospecto_contacto', [{ data: [{ ocurrio_en: 'ayer' }], error: null }]);
    await expect(redactarCorreoFrio('pr-1', 'Javier', 'manual', CONTEXTO)).rejects.toThrow(/48 horas/);
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it('con el historial ILEGIBLE no se redacta — fail closed, como el envío', async () => {
    respuestas.set('prospecto', [{ data: PROSPECTO, error: null }]);
    respuestas.set('prospecto_contacto', [{ data: null, error: { message: 'db down' } }]);
    await expect(redactarCorreoFrio('pr-1', 'Javier', 'manual', CONTEXTO)).rejects.toThrow(/historial/);
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it('una pieza PENDIENTE del mismo prospecto frena la duplicada', async () => {
    respuestas.set('prospecto', [{ data: PROSPECTO, error: null }]);
    respuestas.set('prospecto_contacto', [{ data: [], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [{ id: 'pieza-vieja' }], error: null }]);
    await expect(redactarCorreoFrio('pr-1', 'Javier', 'manual', CONTEXTO)).rejects.toThrow(/esperando aprobación/);
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it('a un cerrado/perdido no se le redacta correo frío', async () => {
    respuestas.set('prospecto', [{ data: { ...PROSPECTO, estado: 'perdido' }, error: null }]);
    await expect(redactarCorreoFrio('pr-1', 'Javier', 'manual', CONTEXTO)).rejects.toThrow(/perdido/);
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it('el camino feliz: encola la variante A como cuerpo, B/C en fuentes, agente redactor — y corrida ok', async () => {
    respuestas.set('prospecto', [{ data: PROSPECTO, error: null }]);
    respuestas.set('prospecto_contacto', [{ data: [], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [], error: null }]);
    const r = await redactarCorreoFrio('pr-1', 'Javier', 'manual', CONTEXTO);
    // 0217: el asunto de la campaña se IMPONE en código — el del modelo no sale.
    expect(r).toMatchObject({ piezaId: 'pieza-1', asunto: 'Automatizar la liquidación de viajes, antes de contratar para el puesto', aviso: null });

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
    expect(generateResponse).toHaveBeenCalledWith(expect.objectContaining({ budget: expect.objectContaining({ tenantId: 'tenant-redactor-a' }) }));
  });

  it('sin correo capturado: la pieza entra IGUAL pero el aviso viaja con ella', async () => {
    respuestas.set('prospecto', [{ data: { ...PROSPECTO, correo: null }, error: null }]);
    respuestas.set('prospecto_contacto', [{ data: [], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [], error: null }]);
    const r = await redactarCorreoFrio('pr-1', 'Javier', 'manual', CONTEXTO);
    expect(r.aviso).toMatch(/no tiene correo capturado/);
    const pieza = encolarPieza.mock.calls[0][0] as { fuentes: Record<string, unknown> };
    expect(String(pieza.fuentes.aviso)).toMatch(/correo/);
  });

  it('el modelo caído: corrida en fallo, error de pantalla, nada encolado', async () => {
    respuestas.set('prospecto', [{ data: PROSPECTO, error: null }]);
    respuestas.set('prospecto_contacto', [{ data: [], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [], error: null }]);
    generateResponse.mockRejectedValueOnce(new Error('timeout'));
    await expect(redactarCorreoFrio('pr-1', 'Javier', 'manual', CONTEXTO)).rejects.toThrow(/no pudo escribir/);
    expect(encolarPieza).not.toHaveBeenCalled();
    expect(registrarCorrida).toHaveBeenCalledWith(null, 'redactor', expect.objectContaining({ estado: 'fallo' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 19 (legal C2, CRÍTICO) — el aviso de privacidad del Cerebro de
// ventas promete «tu nombre no sale de Likida: la ficha que recibe el modelo
// lleva un marcador en lugar de tu nombre... tu nombre de pila se pone
// después, dentro de Likida» (privacidad.ts:757). El código mandaba el
// nombre COMPLETO tal cual al modelo — el mecanismo del aviso nunca existió.
// ═══════════════════════════════════════════════════════════════════════════
describe('primerNombreDelContacto — el ÚNICO dato que se sustituye de vuelta', () => {
  it('toma solo la primera palabra — "de pila", no el nombre completo', () => {
    expect(primerNombreDelContacto('Juan Pérez López')).toBe('Juan');
  });
  it('sin contacto capturado, null — no hay nada que sustituir', () => {
    expect(primerNombreDelContacto(null)).toBeNull();
  });
  it('espacios sueltos no cuentan como nombre', () => {
    expect(primerNombreDelContacto('   ')).toBeNull();
  });
});

describe('sustituirMarcador — el modelo nunca ve el nombre real', () => {
  it('con nombre: reemplaza cada aparición del marcador', () => {
    expect(sustituirMarcador('Hola {{NOMBRE}}, ¿cómo va {{NOMBRE}}?', 'Juan'))
      .toBe('Hola Juan, ¿cómo va Juan?');
  });
  it('sin nombre: limpia el saludo en vez de dejar el marcador visible', () => {
    expect(sustituirMarcador('Hola {{NOMBRE}}, le escribo de Likida.', null))
      .toBe('Hola, le escribo de Likida.');
  });
  it('sin nombre y sin coma: el marcador se retira igual, sin dejarlo huérfano', () => {
    expect(sustituirMarcador('Buen día {{NOMBRE}} espero le sirva.', null))
      .toBe('Buen día  espero le sirva.');
  });
});

describe('redactarCorreoFrio — el modelo NUNCA ve el nombre real del contacto', () => {
  const SALIDA_CON_MARCADOR = `## Variante A — por el costo
**Asunto:** El cierre del viaje, sin liquidador

Hola {{NOMBRE}}, le escribo de Likida sobre el cierre administrativo del viaje.
¿Le vienen bien 15 minutos el jueves?

## Variante B — por el dinero fiscal
**Asunto:** El IEPS del diésel y el peaje

Hola {{NOMBRE}}, ¿hoy están recuperando el IEPS del diésel?
¿Le vienen bien 15 minutos el jueves?

## Variante C — confirmación de demo
No aplica: la variante C solo se usa después de un sí.

**Datos usados:** ninguno específico de esta empresa.`;

  it('el dossier que recibe el modelo lleva el marcador, NUNCA el nombre real', async () => {
    respuestas.set('prospecto', [{ data: { ...PROSPECTO, contacto_nombre: 'Juan Pérez López' }, error: null }]);
    respuestas.set('prospecto_contacto', [{ data: [], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [], error: null }]);
    generateResponse.mockResolvedValueOnce({ text: SALIDA_CON_MARCADOR, model: 'prueba', tokensIn: 100, tokensOut: 200, cost: 0.001 });

    await redactarCorreoFrio('pr-1', 'Javier', 'manual', CONTEXTO);

    const llamada = generateResponse.mock.calls[0][0] as { messages: Array<{ content: string }> };
    const dossierEnviado = llamada.messages[0].content;
    expect(dossierEnviado).toContain('{{NOMBRE}}');
    expect(dossierEnviado).not.toContain('Juan');
    expect(dossierEnviado).not.toContain('Pérez');
  });

  it('la pieza encolada (la que un humano aprueba) SÍ trae el nombre de pila real, sustituido después', async () => {
    respuestas.set('prospecto', [{ data: { ...PROSPECTO, contacto_nombre: 'Juan Pérez López' }, error: null }]);
    respuestas.set('prospecto_contacto', [{ data: [], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [], error: null }]);
    generateResponse.mockResolvedValueOnce({ text: SALIDA_CON_MARCADOR, model: 'prueba', tokensIn: 100, tokensOut: 200, cost: 0.001 });

    await redactarCorreoFrio('pr-1', 'Javier', 'manual', CONTEXTO);

    const pieza = encolarPieza.mock.calls[0][0] as { titulo: string; cuerpo: string; fuentes: { variante_b: { cuerpo: string } | null } };
    expect(pieza.cuerpo).toContain('Hola Juan,');
    expect(pieza.cuerpo).not.toContain('{{NOMBRE}}');
    expect(pieza.fuentes.variante_b?.cuerpo).toContain('Hola Juan,');
  });

  it('sin contacto capturado: el dossier dice "no capturado" y no hay marcador que sustituir', async () => {
    respuestas.set('prospecto', [{ data: PROSPECTO, error: null }]); // contacto_nombre: null
    respuestas.set('prospecto_contacto', [{ data: [], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [], error: null }]);

    await redactarCorreoFrio('pr-1', 'Javier', 'manual', CONTEXTO);

    const llamada = generateResponse.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(llamada.messages[0].content).toContain('Contacto: no capturado');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL FORMATO DE CAMPAÑA (0217) — los guardarraíles cazados EN VIVO en la
// campaña real, ahora código: jamás "clientes reales" (nadie ha firmado),
// jamás guion largo, y el asunto único de la campaña se impone tras el parseo.
// ═══════════════════════════════════════════════════════════════════════════
describe('verificarFormatoCampana — los guardarraíles son código, no prompt', () => {
  it('rechaza "clientes reales" — ninguna empresa ha firmado', async () => {
    const { verificarFormatoCampana } = await import('./redactor');
    expect(() => verificarFormatoCampana('Trabajamos con clientes reales como GAL.')).toThrow(DatoInvalido);
  });

  it('rechaza el guion largo', async () => {
    const { verificarFormatoCampana } = await import('./redactor');
    expect(() => verificarFormatoCampana('Liquidamos viajes — sin liquidador.')).toThrow(/guion largo/);
  });

  it('deja pasar la frase permitida ("en pláticas con transportistas como...")', async () => {
    const { verificarFormatoCampana } = await import('./redactor');
    expect(() => verificarFormatoCampana('Estamos en pláticas con transportistas como Grupo GAL y Transportes Innovativos.')).not.toThrow();
  });

  it('un correo del modelo que viole el formato NO entra a la cola y la corrida queda en fallo', async () => {
    respuestas.set('prospecto', [{ data: PROSPECTO, error: null }]);
    respuestas.set('prospecto_contacto', [{ data: [], error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [], error: null }]);
    generateResponse.mockResolvedValueOnce({
      text: SALIDA_MODELO.replace('trabajamos el cierre administrativo del viaje.', 'ya lo usan clientes reales.'),
      model: 'prueba', tokensIn: 100, tokensOut: 200, cost: 0.001,
    });
    await expect(redactarCorreoFrio('pr-1', 'Javier', 'manual', CONTEXTO)).rejects.toThrow(/clientes reales/);
    expect(encolarPieza).not.toHaveBeenCalled();
  });
});
