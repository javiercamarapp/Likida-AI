// ═══════════════════════════════════════════════════════════════════════════
// EL KILL SWITCH — lo que estas pruebas fijan es el CONTRATO de la palanca:
//
//   · SIN FILA = ENCENDIDO (el default seguro es que el sistema corre);
//   · error de lectura = APAGADO con grito en el log (fail-closed: ejecutar
//     lo que alguien acaba de apagar es el error caro — ver interruptores.ts);
//   · apagar sin motivo NO escribe nada (la bomba sin nota se rechaza aquí
//     Y en el CHECK de la 0110);
//   · cada toque de palanca queda en bitacora_auditoria, y una bitácora caída
//     no revierte el apagado (best-effort, como `anotar` en administracion.ts).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Registro = {
  tabla: string;
  op: string | null;
  payload: unknown;
  eq: Array<[string, unknown]>;
  in: Array<[string, unknown]>;
};

type Respuesta = { data: unknown; error: { message: string; code?: string } | null };

const llamadas: Registro[] = [];
// Cola POR TABLA, mismo builder que buzon_escritura.test.ts: si la cola se
// vacía se repite la última respuesta.
const colas = new Map<string, Respuesta[]>();
/** Si está puesto, `from()` LANZA — simula el camino síncrono roto. */
let fromRevienta: string | null = null;

function contestar(tabla: string): Respuesta {
  const cola = colas.get(tabla) ?? [];
  const r = cola.length > 1 ? cola.shift() : cola[0];
  return r ?? { data: null, error: null };
}

function builder(tabla: string) {
  const r: Registro = { tabla, op: null, payload: null, eq: [], in: [] };
  llamadas.push(r);
  const b: Record<string, unknown> = {};
  b.insert = (p: unknown) => { r.op = 'insert'; r.payload = p; return b; };
  b.upsert = (p: unknown) => { r.op = 'upsert'; r.payload = p; return b; };
  b.select = () => { if (!r.op) r.op = 'select'; return b; };
  b.eq = (c: string, v: unknown) => { r.eq.push([c, v]); return b; };
  b.in = (c: string, v: unknown) => { r.in.push([c, v]); return b; };
  b.maybeSingle = async () => contestar(tabla);
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(contestar(tabla)).then(res, rej);
  return b;
}

const logs = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      if (fromRevienta) throw new Error(fromRevienta);
      return builder(t);
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: logs }));

const { estaApagado, apagar, encender, listarInterruptores, INTERRUPTORES } = await import('./interruptores');
const { DatoInvalido } = await import('./errores');

const de = (tabla: string, op?: string) =>
  llamadas.filter((l) => l.tabla === tabla && (op === undefined || l.op === op));

beforeEach(() => {
  llamadas.length = 0;
  colas.clear();
  fromRevienta = null;
  logs.info.mockClear();
  logs.warn.mockClear();
  logs.error.mockClear();
});

describe('estaApagado — sin fila = encendido, error = apagado', () => {
  it('sin fila devuelve false: el default seguro es que el sistema corre', async () => {
    colas.set('interruptor', [{ data: null, error: null }]);
    expect(await estaApagado('agente:cobranza')).toBe(false);
    // Y la consulta fue por ESE interruptor, no un scan.
    expect(de('interruptor')[0].eq).toContainEqual(['id', 'agente:cobranza']);
  });

  it('con fila apagada devuelve true', async () => {
    colas.set('interruptor', [{ data: { apagado: true }, error: null }]);
    expect(await estaApagado('global')).toBe(true);
  });

  it('con fila encendida (alguien apagó y volvió a encender) devuelve false', async () => {
    colas.set('interruptor', [{ data: { apagado: false }, error: null }]);
    expect(await estaApagado('global')).toBe(false);
  });

  it('FAIL-CLOSED: un error de lectura se lee como APAGADO, y se grita en el log', async () => {
    // Es la prueba central del módulo. Si un bache de red escondiera la fila
    // y esto devolviera false, el cron ejecutaría exactamente lo que Javier
    // acaba de apagar en pleno incidente.
    colas.set('interruptor', [{ data: null, error: { message: 'fetch failed' } }]);
    expect(await estaApagado('agente:facturas')).toBe(true);
    expect(logs.error).toHaveBeenCalledWith('interruptores.lectura_fallo',
      expect.objectContaining({ interruptor: 'agente:facturas', err: 'fetch failed' }));
  });

  it('FAIL-CLOSED también para el camino que LANZA (cliente sin configurar)', async () => {
    fromRevienta = 'Supabase service-role no configurado';
    expect(await estaApagado('global')).toBe(true);
    expect(logs.error).toHaveBeenCalledWith('interruptores.lectura_fallo',
      expect.objectContaining({ err: 'Supabase service-role no configurado' }));
  });
});

