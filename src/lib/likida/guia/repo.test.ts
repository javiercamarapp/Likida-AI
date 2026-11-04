import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { estadoVacio } from './estado';
import { guardarEstado, insertarEventos, invitacionEncendida, leerEstado } from './repo';

interface Fila { user_id: string; tenant_id: string; estado: unknown; version: number }

/** Base falsa con la semántica que importa: clave (user, tenant), insert con unique y update condicionado a `version`. */
function dbFalsa(filas: Fila[], opciones: { falla?: boolean; tablaFaltante?: boolean; eventos?: unknown[]; tenant?: Record<string, unknown> } = {}): SupabaseClient {
  return {
    from: (t: string) => {
      if (opciones.tablaFaltante) return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '42P01', message: 'no existe' } }) }), maybeSingle: async () => ({ data: null, error: { code: '42P01', message: 'x' } }) }) }), insert: async () => ({ error: { code: '42P01' } }) };
      if (t === 'onboarding_evento') return { insert: async (f: unknown[]) => { if (opciones.falla) return { error: { message: 'x' } }; opciones.eventos?.push(...f); return { error: null }; } };
      if (t === 'onboarding_tenant') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opciones.tenant ?? null, error: null }) }) }) };
      const filtros: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { filtros[c] = v; return q; },
        maybeSingle: async () => {
          const f = filas.find((x) => x.user_id === filtros.user_id && x.tenant_id === filtros.tenant_id);
          return { data: f ? { estado: f.estado, version: f.version } : null, error: null };
        },
        insert: async (n: Fila) => {
          if (filas.some((x) => x.user_id === n.user_id && x.tenant_id === n.tenant_id)) return { error: { code: '23505' } };
          filas.push({ ...n });
          return { error: null };
        },
        update: (n: Partial<Fila>) => {
          const f2: Record<string, unknown> = {};
          const u = {
            eq: (c: string, v: unknown) => { f2[c] = v; return u; },
            select: async () => {
              const f = filas.find((x) => x.user_id === f2.user_id && x.tenant_id === f2.tenant_id && x.version === f2.version);
              if (!f) return { data: [], error: null };
              Object.assign(f, n);
              return { data: [{ version: f.version }], error: null };
            },
          };
          return u;
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

describe('leerEstado', () => {
  it('sin fila: estado vacío y versión 0', async () => {
    expect(await leerEstado(dbFalsa([]), 'u', 't')).toEqual({ ok: true, estado: estadoVacio(), version: 0 });
  });
  it('con tabla ausente devuelve no_disponible (la guía sigue con el respaldo local)', async () => {
    expect(await leerEstado(dbFalsa([], { tablaFaltante: true }), 'u', 't')).toEqual({ ok: false, motivo: 'no_disponible' });
  });
  it('normaliza lo que haya guardado', async () => {
    const r = await leerEstado(dbFalsa([{ user_id: 'u', tenant_id: 't', estado: { invitacion: 'trucada', modo: 'corto' }, version: 3 }]), 'u', 't');
    expect(r).toMatchObject({ ok: true, version: 3 });
    expect(r.ok && r.estado.invitacion).toBe('pendiente');
    expect(r.ok && r.estado.modo).toBe('corto');
  });
});

describe('guardarEstado', () => {
  it('la primera escritura espera versión 0 y crea la fila en versión 1', async () => {
    const filas: Fila[] = [];
    const r = await guardarEstado(dbFalsa(filas), 'u', 't', { modo: 'corto' }, 0);
    expect(r).toMatchObject({ ok: true, version: 1 });
    expect(filas).toHaveLength(1);
  });
  it('fusiona sobre lo guardado y sube la versión', async () => {
    const filas: Fila[] = [{ user_id: 'u', tenant_id: 't', estado: { modo: 'corto', pistas: ['/dashboard/a'] }, version: 1 }];
    const r = await guardarEstado(dbFalsa(filas), 'u', 't', { invitacion: 'vista' }, 1);
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect(filas[0].version).toBe(2);
    expect((filas[0].estado as { modo: string }).modo).toBe('corto');
  });
  it('una versión vieja se rechaza y devuelve lo actual para reintentar una vez', async () => {
    const filas: Fila[] = [{ user_id: 'u', tenant_id: 't', estado: { modo: 'completo' }, version: 4 }];
    const r = await guardarEstado(dbFalsa(filas), 'u', 't', { modo: 'corto' }, 2);
    expect(r).toMatchObject({ ok: false, motivo: 'version', actual: { version: 4 } });
    expect(filas[0].version).toBe(4);
  });
  it('dos dispositivos que crean a la vez: el segundo recibe choque de versión, no un error', async () => {
    const filas: Fila[] = [{ user_id: 'u', tenant_id: 't', estado: {}, version: 1 }];
    // El segundo cree que no hay fila (esperaba 0) pero ya existe: se detecta por la versión leída.
    expect(await guardarEstado(dbFalsa(filas), 'u', 't', { modo: 'corto' }, 0)).toMatchObject({ ok: false, motivo: 'version' });
  });
  it('estado de otro usuario o de otra flota nunca se toca', async () => {
    const filas: Fila[] = [{ user_id: 'otro', tenant_id: 't', estado: { modo: 'completo' }, version: 1 }];
    await guardarEstado(dbFalsa(filas), 'u', 't', { modo: 'corto' }, 0);
    expect(filas.find((f) => f.user_id === 'otro')?.estado).toEqual({ modo: 'completo' });
    expect(filas).toHaveLength(2);
  });
  it('un parche que pasa del tope se rechaza con tamano', async () => {
    const hechos = Array.from({ length: 200 }, (_, i) => `PM${String(i).padStart(3, '0')}-${i}`.slice(0, 40));
    const recorridos = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`recorrido.numero.largo.${i}`, { paso: 'P', hechos, omitidos: hechos, confirmados: hechos, inicio: '2026-11-01T00:00:00Z', fin: null, version: 1 }]));
    expect(await guardarEstado(dbFalsa([]), 'u', 't', { recorridos }, 0)).toMatchObject({ ok: false, motivo: 'tamano' });
  });
  it('sin tabla devuelve no_disponible', async () => {
    expect(await guardarEstado(dbFalsa([], { tablaFaltante: true }), 'u', 't', {}, 0)).toEqual({ ok: false, motivo: 'no_disponible' });
  });
});

