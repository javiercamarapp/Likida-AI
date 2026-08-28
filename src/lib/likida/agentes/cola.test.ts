import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA COLA DE APROBACIÓN (0117) — los contratos que el código debe sostener
// (los de BASE los prueba el bloque 92 de verificaciones.sql):
//
//  · Toda transición va ANCLADA a pendiente: cero filas = alguien la resolvió
//    antes, y SE DICE — jamás se pisa una resolución ajena.
//  · Rechazar exige motivo con palabras de pantalla (la base lo re-exige).
//  · marcarEnviada solo sella aprobadas Y deja el contacto en el historial
//    del prospecto (0118) — y si ESE insert falla, el envío no se deshace:
//    se grita en el log.
// ═══════════════════════════════════════════════════════════════════════════

type Registro = { tabla: string; op: string; payload: Record<string, unknown> | null; eq: Array<[string, unknown]>; is: Array<[string, unknown]>; inn: Array<[string, unknown]> };
const llamadas: Registro[] = [];
const respuestas = new Map<string, Array<{ data: unknown; error: { code?: string; message: string } | null }>>();
const logs = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function builder(tabla: string) {
  const r: Registro = { tabla, op: 'select', payload: null, eq: [], is: [], inn: [] };
  const responder = () => {
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    insert: (p: Record<string, unknown>) => { r.op = 'insert'; r.payload = p; llamadas.push(r); return b; },
    update: (p: Record<string, unknown>) => { r.op = 'update'; r.payload = p; llamadas.push(r); return b; },
    delete: () => { r.op = 'delete'; llamadas.push(r); return b; },
    // Una LECTURA también se registra: `rebotesRecientes` no escribe nada, y
    // sin esto no habría forma de comprobar contra qué filtra.
    select: () => { if (r.op === 'select' && !llamadas.includes(r)) llamadas.push(r); return b; },
    eq: (c: string, v: unknown) => { r.eq.push([c, v]); return b; },
    neq: () => b,
    not: () => b,
    is: (c: string, v: unknown) => { r.is.push([c, v]); return b; },
    in: (c: string, v: unknown) => { r.inn.push([c, v]); return b; },
    gte: () => b,
    lte: () => b,
    order: () => b,
    range: () => b,
    limit: () => b,
    single: () => b,
    maybeSingle: () => b,
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(responder).then(res, rej),
  });
  return b;
}

const llamadasRpc: Array<{ fn: string; args: Record<string, unknown> }> = [];
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({
  from: (t: string) => builder(t),
  rpc: (fn: string, args: Record<string, unknown>) => {
    llamadasRpc.push({ fn, args });
    const cola = respuestas.get(`rpc:${fn}`);
    return Promise.resolve(cola && cola.length > 0 ? cola.shift()! : { data: 'reserva-1', error: null });
  },
}) }));
vi.mock('@/lib/logger', () => ({ logger: logs }));
let resultadoEnvio: { ok: true; id: string } | { ok: false; motivo: 'rechazado' | 'red' | 'sin_configurar'; detalle?: string } = { ok: true, id: 're_123' };
const enviarCorreo = vi.fn<(...a: unknown[]) => Promise<typeof resultadoEnvio>>(async () => resultadoEnvio);
vi.mock('@/lib/correo/enviar', () => ({ enviarCorreo: (...a: unknown[]) => enviarCorreo(...a) }));

const {
  encolarPieza, aprobarPieza, rechazarPieza, marcarEnviada, enviarPiezaPorCorreo,
  rebotesRecientes, correosSuprimidos,
} = await import('./cola');
const { DatoInvalido } = await import('../errores');

const de = (tabla: string, op: string) => llamadas.filter((l) => l.tabla === tabla && l.op === op);

beforeEach(() => {
  llamadas.length = 0;
  llamadasRpc.length = 0;
  respuestas.clear();
  logs.error.mockClear();
  enviarCorreo.mockClear();
  resultadoEnvio = { ok: true, id: 're_123' };
});

