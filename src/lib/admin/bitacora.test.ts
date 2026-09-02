import { describe, expect, it, vi, beforeEach } from 'vitest';

// EL PRIMER LECTOR DE bitacora_auditoria — sin prueba hasta ahora.
// ADM-12 (auditoría 24, menor): esta lectura era la única de lib/admin sin
// `acotada` (acotada_guardiana.test.ts lo cazaba). Esta prueba fija el
// comportamiento FUNCIONAL: filtra, ordena, mapea, y LANZA si la base falla
// — `acotada` no debe cambiar nada de eso, solo agregar un tope de tiempo.

type Resp = { data: unknown; error: { message: string } | null };
const respuesta: { actual: Resp } = { actual: { data: [], error: null } };
const filtrosIlike: string[] = [];
const limites: number[] = [];

function crearBuilder() {
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.ilike = (_col: string, patron: string) => { filtrosIlike.push(patron); return b; };
  b.order = () => b;
  b.limit = (n: number) => { limites.push(n); return b; };
  b.then = (ok: (v: Resp) => unknown, fail?: (e: unknown) => unknown) =>
    Promise.resolve(respuesta.actual).then(ok, fail);
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => crearBuilder() }),
}));

const { ultimasEntradasBitacora } = await import('./bitacora');

beforeEach(() => {
  respuesta.actual = { data: [], error: null };
  filtrosIlike.length = 0;
  limites.length = 0;
});

const FILA = {
  id: 1, tenant_id: 't1', actor_id: 'u1', actor_email: 'javier@likida.mx',
  accion: 'interruptor.apagado', entidad: 'interruptor', entidad_id: 'agente:cobranza',
  detalle: { motivo: 'x' }, ocurrio_en: '2026-08-30T10:00:00Z',
  tenant: { nombre: 'Flota Uno' }, actor: { nombre: 'Javier', email: 'javier@likida.mx' },
};

describe('ultimasEntradasBitacora', () => {
  it('mapea la fila con el tenant/actor resueltos', async () => {
    respuesta.actual = { data: [FILA], error: null };
    const r = await ultimasEntradasBitacora();
    expect(r).toEqual([{
      id: 1, tenantId: 't1', tenantNombre: 'Flota Uno', actor: 'Javier',
      accion: 'interruptor.apagado', entidad: 'interruptor', entidadId: 'agente:cobranza',
      detalle: { motivo: 'x' }, ocurrioEn: '2026-08-30T10:00:00Z',
    }]);
  });

  it('el límite por default es 50, y un límite pedido se respeta', async () => {
    await ultimasEntradasBitacora();
    expect(limites).toEqual([50]);
    await ultimasEntradasBitacora({ limite: 10 });
    expect(limites).toEqual([50, 10]);
  });

  it('el filtro se sanea a [a-z0-9._:-] antes de armar el ilike (minúsculas, sin espacios ni comodines/comillas)', async () => {
    await ultimasEntradasBitacora({ filtroAccion: "Interruptor% Apagado' --" });
    // "Interruptor% Apagado' --" → minúsculas → se quita todo lo que no sea
    // [a-z0-9._:-]: el espacio, el %, la comilla desaparecen; el guion doble
    // final SÍ es del dominio permitido y se conserva.
    expect(filtrosIlike).toEqual(['%interruptorapagado--%']);
  });

  it('sin filtro, no se llama a ilike', async () => {
    await ultimasEntradasBitacora();
    expect(filtrosIlike).toEqual([]);
  });

  it('con la base caída LANZA — "sin entradas" sobre una base caída mentiría', async () => {
    respuesta.actual = { data: null, error: { message: 'db down' } };
    await expect(ultimasEntradasBitacora()).rejects.toThrow('db down');
  });
});
