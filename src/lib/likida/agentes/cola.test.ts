import { describe, it, expect, vi, beforeEach } from 'vitest';

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

type Registro = { tabla: string; op: string; payload: Record<string, unknown> | null; eq: Array<[string, unknown]>; is: Array<[string, unknown]> };
const llamadas: Registro[] = [];
const respuestas = new Map<string, Array<{ data: unknown; error: { code?: string; message: string } | null }>>();
const logs = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function builder(tabla: string) {
  const r: Registro = { tabla, op: 'select', payload: null, eq: [], is: [] };
  const responder = () => {
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    insert: (p: Record<string, unknown>) => { r.op = 'insert'; r.payload = p; llamadas.push(r); return b; },
    update: (p: Record<string, unknown>) => { r.op = 'update'; r.payload = p; llamadas.push(r); return b; },
    select: () => b,
    eq: (c: string, v: unknown) => { r.eq.push([c, v]); return b; },
    neq: () => b,
    is: (c: string, v: unknown) => { r.is.push([c, v]); return b; },
    order: () => b,
    range: () => b,
    limit: () => b,
    single: () => b,
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(responder).then(res, rej),
  });
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: logs }));

const { encolarPieza, aprobarPieza, rechazarPieza, marcarEnviada } = await import('./cola');
const { DatoInvalido } = await import('../errores');

const de = (tabla: string, op: string) => llamadas.filter((l) => l.tabla === tabla && l.op === op);

beforeEach(() => {
  llamadas.length = 0;
  respuestas.clear();
  logs.error.mockClear();
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
    respuestas.set('cola_aprobacion', [{ data: [], error: null }]);
    await expect(aprobarPieza('p-1', 'u-1')).rejects.toThrow(/ya no está pendiente/);
  });

  it('el UPDATE va anclado a estado=pendiente — jamás pisa una resolución ajena', async () => {
    respuestas.set('cola_aprobacion', [{ data: [{ id: 'p-1', cuerpo: 'original' }], error: null }]);
    respuestas.set('bitacora_auditoria', [{ data: null, error: null }]);
    await aprobarPieza('p-1', 'u-1');
    const up = de('cola_aprobacion', 'update')[0];
    expect(up.eq).toContainEqual(['estado', 'pendiente']);
    expect(up.payload).toMatchObject({ estado: 'aprobado', resuelto_por: 'u-1' });
  });

  it('la edición idéntica al original NO cuenta como edición', async () => {
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