describe('encolarPieza', () => {
  it('un agente no declarado (FK 23503) se dice con palabras', async () => {
    respuestas.set('cola_aprobacion', [{ data: null, error: { code: '23503', message: 'fk violation' } }]);
    await expect(encolarPieza({
      tipo: 'correo_frio', prioridad: 'normal', agente: 'fantasma', titulo: 'x', cuerpo: 'y',
    })).rejects.toThrow(/no está en el catálogo/);
  });

  it('cuerpo vacío no entra — una pieza vacía no tiene qué aprobar', async () => {
    await expect(encolarPieza({
      tipo: 'correo_frio', prioridad: 'normal', agente: 'ventas', titulo: 'x', cuerpo: '   ',
    })).rejects.toThrow(DatoInvalido);
    expect(de('cola_aprobacion', 'insert')).toHaveLength(0);
  });
});

describe('aprobarPieza — anclada a pendiente', () => {
  it('cero filas = alguien la resolvió antes, y se dice', async () => {
    respuestas.set('app_user', [{ data: { email: 'j@likida.ai' }, error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [], error: null }]);
    await expect(aprobarPieza('p-1', 'u-1')).rejects.toThrow(/ya no está pendiente/);
  });

  it('el UPDATE va anclado a estado=pendiente y lleva el SNAPSHOT del actor (0120)', async () => {
    respuestas.set('app_user', [{ data: { email: 'javier@likida.ai' }, error: null }]);
    respuestas.set('cola_aprobacion', [{ data: [{ id: 'p-1', cuerpo: 'original' }], error: null }]);
    respuestas.set('bitacora_auditoria', [{ data: null, error: null }]);
    await aprobarPieza('p-1', 'u-1');
    const up = de('cola_aprobacion', 'update')[0];
    expect(up.eq).toContainEqual(['estado', 'pendiente']);
    expect(up.payload).toMatchObject({ estado: 'aprobado', resuelto_por: 'u-1', resuelto_por_email: 'javier@likida.ai' });
  });

  it('sin poder confirmar QUIÉN resuelve, la resolución se detiene — nadie aprueba como nadie', async () => {
    respuestas.set('app_user', [{ data: null, error: null }]);
    await expect(aprobarPieza('p-1', 'u-fantasma')).rejects.toThrow(/quién resuelve/);
    expect(de('cola_aprobacion', 'update')).toHaveLength(0);
  });

  it('la edición idéntica al original NO cuenta como edición', async () => {
    respuestas.set('app_user', [{ data: { email: 'j@likida.ai' }, error: null }]);
    respuestas.set('cola_aprobacion', [
      { data: [{ id: 'p-1', cuerpo: 'mismo texto' }], error: null },
      { data: null, error: null }, // la limpieza de cuerpo_final
    ]);
    respuestas.set('bitacora_auditoria', [{ data: null, error: null }]);
    await aprobarPieza('p-1', 'u-1', 'mismo texto');
    const bit = de('bitacora_auditoria', 'insert')[0];
    expect((bit.payload as { detalle: { editada: boolean } }).detalle.editada).toBe(false);
  });
});

describe('rechazarPieza', () => {
  it('sin motivo rebota con texto de pantalla, sin tocar la base', async () => {
    await expect(rechazarPieza('p-1', 'u-1', '  ')).rejects.toThrow(/motivo/);
    expect(de('cola_aprobacion', 'update')).toHaveLength(0);
  });
});

describe('marcarEnviada — el eslabón con el historial de contactos (0118)', () => {
  it('solo aprobada y no enviada; con prospecto, deja el contacto en su historial', async () => {
    respuestas.set('cola_aprobacion', [{
      data: [{ id: 'p-1', prospecto_id: 'pr-9', titulo: 'Correo día 0', agente: 'ventas' }], error: null,
    }]);
    respuestas.set('prospecto_contacto', [{ data: null, error: null }]);
    await marcarEnviada('p-1', 'u-1', 'correo');

    const up = de('cola_aprobacion', 'update')[0];
    expect(up.eq).toContainEqual(['estado', 'aprobado']);
    expect(up.is).toContainEqual(['enviado_en', null]);

    const contacto = de('prospecto_contacto', 'insert')[0];
    expect(contacto.payload).toMatchObject({ prospecto_id: 'pr-9', canal: 'correo', direccion: 'salida', pieza_id: 'p-1' });
  });

  it('si el contacto no se pudo registrar, el envío NO se deshace — se grita en el log', async () => {
    respuestas.set('cola_aprobacion', [{
      data: [{ id: 'p-1', prospecto_id: 'pr-9', titulo: 'x', agente: 'ventas' }], error: null,
    }]);
    respuestas.set('prospecto_contacto', [{ data: null, error: { message: 'db down' } }]);
    await expect(marcarEnviada('p-1', null)).resolves.toBeUndefined();
    expect(logs.error).toHaveBeenCalledWith('cola.contacto_no_registrado', expect.objectContaining({ prospecto: 'pr-9' }));
  });

  it('una pieza sin prospecto no inventa contacto', async () => {
    respuestas.set('cola_aprobacion', [{
      data: [{ id: 'p-2', prospecto_id: null, titulo: 'post', agente: 'ventas' }], error: null,
    }]);
    await marcarEnviada('p-2', 'u-1');
    expect(de('prospecto_contacto', 'insert')).toHaveLength(0);
  });
});

