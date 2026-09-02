// EL BUS DE MANDO — la mitad de IO (bus.test.ts ya fija lo puro). El cliente
// de Supabase va mockeado con el mismo criterio de qa-storage.test: lo que se
// fija es el CONTRATO — errores por valor por fuente, transiciones ancladas a
// `pendiente`, y los TRES estados de la fuente GitHub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── El doble de supabaseAdmin: un builder encadenable por tabla ────────────
type Resultado = { data: unknown; error: { message: string } | null };
const respuestas = new Map<string, Resultado>();
const inserts: Array<{ tabla: string; fila: unknown }> = [];
const updates: Array<{ tabla: string; cambios: unknown; filtros: string[] }> = [];

function builder(tabla: string) {
  const filtros: string[] = [];
  const b: Record<string, unknown> = {};
  const encadena = (nombre: string) => {
    b[nombre] = (...args: unknown[]) => {
      if (nombre === 'eq') filtros.push(`${args[0]}=${args[1]}`);
      if (nombre === 'insert') inserts.push({ tabla, fila: args[0] });
      if (nombre === 'update') updates.push({ tabla, cambios: args[0], filtros });
      return b;
    };
  };
  ['select', 'order', 'limit', 'eq', 'insert', 'update'].forEach(encadena);
  b.then = (res: (r: Resultado) => void) =>
    res(respuestas.get(tabla) ?? { data: [], error: null });
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => builder(tabla),
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: 'https://firmada/x' } }),
        // Las piezas se firman EN LOTE desde el 28-ago-2026 (un request, no
        // uno por pieza — ver el incidente en supabase/reintento.ts).
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((p) => ({ path: p, signedUrl: 'https://firmada/x', signedURL: `/${p}`, error: null })),
          error: null,
        }),
      }),
    },
  }),
}));

import { getEstadoBus, crearOrden, resolverPieza, getPrsAbiertos } from './bus';

beforeEach(() => {
  respuestas.clear();
  inserts.length = 0;
  updates.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('getEstadoBus — errores por valor, por fuente', () => {
  it('con las tres fuentes sanas arma catálogo+corridas, firma la pieza y detecta kill switch pendiente', async () => {
    respuestas.set('bus_rutina', { data: [{ nombre: 'dof-diario', horario: '21:30', descripcion: 'DOF' }], error: null });
    respuestas.set('bus_corrida', {
      data: [
        { rutina: 'dof-diario', inicio: '2026-08-17T02:00:00Z', fin: null, veredicto: 'VEREDICTO: ok', pr_url: null, exit_code: 0 },
        { rutina: 'jarvis-brief', inicio: '2026-08-17T01:00:00Z', fin: null, veredicto: null, pr_url: null, exit_code: null },
      ],
      error: null,
    });
    respuestas.set('bus_pieza', { data: [{ id: 'p1', rutina: 'promos', carpeta: 'publicar/x', titulo: 'x', tipo: 'imagen', copy_md: null, media_path: 'piezas/x/a.png', creado_en: '2026-08-17T00:00:00Z' }], error: null });
    respuestas.set('bus_orden', { data: [{ id: 'o1', tipo: 'kill_switch_on', rutina: null, estado: 'pendiente', creado_en: '2026-08-17T00:00:00Z', resultado: null }], error: null });

    const r = await getEstadoBus();
    expect(r.errores).toEqual([]);
    // jarvis-brief corrió sin estar en el catálogo: el bus enseña lo que sabe.
    expect(r.rutinas.map((x) => x.nombre).sort()).toEqual(['dof-diario', 'jarvis-brief']);
    expect(r.piezasPendientes[0].mediaUrl).toBe('https://firmada/x');
    expect(r.killSwitchPendiente).toBe(true);
  });

  it('una tabla caída apaga SU fuente y lo dice — las demás siguen', async () => {
    respuestas.set('bus_rutina', { data: null, error: { message: 'db down' } });
    respuestas.set('bus_pieza', { data: [], error: null });
    respuestas.set('bus_orden', { data: [], error: null });
    const r = await getEstadoBus();
    expect(r.errores.join(' ')).toContain('rutinas');
    expect(r.piezasPendientes).toEqual([]);
  });
});

describe('mutaciones — ancladas y con firma', () => {
  it('crearOrden inserta con el actor; la inválida ni toca la base', async () => {
    await crearOrden('correr_ahora', 'dof-diario', 'user-1');
    expect(inserts[0]).toMatchObject({ tabla: 'bus_orden', fila: { tipo: 'correr_ahora', rutina: 'dof-diario', creado_por: 'user-1' } });
    await expect(crearOrden('correr_ahora', null, 'user-1')).rejects.toThrow(/rutina/);
    expect(inserts).toHaveLength(1);
  });

  it('resolverPieza va anclada a pendiente; sin fila afectada = ya la resolvió otro tap', async () => {
    respuestas.set('bus_pieza', { data: [{ id: 'p1' }], error: null });
    await resolverPieza('p1', 'aprobada', 'user-1');
    expect(updates[0].filtros).toContain('estado=pendiente');
    respuestas.set('bus_pieza', { data: [], error: null });
    await expect(resolverPieza('p1', 'aprobada', 'user-1')).rejects.toThrow(/ya estaba resuelta/);
  });
});

describe('getPrsAbiertos — tres estados, ninguno disfrazado de cero', () => {
  it('sin token → sin_token, sin red', async () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    const espia = vi.fn();
    vi.stubGlobal('fetch', espia);
    expect((await getPrsAbiertos()).estado).toBe('sin_token');
    expect(espia).not.toHaveBeenCalled();
  });
  it('GitHub caído → error', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'tok');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    expect((await getPrsAbiertos()).estado).toBe('error');
  });
  it('con datos → la lista real', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'tok');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([
      { number: 18, title: 'Fase D', html_url: 'https://x/18', head: { ref: 'fase-d/bus-de-mando' }, created_at: '2026-08-17T00:00:00Z' },
    ])));
    const r = await getPrsAbiertos();
    if (r.estado !== 'ok') throw new Error(`esperaba ok, vino ${r.estado}`);
    expect(r.prs[0]).toMatchObject({ numero: 18, rama: 'fase-d/bus-de-mando' });
  });
});