describe('invitacionEncendida', () => {
  it('solo es verdad con la fila encendida; sin fila o con error es apagado', async () => {
    expect(await invitacionEncendida(dbFalsa([], { tenant: { invitacion: true } }), 't')).toBe(true);
    expect(await invitacionEncendida(dbFalsa([], { tenant: { invitacion: false } }), 't')).toBe(false);
    expect(await invitacionEncendida(dbFalsa([]), 't')).toBe(false);
  });
});

describe('insertarEventos', () => {
  const ev = { tipo: 'guia_inicio' as const, recorrido: null, paso_id: null, valor_ms: null, valor_n: null, canal: 'movil' as const, reducido: false };
  const ctx = { tenantId: 't', actor: 'a1a1a1a1a1a1a1a1', pista: 'dueno', rol: 'flota_admin', perfil: null };
  it('agrega tenant, actor, rol y pista del SERVIDOR a cada fila', async () => {
    const guardados: unknown[] = [];
    expect(await insertarEventos(dbFalsa([], { eventos: guardados }), ctx, [ev])).toBe(1);
    expect(guardados[0]).toMatchObject({ tenant_id: 't', actor: 'a1a1a1a1a1a1a1a1', pista: 'dueno', rol: 'flota_admin' });
  });
  it('lote vacío o error de base devuelve 0 sin lanzar', async () => {
    expect(await insertarEventos(dbFalsa([]), ctx, [])).toBe(0);
    expect(await insertarEventos(dbFalsa([], { falla: true }), ctx, [ev])).toBe(0);
  });
});