describe('enviarPiezaPorCorreo — el envío REAL (0120, P1 de la auditoría externa)', () => {
  const FILA = {
    id: 'p-1', titulo: 'Correo día 0', cuerpo: 'Hola,\n\nvi su vacante.', cuerpo_final: null,
    agente: 'ventas', prospecto_id: 'pr-9', prospecto: { empresa: 'Transportes X', correo: 'contacto@x.mx' },
  };

  it('CLAIM anclado a (aprobada ∧ no enviada) — dos clicks: el segundo toca cero filas y se dice', async () => {
    respuestas.set('cola_aprobacion', [{ data: [], error: null }]);
    await expect(enviarPiezaPorCorreo('p-1', 'u-1')).rejects.toThrow(/otro click|Recarga/);
    expect(enviarCorreo).not.toHaveBeenCalled();
  });

  it('el camino feliz: claim → reserva atómica (0124) → Resend → provider_message_id', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [FILA], error: null },        // el claim
      { data: null, error: null },          // la prueba (provider id)
    ]);
    const r = await enviarPiezaPorCorreo('p-1', 'u-1');
    expect(r).toMatchObject({ ok: true, destinatario: 'contacto@x.mx', providerId: 're_123' });

    const claim = de('cola_aprobacion', 'update')[0];
    expect(claim.eq).toContainEqual(['estado', 'aprobado']);
    expect(claim.is).toContainEqual(['enviado_en', null]);
    const prueba = de('cola_aprobacion', 'update')[1];
    expect(prueba.payload).toMatchObject({ provider_message_id: 're_123' });
    // El contacto del historial ES la reserva de la RPC — cero inserts extra.
    expect(llamadasRpc[0]).toMatchObject({ fn: 'reservar_envio_prospecto', args: { p_prospecto: 'pr-9' } });
    expect(de('prospecto_contacto', 'insert')).toHaveLength(0);
  });

  it('la edición humana MANDA: sale cuerpo_final, no el original', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [{ ...FILA, cuerpo_final: 'Versión editada por Javier.' }], error: null },
      { data: null, error: null },
    ]);
    respuestas.set('prospecto_contacto', [{ data: null, error: null }]);
    await enviarPiezaPorCorreo('p-1', 'u-1');
    const [, correo] = enviarCorreo.mock.calls[0] as unknown as [string, { parrafos: string[] }];
    expect(correo.parrafos.join(' ')).toContain('Versión editada');
    expect(correo.parrafos.join(' ')).not.toContain('vi su vacante');
  });

  it('Resend rechaza → COMPENSACIÓN: el claim se revierte, el error queda y la pieza sigue enviable', async () => {
    resultadoEnvio = { ok: false, motivo: 'rechazado', detalle: 'HTTP 422' };
    respuestas.set('cola_aprobacion', [
      { data: [FILA], error: null },   // el claim
      { data: null, error: null },     // la reversión
    ]);
    await expect(enviarPiezaPorCorreo('p-1', 'u-1')).rejects.toThrow(/no aceptó el envío.*reintentar/s);
    const reversion = de('cola_aprobacion', 'update')[1];
    expect(reversion.payload).toMatchObject({ enviado_en: null });
    expect(String((reversion.payload as { envio_error: string }).envio_error)).toContain('rechazado');
    expect(de('prospecto_contacto', 'insert')).toHaveLength(0);
  });

  it('prospecto sin correo → se revierte el claim y se dice dónde capturarlo', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [{ ...FILA, prospecto: { empresa: 'X', correo: null } }], error: null },
      { data: null, error: null },
    ]);
    await expect(enviarPiezaPorCorreo('p-1', 'u-1')).rejects.toThrow(/no tiene correo capturado/);
    expect(enviarCorreo).not.toHaveBeenCalled();
  });
});