describe('apagar — con motivo, con firma, con bitácora', () => {
  it('upsert con apagado=true, el motivo recortado y la firma de quién', async () => {
    await apagar('agente:cobranza', '  se está portando mal con un chofer  ', 'u-javier');

    const [up] = de('interruptor', 'upsert');
    expect(up.payload).toMatchObject({
      id: 'agente:cobranza',
      apagado: true,
      motivo: 'se está portando mal con un chofer',
      cambiado_por: 'u-javier',
    });
    // Y quedó en la bitácora, como acción de PLATAFORMA (tenant null).
    const [bit] = de('bitacora_auditoria', 'insert');
    expect(bit.payload).toMatchObject({
      tenant_id: null,
      actor_id: 'u-javier',
      accion: 'interruptor.apagado',
      entidad: 'interruptor',
      entidad_id: 'agente:cobranza',
      detalle: { motivo: 'se está portando mal con un chofer' },
    });
  });

  it('sin motivo NO escribe nada: la bomba sin nota se rechaza antes de tocar la base', async () => {
    await expect(apagar('global', '   ', 'u-1')).rejects.toThrow(DatoInvalido);
    expect(de('interruptor')).toHaveLength(0);
    expect(de('bitacora_auditoria')).toHaveLength(0);
  });

  it('un nombre fuera del catálogo se rechaza — no apagaría nada y viviría como si sí', async () => {
    await expect(apagar('agente:marketing', 'motivo', 'u-1')).rejects.toThrow(DatoInvalido);
    expect(de('interruptor')).toHaveLength(0);
  });

  it('si el upsert falla, LANZA: un "apagué" que no apagó es el peor resultado', async () => {
    colas.set('interruptor', [{ data: null, error: { message: 'fetch failed' } }]);
    await expect(apagar('global', 'incidente', 'u-1')).rejects.toThrow(/apagar\(global\): fetch failed/);
    // Y sin bitácora: no se firma un cambio que no ocurrió.
    expect(de('bitacora_auditoria')).toHaveLength(0);
  });

  it('una bitácora caída NO revierte el apagado — se pierde la nota, se grita, la palanca queda', async () => {
    colas.set('bitacora_auditoria', [{ data: null, error: { message: 'fetch failed' } }]);
    await expect(apagar('global', 'incidente', 'u-1')).resolves.toBeUndefined();
    expect(logs.warn).toHaveBeenCalledWith('interruptores.bitacora_no_escribio', expect.anything());
  });
});

describe('encender — vuelve al default y limpia el motivo', () => {
  it('upsert con apagado=false, motivo null, y su entrada de bitácora', async () => {
    await encender('agente:cobranza', 'u-javier');

    const [up] = de('interruptor', 'upsert');
    expect(up.payload).toMatchObject({
      id: 'agente:cobranza', apagado: false, motivo: null, cambiado_por: 'u-javier',
    });
    const [bit] = de('bitacora_auditoria', 'insert');
    expect((bit.payload as Record<string, unknown>).accion).toBe('interruptor.encendido');
  });

  it('si el upsert falla, LANZA', async () => {
    colas.set('interruptor', [{ data: null, error: { message: 'timeout' } }]);
    await expect(encender('global', 'u-1')).rejects.toThrow(/encender\(global\): timeout/);
  });
});

describe('listarInterruptores — el catálogo entero, con los sin fila en su default', () => {
  it('mezcla filas reales con defaults y resuelve el nombre de quién apagó', async () => {
    colas.set('interruptor', [{
      data: [{ id: 'agente:cobranza', apagado: true, motivo: 'incidente', cambiado_por: 'u-1', cambiado_en: '2026-08-15T00:00:00Z' }],
      error: null,
    }]);
    colas.set('app_user', [{ data: [{ id: 'u-1', nombre: 'Javier', email: 'j@likida.ai' }], error: null }]);

    const lista = await listarInterruptores();

    expect(lista).toHaveLength(INTERRUPTORES.length);
    const cobranza = lista.find((i) => i.id === 'agente:cobranza')!;
    expect(cobranza).toMatchObject({ apagado: true, motivo: 'incidente', cambiadoPorNombre: 'Javier' });
    // Los que no tienen fila salen encendidos, sin inventarles historia.
    const global = lista.find((i) => i.id === 'global')!;
    expect(global).toEqual({
      id: 'global', apagado: false, motivo: null,
      cambiadoPor: null, cambiadoPorNombre: null, cambiadoEn: null,
    });
  });

  it('un error de lectura LANZA — "todo encendido" sobre una base caída sería inventarlo', async () => {
    colas.set('interruptor', [{ data: null, error: { message: 'fetch failed' } }]);
    await expect(listarInterruptores()).rejects.toThrow(/listarInterruptores: fetch failed/);
  });

  it('si el nombre del actor no se puede resolver, la lista sale igual con el uuid', async () => {
    colas.set('interruptor', [{
      data: [{ id: 'global', apagado: true, motivo: 'x', cambiado_por: 'u-1', cambiado_en: '2026-08-15T00:00:00Z' }],
      error: null,
    }]);
    colas.set('app_user', [{ data: null, error: { message: 'timeout' } }]);

    const lista = await listarInterruptores();
    const global = lista.find((i) => i.id === 'global')!;
    expect(global.cambiadoPor).toBe('u-1');
    expect(global.cambiadoPorNombre).toBeNull();
    expect(logs.warn).toHaveBeenCalledWith('interruptores.actores_sin_nombre', expect.anything());
  });
});
