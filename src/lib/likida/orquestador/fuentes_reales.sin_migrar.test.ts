import { describe, expect, it, vi } from 'vitest';

// «Código que funciona contra la base SIN migrar»: sin la 0651 (columnas del aviso) y sin la 0652 (claim del barrido) el orquestador lo dice y sigue
// como hasta hoy; no lanza ni pinta ceros. El cliente de Supabase es un doble encadenable que contesta siempre con el error que se le pida.
let error: { code: string; message: string } | null = null;
let datos: unknown = null;
function cadena(): unknown {
  const p: unknown = new Proxy(function () { /* encadenable */ }, {
    get: (_t, k) => (k === 'then' ? (ok: (v: unknown) => unknown) => Promise.resolve({ data: datos, error, count: null }).then(ok) : () => p),
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => cadena(), rpc: () => cadena() }) }));

const { depsAvisoReales, puertoCicloVivoReal, depsBarridoReales } = await import('./fuentes_reales');

describe('el orquestador contra una base sin las migraciones 0651/0652', () => {
  it('sin la 0651 leer una tarea para avisar da null (no hay estado de aviso) y la lista de pendientes da null', async () => {
    error = { code: '42703', message: 'column orquestador_escalacion.aviso_estado does not exist' };
    expect(await depsAvisoReales().leerTarea('t1', 'x')).toBeNull();
    expect(await puertoCicloVivoReal().pendientesDeAviso(10)).toBeNull();
  });

  it('sin la 0652 el claim de flotas da null (barrido no disponible) y registrar no lanza', async () => {
    error = { code: 'PGRST202', message: 'Could not find the function public.reclamar_flotas_barrido_orquestador' };
    expect(await puertoCicloVivoReal().reclamarFlotas(25, 30)).toBeNull();
    await expect(puertoCicloVivoReal().registrarBarrido('t1', { ok: true, abiertas: 0, cerradas: 0, error: null })).resolves.toBeUndefined();
  });

  it('sin la 0650 abrir una tarea de sistema da no_disponible', async () => {
    error = { code: '42P01', message: 'relation "orquestador_escalacion" does not exist' };
    expect(await depsBarridoReales().abrirTarea('t1', { destino: 'mesa_de_control', resumen: 'x', dedupe: 'barrido:vigia' })).toBe('no_disponible');
    expect(await depsBarridoReales().tareasAbiertas('t1')).toBeNull();
  });

  it('un error real (no de esquema) SÍ se propaga: no se confunde una base caída con «sin migrar»', async () => {
    error = { code: '57014', message: 'canceling statement due to statement timeout' };
    await expect(puertoCicloVivoReal().pendientesDeAviso(10)).rejects.toThrow(/statement timeout/);
    await expect(puertoCicloVivoReal().reclamarFlotas(25, 30)).rejects.toThrow(/statement timeout/);
  });
});