describe('la guardia de cadencia, ATÓMICA (0124) — una transacción decide, no un SELECT', () => {
  const FILA_G = {
    id: 'p-1', titulo: 'Correo día 2', cuerpo: 'Seguimiento.', cuerpo_final: null,
    agente: 'ventas', prospecto_id: 'pr-9', prospecto: { empresa: 'X', correo: 'c@x.mx' },
  };

  it('la RPC bloquea (null): claim revertido, dicho con palabras, y CERO envío', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [FILA_G], error: null },  // el claim
      { data: null, error: null },      // la reversión
    ]);
    respuestas.set('rpc:reservar_envio_prospecto', [{ data: null, error: null }]);
    await expect(enviarPiezaPorCorreo('p-1', 'u-1')).rejects.toThrow(/48 horas.*cadencia/s);
    expect(enviarCorreo).not.toHaveBeenCalled();
    expect(llamadasRpc[0]).toMatchObject({ fn: 'reservar_envio_prospecto', args: { p_prospecto: 'pr-9', p_pieza: 'p-1' } });
    const reversion = de('cola_aprobacion', 'update')[1];
    expect(reversion.payload).toMatchObject({ enviado_en: null });
  });

  it('si la RPC no responde, no se manda — la cadencia no se decide a ciegas', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [FILA_G], error: null },
      { data: null, error: null },
    ]);
    respuestas.set('rpc:reservar_envio_prospecto', [{ data: null, error: { message: 'db down' } }]);
    await expect(enviarPiezaPorCorreo('p-1', 'u-1')).rejects.toThrow(/cadencia.*Reintenta/s);
    expect(enviarCorreo).not.toHaveBeenCalled();
  });

  it('la reserva ES el contacto del historial: el envío OK no inserta un segundo', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [FILA_G], error: null },  // el claim
      { data: null, error: null },      // la prueba (provider id)
    ]);
    respuestas.set('rpc:reservar_envio_prospecto', [{ data: 'reserva-77', error: null }]);
    const r = await enviarPiezaPorCorreo('p-1', 'u-1');
    expect(r.ok).toBe(true);
    expect(de('prospecto_contacto', 'insert')).toHaveLength(0);
  });

  it('Resend rechaza: la reserva se COMPENSA (delete) — no bloquea 48h por un correo que no salió', async () => {
    resultadoEnvio = { ok: false, motivo: 'rechazado', detalle: 'HTTP 422' };
    respuestas.set('cola_aprobacion', [
      { data: [FILA_G], error: null },
      { data: null, error: null },      // la reversión del claim
    ]);
    respuestas.set('rpc:reservar_envio_prospecto', [{ data: 'reserva-77', error: null }]);
    respuestas.set('prospecto_contacto', [{ data: null, error: null }]); // el delete
    await expect(enviarPiezaPorCorreo('p-1', 'u-1')).rejects.toThrow(/no aceptó/);
    const borrado = de('prospecto_contacto', 'delete')[0];
    expect(borrado.eq).toContainEqual(['id', 'reserva-77']);
  });
});

describe('el tope diario de correo frío (Fase 2: 20-40/día, configurable)', () => {
  const FILA_T = {
    id: 'p-1', titulo: 'Correo frío', cuerpo: 'Hola.', cuerpo_final: null,
    agente: 'redactor', prioridad: 'normal', prospecto_id: null, prospecto: { empresa: 'X', correo: 'c@x.mx' },
  };
  const envAntes = process.env.LIKIDA_TOPE_CORREO_FRIO_DIA;
  beforeEach(() => { process.env.LIKIDA_TOPE_CORREO_FRIO_DIA = '2'; });
  afterEach(() => {
    if (envAntes === undefined) delete process.env.LIKIDA_TOPE_CORREO_FRIO_DIA;
    else process.env.LIKIDA_TOPE_CORREO_FRIO_DIA = envAntes;
  });

  it('al llegar al tope, la pieza rebota, el claim se compensa y sale mañana', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [FILA_T], error: null },                       // el claim (cuenta como 1 de hoy)
      { data: null, error: null, count: 3 } as never,        // 3 con enviado_en hoy = esta + 2 previas = tope lleno
      { data: null, error: null },                           // la reversión
    ]);
    await expect(enviarPiezaPorCorreo('p-1', 'u-1')).rejects.toThrow(/tope diario/i);
    expect(enviarCorreo).not.toHaveBeenCalled();
    const reversion = de('cola_aprobacion', 'update')[1];
    expect(reversion.payload).toMatchObject({ enviado_en: null });
  });

  it('debajo del tope, el correo sale', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [{ ...FILA_T, prospecto: { empresa: 'X', correo: 'c@x.mx' } }], error: null },
      { data: null, error: null, count: 1 } as never,        // solo esta pieza hoy
      { data: null, error: null },                           // la prueba (provider id)
    ]);
    const r = await enviarPiezaPorCorreo('p-1', 'u-1');
    expect(r.ok).toBe(true);
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
  });

  it('la bandeja URGENTE no cuenta contra el techo — su SLA es de minutos', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [{ ...FILA_T, prioridad: 'urgente', prospecto: { empresa: 'X', correo: 'c@x.mx' } }], error: null },
      { data: null, error: null },                           // la prueba
    ]);
    const r = await enviarPiezaPorCorreo('p-1', 'u-1');
    expect(r.ok).toBe(true);
    // Sin lectura de conteo que rebote: claim + prueba, y nada se compensó.
    expect(de('cola_aprobacion', 'update')).toHaveLength(2);
  });

  it('sin poder LEER el conteo, no se manda (fail closed) y el claim se compensa', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [{ ...FILA_T, prospecto: { empresa: 'X', correo: 'c@x.mx' } }], error: null },
      { data: null, error: { message: 'base caída' } },       // el conteo truena
      { data: null, error: null },                            // la reversión
    ]);
    await expect(enviarPiezaPorCorreo('p-1', 'u-1')).rejects.toThrow(/tope diario/i);
    expect(enviarCorreo).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA FABLE CICLO 5 — los bordes de la puerta de salida.
// ═══════════════════════════════════════════════════════════════════════════
const { porQueLoRecibes, verificarFormatoCampana } = await import('./cola');

describe('c5-1 — la lista de bajas EN LA PUERTA (camino humano incluido)', () => {
  const FILA_B = {
    id: 'p-1', tipo: 'correo_frio', titulo: 'Correo día 0', cuerpo: 'Hola.', cuerpo_final: null,
    agente: 'redactor', prospecto_id: 'pr-9', prospecto: { empresa: 'X', correo: 'contacto@x.mx' },
  };

  it('el principal suprimido: la pieza NO sale, el claim se revierte y se dice por qué', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [FILA_B], error: null },   // el claim
      { data: null, error: null },       // la reversión
    ]);
    respuestas.set('correo_suprimido', [{ data: [{ correo: 'contacto@x.mx' }], error: null }]);
    await expect(enviarPiezaPorCorreo('p-1', 'u-1')).rejects.toThrow(/lista de bajas/);
    expect(enviarCorreo).not.toHaveBeenCalled();
    const reversion = de('cola_aprobacion', 'update')[1];
    expect(reversion.payload).toMatchObject({ enviado_en: null });
  });

  it('la lista ilegible = NO se manda (fail closed), también en el camino humano', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [FILA_B], error: null },
      { data: null, error: null },
    ]);
    respuestas.set('correo_suprimido', [{ data: null, error: { message: 'base caída' } }]);
    await expect(enviarPiezaPorCorreo('p-1', 'u-1')).rejects.toThrow(/lista de bajas/);
    expect(enviarCorreo).not.toHaveBeenCalled();
  });

  it('una copia suprimida se cae del envío sin frenar al principal', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [FILA_B], error: null },
      { data: null, error: null },       // la prueba (provider id)
    ]);
    respuestas.set('correo_suprimido', [{ data: [{ correo: 'muerto@x.mx' }], error: null }]);
    const r = await enviarPiezaPorCorreo('p-1', 'u-1', ['muerto@x.mx', 'vivo@x.mx']);
    expect(r.ok).toBe(true);
    const [para] = enviarCorreo.mock.calls[0] as unknown as [string[]];
    expect(para).toContain('vivo@x.mx');
    expect(para).not.toContain('muerto@x.mx');
  });
});

describe('c5-3 — el timeout de Resend es AMBIGUO: ni reversión ni reenvío automático', () => {
  const FILA_R = {
    id: 'p-1', tipo: 'correo_frio', titulo: 'Correo día 0', cuerpo: 'Hola.', cuerpo_final: null,
    agente: 'redactor', prospecto_id: 'pr-9', prospecto: { empresa: 'X', correo: 'contacto@x.mx' },
  };

  it("motivo 'red': el claim se QUEDA, la reserva de cadencia NO se borra, y el error dice 'verificar en Resend'", async () => {
    resultadoEnvio = { ok: false, motivo: 'red', detalle: 'The operation was aborted due to timeout' };
    respuestas.set('cola_aprobacion', [
      { data: [FILA_R], error: null },   // el claim
      { data: null, error: null },       // la anotación del ambiguo (envio_error)
    ]);
    await expect(enviarPiezaPorCorreo('p-1', 'u-1')).rejects.toThrow(/verificar en resend/i);
    // La reserva de la RPC NO se compensó: cero deletes sobre el historial.
    expect(de('prospecto_contacto', 'delete')).toHaveLength(0);
    // El segundo update anota el ambiguo SIN tocar enviado_en (el claim vive).
    const anotacion = de('cola_aprobacion', 'update')[1];
    expect(anotacion.payload).not.toHaveProperty('enviado_en');
    expect(String((anotacion.payload as { envio_error: string }).envio_error)).toMatch(/AMBIGUO/);
  });

  it('la llave de idempotencia viaja con el envío (el reintento humano es seguro)', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [FILA_R], error: null },
      { data: null, error: null },
    ]);
    await enviarPiezaPorCorreo('p-1', 'u-1');
    const opciones = enviarCorreo.mock.calls[0][2] as { idempotencyKey?: string };
    expect(opciones?.idempotencyKey).toBe('pieza-p-1');
  });
});

describe('c5-5 — el pie dice POR QUÉ según la fuente real, jamás una vacante que no consta', () => {
  it('con vacante capturada, la vacante; sin ella, jamás', () => {
    expect(porQueLoRecibes('censo', 'Liquidador de viajes')).toMatch(/vacante/);
    expect(porQueLoRecibes('censo', null)).not.toMatch(/vacante/);
    expect(porQueLoRecibes('censo', null)).toMatch(/directorios públicos/);
    expect(porQueLoRecibes('landing', null)).toMatch(/calculadora/);
    expect(porQueLoRecibes('landing', null)).not.toMatch(/vacante/);
    // La instrucción de BAJA va SIEMPRE.
    for (const pie of [porQueLoRecibes('censo', 'x'), porQueLoRecibes('landing', null), porQueLoRecibes(null, null)]) {
      expect(pie).toMatch(/BAJA/);
    }
  });

  it('el envío usa la fuente del prospecto (landing → calculadora, sin vacante inventada)', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [{
        id: 'p-1', tipo: 'correo_frio', titulo: 'T', cuerpo: 'C', cuerpo_final: null, agente: 'redactor',
        prospecto_id: 'pr-9', prospecto: { empresa: 'X', correo: 'c@x.mx', fuente: 'landing', vacante: null },
      }], error: null },
      { data: null, error: null },
    ]);
    await enviarPiezaPorCorreo('p-1', 'u-1');
    const correo = enviarCorreo.mock.calls[0][1] as { porQueLoRecibes: string };
    expect(correo.porQueLoRecibes).toMatch(/calculadora/);
    expect(correo.porQueLoRecibes).not.toMatch(/vacante/);
  });
});

describe('c5-14 — el formato de campaña se verifica también EN LA PUERTA', () => {
  it('un cuerpo_final editado con guion largo NO sale: claim revertido y dicho', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [{
        id: 'p-1', tipo: 'correo_frio', titulo: 'T', cuerpo: 'C', cuerpo_final: 'Edición humana — con guion largo.',
        agente: 'redactor', prospecto_id: 'pr-9', prospecto: { empresa: 'X', correo: 'c@x.mx' },
      }], error: null },
      { data: null, error: null },
    ]);
    await expect(enviarPiezaPorCorreo('p-1', 'u-1')).rejects.toThrow(/guion largo/);
    expect(enviarCorreo).not.toHaveBeenCalled();
  });

  it('una pieza que NO es de campaña no pasa por el verificador (los partes financieros llevan guiones)', async () => {
    respuestas.set('cola_aprobacion', [
      { data: [{
        id: 'p-1', tipo: 'parte_costos', titulo: 'Costos — 2026-08-27', cuerpo: 'Parte — con guiones.', cuerpo_final: null,
        agente: 'control_costos', prospecto_id: 'pr-9', prospecto: { empresa: 'X', correo: 'c@x.mx' },
      }], error: null },
      { data: null, error: null },
    ]);
    const r = await enviarPiezaPorCorreo('p-1', 'u-1');
    expect(r.ok).toBe(true);
  });

  it('verificarFormatoCampana vive en la cola y caza los dos guardarraíles', () => {
    expect(() => verificarFormatoCampana('nuestros clientes reales')).toThrow(/clientes reales/);
    expect(() => verificarFormatoCampana('texto — con raya')).toThrow(/guion largo/);
    expect(() => verificarFormatoCampana('en pláticas con transportistas')).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LOS REBOTES, LEÍBLES (agosto-2026). El webhook de Resend (0124) escribía
// `entrega_estado` y llenaba `correo_suprimido` (0217) desde hacía meses, y
// no había un solo lector: el operador no podía enterarse de que un dominio
// estaba rebotando. Lo que se fija aquí es lo que la pantalla necesita para
// no mentir: que se filtre por los DOS estados malos, que rebote y queja no
// se fundan, y que un error de lectura LANCE en vez de devolver [].
// ═══════════════════════════════════════════════════════════════════════════
describe('rebotesRecientes y correosSuprimidos — lo que Resend ya sabía', () => {
  it('filtra por rebotado Y queja, y las distingue en el resultado', async () => {
    respuestas.set('cola_aprobacion', [{
      data: [
        { id: 'p-1', tipo: 'correo_frio', prioridad: 'normal', agente: 'sdr', titulo: 't', cuerpo: 'c', estado: 'aprobado', creado_en: '2026-08-20T00:00:00Z', entrega_estado: 'rebotado', entrega_evento_en: '2026-08-21T00:00:00Z' },
        { id: 'p-2', tipo: 'correo_frio', prioridad: 'normal', agente: 'sdr', titulo: 't', cuerpo: 'c', estado: 'aprobado', creado_en: '2026-08-19T00:00:00Z', entrega_estado: 'queja', entrega_evento_en: '2026-08-20T00:00:00Z' },
      ],
      error: null,
    }]);
    const r = await rebotesRecientes(15);
    expect(r.map((p) => p.entregaEstado)).toEqual(['rebotado', 'queja']);

    const lectura = llamadas.find((l) => l.tabla === 'cola_aprobacion' && l.op === 'select')!;
    expect(lectura.inn).toEqual([['entrega_estado', ['rebotado', 'queja']]]);
  });

  it('un error de lectura LANZA: una lista vacía diría «no hay rebotes»', async () => {
    respuestas.set('cola_aprobacion', [{ data: null, error: { message: 'fetch failed' } }]);
    await expect(rebotesRecientes()).rejects.toThrow(/rebotesRecientes: fetch failed/);
  });

  it('la lista de bajas trae el MOTIVO — sin él, «ya no le escribimos» no se puede auditar', async () => {
    respuestas.set('correo_suprimido', [{
      data: [{ correo: 'quien@flota.mx', motivo: 'queja de spam (webhook Resend)', creado_en: '2026-08-21T00:00:00Z' }],
      error: null,
    }]);
    const r = await correosSuprimidos();
    expect(r).toEqual([{ correo: 'quien@flota.mx', motivo: 'queja de spam (webhook Resend)', creadoEn: '2026-08-21T00:00:00Z' }]);
  });

  it('la lista de bajas también LANZA ante error de lectura', async () => {
    respuestas.set('correo_suprimido', [{ data: null, error: { message: 'timeout' } }]);
    await expect(correosSuprimidos()).rejects.toThrow(/correosSuprimidos: timeout/);
  });
});
